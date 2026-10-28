// Workshop Mayhem on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), played natively by the StarHermit client and in browsers by
// the engine's web runtime. The rules (src/rules: the deterministic verlet
// physics), the content (src/content) and the session controller
// (src/session/session.js: validated commands, undo, replay envelope,
// results, progression and achievements) are the browser build's, unchanged;
// this module is what src/main.js and src/ui/input.js did around them — the
// game flow (title → modes / journey / learn / practice / challenge / daily /
// leaderboards / achievements / workshop style / help / settings / profile →
// countdown → round ⇄ pause → results), the session's events (sounds,
// effects, announcements, captions, lesson steps), the tool tray, the
// placement ghost with its validity and trajectory preview, the virtual cursor
// by keys and pads, pointer/touch place-and-aim and tap-to-trigger, hints,
// undo, fast-forward and restart, and the results with the high-score post.
// Screens are drawn by screens.ts (starhermit:ui), the workshop by render.ts
// (starhermit:scene).
//
// Time is the runtime's fixed steps at the rules' own 120 Hz: an active round
// advances exactly one rules tick (DT = 1/120 s) per fixed step (the browser
// build accumulated requestAnimationFrame time), and the countdown, toasts,
// the hint ghost and the pause before the results run on the same clock, so
// slow frames never change a round and play scripts replay exactly.
import { clipboard, frame, onFixedUpdate, onPreferencesChange, onRender, onResume, onStart, onSuspend, onUpdate, preferences, setFixedRate } from "starhermit:engine";
import { isDown, onAction, onPointerButton, onPointerMove, onTouch, value } from "starhermit:input";
import * as ui from "starhermit:ui";
import { onSessionEnded, requestSignIn } from "starhermit:platform";
import {
  Daily, Engine, Physics, Persistence, Stages, Themes, Tutorials, createSession,
  type GameEvent, type Level, type Results, type Session, type ToolKey, type Progression, type AchievementDoc,
} from "./game.ts";
import * as audio from "./audio.ts";
import { S, T, themeName, achName, captionText, invalidText, levelIntro, levelName, num, reasonText, toolName } from "./i18n.ts";
import * as platform from "./platform.ts";
import { lookFor } from "./quality.ts";
import * as render from "./render.ts";
import { drawScreens } from "./screens.ts";
import { applyTokens, initStyles } from "./style.ts";

export const TOOL_ORDER: ToolKey[] = ["piston", "pad", "fan", "magnet", "weight"];
const DT = Physics.DT;
const HZ = 120;
export type ScreenName = "title" | "modes" | "journey" | "learn" | "practice" | "challenge" | "daily" | "boards" | "achievements" | "cosmetics" | "help" | "settings" | "profile";
export interface Toast { text: string; until: number; kind: "bad" | "info" | "ok" }
export interface ResultsCtx { results: Results; lb: { key: string; vars?: Record<string, string | number> } | null; cmp: { key: string; vars?: Record<string, number>; muted?: boolean } | null }

export const app = {
  /** The full-page menu screen, or null over the playfield. */
  screen: "title" as ScreenName | null,
  overlay: null as "pause" | "results" | null,
  /** "pause" when Settings / Help were opened from the pause panel. */
  returnTo: null as "pause" | null,
  state: "title" as "title" | "menu" | "countdown" | "active" | "paused" | "results",
  openedFrame: 0,
  focusNext: null as string | null,
  session: null as Session | null,
  level: null as Level | null,
  mode: "journey",
  lastRound: null as { level: Level; mode: string; allowUndo: boolean } | null,
  countdown: null as number | null,
  countdownAt: 0,
  resultsAt: null as number | null,
  results: null as ResultsCtx | null,
  selectedTool: null as ToolKey | null,
  cursor: null as { x: number; y: number } | null,
  showCursor: false,
  toasts: [] as Toast[],
  captions: [] as Toast[],
  hintUntil: 0,
  busy: null as string | null,
  practice: { levelId: "j01", difficulty: "normal" as "easy" | "normal" | "hard", undo: true, touched: false },
  boardsTab: "global" as string,
  boardsKey: 0,
  progression: null as Progression | null,
  achievements: null as AchievementDoc | null,
  profileName: "",
};
let clockMs = 0;
export const now = (): number => clockMs / 1000;
export const fresh = (): boolean => frame().frame !== app.openedFrame;
const pending: (() => void)[] = [];
/** A widget's press, run once the frame's UI is built (state changes mid-build would break later widgets). */
export function later(fn: () => void): void { pending.push(fn); }

// ------------------------------------------------------------------ helpers
let announceQueue: string[] = [];
export function announce(text: string): void { if (text) announceQueue.push(text); }
export function sfx(t: string): void { audio.event({ t }, now()); }
export function toast(text: string, kind: Toast["kind"] = "bad"): void {
  app.toasts.push({ text, until: now() + (kind === "bad" ? 2.4 : 3.5), kind });
  while (app.toasts.length > 3) app.toasts.shift();
}
function caption(key: string): void {
  if (!platform.options.captions) return;
  app.captions.push({ text: captionText(key), until: now() + 1.4, kind: "info" });
  while (app.captions.length > 3) app.captions.shift();
}
export function progression(): Progression {
  return (Persistence.loadLocal("progression") as Progression | null) ?? JSON.parse(JSON.stringify(Persistence.DEFAULT_PROGRESSION)) as Progression;
}
export function achievementsDoc(): AchievementDoc {
  return (Persistence.loadLocal("achievements") as AchievementDoc | null) ?? { unlocked: {}, seenTools: [], dailyDays: [], completionsTotal: 0 };
}
export interface Profile { displayName: string; guest: boolean }
export function profile(): Profile {
  return (Persistence.loadLocal("profile") as Profile | null) ?? { ...Persistence.DEFAULT_PROFILE };
}
export function shownName(): string {
  if (platform.signedIn()) return platform.displayName() || T("player");
  const p = profile();
  return p.displayName === "Guest Inventor" ? T("guestName") : p.displayName;
}
export function setDisplayName(name: string): void {
  const p = profile();
  Persistence.saveLocal("profile", { ...p, displayName: (name.trim() || "Guest Inventor").slice(0, 24) });
  announce(T("nameSaved"));
}
export const dailyLevel = (): Level => Daily.dailyLevel(platform.utcDay());

// ------------------------------------------------------------------ routing
/** The control each screen focuses on open (ui.js focused its first control). */
const FIRST: Partial<Record<ScreenName, string>> = {
  title: "btn-play", modes: "mode-journey", journey: "stage-j01", learn: "lesson-t1", practice: "practice-level", challenge: "challenge-c1",
  daily: "btn-daily-start", boards: "tab-global", cosmetics: "theme-brassworks", settings: "btn-options",
};
export function openScreen(name: ScreenName | null): void {
  app.screen = name;
  app.openedFrame = frame().frame;
  ui.setFocus(null);
  app.focusNext = name ? FIRST[name] ?? "btn-back" : null;
}
/** main.js route(): leaving an active round for menus abandons it quietly. */
export function route(name: ScreenName): void {
  sfx(name === "title" ? "ui-back" : "ui-click");
  if (name === "settings" || name === "help") {
    if (app.state === "paused") { app.returnTo = "pause"; app.overlay = null; openScreen(name); return; }
  }
  if (app.session && !app.session.finished && (app.state === "active" || app.state === "paused" || app.state === "countdown")) {
    suppressResults = true;
    app.session.abandon();
  }
  app.returnTo = null;
  app.overlay = null;
  app.resultsAt = null;
  app.results = null;
  app.countdown = null;
  app.selectedTool = null;
  render.hideGhost();
  if (name === "title") { toTitle(); return; }
  app.state = "menu";
  if (name === "boards") app.boardsKey++;
  if (name === "practice" && !app.practice.touched) app.practice.undo = platform.options.undoInPractice;
  openScreen(name);
}
/** Back from Settings / Help: to the pause panel when opened there. */
export function back(): void {
  if (app.returnTo === "pause") {
    app.returnTo = null;
    openScreen(null);
    app.overlay = "pause";
    app.focusNext = "btn-resume";
    sfx("ui-back");
    return;
  }
  route("title");
}
let titleBuilt = false;
export function toTitle(): void {
  app.state = "title";
  app.session = null;
  app.level = null;
  render.rig.retarget("title");
  if (!titleBuilt) {
    titleBuilt = true;
    render.loadLevel(Stages.journeyById("j01")!);
    render.setTheme(platform.options.lastTheme, platform.options.palette);
    render.rig.retarget("title");
  }
  audio.setMusic("warm");
  audio.setAmbience(Themes.themeById(platform.options.lastTheme).ambience);
  audio.setIntensity(0);
  openScreen("title");
  app.focusNext = "btn-play";
}

// ------------------------------------------------------------------ round lifecycle
let suppressResults = false;
export function startStage(levelId: string, mode: string): void {
  const level = Stages.journeyById(levelId) || Tutorials.tutorialById(levelId);
  if (level) beginRound(level, mode, mode === "learn" || mode === "practice");
}
export function startPractice(): void {
  const base = Stages.journeyById(app.practice.levelId);
  if (base) beginRound(practiceVariant(base, app.practice.difficulty), "practice", app.practice.undo);
}
export function startDaily(): void { beginRound(dailyLevel(), "daily", false); }
export function retryStage(): void {
  const last = app.lastRound;
  if (last) beginRound(last.level, last.mode, last.allowUndo);
}
export function nextStage(r: Results): void {
  const m = /^j(\d+)$/.exec(r.levelId);
  if (m) {
    const next = Stages.journeyById(`j${String(parseInt(m[1]!, 10) + 1).padStart(2, "0")}`);
    if (next) { beginRound(next, "journey", false); return; }
    route("journey"); return;
  }
  if (r.mode === "learn") {
    const idx = Tutorials.TUTORIALS.findIndex((t) => t.id === r.levelId);
    const next = Tutorials.TUTORIALS[idx + 1];
    if (next) { beginRound(next, "learn", true); return; }
    route("journey"); return;
  }
  if (r.mode === "challenge") {
    const idx = Number((r.levelId || "c1").slice(1)) | 0;
    const next = Stages.journeyById(`c${idx + 1}`);
    if (next) { beginRound(next, "challenge", false); return; }
    route("challenge"); return;
  }
  route("title");
}
export function nextLabel(r: Results): string {
  const m = /^j(\d+)$/.exec(r.levelId);
  if (m && parseInt(m[1]!, 10) < 40) return T("nextStage");
  if (r.mode === "learn") return T("nextLesson");
  return T("keepGoing");
}
function practiceVariant(level: Level, difficulty: string): Level {
  if (difficulty === "normal") return level;
  const tools = { ...level.tools };
  for (const k of Object.keys(tools) as ToolKey[]) {
    const n = tools[k] ?? 0;
    if (difficulty === "easy" && n > 0) tools[k] = n + 1;
    if (difficulty === "hard" && n > 1) tools[k] = n - 1;
  }
  return { ...level, tools, name: `${level.name} (${difficulty})`, id: `${level.id}-practice-${difficulty}` };
}
const session: Session = createSession((ev) => onSessionEvent(ev), platform.sessionPlatform);
let timerWarned = false;
function beginRound(level: Level, mode: string, allowUndo: boolean): void {
  app.lastRound = { level, mode, allowUndo };
  app.overlay = null;
  app.returnTo = null;
  app.results = null;
  app.resultsAt = null;
  suppressResults = false;
  app.level = level;
  app.mode = mode;
  render.loadLevel(level);
  session.start(level, { mode, allowUndo });
  app.session = session;
  deselect();
  app.cursor = null;
  app.showCursor = false;
  timerWarned = false;
  openScreen(null);
  sfx("round-start");
  const th = Themes.themeById(level.theme);
  audio.setMusic(th.music);
  audio.setAmbience(th.ambience);
  audio.setIntensity(1);
  announce(`${levelName(level)}. ${levelIntro(level)}`);
  if (mode === "learn" && level.tutorial) session.tutorialStep = 0;
  app.state = "countdown";
  app.countdown = 3;
  app.countdownAt = clockMs + 700;
}
export function pauseGame(): void {
  if (app.state !== "active") return;
  app.state = "paused";
  session.setPaused(true);
  cancelInput();
  app.overlay = "pause";
  app.openedFrame = frame().frame;
  app.focusNext = "btn-resume";
  sfx("pause");
  announce(T("paused"));
  audio.setSuspended(false);
}
export function resumeGame(): void {
  if (app.state !== "paused") return;
  app.overlay = null;
  session.setPaused(false);
  app.state = "active";
  app.openedFrame = frame().frame;
  ui.setFocus(null);
  sfx("resume");
  announce(T("resumed"));
}
export function restartRound(): void {
  if (!app.session) return;
  if (app.state === "paused") { app.overlay = null; session.setPaused(false); app.state = "active"; }
  session.restart();
  render.resetTools();
  render.clearFx();
  deselect();
  timerWarned = false;
}
export function leaveRound(): void {
  app.overlay = null;
  session.setPaused(false);
  session.abandon();
}

// ------------------------------------------------------------------ actions (main.js onHudAction / input.js)
const inputOn = (): boolean => app.state === "active" && !!app.session?.state && app.screen === null && app.overlay === null;
export function selectTool(tool: ToolKey): void {
  if (!inputOn()) return;
  if (app.selectedTool === tool) { deselect(); sfx("ui-drop"); return; }
  const legal = session.legal;
  const pl = legal?.placements.find((p) => p.tool === tool);
  if (!pl) { announce(T("outOfStock", { tool: toolName(tool) })); return; }
  app.selectedTool = tool;
  sfx("select");
  render.showGhost(tool);
  render.setMountHighlight(Engine.TOOLS[tool].placement === "mount", pl.mounts);
  if (!app.cursor) { const dc = session.dummyCenter; app.cursor = { x: dc.x + 1, y: Math.max(0.4, dc.y + 0.5) }; }
  session.tutorialUi("select-tool", { tool });
  updateGhost(hoverPt ?? app.cursor);
}
export function deselect(): void {
  app.selectedTool = null;
  render.hideGhost();
  render.setMountHighlight(false);
  lastCheck = null;
}
function cancelInput(): void { deselect(); drag = null; app.showCursor = false; }
export function cycleTool(dir: number): void {
  const st = session.state;
  const avail = TOOL_ORDER.filter((t) => (st?.stock[t] ?? 0) > 0);
  if (!avail.length) return;
  const cur = app.selectedTool ? avail.indexOf(app.selectedTool) : -1;
  selectTool(avail[(cur + dir + avail.length) % avail.length]!);
}
export function triggerFirst(): void {
  if (!inputOn()) return;
  const first = session.legal?.triggers[0];
  if (first) session.trigger(first.toolId);
}
export function triggerTool(id: number): void { if (inputOn()) session.trigger(id); }
export function doSkip(): void {
  if (!inputOn()) return;
  // a fast-forward runs up to 3600 rules ticks at once (~0.4 s natively): say so first, run it next frame
  app.busy = T("fastForwarding");
  skipPending = 2;
}
let skipPending = 0;
function runSkip(): void {
  app.busy = null;
  if (!inputOn()) return;
  const r = session.skip();
  if (!r.accepted) showInvalid(r.reason ?? "nothing-to-skip");
  else sfx("skip");
}
export function doUndo(): void {
  if (!inputOn()) return;
  const r = session.undo();
  if (!r.accepted) showInvalid(r.reason ?? "no-undo");
  else { render.resetTools(); deselect(); }
}
export function showHint(): void {
  if (!inputOn()) return;
  const h = session.hint();
  if (!h) { announce(T("noHints")); toast(T("noHints"), "info"); return; }
  sfx("hint");
  caption("hint");
  const text = h.kind === "place"
    ? T("hintPlace", { tool: toolName(h.tool!), x: num(h.x, 1), y: num(h.y, 1) })
    : T("hintTrigger", { tool: toolName(h.type!) });
  announce(text);
  toast(text, "info");
  if (h.kind === "place" && h.tool) {
    render.showGhost(h.tool);
    render.setGhostPose({ x: h.x, y: h.y }, Math.atan2(h.dy ?? 0, h.dx ?? 1), true);
    app.hintUntil = clockMs + 3200;
  }
}
export function cameraReset(): void { render.rig.snapToGameplay(); }
export function toggleMute(): void {
  platform.setOption("muted", !platform.options.muted);
  announce(T(platform.options.muted ? "muted" : "soundOn"));
  toast(T(platform.options.muted ? "muted" : "soundOn"), "info");
}
function showInvalid(reason: string): void {
  const text = invalidText(reason);
  announce(text);
  toast(text, "bad");
}

// ------------------------------------------------------------------ ghost, placement and the cursor (input.js)
let lastCheck: { ok: boolean; x?: number; y?: number; angle: number; mountId: string | null; dx?: number; dy?: number } | null = null;
let previewKey = "", previewAt = 0, previewWant: { key: string; cmd: Record<string, unknown> } | null = null;
export function updateGhost(pt: { x: number; y: number }, dragPt: { x: number; y: number } | null = null): void {
  const st = session.state;
  const tool = app.selectedTool;
  if (!tool || !st) return;
  const def = Engine.TOOLS[tool];
  let placePt = pt, mountId: string | null = null, angle = 0;
  if (def.placement === "mount") {
    const mount = render.nearestMount(dragPt ?? pt, 1.4);
    mountId = mount?.id ?? session.legal?.placements.find((p) => p.tool === tool)?.mounts?.[0] ?? null;
    const mv = render.mountViews().find((v) => v.id === mountId);
    if (mv) placePt = { x: mv.x, y: mv.y };
    const aim = dragPt ?? session.dummyCenter;
    angle = Math.atan2(aim.y - placePt.y, aim.x - placePt.x);
  } else if (def.placement !== "ground") {
    angle = dragPt ? Math.atan2(dragPt.y - pt.y, dragPt.x - pt.x) : Math.atan2(0.1, 1);
  }
  const check = Engine.explainPlacement(st, tool, placePt.x, placePt.y, mountId);
  render.setGhostPose(check.ok ? { x: check.x!, y: check.y! } : placePt, angle, check.ok);
  if (tool === "piston" && check.ok) {
    const cmd = { type: "place", tool, x: check.x, y: check.y, dx: Math.cos(angle), dy: Math.sin(angle), mountId };
    previewWant = { key: [check.x, check.y, angle.toFixed(3), mountId, st.tick].join("|"), cmd };
  } else { previewWant = null; previewKey = ""; render.setTrajectory(null); }
  lastCheck = { ok: check.ok, ...(check.ok ? { x: check.x!, y: check.y! } : {}), angle, mountId };
  app.cursor = { x: placePt.x, y: placePt.y };
}
/** The piston's trajectory preview (~35 ms natively): at most every 0.1 s of play time, only when the aim changed. */
function runPreview(): void {
  if (!previewWant || previewWant.key === previewKey || clockMs - previewAt < 100 || !session.state) return;
  previewKey = previewWant.key;
  previewAt = clockMs;
  render.setTrajectory(render.previewTrajectory(session.state, previewWant.cmd));
}
function commitPlacement(startPt: { x: number; y: number }, endPt: { x: number; y: number }, wasDrag: boolean): void {
  const tool = app.selectedTool, st = session.state;
  if (!tool || !st) return;
  const def = Engine.TOOLS[tool];
  const chk = lastCheck ?? { ok: false, angle: 0, mountId: null };
  let dx = 1, dy = 0.1;
  if (def.placement === "mount") {
    const aim = wasDrag ? endPt : session.dummyCenter;
    const from = chk.ok ? { x: chk.x!, y: chk.y! } : startPt;
    const ax = aim.x - from.x, ay = aim.y - from.y, al = Math.hypot(ax, ay) || 1;
    dx = ax / al; dy = ay / al;
  } else if (!def.passive && wasDrag) {
    const ax = endPt.x - startPt.x, ay = endPt.y - startPt.y, al = Math.hypot(ax, ay);
    if (al > 0.2) { dx = ax / al; dy = ay / al; }
  }
  if (wasDrag || def.placement === "mount") session.tutorialUi("aim");
  const r = session.place(tool, startPt.x, startPt.y, dx, dy, chk.mountId ?? null);
  if (r.accepted) {
    render.setTrajectory(null);
    previewKey = "";
    if ((session.state?.stock[tool] ?? 0) <= 0) deselect();
    else updateGhost(endPt);
  } else render.setGhostPose(startPt, 0, false);
}
export function moveCursor(dxs: number, dys: number, fine: boolean): void {
  if (!app.cursor) { const dc = session.dummyCenter; app.cursor = { x: dc.x, y: dc.y + 0.5 }; }
  const step = fine ? 0.25 / 3 : 0.25;
  app.cursor = { x: app.cursor.x + dxs * step, y: app.cursor.y + dys * step };
  app.showCursor = true;
  hoverPt = null;
  updateGhost(app.cursor);
}
export function keyConfirm(): void {
  if (!inputOn() || !app.selectedTool) return;
  const pt = app.cursor ?? session.dummyCenter;
  updateGhost(pt);
  commitPlacement(pt, pt, false);
}
function keyCancel(): void {
  if (app.selectedTool) { deselect(); sfx("ui-drop"); }
  else pauseGame();
}

// ------------------------------------------------------------------ keys and pads
const CURSOR: Record<string, [number, number]> = { cursor_up: [0, 1], cursor_down: [0, -1], cursor_left: [-1, 0], cursor_right: [1, 0] };
const held: Record<string, { at: number; gamepad: boolean }> = {};
onAction((e) => {
  const a = e.action;
  if (!e.pressed) { delete held[a]; return; }
  if (ui.capturingKeys()) return;
  if (app.overlay === "pause") {
    if ((a === "cancel" || a === "pause") && fresh()) later(resumeGame);
    return;
  }
  if (app.overlay || app.screen) {
    if (a === "cancel" && fresh() && app.screen && app.screen !== "title") later(back);
    return;
  }
  if (app.state !== "active") return;
  const tm = /^tool([1-5])$/.exec(a);
  if (tm) {
    const idx = Number(tm[1]) - 1;
    const st = session.state;
    const tool = TOOL_ORDER.filter((t) => (st?.stock[t] ?? 0) > 0)[idx] ?? TOOL_ORDER[idx];
    if (tool) later(() => selectTool(tool));
    return;
  }
  if (CURSOR[a]) {
    if (!app.selectedTool) return;
    ui.setFocus(null);
    const [x, y] = CURSOR[a]!;
    held[a] = { at: clockMs, gamepad: e.source === "gamepad" };
    if (e.source !== "gamepad") moveCursor(x, y, isDown("fine"));
    return;
  }
  switch (a) {
    case "confirm": if (ui.focused() === null) later(keyConfirm); break;
    case "trigger": if (ui.focused() === null) later(triggerFirst); break;
    case "cancel": if (fresh()) later(keyCancel); break;
    case "pause": if (fresh()) later(pauseGame); break;
    case "undo": later(doUndo); break;
    case "hint": later(showHint); break;
    case "restart": later(restartRound); break;
    case "skip": later(doSkip); break;
    case "camera": cameraReset(); break;
    case "mute": toggleMute(); break;
    case "tool_prev": later(() => cycleTool(-1)); break;
    case "tool_next": later(() => cycleTool(1)); break;
  }
});
/** Held cursor keys repeat (the OS key repeat the browser build relied on); pad sticks move it smoothly. */
function cursorRepeat(): void {
  if (!inputOn() || !app.selectedTool) return;
  let gx = 0, gy = 0;
  for (const [a, h] of Object.entries(held)) {
    const d = CURSOR[a];
    if (!d) continue;
    if (h.gamepad) {
      const v = Math.min(1, Math.max(0, value(a)));
      gx += d[0] * v; gy += d[1] * v;
    } else if (clockMs - h.at > 400 && Math.floor((clockMs - h.at) / (1000 / HZ)) % 4 === 0) moveCursor(d[0], d[1], isDown("fine"));
  }
  if (gx || gy) {
    const c = app.cursor ?? session.dummyCenter;
    app.cursor = { x: c.x + gx * DT * 4, y: c.y + gy * DT * 4 };
    app.showCursor = true;
    updateGhost(app.cursor);
  }
}

// ------------------------------------------------------------------ pointer and touch on the playfield
let drag: { startPt: { x: number; y: number }; px: number; py: number; aiming: boolean } | null = null;
let hoverPt: { x: number; y: number } | null = null;
let lastTouch = -1e9;
const queue: { kind: "down" | "move" | "up"; x: number; y: number; captured: boolean }[] = [];
onTouch((e) => {
  lastTouch = now();
  if (e.control) return;
  const kind = e.phase === "start" ? "down" : e.phase === "move" ? "move" : "up";
  queue.push({ kind, x: e.x, y: e.y, captured: ui.pointerCaptured() });
});
onPointerButton((e) => {
  if (e.button !== 0 || now() - lastTouch < 0.6) return;
  queue.push({ kind: e.pressed ? "down" : "up", x: e.x, y: e.y, captured: ui.pointerCaptured() });
});
onPointerMove((x, y) => { if (now() - lastTouch >= 0.6) queue.push({ kind: "move", x, y, captured: false }); });
const toWorld = (x: number, y: number): { x: number; y: number } | null => render.screenToWorld(x, y, frame().width, frame().height);
function pointerInput(wasActive: boolean): void {
  const list = queue.splice(0);
  if (!wasActive || !inputOn()) { drag = null; return; }
  for (const p of list) {
    if (p.kind === "down") {
      if (p.captured || ui.pointerOver()) continue;
      const pt = toWorld(p.x, p.y);
      if (!pt) continue;
      ui.setFocus(null);
      drag = { startPt: pt, px: p.x, py: p.y, aiming: false };
      if (app.selectedTool) sfx("ui-drag-start");
    } else if (p.kind === "move") {
      const pt = toWorld(p.x, p.y);
      if (!pt) continue;
      if (drag && app.selectedTool) {
        if (Math.hypot(p.x - drag.px, p.y - drag.py) > 10 * frame().scale) drag.aiming = true;
        updateGhost(drag.startPt, pt);
      } else if (!drag && app.selectedTool && !ui.pointerOver()) { hoverPt = pt; app.showCursor = false; updateGhost(pt); }
    } else if (drag) {
      const d = drag;
      drag = null;
      const pt = toWorld(p.x, p.y) ?? d.startPt;
      if (app.selectedTool) commitPlacement(d.startPt, pt, d.aiming);
      else {
        // a tap on an armed tool triggers it
        const st = session.state!;
        let best: { id: number; status: string } | null = null, bd = 0.65;
        for (const t of st.tools) {
          if (t.type === "pad") continue;
          const dd = Math.hypot(t.x - pt.x, t.y - pt.y);
          if (dd < bd) { bd = dd; best = t; }
        }
        if (best && best.status === "armed") session.trigger(best.id);
      }
    }
  }
}

// ------------------------------------------------------------------ session events (main.js onSessionEvent)
function onSessionEvent(ev: GameEvent): void {
  audio.event(ev, now());
  if (ev.t === "place") caption("place");
  if (ev.t === "trigger") caption("trigger");
  if (ev.t === "boing") caption("boing");
  if (ev.t === "bell") caption(ev.done ? "bellRung" : "bellTapped");
  if (ev.t === "goal") caption("goal");
  render.handleEvent(ev, session.state ? session.dummyCenter : null);
  switch (ev.t) {
    case "invalid": showInvalid(String(ev.reason)); break;
    case "goal": announce(T("goalComplete")); break;
    case "tutorial-step": {
      const lvl = session.level!;
      const idx = Number(ev.index);
      if (idx >= (lvl.tutorial?.steps.length ?? 0) && !platform.options.tutorialDone.includes(lvl.id)) {
        platform.setOption("tutorialDone", [...platform.options.tutorialDone, lvl.id]);
      }
      break;
    }
    case "results": showResults(ev.results as Results); break;
    case "terminal": audio.setIntensity(ev.reason === "goal-complete" ? 2 : 0); break;
  }
}
function showResults(r: Results): void {
  if (suppressResults) { suppressResults = false; session.finished = null; return; }
  if (app.state === "countdown") return;
  app.state = "results";
  cancelInput();
  for (const a of r.newAchievements ?? []) {
    announce(T("achUnlocked", { name: achName(a.key) }));
    audio.event({ t: "achievement", key: a.key }, now());
    caption("achievement");
  }
  if (r.newRecord) { announce(T("newRecord")); sfx("new-record"); caption("record"); }
  announce(r.score.primaryComplete ? T("resultsWin", { points: r.score.total, stars: r.stars }) : T("resultsLose", { reason: reasonText(r.reason), points: r.score.total }));
  app.results = { results: r, lb: null, cmp: null };
  app.resultsAt = clockMs + 700;
  postToLeaderboard(app.results);
}
/** app.js postToLeaderboard: completed Journey / Daily / Challenge rounds post their total when signed in, then compare. */
function postToLeaderboard(ctx: ResultsCtx): void {
  const r = ctx.results;
  const ranked = ["daily", "journey", "challenge"].includes(r.mode) && r.score.primaryComplete;
  if (!platform.signedIn() || !ranked) { void loadComparison(ctx); return; }
  ctx.lb = { key: "lbPosting" };
  void platform.postScore(r.score.total).then((res) => {
    ctx.lb = !res.posted ? { key: "lbNotPosted" } : res.rank ? { key: "lbRank", vars: { rank: res.rank } } : { key: "lbPosted" };
    void loadComparison(ctx);
  });
}
async function loadComparison(ctx: ResultsCtx): Promise<void> {
  const r = ctx.results;
  if (!r.score.primaryComplete) return;
  const board = r.mode === "daily" ? `daily-${dailyLevel().daily?.day}` : "global";
  let rows: { score: number }[] = [];
  let casual = true;
  if (board === "global" && platform.signedIn()) {
    const h = await platform.hostedBoard(false);
    if (h) { rows = h; casual = false; }
  }
  if (casual) rows = platform.localBoard(board);
  if (!rows.length) ctx.cmp = { key: "firstScore", muted: true };
  else {
    const better = rows.filter((row) => row.score > r.score.total).length;
    ctx.cmp = better === 0 ? { key: "topOfBoard" } : { key: casual ? "beatsCasual" : "beats", vars: { n: rows.length - better, total: rows.length } };
  }
}
export function resultsLine(ctx: ResultsCtx): string | null { return ctx.lb ? S(ctx.lb.key, ctx.lb.vars) : null; }
export function signIn(): void { void requestSignIn().catch(() => undefined); }
export function copyInvite(): void {
  const link = platform.inviteLink();
  if (!link) return;
  try { clipboard.writeText(link); toast(S("inviteCopied"), "info"); } catch { toast(S("inviteFailed", { link }), "info"); }
}
export function setTheme(id: string): void {
  platform.setOption("lastTheme", id);
  const p = progression();
  p.cosmetics = { ...p.cosmetics, theme: id };
  Persistence.saveLocal("progression", p);
  render.setTheme(id, platform.options.palette);
  announce(T("themeApplied", { name: themeName(id) }));
}
export function replayTutorials(): void { platform.setOption("tutorialDone", []); route("learn"); }

// ------------------------------------------------------------------ the clock
let hidden = false;
onFixedUpdate(() => {
  if (hidden) return;
  clockMs += 1000 / HZ;
  if (app.state === "countdown" && app.countdown !== null && clockMs >= app.countdownAt) {
    app.countdown--;
    if (app.countdown < 0) {
      app.countdown = null;
      app.state = "active";
      announce(T("go"));
    } else {
      sfx("ui-countdown-tick");
      app.countdownAt = clockMs + 700;
    }
  }
  if (app.state === "active" && app.session && !session.paused && !session.finished) {
    session.advance(DT);
    session.interpAlpha = 0;
    const s = session.state;
    if (s && !timerWarned && !session.finished) {
      const remaining = s.options.maxTicks - s.tick;
      if (remaining > 0 && remaining <= 10 * 120) { timerWarned = true; sfx("ui-timer-warning"); }
    }
    cursorRepeat();
  }
  if (app.hintUntil && clockMs >= app.hintUntil) {
    app.hintUntil = 0;
    if (!app.selectedTool) render.hideGhost();
  }
  if (app.resultsAt !== null && clockMs >= app.resultsAt) {
    app.resultsAt = null;
    if (app.state === "results") {
      app.overlay = "results";
      app.openedFrame = frame().frame;
      app.focusNext = "btn-next";
      sfx("ui-modal-open");
    }
  }
});

// ------------------------------------------------------------------ boot and lifecycle
let lookKey = "";
function applyLook(): void {
  const f = frame();
  const k = `${f.quality}:${f.levelIndex}`;
  if (k === lookKey) return;
  lookKey = k;
  render.applyLook(lookFor(f.quality, f.levelIndex));
}
function applyOptions(): void {
  render.setTheme(app.level?.theme ?? platform.options.lastTheme, platform.options.palette);
  audio.setMuted(platform.options.muted);
}
onStart(() => {
  setFixedRate(HZ);
  initStyles();
  platform.initPlatform();
  render.init();
  render.setReducedMotion(preferences().reducedMotion);
  applyLook();
  audio.loadSfx();
  applyOptions();
  toTitle();
});
onPreferencesChange((p) => render.setReducedMotion(p.reducedMotion));
platform.onOptionsChange(() => applyOptions());
platform.onProgressMerged(() => { toast(T("progressMerged"), "info"); });
onSessionEnded(() => toast(S("signedOut"), "info"));
onSuspend(() => {
  hidden = true;
  if (app.state === "active") pauseGame();
  audio.setSuspended(true);
  platform.flush();
});
onResume(() => { hidden = false; audio.setSuspended(false); });

let frameDt = 0;
onUpdate((dt) => {
  frameDt = Math.min(dt, 1 / 20);
  applyLook();
  applyTokens(ui.preferences().highContrast);
  audio.update();
  const t = now();
  app.toasts = app.toasts.filter((x) => x.until >= t);
  app.captions = app.captions.filter((x) => x.until >= t);
  if (skipPending > 0 && --skipPending === 0) runSkip();
});
onRender((interp) => {
  const f = frame();
  const wasActive = inputOn();
  if (app.session && app.state === "active") session.interpAlpha = Math.max(0, Math.min(1, interp));
  else if (app.session) session.interpAlpha = 1;
  render.update(frameDt, f.width, f.height, app.session);
  drawScreens();
  for (const fn of pending.splice(0)) fn();
  pointerInput(wasActive);
  runPreview();
  if (announceQueue.length) {
    const text = announceQueue.slice(-3).join(" ");
    announceQueue = [];
    try { ui.announce(text.slice(0, 500), { politeness: "polite" }); } catch { /* busy */ }
  }
});
