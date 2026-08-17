// Trace a level's solution replay: trajectory, goal events, terminal reason.
// Usage: node tools/trace-level.mjs j02 [j03 ...]
import { createGame, step, applyCommand, dummyCenter, finalScore } from '../src/rules/engine.js';
import { JOURNEY, CHALLENGES } from '../src/content/stages.js';
import { TUTORIALS } from '../src/content/tutorials.js';
import { dailyLevel } from '../src/content/daily.js';

const all = [...JOURNEY, ...CHALLENGES, ...TUTORIALS];
for (const id of process.argv.slice(2)) {
  const level = all.find(l => l.id === id) || dailyLevel(parseInt(id.replace('d', ''), 10));
  if (!level) { console.log(`no level ${id}`); continue; }
  console.log(`\n=== ${level.id} ${level.name} ===`);
  console.log('goals:', level.goals.map(g => `${g.type}${g.primary ? '*' : ''}`).join(', '),
    '| bells:', JSON.stringify(level.bells), '| zones:', JSON.stringify(level.zones),
    '| tools:', JSON.stringify(level.tools));
  const s = createGame(level);
  while (!s.settled && s.phase !== 'terminal') step(s);
  console.log(`settled at tick ${s.tick}, dummy at ${JSON.stringify(dummyCenter(s))}`);
  const armedOf = (key) => s.tools.find(t => t.status === 'armed' && (!key || t.type === key));
  let cmdN = 0;
  for (const entry of level.solution) {
    if (s.phase === 'terminal') { console.log('  [terminal during replay]', s.terminalReason); break; }
    if (entry.do === 'wait') {
      let i = 0;
      for (; i < entry.ticks && s.phase !== 'terminal'; i++) {
        const evs = step(s);
        for (const e of evs) if (['bell', 'goal', 'terminal', 'boing'].includes(e.t)) console.log(`    t${s.tick} ${e.t}`, JSON.stringify(e).slice(0, 120));
        if (i % 30 === 0) { const c = dummyCenter(s); console.log(`    t${s.tick} dummy (${c.x.toFixed(2)}, ${c.y.toFixed(2)})`); }
      }
      continue;
    }
    if (entry.do === 'place') {
      let n = 0;
      while (!s.settled && s.phase !== 'terminal' && n < 4000) {
        const evs = step(s); n++;
        for (const e of evs) if (['bell', 'goal', 'terminal', 'boing'].includes(e.t)) console.log(`    t${s.tick} ${e.t}`, JSON.stringify(e).slice(0, 120));
        if (n % 60 === 0) { const c = dummyCenter(s); console.log(`    t${s.tick} dummy (${c.x.toFixed(2)}, ${c.y.toFixed(2)})`); }
      }
      if (n) { const c = dummyCenter(s); console.log(`    settled@t${s.tick} dummy (${c.x.toFixed(2)}, ${c.y.toFixed(2)})`); }
      const r = applyCommand(s, { id: `t${cmdN++}`, type: 'place', tool: entry.tool, x: entry.x, y: entry.y, dx: entry.dx ?? 1, dy: entry.dy ?? 0, mountId: entry.mountId ?? null });
      console.log(`  place ${entry.tool} @(${entry.x},${entry.y}) aim(${entry.dx},${entry.dy}) -> ${r.accepted ? 'ok' : r.reason}`);
      continue;
    }
    if (entry.do === 'trigger') {
      const tool = armedOf(entry.tool);
      if (!tool) { console.log(`  trigger ${entry.tool || ''}: NO ARMED TOOL`); continue; }
      const r = applyCommand(s, { id: `t${cmdN++}`, type: 'trigger', toolId: tool.id });
      console.log(`  trigger ${tool.type} (t${s.tick}) -> ${r.accepted ? 'ok' : r.reason}`);
      continue;
    }
  }
  let guard = 0;
  while (s.phase !== 'terminal' && guard++ < 8000) step(s);
  const sc = finalScore(s);
  console.log(`  END: ${s.terminalReason} tick=${s.tick} goals=${s.goals.map(g => g.done ? 1 : 0).join('')} score=${sc.total} peakSpeed=${s.stats.peakSpeed.toFixed(1)} air=${s.stats.airTicks}`);
}
