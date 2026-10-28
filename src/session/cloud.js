// The save document the StarHermit engine keeps on the device and in the
// player's cloud slot: { v: 1, progression, achievements }, each the
// versioned, checksummed document persistence.js writes (wrapDoc). Two
// devices' saves merge entry by entry (mergeProgression: best stars, scores,
// XP and the furthest stage win; achievements: every unlock, tool and daily
// either device earned), so neither ever loses progress. The browser build's
// cloud slot (the JS SDK's save.json: { kind: 'progression', doc }, older
// saves the wrapped document itself) is read by readForeign.
import { wrapDoc, unwrapDoc, mergeProgression, DEFAULT_PROGRESSION } from './persistence.js';
import { emptyAchievementDoc } from '../content/achievements.js';

export const SAVE_VERSION = 1;

/** The data inside a wrapped document of `kind`, or null (bad checksum, wrong kind, bare data). */
export function readDoc(kind, doc) {
  if (!doc || typeof doc !== 'object') return null;
  try { return unwrapDoc(kind, doc); } catch { /* bare or unversioned */ }
  if (kind === 'progression' && doc.stars && typeof doc.stars === 'object') return doc;
  if (kind === 'progression' && doc.data && typeof doc.data === 'object' && doc.data.stars) return doc.data;
  return null;
}

export function emptySave() {
  return { v: SAVE_VERSION, progression: null, achievements: null };
}

/** A save document from anything (a missing or damaged part stays null). */
export function normalizeSave(raw) {
  const out = emptySave();
  if (!raw || typeof raw !== 'object') return out;
  if (readDoc('progression', raw.progression)) out.progression = raw.progression;
  if (readDoc('achievements', raw.achievements)) out.achievements = raw.achievements;
  return out;
}

export function mergeAchievements(a, b) {
  const x = { ...emptyAchievementDoc(), ...(a || {}) };
  const y = { ...emptyAchievementDoc(), ...(b || {}) };
  const unlocked = { ...y.unlocked };
  for (const [k, when] of Object.entries(x.unlocked || {})) {
    if (!unlocked[k] || String(when) < String(unlocked[k])) unlocked[k] = when;
  }
  const keys = Object.keys(unlocked).sort();
  return {
    unlocked: Object.fromEntries(keys.map((k) => [k, unlocked[k]])),
    seenTools: [...new Set([...(y.seenTools || []), ...(x.seenTools || [])])].sort(),
    dailyDays: [...new Set([...(y.dailyDays || []), ...(x.dailyDays || [])])].sort((p, q) => p - q),
    completionsTotal: Math.max(x.completionsTotal || 0, y.completionsTotal || 0),
  };
}

/** Merge two save documents (`local` keeps its own cosmetic choice). */
export function mergeSaves(local, remote) {
  const a = normalizeSave(local), b = normalizeSave(remote);
  const pa = readDoc('progression', a.progression), pb = readDoc('progression', b.progression);
  const aa = readDoc('achievements', a.achievements), ab = readDoc('achievements', b.achievements);
  const out = emptySave();
  if (pa || pb) out.progression = wrapStable('progression', pa && pb ? mergeProgression(pa, pb) : (pa || { ...JSON.parse(JSON.stringify(DEFAULT_PROGRESSION)), ...pb }));
  if (aa || ab) out.achievements = wrapStable('achievements', mergeAchievements(aa, ab));
  // keep an identical part byte-for-byte (its timestamp too) so an unchanged merge compares equal
  if (a.progression && sameData('progression', a.progression, out.progression)) out.progression = a.progression;
  if (a.achievements && sameData('achievements', a.achievements, out.achievements)) out.achievements = a.achievements;
  return out;
}

function wrapStable(kind, data) { return wrapDoc(kind, data); }

function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  return v;
}
function sameData(kind, x, y) {
  const a = readDoc(kind, x), b = readDoc(kind, y);
  return !!a && !!b && JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

/** Whether two save documents hold the same progress (ignoring key order and write times). */
export function sameSave(x, y) {
  const a = normalizeSave(x), b = normalizeSave(y);
  const same = (kind) => (!a[kind] && !b[kind]) || sameData(kind, a[kind], b[kind]);
  return same('progression') && same('achievements');
}

/** The browser build's cloud save.json text as a save document, or null. */
export function readForeign(text) {
  let raw;
  try { raw = JSON.parse(String(text)); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const doc = raw.kind === 'progression' && 'doc' in raw ? raw.doc : raw;
  const prog = readDoc('progression', doc);
  if (!prog) return null;
  return { v: SAVE_VERSION, progression: wrapDoc('progression', prog), achievements: null };
}
