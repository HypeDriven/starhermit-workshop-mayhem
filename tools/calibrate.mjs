// Physics calibration harness. Measures canonical "plays" (punch slide/arc
// distance vs aim, pad bounce, fan push, magnet lift) so content archetypes
// place goals inside proven-reachable envelopes. Run: node tools/calibrate.mjs
import { createGame, step, applyCommand, dummyCenter } from '../src/rules/engine.js';
import { BOUNDS, arena } from '../src/content/schema.js';

function mkLevel(extra = {}) {
  return {
    id: 'cal', version: 1, seed: 1, name: 'cal',
    bounds: { ...BOUNDS }, dummy: { x: -3, y: 0 },
    statics: { segments: arena(BOUNDS), circles: [] },
    props: [], mounts: [{ id: 'm1', x: -4.7, y: 0.9 }],
    bells: [], zones: [],
    goals: [{ type: 'zone', primary: true, x: 0, y: 6.6, r: 0.2, holdTicks: 1 }],
    tools: { piston: 1, pad: 1, fan: 1, magnet: 1, weight: 1 },
    par: { ticks: 1200, score: 1, star3: 2 }, solution: [], ...extra,
  };
}
function settle(s, cap = 3600) {
  let n = 0;
  while (!s.settled && s.phase !== 'terminal' && n < cap) { step(s); n++; }
  return n;
}
function punch(dy, prep = null) {
  const s = createGame(mkLevel());
  settle(s);
  if (prep) prep(s);
  const r = applyCommand(s, { id: 'c1', type: 'place', tool: 'piston', x: -4.7, y: 0.9, dx: 1, dy, mountId: 'm1' });
  applyCommand(s, { id: 'c2', type: 'trigger', toolId: r.toolId });
  let peakY = 0, peakX = -99;
  while (!s.settled && s.phase !== 'terminal') {
    step(s);
    const c = dummyCenter(s);
    if (c.y > peakY) peakY = c.y;
    if (c.x > peakX) peakX = c.x;
  }
  const c = dummyCenter(s);
  return { endX: c.x, peakX, peakY, peakSpeed: s.stats.peakSpeed, airTicks: s.stats.airTicks };
}

console.log('--- punch aim sweep (mount -4.7,0.9; dummy -3,0) ---');
for (const dy of [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.45, 0.6, 0.85]) {
  const r = punch(dy);
  console.log(`dy=${dy}  endX=${r.endX.toFixed(2)} peakX=${r.peakX.toFixed(2)} peakY=${r.peakY.toFixed(2)} v=${r.peakSpeed.toFixed(1)} air=${r.airTicks}`);
}
console.log('--- punch with pad at x=-1.0 ---');
for (const dy of [0.1, 0.2, 0.3, 0.45]) {
  const r = punch(dy, (s) => {
    applyCommand(s, { id: 'p1', type: 'place', tool: 'pad', x: -1.0, y: 0.05 });
  });
  console.log(`dy=${dy}  endX=${r.endX.toFixed(2)} peakX=${r.peakX.toFixed(2)} peakY=${r.peakY.toFixed(2)} v=${r.peakSpeed.toFixed(1)} air=${r.airTicks}`);
}
console.log('--- fan push (fan behind dummy at dx) ---');
for (const back of [0.8, 1.2, 1.8]) {
  const s = createGame(mkLevel());
  settle(s);
  const r = applyCommand(s, { id: 'f1', type: 'place', tool: 'fan', x: -3 - back, y: 0.7, dx: 1, dy: 0.08 });
  applyCommand(s, { id: 'f2', type: 'trigger', toolId: r.toolId });
  settle(s);
  console.log(`back=${back} endX=${dummyCenter(s).x.toFixed(2)}`);
}
console.log('--- magnet lift (magnet above at h) ---');
for (const h of [2.2, 2.8, 3.4]) {
  const s = createGame(mkLevel());
  settle(s);
  const r = applyCommand(s, { id: 'm1', type: 'place', tool: 'magnet', x: -3, y: h });
  applyCommand(s, { id: 'm2', type: 'trigger', toolId: r.toolId });
  let peakY = 0;
  while (!s.settled && s.phase !== 'terminal') { step(s); peakY = Math.max(peakY, dummyCenter(s).y); }
  console.log(`h=${h} peakY=${peakY.toFixed(2)} endY=${dummyCenter(s).y.toFixed(2)}`);
}
