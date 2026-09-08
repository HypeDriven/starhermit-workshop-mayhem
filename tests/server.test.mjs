// Local dev-server / authoritative-surface regressions (spec §5 untrusted input,
// §6 recoverable errors): no request body may take the process down.
import { suite, eq, ok } from './harness.mjs';
import { startServer, validateScoreClaim } from '../server.js';

async function withServer(fn) {
  const server = startServer(0);
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.close(); }
}

suite('server: hostile request bodies are rejected, not fatal', async () => {
  await withServer(async (base) => {
    const bad = await fetch(`${base}/api/v1/leaderboard/submit`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json',
    });
    eq(bad.status, 400, 'malformed json -> 400');
    eq((await bad.json()).error, 'malformed-json', 'structured error');

    // JSON `null` used to reach `body.events` and kill the process
    const nullBody = await fetch(`${base}/api/v1/telemetry`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: 'null',
    });
    eq(nullBody.status, 200, 'null telemetry body -> 200');
    eq((await nullBody.json()).received, 0, 'no events counted');

    const noLevel = await fetch(`${base}/api/v1/leaderboard/submit`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ board: 'global', levelId: 'nope', score: 1, ticks: 20 }),
    });
    eq(noLevel.status, 400, 'unknown level -> 400');

    const huge = await fetch(`${base}/api/v1/save/regression`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ doc: 'x'.repeat(1_200_000) }),
    });
    eq(huge.status, 413, 'oversized body -> 413');

    // the process is still serving after all of the above
    const alive = await fetch(`${base}/api/v1/time`);
    eq(alive.status, 200, 'server alive');
    ok(Number.isFinite((await alive.json()).now), 'time still answered');
  });
});

suite('server: design documents are not served', async () => {
  await withServer(async (base) => {
    eq((await fetch(`${base}/spec.md`)).status, 403, 'spec.md forbidden');
    eq((await fetch(`${base}/index.html`)).status, 200, 'game still served');
  });
});

suite('server: score claims are validated before they reach a board', () => {
  const base = { ruleset: undefined, contentVersion: undefined, score: 10, ticks: 100 };
  eq(validateScoreClaim(null, null).accepted, false, 'null claim rejected');
  eq(validateScoreClaim({ ...base, ruleset: 'nope' }, null).reason, 'stale-ruleset', 'stale ruleset');
});
