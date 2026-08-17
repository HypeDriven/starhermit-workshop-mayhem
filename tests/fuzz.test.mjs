// Fuzz tests (spec §9): malformed commands and generated content must not
// hang, NaN, create impossible mandatory states, or loop unboundedly.
import { suite, eq, ok } from './harness.mjs';
import { createGame, applyCommand, step, legalActions } from '../src/rules/engine.js';
import { createStream } from '../src/rules/rng.js';
import { dailyLevel } from '../src/content/daily.js';
import { validateLevelShape } from '../src/content/schema.js';

function settle(s, cap = 4000) { let n = 0; while (!s.settled && s.phase !== 'terminal' && n++ < cap) step(s); return n < cap; }

function noNaN(state) {
  return state.world.particles.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)
    && Number.isFinite(p.px) && Number.isFinite(p.py));
}

suite('fuzz: malformed commands rejected without corruption', () => {
  const level = dailyLevel(20454);
  level.tools = { piston: 2, pad: 2, fan: 3, magnet: 3, weight: 2 };
  const s = createGame(level);
  settle(s);
  const junk = [
    null, undefined, 42, 'place', [], {},
    { type: 'place' }, { type: 'place', tool: 'nuclear' },
    { type: 'place', tool: 'fan', x: NaN, y: 0 },
    { type: 'place', tool: 'fan', x: Infinity, y: 0 },
    { type: 'place', tool: 'fan', x: 1e300, y: -1e300 },
    { type: 'place', tool: 'fan', x: 0, y: 0, dx: 0, dy: 0 },
    { type: 'trigger' }, { type: 'trigger', toolId: -1 },
    { type: 'trigger', toolId: 'pwned' },
    { type: 'skip', extra: 'junk' },
    { type: 'place', tool: 'weight', x: '3', y: null },
  ];
  let accepted = 0;
  for (const [i, cmd] of junk.entries()) {
    const r = applyCommand(s, { id: `fz${i}`, ...cmd });
    if (r.accepted) accepted++;
  }
  ok(accepted <= 3, `at most edge-case accepts (got ${accepted})`);
  ok(noNaN(s), 'state still finite');
  // legal play still possible after the junk storm
  const la = legalActions(s);
  ok(la.placements.length > 0 || la.triggers.length > 0, 'still has legal actions');
  settle(s);
  ok(s.settled, 'world still settles');
});

suite('fuzz: 150 daily seeds generate sane, bounded worlds', () => {
  for (let i = 0; i < 150; i++) {
    const level = dailyLevel(20000 + i * 13);
    eq(validateLevelShape(level).length, 0, `shape day ${i}`);
    const s = createGame(level);
    const settledOk = settle(s);
    ok(settledOk, `settles day ${i}`);
    ok(noNaN(s), `finite day ${i}`);
    // random legal-ish activity, then bounded run-out
    const rng = createStream(i);
    for (let c = 0; c < 6 && s.phase !== 'terminal'; c++) {
      const la = legalActions(s);
      const p = la.placements[rng.int(0, la.placements.length - 1)];
      if (p) {
        applyCommand(s, {
          id: `fz${i}-${c}`, type: 'place', tool: p.tool,
          x: -4 + rng.next() * 8, y: 0.3 + rng.next() * 3,
          dx: rng.next() * 2 - 1, dy: rng.next(),
          mountId: p.mounts ? p.mounts[0] : null,
        });
      }
      const t = legalActions(s).triggers[0];
      if (t && rng.next() < 0.5) applyCommand(s, { id: `ft${i}-${c}`, type: 'trigger', toolId: t.toolId });
      for (let k = 0; k < 240; k++) step(s);
    }
    ok(noNaN(s), `finite after play day ${i}`);
    let guard = 0;
    while (s.phase !== 'terminal' && guard++ < (s.options.maxTicks + 4800)) step(s);
    ok(s.phase === 'terminal', `terminates day ${i} (guard ${guard})`);
  }
});

suite('fuzz: extreme tool spam keeps world bounded', () => {
  const level = dailyLevel(20471);
  level.tools = { fan: 40, magnet: 40, weight: 20 };
  const s = createGame(level);
  settle(s);
  const rng = createStream(99);
  let placed = 0;
  for (let i = 0; i < 60; i++) {
    const r = applyCommand(s, {
      id: `sp${i}`, type: 'place', tool: ['fan', 'magnet', 'weight'][i % 3],
      x: -5 + rng.next() * 10, y: 0.5 + rng.next() * 4,
      dx: rng.next() * 2 - 1, dy: rng.next(),
    });
    if (r.accepted) placed++;
  }
  for (const t of s.tools.filter(t => t.status === 'armed')) {
    applyCommand(s, { id: `tg${t.id}`, type: 'trigger', toolId: t.id });
  }
  let guard = 0;
  while (s.phase !== 'terminal' && guard++ < 12000) step(s);
  ok(noNaN(s), `finite after ${placed} tools`);
  ok(s.tick < 12000 + 4800, 'bounded ticks');
});
