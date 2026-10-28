// Sound, as the browser build's src/audio/audio.js: the recorded one-shots
// (sfx/*.opus) per game event (AudioSystem.sampleFor), the quiet workshop
// ambience per theme (filtered noise loops) and the adaptive music (a bass +
// arpeggio pattern in the theme's "warm" or "cool" scale whose density follows
// the intensity: 0 menus, 1 a round, 2 the celebration). The browser build ran
// ambience and music live (noise loops, oscillators on a 240 ms timer, the
// ambience's slow LFO swell); here each is rendered once into a clip (a slice a
// frame, sine table) and looped on the music bus — the runtime has no ambience
// bus — with intensity changes as cross-fades; the ambience swell is left out
// (a steady bed). Its voice bus (UI blips) is the interface bus. The oscillator
// fallbacks for a sample still decoding are not ported (a clip still loading is
// silent). The runtime's Options own the volumes and the mute; M toggles the
// game's own mute (as the old M key did). Clips load once the mixer runs (in a
// browser after the first press), one at a time.
import { context, createClip, loadClip, play as playClip, type AudioClip, type Bus, type Sound } from "starhermit:audio";

const SAMPLES = [
  "ui-click", "ui-hover", "ui-confirm", "ui-back", "ui-error", "ui-success", "ui-modal-open", "ui-panel-close", "ui-toggle", "ui-toast",
  "ui-pause", "ui-resume", "ui-tab-switch", "ui-countdown-tick", "ui-timer-warning", "ui-slider-drag", "ui-drag-start", "ui-drop",
  "ui-scroll-tick", "undo-rewind", "tool-select", "tool-place", "piston-wallop", "boing-bounce", "plush-thud", "dummy-launch",
  "dummy-land", "streak-combo", "target-hit", "star-ding", "hint-sparkle", "round-start", "round-win", "round-lose", "score-tally", "new-record",
];
const DIRECT = new Set(["ui-click", "ui-hover", "ui-confirm", "ui-back", "ui-modal-open", "ui-panel-close", "ui-toggle", "ui-tab-switch",
  "ui-countdown-tick", "ui-timer-warning", "ui-slider-drag", "ui-drag-start", "ui-drop", "ui-scroll-tick", "round-start", "score-tally", "new-record"]);
const UI = new Set(["ui-click", "ui-hover", "ui-confirm", "ui-back", "ui-modal-open", "ui-panel-close", "ui-toggle", "ui-tab-switch",
  "ui-countdown-tick", "ui-timer-warning", "ui-slider-drag", "ui-drag-start", "ui-drop", "ui-scroll-tick", "ui-pause", "ui-resume", "ui-error",
  "undo-rewind", "tool-select", "hint-sparkle", "ui-toast"]);

/** audio.js sampleFor: the recorded sample an event plays (null = none). */
export function sampleFor(ev: { t: string; [k: string]: unknown }): string | null {
  if (DIRECT.has(ev.t)) return ev.t;
  switch (ev.t) {
    case "pause": return "ui-pause";
    case "resume": return "ui-resume";
    case "hint": return "hint-sparkle";
    case "select": return "tool-select";
    case "place": return "tool-place";
    case "trigger": return ev.tool === "piston" ? "piston-wallop" : ev.tool === "fan" ? "dummy-launch" : null;
    case "impact": if (ev.mat === 0) return "plush-thud"; if (ev.a === 0 && ev.b === -1) return "dummy-land"; return null;
    case "boing": return "boing-bounce";
    case "bell": return "target-hit";
    case "goal": return "star-ding";
    case "win-pending": return "ui-success";
    case "terminal": return ev.reason === "goal-complete" ? "round-win" : "round-lose";
    case "invalid": return "ui-error";
    case "undo": return "undo-rewind";
    case "tutorial-step": return "ui-toast";
    case "achievement": return ev.key === "streak-3" ? "streak-combo" : "ui-success";
    case "results": return "score-tally";
    default: return null;
  }
}

const clips = new Map<string, AudioClip>();
const queue: string[] = [];
let loading = false, wantClips = false, suspended = false, muted = false;
let lastImpact = -1;
export function loadSfx(): void { wantClips = true; }
export function setMuted(on: boolean): void { muted = on; refreshGains(); }
export function event(ev: { t: string; [k: string]: unknown }, nowS = 0): void {
  if (suspended || muted) return;
  const name = sampleFor(ev);
  if (!name) return;
  if (ev.t === "impact") { if (nowS - lastImpact < 0.06) return; lastImpact = nowS; }
  const clip = clips.get(name);
  if (!clip) return;
  const bus: Bus = UI.has(name) ? "interface" : "effects";
  try { playClip(clip, { bus }); } catch { clips.delete(name); if (!queue.includes(name)) queue.push(name); }
}

// -- music and ambience --------------------------------------------------------------------------
const RATE = 22050;
const SINE = new Float32Array(4096);
for (let i = 0; i < 4096; i++) SINE[i] = Math.sin((i / 4096) * Math.PI * 2);
const TICK = 0.24, STEPS = 32;
const LOOP_N = Math.round(RATE * TICK * STEPS);
interface Job { buf: Float32Array; notes: [number, number, number, number, boolean][]; i: number; done: boolean }
/** audio.js startMusic: the notes one intensity plays over 4 bars of 8 steps. */
function musicNotes(mode: string, intensity: number): [number, number, number, number, boolean][] {
  const scale = mode === "cool" ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9];
  const root = mode === "cool" ? 196 : 220;
  const out: [number, number, number, number, boolean][] = [];
  for (let step = 0; step < STEPS; step++) {
    const bar = Math.floor(step / 8), beat = step % 8, t = step * TICK;
    if (beat === 0 || (beat === 4 && intensity > 0)) {
      const deg = scale[[0, 3, 4, 2][bar % 4]! % scale.length]!;
      out.push([t, (root * Math.pow(2, deg / 12)) / 2, 0.5, 0.09, false]);
    }
    if ((beat % 2 === 0 && intensity > 0) || beat % 4 === 1 || intensity > 1) {
      const deg = scale[(step * 3 + bar) % scale.length]! + 12;
      out.push([t, root * Math.pow(2, deg / 12), 0.18, intensity > 1 ? 0.055 : 0.035, true]);
    }
  }
  return out;
}
/** One oscillator note with audio.js env(): 5 ms rise, exponential fall to 0.0001 over `dur`. */
function renderNote(buf: Float32Array, t0: number, f: number, dur: number, peak: number, tri: boolean): void {
  const len = Math.round((dur + 0.05) * RATE), start = Math.round(t0 * RATE), a = 0.005;
  const k = Math.log(0.0001 / peak) / dur;
  let ph = 0;
  const inc = f / RATE;
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const env = t < a ? peak * (t / a) : t < a + dur ? peak * Math.exp(k * (t - a)) : 0;
    ph += inc; ph -= Math.floor(ph);
    const w = tri ? 1 - 4 * Math.abs(ph - 0.5) : SINE[(ph * 4096) | 0]!;
    const j = (start + i) % LOOP_N;
    buf[j] = buf[j]! + w * env;
  }
}
function step(job: Job, budget: number): void {
  let n = 0;
  while (job.i < job.notes.length && n < budget) { const [t, f, d, p, tri] = job.notes[job.i++]!; renderNote(job.buf, t, f, d, p, tri); n++; }
  job.done = job.i >= job.notes.length;
}
/** audio.js startAmbience: filtered noise per kind ([cutoff Hz, gain, lowpass?]). */
const AMBIENCE: Record<string, [number, number, boolean][]> = {
  room: [[140, 0.012, true], [800, 0.004, false]], garden: [[140, 0.012, true], [800, 0.004, false]],
  water: [[300, 0.014, false]], forge: [[90, 0.02, true], [1400, 0.004, false]], night: [[500, 0.007, false]],
};
const AMB_N = RATE * 4;
function renderAmbience(kind: string): Float32Array {
  const out = new Float32Array(AMB_N);
  let seed = 0x9e3779b9 ^ kind.length;
  const rnd = (): number => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) / 4294967296) * 2 - 1; };
  for (const [fc, gain, low] of AMBIENCE[kind] ?? AMBIENCE.room!) {
    const k = 1 - Math.exp((-2 * Math.PI * fc) / RATE);
    const k2 = 1 - Math.exp((-2 * Math.PI * fc * 1.6) / RATE);
    let y = 0, y2 = 0;
    // run twice round so the loop joins
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < AMB_N; i++) {
      const x = rnd();
      y += k * (x - y); y2 += k2 * (x - y2);
      if (pass === 1) out[i] = out[i]! + (low ? y : y2 - y) * gain * 6;
    }
  }
  return out;
}

let mode = "warm", intensity = 0, ambKind = "room";
const musicClips = new Map<string, AudioClip>();
let jobs: Map<string, Job> = new Map();
let musicVoice: Sound | null = null, musicKeyPlaying = "";
let ambClips = new Map<string, AudioClip>();
let ambVoice: Sound | null = null, ambPlaying = "";
const MUSIC_GAIN = 1, AMB_GAIN = 0.5 / 0.7; // the old ambience bus (0.5) against music (0.7)
export function setMusic(m: string): void { mode = m === "cool" ? "cool" : "warm"; }
export function setIntensity(i: number): void { intensity = Math.max(0, Math.min(2, i)); }
export function setAmbience(kind: string): void { ambKind = AMBIENCE[kind] ? kind : "room"; }
export function setSuspended(on: boolean): void { suspended = on; refreshGains(); }
function refreshGains(): void {
  const off = suspended || muted;
  try { musicVoice?.fade(off ? 0 : MUSIC_GAIN, 0.2); ambVoice?.fade(off ? 0 : AMB_GAIN, 0.2); } catch { /* gone */ }
}

/** Each frame: clips once the mixer runs (one at a time), then the music and ambience beds. */
export function update(): void {
  if (context.state !== "running") return;
  if (wantClips) { wantClips = false; for (const n of SAMPLES) if (!queue.includes(n)) queue.push(n); }
  if (!loading && queue.length) {
    const name = queue.shift()!;
    if (!clips.has(name)) {
      loading = true;
      loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); loading = false; }, (e: unknown) => {
        console.warn(`sfx ${name}: ${e instanceof Error ? e.message : String(e)}`);
        loading = false;
      });
    }
    return;
  }
  if (loading) return;
  // ambience
  if (!ambClips.has(ambKind)) {
    try { ambClips.set(ambKind, createClip([renderAmbience(ambKind)], RATE)); } catch (e) { console.warn(`audio: ${String(e)}`); ambClips = new Map(); }
    return;
  }
  if (ambPlaying !== ambKind) {
    const old = ambVoice;
    try { old?.fade(0, 0.8); } catch { /* gone */ }
    try { ambVoice = playClip(ambClips.get(ambKind)!, { bus: "music", gain: 0, loop: true }); ambVoice.fade(suspended || muted ? 0 : AMB_GAIN, 0.8); } catch { ambVoice = null; }
    ambPlaying = ambKind;
    if (old) setTimeout(() => { try { old.stop(); } catch { /* gone */ } }, 1000);
    return;
  }
  // music
  const key = `${mode}:${intensity}`;
  if (!musicClips.has(key)) {
    let job = jobs.get(key);
    if (!job) { job = { buf: new Float32Array(LOOP_N), notes: musicNotes(mode, intensity), i: 0, done: false }; jobs.set(key, job); }
    step(job, 3);
    if (job.done) {
      try { musicClips.set(key, createClip([job.buf], RATE)); } catch (e) { console.warn(`audio: ${String(e)}`); }
      jobs.delete(key);
    }
    return;
  }
  if (musicKeyPlaying !== key) {
    const old = musicVoice;
    try { old?.fade(0, 0.6); } catch { /* gone */ }
    try { musicVoice = playClip(musicClips.get(key)!, { bus: "music", gain: 0, loop: true }); musicVoice.fade(suspended || muted ? 0 : MUSIC_GAIN, 0.6); } catch { musicVoice = null; }
    musicKeyPlaying = key;
    if (old) setTimeout(() => { try { old.stop(); } catch { /* gone */ } }, 800);
  }
}
