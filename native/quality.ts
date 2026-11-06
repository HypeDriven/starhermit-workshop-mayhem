// The look per graphics level. The engine's effects (shadows and their map
// size, AO, bloom, the grade, anti-aliasing) are the level's own
// (levelSettings()); the browser build's art and budgets (src/render/gfx.js
// TABLE / BUDGETS) stay keyed by the runtime's quality tier (frame().quality),
// with the particle pool scaled by the level's particle budget above the
// tier's anchor (at most 2×). The runtime owns the rest of what the old
// Graphics panel did: Auto and the level choice, render scale and the
// pixel-ratio cap, adaptive resolution, the frame-rate limit and readout.
import { levelSettings, type GraphicsLevel, type LevelSettings, type QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export interface Budget {
  /** Workshop, props, tools and dummy: lambert (Low) / standard (Balanced) / physical clear-coat (High, Ultra). */
  material: "lambert" | "standard" | "physical";
  /** Wood / fabric / metal texture size in px (plain detail ≤ 128). */
  texture: number;
  /** Multiplies cylinder, torus, sphere, cone and lathe segments. */
  segments: number;
  /** Dust motes in the lamp and window light (Particles high). */
  dust: number;
  /** Multiplies the Particles tier's pool cap. */
  particles: number;
}
export interface Look {
  preset: QualityTier;
  /** Key-light shadow map size, the level's (0 = off). */
  shadows: number;
  ao: { resolution: number; samples: number; denoiseSamples: number } | null;
  /** The level's bloom resolution (null = off). */
  bloom: number | null;
  grade: boolean;
  antialias: AntialiasMode;
  reflections: boolean;
  particles: "low" | "high";
  detailed: boolean;
  budget: Budget;
}

type Art = Pick<Look, "reflections" | "particles" | "detailed">;
/** gfx.js TABLE, without what the level decides. */
const ART: Record<QualityTier, Art> = {
  low: { reflections: false, particles: "low", detailed: false },
  balanced: { reflections: true, particles: "high", detailed: true },
  high: { reflections: true, particles: "high", detailed: true },
  ultra: { reflections: true, particles: "high", detailed: true },
};
/** gfx.js BUDGETS. */
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", texture: 64, segments: 0.6, dust: 60, particles: 0.5 },
  balanced: { material: "standard", texture: 128, segments: 0.8, dust: 100, particles: 0.5 },
  high: { material: "physical", texture: 256, segments: 1, dust: 160, particles: 1 },
  ultra: { material: "physical", texture: 512, segments: 1.5, dust: 240, particles: 1 },
};
/** The level whose settings are each tier's preset. */
const ANCHOR: Record<QualityTier, GraphicsLevel> = { low: "quantum", balanced: "molecular", high: "terrestrial", ultra: "galactic" };
export const PARTICLE_CAP = { low: 800, high: 6000 };
export const PARTICLE_MAX = 6000;

export function lookFor(s: LevelSettings = levelSettings()): Look {
  const preset = s.quality;
  const k = Math.min(2, s.particles / levelSettings(ANCHOR[preset]).particles);
  const b = { ...BUDGETS[preset] };
  b.particles = Math.round(b.particles * k * 100) / 100;
  b.texture = Math.min(b.texture, s.maxTextureSize);
  return {
    preset, ...ART[preset],
    shadows: s.shadows ? s.shadowMapSize : 0,
    ao: s.ao && { resolution: s.ao.resolution, samples: s.ao.samples, denoiseSamples: s.ao.denoiseSamples },
    bloom: s.bloom ? s.bloom.resolution : null,
    grade: s.grade,
    antialias: s.antialias,
    budget: b,
  };
}
/** gfx.js particleCap: the Particles tier's cap × the preset's multiplier. */
export function particleCap(l: Look): number { return Math.min(PARTICLE_MAX, Math.round(PARTICLE_CAP[l.particles] * l.budget.particles)); }
