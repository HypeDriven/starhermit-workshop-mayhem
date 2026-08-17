// Deterministic 2D soft-body physics: verlet particles + distance constraints
// + static colliders. Hot path uses only + - * / and sqrt (IEEE-exact), plain
// indexed loops, and zero per-tick allocation, so identical inputs produce
// identical doubles in any conforming engine. No trig/transcendentals here.

export const DT = 1 / 120;           // fixed simulation step (seconds)
export const GRAVITY = -16;          // m/s^2, tuned for toy-like feel
export const AIR_DAMPING = 0.9985;   // per-tick velocity retention
export const ITERATIONS = 6;         // constraint solver iterations

// Material table: restitution, tangential velocity retention per contact tick.
// Retention values near 1 give toy-like sliding; restitution deadens bounces.
export const MATERIALS = [
  { name: 'plush', rest: 0.10, fric: 0.985 },  // 0 dummy fabric
  { name: 'wood', rest: 0.30, fric: 0.992 },   // 1 floors, crates
  { name: 'metal', rest: 0.45, fric: 0.995 },  // 2 bell, weight
  { name: 'rubber', rest: 1.35, fric: 0.998 }, // 3 boing pad (super-elastic)
  { name: 'stone', rest: 0.10, fric: 0.985 },  // 4 heavy scenery
];

// Below this per-tick speed, velocity is extra-damped each tick. Kills
// constraint limit-cycle jitter without touching real motion (deterministic).
export const SLEEP_V2 = (0.60 * DT) * (0.60 * DT);
export const SLEEP_DAMP = 0.70;

export const MAT = { PLUSH: 0, WOOD: 1, METAL: 2, RUBBER: 3, STONE: 4 };

// Particle flags
export const PF_AIR = 1;        // no contact solved this tick
export const PF_CONTACT = 2;    // had contact this tick

export function makeWorld() {
  return {
    particles: [],   // {x,y,px,py,r,m,mat,body,flags}
    constraints: [], // {a,b,rest,stiff}
    segments: [],    // {x1,y1,x2,y2,mat,boost} static lines (boost: extra normal velocity)
    circles: [],     // {x,y,r,mat,tag} static circles (tag e.g. 'bell:0')
    fields: [],      // active force fields {kind:'fan'|'magnet', x,y,dx,dy,range,width,strength,ticksLeft}
    maxSpeed2: 0,    // max squared per-tick speed seen this tick (settle detection)
    events: [],      // drained by engine each tick
  };
}

export function addParticle(w, x, y, r, m, mat, body) {
  const p = { x, y, px: x, py: y, r, m, mat, body, flags: PF_AIR };
  w.particles.push(p);
  return w.particles.length - 1;
}

export function addConstraint(w, a, b, stiff) {
  const pa = w.particles[a], pb = w.particles[b];
  const dx = pb.x - pa.x, dy = pb.y - pa.y;
  const rest = Math.sqrt(dx * dx + dy * dy);
  w.constraints.push({ a, b, rest, stiff });
  return w.constraints.length - 1;
}

export function addSegment(w, x1, y1, x2, y2, mat, boost = 0) {
  w.segments.push({ x1, y1, x2, y2, mat, boost });
  return w.segments.length - 1;
}

export function addCircle(w, x, y, r, mat, tag = '') {
  w.circles.push({ x, y, r, mat, tag });
  return w.circles.length - 1;
}

// Deterministic triangle wave in [-1,1] from an integer tick (fan flutter).
function tri(t, period) {
  const m = ((t % period) + period) % period;
  const half = period >> 1;
  return m < half ? (m / half) * 2 - 1 : 3 - (m / half) * 2;
}

// One fixed step. `tick` drives deterministic field flutter.
export function stepWorld(w, tick) {
  const ps = w.particles;
  const n = ps.length;
  const noFields = w.fields.length === 0;
  w.maxSpeed2 = 0;

  // integrate
  for (let i = 0; i < n; i++) {
    const p = ps[i];
    if (p.pinned) { p.px = p.x; p.py = p.y; p.flags = PF_AIR; continue; }
    let ax = 0, ay = GRAVITY;
    // force fields
    for (let f = 0; f < w.fields.length; f++) {
      const fld = w.fields[f];
      const rx = p.x - fld.x, ry = p.y - fld.y;
      if (fld.kind === 'fan') {
        const along = rx * fld.dx + ry * fld.dy;
        if (along > 0 && along < fld.range) {
          const perpx = rx - along * fld.dx, perpy = ry - along * fld.dy;
          const perp2 = perpx * perpx + perpy * perpy;
          const halfW = fld.width * (0.35 + 0.65 * (along / fld.range));
          if (perp2 < halfW * halfW) {
            const fall = 1 - along / fld.range;
            const flut = 1 + 0.18 * tri(tick + i * 7, 34);
            ax += fld.dx * fld.strength * fall * flut;
            ay += fld.dy * fld.strength * fall * flut + 1.6 * fall; // slight lift
          }
        }
      } else { // magnet: pull toward point, radial falloff, capped
        const d2 = rx * rx + ry * ry;
        if (d2 < fld.range * fld.range && d2 > 1e-9) {
          const d = Math.sqrt(d2);
          const f = fld.strength * (1 - 0.45 * (d / fld.range)) / d;
          ax -= rx * f; ay -= ry * f;
        }
      }
    }
    const vx = (p.x - p.px) * AIR_DAMPING;
    const vy = (p.y - p.py) * AIR_DAMPING;
    p.px = p.x; p.py = p.y;
    p.x += vx + ax * DT * DT;
    p.y += vy + ay * DT * DT;
    // Micro-sleep damping: always-on for plush (keeps the soft dummy
    // upright and kills ratchet-walk), contact-only for everything else
    // (so free-falling weights still plummet). Suspended during fields.
    const mvx = p.x - p.px, mvy = p.y - p.py;
    const dampable = p.mat === MAT.PLUSH || (p.flags & PF_CONTACT);
    if (noFields && dampable && mvx * mvx + mvy * mvy < SLEEP_V2) {
      p.px = p.x - mvx * SLEEP_DAMP;
      p.py = p.y - mvy * SLEEP_DAMP;
    }
    p.flags = PF_AIR;
  }

  // constraint + collision iterations (fixed order)
  for (let it = 0; it < ITERATIONS; it++) {
    // distance constraints
    for (let c = 0; c < w.constraints.length; c++) {
      const con = w.constraints[c];
      const pa = ps[con.a], pb = ps[con.b];
      let dx = pb.x - pa.x, dy = pb.y - pa.y;
      let d = Math.sqrt(dx * dx + dy * dy);
      if (d < 1e-9) { dx = 0.0001; dy = 0; d = 0.0001; }
      const diff = (d - con.rest) / d * con.stiff;
      const ima = pa.pinned ? 0 : 1 / pa.m, imb = pb.pinned ? 0 : 1 / pb.m;
      const sum = ima + imb;
      if (sum === 0) continue;
      const fa = (ima / sum) * diff, fb = (imb / sum) * diff;
      pa.x += dx * fa; pa.y += dy * fa;
      pb.x -= dx * fb; pb.y -= dy * fb;
    }
    // particle vs static colliders
    for (let i = 0; i < n; i++) {
      const p = ps[i];
      for (let s = 0; s < w.segments.length; s++) collideSegment(w, p, w.segments[s], it);
      for (let s = 0; s < w.circles.length; s++) collideCircle(w, p, w.circles[s], it);
    }
    // particle vs particle across different bodies (i<j fixed order)
    for (let i = 0; i < n; i++) {
      const pi = ps[i];
      for (let j = i + 1; j < n; j++) {
        const pj = ps[j];
        if (pi.body === pj.body) continue;
        const rs = pi.r + pj.r;
        const dx = pj.x - pi.x;
        if (dx > rs || dx < -rs) continue;
        const dy = pj.y - pi.y;
        if (dy > rs || dy < -rs) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rs * rs || d2 < 1e-12) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, ny = dy / d;
        const overlap = rs - d;
        const imi = pi.pinned ? 0 : 1 / pi.m, imj = pj.pinned ? 0 : 1 / pj.m, sum = imi + imj;
        if (sum === 0) continue;
        pi.x -= nx * overlap * (imi / sum); pi.y -= ny * overlap * (imi / sum);
        pj.x += nx * overlap * (imj / sum); pj.y += ny * overlap * (imj / sum);
        if (it === 0) {
          // exchange normal velocity component (restitution avg)
          const vix = pi.x - pi.px, viy = pi.y - pi.py;
          const vjx = pj.x - pj.px, vjy = pj.y - pj.py;
          const rvx = vjx - vix, rvy = vjy - viy;
          const vn = rvx * nx + rvy * ny;
          if (vn < 0) {
            const e = (MATERIALS[pi.mat].rest + MATERIALS[pj.mat].rest) * 0.5;
            const imp = -(1 + e) * vn;
            const ix = imp * nx, iy = imp * ny;
            pi.px -= ix * (imi / sum) * -1; pi.py -= iy * (imi / sum) * -1;
            pj.px += ix * (imj / sum) * -1; pj.py += iy * (imj / sum) * -1;
            pi.flags |= PF_CONTACT; pj.flags |= PF_CONTACT;
            const speed = -vn / DT;
            if (speed > 1.4) {
              w.events.push({
                t: 'impact', x: (pi.x + pj.x) * 0.5, y: (pi.y + pj.y) * 0.5,
                speed, mat: Math.max(pi.mat, pj.mat), a: pi.body, b: pj.body,
              });
            }
          }
        }
      }
    }
  }

  // settle metric (per-tick speed squared)
  for (let i = 0; i < n; i++) {
    const p = ps[i];
    const vx = p.x - p.px, vy = p.y - p.py;
    const s2 = vx * vx + vy * vy;
    if (s2 > w.maxSpeed2) w.maxSpeed2 = s2;
  }
}

function collideSegment(w, p, s, it) {
  const ax = s.x2 - s.x1, ay = s.y2 - s.y1;
  const len2 = ax * ax + ay * ay;
  let t = len2 > 0 ? ((p.x - s.x1) * ax + (p.y - s.y1) * ay) / len2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const cx = s.x1 + ax * t, cy = s.y1 + ay * t;
  let dx = p.x - cx, dy = p.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= p.r * p.r) return;
  let d = Math.sqrt(d2), nx, ny;
  if (d < 1e-9) { // degenerate: push along segment normal
    const l = Math.sqrt(len2) || 1;
    nx = -ay / l; ny = ax / l; d = 1e-9;
  } else { nx = dx / d; ny = dy / d; }
  p.x += nx * (p.r - d);
  p.y += ny * (p.r - d);
  p.flags |= PF_CONTACT;
  if (it !== 0) return; // velocity response once per tick
  const m = MATERIALS[s.mat];
  const pm = MATERIALS[p.mat];
  let vx = p.x - p.px, vy = p.y - p.py;
  const vn = vx * nx + vy * ny;
  if (vn < 0) {
    const e = Math.max(m.rest, pm.rest);
    const f = m.fric * pm.fric;
    const tx = vx - vn * nx, ty = vy - vn * ny;
    vx = tx * f - vn * e * nx + nx * s.boost * DT;
    vy = ty * f - vn * e * ny + ny * s.boost * DT;
    p.px = p.x - vx; p.py = p.y - vy;
    const speed = -vn / DT;
    if (speed > 1.4) {
      w.events.push({ t: 'impact', x: p.x, y: p.y, speed, mat: s.mat, a: p.body, b: -1 });
    }
    if (s.boost > 0 && ny > 0.5) {
      w.events.push({ t: 'boing', x: p.x, y: p.y, speed: s.boost });
    }
  }
}

function collideCircle(w, p, c, it) {
  let dx = p.x - c.x, dy = p.y - c.y;
  const rs = p.r + c.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rs * rs) return;
  let d = Math.sqrt(d2);
  let nx, ny;
  if (d < 1e-9) { nx = 0; ny = 1; d = 1e-9; } else { nx = dx / d; ny = dy / d; }
  p.x += nx * (rs - d);
  p.y += ny * (rs - d);
  p.flags |= PF_CONTACT;
  if (it !== 0) return;
  const m = MATERIALS[c.mat];
  let vx = p.x - p.px, vy = p.y - p.py;
  const vn = vx * nx + vy * ny;
  if (vn < 0) {
    const e = Math.max(m.rest, MATERIALS[p.mat].rest);
    const f = m.fric * MATERIALS[p.mat].fric;
    const tx = vx - vn * nx, ty = vy - vn * ny;
    vx = tx * f - vn * e * nx;
    vy = ty * f - vn * e * ny;
    p.px = p.x - vx; p.py = p.y - vy;
    const speed = -vn / DT;
    // tagged colliders (bells) emit at a lower threshold so gentle rings count
    if (c.tag ? speed > 0.9 : speed > 1.4) {
      w.events.push({ t: 'impact', x: p.x, y: p.y, speed, mat: c.mat, a: p.body, b: -2, tag: c.tag });
    }
  }
}

// Apply an instantaneous impulse (m/s) to a particle via its verlet history.
export function impulse(p, ix, iy) {
  p.px -= ix * DT;
  p.py -= iy * DT;
}

export function particleSpeed(p) {
  const vx = p.x - p.px, vy = p.y - p.py;
  return Math.sqrt(vx * vx + vy * vy) / DT;
}

// Deep copy for previews/cloning (structuredClone-free, explicit and fast).
export function cloneWorld(w) {
  return {
    particles: w.particles.map(p => ({ ...p })),
    constraints: w.constraints.map(c => ({ ...c })),
    segments: w.segments.map(s => ({ ...s })),
    circles: w.circles.map(c => ({ ...c })),
    fields: w.fields.map(f => ({ ...f })),
    maxSpeed2: w.maxSpeed2,
    events: [],
  };
}
