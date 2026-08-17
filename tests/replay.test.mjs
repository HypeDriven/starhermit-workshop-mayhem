// Deterministic replay property tests (spec §9): same version, seed, and
// commands produce identical state hashes; replay envelopes verify.
import { suite, eq, ok } from './harness.mjs';
import { createGame, applyCommand, step, legalActions } from '../src/rules/engine.js';
import { hashState } from '../src/rules/serialize.js';
import { createEnvelope, recordCommand, recordStep, verifyReplay } from '../src/session/replay.js';
import { createStream } from '../src/rules/rng.js';
import { JOURNEY, CHALLENGES } from '../src/content/stages.js';
import { dailyLevel } from '../src/content/daily.js';

function settle(s, cap = 4000) { let n = 0; while (!s.settled && s.phase !== 'terminal' && n++ < cap) step(s); }

// Play a scripted sequence of random-but-legal commands.
function randomSession(level, rng, withEnvelope) {
  const s = createGame(level, { seed: level.seed });
  const env = withEnvelope ? createEnvelope({ level, seed: level.seed, mode: 'journey' }) : null;
  settle(s);
  let cmdSeq = 0; // per-session deterministic ids (live sessions use makeCommandId)
  const nCmd = rng.int(2, 6);
  for (let c = 0; c < nCmd && s.phase !== 'terminal'; c++) {
    const la = legalActions(s);
    if (!la.placements.length && !la.triggers.length) break;
    let cmd = null;
    if (la.triggers.length && rng.next() < 0.6) {
      const t = la.triggers[rng.int(0, la.triggers.length - 1)];
      cmd = { id: `rt${cmdSeq++}`, type: 'trigger', toolId: t.toolId };
    } else if (la.placements.length) {
      const p = la.placements[rng.int(0, la.placements.length - 1)];
      const b = level.bounds;
      const x = b.x + 0.5 + rng.next() * (b.w - 1);
      const y = b.y + 0.3 + rng.next() * (b.h * 0.6);
      const ang = rng.next() * 6.2832;
      cmd = {
        id: `rt${cmdSeq++}`, type: 'place', tool: p.tool,
        x, y, dx: Math.cos(ang), dy: Math.sin(ang),
        mountId: p.mounts ? p.mounts[rng.int(0, p.mounts.length - 1)] : null,
      };
    }
    if (!cmd) continue;
    const r = env ? recordCommand(s, env, cmd) : applyCommand(s, cmd);
    const steps = rng.int(30, 600);
    for (let i = 0; i < steps && s.phase !== 'terminal'; i++) {
      if (env) recordStep(s, env); else step(s);
    }
  }
  let guard = 0;
  while (s.phase !== 'terminal' && guard++ < 9000) {
    if (env) recordStep(s, env); else step(s);
  }
  return { state: s, envelope: env };
}

suite('replay: same seed + commands -> identical hashes (10 sessions)', () => {
  const rng = createStream(20260817);
  const pool = [...JOURNEY.slice(0, 12), ...CHALLENGES.slice(0, 3), dailyLevel(20454)];
  for (let i = 0; i < 10; i++) {
    const level = pool[rng.int(0, pool.length - 1)];
    const a = randomSession(level, createStream(5000 + i), false);
    const b = randomSession(level, createStream(5000 + i), false);
    // makeCommandId is global-monotonic; seenIds differ but that's UI-level.
    eq(hashState(a.state) === hashState(b.state), true, `session ${i} (${level.id}) hashes match`);
  }
});

suite('replay: envelopes verify against fresh rules (8 sessions)', () => {
  const rng = createStream(777);
  const pool = [...JOURNEY.slice(4, 14), dailyLevel(20460)];
  for (let i = 0; i < 8; i++) {
    const level = pool[rng.int(0, pool.length - 1)];
    const { envelope } = randomSession(level, createStream(9000 + i), true);
    const v = verifyReplay(envelope, level);
    ok(v.valid, `envelope ${i} (${level.id}) verifies: ${v.reason}`);
  }
});

suite('replay: tampered envelopes are rejected', () => {
  const level = JOURNEY[0];
  const { envelope } = randomSession(level, createStream(31337), true);
  const good = verifyReplay(envelope, level);
  ok(good.valid, 'baseline verifies');
  const tamperedScore = JSON.parse(JSON.stringify(envelope));
  tamperedScore.terminal.score.total += 500;
  eq(verifyReplay(tamperedScore, level).valid, false, 'score tamper rejected');
  const tamperedCmd = JSON.parse(JSON.stringify(envelope));
  const firstPlace = tamperedCmd.commands.find(c => c.type === 'place' && c.accepted);
  if (firstPlace) firstPlace.dy += 0.37;
  else tamperedCmd.commands[0].toolId = 999;
  eq(verifyReplay(tamperedCmd, level).valid, false, 'command tamper rejected');
  const wrongVersion = JSON.parse(JSON.stringify(envelope));
  wrongVersion.levelVersion = 999;
  eq(verifyReplay(wrongVersion, level).valid, false, 'version mismatch rejected');
});
