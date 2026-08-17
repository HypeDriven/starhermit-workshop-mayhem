// Seeded random streams. mulberry32 — tiny, fast, deterministic across JS engines
// (integer math only). Separate named streams so cosmetic randomness can never
// perturb rules outcomes and vice versa (spec §5 determinism).

export function hashSeed(str) {
  // xmur3-style string hash -> uint32
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export function createStream(seedUint32) {
  let a = seedUint32 >>> 0;
  const next = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), // inclusive
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    get state() { return a >>> 0; },
    set state(v) { a = v >>> 0; },
  };
}

// Streams carried inside rules state. `rules` is consumed only by rules code
// (e.g. event variant selection for seeded audio); `decor` only by content
// decoration. Serialization preserves positions so replays stay identical.
export function createStreamPair(seedUint32) {
  return {
    rules: createStream((seedUint32 ^ 0x9e3779b9) >>> 0),
    decor: createStream((seedUint32 ^ 0x85ebca6b) >>> 0),
  };
}

export function snapshotStreams(streams) {
  return { rules: streams.rules.state, decor: streams.decor.state };
}

export function restoreStreams(snap) {
  const s = createStreamPair(0);
  s.rules.state = snap.rules;
  s.decor.state = snap.decor;
  return s;
}
