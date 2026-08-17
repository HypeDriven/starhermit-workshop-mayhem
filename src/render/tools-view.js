// Placed tool views: piston, pad, fan, magnet, weight. Original procedural
// designs; animation derives from tool state and event tier (spec §4).
import * as THREE from 'three';

export function makeToolMesh(kind, factory, theme) {
  const g = new THREE.Group();
  const F = factory;
  const t = theme;
  if (kind === 'piston') {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.5), F.metalMat(t.accent, 0.5, 0.7));
    plate.castShadow = true;
    const sleeve = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const seg = new THREE.Mesh(new THREE.BoxGeometry(0.22 - i * 0.05, 0.34 - i * 0.05, 0.34 - i * 0.05), F.metalMat(t.bell, 0.4, 0.8));
      seg.position.x = 0.16 + i * 0.2;
      seg.castShadow = true;
      sleeve.add(seg);
    }
    const fist = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.42, 0.42), F.plushMat(t.pad));
    fist.position.x = 0.85;
    fist.castShadow = true;
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), F.plushMat(t.pad));
    glove.position.set(0.98, 0.1, 0.12);
    g.add(plate, sleeve, fist, glove);
    g.userData.fist = fist;
    g.userData.sleeve = sleeve;
    g.userData.glove = glove;
  } else if (kind === 'pad') {
    const baseDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.5, 0.08, 22), F.plushMat(t.pad));
    baseDisc.castShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.05, 8, 22), F.emissiveMat(t.accent, 0.5));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.06;
    const spring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 8, 16), F.metalMat(t.bell, 0.4, 0.8));
    spring.rotation.x = Math.PI / 2;
    spring.position.y = 0.1;
    g.add(baseDisc, ring, spring);
    g.userData.spring = spring;
  } else if (kind === 'fan') {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 0.16, 12), F.metalMat(t.accent, 0.5, 0.7));
    base.castShadow = true;
    const cage = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.03, 8, 24), F.metalMat(t.bell, 0.35, 0.85));
    cage.position.y = 0.3;
    const blades = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.28, 0.02), F.plushMat(t.zone));
      blade.position.y = 0.14;
      const holder = new THREE.Group();
      holder.add(blade);
      holder.rotation.z = (i / 3) * Math.PI * 2;
      blades.add(holder);
    }
    blades.position.y = 0.3;
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), F.metalMat(t.bell, 0.3, 0.9));
    hub.position.y = 0.3;
    g.add(base, cage, blades, hub);
    g.userData.blades = blades;
    g.userData.cage = cage;
  } else if (kind === 'magnet') {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.11, 10, 20, Math.PI), F.plushMat(t.pad));
    arc.castShadow = true;
    const poleL = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.18, 10), F.metalMat(t.bell, 0.3, 0.9));
    poleL.position.set(-0.3, -0.05, 0);
    const poleR = poleL.clone();
    poleR.position.set(0.3, -0.05, 0);
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.03, 6, 20, Math.PI), F.emissiveMat(t.zone, 0.6));
    g.add(arc, poleL, poleR, coil);
    g.userData.coil = coil;
  } else if (kind === 'weight') {
    // anvil: waist + top block + horn
    const waist = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.3), F.metalMat(0x3a3f4a, 0.45, 0.9));
    waist.position.y = -0.1;
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.2, 0.34), F.metalMat(0x4a505c, 0.35, 0.95));
    top.position.y = 0.15;
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.34, 10), F.metalMat(0x4a505c, 0.35, 0.95));
    horn.rotation.z = -Math.PI / 2;
    horn.position.set(0.45, 0.15, 0);
    const stamp = new THREE.Mesh(new THREE.CircleGeometry(0.07, 10), F.emissiveMat(theme.accent, 0.8));
    stamp.position.set(0, 0.15, 0.18);
    g.add(waist, top, horn, stamp);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    // hanging chain (visible while pinned)
    const chain = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const link = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.014, 6, 10), F.metalMat(t.bell, 0.4, 0.85));
      link.position.y = 0.4 + i * 0.09;
      link.rotation.y = (i % 2) * Math.PI / 2;
      chain.add(link);
    }
    g.add(chain);
    g.userData.chain = chain;
  }
  return g;
}

export class ToolView {
  constructor(parent, factory, theme, tool) {
    this.kind = tool.type;
    this.id = tool.id;
    this.group = makeToolMesh(tool.type, factory, theme);
    this.group.position.set(tool.x, tool.y, 0);
    this.group.rotation.z = Math.atan2(tool.dy, tool.dx);
    if (tool.type === 'pad') this.group.rotation.z = 0;
    if (tool.type === 'weight') this.group.rotation.z = 0;
    if (tool.type === 'magnet') this.group.rotation.z = 0;
    this.baseRotZ = this.group.rotation.z;
    this.anim = 0;
    this.spent = false;
    parent.add(this.group);
  }

  onTrigger() { this.anim = 1; }

  update(tool, time, dt) {
    const u = this.group.userData;
    if (this.kind === 'piston') {
      if (tool.status === 'spent' && this.anim > 0) {
        this.anim = Math.max(0, this.anim - dt * 6);
      }
      const ext = tool.status === 'spent' ? this.anim : 0;
      const punch = ext > 0.5 ? (1 - ext) * 2 : ext * 2; // out-and-back
      u.fist.position.x = 0.85 + punch * 0.7;
      u.glove.position.x = 0.98 + punch * 0.7;
      u.sleeve.scale.x = 1 + punch * 1.2;
      u.sleeve.position.x = punch * 0.35;
    } else if (this.kind === 'pad') {
      const s = 1 + Math.sin(time * 3.2) * 0.02;
      this.group.scale.set(s, 1, s);
      if (this.anim > 0) {
        this.anim = Math.max(0, this.anim - dt * 5);
        const bounce = Math.sin(this.anim * Math.PI) * 0.18;
        u.spring.scale.setScalar(1 + bounce);
        this.group.scale.y = 1 - bounce * 0.5;
      }
    } else if (this.kind === 'fan') {
      const active = tool.status === 'active';
      const spin = active ? 22 : 1.2;
      u.blades.rotation.z += spin * dt;
      u.cage.material.emissiveIntensity = active ? 0.8 : 0;
    } else if (this.kind === 'magnet') {
      this.group.position.y = tool.y + Math.sin(time * 1.8) * 0.05;
      const active = tool.status === 'active';
      u.coil.material.emissiveIntensity = active ? 1.6 + Math.sin(time * 20) * 0.6 : 0.6;
      if (active) this.group.rotation.z = this.baseRotZ + Math.sin(time * 6) * 0.06;
    } else if (this.kind === 'weight') {
      const pinned = tool.status === 'armed';
      u.chain.visible = pinned;
      if (!pinned) {
        // physics drives the body mesh (separate); hide the hanger decoration
        this.group.visible = false;
      } else {
        this.group.rotation.z = Math.sin(time * 1.1) * 0.05;
      }
    }
  }

  dispose() {
    this.group.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
    this.group.removeFromParent();
  }
}
