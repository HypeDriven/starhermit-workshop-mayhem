// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only): picks a preset in Settings → Graphics,
// starts Journey stage 1 and plays it like the player — the tool from the tray dragged onto its mount
// on the canvas, then ⚡ Trigger (the moves come from the same hint surface the Hint button uses) — so
// the dummy is launched through the workshop, props tumble, sparks and dust fly and the camera follows.
// Every finished round is retried from the results overlay.
export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

export async function setPreset(page, preset) {
  await page.waitForFunction(() => window.app?.state === 'title', null, { timeout: 20000 });
  await page.click('#screen-root [data-act="settings"]');
  await page.waitForSelector('#gfx-card #gfx-preset', { state: 'visible' });
  await page.selectOption('#gfx-preset', preset);
  await page.waitForFunction((p) => document.getElementById('gl').dataset.gfxPreset === p, preset);
  await page.locator('#screen-root [data-act="back"]').scrollIntoViewIfNeeded();
  await page.click('#screen-root [data-act="back"]');
  await page.waitForFunction(() => window.app?.state === 'title');
}

const toScreen = (page, x, y) => page.evaluate(([wx, wy]) => {
  const s = window.app.scene.worldToScreen(wx, wy, 0);
  return { x: s.x, y: s.y };
}, [x, y]);

async function step(page) {
  const phase = await page.evaluate(() => (window.app?.state === 'active' ? window.app.session?.state?.phase : 'other'));
  if (phase === 'terminal' || phase === 'other') {
    const retry = page.locator('#overlay-root [data-act="retry"]');
    if (await retry.count() && await retry.first().isVisible()) {
      await retry.first().click({ timeout: 3000 });
      await page.waitForFunction(() => window.app?.state === 'active', null, { timeout: 15000 });
    }
    return;
  }
  const hint = await page.evaluate(() => window.app.session.hint());
  if (!hint) return; // the simulation is resolving
  if (hint.kind === 'place') {
    await page.click(`#tool-tray .tool-btn[data-tool="${hint.tool}"]`, { timeout: 3000 });
    const a = await toScreen(page, hint.x, hint.y);
    const b = await toScreen(page, hint.x + hint.dx * 2, hint.y + hint.dy * 2);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
  } else if (hint.kind === 'trigger') {
    await page.click('#btn-trigger', { timeout: 3000 });
  }
}

export async function start(page) {
  await page.click('#screen-root [data-act="play"]');
  await page.waitForSelector('#screen-root.screen-modes');
  await page.click('#screen-root [data-act="journey"]');
  await page.waitForSelector('#screen-root.screen-journey');
  await page.click('[data-level="j01"]');
  await page.waitForFunction(() => window.app?.state === 'active', null, { timeout: 20000 });
  let open = true;
  page.once('close', () => { open = false; });
  (async () => {
    while (open) {
      try { await step(page); } catch (e) { if (!open) return; if (process.env.BENCH_DEBUG) console.error('hook:', e.message.split('\n')[0]); }
      await new Promise((r) => setTimeout(r, 400));
    }
  })();
  await page.waitForTimeout(2500);
}
