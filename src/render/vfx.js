// Pooled VFX: one bounded Points pool, tiered event effects, never raycast,
// fully paused when hidden (spec §4 event hierarchy + budgets).
import * as THREE from 'three';

const MAX = 6000;

export class VfxPool {
  constructor(scene, tier, theme) {
    this.theme = theme;
    this.cap = tier === 'low' ? 800 : tier === 'medium' ? 2500 : MAX;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.09, vertexColors: true, transparent: true, opacity: 0.9,
      depthWrite: false, sizeAttenuation: true,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
    // CPU-side particle records (preallocated)
    this.p = [];
    for (let i = 0; i < MAX; i++) this.p.push({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: 0, r: 1, gcol: 1, b: 1, s: 1 });
    this.head = 0;
    this.alive = 0;
    this.enabled = true;
  }

  emit(n, fn) {
    if (!this.enabled) return;
    n = Math.min(n, this.cap);
    for (let k = 0; k < n; k++) {
      const p = this.p[this.head];
      this.head = (this.head + 1) % this.cap;
      fn(p, k);
      p.life = p.life || 1;
    }
  }

  // ---- tiered effects -------------------------------------------------------
  impact(x, y, speed, rng = Math.random) {
    const n = Math.min(4 + Math.floor(speed * 1.5), 18);
    const c = new THREE.Color(this.theme.dummy.body);
    this.emit(n, (p) => {
      const a = rng() * Math.PI * 2, v = 0.4 + rng() * speed * 0.35;
      p.x = x; p.y = y; p.z = 0.2 + rng() * 0.3;
      p.vx = Math.cos(a) * v; p.vy = Math.abs(Math.sin(a) * v) * 0.8;
      p.vz = (rng() - 0.5) * 0.6; p.g = -4;
      p.life = 0.5 + rng() * 0.4;
      p.r = c.r; p.gcol = c.g; p.b = c.b; p.s = 0.6 + rng() * 0.7;
    });
  }

  boing(x, y) {
    const c = new THREE.Color(this.theme.pad);
    this.emit(10, (p, i) => {
      const a = (i / 10) * Math.PI - Math.PI * 0;
      p.x = x + Math.cos(a) * 0.3; p.y = y + 0.05; p.z = 0.15;
      p.vx = Math.cos(a) * 1.2; p.vy = 1.8 + Math.random() * 1.2; p.vz = 0;
      p.g = -5; p.life = 0.6;
      p.r = c.r; p.gcol = c.g; p.b = c.b; p.s = 1;
    });
  }

  bellRing(x, y) {
    const c = new THREE.Color(this.theme.bell);
    this.emit(16, (p, i) => {
      const a = (i / 16) * Math.PI * 2;
      p.x = x + Math.cos(a) * 0.3; p.y = y + Math.sin(a) * 0.3; p.z = 0.25;
      p.vx = Math.cos(a) * 1.6; p.vy = Math.sin(a) * 1.6; p.vz = 0;
      p.g = 0; p.life = 0.7;
      p.r = c.r; p.gcol = c.g; p.b = c.b; p.s = 0.8;
    });
  }

  confetti(x, y) {
    const cols = [this.theme.accent, this.theme.pad, this.theme.zone, this.theme.bell];
    this.emit(90, (p) => {
      const c = new THREE.Color(cols[Math.floor(Math.random() * cols.length)]);
      p.x = x + (Math.random() - 0.5) * 1.2; p.y = y + Math.random() * 0.8; p.z = 0.3 + Math.random() * 0.4;
      p.vx = (Math.random() - 0.5) * 3; p.vy = 2 + Math.random() * 3.5; p.vz = (Math.random() - 0.5) * 1.5;
      p.g = -6; p.life = 1.6 + Math.random();
      p.r = c.r; p.gcol = c.g; p.b = c.b; p.s = 0.7 + Math.random() * 0.8;
    });
  }

  fanStream(x, y, dx, dy) {
    this.emit(2, (p) => {
      p.x = x + (Math.random() - 0.5) * 0.3; p.y = y + (Math.random() - 0.5) * 0.3; p.z = 0.1;
      const v = 3 + Math.random() * 2;
      p.vx = dx * v + (Math.random() - 0.5) * 0.5; p.vy = dy * v + (Math.random() - 0.5) * 0.5; p.vz = 0;
      p.g = 0; p.life = 0.7;
      p.r = 1; p.gcol = 1; p.b = 1; p.s = 0.45;
    });
  }

  magnetArc(x, y) {
    const c = new THREE.Color(this.theme.zone);
    this.emit(2, (p) => {
      const a = Math.random() * Math.PI * 2, r = 0.25 + Math.random() * 0.4;
      p.x = x + Math.cos(a) * r; p.y = y + Math.sin(a) * r; p.z = 0.15;
      p.vx = -Math.sin(a) * 1.5; p.vy = Math.cos(a) * 1.5; p.vz = 0;
      p.g = 0; p.life = 0.35;
      p.r = c.r; p.gcol = c.g; p.b = c.b; p.s = 0.6;
    });
  }

  puff(x, y, color = 0xffffff) {
    const c = new THREE.Color(color);
    this.emit(14, (p) => {
      p.x = x + (Math.random() - 0.5) * 0.4; p.y = y + (Math.random() - 0.5) * 0.3; p.z = 0.2;
      p.vx = (Math.random() - 0.5) * 1.4; p.vy = 0.8 + Math.random(); p.vz = 0;
      p.g = -1.5; p.life = 0.8;
      p.r = c.r; p.gcol = c.g; p.b = c.b; p.s = 1.4;
    });
  }

  update(dt) {
    if (!this.enabled) return;
    let alive = 0;
    for (let i = 0; i < this.cap; i++) {
      const p = this.p[i];
      if (p.life <= 0) { this.size[i] = 0; continue; }
      p.life -= dt;
      p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.02 && p.vy < 0) { p.vy *= -0.4; p.y = 0.02; p.vx *= 0.7; }
      const f = Math.min(1, p.life * 2.5);
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      this.col[i * 3] = p.r * f; this.col[i * 3 + 1] = p.gcol * f; this.col[i * 3 + 2] = p.b * f;
      this.size[i] = p.s * f;
      alive++;
    }
    this.alive = alive;
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    this.points.geometry.attributes.size.needsUpdate = true;
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) {
      this.size.fill(0);
      this.points.geometry.attributes.size.needsUpdate = true;
      for (const p of this.p) p.life = 0;
    }
  }

  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
    this.points.removeFromParent();
  }
}
