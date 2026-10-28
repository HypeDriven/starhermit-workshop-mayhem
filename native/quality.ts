// The look per graphics level: the browser build's four presets and budgets
// (src/render/gfx.js TABLE / BUDGETS, each tuned to hold 60 FPS on the
// weakest GPU its Auto gave it) keyed by the runtime's quality tier
// (frame().quality), with the particle pool scaled within the tier by the
// level (frame().levelIndex, at most 2×) as the browser build scaled it by its
// hardware level. The runtime owns the rest of what the old Graphics panel did:
// Auto and the level choice, render scale and the pixel-ratio cap, adaptive
// resolution, the frame-rate limit and readout. The old panel's per-effect
// overrides are not offered (the runtime's Options choose a level).
import type { QualityTier } from "starhermit:engine";
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
  bloomRes: number;
  aoRes: number;
}
export interface Look {
  preset: QualityTier;
  /** Key-light shadow map size (0 = off). */
  shadows: 0 | 1024 | 2048 | 4096;
  ao: "off" | "on" | "high";
  bloom: boolean;
  grade: boolean;
  antialias: AntialiasMode;
  reflections: boolean;
  particles: "low" | "high";
  detailed: boolean;
  budget: Budget;
}

/** gfx.js TABLE. */
const TABLE: Record<QualityTier, Omit<Look, "preset" | "budget">> = {
  low: { shadows: 0, ao: "off", bloom: false, grade: false, antialias: "msaa", reflections: false, particles: "low", detailed: false },
  balanced: { shadows: 1024, ao: "off", bloom: true, grade: true, antialias: "fxaa", reflections: true, particles: "high", detailed: true },
  high: { shadows: 2048, ao: "on", bloom: true, grade: true, antialias: "smaa", reflections: true, particles: "high", detailed: true },
  ultra: { shadows: 4096, ao: "high", bloom: true, grade: true, antialias: "msaa", reflections: true, particles: "high", detailed: true },
};
/** gfx.js BUDGETS. */
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", texture: 64, segments: 0.6, dust: 60, particles: 0.5, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: "standard", texture: 128, segments: 0.8, dust: 100, particles: 0.5, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: "physical", texture: 256, segments: 1, dust: 160, particles: 1, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: "physical", texture: 512, segments: 1.5, dust: 240, particles: 1, bloomRes: 1, aoRes: 1 },
};
/** The first level index of each tier. */
const TIER_FLOOR: Record<QualityTier, number> = { low: 0, balanced: 2, high: 4, ultra: 7 };
export const PARTICLE_CAP = { low: 800, high: 6000 };
export const PARTICLE_MAX = 6000;

export function lookFor(preset: QualityTier, levelIndex: number): Look {
  const b = { ...BUDGETS[preset] };
  const k = Math.min(2, Math.pow(1.64, Math.max(0, levelIndex - TIER_FLOOR[preset])));
  b.particles = Math.round(b.particles * k * 100) / 100;
  return { preset, ...TABLE[preset], budget: b };
}
/** gfx.js particleCap: the Particles tier's cap × the preset's multiplier. */
export function particleCap(l: Look): number { return Math.min(PARTICLE_MAX, Math.round(PARTICLE_CAP[l.particles] * l.budget.particles)); }
