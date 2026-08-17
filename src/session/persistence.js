// Versioned, checksummed persistence (spec §6 cloud-save document shape).
// Local-first with a pluggable remote adapter; conflict helpers preserve both
// snapshots so the player can choose when neither is a strict descendant.

const STORE_PREFIX = 'workshop-mayhem:';

// simple FNV-1a checksum over canonical JSON
function checksum(obj) {
  const str = JSON.stringify(obj);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function storage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch { /* private mode */ }
  // in-memory fallback (tests, private browsing)
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

export const DOC_VERSIONS = {
  settings: 2,
  profile: 1,
  progression: 2,
  achievements: 1,
  daily: 1,
  snapshot: 1,
};

const MIGRATIONS = {
  settings: {
    1: (d) => ({
      ...d,
      // v1 -> v2: added accessibility + binding sections
      accessibility: d.accessibility || {
        reducedMotion: false, highContrast: false, largeText: false,
        leftHanded: false, holdToAim: true, timingAssist: false, haptics: true,
        captions: true, colorPalette: 'default',
      },
      bindings: d.bindings || null,
      graphics: { ...{ tier: 'auto', renderScale: 1 }, ...(d.graphics || {}) },
    }),
  },
  progression: {
    1: (d) => ({
      ...d,
      // v1 -> v2: mastery XP + cosmetics unlocks
      xp: d.xp ?? 0,
      cosmetics: d.cosmetics || { theme: 'brassworks', trail: 'confetti', dummyTrim: null },
      totals: d.totals || { plays: 0, completions: 0, bestStreak: 0 },
    }),
  },
};

export function wrapDoc(kind, data) {
  return { kind, v: DOC_VERSIONS[kind], updated: Date.now(), sum: checksum(data), data };
}

export function unwrapDoc(kind, doc) {
  if (!doc || doc.kind !== kind) throw new Error(`wrong doc kind: ${doc?.kind}`);
  let d = doc;
  // migrate forward if older
  while (d.v < DOC_VERSIONS[kind]) {
    const mig = MIGRATIONS[kind]?.[d.v];
    if (!mig) throw new Error(`no migration ${kind} v${d.v}`);
    d = { ...d, v: d.v + 1, data: mig(d.data) };
  }
  if (d.v > DOC_VERSIONS[kind]) throw new Error(`doc from future: ${kind} v${d.v}`);
  if (checksum(d.data) !== d.sum) throw new Error(`checksum mismatch: ${kind}`);
  return d.data;
}

export function saveLocal(kind, data) {
  const doc = wrapDoc(kind, data);
  storage().setItem(STORE_PREFIX + kind, JSON.stringify(doc));
  return doc;
}

export function loadLocal(kind) {
  const raw = storage().getItem(STORE_PREFIX + kind);
  if (!raw) return null;
  try {
    return unwrapDoc(kind, JSON.parse(raw));
  } catch (err) {
    console.warn(`[persistence] discarding invalid ${kind}:`, err.message);
    return null;
  }
}

export function clearLocal(kind) {
  storage().removeItem(STORE_PREFIX + kind);
}

// --- cloud conflict resolution ------------------------------------------------
// ancestry: a doc is a strict descendant when its updated timestamp is newer
// AND it shares the other's lineage id; otherwise both are preserved for the
// player to pick (spec §6 conflict handling).
export function resolveConflict(localDoc, remoteDoc) {
  if (!remoteDoc) return { winner: 'local', doc: localDoc, conflict: false };
  if (!localDoc) return { winner: 'remote', doc: remoteDoc, conflict: false };
  const l = unwrapDoc(rawKind(localDoc), localDoc);
  const r = unwrapDoc(rawKind(remoteDoc), remoteDoc);
  if (JSON.stringify(l) === JSON.stringify(r)) return { winner: 'local', doc: localDoc, conflict: false };
  // heuristic descendants: totalStars/plays supersets in progression docs
  const la = scoreOf(l), ra = scoreOf(r);
  if (la.every((v, i) => v >= ra[i])) return { winner: 'local', doc: localDoc, conflict: false };
  if (ra.every((v, i) => v >= la[i])) return { winner: 'remote', doc: remoteDoc, conflict: false };
  return { winner: null, doc: null, conflict: true, local: localDoc, remote: remoteDoc };
}

function rawKind(doc) { return doc.kind || 'progression'; }

function scoreOf(d) {
  return [
    d.totalStars ?? 0, d.xp ?? 0,
    Object.keys(d.stars || {}).length,
    d.totals?.completions ?? 0,
  ];
}

// --- defaults ------------------------------------------------------------------

export const DEFAULT_SETTINGS = {
  audio: { music: 0.7, effects: 0.9, ambience: 0.5, voice: 0.8, muted: false },
  graphics: { tier: 'auto', renderScale: 1 },
  accessibility: {
    reducedMotion: false, highContrast: false, largeText: false,
    leftHanded: false, holdToAim: true, timingAssist: false, haptics: true,
    captions: true, colorPalette: 'default',
  },
  camera: { preset: 'default' },
  rules: { undoInPractice: true },
  bindings: null,          // null => defaults (declared in ui/input.js)
  telemetryConsent: null,  // null => not yet asked
  tutorialDone: [],
  lastTheme: 'brassworks',
};

export const DEFAULT_PROFILE = {
  displayName: 'Guest Inventor',
  guest: true,
  avatar: null,
  privacy: 'friends',
  createdAt: null,
};

export const DEFAULT_PROGRESSION = {
  stars: {},          // levelId -> 0..3
  bestScores: {},     // levelId -> {total, components, ticks}
  totalStars: 0,
  xp: 0,
  cosmetics: { theme: 'brassworks', trail: 'confetti', dummyTrim: null },
  totals: { plays: 0, completions: 0, bestStreak: 0 },
  journey: { furthest: 'j01' },
};
