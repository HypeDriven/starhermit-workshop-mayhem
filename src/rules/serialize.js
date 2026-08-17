// Serializable state, stable hashing, and document migration.
// Hashing quantizes floats to a 1/4096 grid and walks a canonical key order,
// so identical simulations produce identical hashes regardless of engine.

import { RULES_VERSION } from './engine.js';
import { restoreStreams, snapshotStreams } from './rng.js';

export function serialize(state) {
  return {
    v: state.v,
    tick: state.tick,
    phase: state.phase,
    terminalReason: state.terminalReason,
    seed: state.seed,
    levelId: state.levelId,
    levelVersion: state.levelVersion,
    mode: state.mode,
    options: { ...state.options },
    bounds: { ...state.bounds },
    world: {
      particles: state.world.particles.map(p => ({
        x: p.x, y: p.y, px: p.px, py: p.py, r: p.r, m: p.m,
        mat: p.mat, body: p.body, flags: p.flags, pinned: !!p.pinned,
      })),
      constraints: state.world.constraints.map(c => ({ ...c })),
      segments: state.world.segments.map(s => ({ ...s })),
      circles: state.world.circles.map(c => ({ ...c })),
      fields: state.world.fields.map(f => ({ ...f })),
    },
    bodies: state.bodies.map(b => ({ ...b })),
    dummyBody: state.dummyBody,
    mounts: state.mounts.map(m => ({ ...m })),
    tools: state.tools.map(t => ({ ...t })),
    stock: { ...state.stock },
    goals: state.goals.map(g => ({ ...g })),
    stats: { ...state.stats },
    streams: snapshotStreams(state.streams),
    winSettle: state.winSettle,
    settleStreak: state.settleStreak,
    settled: state.settled,
    nextToolId: state.nextToolId,
    seenIds: [...state.seenIds],
    lastInvalid: state.lastInvalid ? { ...state.lastInvalid } : null,
    _lastUx: state._lastUx, _lastUy: state._lastUy, _dummyAir: !!state._dummyAir,
    _dcx: state._dcx, _dcy: state._dcy, _dummySpeed: state._dummySpeed,
  };
}

export function deserialize(doc, level) {
  const migrated = migrate(doc);
  const state = {
    ...migrated,
    options: { ...migrated.options },
    bounds: { ...migrated.bounds },
    world: {
      particles: migrated.world.particles.map(p => ({ ...p })),
      constraints: migrated.world.constraints.map(c => ({ ...c })),
      segments: migrated.world.segments.map(s => ({ ...s })),
      circles: migrated.world.circles.map(c => ({ ...c })),
      fields: migrated.world.fields.map(f => ({ ...f })),
      maxSpeed2: 0,
      events: [],
    },
    bodies: migrated.bodies.map(b => ({ ...b })),
    mounts: migrated.mounts.map(m => ({ ...m })),
    tools: migrated.tools.map(t => ({ ...t })),
    stock: { ...migrated.stock },
    goals: migrated.goals.map(g => ({ ...g })),
    stats: { ...migrated.stats },
    streams: restoreStreams(migrated.streams),
    seenIds: [...migrated.seenIds],
    lastInvalid: migrated.lastInvalid ? { ...migrated.lastInvalid } : null,
    level: level ?? migrated.level ?? null,
  };
  return state;
}

export function cloneState(state) {
  return deserialize(serialize(state), state.level);
}

// Document migration chain. v0 (prototype) lacked options/mounts/mode and used
// a single rng number; migrate fills deterministic defaults.
export function migrate(doc) {
  if (!doc || typeof doc !== 'object') throw new Error('bad state document');
  let d = doc;
  if (d.v === 0) {
    d = {
      ...d,
      v: 1,
      mode: d.mode || 'journey',
      options: d.options || { allowUndo: false, moveLimit: 0, maxTicks: 7200 },
      mounts: d.mounts || [],
      streams: typeof d.streams === 'number'
        ? { rules: d.streams, decor: (d.streams ^ 0x85ebca6b) >>> 0 }
        : d.streams,
      lastInvalid: d.lastInvalid ?? null,
      _lastUx: d._lastUx, _lastUy: d._lastUy,
    };
  }
  if (d.v !== RULES_VERSION) throw new Error(`unsupported state version ${d.v}`);
  return d;
}

// --- stable hashing --------------------------------------------------------

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function q(v) {
  return typeof v === 'number' ? Math.round(v * 4096) : v;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${k}:${canonical(value[k])}`).join(',')}}`;
  }
  if (typeof value === 'number') return String(q(value));
  return JSON.stringify(value);
}

// Hash of everything rules-relevant (excludes the retained level def).
export function hashState(state) {
  const doc = serialize(state);
  delete doc.level;
  return fnv1a(canonical(doc));
}

export function hashString(str) { return fnv1a(str); }
