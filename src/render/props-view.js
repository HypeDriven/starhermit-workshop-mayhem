// Level entity views: statics, crates, balls, weights (bodies), bells, zones,
// mounts, placement ghosts and trajectory preview (spec §3: legal targets
// preview before commit; invalid targets explain why).
import * as THREE from 'three';
import { MAT } from '../rules/physics.js';

const MAT_COLOR = {
  [MAT.WOOD]: (t) => t.floor,
  [MAT.METAL]: (t) => t.bell,
  [MAT.RUBBER]: (t) => t.pad,
  [MAT.STONE]: (t) => t.shelf,
};

export class LevelView {
  constructor(parent, factory, theme, level) {
    this.factory = factory;
    this.theme = theme;
    this.level = level;
    this.group = new THREE.Group();
    this.group.name = 'level';
    this.disposables = [];
    this.crateMeshes = [];
    this.ballMeshes = [];
    this.weightMeshes = new Map(); // toolId -> mesh
    this.bellViews = [];
    this.zoneViews = [];
    this.mountViews = [];
    this.build(level);
    parent.add(this.group);
  }

  track(o) { this.disposables.push(o); return o; }

  build(level) {
    const F = this.factory, t = this.theme;
    // static segments as boxes
    for (const s of level.statics.segments) {
      const [x1, y1, x2, y2, matName] = s;
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      const isWallish = Math.abs(dy) > Math.abs(dx);
      const color = MAT_COLOR[MAT[matName ?? 'WOOD']]?.(t) ?? t.floorAlt;
      const mat = matName === 'RUBBER' ? F.plushMat(color) : F.woodMat(color, 0.85);
      const geo = this.track(new THREE.BoxGeometry(len + (isWallish ? 0.3 : 0), 0.34, 2.2));
      const m = new THREE.Mesh(geo, mat);
      m.position.set((x1 + x2) / 2, (y1 + y2) / 2 - 0.05, -0.15);
      m.rotation.z = Math.atan2(dy, dx);
      m.receiveShadow = true;
      m.castShadow = isWallish;
      if (isWallish) m.scale.set(1, Math.max(1, len / 0.34), 1), m.rotation.z = 0, m.position.set(x1, (y1 + y2) / 2, -0.15), m.geometry = this.track(new THREE.BoxGeometry(0.34, len + 0.3, 2.2));
      this.group.add(m);
    }
    for (const c of level.statics.circles) {
      const [x, y, r, matName] = c;
      const color = MAT_COLOR[MAT[matName ?? 'WOOD']]?.(t) ?? t.floorAlt;
      const geo = this.track(new THREE.CylinderGeometry(r, r, 1.8, 20));
      const m = new THREE.Mesh(geo, F.woodMat(color, 0.7));
      m.rotation.x = Math.PI / 2;
      m.position.set(x, y, -0.15);
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
    }
    // bells on stands
    (level.bells || []).forEach((b, i) => {
      const view = this.makeBell(b);
      this.bellViews.push(view);
      this.group.add(view.group);
    });
    // zones: floor rings with progress arc
    (level.zones || []).forEach((z, i) => {
      const view = this.makeZone(z);
      this.zoneViews.push(view);
      this.group.add(view.group);
    });
    // mounts
    (level.mounts || []).forEach((m) => {
      const view = this.makeMount(m);
      this.mountViews.push(view);
      this.group.add(view.mesh);
    });
  }

  makeBell(b) {
    const F = this.factory, t = this.theme;
    const group = new THREE.Group();
    // lathe bell profile
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const f = i / 8;
      pts.push(new THREE.Vector2(0.05 + f * b.r * (0.6 + 0.55 * f), -b.r * 0.9 + f * b.r * 1.5));
    }
    const geo = this.track(new THREE.LatheGeometry(pts, 18));
    const bell = new THREE.Mesh(geo, F.metalMat(t.bell, 0.25, 0.95));
    bell.castShadow = true;
    group.add(bell);
    const clapper = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.07, 8, 8)), F.metalMat(t.accent, 0.4, 0.8));
    clapper.position.y = -b.r * 0.7;
    group.add(clapper);
    // stand/chain to nearest ceiling or a post
    const post = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.03, 0.03, 7 - b.y, 6)), F.metalMat(t.accent, 0.5, 0.7));
    post.position.y = (7 + b.r * 0.6) / 2 + (b.y - b.r * 0.6) / 2;
    post.position.y = b.y + b.r * 0.6 + (7 - b.y - b.r * 0.6) / 2;
    group.add(post);
    group.position.set(b.x, b.y, -0.15);
    // ring flash halo
    const halo = new THREE.Mesh(
      this.track(new THREE.RingGeometry(b.r * 1.1, b.r * 1.35, 24)),
      new THREE.MeshBasicMaterial({ color: t.zone, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    );
    halo.position.set(b.x, b.y, 0.15);
    this.group.add(halo);
    return { group, halo, bell, anim: 0, x: b.x, y: b.y, r: b.r };
  }

  ringBell(i) {
    const v = this.bellViews[i];
    if (v) v.anim = 1;
  }

  makeZone(z) {
    const F = this.factory, t = this.theme;
    const group = new THREE.Group();
    const ring = new THREE.Mesh(
      this.track(new THREE.RingGeometry(z.r * 0.86, z.r, 40)),
      new THREE.MeshBasicMaterial({ color: t.zone, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);
    const fillGeo = this.track(new THREE.CircleGeometry(z.r * 0.86, 40));
    const fill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({ color: t.zone, transparent: true, opacity: 0.16, depthWrite: false }));
    fill.rotation.x = -Math.PI / 2;
    group.add(fill);
    // dashes around the rim for shape coding (color + shape, spec §3)
    const dashGeo = this.track(new THREE.BoxGeometry(0.08, 0.02, 0.16));
    const dashMat = new THREE.MeshBasicMaterial({ color: t.zone, transparent: true, opacity: 0.9, depthWrite: false });
    const dashes = new THREE.InstancedMesh(dashGeo, dashMat, 16);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      m4.makeRotationY(-a);
      m4.setPosition(Math.cos(a) * z.r * 0.93, 0, Math.sin(a) * z.r * 0.93);
      dashes.setMatrixAt(i, m4);
    }
    group.add(dashes);
    group.position.set(z.x, (z.y - z.r * 0) > 0.2 ? z.y : 0.03, z.y > 0.4 ? 0.2 : 0);
    if (z.y > 0.4) { group.rotation.x = 0; } else { group.position.y = 0.04; }
    // zone target center marker (for elevated zones draw vertical ring)
    if (z.y > 0.4) {
      group.rotation.x = 0;
      group.position.set(z.x, z.y, 0.25);
    }
    return { group, ring, fill, z, anim: 0 };
  }

  makeMount(m) {
    const F = this.factory, t = this.theme;
    const geo = this.track(new THREE.CylinderGeometry(0.22, 0.22, 0.1, 6));
    const mesh = new THREE.Mesh(geo, F.metalMat(t.accent, 0.45, 0.75));
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(m.x, m.y, -0.3);
    mesh.castShadow = true;
    const marker = new THREE.Mesh(
      this.track(new THREE.RingGeometry(0.26, 0.32, 6)),
      new THREE.MeshBasicMaterial({ color: t.accent, transparent: true, opacity: 0.0, depthWrite: false }),
    );
    marker.position.set(m.x, m.y, 0.05);
    this.group.add(marker);
    return { mesh, marker, id: m.id, x: m.x, y: m.y, pulse: 0 };
  }

  // dynamic bodies ----------------------------------------------------------
  ensureBodies(bodies) {
    const F = this.factory, t = this.theme;
    // crates + balls keyed by body index
    for (let bi = 1; bi < bodies.length; bi++) {
      const b = bodies[bi];
      if (b.kind === 'crate' && !this.crateMeshes[bi]) {
        const g = new THREE.Group();
        const box = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.42, 0.42, 0.42)), F.woodMat(t.shelf, 0.85));
        box.castShadow = true;
        const edges = new THREE.LineSegments(
          this.track(new THREE.EdgesGeometry(box.geometry)),
          new THREE.LineBasicMaterial({ color: t.wall }),
        );
        g.add(box, edges);
        this.crateMeshes[bi] = g;
        this.group.add(g);
      } else if (b.kind === 'ball' && !this.ballMeshes[bi]) {
        const m = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.24, 16, 12)), F.woodMat(t.accent, 0.6));
        m.castShadow = true;
        this.ballMeshes[bi] = m;
        this.group.add(m);
      } else if (b.kind === 'weight' && !this.weightMeshes.has(b.toolId)) {
        const m = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.62, 0.5, 0.5)), F.metalMat(0x3a3f4a, 0.4, 0.95));
        m.castShadow = true;
        this.weightMeshes.set(b.toolId, m);
        this.group.add(m);
      }
    }
  }

  updateBodies(pos, bodies) {
    for (let bi = 1; bi < bodies.length; bi++) {
      const b = bodies[bi];
      if (b.kind === 'crate') {
        const g = this.crateMeshes[bi];
        if (!g) continue;
        // center + orientation from first edge
        const [x0, y0] = [pos[b.start * 2], pos[b.start * 2 + 1]];
        const [x1, y1] = [pos[(b.start + 1) * 2], pos[(b.start + 1) * 2 + 1]];
        const [x3, y3] = [pos[(b.start + 3) * 2], pos[(b.start + 3) * 2 + 1]];
        g.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
        g.rotation.z = Math.atan2(y1 - y0, x1 - x0);
        g.visible = true;
      } else if (b.kind === 'ball') {
        const m = this.ballMeshes[bi];
        if (!m) continue;
        m.position.set(pos[b.start * 2], pos[b.start * 2 + 1], 0);
      } else if (b.kind === 'weight') {
        const m = this.weightMeshes.get(b.toolId);
        if (!m) continue;
        m.position.set(pos[b.start * 2], pos[b.start * 2 + 1], 0);
      }
    }
  }

  update(time, dt, goals) {
    for (const [i, v] of this.bellViews.entries()) {
      if (v.anim > 0) {
        v.anim = Math.max(0, v.anim - dt * 1.8);
        const s = Math.sin(v.anim * Math.PI);
        v.halo.material.opacity = s * 0.8;
        v.halo.scale.setScalar(1 + (1 - v.anim) * 0.8);
        v.bell.rotation.z = Math.sin(v.anim * 20) * 0.12;
      }
      const done = goals?.[i]?.done;
      if (done) v.bell.material.emissive = new THREE.Color(this.theme.bell), v.bell.material.emissiveIntensity = 0.25;
    }
    for (const [i, v] of this.zoneViews.entries()) {
      const g = goals?.find(gg => gg.type === 'zone' && gg.x === v.z.x && gg.y === v.z.y);
      const pulse = 1 + Math.sin(time * 2.4 + i) * 0.03;
      v.group.scale.setScalar(pulse);
      if (g) {
        const f = Math.min(1, g.value / (g.holdTicks || 1));
        v.fill.material.opacity = 0.16 + f * 0.4;
        if (g.done) v.ring.material.opacity = 1;
      }
    }
  }

  setMountHighlight(show, freeIds = null) {
    for (const v of this.mountViews) {
      const free = !freeIds || freeIds.includes(v.id);
      v.marker.material.opacity = show && free ? 0.75 : 0;
    }
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}

// --- placement ghost + trajectory preview ------------------------------------

export class GhostPreview {
  constructor(parent, factory, theme, stateColors) {
    this.parent = parent;
    this.factory = factory;
    this.theme = theme;
    this.stateColors = stateColors;
    this.mesh = null;
    this.line = null;
    this.kind = null;
  }

  show(kind, makeMesh) {
    this.hide();
    this.kind = kind;
    this.mesh = makeMesh();
    this.mesh.traverse(o => {
      if (o.isMesh) {
        o.material = this.factory.ghostMat(true);
        o.castShadow = false;
      }
    });
    this.parent.add(this.mesh);
  }

  setValidity(valid) {
    if (!this.mesh) return;
    const mat = this.factory.ghostMat(valid);
    this.mesh.traverse(o => { if (o.isMesh) o.material = mat; });
  }

  setPose(x, y, angle = 0) {
    if (this.mesh) {
      this.mesh.position.set(x, y, 0.3);
      this.mesh.rotation.z = angle;
    }
  }

  setTrajectory(points) {
    this.hideTrajectory();
    if (!points || points.length < 2) return;
    const geo = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(p[0], p[1], 0.35)));
    this.line = new THREE.Line(geo, new THREE.LineDashedMaterial({
      color: this.stateColors.valid, dashSize: 0.16, gapSize: 0.12, transparent: true, opacity: 0.85,
    }));
    this.line.computeLineDistances();
    this.parent.add(this.line);
  }

  hideTrajectory() {
    if (this.line) { this.line.geometry.dispose(); this.line.material.dispose(); this.line.removeFromParent(); this.line = null; }
  }

  hide() {
    if (this.mesh) { this.mesh.removeFromParent(); this.mesh = null; }
    this.hideTrajectory();
    this.kind = null;
  }
}
