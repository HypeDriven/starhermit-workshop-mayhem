// Platform adapter + canonical StarHermit SDK with a stubbed fetch and a fake
// launch fragment: token read, profile name, cloud save in game:<slug>,
// settings KV patch, control overrides — and zero fetches standalone.
import fs from 'node:fs';
import { suite, ok, eq } from './harness.mjs';
import { Platform } from '../src/platform/client.js';
import { defaultKeyboardCodes, bindingText } from '../src/ui/input.js';

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
  const state = { save: null, settings: {}, controls: null };
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ url, method, auth: init.headers && init.headers.Authorization });
    if (url === '/api/v1/time') return json({ now: Date.now() });
    if (url === `/api/v1/users/${USER}/profile`) return json({ nickname: 'Tinker Tam' });
    if (url.startsWith('/api/v1/me/cloud-saves/')) {
      if (method === 'PUT') {
        state.save = Buffer.from(JSON.parse(init.body).dataBase64, 'base64');
        return new Response(null, { status: 204 });
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
  eq(srv.state.controls, { undo: ['KeyZ'] }, 'rebind persisted');
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
  await p.setControl('undo', ['KeyZ']);
  p.setTelemetryConsent(true);
  p.telemetry('start', { mode: 'boot' });
  p.flushTelemetry();
  eq(srv.calls.length, 0, 'zero fetches');
});
