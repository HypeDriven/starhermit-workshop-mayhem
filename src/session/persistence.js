// Versioned, checksummed persistence (spec §6 cloud-save document shape).
// Local-first; the StarHermit cloud slot mirrors the progression doc and the
// two are merged (mergeProgression) on boot and on save conflicts, with
// localStorage as the offline cache.

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
      graphics: { ...{ preset: 'auto', render_scale: 1, adaptive: true, show_fps: false }, ...(d.graphics || {}) },
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

// --- cloud merge ----------------------------------------------------------------
// Two devices (or a device and the cloud slot) never lose each other's
// progress: per-level stars and best scores keep the better entry, XP and
// lifetime totals keep the larger count, the Journey frontier keeps the
// furthest stage. Cosmetic choices are a preference, so `local` keeps its own.
export function mergeProgression(local, remote) {
  const a = { ...structuredClone(DEFAULT_PROGRESSION), ...(local || {}) };
  const b = { ...structuredClone(DEFAULT_PROGRESSION), ...(remote || {}) };
  const stars = { ...b.stars };
  for (const [id, n] of Object.entries(a.stars || {})) stars[id] = Math.max(stars[id] || 0, n || 0);
  const bestScores = { ...b.bestScores };
  for (const [id, rec] of Object.entries(a.bestScores || {})) {
    const other = bestScores[id];
    if (!other || rec.total > other.total || (rec.total === other.total && (rec.ticks ?? 0) < (other.ticks ?? 0))) bestScores[id] = rec;
  }
  const totals = {};
  for (const k of new Set([...Object.keys(a.totals || {}), ...Object.keys(b.totals || {})])) {
    totals[k] = Math.max(a.totals?.[k] ?? 0, b.totals?.[k] ?? 0);
  }
  const rank = (id) => { const m = /^j(\d+)$/.exec(id || ''); return m ? parseInt(m[1], 10) : 0; };
  const fa = a.journey?.furthest, fb = b.journey?.furthest;
  return {
    ...b,
    ...a,
    stars,
    bestScores,
    totalStars: Object.values(stars).reduce((sum, n) => sum + (n || 0), 0),
    xp: Math.max(a.xp ?? 0, b.xp ?? 0),
    totals,
    cosmetics: { ...b.cosmetics, ...a.cosmetics },
    journey: { ...b.journey, ...a.journey, furthest: rank(fb) > rank(fa) ? fb : (fa ?? fb ?? 'j01') },
  };
}

// --- defaults ------------------------------------------------------------------

export const DEFAULT_SETTINGS = {
  audio: { music: 0.7, effects: 0.9, ambience: 0.5, voice: 0.8, muted: false },
  graphics: { preset: 'auto', render_scale: 1, adaptive: true, show_fps: false },
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
