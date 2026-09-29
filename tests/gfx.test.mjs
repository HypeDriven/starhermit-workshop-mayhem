// Graphics quality model (src/render/gfx.js) + Graphics panel locale coverage.
import { suite, ok, eq } from './harness.mjs';
import {
  PRESETS, CATEGORIES, detectPreset, resolve, presetTier, withPreset, describe, migrate,
} from '../src/render/gfx.js';
import { GFX_LOCALES, gfxStrings, pickLocale } from '../src/ui/gfx-panel.js';

suite('gfx: detectPreset from GPU strings', () => {
  eq(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), 'low', 'swiftshader');
  eq(detectPreset('llvmpipe (LLVM 15.0.7, 256 bits)'), 'low', 'llvmpipe');
  eq(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)'), 'high', 'geforce');
  eq(detectPreset('Apple M2'), 'high', 'apple m');
  eq(detectPreset('ANGLE (AMD, AMD Radeon RX 6800 XT)'), 'high', 'radeon rx');
  eq(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620)'), 'balanced', 'intel');
  eq(detectPreset('Adreno (TM) 650'), 'balanced', 'adreno');
  eq(detectPreset(''), 'balanced', 'unknown');
  eq(detectPreset('Apple M2', { mobile: true }), 'balanced', 'mobile caps auto at balanced');
  eq(detectPreset('SwiftShader', { mobile: true }), 'low', 'mobile keeps low');
});

suite('gfx: resolve presets, overrides and scale clamp', () => {
  const auto = resolve({ preset: 'auto' }, 'high');
  eq(auto.preset, 'high', 'auto follows detection');
  ok(auto.auto, 'auto flag');
  eq(auto.shadows, presetTier('high', 'shadows'), 'preset tier');
  const low = resolve({ preset: 'low' }, 'high');
  eq(low.preset, 'low', 'explicit preset wins');
  ok(!low.post, 'low renders without a post chain');
  eq(low.shadows, 'off', 'low has no shadows');
  const ov = resolve({ preset: 'low', bloom: 'on', shadows: 'high', ao: 'bogus' }, 'low');
  eq(ov.bloom, 'on', 'override applies');
  eq(ov.shadows, 'high', 'override applies');
  eq(ov.ao, 'off', 'invalid override falls back to preset');
  ok(ov.post, 'bloom override needs post');
  eq(resolve({ preset: 'high', render_scale: 5 }, 'low').scale, 2, 'scale clamps to 200%');
  eq(resolve({ preset: 'high', render_scale: 0.1 }, 'low').scale, 0.5, 'scale clamps to 50%');
  eq(resolve({ preset: 'ultra' }, 'low').scale, 1.25, 'ultra scale');
  ok(resolve({}, 'low').adaptive, 'adaptive defaults on');
  ok(!resolve({}, 'low').showFps, 'fps readout defaults off');
  for (const p of PRESETS) {
    const r = resolve({ preset: p }, 'low');
    for (const [cat, tiers] of Object.entries(CATEGORIES)) ok(tiers.includes(r[cat]), `${p}.${cat} valid`);
  }
});

suite('gfx: choosing a preset clears overrides', () => {
  const saved = { preset: 'low', bloom: 'on', ao: 'high', render_scale: 1.5, show_fps: true };
  const next = withPreset(saved, 'high');
  eq(next.preset, 'high', 'preset set');
  ok(!('bloom' in next) && !('ao' in next), 'overrides cleared');
  eq(next.render_scale, 1.5, 'scale kept');
  eq(next.show_fps, true, 'fps kept');
});

suite('gfx: legacy tier settings migrate', () => {
  eq(migrate({ tier: 'medium', renderScale: 1 }).preset, 'balanced', 'medium -> balanced');
  eq(migrate({ tier: 'auto' }).preset, 'auto', 'auto stays');
  ok(!('tier' in migrate({ tier: 'high' })), 'tier dropped');
  eq(migrate(undefined).preset, 'auto', 'default');
});

suite('gfx: describe cost summary', () => {
  const s = describe(resolve({ preset: 'high' }, 'low'), [1280, 800]);
  ok(/2048² shadows/.test(s) && /SMAA/.test(s) && /1280×800 px/.test(s), s);
  ok(/no shadows/.test(describe(resolve({ preset: 'low' }, 'low'))), 'low summary');
});

suite('gfx: Graphics panel strings in every locale', () => {
  for (const loc of ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT']) {
    ok(GFX_LOCALES.includes(loc), `locale ${loc}`);
  }
  const keys = Object.keys(gfxStrings('en-GB'));
  for (const loc of GFX_LOCALES) {
    const L = gfxStrings(loc);
    for (const k of keys) ok(typeof L[k] === 'string' && L[k].length, `${loc} missing ${k}`);
  }
  eq(pickLocale(['es-MX']), 'es-419', 'es-MX');
  eq(pickLocale(['fr-CA']), 'fr-CA', 'fr-CA');
  eq(pickLocale(['de']), 'de-DE', 'de');
  eq(pickLocale(['ja-JP']), 'en-US', 'fallback');
});
