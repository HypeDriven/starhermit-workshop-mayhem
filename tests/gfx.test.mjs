// Graphics quality model (src/render/gfx.js) + Graphics panel locale coverage.
import { suite, ok, eq } from './harness.mjs';
import { readFileSync } from 'node:fs';
// src/render/gpu-level.js is a classic script in the page (window.StarHermitGpu); evaluate it the same way here.
new Function('window', 'module', readFileSync(new URL('../src/render/gpu-level.js', import.meta.url), 'utf8'))(globalThis, undefined);
const {
  PRESETS, CATEGORIES, detectPreset, detectLevel, presetForLevel, budgetFor, particleCap, resolve, presetTier, withPreset, describe, migrate,
  LEVELS, BUDGETS, PARTICLE_CAP, PARTICLE_MAX,
} = await import('../src/render/gfx.js');
import { GFX_LOCALES, gfxStrings, pickLocale } from '../src/ui/gfx-panel.js';

const DESK = { cores: 8, memoryGb: 8 };
const PHONE = { mobile: true, cores: 8, memoryGb: 8 };

suite('gfx: hardware level picks the Auto preset (Low 0, Balanced 4, High 10, Ultra 17)', () => {
  eq(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', DESK), 'low', 'swiftshader');
  eq(detectLevel('llvmpipe (LLVM 15.0.7, 256 bits)', DESK), 0, 'llvmpipe level 0');
  eq(detectPreset('', DESK), 'low', 'no WebGL');
  eq(detectPreset('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', DESK), 'low', 'radeon igpu');
  eq(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)', DESK), 'low', 'intel uhd');
  eq(detectPreset('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)', DESK), 'balanced', 'iris xe');
  eq(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce GTX 1070 Direct3D11 vs_5_0 ps_5_0)', DESK), 'high', 'gtx 1070');
  eq(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0)', DESK), 'ultra', 'rtx 4080');
  eq(detectLevel('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', DESK), 20, 'rtx 5090 level');
  eq(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', DESK), 'ultra', 'rtx 5090');
  for (const [p, lv] of Object.entries(LEVELS)) eq(presetForLevel(lv), p, 'floor ' + p);
  eq(presetForLevel(3), 'low', 'level 3');
  eq(presetForLevel(16), 'high', 'level 16');
});

suite('gfx: phones and tablets are Balanced at most; software GPUs stay Low', () => {
  eq(detectPreset('Adreno (TM) 740', PHONE), 'balanced', 'adreno 740');
  ok(detectLevel('Adreno (TM) 740', PHONE) <= 9, 'phone capped at 9');
  eq(detectPreset('Apple M2', PHONE), 'balanced', 'tablet');
  eq(detectPreset('SwiftShader', PHONE), 'low', 'mobile software');
});

suite('gfx: per-preset budget table', () => {
  const keys = ['material', 'texture', 'segments', 'dust', 'particles', 'bloomRes', 'aoRes'];
  for (const p of PRESETS) for (const k of keys) ok(BUDGETS[p][k] !== undefined, `${p}.${k}`);
  for (let i = 1; i < PRESETS.length; i++) {
    for (const k of keys.slice(1)) ok(BUDGETS[PRESETS[i]][k] >= BUDGETS[PRESETS[i - 1]][k], `${PRESETS[i]}.${k} never cheaper`);
  }
  eq(PRESETS.map((p) => BUDGETS[p].material).join(), 'lambert,standard,physical,physical', 'shading per preset');
  eq(PRESETS.map((p) => BUDGETS[p].bloomRes).join(), '0.5,0.5,0.5,1', 'half-res bloom below Ultra');
  eq(budgetFor('balanced', 4).particles, BUDGETS.balanced.particles, 'floor level = table');
  eq(budgetFor('balanced', 0).particles, BUDGETS.balanced.particles, 'forced preset keeps its budget');
  ok(budgetFor('balanced', 7).particles > BUDGETS.balanced.particles, 'faster GPU, more particles');
  const r = resolve({ preset: 'balanced' }, 'low', 4);
  eq(r.level, 4, 'level carried');
  eq(JSON.stringify(r.budget), JSON.stringify(budgetFor('balanced', 4)), 'resolved budget');
  eq(particleCap(r), Math.round(PARTICLE_CAP.high * BUDGETS.balanced.particles), 'balanced particle cap');
  ok(particleCap(resolve({ preset: 'ultra' }, 'low', 20)) <= PARTICLE_MAX, 'cap never exceeds the pool');
  eq(resolve({}, 'low', 0).budget.material, 'lambert', 'headless Auto is Lambert Low');
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
