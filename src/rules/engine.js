// Workshop Mayhem rules engine — pure deterministic state transitions.
// No DOM, no rendering, no wall-clock. Everything a session needs:
//   createGame / legalActions / explainPlacement / applyCommand / step
//   isTerminal / liveScore / cloneState / summarize (accessibility mirror)
// State is plain serializable data plus live RNG stream objects (handled by
// serialize.js). All simulation runs at the fixed DT from physics.js.

import {
  DT, MAT, makeWorld, addParticle, addConstraint, addSegment, addCircle,
  stepWorld, impulse, particleSpeed, cloneWorld,
} from './physics.js';
import { createStreamPair } from './rng.js';
import { computeScore } from './scoring.js';

export const RULES_VERSION = 1;
export const SETTLE_EPS = 0.05 * DT;      // per-tick speed below which we count a settle tick
export const SETTLE_TICKS = 24;           // consecutive quiet ticks => settled
export const WIN_SETTLE_TICKS = 120;      // celebration window after primary completion
export const SKIP_CAP = 3600;             // max ticks a skip may fast-forward
export const DEFAULT_MAX_TICKS = 60 * 120; // 60 simulated seconds per round

export const TERMINAL = {
  GOAL: 'goal-complete',
  OUT_OF_ACTIONS: 'out-of-actions',
  TIME_LIMIT: 'time-limit',
  MOVE_LIMIT: 'move-limit',
  ABANDONED: 'abandoned',
};

export const INVALID = {
  TERMINAL: 'terminal-state',
  DUPLICATE: 'duplicate-command',
  BAD_COMMAND: 'bad-command',
  OUT_OF_STOCK: 'out-of-stock',
  OUT_OF_BOUNDS: 'out-of-bounds',
  NO_MOUNT: 'no-mount',
  MOUNT_OCCUPIED: 'mount-occupied',
  NOT_ON_GROUND: 'not-on-ground',
  OVERLAP: 'overlap',
  NO_SUCH_TOOL: 'no-such-tool',
  ALREADY_SPENT: 'already-spent',
  UNSUPPORTED: 'unsupported-here',
};

// ---------------------------------------------------------------------------
// Tool definitions (whimsical workshop originals)
// ---------------------------------------------------------------------------
export const TOOLS = {
  piston: {
    key: 'piston', name: 'Wallop Piston', placement: 'mount',
    range: 2.1, coneBase: 0.55, coneGrow: 0.30, power: 12.5,
    blurb: 'A spring-loaded wall fist. Mount it, aim it, let it rip.',
  },
  pad: {
    key: 'pad', name: 'Boing Pad', placement: 'ground',
    half: 0.42, boost: 8.5, passive: true,
    blurb: 'A squeaky trampoline puck. Snaps onto floors and ledges.',
  },
  fan: {
    key: 'fan', name: 'Gust Fan', placement: 'air',
    range: 3.8, width: 1.15, strength: 20, duration: 240,
    blurb: 'Blasts a cone of air for about two seconds when triggered.',
  },
  magnet: {
    key: 'magnet', name: 'Snatch Magnet', placement: 'air',
    range: 4.0, strength: 38, duration: 240,
    blurb: 'Yanks everything plush toward itself for a short while.',
  },
  weight: {
    key: 'weight', name: 'Thumper Weight', placement: 'air',
    r: 0.34, m: 18,
    blurb: 'A heavy anvil that hangs in mid-air until you drop it.',
  },
};

const TRIGGERABLE = ['piston', 'fan', 'magnet', 'weight'];
const Q = (v) => Math.round(v * 10000) / 10000; // input quantization grid

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

function buildDummy(w, x, groundY) {
  const start = w.particles.length;
  // Symmetric ring lattices (no trig): hexagon and octagon unit lattices.
  const HEX = [[2, 0], [1, 2], [-1, 2], [-2, 0], [-1, -2], [1, -2]];
  const OCT = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const hR = 0.17, tR = 0.23;
  const torsoY = groundY + tR + 0.115; // ring bottom + particle radius rest on ground
  const headY = torsoY + 0.44;
  const headC = addParticle(w, x, headY, 0.05, 1.1, MAT.PLUSH, 0);
  const torsoC = addParticle(w, x, torsoY, 0.05, 1.3, MAT.PLUSH, 0);
  const headRing = [], torsoRing = [];
  for (const [lx, ly] of HEX) {
    const n = Math.sqrt(lx * lx + ly * ly);
    headRing.push(addParticle(w, x + (lx / n) * hR, headY + (ly / n) * hR, 0.075, 0.55, MAT.PLUSH, 0));
  }
  for (const [lx, ly] of OCT) {
    const n = Math.sqrt(lx * lx + ly * ly);
    torsoRing.push(addParticle(w, x + (lx / n) * tR, torsoY + (ly / n) * tR, 0.09, 0.6, MAT.PLUSH, 0));
  }
  for (let i = 0; i < 6; i++) {
    addConstraint(w, headRing[i], headRing[(i + 1) % 6], 0.7);
    addConstraint(w, headRing[i], headC, 0.7);
    addConstraint(w, headRing[i], headRing[(i + 2) % 6], 0.22);
  }
  const T = 8;
  for (let i = 0; i < T; i++) {
    addConstraint(w, torsoRing[i], torsoRing[(i + 1) % T], 0.7);
    addConstraint(w, torsoRing[i], torsoC, 0.7);
    addConstraint(w, torsoRing[i], torsoRing[(i + 3) % T], 0.2);
  }
  // neck: centers + four ring links (head bottom <-> torso top)
  addConstraint(w, headC, torsoC, 0.8);
  addConstraint(w, headRing[4], torsoRing[3], 0.6);
  addConstraint(w, headRing[4], torsoRing[2], 0.6);
  addConstraint(w, headRing[5], torsoRing[2], 0.6);
  addConstraint(w, headRing[5], torsoRing[1], 0.6);
  return { kind: 'dummy', start, count: w.particles.length - start, spawnX: x, spawnY: groundY };
}

function buildCrate(w, x, surfaceY, bodyIdx) {
  const start = w.particles.length;
  const h = 0.19;
  const y = surfaceY + h + 0.13; // corner circles (r 0.13) rest on the surface
  const p0 = addParticle(w, x - h, y - h, 0.13, 0.85, MAT.WOOD, bodyIdx);
  const p1 = addParticle(w, x + h, y - h, 0.13, 0.85, MAT.WOOD, bodyIdx);
  const p2 = addParticle(w, x + h, y + h, 0.13, 0.85, MAT.WOOD, bodyIdx);
  const p3 = addParticle(w, x - h, y + h, 0.13, 0.85, MAT.WOOD, bodyIdx);
  addConstraint(w, p0, p1, 0.85); addConstraint(w, p1, p2, 0.85);
  addConstraint(w, p2, p3, 0.85); addConstraint(w, p3, p0, 0.85);
  addConstraint(w, p0, p2, 0.85); addConstraint(w, p1, p3, 0.85);
  return { kind: 'crate', start, count: 4, spawnX: x, spawnY: y, toppled: false };
}

function buildBall(w, x, surfaceY, bodyIdx) {
  const start = w.particles.length;
  const y = surfaceY + 0.24;
  addParticle(w, x, y, 0.24, 1.7, MAT.WOOD, bodyIdx);
  return { kind: 'ball', start, count: 1, spawnX: x, spawnY: y };
}

export function createGame(level, opts = {}) {
  const seed = (opts.seed ?? level.seed) >>> 0;
  const streams = createStreamPair(seed);
  const w = makeWorld();

  const bodies = [];
  bodies.push(buildDummy(w, level.dummy.x, level.dummy.y));
  let bodyIdx = 1;
  for (const prop of level.props || []) {
    if (prop.kind === 'crate') bodies.push(buildCrate(w, prop.x, prop.y, bodyIdx));
    else if (prop.kind === 'ball') bodies.push(buildBall(w, prop.x, prop.y, bodyIdx));
    bodyIdx++;
  }

  for (const s of level.statics.segments || []) {
    addSegment(w, s[0], s[1], s[2], s[3], MAT[s[4] ?? 'WOOD'] ?? MAT.WOOD, s[5] || 0);
  }
  for (const c of level.statics.circles || []) {
    addCircle(w, c[0], c[1], c[2], MAT[c[3] ?? 'WOOD'] ?? MAT.WOOD, c[4] || '');
  }
  (level.bells || []).forEach((b, i) => {
    addCircle(w, b.x, b.y, b.r, MAT.METAL, `bell:${i}`);
  });

  const goals = level.goals.map((g, i) => ({
    ...g, index: i, done: false, value: 0, best: 0,
  }));

  const state = {
    v: RULES_VERSION,
    tick: 0,
    phase: 'active',
    terminalReason: null,
    seed,
    levelId: level.id,
    levelVersion: level.version,
    mode: opts.mode || 'journey',
    options: {
      allowUndo: !!opts.allowUndo,
      moveLimit: level.challenge?.moveLimit || 0,
      maxTicks: level.challenge?.timeLimitTicks || level.maxTicks || DEFAULT_MAX_TICKS,
    },
    bounds: { ...level.bounds },
    world: w,
    bodies,
    dummyBody: 0,
    mounts: (level.mounts || []).map(m => ({ ...m, occupiedBy: null })),
    tools: [],
    stock: { piston: 0, pad: 0, fan: 0, magnet: 0, weight: 0, ...level.tools },
    goals,
    stats: {
      invalid: 0, commands: 0, toolUses: 0, airTicks: 0,
      peakY: 0, spinSum: 0, peakSpeed: 0, firstGoalTick: -1,
    },
    streams,
    winSettle: -1,
    settleStreak: 0,
    settled: true,
    nextToolId: 1,
    seenIds: [],
    lastInvalid: null,
    level, // retained (immutable content data) for restarts/serialize reference
  };
  return state;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function bodyCenter(state, bi) {
  const b = state.bodies[bi];
  const ps = state.world.particles;
  let x = 0, y = 0;
  for (let i = b.start; i < b.start + b.count; i++) { x += ps[i].x; y += ps[i].y; }
  return { x: x / b.count, y: y / b.count };
}

export function dummyCenter(state) { return bodyCenter(state, state.dummyBody); }

export function isTerminal(state) {
  return state.phase === 'terminal'
    ? { terminal: true, reason: state.terminalReason }
    : { terminal: false, reason: null };
}

export function primaryComplete(state) {
  const primaries = state.goals.filter(g => g.primary);
  return primaries.length > 0 && primaries.every(g => g.done);
}

export function liveScore(state) {
  return computeScore(state, false);
}

export function finalScore(state) {
  return computeScore(state, true);
}

function armedTriggerables(state) {
  return state.tools.filter(t => t.status === 'armed' && TRIGGERABLE.includes(t.type));
}

export function legalActions(state, ctx = {}) {
  if (state.phase === 'terminal') {
    return { phase: state.phase, canAct: false, placements: [], triggers: [], undo: false, skip: false, restart: true };
  }
  const placements = [];
  for (const key of Object.keys(TOOLS)) {
    if ((state.stock[key] || 0) > 0) {
      placements.push({
        tool: key, stock: state.stock[key],
        placement: TOOLS[key].placement,
        mounts: TOOLS[key].placement === 'mount'
          ? state.mounts.filter(m => !m.occupiedBy).map(m => m.id) : undefined,
      });
    }
  }
  return {
    phase: state.phase,
    canAct: true,
    placements,
    triggers: armedTriggerables(state).map(t => ({ toolId: t.id, type: t.type, x: t.x, y: t.y })),
    undo: !!state.options.allowUndo && (ctx.history || 0) > 0,
    skip: !state.settled,
    restart: true,
  };
}

// Explain why a hypothetical placement would be illegal — drives ghost tinting
// and the invalid-action explanation UI (spec §3 input).
export function explainPlacement(state, tool, x, y, mountId = null) {
  const def = TOOLS[tool];
  if (!def) return { ok: false, reason: INVALID.BAD_COMMAND };
  if ((state.stock[tool] || 0) <= 0) return { ok: false, reason: INVALID.OUT_OF_STOCK };
  const b = state.bounds;
  const rad = tool === 'weight' ? TOOLS.weight.r : 0.3;
  if (x < b.x + rad || x > b.x + b.w - rad || y < b.y || y > b.y + b.h - rad) {
    return { ok: false, reason: INVALID.OUT_OF_BOUNDS };
  }
  if (def.placement === 'mount') {
    const m = state.mounts.find(mm => mm.id === mountId);
    if (!m) return { ok: false, reason: INVALID.NO_MOUNT };
    if (m.occupiedBy) return { ok: false, reason: INVALID.MOUNT_OCCUPIED };
    return { ok: true, x: m.x, y: m.y };
  }
  if (def.placement === 'ground') {
    const snap = groundSnap(state, x, y);
    if (!snap) return { ok: false, reason: INVALID.NOT_ON_GROUND };
    // pads are flat and slide under whatever rests on the floor — no clearance
    return { ok: true, x: snap.x, y: snap.y };
  }
  return clearance(state, x, y, rad + 0.12) ? { ok: true, x, y } : { ok: false, reason: INVALID.OVERLAP };
}

function clearance(state, x, y, minDist) {
  for (const p of state.world.particles) {
    const dx = p.x - x, dy = p.y - y;
    if (dx * dx + dy * dy < (minDist + p.r) * (minDist + p.r)) return false;
  }
  for (const t of state.tools) {
    const dx = t.x - x, dy = t.y - y;
    if (dx * dx + dy * dy < 0.36) return false;
  }
  return true;
}

// Snap a ground tool onto the nearest walkable static segment surface.
export function groundSnap(state, x, y) {
  let best = null, bestDy = 0.35;
  for (const s of state.world.segments) {
    const ax = s.x2 - s.x1, ay = s.y2 - s.y1;
    const len2 = ax * ax + ay * ay;
    if (len2 < 1e-9) continue;
    const len = Math.sqrt(len2);
    const ny = Math.abs(ax) / len; // surface "up-ness": normal y component = |dx|/len
    if (ny < 0.68) continue;      // too steep to stand on
    let t = ((x - s.x1) * ax + (y - s.y1) * ay) / len2;
    if (t < 0.05 || t > 0.95) continue;
    const cx = s.x1 + ax * t, cy = s.y1 + ay * t;
    const dy = Math.abs(y - cy);
    if (dy < bestDy) { bestDy = dy; best = { x: cx, y: cy + 0.03 }; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

let cmdCounter = 0;
export function makeCommandId(prefix = 'c') {
  return `${prefix}${(++cmdCounter).toString().padStart(5, '0')}`;
}

export function applyCommand(state, cmd) {
  const events = [];
  const reject = (reason, countInvalid = true) => {
    if (countInvalid) state.stats.invalid++;
    state.lastInvalid = { reason, tick: state.tick };
    events.push({ t: 'invalid', reason });
    return { accepted: false, reason, events };
  };
  if (!cmd || typeof cmd !== 'object') return reject(INVALID.BAD_COMMAND);
  if (state.phase === 'terminal') return reject(INVALID.TERMINAL, false);
  if (cmd.id && state.seenIds.includes(cmd.id)) return reject(INVALID.DUPLICATE, false);

  let result;
  switch (cmd.type) {
    case 'place': result = doPlace(state, cmd, reject, events); break;
    case 'trigger': result = doTrigger(state, cmd, reject, events); break;
    case 'skip': result = doSkip(state, events); break;
    default: return reject(INVALID.BAD_COMMAND);
  }
  if (result.accepted && cmd.id) {
    state.seenIds.push(cmd.id);
    if (state.seenIds.length > 256) state.seenIds.shift();
    state.stats.commands++;
  }
  return result;
}

function doPlace(state, cmd, reject, events) {
  const tool = cmd.tool;
  const def = TOOLS[tool];
  if (!def || !Number.isFinite(cmd.x) || !Number.isFinite(cmd.y)) return reject(INVALID.BAD_COMMAND);
  const x = Q(cmd.x), y = Q(cmd.y);
  let dx = Number.isFinite(cmd.dx) ? Q(cmd.dx) : 1;
  let dy = Number.isFinite(cmd.dy) ? Q(cmd.dy) : 0;
  const dl = Math.sqrt(dx * dx + dy * dy);
  if (dl < 1e-6) { dx = 1; dy = 0; } else { dx /= dl; dy /= dl; }

  const check = explainPlacement(state, tool, x, y, cmd.mountId ?? null);
  if (!check.ok) return reject(check.reason);

  const id = state.nextToolId++;
  const placed = {
    id, type: tool, x: check.x, y: check.y, dx, dy,
    status: def.passive ? 'passive' : 'armed', ticksLeft: 0,
    mountId: def.placement === 'mount' ? cmd.mountId : null,
  };

  if (tool === 'pad') {
    addSegment(state.world, check.x - def.half, check.y, check.x + def.half, check.y, MAT.RUBBER, def.boost);
  } else if (tool === 'weight') {
    const bodyIdx = state.bodies.length;
    const pi = addParticle(state.world, check.x, check.y, def.r, def.m, MAT.METAL, bodyIdx);
    state.world.particles[pi].pinned = true; // hangs until triggered
    state.bodies.push({ kind: 'weight', start: pi, count: 1, spawnX: check.x, spawnY: check.y, toolId: id });
  } else if (tool === 'piston') {
    const m = state.mounts.find(mm => mm.id === cmd.mountId);
    if (m) m.occupiedBy = id;
  }

  state.tools.push(placed);
  state.stock[tool]--;
  state.stats.toolUses++;
  events.push({ t: 'place', tool, id, x: check.x, y: check.y });
  return { accepted: true, reason: null, events, toolId: id };
}

function doTrigger(state, cmd, reject, events) {
  const tool = state.tools.find(t => t.id === cmd.toolId);
  if (!tool) return reject(INVALID.NO_SUCH_TOOL);
  if (tool.status !== 'armed') return reject(INVALID.ALREADY_SPENT);
  const def = TOOLS[tool.type];

  if (tool.type === 'piston') {
    for (const p of state.world.particles) {
      if (p.pinned) continue;
      const rx = p.x - tool.x, ry = p.y - tool.y;
      const along = rx * tool.dx + ry * tool.dy;
      if (along <= 0 || along > def.range) continue;
      const perpx = rx - along * tool.dx, perpy = ry - along * tool.dy;
      const halfW = def.coneBase + along * def.coneGrow;
      if (perpx * perpx + perpy * perpy > halfW * halfW) continue;
      const fall = 1 - 0.5 * (along / def.range);
      impulse(p, tool.dx * def.power * fall, tool.dy * def.power * fall);
    }
    tool.status = 'spent';
  } else if (tool.type === 'fan' || tool.type === 'magnet') {
    tool.status = 'active';
    tool.ticksLeft = def.duration;
    state.world.fields.push({
      kind: tool.type, owner: tool.id, x: tool.x, y: tool.y,
      dx: tool.dx, dy: tool.dy, range: def.range,
      width: def.width || 0, strength: def.strength, ticksLeft: def.duration,
    });
  } else if (tool.type === 'weight') {
    const body = state.bodies.find(b => b.kind === 'weight' && b.toolId === tool.id);
    if (body) state.world.particles[body.start].pinned = false;
    tool.status = 'spent';
  }
  state.settleStreak = 0; state.settled = false;
  events.push({ t: 'trigger', tool: tool.type, id: tool.id, x: tool.x, y: tool.y });
  return { accepted: true, reason: null, events };
}

function doSkip(state, events) {
  // Fast-forward to the deterministic end state; input stays locked while the
  // session runs this (spec §2 core loop).
  let n = 0;
  while (!state.settled && state.phase !== 'terminal' && n < SKIP_CAP) {
    step(state);
    n++;
  }
  events.push({ t: 'skip', ticks: n });
  return { accepted: true, reason: null, events };
}

// ---------------------------------------------------------------------------
// Simulation step (one fixed tick)
// ---------------------------------------------------------------------------

export function step(state) {
  if (state.phase === 'terminal') return [];
  const w = state.world;
  state.tick++;
  w.events.length = 0;
  stepWorld(w, state.tick);
  const out = [];

  // age fields
  for (let i = w.fields.length - 1; i >= 0; i--) {
    const f = w.fields[i];
    f.ticksLeft--;
    const tool = state.tools.find(t => t.id === f.owner);
    if (tool) tool.ticksLeft = f.ticksLeft;
    if (f.ticksLeft <= 0) {
      w.fields.splice(i, 1);
      if (tool) tool.status = 'spent';
      out.push({ t: 'spent', id: f.owner });
    }
  }

  // style stats
  const ps = w.particles;
  const dummy = state.bodies[state.dummyBody];
  let allAir = true;
  let peakV2 = 0;
  for (let i = dummy.start; i < dummy.start + dummy.count; i++) {
    const p = ps[i];
    if (p.flags & 2) allAir = false;
    const vx = p.x - p.px, vy = p.y - p.py;
    const s2 = vx * vx + vy * vy;
    if (s2 > peakV2) peakV2 = s2;
  }
  if (allAir) state.stats.airTicks++;
  state._dummyAir = allAir;
  const speed = Math.sqrt(peakV2) / DT;
  if (speed > state.stats.peakSpeed) state.stats.peakSpeed = speed;
  const dc = dummyCenter(state);
  const rise = dc.y - dummy.spawnY;
  if (rise > state.stats.peakY) state.stats.peakY = rise;
  // spin: signed turn of the dummy "up" vector (head center - torso center)
  const hx = ps[dummy.start].x - ps[dummy.start + 1].x;
  const hy = ps[dummy.start].y - ps[dummy.start + 1].y;
  const hl = Math.sqrt(hx * hx + hy * hy);
  if (hl > 1e-6) {
    const ux = hx / hl, uy = hy / hl;
    if (state._lastUx !== undefined) {
      state.stats.spinSum += state._lastUx * uy - state._lastUy * ux;
    }
    state._lastUx = ux; state._lastUy = uy;
  }

  // physics events -> engine handling (impact variants for seeded audio)
  for (const ev of w.events) {
    if (ev.t === 'impact' || ev.t === 'boing') {
      ev.variant = (state.streams.rules.next() * 4) | 0;
      out.push(ev);
    }
  }

  // dummy center velocity (for bell rings and accessibility)
  const dcx = dc.x, dcy = dc.y;
  const pvx = state._dcx ?? dcx, pvy = state._dcy ?? dcy;
  state._dummySpeed = Math.sqrt((dcx - pvx) ** 2 + (dcy - pvy) ** 2) / DT;
  state._dcx = dcx; state._dcy = dcy;

  // goal progress checks
  updateGoals(state, out);

  // win detection
  if (state.winSettle < 0 && primaryComplete(state)) {
    state.winSettle = WIN_SETTLE_TICKS;
    if (state.stats.firstGoalTick < 0) state.stats.firstGoalTick = state.tick;
    out.push({ t: 'win-pending' });
  }
  if (state.winSettle > 0) {
    state.winSettle--;
    if (state.winSettle === 0) return terminate(state, TERMINAL.GOAL, out);
  }

  // settle detection
  if (w.maxSpeed2 < SETTLE_EPS * SETTLE_EPS && w.fields.length === 0) {
    state.settleStreak++;
    if (state.settleStreak === SETTLE_TICKS) {
      state.settled = true;
      out.push({ t: 'settled' });
    }
  } else {
    state.settleStreak = 0;
    state.settled = false;
  }

  // terminal: limits (checked every tick; skipped while win pending)
  if (state.winSettle < 0) {
    if (state.tick >= state.options.maxTicks) return terminate(state, TERMINAL.TIME_LIMIT, out);
    if (state.settled) {
      const noStock = Object.values(state.stock).every(v => v <= 0);
      const noArmed = armedTriggerables(state).length === 0;
      if (noStock && noArmed && !primaryComplete(state)) {
        const reason = state.options.moveLimit > 0 && state.stats.toolUses >= state.options.moveLimit
          ? TERMINAL.MOVE_LIMIT : TERMINAL.OUT_OF_ACTIONS;
        return terminate(state, reason, out);
      }
      if (state.options.moveLimit > 0 && state.stats.toolUses >= state.options.moveLimit && !primaryComplete(state)) {
        return terminate(state, TERMINAL.MOVE_LIMIT, out);
      }
    }
  }
  return out;
}

function updateGoals(state, out) {
  const dc = dummyCenter(state);
  for (const g of state.goals) {
    if (g.done) continue;
    switch (g.type) {
      case 'bell': {
        // ring by touching the bell fast enough (center speed at contact)
        const bell = state.level.bells?.[g.bellIndex ?? 0];
        if (!bell) break;
        const need = g.minSpeed ?? bell.minSpeed ?? 2;
        let touching = false;
        const ps = state.world.particles;
        const dmy = state.bodies[state.dummyBody];
        for (let i = dmy.start; i < dmy.start + dmy.count; i++) {
          const p = ps[i];
          const dx = p.x - bell.x, dy = p.y - bell.y;
          const rr = bell.r + p.r + 0.035; // margin: resting contact sits at exact surface distance
          if (dx * dx + dy * dy < rr * rr) { touching = true; break; }
        }
        if (touching) {
          if (state._dummySpeed > g.best) g.best = state._dummySpeed;
          if (!g._touch) {
            g._touch = true;
            out.push({ t: 'bell', x: bell.x, y: bell.y, speed: state._dummySpeed, done: state._dummySpeed >= need });
          }
          if (state._dummySpeed >= need) {
            g.done = true;
            out.push({ t: 'goal', index: g.index, goal: g.type });
          }
        } else if (g._touch) {
          g._touch = false;
        }
        break;
      }
      case 'zone': {
        const dx = dc.x - g.x, dy = dc.y - g.y;
        if (dx * dx + dy * dy < g.r * g.r) {
          g.value++;
          if (g.value >= g.holdTicks) { g.done = true; out.push({ t: 'goal', index: g.index, goal: g.type }); }
        } else if (g.value > 0) {
          g.value = 0; // consecutive hold; reset on exit
        }
        break;
      }
      case 'distance': {
        const fx = g.fromX ?? state.bodies[state.dummyBody].spawnX;
        const fy = g.fromY ?? state.bodies[state.dummyBody].spawnY;
        const dx = dc.x - fx, dy = dc.y - fy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > g.value) g.value = d;
        if (d >= g.dist) { g.done = true; out.push({ t: 'goal', index: g.index, goal: g.type }); }
        break;
      }
      case 'topple': {
        let count = 0;
        for (let bi = 1; bi < state.bodies.length; bi++) {
          const b = state.bodies[bi];
          if (b.kind !== 'crate' || b.toppled) { if (b.toppled) count++; continue; }
          const c = bodyCenter(state, bi);
          const dx = c.x - b.spawnX, dy = c.y - b.spawnY;
          const moved = dx * dx + dy * dy > 0.16;
          // tilt via orientation vector of first edge (dot/cross only)
          const p0 = state.world.particles[b.start], p1 = state.world.particles[b.start + 1];
          const ex = p1.x - p0.x, ey = p1.y - p0.y;
          const el = Math.sqrt(ex * ex + ey * ey) || 1;
          const tilt = Math.abs(ey / el); // |sin| of edge angle vs horizontal
          if (moved || tilt > 0.5) { b.toppled = true; count++; }
        }
        g.value = count;
        if (count >= g.count) { g.done = true; out.push({ t: 'goal', index: g.index, goal: g.type }); }
        break;
      }
      case 'air': {
        g.value = state.stats.airTicks;
        if (state.stats.airTicks >= g.ticks) { g.done = true; out.push({ t: 'goal', index: g.index, goal: g.type }); }
        break;
      }
      case 'speed': {
        g.value = state.stats.peakSpeed;
        if (state.stats.peakSpeed >= g.value2) { g.done = true; out.push({ t: 'goal', index: g.index, goal: g.type }); }
        break;
      }
      case 'score': {
        const s = liveScore(state).total;
        g.value = s;
        if (s >= g.value2) { g.done = true; out.push({ t: 'goal', index: g.index, goal: g.type }); }
        break;
      }
    }
  }
}

function terminate(state, reason, out) {
  state.phase = 'terminal';
  state.terminalReason = reason;
  out.push({ t: 'terminal', reason });
  return out;
}

// Concise navigable model of the board for the accessibility mirror
// (spec §3 accessibility: announce board state, not decoration).
export function summarize(state) {
  const dc = dummyCenter(state);
  const dp = state.world.particles[state.bodies[state.dummyBody].start];
  const vel = particleSpeed(dp);
  return {
    tick: state.tick,
    phase: state.phase,
    terminalReason: state.terminalReason,
    dummy: {
      x: Math.round(dc.x * 100) / 100,
      y: Math.round(dc.y * 100) / 100,
      moving: !state.settled,
      speed: Math.round(vel * 10) / 10,
      airborne: !!state._dummyAir,
    },
    stock: { ...state.stock },
    tools: state.tools.map(t => ({ id: t.id, type: t.type, status: t.status, x: Math.round(t.x * 100) / 100, y: Math.round(t.y * 100) / 100 })),
    goals: state.goals.map(g => ({ type: g.type, primary: g.primary, done: g.done, progress: goalProgressText(g) })),
    score: liveScore(state).total,
  };
}

export function goalProgressText(g) {
  switch (g.type) {
    case 'bell': return g.done ? 'rung' : (g.best > 0 ? `hit at ${g.best.toFixed(1)} m/s (needs ${g.minSpeed ?? 2})` : 'not hit');
    case 'zone': return g.done ? 'held' : `${g.value}/${g.holdTicks} ticks held`;
    case 'distance': return `${g.value.toFixed(2)}/${g.dist} m`;
    case 'topple': return `${g.value}/${g.count} crates`;
    case 'air': return `${g.value}/${g.ticks} ticks airborne`;
    case 'speed': return `${g.value.toFixed(1)}/${g.value2} m/s`;
    case 'score': return `${g.value}/${g.value2} points`;
    default: return g.done ? 'done' : 'pending';
  }
}
