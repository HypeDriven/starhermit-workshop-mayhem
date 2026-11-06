// Sound, as the browser build's src/audio/audio.js: the recorded one-shots
// (sfx/*.opus) per game event (AudioSystem.sampleFor), the quiet workshop
// ambience per theme (filtered noise loops) and the adaptive music (a bass +
// arpeggio pattern in the theme's "warm" or "cool" scale whose density follows
// the intensity: 0 menus, 1 a round, 2 the celebration). The browser build ran
// ambience and music live; here each renders once through an
// OfflineAudioContext into a clip and loops on the music bus (the runtime has
// no ambience bus), with intensity changes as cross-fades; the ambience's slow
// swell is left out (a steady bed). Its voice bus (UI blips) is the interface
// bus. The oscillator fallbacks for a sample still decoding are not ported (a
// clip still loading is silent). The runtime's Options own the volumes and the
// player's mute; M toggles the game's own mute (as the old M key did). Clips
// load at the start; the beds start once the mixer runs (in a browser after the
// first press).
import { OfflineAudioContext, context, createClip, loadClip, play as playClip, setMuted as setGameMuted, type AudioClip, type Bus, type Sound } from "starhermit:audio";

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
let suspended = false;
let lastImpact = -1;
/** Loads every clip at once (onStart); a cue whose clip is still loading is skipped. */
export function loadSfx(): void {
  for (const name of SAMPLES) {
    loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); }, (e: unknown) => {
      console.warn(`sfx ${name}: ${e instanceof Error ? e.message : String(e)}`);
    });
  }
}
export function setMuted(on: boolean): void { setGameMuted(on); }
export function event(ev: { t: string; [k: string]: unknown }, nowS = 0): void {
  if (suspended) return;
  const name = sampleFor(ev);
  if (!name) return;
  if (ev.t === "impact") { if (nowS - lastImpact < 0.06) return; lastImpact = nowS; }
  const clip = clips.get(name);
  if (!clip) return;
  const bus: Bus = UI.has(name) ? "interface" : "effects";
  try { playClip(clip, { bus }); } catch { /* the mixer is full this frame: skip it */ }
}

// -- music and ambience --------------------------------------------------------------------------
const RATE = 22050;
const TICK = 0.24, STEPS = 32;
const LOOP_N = Math.round(RATE * TICK * STEPS);
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
/** One intensity's loop; each note with audio.js env(): 5 ms rise, exponential fall to 0.0001 over its length. Every note ends inside the loop. */
async function renderMusic(m: string, i: number): Promise<AudioClip> {
  const off = new OfflineAudioContext(1, LOOP_N, RATE);
  for (const [t, f, dur, peak, tri] of musicNotes(m, i)) {
    const osc = off.createOscillator();
    osc.type = tri ? "triangle" : "sine";
    osc.frequency.value = f;
    const g = off.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.005 + dur);
    osc.connect(g).connect(off.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
  return createClip(await off.startRendering());
}
const BAND = 0.345; // a biquad bandpass passes about 9 dB more than the old difference of two one-poles (measured rms per stem)
/** audio.js startAmbience: filtered noise per kind ([cutoff Hz, gain, lowpass?, make-up to the old one-pole stem's measured rms]). */
const AMBIENCE: Record<string, [number, number, boolean, number][]> = {
  room: [[140, 0.012, true, 1], [800, 0.004, false, BAND]], garden: [[140, 0.012, true, 1], [800, 0.004, false, BAND]],
  water: [[300, 0.014, false, BAND]], forge: [[90, 0.02, true, 1], [1400, 0.004, false, BAND]], night: [[500, 0.007, false, BAND]],
};
const AMB_N = RATE * 4;
/** A seamless loop: filtered periodic noise is periodic once settled, so it needs no crossfade. */
async function renderAmbience(kind: string): Promise<AudioClip> {
  const settle = Math.round(0.5 * RATE);
  const off = new OfflineAudioContext(1, settle + AMB_N, RATE);
  (AMBIENCE[kind] ?? AMBIENCE.room!).forEach(([fc, gain, low, makeup], i) => {
    const noise = off.createNoise({ seed: 0x9e37 + i, seconds: 4 });
    const f = off.createBiquadFilter();
    f.type = low ? "lowpass" : "bandpass";
    f.frequency.value = low ? fc : fc * 1.265; // the old high stem: between the cutoff and 1.6 times it
    const g = off.createGain();
    g.gain.value = gain * 6 * makeup;
    noise.connect(f).connect(g).connect(off.destination);
    noise.start();
  });
  const r = await off.startRendering();
  return createClip([r.getChannelData(0).slice(settle)], RATE);
}

let mode = "warm", intensity = 0, ambKind = "room";
const musicClips = new Map<string, AudioClip>();
let musicVoice: Sound | null = null, musicKeyPlaying = "";
const ambClips = new Map<string, AudioClip>();
const rendering = new Set<string>();
let ambVoice: Sound | null = null, ambPlaying = "";
const MUSIC_GAIN = 1, AMB_GAIN = 0.5 / 0.7; // the old ambience bus (0.5) against music (0.7)
export function setMusic(m: string): void { mode = m === "cool" ? "cool" : "warm"; }
export function setIntensity(i: number): void { intensity = Math.max(0, Math.min(2, i)); }
export function setAmbience(kind: string): void { ambKind = AMBIENCE[kind] ? kind : "room"; }
export function setSuspended(on: boolean): void { suspended = on; refreshGains(); }
function refreshGains(): void {
  try { musicVoice?.fade(suspended ? 0 : MUSIC_GAIN, 0.2); ambVoice?.fade(suspended ? 0 : AMB_GAIN, 0.2); } catch { /* gone */ }
}
/** Renders a bed once, in the background; a failure leaves it silent. */
function need(id: string, into: Map<string, AudioClip>, key: string, render: () => Promise<AudioClip>): void {
  if (into.has(key) || rendering.has(id)) return;
  rendering.add(id);
  render().then((c) => { into.set(key, c); rendering.delete(id); }, (e: unknown) => { console.warn(`audio: ${String(e)}`); });
}

/** Each frame: the beds this moment wants, rendered if new, cross-faded in once the mixer runs. */
export function update(): void {
  const key = `${mode}:${intensity}`;
  const kind = ambKind, m = mode, i = intensity;
  need(`a:${kind}`, ambClips, kind, () => renderAmbience(kind));
  need(`m:${key}`, musicClips, key, () => renderMusic(m, i));
  if (context.state !== "running") return;
  const amb = ambClips.get(kind);
  if (amb && ambPlaying !== kind) {
    const old = ambVoice;
    try { old?.fade(0, 0.8); } catch { /* gone */ }
    try { ambVoice = playClip(amb, { bus: "music", gain: 0, loop: true }); ambVoice.fade(suspended ? 0 : AMB_GAIN, 0.8); } catch { ambVoice = null; }
    ambPlaying = kind;
    if (old) setTimeout(() => { try { old.stop(); } catch { /* gone */ } }, 1000);
  }
  const music = musicClips.get(key);
  if (music && musicKeyPlaying !== key) {
    const old = musicVoice;
    try { old?.fade(0, 0.6); } catch { /* gone */ }
    try { musicVoice = playClip(music, { bus: "music", gain: 0, loop: true }); musicVoice.fade(suspended ? 0 : MUSIC_GAIN, 0.6); } catch { musicVoice = null; }
    musicKeyPlaying = key;
    if (old) setTimeout(() => { try { old.stop(); } catch { /* gone */ } }, 800);
  }
}
