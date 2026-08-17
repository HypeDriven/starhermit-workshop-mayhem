// Golden session tests (spec §9): representative easy, medium, hard,
// interrupted, resumed, and terminal sessions with recorded expectations.
import { suite, eq, ok } from './harness.mjs';
import { createGame, step, applyCommand, finalScore } from '../src/rules/engine.js';
import { hashState } from '../src/rules/serialize.js';
import { snapshotSession, restoreSession, createEnvelope, recordCommand, recordStep } from '../src/session/replay.js';
import { journeyById } from '../src/content/stages.js';
import { tutorialById } from '../src/content/tutorials.js';
import GOLDEN from './golden.json' with { type: 'json' };

function settleCap(state, cap = 3600) { let n = 0; while (!state.settled && state.phase !== 'terminal' && n++ < cap) step(state); }

// Replay a level's reference solution; return the outcome fingerprint.
function playSolution(level) {
  const s = createGame(level);
  settleCap(s);
  const armedOf = (k) => s.tools.find(t => t.status === 'armed' && (!k || t.type === k));
  let cmdN = 0;
  for (const e of level.solution) {
    if (s.phase === 'terminal') break;
    if (e.do === 'wait') { for (let i = 0; i < e.ticks && s.phase !== 'terminal'; i++) step(s); continue; }
    if (e.do === 'place') {
      settleCap(s);
      if (s.phase === 'terminal') break;
      applyCommand(s, { id: `g${cmdN++}`, type: 'place', tool: e.tool, x: e.x, y: e.y, dx: e.dx ?? 1, dy: e.dy ?? 0, mountId: e.mountId ?? null });
      continue;
    }
    if (e.do === 'trigger') {
      const t = armedOf(e.tool);
      if (t) applyCommand(s, { id: `g${cmdN++}`, type: 'trigger', toolId: t.id });
    }
  }
  settleCap(s);
  let g = 0;
  while (s.phase !== 'terminal' && g++ < 12000) step(s);
  return s;
}

function fingerprint(s) {
  const sc = finalScore(s);
  return {
    reason: s.terminalReason,
    tick: s.tick,
    total: sc.total,
    components: sc.components,
    hash: hashState(s),
  };
}

for (const [key, levelId] of [['easy', 't1'], ['medium', 'j16'], ['hard', 'j40']]) {
  suite(`golden: ${key} session (${levelId}) matches recorded fingerprint`, () => {
    const level = journeyById(levelId) || tutorialById(levelId);
    const fp = fingerprint(playSolution(level));
    const want = GOLDEN[key];
    eq(fp.reason, want.reason, 'reason');
    eq(fp.total, want.total, 'score');
    eq(fp.tick, want.tick, 'tick');
    eq(fp.hash, want.hash, 'state hash');
  });
}

suite('golden: interrupted + resumed session matches uninterrupted', () => {
  const level = journeyById('j07');
  // uninterrupted
  const whole = playSolution(level);
  const wantHash = hashState(whole);
  // interrupted: play partway, snapshot mid-flight, restore, continue
  const s = createGame(level);
  settleCap(s);
  let r = applyCommand(s, { id: 'p1', type: 'place', tool: level.solution[0].tool, x: level.solution[0].x, y: level.solution[0].y, dx: level.solution[0].dx, dy: level.solution[0].dy, mountId: level.solution[0].mountId });
  applyCommand(s, { id: 'p2', type: 'trigger', toolId: r.toolId });
  for (let i = 0; i < 120; i++) step(s); // mid-flight
  const snap = snapshotSession(s, createEnvelope({ level, seed: level.seed }));
  const restored = restoreSession(JSON.parse(JSON.stringify(snap)), level);
  const s2 = restored.state;
  settleCap(s2);
  let g = 0;
  while (s2.phase !== 'terminal' && g++ < 12000) step(s2);
  // note: command ids differ from playSolution's; physics trajectory must match
  const whole2 = createGame(level);
  settleCap(whole2);
  r = applyCommand(whole2, { id: 'p1', type: 'place', tool: level.solution[0].tool, x: level.solution[0].x, y: level.solution[0].y, dx: level.solution[0].dx, dy: level.solution[0].dy, mountId: level.solution[0].mountId });
  applyCommand(whole2, { id: 'p2', type: 'trigger', toolId: r.toolId });
  g = 0;
  while (whole2.phase !== 'terminal' && g++ < 12000) step(whole2);
  eq(hashState(s2), hashState(whole2), 'resumed session bit-identical');
});

suite('golden: terminal failed session (out-of-actions) stable', () => {
  const level = journeyById('j01');
  const s = createGame(level);
  settleCap(s);
  // waste the only piston into the void
  let r = applyCommand(s, { id: 'w1', type: 'place', tool: 'piston', x: -4.7, y: 0.9, dx: -1, dy: 0.5, mountId: 'mw' });
  applyCommand(s, { id: 'w2', type: 'trigger', toolId: r.toolId });
  let g = 0;
  while (s.phase !== 'terminal' && g++ < 9000) step(s);
  eq(s.terminalReason, 'out-of-actions', 'fails as recorded');
  const sc = finalScore(s);
  eq(sc.primaryComplete, false, 'primary incomplete');
  eq(sc.components.goal, 0, 'no goal points');
});
