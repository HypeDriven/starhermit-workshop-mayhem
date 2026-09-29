// Workshop environment: room shell, shelves with instanced props, pegboard,
// hanging lamp, window light. Original procedural geometry, deterministic
// visual seed, detail follows the Graphics "detail" setting; dust motes in
// the lamp light follow "particles" (spec §4 scene design).
import * as THREE from 'three';

export class Workshop {
  constructor(scene, factory, theme, rng, { detail: detailSetting = 'detailed', particles = 'high' } = {}) {
    this.factory = factory;
    this.theme = theme;
    this.group = new THREE.Group();
    this.group.name = 'workshop';
    this.disposables = [];
    this.build(rng, detailSetting, particles);
    scene.add(this.group);
  }

  track(obj) { this.disposables.push(obj); return obj; }

  build(rng, detailSetting, particles) {
    const t = this.theme;
    const F = this.factory;
    const detail = detailSetting === 'detailed' ? 1 : 0.35;

    // room: floor slab + two walls (back + left), sized beyond the arena
    const floorGeo = this.track(new THREE.BoxGeometry(17, 0.4, 9));
    const floor = new THREE.Mesh(floorGeo, F.floorMat());
    floor.position.set(0, -0.22, 0.5);
    floor.receiveShadow = true;
    this.group.add(floor);

    // floorboards (alternating tint strips)
    const boardGeo = this.track(new THREE.BoxGeometry(0.06, 0.02, 9));
    const boardMat = F.floorMat(true);
    const boards = new THREE.InstancedMesh(boardGeo, boardMat, 40);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 40; i++) {
      m4.makeTranslation(-8.5 + i * 0.43, 0.0, 0.5);
      boards.setMatrixAt(i, m4);
    }
    boards.receiveShadow = true;
    this.group.add(boards);

    const wallGeo = this.track(new THREE.BoxGeometry(17, 8.4, 0.4));
    const back = new THREE.Mesh(wallGeo, F.wallMat());
    back.position.set(0, 4.0, -3.3);
    back.receiveShadow = true;
    this.group.add(back);

    const sideGeo = this.track(new THREE.BoxGeometry(0.4, 8.4, 9));
    const sideL = new THREE.Mesh(sideGeo, F.wallMat());
    sideL.position.set(-8.3, 4.0, 0.5);
    this.group.add(sideL);
    const sideR = new THREE.Mesh(sideGeo, F.wallMat());
    sideR.position.set(8.3, 4.0, 0.5);
    this.group.add(sideR);

    // skirting
    const skirtGeo = this.track(new THREE.BoxGeometry(17, 0.3, 0.1));
    const skirt = new THREE.Mesh(skirtGeo, F.woodMat(t.accent, 0.7));
    skirt.position.set(0, 0.15, -3.05);
    this.group.add(skirt);

    this.buildShelves(rng, detail);
    this.buildPegboard(detail);
    this.buildLamp();
    this.buildWindow(detail > 0.5);
    if (detail > 0.5) this.buildBench();
    if (particles === 'high') this.buildDust();
  }

  // drifting dust motes caught in the lamp and window light (decorative)
  buildDust() {
    const n = 160;
    const pos = new Float32Array(n * 3);
    this.dustSeed = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const h = (k) => { const x = Math.sin((i * 4 + k) * 91.7 + 12.3) * 43758.5; return x - Math.floor(x); };
      this.dustSeed.set([-7 + h(0) * 14, 0.4 + h(1) * 7, -2.8 + h(2) * 4.2, h(3) * 6.28], i * 4);
      pos.set([this.dustSeed[i * 4], this.dustSeed[i * 4 + 1], this.dustSeed[i * 4 + 2]], i * 3);
    }
    const geo = this.track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 32, 32);
    const map = this.track(new THREE.CanvasTexture(c));
    const mat = this.track(new THREE.PointsMaterial({
      size: 0.05, map, color: this.theme.lamp.color, transparent: true, opacity: 0.55,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }));
    this.dust = new THREE.Points(geo, mat);
    this.dust.frustumCulled = false;
    this.group.add(this.dust);
  }

  buildShelves(rng, detail) {
    const t = this.theme, F = this.factory;
    const shelfMat = F.woodMat(t.shelf, 0.75);
    const shelfGeo = this.track(new THREE.BoxGeometry(5.6, 0.14, 1.1));
    for (const y of [3.4, 4.6]) {
      const s = new THREE.Mesh(shelfGeo, shelfMat);
      s.position.set(-4.4, y, -2.7);
      s.castShadow = s.receiveShadow = true;
      this.group.add(s);
    }
    // instanced clutter: jars, boxes, gears, books
    const n = Math.floor(14 * detail);
    const jarGeo = this.track(new THREE.CylinderGeometry(0.16, 0.18, 0.42, 10));
    const boxGeo = this.track(new THREE.BoxGeometry(0.34, 0.3, 0.3));
    const gearGeo = this.track(new THREE.TorusGeometry(0.17, 0.06, 8, 14));
    const bookGeo = this.track(new THREE.BoxGeometry(0.1, 0.34, 0.26));
    const jarMat = F.make({ color: t.accent, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.75 });
    const boxMat = F.woodMat(t.floorAlt, 0.85);
    const gearMat = F.metalMat(t.bell, 0.4, 0.8);
    const bookMat = F.make({ color: t.pad, roughness: 0.8 });
    const sets = [
      new THREE.InstancedMesh(jarGeo, jarMat, n),
      new THREE.InstancedMesh(boxGeo, boxMat, n),
      new THREE.InstancedMesh(gearGeo, gearMat, n),
      new THREE.InstancedMesh(bookGeo, bookMat, n),
    ];
    const m4 = new THREE.Matrix4();
    const e = new THREE.Euler();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    let i = 0;
    for (const y of [3.4, 4.6]) {
      let x = -6.8;
      while (x < -2.2 && i < n * sets.length) {
        const which = Math.floor(rng.next() * 4);
        const mesh = sets[which];
        const idx = Math.floor(i / 4) % n;
        e.set(0, rng.next() * Math.PI, which === 2 ? Math.PI / 2 : 0);
        q.setFromEuler(e);
        v.set(x + rng.next() * 0.2, y + 0.28, -2.7 + (rng.next() - 0.5) * 0.4);
        m4.compose(v, q, new THREE.Vector3(1, 1, 1));
        mesh.setMatrixAt(idx, m4);
        mesh.count = Math.max(mesh.count, idx + 1);
        x += 0.5 + rng.next() * 0.45;
        i++;
      }
    }
    for (const mesh of sets) { mesh.castShadow = true; this.group.add(mesh); }

    // right side: stacked crates scenery
    const crateGeo = this.track(new THREE.BoxGeometry(0.6, 0.6, 0.6));
    const crateMat = F.woodMat(t.shelf, 0.85);
    const crates = new THREE.InstancedMesh(crateGeo, crateMat, 5);
    const pos = [[6.4, 0.3, -2.4], [7.1, 0.3, -2.2], [6.7, 0.9, -2.35], [6.3, 0.3, -1.7], [6.9, 0.9, -2.0]];
    pos.forEach((p, k) => {
      e.set(0, (k * 0.4) % 0.6 - 0.3, 0); q.setFromEuler(e);
      m4.compose(new THREE.Vector3(...p), q, new THREE.Vector3(1, 1, 1));
      crates.setMatrixAt(k, m4);
    });
    crates.castShadow = crates.receiveShadow = true;
    this.group.add(crates);
  }

  buildPegboard(detail) {
    const t = this.theme, F = this.factory;
    const board = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(3.4, 2.2, 0.08)),
      F.woodMat(t.floorAlt, 0.9),
    );
    board.position.set(4.6, 4.4, -3.05);
    this.group.add(board);
    // hanging tool silhouettes (original iconography)
    const n = Math.floor(6 * detail);
    const silMat = F.make({ color: t.wall, roughness: 0.9 });
    const shapes = [
      new THREE.CylinderGeometry(0.05, 0.05, 0.7, 8),        // handle
      new THREE.BoxGeometry(0.3, 0.3, 0.1),                  // mallet head
      new THREE.TorusGeometry(0.2, 0.045, 8, 16, Math.PI),   // magnet arc
      new THREE.ConeGeometry(0.16, 0.5, 8),                  // awl
      new THREE.BoxGeometry(0.1, 0.6, 0.08),                 // ruler
      new THREE.CylinderGeometry(0.12, 0.12, 0.16, 10),      // tin
    ].map(g => this.track(g));
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(shapes[i % shapes.length], silMat);
      m.position.set(3.4 + (i % 3) * 1.1, 4.9 - Math.floor(i / 3) * 0.9, -2.98);
      m.castShadow = true;
      this.group.add(m);
    }
  }

  buildLamp() {
    const t = this.theme, F = this.factory;
    // the lamp hangs from a pivot at the ceiling so it can sway gently
    this.lampPivot = new THREE.Group();
    this.lampPivot.position.set(0, 8.6, -0.6);
    this.group.add(this.lampPivot);
    const cord = new THREE.Mesh(
      this.track(new THREE.CylinderGeometry(0.015, 0.015, 2.0, 6)),
      F.make({ color: 0x222222, roughness: 0.9 }),
    );
    cord.position.set(0, -1.0, 0);
    this.lampPivot.add(cord);
    const shade = new THREE.Mesh(
      this.track(new THREE.ConeGeometry(0.55, 0.5, 18, 1, true)),
      F.metalMat(t.accent, 0.5, 0.6),
    );
    shade.position.set(0, -2.0, 0);
    this.lampPivot.add(shade);
    const bulb = new THREE.Mesh(
      this.track(new THREE.SphereGeometry(0.16, 12, 10)),
      F.emissiveMat(t.lamp.color, 2.2),
    );
    bulb.position.set(0, -2.15, 0);
    this.lampPivot.add(bulb);
    this.bulb = bulb;
  }

  buildWindow(shaft) {
    const t = this.theme, F = this.factory;
    const frame = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(2.2, 2.6, 0.12)),
      F.woodMat(t.accent, 0.7),
    );
    frame.position.set(6.6, 5.2, -3.06);
    this.group.add(frame);
    const pane = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(1.9, 2.3)),
      F.emissiveMat(t.hemi.sky, 0.7),
    );
    pane.position.set(6.6, 5.2, -2.99);
    this.group.add(pane);
    const barGeo = this.track(new THREE.BoxGeometry(0.06, 2.3, 0.04));
    for (const x of [-0.32, 0.32]) {
      const bar = new THREE.Mesh(barGeo, F.woodMat(t.accent, 0.7));
      bar.position.set(6.6 + x, 5.2, -2.97);
      this.group.add(bar);
    }
    if (shaft) {
      // soft additive light shaft slanting from the window to the floor
      const c = document.createElement('canvas');
      c.width = 64; c.height = 128;
      const g = c.getContext('2d');
      const lin = g.createLinearGradient(0, 0, 0, 128);
      lin.addColorStop(0, 'rgba(255,255,255,0.9)');
      lin.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = lin; g.fillRect(0, 0, 64, 128);
      const side = g.createLinearGradient(0, 0, 64, 0);
      g.globalCompositeOperation = 'destination-in';
      side.addColorStop(0, 'rgba(0,0,0,0)'); side.addColorStop(0.3, 'rgba(0,0,0,1)');
      side.addColorStop(0.7, 'rgba(0,0,0,1)'); side.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = side; g.fillRect(0, 0, 64, 128);
      const map = this.track(new THREE.CanvasTexture(c));
      const mat = this.track(new THREE.MeshBasicMaterial({
        map, color: t.hemi.sky, transparent: true, opacity: 0.045, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      }));
      const beam = new THREE.Mesh(this.track(new THREE.PlaneGeometry(1.6, 6.0)), mat);
      beam.position.set(5.6, 3.0, -1.6);
      beam.rotation.set(-0.55, 0.35, 0.28);
      this.group.add(beam);
    }
  }

  buildBench() {
    const t = this.theme, F = this.factory;
    const top = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(2.6, 0.16, 1.0)),
      F.woodMat(t.shelf, 0.7),
    );
    top.position.set(-6.6, 1.0, -1.8);
    top.castShadow = top.receiveShadow = true;
    this.group.add(top);
    const legGeo = this.track(new THREE.BoxGeometry(0.12, 1.0, 0.12));
    for (const [dx, dz] of [[-1.1, -0.4], [1.1, -0.4], [-1.1, 0.4], [1.1, 0.4]]) {
      const leg = new THREE.Mesh(legGeo, F.woodMat(t.wall, 0.9));
      leg.position.set(-6.6 + dx, 0.5, -1.8 + dz);
      this.group.add(leg);
    }
  }

  update(time, dt = 0, { reducedMotion = false, lamp = null } = {}) {
    if (reducedMotion) {
      // ambient motion stops: lamp hangs still, dust holds its place
      if (this.lampPivot) this.lampPivot.rotation.set(0, 0, 0);
      if (this.bulb) this.bulb.material.emissiveIntensity = 2.2;
    } else {
      // lamp flicker + gentle sway (subtle, decorative; paused with decorative motion)
      if (this.bulb) {
        const f = 1 + Math.sin(time * 7.3) * 0.02 + Math.sin(time * 17.7) * 0.015;
        this.bulb.material.emissiveIntensity = 2.2 * f;
      }
      if (this.lampPivot) {
        this.lampPivot.rotation.z = Math.sin(time * 0.9) * 0.035;
        this.lampPivot.rotation.x = Math.sin(time * 0.63 + 1.1) * 0.02;
      }
      if (this.dust) {
        const pos = this.dust.geometry.attributes.position;
        const a = pos.array, sd = this.dustSeed;
        for (let i = 0; i < a.length / 3; i++) {
          const ph = sd[i * 4 + 3];
          a[i * 3] = sd[i * 4] + Math.sin(time * 0.21 + ph) * 0.35;
          a[i * 3 + 1] = sd[i * 4 + 1] + Math.sin(time * 0.13 + ph * 1.7) * 0.3;
          a[i * 3 + 2] = sd[i * 4 + 2] + Math.cos(time * 0.17 + ph) * 0.2;
        }
        pos.needsUpdate = true;
      }
    }
    // the point light follows the swaying bulb
    if (lamp && this.bulb) {
      this.bulb.updateWorldMatrix(true, false);
      lamp.position.setFromMatrixPosition(this.bulb.matrixWorld);
      lamp.position.y -= 0.15;
    }
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}
