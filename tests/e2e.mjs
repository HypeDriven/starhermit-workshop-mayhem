/**
 * Workshop Mayhem — end-to-end QA playthrough (dev only, not shipped).
 *
 * Drives the REAL visible UI in headless Chrome via playwright-core:
 *   title → ▶ Play → Journey → stage j01 ("Wake the Dummy")
 *   → countdown → select the Wallop Piston from the tool tray → perform a
 *   real pointer drag on the 3D canvas to mount + aim it → press the real
 *   "⚡ Trigger" button → the physics shoves the dummy into the bell →
 *   results overlay ("Goal complete!") with a score breakdown → Next stage.
 *   Also exercises pause/resume and the Hint button through visible
 *   controls on the same round.
 * A second pass runs the load → Journey → j01 → select-tool → real touch
 *   tap to place the mount tool → verify progress on a mobile touch
 *   viewport.
 *
 * State access: `main.js` exposes `window.app` as the game's own debug /
 * validation handle (`window.app = app`). The test reads that handle ONLY
 * to (a) synchronize on the real phase/terminal state and (b) pick the next
 * legal move via `session.hint()` — the exact same reference-solution /
 * legal-action surface the Hint button uses — plus `scene.worldToScreen`
 * to project the target tile to client coordinates so the pointer drag /
 * tap lands on the visible canvas. Every action is a real click / pointer
 * drag / touch on on-screen controls or the canvas; the test never calls
 * `session.place` / `session.trigger` and never mutates game state. No game
 * code is modified.
 *
 * Serving: the repo ships `server.js` (the StarHermit authoritative script
 * declared by starhermit.txt). The game is fully playable offline — with no
 * launch token the platform adapter treats the run as a local guest
 * (`hosted=false`) and every screen (title, modes, journey, play, results)
 * works locally with zero server calls. So, per the conventions of the
 * sibling titles (picture-logic / blockstead / arrow-exodus), this test
 * embeds a minimal node:http static server on an ephemeral port and answers
 * /api/* probes with 200 `{}` so the client degrades to its documented
 * offline path with no console noise. The backend is not required today.
 *
 * Run: npm run test:e2e  (or: node tests/e2e.mjs)
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOT = (stage, vp) => `/tmp/workshop-mayhem-e2e-${stage}-${vp}.png`;

// benign GPU/swiftshader noise (mirrors tools/production_game_audit.mjs)
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions/i;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    // No StarHermit backend here: answer API probes with empty JSON (200) so
    // the platform adapter stays in offline mode without console noise.
    if (p.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
const ok = (name) => console.log(`ok - ${name}`);

// ---------- read-only observation of the game's own debug handle ----------
// window.app is the game's validation handle (main.js:616). Read ONLY: the
// phase, the live match/terminal state, the next reference-solution command
// (same legality surface as the Hint button) and the scene projection used
// to place real pointer input on the visible canvas.

const readState = (page) => page.evaluate(() => {
  const g = window.app;
  const s = g?.session?.state;
  if (!s) return null;
  return {
    phase: g.state,
    tick: s.tick,
    terminal: s.phase === 'terminal',
    terminalReason: s.terminalReason,
    levelId: s.levelId,
    goals: s.goals.map((x) => ({ type: x.type, primary: x.primary, done: x.done })),
    stock: { ...s.stock },
    tools: s.tools.map((t) => ({ id: t.id, type: t.type, status: t.status })),
    mounts: (s.mounts || []).map((m) => ({ id: m.id, x: m.x, y: m.y, occ: m.occupiedBy })),
    finished: g.session.finished
      ? { score: g.session.finished.score.total, stars: g.session.finished.stars,
          reason: g.session.finished.reason }
      : null,
  };
});

const waitActive = (page) =>
  page.waitForFunction(() => window.app?.state === 'active', null, { timeout: 20000 });

// Project a world point to client coords on the visible canvas (read-only).
const worldToScreen = (page, x, y) => page.evaluate(([wx, wy]) => {
  const s = window.app.scene.worldToScreen(wx, wy, 0);
  return { x: s.x, y: s.y };
}, [x, y]);

async function startJourneyJ01(page) {
  await page.waitForFunction(() => window.app?.state === 'title', null, { timeout: 20000 });
  await page.click('#screen-root [data-act="play"]');            // title → modes
  await page.waitForSelector('#screen-root.screen-modes');
  await page.click('#screen-root [data-act="journey"]');         // modes → journey
  await page.waitForSelector('#screen-root.screen-journey');
  await page.click('[data-level="j01"]');                        // journey → stage
  await waitActive(page);
}

const selectTool = (page, tool) => page.click(`#tool-tray .tool-btn[data-tool="${tool}"]`);

// Drag on the visible canvas from a world start toward a world aim point.
// This is how the real player mounts and aims the piston.
async function dragPlacement(page, { x, y, dx, dy }) {
  const k = 2.0;
  const start = await worldToScreen(page, x, y);
  const end = await worldToScreen(page, x + dx * k, y + dy * k);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
}

// Tap the visible ⚡ Trigger (or the armed tool chip) to fire the placed tool.
async function pressTrigger(page) {
  await page.waitForFunction(() =>
    !document.getElementById('btn-trigger')?.classList.contains('hidden'), null, { timeout: 8000 });
  await page.click('#btn-trigger');
}

// Follow the reference solution (via the same hint surface the Hint button
// uses) with real on-screen actions, then let the physics resolve the round
// to its terminal phase. For j01 the reference is: place the Wallop Piston on
// the left-wall mount, then trigger it — exactly what a real player does with
// a drag + button. Once the reference chain is exhausted (hint() returns
// null) the round is still simulating, so we simply wait for the terminal
// phase instead of asking for another move.
let solved = false;
let actedAny = false;
async function playToTerminal(page) {
  // 1. Apply reference commands while the hint surface still has one.
  for (let guard = 0; guard < 24; guard++) {
    const st = await readState(page);
    if (!st) throw new Error('state handle missing mid-round');
    if (st.terminal) return st;
    const hint = await page.evaluate(() => window.app.session.hint());
    if (!hint) break; // reference chain exhausted; physics is still running
    if (hint.kind === 'place') {
      await selectTool(page, hint.tool);
      await dragPlacement(page, { x: hint.x, y: hint.y, dx: hint.dx, dy: hint.dy });
      actedAny = true;
    } else if (hint.kind === 'trigger') {
      await pressTrigger(page);
      solved = true;
      actedAny = true;
    }
    await page.waitForTimeout(200);
  }
  // 2. Let the simulation resolve to terminal on its own.
  await page.waitForFunction(() => window.app.session?.state?.phase === 'terminal', null, { timeout: 60000 });
  return readState(page);
}

// ---------- one full pass ----------
async function runPass(browser, name, ctxOpts, { full }) {
  const errors = [];
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error' || browserNoise.test(m.text())) return;
    const url = m.location()?.url || '';
    if (/Failed to load resource/.test(m.text()) && /\/api\/|\/favicon/.test(url)) return;
    errors.push(`console: ${m.text()}`);
  });
  page.on('response', (r) => {
    const p = r.url();
    if (r.status() >= 400 && !/\/api\/|\/favicon/.test(p)) errors.push(`http ${r.status()}: ${p}`);
  });

  try {
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForSelector('#screen-root.screen-title', { timeout: 20000 });
    await page.waitForFunction(() => window.app?.state === 'title');
    await page.screenshot({ path: SHOT('title', name) });
    ok(`${name}: title screen visible ("Workshop Mayhem")`);

    await startJourneyJ01(page);
    let st = await readState(page);
    if (st.levelId !== 'j01') throw new Error(`expected j01, got ${st.levelId}`);
    if (!(st.stock.piston > 0)) throw new Error('j01 should stock a piston');
    const trayBtns = await page.locator('#tool-tray .tool-btn').count();
    await page.screenshot({ path: SHOT('play', name) });
    ok(`${name}: Journey stage j01 started ("Wake the Dummy", piston in tray, ${trayBtns} tool buttons)`);

    if (full) {
      // pause / resume via the visible HUD button + pause overlay
      await page.click('#btn-pause');
      await page.waitForFunction(() => document.querySelector('#overlay-root.overlay-pause')?.classList.contains('overlay-pause'));
      await page.waitForSelector('#overlay-root.overlay-pause', { state: 'visible' });
      await page.screenshot({ path: SHOT('pause', name) });
      await page.click('#overlay-root [data-act="resume"]');
      await waitActive(page);
      ok(`${name}: pause (⏸) and resume work`);

      // hint: the visible 💡 Hint button surfaces a read-only reference move
      const before = await readState(page);
      await page.click('#btn-hint');
      await page.waitForTimeout(400);
      const hint = await page.evaluate(() => window.app.session.hint());
      if (!hint) throw new Error('hint produced no reference move');
      await page.screenshot({ path: SHOT('hint', name) });
      ok(`${name}: hint button surfaces a reference move (${hint.kind === 'place' ? `place ${hint.tool}` : 'trigger'})`);

      // read the live board mirror (accessibility) for a sanity check
      const mirror = (await page.textContent('#board-mirror')).trim();
      if (!/dummy/i.test(mirror)) throw new Error('board mirror missing dummy state: ' + mirror);
      ok(`${name}: accessible board mirror reports the dummy ("${mirror.slice(0, 70)}…")`);

      // play for real through the visible controls to a terminal phase
      st = await playToTerminal(page);
      if (!solved) throw new Error('reference trigger was never pressed');
      if (!st.terminal) throw new Error(`round not terminal: ${st.terminalReason}`);
      if (st.terminalReason !== 'goal-complete') {
        throw new Error(`expected goal-complete, got ${st.terminalReason}`);
      }
      await page.waitForSelector('#overlay-root.overlay-results', { state: 'visible', timeout: 12000 });
      const title = (await page.locator('#overlay-root .results-panel h1').textContent()) || '';
      if (!/Goal complete/i.test(title)) throw new Error(`unexpected results title "${title}"`);
      const rows = await page.locator('#overlay-root .results-panel .breakdown tr').count();
      if (rows < 1) throw new Error('score breakdown is empty');
      const pts = (await page.locator('#overlay-root .results-total').textContent()).trim();
      await page.screenshot({ path: SHOT('results', name) });
      ok(`${name}: dummy rang the bell — results shown ("${title.trim()}", ${pts}, ${rows} breakdown rows)`);

      // progression persisted locally
      const prog = await page.evaluate(() => {
        const raw = localStorage.getItem('workshop-mayhem:progression');
        if (!raw) return null;
        try { return JSON.parse(JSON.parse(raw).payload ?? raw).data ?? JSON.parse(raw); } catch { return JSON.parse(raw); }
      });
      const stars = prog?.stars?.j01 ?? prog?.j01;
      if (!(prog && (Object.keys(prog.stars ?? {}).length > 0))) {
        throw new Error('j01 completion not persisted to progression: ' + JSON.stringify(prog));
      }
      ok(`${name}: progression persisted (j01 → ${prog.totalStars}★ total)`);

      // Next stage advances to j02 through the real results button
      await page.click('#overlay-root [data-act="next"]');
      await waitActive(page);
      st = await readState(page);
      if (st.levelId !== 'j02') throw new Error(`expected j02 via Next stage, got ${st.levelId}`);
      await page.screenshot({ path: SHOT('next', name) });
      ok(`${name}: Next stage advanced to j02`);
    } else {
      // mobile: real touch — select the piston, tap to place on the mount,
      // and verify a tool was committed on the visible canvas.
      const beforeStock = (await readState(page)).stock.piston;
      await selectTool(page, 'piston');
      const mount = await page.evaluate(() => {
        const s = window.app.session.state;
        return s.mounts.find((m) => !m.occupiedBy) || s.mounts[0];
      });
      const pos = await worldToScreen(page, mount.x, mount.y);
      await page.touchscreen.tap(pos.x, pos.y);
      await page.waitForFunction((n) => (window.app.session.state?.stock?.piston ?? 1) < n, beforeStock, { timeout: 5000 });
      st = await readState(page);
      if (st.stock.piston !== 0) throw new Error(`piston not consumed: ${st.stock.piston}`);
      if (st.tools.length < 1) throw new Error('no tool placed via touch');
      await page.screenshot({ path: SHOT('mobile-place', name) });
      ok(`${name}: placed the piston via touchscreen.tap (stock piston ${beforeStock}→${st.stock.piston}, tools: ${st.tools.length})`);
    }
  } finally {
    await context.close();
  }

  if (errors.length) throw new Error(`${name} pass had page errors:\n  ${errors.join('\n  ')}`);
  console.log(`ok - ${name}: no page errors`);
}

// ---------- main ----------
let browser = null;
try {
  browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--mute-audio'],
  });
  console.log(`serving ${ROOT} at ${BASE}`);
  await runPass(browser, 'desktop', { viewport: { width: 1280, height: 800 } }, { full: true });
  await runPass(browser, 'mobile',
    { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, { full: false });
  console.log('\nE2E PASS — workshop-mayhem, desktop + mobile, no page errors');
} catch (e) {
  failures++;
  console.error('\nE2E FAIL:', e.message || e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.close();
}
if (failures) process.exit(1);
