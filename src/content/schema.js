// Content schema + authoring helpers. Content is versioned data (spec §2
// difficulty/content): identifier, seed, initial state, goals, allowed
// mechanics, par values, tutorial flags, presentation theme.

export const CONTENT_VERSION = 1;

// --- static geometry helpers -------------------------------------------------
export const floor = (x1, x2, y = 0, mat = 'WOOD') => [x1, y, x2, y, mat];
export const wall = (x, y1, y2, mat = 'WOOD') => [x, y1, x, y2, mat];
export const ledge = (x1, x2, y, mat = 'WOOD') => [x1, y, x2, y, mat];
export const ramp = (x1, y1, x2, y2, mat = 'WOOD') => [x1, y1, x2, y2, mat];
export const peg = (x, y, r, mat = 'WOOD') => [x, y, r, mat];

// Standard arena: floor + both walls around a bounds rect.
export function arena(b, mat = 'WOOD') {
  return [
    floor(b.x, b.x + b.w, b.y, mat),
    wall(b.x, b.y, b.y + b.h, mat),
    wall(b.x + b.w, b.y, b.y + b.h, mat),
  ];
}

export const BOUNDS = { x: -6, y: 0, w: 12, h: 7 };

export const stack = (x, n, baseY = 0) =>
  Array.from({ length: n }, (_, i) => ({ kind: 'crate', x, y: baseY + i * 0.64 }));

export const crateRow = (x0, n, gap = 0.45, baseY = 0) =>
  Array.from({ length: n }, (_, i) => ({ kind: 'crate', x: x0 + i * gap, y: baseY }));

// --- goal constructors --------------------------------------------------------
export const gBell = (bellIndex = 0, minSpeed = 2, primary = true) =>
  ({ type: 'bell', primary, bellIndex, minSpeed });
export const gZone = (x, y, r, holdTicks = 45, primary = true) =>
  ({ type: 'zone', primary, x, y, r, holdTicks });
export const gDistance = (dist, primary = true) => ({ type: 'distance', primary, dist });
export const gTopple = (count, primary = true) => ({ type: 'topple', primary, count });
export const gAir = (ticks, primary = false) => ({ type: 'air', primary, ticks });
export const gSpeed = (value2, primary = true) => ({ type: 'speed', primary, value2 });
export const gScore = (value2, primary = false) => ({ type: 'score', primary, value2 });

// --- solution constructors ----------------------------------------------------
// Solutions are constructive: the same parameters that build the layout build
// the command list, so authored stages are solvable by construction and the
// offline validator proves it by replaying through the real rules engine.
export const sPlace = (tool, x, y, dx = 1, dy = 0, mountId = null) =>
  ({ do: 'place', tool, x, y, dx, dy, mountId });
// Trigger a specific armed tool by key (default: oldest armed tool).
export const sTrigger = (tool = null) => ({ do: 'trigger', tool });

// --- structural validation (cheap invariants; gameplay proof lives in the
// --- offline validator which replays solutions) ------------------------------
export function validateLevelShape(level) {
  const errs = [];
  const need = (cond, msg) => { if (!cond) errs.push(msg); };
  need(level.id && typeof level.id === 'string', 'id');
  need(Number.isInteger(level.version), 'version int');
  need(Number.isInteger(level.seed), 'seed int');
  need(level.name, 'name');
  need(level.bounds && level.bounds.w > 0 && level.bounds.h > 0, 'bounds');
  need(level.dummy && Number.isFinite(level.dummy.x), 'dummy');
  need(level.statics && Array.isArray(level.statics.segments), 'statics.segments');
  need(Array.isArray(level.goals) && level.goals.length > 0, 'goals');
  need(level.goals.some(g => g.primary), 'has primary goal');
  need(level.tools && Object.values(level.tools).some(v => v > 0), 'has tools');
  need(level.par && level.par.ticks > 0 && level.par.score >= 0 && level.par.star3 >= level.par.score, 'par sane');
  need(Array.isArray(level.solution) && level.solution.length > 0, 'solution present');
  for (const g of level.goals) {
    need(['bell', 'zone', 'distance', 'topple', 'air', 'speed', 'score'].includes(g.type), `goal type ${g.type}`);
  }
  for (const s of level.statics.segments) {
    need(s.length >= 4 && s.slice(0, 4).every(Number.isFinite), `segment finite ${s}`);
  }
  for (const b of level.bells || []) {
    need(Number.isFinite(b.x) && Number.isFinite(b.y) && b.r > 0, 'bell finite');
  }
  const inB = (x, y, pad = 0.2) =>
    x >= level.bounds.x - pad && x <= level.bounds.x + level.bounds.w + pad &&
    y >= level.bounds.y - pad && y <= level.bounds.y + level.bounds.h + pad;
  need(inB(level.dummy.x, level.dummy.y, 0.6), 'dummy in bounds');
  for (const m of level.mounts || []) need(inB(m.x, m.y, 0.6), `mount ${m.id} in bounds`);
  for (const b of level.bells || []) need(inB(b.x, b.y, 0.6), 'bell in bounds');
  return errs;
}
