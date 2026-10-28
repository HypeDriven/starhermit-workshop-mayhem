// The game's data and the StarHermit platform, on the runtime's modules (what
// src/platform/client.js and persistence.js did over the JS SDK and
// localStorage):
// - the session controller and persistence.js keep reading and writing
//   `localStorage`: here a shim. Its progression and achievements documents
//   are the game's save (starhermit:storage `saves`, schema 1:
//   { v, progression, achievements }, on the device and in the player's cloud
//   slot); two devices' saves merge on a conflict (src/session/cloud.js
//   mergeSaves: best stars, scores and XP, every unlock). The slot the browser
//   build wrote through the JS SDK (game:<slug>, { kind: 'progression', doc })
//   shows as foreign: it is merged in and replaced once. The browser build
//   kept achievements on the device only; they now travel with the save. The
//   guest profile and the local score records stay on the device (`storage`);
// - the game's own settings (colour palette, captions, left-handed HUD, undo in
//   practice, the theme, finished lessons, the game-sound mute) are engine
//   `settings` (synced with the account); the browser build's values in the
//   account's settings KV are adopted (unless set here since), then its keys
//   are removed (volumes, mute, graphics, reduced motion, contrast and larger
//   text are the runtime's Options now);
// - the player, the invite link, the platform's clock for the Daily, posting a
//   completed Journey, Daily or Challenge round's total through score-script.js
//   (a practice session whose socket carries { type: 'result', scores }, as
//   the JS SDK's submitScores did) with the rank, and the high-score board's
//   entries for Leaderboards (read-only).
import type { JsonValue } from "starhermit:engine";
import {
  connectGame, inviteLink as fetchInviteLink, leaderboards, onPlayerChange, player, serverNow, serverTime, sessions, type Leaderboard,
} from "starhermit:platform";
import { saves, settings as store, storage } from "starhermit:storage";
import * as Cloud from "../src/session/cloud.js";

type SaveDoc = { v: number; progression: unknown; achievements: unknown };
const C = Cloud as unknown as {
  emptySave(): SaveDoc; normalizeSave(raw: unknown): SaveDoc; mergeSaves(local: unknown, remote: unknown): SaveDoc;
  sameSave(a: unknown, b: unknown): boolean; readForeign(text: string): SaveDoc | null;
};

// --- the save and the localStorage shim -------------------------------------------------------
const PREFIX = "workshop-mayhem:";
const CLOUD: Record<string, "progression" | "achievements"> = { [`${PREFIX}progression`]: "progression", [`${PREFIX}achievements`]: "achievements" };
let doc: SaveDoc = C.emptySave();
let lastSavedAt = 0;
const mergedListeners = new Set<() => void>();
/** fn() after progress from the account (another device, the browser build) was merged in. */
export function onProgressMerged(fn: () => void): void { mergedListeners.add(fn); }
function merged(): void { for (const fn of mergedListeners) fn(); }

function write(opts: { replaceForeign?: boolean } = {}): void {
  try {
    saves.save(doc as unknown as JsonValue, { schema: 1, ...opts });
    lastSavedAt = saves.load()?.savedAt ?? lastSavedAt;
  } catch (e) { console.warn(`save: ${String(e)}`); }
}
const shim = {
  getItem(key: string): string | null {
    const part = CLOUD[key];
    if (part) return doc[part] ? JSON.stringify(doc[part]) : null;
    try { return storage.getText(key); } catch { return null; }
  },
  setItem(key: string, value: string): void {
    const part = CLOUD[key];
    if (part) {
      try { doc[part] = JSON.parse(value); } catch { return; }
      write();
      return;
    }
    try { storage.set(key, String(value)); } catch (e) { console.warn(`storage ${key}: ${String(e)}`); }
  },
  removeItem(key: string): void {
    const part = CLOUD[key];
    if (part) { doc[part] = null; write(); return; }
    try { storage.remove(key); } catch { /* gone */ }
  },
};
(globalThis as unknown as { localStorage: typeof shim }).localStorage = shim;

function adopt(other: unknown): boolean {
  const next = C.mergeSaves(doc, other);
  if (C.sameSave(next, doc)) return false;
  doc = next;
  write();
  return true;
}
saves.onConflict((mine, remote) => ({ merged: C.mergeSaves(mine?.data ?? null, remote.data) as unknown as JsonValue }));
saves.onStatus((_status, state) => {
  if (state === "foreign") { migrateForeign(); return; }
  // The account's save replaced the device's (another device saved last): merge it in.
  const cur = saves.load();
  if (cur && cur.savedAt !== lastSavedAt) {
    lastSavedAt = cur.savedAt;
    if (adopt(cur.data)) merged();
  }
});
/** The browser build's cloud progress: merged with this device's save, saved over it once. */
function migrateForeign(): void {
  const old = saves.foreign();
  if (!old) return;
  const other = old.text != null ? C.readForeign(old.text) : null;
  let grew = false;
  if (other) {
    const next = C.mergeSaves(doc, other);
    grew = !C.sameSave(next, doc);
    doc = next;
  }
  write({ replaceForeign: true });
  if (grew) merged();
}

/** The profile's sync line: offline (a guest) | saving | synced | error. */
export function syncState(): "offline" | "saving" | "synced" | "error" {
  if (!player()) return "offline";
  const st = saves.state();
  if (st === "error" || st === "read-blocked") return "error";
  if (st === "loading" || st === "foreign" || st === "uploading" || saves.status() === "pending") return "saving";
  return "synced";
}
export function flush(): void { void saves.flush().catch(() => undefined); }

// --- the game's settings -------------------------------------------------------------------------
export interface Options {
  palette: "default" | "deuteranopia" | "tritanopia" | "highContrast";
  captions: boolean;
  leftHanded: boolean;
  undoInPractice: boolean;
  muted: boolean;
  lastTheme: string;
  tutorialDone: string[];
}
export const DEFAULT_OPTIONS: Options = {
  palette: "default", captions: true, leftHanded: false, undoInPractice: true, muted: false, lastTheme: "brassworks", tutorialDone: [],
};
const PALETTES = ["default", "deuteranopia", "tritanopia", "highContrast"];
/** A stored value for `key`, or undefined when it isn't one. */
export function pickOption(key: string, v: unknown): unknown {
  switch (key) {
    case "palette": return typeof v === "string" && PALETTES.includes(v) ? v : undefined;
    case "captions": case "leftHanded": case "undoInPractice": case "muted": return typeof v === "boolean" ? v : undefined;
    case "lastTheme": return typeof v === "string" && /^[a-z]{1,24}$/.test(v) ? v : undefined;
    case "tutorialDone": return Array.isArray(v) ? v.filter((x) => typeof x === "string" && /^t\d+$/.test(x)).slice(0, 16) : undefined;
    default: return undefined;
  }
}
const KEYS = Object.keys(DEFAULT_OPTIONS) as (keyof Options)[];
export const options: Options = { ...DEFAULT_OPTIONS, tutorialDone: [] };
const optionListeners = new Set<() => void>();
export function onOptionsChange(fn: () => void): void { optionListeners.add(fn); }
function optionsChanged(): void { for (const fn of optionListeners) fn(); }
function readOption(key: keyof Options): void {
  let v: JsonValue | undefined;
  try { v = store.get(key); } catch { return; }
  const ok = pickOption(key, v);
  if (ok !== undefined) (options as unknown as Record<string, unknown>)[key] = ok;
}
/** Changes one of the game's settings (device and account). */
export function setOption<K extends keyof Options>(key: K, value: Options[K]): void {
  options[key] = value;
  try { store.set(key, value as unknown as JsonValue); } catch (e) { console.warn(`setting ${key}: ${String(e)}`); }
  optionsChanged();
}
/** The browser build's settings KV (main.js SYNCED_SETTINGS) → this game's settings. */
export function legacyOptions(get: (key: string) => unknown): Partial<Options> {
  const out: Partial<Options> = {};
  const acc = get("accessibility") as Record<string, unknown> | undefined;
  if (acc && typeof acc === "object") {
    const p = pickOption("palette", acc.colorPalette); if (p !== undefined) out.palette = p as Options["palette"];
    const c = pickOption("captions", acc.captions); if (c !== undefined) out.captions = c as boolean;
    const l = pickOption("leftHanded", acc.leftHanded); if (l !== undefined) out.leftHanded = l as boolean;
  }
  const rules = get("rules") as Record<string, unknown> | undefined;
  if (rules && typeof rules === "object") { const u = pickOption("undoInPractice", rules.undoInPractice); if (u !== undefined) out.undoInPractice = u as boolean; }
  const t = pickOption("lastTheme", get("lastTheme")); if (t !== undefined) out.lastTheme = t as string;
  return out;
}
export const LEGACY_KEYS = ["audio", "graphics", "accessibility", "camera", "rules", "telemetryConsent", "lastTheme"];
function importLegacy(): void {
  const keys = store.legacyKeys();
  if (!keys) return;
  const old = legacyOptions((k) => (keys.includes(k) ? store.legacy(k) : undefined));
  let changed = false;
  for (const [k, v] of Object.entries(old)) {
    try {
      if (store.get(k) !== undefined) continue;
      store.set(k, v as JsonValue);
      (options as unknown as Record<string, unknown>)[k] = v;
      changed = true;
    } catch { /* keep the device's */ }
  }
  for (const key of keys) if (LEGACY_KEYS.includes(key) || key.startsWith("ui.")) store.removeLegacy(key);
  if (changed) optionsChanged();
}

/** Reads the device's save and the game's settings (from onStart). */
export function initPlatform(): void {
  const cur = saves.load();
  lastSavedAt = cur?.savedAt ?? 0;
  doc = C.normalizeSave(cur?.data ?? null);
  for (const k of KEYS) readOption(k);
  store.onChange((key) => {
    if (!(KEYS as string[]).includes(key)) return;
    readOption(key as keyof Options);
    optionsChanged();
  });
  store.onLegacy(importLegacy);
  importLegacy();
  if (saves.state() === "foreign") migrateForeign();
  optionsChanged();
  refreshPlayer();
  void serverTime().then(() => undefined, () => undefined);
}

// --- the player and the clock --------------------------------------------------------------------
export function signedIn(): boolean { return !!player(); }
export function displayName(): string { return player()?.displayName ?? ""; }
let invite: string | null = null;
/** The invite link, fetched ahead so a button press can copy it at once. */
export function inviteLink(): string | null { return player() ? invite : null; }
function refreshPlayer(): void {
  invite = null;
  board = undefined;
  if (!player()) return;
  fetchInviteLink().then((u) => { invite = u; }, () => { invite = null; });
}
onPlayerChange(() => refreshPlayer());
/** Now in ms by the platform's clock when it has answered, else the device's. */
export function nowMs(): number {
  try { return serverNow() ?? Date.now(); } catch { return Date.now(); }
}
export const utcDay = (): number => Math.floor(nowMs() / 86400000);

// --- local score records (client.js localSubmit: the casual board on this device) ----------------
export interface LocalRow { name: string; score: number; ticks: number; levelId: string; when: number }
export function localBoard(board: string): LocalRow[] {
  try {
    const v = JSON.parse(storage.getText(`${PREFIX}board:${board}`) ?? "[]");
    return Array.isArray(v) ? v.filter((r) => r && typeof r.score === "number") : [];
  } catch { return []; }
}
function localSubmit(e: { board: string; score: number; ticks: number; levelId: string }): void {
  const rows = localBoard(e.board);
  rows.push({ name: displayName() || "You", score: e.score, ticks: e.ticks, levelId: e.levelId, when: nowMs() });
  rows.sort((a, b) => b.score - a.score || a.ticks - b.ticks);
  try { storage.set(`${PREFIX}board:${e.board}`, JSON.stringify(rows.slice(0, 50))); } catch { /* full */ }
  // the device store has a key limit: keep the global board and the last 30 daily boards
  try {
    const days = storage.keys().filter((k) => k.startsWith(`${PREFIX}board:daily-`)).sort((a, b) => Number(a.slice(a.lastIndexOf("-") + 1)) - Number(b.slice(b.lastIndexOf("-") + 1)));
    while (days.length > 30) storage.remove(days.shift()!);
  } catch { /* best effort */ }
}
/** What session.js calls on `platform` (telemetry was kept in memory only and never sent: dropped). */
export const sessionPlatform = {
  telemetry(): void { /* the browser build's consent-gated queue was never sent anywhere */ },
  submitScore(e: { board: string; score: number; ticks: number; levelId: string }): void { localSubmit(e); },
};

// --- the high-score board ------------------------------------------------------------------------
let board: Leaderboard | null | undefined;
async function highScoreBoard(): Promise<Leaderboard | null> {
  if (board !== undefined) return board;
  const list = await leaderboards.list();
  board = list.find((b) => b.key === "high-score") ?? list[0] ?? null;
  return board;
}
export interface HostedRow { rank: number; name: string; score: number; me: boolean }
/** The StarHermit high-score board (read-only): the top entries, null when unavailable. */
export async function hostedBoard(friends: boolean): Promise<HostedRow[] | null> {
  const me = player();
  if (!me) return null;
  try {
    const b = await highScoreBoard();
    if (!b) return null;
    const r = await leaderboards.entries(b.id, { pageSize: 50, friendsOnly: friends });
    return r.items.map((e, i) => ({ rank: e.rank ?? i + 1, name: e.displayName || e.username || "", score: Number.isFinite(e.score) ? e.score : 0, me: e.userId === me.userId }));
  } catch { return null; }
}
export interface Posted { posted: boolean; rank: number | null }
/** Signed in only: post a completed round's total through score-script.js; { posted, rank }. Never rejects. */
export async function postScore(total: number): Promise<Posted> {
  const me = player();
  if (!me) return { posted: false, rank: null };
  const score = Math.max(0, Math.round(total));
  let accepted: string[] = [];
  try {
    const sessionId = await sessions.practice();
    accepted = await new Promise<string[]>((resolve) => {
      const socket = connectGame(sessionId);
      let done = false;
      const finish = (list: string[]): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.close();
        resolve(list);
      };
      const timer = setTimeout(() => finish([]), 15000);
      socket.on("open", () => { socket.sendCommand({ type: "result", scores: { "high-score": score } }); });
      socket.on("game", (d) => {
        const m = d as { type?: string; accepted?: string[] } | null;
        if (m && m.type === "result-ack") finish(Array.isArray(m.accepted) ? m.accepted : []);
      });
      socket.on("error", () => finish([]));
      socket.on("stopped", () => finish([]));
      socket.on("abandoned", () => finish([]));
    });
  } catch { return { posted: false, rank: null }; }
  if (!accepted.includes("high-score")) return { posted: false, rank: null };
  try {
    const b = await highScoreBoard();
    if (!b) return { posted: true, rank: null };
    const r = await leaderboards.entries(b.id, { pageSize: 100 });
    const mine = r.items.find((e) => e.userId === me.userId);
    return { posted: true, rank: mine ? mine.rank : null };
  } catch { return { posted: true, rank: null }; }
}
