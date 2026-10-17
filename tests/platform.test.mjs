// Platform adapter + canonical StarHermit SDK with a stubbed fetch and a fake
// launch fragment: token read, profile name, cloud save in game:<slug>,
// settings KV patch, control overrides — and zero fetches standalone.
import fs from 'node:fs';
import { suite, ok, eq } from './harness.mjs';
import { Platform } from '../src/platform/client.js';
import { defaultKeyboardCodes, bindingText } from '../src/ui/input.js';
import { mergeProgression } from '../src/session/persistence.js';

const SDK_SRC = fs.readFileSync(new URL('../starhermit-sdk.js', import.meta.url), 'utf8');
function loadSdk() {
  const m = { exports: {} };
  new Function('module', 'exports', SDK_SRC)(m, m.exports);
  return m.exports;
}
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const SLUG = 'mayhem-test';
const USER = 'abcdef12-3456-7890-abcd-ef1234567890';
const JWT = 'x.' + b64url({ sub: USER, game_scope: SLUG, exp: Math.floor(Date.now() / 1000) + 3600 }) + '.y';
const noTimers = { setTimeout: () => 0, clearTimeout: () => {} };

function fakeWindow(hash) {
  return {
    location: { hash, search: '', pathname: '/', hostname: 'localhost', href: 'http://localhost/' + hash, origin: 'http://localhost' },
    history: { state: null, replaceState(_s, _t, url) { this.url = url; } },
  };
}
function stubServer() {
  const calls = [];
  const state = { save: null, etag: null, version: 0, settings: {}, controls: null };
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ url, method, auth: init.headers && init.headers.Authorization });
    if (url === '/api/v1/time') return json({ now: Date.now() });
    if (url === `/api/v1/users/${USER}/profile`) return json({ nickname: 'Tinker Tam' });
    if (url.startsWith('/api/v1/me/cloud-saves/')) {
      // Versioned slot: conditional writes (If-Match / If-None-Match) answer 412 on a stale version.
      if (url.endsWith('/info')) return json(state.save ? { exists: true, etag: state.etag } : { exists: false });
      if (method === 'PUT') {
        const h = init.headers || {};
        if ((h['If-Match'] && h['If-Match'] !== state.etag) || (h['If-None-Match'] === '*' && state.save)) {
          return new Response(JSON.stringify({ error: 'precondition_failed', etag: state.etag }), { status: 412, headers: { 'content-type': 'application/json' } });
        }
        state.save = Buffer.from(JSON.parse(init.body).dataBase64, 'base64');
        state.etag = '"v' + ++state.version + '"';
        return json({ etag: state.etag });
      }
      return state.save ? new Response(state.save) : new Response(null, { status: 404 });
    }
    if (url === `/api/v1/games/${SLUG}/settings`) {
      if (method === 'PATCH') Object.assign(state.settings, JSON.parse(init.body).settings);
      return json({ settings: state.settings });
    }
    if (url === `/api/v1/games/${SLUG}/controls`) {
      if (method === 'PUT') { state.controls = JSON.parse(init.body).bindings; return json({ ok: true }); }
      return json({ actions: [{ action: 'hint', codes: ['KeyY', 'KeyJ'] }] });
    }
    return new Response(null, { status: 404 });
  };
  return { fetch, calls, state };
}

suite('platform: hosted token, profile, cloud save game:<slug>, settings, controls', async () => {
  const srv = stubServer();
  const win = fakeWindow('#game_token=' + JWT);
  const sh = loadSdk().create({ window: win, fetch: srv.fetch, ...noTimers });
  sh.init();
  eq(sh.token, JWT, 'token read');
  eq(win.history.url, '/', 'token stripped');
  const p = new Platform(sh);
  ok(p.hosted, 'hosted');
  eq(p.slug, SLUG, 'slug from game_scope');
  eq(await p.loadAccountProfile(), 'Tinker Tam', 'nickname');

  p.cloudSave('progression', { totalStars: 9 });
  await p.flushCloudSave();
  const put = srv.calls.find((c) => c.method === 'PUT');
  eq(put.url, '/api/v1/me/cloud-saves/' + encodeURIComponent('game:' + SLUG), 'cloud-save path');
  eq((await p.cloudLoad('progression')).doc.totalStars, 9, 'cloud round-trip');

  p.patchSettings({ lastTheme: 'neon' });
  await new Promise((r) => setImmediate(r));
  eq(srv.state.settings, { lastTheme: 'neon' }, 'settings patched');
  eq((await p.getSettings()).lastTheme, 'neon', 'settings read back');
  const bound = await p.loadBindings(defaultKeyboardCodes());
  eq(bound.hint, ['KeyY', 'KeyJ'], 'platform override');
  eq(bound.undo, ['KeyU'], 'default kept');
  eq(bindingText(bound.hint), 'Y / J', 'binding label');
  await p.setControl('undo', ['KeyZ']);
  // the SDK PUTs the player's full override set
  eq(srv.state.controls, { hint: ['KeyY', 'KeyJ'], undo: ['KeyZ'] }, 'rebind persisted');
  ok(new RegExp(`/game-invite/${USER}/${SLUG}$`).test(p.inviteLink()), 'invite link');
  ok(srv.calls.every((c) => c.auth === 'Bearer ' + JWT), 'bearer on every call');

  let seen = null;
  p.onAuthChange = (v) => { seen = v; };
  sh.signOut('expired');
  eq(seen, false, 'sign-out reported');
  eq(p.hosted, false, 'back to local play');
});

suite('platform: standalone makes no fetch at all', async () => {
  const srv = stubServer();
  const sh = loadSdk().create({ window: fakeWindow(''), fetch: srv.fetch });
  sh.init();
  const p = new Platform(sh);
  eq(p.hosted, false, 'not hosted');
  eq(p.canSignIn(), false, 'no sign-in locally');
  await p.syncTime();
  p.startActivity();
  p.cloudSave('progression', {});
  await p.flushCloudSave();
  p.patchSettings({ lastTheme: 'x' });
  eq(await p.getSettings(), {}, 'no remote settings');
  eq((await p.cloudLoad('progression')).error, 'not-hosted', 'no cloud');
  await p.fetchBoard('global');
  eq(await p.postScore(500), { posted: false, rank: null }, 'no score post standalone');
  await p.setControl('undo', ['KeyZ']);
  p.setTelemetryConsent(true);
  p.telemetry('start', { mode: 'boot' });
  p.flushTelemetry();
  eq(srv.calls.length, 0, 'zero fetches');
});

suite('platform: save conflict raises onConflict; reload + merge + save lands', async () => {
  const srv = stubServer();
  const sh = loadSdk().create({ window: fakeWindow('#game_token=' + JWT), fetch: srv.fetch, ...noTimers });
  sh.init();
  const p = new Platform(sh);
  eq((await p.cloudLoad('progression')).doc, null, 'empty slot');

  // another device writes first
  const other = loadSdk().create({ window: fakeWindow('#game_token=' + JWT), fetch: srv.fetch, ...noTimers });
  other.init();
  await other.loadJSON();
  ok(await other.writeSave(JSON.stringify({ kind: 'progression', doc: { stars: { j02: 2 }, xp: 80 } })), 'other device saved');

  let conflicts = 0;
  p.onConflict = async () => {
    conflicts++;
    const remote = (await p.cloudLoad('progression')).doc;
    eq(remote.stars, { j02: 2 }, 'reload sees the other device');
    eq(sh.saveConflicted(), false, 'reload clears the conflict');
    const merged = mergeProgression({ stars: { j01: 3 }, xp: 50 }, remote);
    p.cloudSave('progression', merged);
    await p.flushCloudSave();
  };
  p.cloudSave('progression', { stars: { j01: 3 }, xp: 50 });
  await p.flushCloudSave(); // 412: stale version
  for (let i = 0; i < 40 && conflicts === 0; i++) await new Promise((r) => setImmediate(r));
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  eq(conflicts, 1, 'one conflict');
  const final = await other.loadJSON();
  eq(final.doc.stars, { j02: 2, j01: 3 }, 'both devices kept');
  eq(final.doc.xp, 80, 'larger XP kept');
  p.onConflict = null;
  sh.signOut('expired');
});

suite('platform: progression merge keeps both devices\' progress', () => {
  const m = mergeProgression(
    { stars: { j01: 3, j02: 1 }, bestScores: { j01: { total: 900, ticks: 400 } }, xp: 300, totals: { plays: 12, completions: 5, bestStreak: 1 },
      journey: { furthest: 'j03' }, cosmetics: { theme: 'tidepool', trail: 'confetti', dummyTrim: null } },
    { stars: { j02: 3, j05: 2 }, bestScores: { j01: { total: 950, ticks: 500 }, j05: { total: 700, ticks: 300 } }, xp: 200, totals: { plays: 20, completions: 4, bestStreak: 3 },
      journey: { furthest: 'j06' }, cosmetics: { theme: 'brassworks', trail: 'confetti', dummyTrim: null } },
  );
  eq(m.stars, { j02: 3, j05: 2, j01: 3 }, 'best stars per stage');
  eq(m.totalStars, 8, 'total recomputed');
  eq(m.bestScores.j01.total, 950, 'better score kept');
  eq(m.bestScores.j05.total, 700, 'remote-only score kept');
  eq(m.xp, 300, 'larger xp');
  eq(m.totals, { plays: 20, completions: 5, bestStreak: 3 }, 'larger totals');
  eq(m.journey.furthest, 'j06', 'furthest frontier');
  eq(m.cosmetics.theme, 'tidepool', 'local cosmetic choice');
});

suite('platform: hosted domain without a token offers sign-in (UUID host)', async () => {
  const win = fakeWindow('');
  win.location.hostname = '0b9d6f2e-3c4a-4e5b-9a7c-1d2e3f405162.starhermit.com';
  win.location.origin = 'https://' + win.location.hostname;
  win.location.href = win.location.origin + '/';
  const sh = loadSdk().create({ window: win, fetch: stubServer().fetch, ...noTimers });
  sh.init();
  const p = new Platform(sh);
  eq(p.hosted, false, 'no token');
  eq(p.canSignIn(), true, 'sign-in offered on a UUID host');
});
