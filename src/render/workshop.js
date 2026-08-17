// Workshop environment: room shell, shelves with instanced props, pegboard,
// hanging lamp, window light. Original procedural geometry, deterministic
// visual seed, detail follows quality tier (spec §4 scene design).
import * as THREE from 'three';

export class Workshop {
  constructor(scene, factory, theme, rng, tier) {
    this.factory = factory;
    this.theme = theme;
    this.group = new THREE.Group();
    this.group.name = 'workshop';
    this.disposables = [];
    this.build(rng, tier);
    scene.add(this.group);
  }

  track(obj) { this.disposables.push(obj); return obj; }

  build(rng, tier) {
    const t = this.theme;
    const F = this.factory;
    const detail = tier === 'low' ? 0.35 : tier === 'medium' ? 0.7 : 1;

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
    this.buildWindow();
    if (detail > 0.5) this.buildBench();
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
    const cord = new THREE.Mesh(
      this.track(new THREE.CylinderGeometry(0.015, 0.015, 2.0, 6)),
      F.make({ color: 0x222222, roughness: 0.9 }),
    );
    cord.position.set(0, 7.6, -0.6);
    this.group.add(cord);
    const shade = new THREE.Mesh(
      this.track(new THREE.ConeGeometry(0.55, 0.5, 18, 1, true)),
      F.metalMat(t.accent, 0.5, 0.6),
    );
    shade.position.set(0, 6.6, -0.6);
    this.group.add(shade);
    const bulb = new THREE.Mesh(
      this.track(new THREE.SphereGeometry(0.16, 12, 10)),
      F.emissiveMat(t.lamp.color, 2.2),
    );
    bulb.position.set(0, 6.45, -0.6);
    this.group.add(bulb);
    this.bulb = bulb;
  }

  buildWindow() {
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

  update(time) {
    // lamp flicker (subtle, decorative; paused with decorative motion)
    if (this.bulb) {
      const f = 1 + Math.sin(time * 7.3) * 0.02 + Math.sin(time * 17.7) * 0.015;
      this.bulb.material.emissiveIntensity = 2.2 * f;
    }
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}
