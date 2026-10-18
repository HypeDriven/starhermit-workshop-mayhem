// Graphics quality model: presets, per-category overrides, StarHermit hardware-level
// detection, per-preset budgets and a cost summary. Pure (no three.js), so the Settings panel, the renderer and the
// unit tests agree on what a setting means. Never touches rules or hitboxes.

export const PRESETS = ['low', 'balanced', 'high', 'ultra'];

// Category → allowed tiers, cheapest first.
export const CATEGORIES = {
  shadows: ['off', 'low', 'medium', 'high'],
  ao: ['off', 'on', 'high'],
  bloom: ['off', 'on'],
  grade: ['off', 'on'],
  antialias: ['off', 'fxaa', 'smaa', 'msaa'],
  reflections: ['off', 'on'],
  particles: ['low', 'high'],
  detail: ['plain', 'detailed'],
};

// Each preset is a row of tiers, a render scale (multiplies the device pixel
// ratio) and a device-pixel-ratio cap.
const TABLE = {
  low: { scale: 0.85, dprCap: 1, shadows: 'off', ao: 'off', bloom: 'off', grade: 'off', antialias: 'msaa', reflections: 'off', particles: 'low', detail: 'plain' },
  balanced: { scale: 1, dprCap: 1.5, shadows: 'low', ao: 'off', bloom: 'on', grade: 'on', antialias: 'fxaa', reflections: 'on', particles: 'high', detail: 'detailed' },
  high: { scale: 1, dprCap: 2, shadows: 'medium', ao: 'on', bloom: 'on', grade: 'on', antialias: 'smaa', reflections: 'on', particles: 'high', detail: 'detailed' },
  ultra: { scale: 1.25, dprCap: 2, shadows: 'high', ao: 'high', bloom: 'on', grade: 'on', antialias: 'msaa', reflections: 'on', particles: 'high', detail: 'detailed' },
};

export const SHADOW_MAP = { off: 0, low: 1024, medium: 2048, high: 4096 };
export const PARTICLE_CAP = { low: 800, high: 6000 };

export const DEFAULT_GRAPHICS = { preset: 'auto', render_scale: 1, adaptive: true, show_fps: false };

// Auto picks the preset from the StarHermit hardware level (0 = Galaxy S20 / Intel UHD or weaker, 20 =
// RTX 5090; src/render/gpu-level.js → window.StarHermitGpu, a classic script loaded before the game):
// Low from 0, Balanced from 4, High from 10, Ultra from 17. Phones, tablets and ≤ 4 GB machines are
// capped at level 9.
export const LEVELS = { low: 0, balanced: 4, high: 10, ultra: 17 };
const gpuApi = () => globalThis.StarHermitGpu;

/** Hardware level 0–20 for an unmasked renderer string plus StarHermitGpu.detectSystem() facts. */
export function detectLevel(gpu, system) {
  const G = gpuApi();
  const sys = { webgl: true, webgl2: true, ...(system || {}), gpu: String(gpu || '') };
  if (!gpu) sys.webgl = false; // no renderer string: no usable WebGL
  return G ? G.detectLevel(sys) : (gpu ? LEVELS.balanced : 0);
}

/** The preset Auto starts from for a hardware level. */
export function presetForLevel(level) {
  const G = gpuApi();
  return G ? G.presetForLevel(level, LEVELS) : PRESETS.filter((p) => LEVELS[p] <= level).pop() || 'low';
}

/** Best preset for this GPU (the hardware level already caps phones/tablets at Balanced). */
export function detectPreset(gpu, system) {
  return presetForLevel(detectLevel(gpu, system));
}

/*
 * Per-preset asset and effect budget. Each preset holds 60 FPS on the weakest GPU Auto gives it (Low →
 * level 0, Balanced → 4, High → 10, Ultra → 17; measured with tests/gfx-bench.mjs). Physics, the
 * dummy, tools, props, hitboxes and rules are identical on every preset — only visuals change.
 *   material   workshop, props, tools and dummy: lambert (Low) / standard (Balanced) / physical varnish,
 *              clear-coat metal and plush sheen with Reflections on (High, Ultra)
 *   texture    wood / fabric / metal texture size in px (plain detail ≤ 128)
 *   segments   multiplies cylinder, torus, sphere, cone and lathe segments
 *   dust       dust motes in the lamp and window light (Particles high)
 *   particles  multiplies the Particles tier's pool cap, scaled with the level
 *   bloomRes / aoRes  bloom and GTAO resolution as a fraction of the frame
 */
export const BUDGETS = {
  low: { material: 'lambert', texture: 64, segments: 0.6, dust: 60, particles: 0.5, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: 'standard', texture: 128, segments: 0.8, dust: 100, particles: 0.5, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: 'physical', texture: 256, segments: 1, dust: 160, particles: 1, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: 'physical', texture: 512, segments: 1.5, dust: 240, particles: 1, bloomRes: 1, aoRes: 1 },
};
export const PARTICLE_MAX = 6000; // the pool in vfx.js

/** A preset's concrete budget for a hardware level (the particle multiplier scales ≤ 2× within the preset). */
export function budgetFor(preset, level) {
  const b = { ...(BUDGETS[preset] || BUDGETS.balanced) };
  const G = gpuApi(), floor = LEVELS[preset] || 0;
  const lv = Math.max(Number.isFinite(level) ? level : floor, floor);
  const k = G ? Math.min(2, G.scaleBudget(1, lv, floor)) : 1;
  b.particles = Math.round(b.particles * k * 100) / 100;
  return b;
}

/** Particle pool cap for a resolved setting: the Particles tier's cap × the preset's multiplier. */
export function particleCap(r) {
  return Math.min(PARTICLE_MAX, Math.round(PARTICLE_CAP[r.particles] * (r.budget ? r.budget.particles : 1)));
}

/** Map the pre-preset settings shape ({tier, renderScale}) onto the current one. */
export function migrate(saved) {
  const s = { ...DEFAULT_GRAPHICS, ...(saved || {}) };
  if (saved && saved.tier !== undefined && saved.preset === undefined) {
    s.preset = { low: 'low', medium: 'balanced', high: 'high' }[saved.tier] || 'auto';
  }
  delete s.tier;
  delete s.renderScale;
  return s;
}

/**
 * Resolve saved settings into concrete tiers.
 * `saved`: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }.
 */
export function resolve(saved, detected, level) {
  const s = saved || {};
  const auto = !PRESETS.includes(s.preset);
  const preset = auto ? (PRESETS.includes(detected) ? detected : 'balanced') : s.preset;
  const row = TABLE[preset];
  const out = {
    preset, auto,
    scale: row.scale * clamp(Number(s.render_scale) || 1, 0.5, 2),
    dprCap: row.dprCap,
  };
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    out[cat] = tiers.includes(s[cat]) ? s[cat] : row[cat];
  }
  out.level = Number.isFinite(level) ? level : LEVELS[preset];
  out.budget = budgetFor(preset, out.level);
  out.adaptive = s.adaptive !== false;
  out.showFps = !!s.show_fps;
  // Post-processing runs only when something needs it; otherwise the canvas renders directly.
  out.post = out.ao !== 'off' || out.bloom === 'on' || out.grade === 'on' || out.antialias === 'fxaa' || out.antialias === 'smaa';
  return out;
}

/** Choosing a preset clears every per-category override. */
export function withPreset(saved, preset) {
  const out = { ...(saved || {}), preset };
  for (const cat of Object.keys(CATEGORIES)) delete out[cat];
  return out;
}

/** The preset's own tier for a category (for "From preset (…)" labels). */
export function presetTier(preset, cat) {
  return TABLE[preset]?.[cat];
}

const WORDS_EN = {
  noShadows: 'no shadows', shadows: (r) => `${SHADOW_MAP[r.shadows]}² shadows`,
  ao: 'ambient occlusion', aoFull: 'full ambient occlusion',
  reflections: 'reflections', bloom: 'bloom', noAA: 'no anti-aliasing',
};

/** Short cost summary, e.g. "2048² shadows · ambient occlusion · bloom · SMAA · 1280×800 px". */
export function describe(r, pixels, words = WORDS_EN) {
  const w = { ...WORDS_EN, ...words };
  const parts = [
    r.shadows === 'off' ? w.noShadows : w.shadows(r),
    r.ao === 'off' ? null : r.ao === 'high' ? w.aoFull : w.ao,
    r.reflections === 'on' ? w.reflections : null,
    r.bloom === 'on' ? w.bloom : null,
    r.antialias === 'off' ? w.noAA : r.antialias.toUpperCase(),
    pixels ? `${pixels[0]}×${pixels[1]} px` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
