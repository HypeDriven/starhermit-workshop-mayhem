// Offline content validator (spec §2): proves basic legality, reachable goals,
// bounded duration, and absence of soft locks for every content document by
// replaying its constructive reference solution through the real rules engine.
// Usage: node tools/validate-content.mjs [--calibrate] [levelIdFilter]
import { createGame, step, applyCommand, legalActions, dummyCenter, finalScore } from '../src/rules/engine.js';
import { validateLevelShape } from '../src/content/schema.js';
import { JOURNEY, CHALLENGES } from '../src/content/stages.js';
import { TUTORIALS } from '../src/content/tutorials.js';
import { dailyLevel, dailySeed } from '../src/content/daily.js';

const CALIBRATE = process.argv.includes('--calibrate');
const IS_MAIN = !!process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').slice(-3).join('/'));
const filter = IS_MAIN && process.argv.find(a => !a.startsWith('-') && a.endsWith('.js') === false && a.includes('/') === false && !a.includes('validate') && !a.includes('node'));

let failures = 0;
let checked = 0;
const reports = [];

function settleCap(state, cap = 3600) {
  let n = 0;
  while (!state.settled && state.phase !== 'terminal' && n < cap) { step(state); n++; }
  return n;
}

function noNaN(state) {
  for (const p of state.world.particles) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
  }
  return true;
}

export function validateLevel(level, opts = {}) {
  const errs = [];
  const shape = validateLevelShape(level);
  errs.push(...shape);
  if (shape.length) return errs;

  const state = createGame(level, { allowUndo: false, mode: opts.mode || 'journey' });

  // no soft lock at start: at least one legal placement exists
  const la = legalActions(state);
  if (!la.placements.length) errs.push('soft-lock: no legal placements at start');

  // bounded initial settle
  const s0 = settleCap(state);
  if (!state.settled) errs.push(`initial world never settles (${s0} ticks)`);

  // Replay constructive solution. Semantics: the world settles before each
  // placement (placements happen in calm); 'wait' entries run the sim live
  // right after a trigger (timed mid-flight chains); early terminal ends it.
  const armedOf = (key) => state.tools.find(t => t.status === 'armed' && (!key || t.type === key));
  let cmdN = 0;
  for (const entry of level.solution) {
    if (state.phase === 'terminal') break;
    if (entry.do === 'wait') {
      for (let i = 0; i < entry.ticks && state.phase !== 'terminal'; i++) step(state);
      continue;
    }
    if (entry.do === 'place') {
      settleCap(state);
      if (state.phase === 'terminal') break;
      const r = applyCommand(state, {
        id: `sol${cmdN++}`, type: 'place', tool: entry.tool,
        x: entry.x, y: entry.y, dx: entry.dx ?? 1, dy: entry.dy ?? 0,
        mountId: entry.mountId ?? null,
      });
      if (!r.accepted) errs.push(`solution place ${entry.tool}@(${entry.x},${entry.y}) rejected: ${r.reason}`);
      continue;
    }
    if (entry.do === 'trigger') {
      const tool = armedOf(entry.tool);
      if (!tool) { errs.push(`solution trigger: no armed ${entry.tool || 'tool'}`); continue; }
      const r = applyCommand(state, { id: `sol${cmdN++}`, type: 'trigger', toolId: tool.id });
      if (!r.accepted) errs.push(`solution trigger ${tool.type} rejected: ${r.reason}`);
      continue;
    }
    errs.push(`unknown solution entry ${entry.do}`);
  }
  settleCap(state);
  // run out the round
  let guard = 0;
  const maxGuard = level.maxTicks + 4800;
  while (state.phase !== 'terminal' && guard < maxGuard) { step(state); guard++; }
  if (guard >= maxGuard) errs.push('unbounded: round never terminates');

  if (!noNaN(state)) errs.push('NaN in particles');

  const score = finalScore(state);
  if (state.terminalReason !== 'goal-complete') {
    errs.push(`solution fails: terminal=${state.terminalReason} goals=${state.goals.map(g => g.done ? 1 : 0).join('')}`);
  }
  if (state.terminalReason === 'goal-complete' && score.total < level.par.score) {
    errs.push(`par unreachable: solution scores ${score.total} < par ${level.par.score}`);
  }
  if (score.tie.ticks > level.par.ticks && state.terminalReason === 'goal-complete') {
    // not an error: par is a target, solution need not beat it — report only
  }
  if (errs.length === 0 || CALIBRATE) {
    reports.push({
      id: level.id, ticks: score.tie.ticks, total: score.total,
      par: level.par, reason: state.terminalReason,
    });
  }
  return errs;
}

function check(level, mode) {
  checked++;
  const errs = validateLevel(level, { mode });
  if (errs.length) {
    failures++;
    console.log(`FAIL ${level.id} (${level.name})`);
    for (const e of errs) console.log(`   - ${e}`);
  }
}

if (IS_MAIN) {
const journey = JOURNEY.filter(l => !filter || l.id === filter);
const challenges = CHALLENGES.filter(l => !filter || l.id === filter);
const tutorials = TUTORIALS.filter(l => !filter || l.id === filter);
for (const l of journey) check(l, 'journey');
for (const l of challenges) check(l, 'challenge');
for (const l of tutorials) check(l, 'learn');

// daily sweep: 45 deterministic days must all validate
if (!filter) {
  const start = Date.UTC(2026, 0, 1) / 86400000;
  for (let i = 0; i < 45; i++) {
    const day = start + i;
    check(dailyLevel(day), 'daily');
  }
  // daily seed stability
  const a = dailySeed(20000), b = dailySeed(20000);
  if (a !== b) { failures++; console.log('FAIL daily seed not stable'); }
}

if (CALIBRATE) {
  console.log('\n--- calibration report (id: ticks, score, suggested par) ---');
  for (const r of reports) {
    const sugScore = Math.round(r.total * 0.72 / 10) * 10;
    const sugStar3 = Math.round(r.total * 0.92 / 10) * 10;
    const sugTicks = Math.round(r.ticks * 1.6 / 60) * 60;
    console.log(`${r.id}: ticks=${r.ticks} score=${r.total}  par={ticks:${sugTicks},score:${sugScore},star3:${sugStar3}}  (current ${r.par.ticks}/${r.par.score}/${r.par.star3})`);
  }
}
console.log(`\n${checked} levels checked, ${failures} failed`);
process.exit(failures ? 1 : 0);
}
