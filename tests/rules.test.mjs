// Rules engine unit tests (spec §9): every legal action, invalid-action
// reason, scoring component, terminal state, serialization migration.
import { suite, eq, ok } from './harness.mjs';
import {
  createGame, applyCommand, step, legalActions, explainPlacement,
  isTerminal, finalScore, liveScore, summarize, makeCommandId,
  INVALID, TERMINAL, TOOLS,
} from '../src/rules/engine.js';
import { serialize, deserialize, cloneState, hashState, migrate } from '../src/rules/serialize.js';
import { compareResults } from '../src/rules/scoring.js';
import { JOURNEY } from '../src/content/stages.js';
import { arena, BOUNDS, stack } from '../src/content/schema.js';

function mkLevel(extra = {}) {
  return {
    id: 'unit', version: 1, seed: 7, name: 'Unit',
    bounds: { ...BOUNDS }, dummy: { x: -3, y: 0 },
    statics: { segments: arena(BOUNDS), circles: [] },
    props: [], mounts: [{ id: 'm1', x: -4.7, y: 0.9 }, { id: 'm2', x: -4.7, y: 2.2 }],
    bells: [{ x: 2.9, y: 0.35, r: 0.42, minSpeed: 1.0 }], zones: [],
    goals: [{ type: 'bell', primary: true, bellIndex: 0, minSpeed: 1.0 }],
    tools: { piston: 1, pad: 1, fan: 1, magnet: 1, weight: 1 },
    par: { ticks: 1200, score: 900, star3: 1400 }, solution: [], ...extra,
  };
}
function settle(s, cap = 4000) { let n = 0; while (!s.settled && s.phase !== 'terminal' && n++ < cap) step(s); }

suite('rules: legal action enumeration at start', () => {
  const s = createGame(mkLevel());
  const la = legalActions(s);
  eq(la.canAct, true, 'canAct');
  eq(la.placements.length, 5, 'all tools placeable');
  eq(la.placements.find(p => p.tool === 'piston').mounts, ['m1', 'm2'], 'mount list');
  eq(la.triggers.length, 0, 'nothing to trigger yet');
  eq(la.undo, false, 'no undo without history/option');
});

suite('rules: place and trigger happy path', () => {
  const s = createGame(mkLevel());
  settle(s);
  let r = applyCommand(s, { id: 'a', type: 'place', tool: 'piston', x: -4.7, y: 0.9, dx: 1, dy: 0.3, mountId: 'm1' });
  ok(r.accepted, 'place accepted');
  eq(s.stock.piston, 0, 'stock consumed');
  eq(s.mounts[0].occupiedBy, r.toolId, 'mount occupied');
  r = applyCommand(s, { id: 'b', type: 'trigger', toolId: r.toolId });
  ok(r.accepted, 'trigger accepted');
  const la = legalActions(s);
  ok(!la.placements.find(p => p.tool === 'piston'), 'no piston left');
  ok(la.placements.find(p => p.tool === 'piston') === undefined, 'piston out of stock');
});

suite('rules: invalid reasons are specific', () => {
  const s = createGame(mkLevel());
  settle(s);
  let r = applyCommand(s, { id: 'a', type: 'place', tool: 'piston', x: -4.7, y: 0.9, dx: 1, dy: 0 });
  eq(r.reason, INVALID.NO_MOUNT, 'no mount id');
  r = applyCommand(s, { id: 'b', type: 'place', tool: 'piston', x: 99, y: 1, dx: 1, dy: 0, mountId: 'm1' });
  eq(r.reason, INVALID.OUT_OF_BOUNDS, 'out of bounds');
  r = applyCommand(s, { id: 'c', type: 'place', tool: 'piston', x: -4.7, y: 0.9, dx: 1, dy: 0, mountId: 'm1' });
  ok(r.accepted);
  r = applyCommand(s, { id: 'd', type: 'place', tool: 'piston', x: -4.7, y: 0.9, dx: 1, dy: 0, mountId: 'm1' });
  eq(r.reason, INVALID.OUT_OF_STOCK, 'stock empty (checked before mount reuse)');
  r = applyCommand(s, { id: 'c', type: 'place', tool: 'piston', x: -4.7, y: 0.9, dx: 1, dy: 0, mountId: 'm1' });
  eq(r.reason, INVALID.DUPLICATE, 'duplicate command id');
  r = applyCommand(s, { id: 'e', type: 'trigger', toolId: 999 });
  eq(r.reason, INVALID.NO_SUCH_TOOL, 'no such tool');
  r = applyCommand(s, { id: 'f', type: 'place', tool: 'fan', x: -3, y: 0.5, dx: 1, dy: 0 });
  eq(r.reason, INVALID.OVERLAP, 'fan overlaps dummy');
  r = applyCommand(s, { id: 'g', type: 'nonsense' });
  eq(r.reason, INVALID.BAD_COMMAND, 'bad command');
  ok(s.stats.invalid >= 6, 'invalids counted');
});

suite('rules: mount occupied vs second piston', () => {
  const s = createGame(mkLevel({ tools: { piston: 2 } }));
  settle(s);
  applyCommand(s, { id: 'a', type: 'place', tool: 'piston', x: -4.7, y: 0.9, dx: 1, dy: 0, mountId: 'm1' });
  const ex = explainPlacement(s, 'piston', -4.7, 0.9, 'm1');
  eq(ex.reason, INVALID.MOUNT_OCCUPIED, 'mount occupied explanation');
  const ex2 = explainPlacement(s, 'piston', -4.7, 2.2, 'm2');
  ok(ex2.ok, 'second mount free');
});

suite('rules: ground snap and not-on-ground', () => {
  const s = createGame(mkLevel());
  settle(s);
  let r = applyCommand(s, { id: 'a', type: 'place', tool: 'pad', x: 0, y: 3.5 });
  eq(r.reason, INVALID.NOT_ON_GROUND, 'mid-air pad rejected');
  r = applyCommand(s, { id: 'b', type: 'place', tool: 'pad', x: 0, y: 0.1 });
  ok(r.accepted, 'pad snaps to floor');
  eq(s.tools[0].y < 0.2, true, 'pad snapped near surface');
});

suite('rules: goal-complete terminal + score components', () => {
  const s = createGame(mkLevel());
  settle(s);
  let r = applyCommand(s, { id: 'a', type: 'place', tool: 'piston', x: -4.7, y: 0.9, dx: 1, dy: 0.3, mountId: 'm1' });
  applyCommand(s, { id: 'b', type: 'trigger', toolId: r.toolId });
  let guard = 0;
  while (s.phase !== 'terminal' && guard++ < 6000) step(s);
  const t = isTerminal(s);
  eq(t.reason, TERMINAL.GOAL, 'goal complete');
  const sc = finalScore(s);
  ok(sc.components.goal === 1000, 'goal component');
  ok(sc.components.efficiency > 0, 'efficiency for unused tools');
  ok(sc.total > 1000, 'total sums components');
  eq(s.stats.invalid, 0, 'no invalids');
});

suite('rules: out-of-actions terminal', () => {
  const s = createGame(mkLevel({ goals: [{ type: 'zone', primary: true, x: 0, y: 6.5, r: 0.2, holdTicks: 10 }], tools: { weight: 1 } }));
  settle(s);
  let r = applyCommand(s, { id: 'a', type: 'place', tool: 'weight', x: 3, y: 3 });
  applyCommand(s, { id: 'b', type: 'trigger', toolId: r.toolId });
  settle(s);
  let guard = 0;
  while (s.phase !== 'terminal' && guard++ < 9000) step(s);
  eq(isTerminal(s).reason, TERMINAL.OUT_OF_ACTIONS, 'out of actions');
});

suite('rules: time-limit terminal', () => {
  const s = createGame(mkLevel({ goals: [{ type: 'zone', primary: true, x: 0, y: 6.5, r: 0.2, holdTicks: 10 }] }));
  s.options.maxTicks = 300;
  let guard = 0;
  while (s.phase !== 'terminal' && guard++ < 1000) step(s);
  eq(isTerminal(s).reason, TERMINAL.TIME_LIMIT, 'time limit');
});

suite('rules: move-limit terminal (challenge)', () => {
  const s = createGame(mkLevel({
    goals: [{ type: 'zone', primary: true, x: 0, y: 6.5, r: 0.2, holdTicks: 10 }],
    challenge: { moveLimit: 1 }, tools: { weight: 1 },
  }));
  s.options.moveLimit = 1;
  settle(s);
  let r = applyCommand(s, { id: 'a', type: 'place', tool: 'weight', x: 3, y: 3 });
  applyCommand(s, { id: 'b', type: 'trigger', toolId: r.toolId });
  settle(s);
  let guard = 0;
  while (s.phase !== 'terminal' && guard++ < 9000) step(s);
  eq(isTerminal(s).reason, TERMINAL.MOVE_LIMIT, 'move limit');
});

suite('rules: skip fast-forwards to settled end state', () => {
  const s = createGame(mkLevel());
  settle(s);
  let r = applyCommand(s, { id: 'a', type: 'place', tool: 'piston', x: -4.7, y: 0.9, dx: 1, dy: 0.3, mountId: 'm1' });
  applyCommand(s, { id: 'b', type: 'trigger', toolId: r.toolId });
  // manual step 10, then skip
  for (let i = 0; i < 10; i++) step(s);
  const s2 = cloneState(s);
  applyCommand(s, { id: 'c', type: 'skip' });
  // reference: run s2 to settled manually (skip stops at settle, not terminal)
  let guard = 0;
  while (!s2.settled && s2.phase !== 'terminal' && guard++ < 6000) step(s2);
  // align command-metadata (the skip command itself) before hashing
  s2.seenIds = [...s.seenIds];
  s2.stats.commands = s.stats.commands;
  eq(hashState(s), hashState(s2), 'skip lands on exact deterministic end state');
});

suite('rules: serialization round-trip + clone equality', () => {
  const s = createGame(mkLevel());
  settle(s);
  let r = applyCommand(s, { id: 'a', type: 'place', tool: 'magnet', x: -3, y: 2.8 });
  applyCommand(s, { id: 'b', type: 'trigger', toolId: r.toolId });
  for (let i = 0; i < 77; i++) step(s);
  const doc = serialize(s);
  const s2 = deserialize(doc, s.level);
  for (let i = 0; i < 100; i++) { step(s); step(s2); }
  eq(hashState(s), hashState(s2), 'deserialized state continues identically');
});

suite('rules: migration v0 -> v1', () => {
  const v0 = {
    v: 0, tick: 10, phase: 'active', terminalReason: null, seed: 1,
    levelId: 'x', levelVersion: 1, options: undefined, mounts: undefined,
    streams: 12345, lastInvalid: undefined,
  };
  const d = migrate(v0);
  eq(d.v, 1, 'migrated to v1');
  ok(d.options && d.mounts && typeof d.streams === 'object', 'defaults filled');
  throwsLike(() => migrate({ v: 99 }), /unsupported state version/, 'future version rejected');
});

function throwsLike(fn, re, msg) {
  try { fn(); } catch (e) { if (re.test(e.message)) return; throw e; }
  throw new Error(msg || 'did not throw');
}

suite('rules: tie-break ordering', () => {
  const A = { total: 1000, tie: { complete: 1, invalid: 0, ticks: 300 } };
  const B = { total: 1000, tie: { complete: 1, invalid: 1, ticks: 300 } };
  const C = { total: 900, tie: { complete: 1, invalid: 0, ticks: 200 } };
  const D = { total: 1200, tie: { complete: 0, invalid: 0, ticks: 100 } };
  ok(compareResults(A, B) < 0, 'fewer invalids wins');
  ok(compareResults(A, C) < 0, 'higher score wins');
  ok(compareResults(A, D) < 0, 'completion beats score');
  ok(compareResults(A, { ...A }, 'aaa', 'bbb') < 0, 'session id final tie-break');
});

suite('rules: summarize exposes navigable board model', () => {
  const s = createGame(mkLevel());
  settle(s);
  const z = summarize(s);
  ok(z.dummy && Number.isFinite(z.dummy.x), 'dummy position');
  eq(z.goals.length, 1, 'goal listed');
  eq(z.goals[0].progress, 'not hit', 'goal progress text');
  ok(z.stock.piston === 1, 'stock exposed');
});

suite('rules: journey stages expose legal actions and summary', () => {
  for (const level of JOURNEY.slice(0, 8)) {
    const s = createGame(level);
    const la = legalActions(s);
    ok(la.placements.length > 0, `${level.id} has placements`);
    settle(s);
    ok(s.settled, `${level.id} settles`);
  }
});
