// Quality tiers: independent control of shadows, env detail, particles, post,
// AA, render scale; never alter rules or hazard visibility (spec §4 budgets).
// 'auto' picks by device class; dynamic render scale drops before sim rate.

export const TIERS = {
  low: {
    id: 'low', dprCap: 1.0, shadows: false, shadowSize: 512,
    particles: 800, envDetail: 0.35, bloom: false, renderScale: 0.85,
  },
  medium: {
    id: 'medium', dprCap: 1.5, shadows: true, shadowSize: 1024,
    particles: 2500, envDetail: 0.7, bloom: false, renderScale: 1.0,
  },
  high: {
    id: 'high', dprCap: 2.0, shadows: true, shadowSize: 2048,
    particles: 6000, envDetail: 1.0, bloom: true, renderScale: 1.0,
  },
};

export function detectTier() {
  try {
    const ua = navigator.userAgent || '';
    const mobile = /Android|iPhone|iPad|Mobile/i.test(ua);
    const mem = navigator.deviceMemory || 8;
    const cores = navigator.hardwareConcurrency || 8;
    if (mobile && (mem <= 4 || cores <= 4)) return 'low';
    if (mobile) return 'medium';
    if (mem <= 4 || cores <= 2) return 'medium';
    return 'high';
  } catch {
    return 'medium';
  }
}

export function resolveTier(setting) {
  return TIERS[setting] || TIERS[detectTier()] || TIERS.medium;
}

// Dynamic render-scale governor: if sustained frame time exceeds budget,
// lower render scale; recover when comfortable. Simulation rate untouched.
export class RenderScaleGovernor {
  constructor(base) {
    this.scale = base;
    this.base = base;
    this.acc = 0;
    this.n = 0;
    this.cooldown = 0;
  }

  frame(dt) {
    this.acc += dt;
    this.n++;
    this.cooldown -= dt;
    if (this.acc >= 2) {
      const avg = this.acc / this.n;
      this.acc = 0; this.n = 0;
      if (this.cooldown <= 0) {
        if (avg > 1 / 45 && this.scale > 0.6) {
          this.scale = Math.max(0.6, this.scale - 0.1);
          this.cooldown = 4;
          return this.scale;
        }
        if (avg < 1 / 58 && this.scale < this.base) {
          this.scale = Math.min(this.base, this.scale + 0.05);
          this.cooldown = 6;
          return this.scale;
        }
      }
    }
    return null;
  }
}
