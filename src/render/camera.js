// Authored camera rig: aspect-aware framing constants, critically damped
// spring transitions (never cumulative per-frame lerp), tiered shake, all
// interruptible and reduced-motion aware (spec §4 camera and motion).
import * as THREE from 'three';

// framing constants (exposed, no magic offsets)
export const FRAMING = {
  fov: 33,
  target: [0, 2.35, 0],
  distance: 13.6,
  height: 5.1,
  pitch: 0.34,          // radians downward
  portraitDistance: 18.0,
  portraitHeight: 5.8,
  title: { target: [-0.8, 2.1, 0], distance: 12.6, height: 4.4 },
  results: { distance: 11.0, height: 4.2 },
  margin: 1.18,
};

function damp(current, target, lambda, dt) {
  // critically damped spring approximation (framerate independent)
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'game';
    this.pos = new THREE.Vector3(0, FRAMING.height, FRAMING.distance);
    this.look = new THREE.Vector3(...FRAMING.target);
    this.goalPos = this.pos.clone();
    this.goalLook = this.look.clone();
    this.lambda = 4.5;
    this.shakes = [];
    this.reducedMotion = false;
    this.aspect = 16 / 9;
    this.focusBounds = null; // {x,y,w,h} of the level
    this.time = 0;
    this.applyImmediate();
  }

  setBounds(b) { this.focusBounds = b; this.retarget(this.mode); }

  setReducedMotion(on) {
    this.reducedMotion = on;
    if (on) this.shakes.length = 0;
  }

  retarget(mode) {
    this.mode = mode;
    const F = FRAMING;
    const portrait = this.aspect < 1;
    let dist = portrait ? F.portraitDistance : F.distance;
    let height = portrait ? F.portraitHeight : F.height;
    let look = new THREE.Vector3(...F.target);
    if (mode === 'title') {
      look = new THREE.Vector3(...F.title.target);
      dist = F.title.distance; height = F.title.height;
    } else if (mode === 'results') {
      dist *= F.results.distance / F.distance;
      height = F.results.height;
    }
    if (this.focusBounds && mode === 'game') {
      const b = this.focusBounds;
      look = new THREE.Vector3(b.x + b.w / 2, Math.max(1.6, b.y + b.h * 0.32), 0);
      // fit to aspect: wide screens fit height, tall screens fit width
      const needW = (b.w * F.margin) / this.aspect;
      const needH = b.h * F.margin * (this.aspect > 1.9 ? 1.15 : this.aspect < 1 ? 0.95 : 0.8);
      const fit = Math.max(needH, needW);
      const fov = this.aspect < 1 ? 46 : F.fov;
      if (this.camera.fov !== fov) {
        this.camera.fov = fov;
        this.camera.updateProjectionMatrix();
      }
      dist = Math.max(dist, Math.min(fit / (2 * Math.tan((fov * Math.PI / 180) / 2)) * 1.05, 26));
    }
    this.goalLook.copy(look);
    this.goalPos.set(look.x, height, look.z + dist);
  }

  resize(aspect) {
    this.aspect = aspect;
    this.retarget(this.mode);
  }

  shake(strength, duration = 0.35) {
    if (this.reducedMotion) return;
    this.shakes.push({ t: 0, duration, strength: Math.min(strength, 0.22) });
    if (this.shakes.length > 4) this.shakes.shift();
  }

  applyImmediate() {
    this.pos.copy(this.goalPos);
    this.look.copy(this.goalLook);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }

  snapToGameplay() {
    this.retarget('game');
    this.applyImmediate();
  }

  update(dt) {
    this.time += dt;
    this.lambda = 4.5;
    this.pos.x = damp(this.pos.x, this.goalPos.x, this.lambda, dt);
    this.pos.y = damp(this.pos.y, this.goalPos.y, this.lambda, dt);
    this.pos.z = damp(this.pos.z, this.goalPos.z, this.lambda, dt);
    this.look.x = damp(this.look.x, this.goalLook.x, this.lambda, dt);
    this.look.y = damp(this.look.y, this.goalLook.y, this.lambda, dt);
    this.look.z = damp(this.look.z, this.goalLook.z, this.lambda, dt);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    // gentle idle drift (disabled by reduced motion)
    if (!this.reducedMotion && this.mode === 'title') {
      this.camera.position.x += Math.sin(this.time * 0.3) * 0.15;
      this.camera.position.y += Math.sin(this.time * 0.43) * 0.08;
    }
    // tiered shake (decaying noise; never changes raycast truth)
    if (this.shakes.length) {
      let ox = 0, oy = 0;
      for (const s of this.shakes) {
        s.t += dt;
        const f = Math.max(0, 1 - s.t / s.duration);
        const n = Math.sin(s.t * 91.7) + Math.sin(s.t * 47.3) * 0.6;
        ox += n * s.strength * f * 0.5;
        oy += Math.cos(s.t * 83.1) * s.strength * f * 0.4;
      }
      this.shakes = this.shakes.filter(s => s.t < s.duration);
      this.camera.position.x += ox;
      this.camera.position.y += oy;
    }
  }
}
