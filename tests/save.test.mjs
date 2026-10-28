// The engine save: merging two devices' documents and reading the browser
// build's cloud slot (src/session/cloud.js, used by native/platform.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSaves, sameSave, readForeign, normalizeSave, readDoc } from '../src/session/cloud.js';
import { wrapDoc, DEFAULT_PROGRESSION } from '../src/session/persistence.js';

const prog = (over) => ({ ...JSON.parse(JSON.stringify(DEFAULT_PROGRESSION)), ...over });
const save = (p, a) => ({ v: 1, progression: p ? wrapDoc('progression', p) : null, achievements: a ? wrapDoc('achievements', a) : null });

test('merge keeps the best of both devices', () => {
  const a = save(prog({ stars: { j01: 3 }, xp: 100, journey: { furthest: 'j02' } }), { unlocked: { 'first-ring': '2026-01-02' }, seenTools: ['piston'], dailyDays: [1], completionsTotal: 2 });
  const b = save(prog({ stars: { j01: 1, j02: 2 }, xp: 300, journey: { furthest: 'j03' } }), { unlocked: { 'first-ring': '2026-01-01', 'full-toolbox': '2026-02-01' }, seenTools: ['fan'], dailyDays: [2], completionsTotal: 5 });
  const m = mergeSaves(a, b);
  const p = readDoc('progression', m.progression), ach = readDoc('achievements', m.achievements);
  assert.deepEqual(p.stars, { j01: 3, j02: 2 });
  assert.equal(p.totalStars, 5);
  assert.equal(p.xp, 300);
  assert.equal(p.journey.furthest, 'j03');
  assert.deepEqual(Object.keys(ach.unlocked).sort(), ['first-ring', 'full-toolbox']);
  assert.equal(ach.unlocked['first-ring'], '2026-01-01');
  assert.deepEqual(ach.seenTools, ['fan', 'piston']);
  assert.equal(ach.completionsTotal, 5);
  assert.ok(sameSave(mergeSaves(m, a), m), 'merging again changes nothing');
});

test('damaged parts are dropped, a missing side keeps the other', () => {
  const a = save(prog({ stars: { j05: 2 } }), null);
  const bad = { v: 1, progression: { kind: 'progression', v: 2, sum: 'nope', data: {} }, achievements: 7 };
  assert.equal(normalizeSave(bad).progression, null);
  const m = mergeSaves(bad, a);
  assert.equal(readDoc('progression', m.progression).stars.j05, 2);
  assert.equal(m.achievements, null);
});

test('the browser build cloud slot is read', () => {
  const p = prog({ stars: { j01: 2 }, totalStars: 2 });
  const env = JSON.stringify({ kind: 'progression', doc: wrapDoc('progression', p) });
  assert.equal(readDoc('progression', readForeign(env).progression).stars.j01, 2);
  assert.equal(readDoc('progression', readForeign(JSON.stringify(wrapDoc('progression', p))).progression).stars.j01, 2);
  assert.equal(readForeign('not json'), null);
});
