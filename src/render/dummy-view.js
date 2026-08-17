// The training dummy: a soft plush hero. Blob meshes are rebuilt from the
// particle rings every frame (preallocated buffers, no per-frame allocation),
// with squash-and-stretch, a canvas face, and a selection rim (spec §4:
// selection = lift/pose + rim + grounded marker, never bloom alone).
import * as THREE from 'three';

const RING_SAMPLES = 28;
const DEPTH = 0.34;

function makeBlobGeo() {
  // front fan + back fan + side ring
  const n = RING_SAMPLES;
  const vertCount = (n + 2) * 2 + n * 2;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(vertCount * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const idx = [];
  for (let i = 0; i < n; i++) {
    // front fan (0 = center, 1..n ring)
    idx.push(0, 1 + i, 1 + ((i + 1) % n));
    // back fan
    const c2 = n + 1;
    idx.push(c2, c2 + 1 + ((i + 1) % n), c2 + 1 + i);
    // sides
    const s0 = (n + 2) * 2;
    const a = s0 + i * 2, b = s0 + ((i + 1) % n) * 2;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// Catmull-Rom smooth ring through control points, sampled n times.
function sampleRing(ctrl, n, inflate) {
  const pts = [];
  const len = ctrl.length;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * len;
    const i0 = Math.floor(t) % len;
    const i1 = (i0 + 1) % len;
    const f = t - Math.floor(t);
    // simple smoothstep lerp (enough for a blob)
    const u = f * f * (3 - 2 * f);
    let x = ctrl[i0][0] + (ctrl[i1][0] - ctrl[i0][0]) * u;
    let y = ctrl[i0][1] + (ctrl[i1][1] - ctrl[i0][1]) * u;
    // wrap-aware shortest lerp for ring continuity
    const dx = ctrl[i1][0] - ctrl[i0][0], dy = ctrl[i1][1] - ctrl[i0][1];
    const adx = Math.abs(dx), ady = Math.abs(dy);
    if (adx > 1 || ady > 1) { // wrap seam: midpoint
      x = (ctrl[i0][0] + ctrl[i1][0]) / 2; y = (ctrl[i0][1] + ctrl[i1][1]) / 2;
    }
    pts.push([x, y]);
  }
  // inflate outward from centroid
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; }
  cx /= n; cy /= n;
  return { pts: pts.map(p => {
    const dx = p[0] - cx, dy = p[1] - cy;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    return [p[0] + (dx / d) * inflate, p[1] + (dy / d) * inflate];
  }), cx, cy };
}

function updateBlob(geo, ring, z) {
  const pos = geo.attributes.position.array;
  const n = RING_SAMPLES;
  const { pts, cx, cy } = ring;
  // front
  pos[0] = cx; pos[1] = cy; pos[2] = z + DEPTH / 2;
  for (let i = 0; i < n; i++) {
    pos[(1 + i) * 3] = pts[i][0]; pos[(1 + i) * 3 + 1] = pts[i][1]; pos[(1 + i) * 3 + 2] = z + DEPTH / 2;
  }
  // back
  const c2 = n + 1;
  pos[c2 * 3] = cx; pos[c2 * 3 + 1] = cy; pos[c2 * 3 + 2] = z - DEPTH / 2;
  for (let i = 0; i < n; i++) {
    pos[(c2 + 1 + i) * 3] = pts[i][0]; pos[(c2 + 1 + i) * 3 + 1] = pts[i][1]; pos[(c2 + 1 + i) * 3 + 2] = z - DEPTH / 2;
  }
  // sides
  const s0 = (n + 2) * 2;
  for (let i = 0; i < n; i++) {
    pos[(s0 + i * 2) * 3] = pts[i][0]; pos[(s0 + i * 2) * 3 + 1] = pts[i][1]; pos[(s0 + i * 2) * 3 + 2] = z + DEPTH / 2;
    pos[(s0 + i * 2 + 1) * 3] = pts[i][0]; pos[(s0 + i * 2 + 1) * 3 + 1] = pts[i][1]; pos[(s0 + i * 2 + 1) * 3 + 2] = z - DEPTH / 2;
  }
  geo.attributes.position.needsUpdate = true;
  geo.computeVertexNormals();
  return { cx, cy };
}

function makeFaceTexture(trim) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = '#2a2018';
  // eyes (friendly dots with shine)
  for (const x of [44, 84]) {
    g.beginPath(); g.arc(x, 52, 9, 0, 7); g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(x + 2.5, 49.5, 2.8, 0, 7); g.fill();
    g.fillStyle = '#2a2018';
  }
  // stitched smile
  g.strokeStyle = '#2a2018';
  g.lineWidth = 4;
  g.beginPath(); g.arc(64, 70, 18, 0.35, Math.PI - 0.35); g.stroke();
  g.lineWidth = 2;
  for (let i = -2; i <= 2; i++) {
    const x = 64 + i * 8.5;
    const y = 70 + Math.sqrt(Math.max(0, 18 * 18 - (x - 64) ** 2)) * 0.9;
    g.beginPath(); g.moveTo(x - 2.5, y - 2); g.lineTo(x + 2.5, y + 4); g.stroke();
  }
  // blush
  g.fillStyle = trim;
  g.globalAlpha = 0.5;
  for (const x of [32, 96]) { g.beginPath(); g.arc(x, 66, 6, 0, 7); g.fill(); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class DummyView {
  constructor(parent, factory, theme, trimOverride = null) {
    this.group = new THREE.Group();
    this.group.name = 'dummy';
    const t = theme;
    const bodyMat = factory.plushMat(t.dummy.body);
    const trimColor = trimOverride ?? t.dummy.trim;
    const trimMat = factory.plushMat(trimColor);

    this.torsoGeo = makeBlobGeo();
    this.headGeo = makeBlobGeo();
    this.torso = new THREE.Mesh(this.torsoGeo, bodyMat);
    this.head = new THREE.Mesh(this.headGeo, bodyMat);
    this.torso.castShadow = this.head.castShadow = true;
    this.group.add(this.torso, this.head);

    // scarf trim ring around the neck
    this.scarf = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.055, 10, 20), trimMat);
    this.scarf.castShadow = true;
    this.group.add(this.scarf);

    // belly button patch
    this.patch = new THREE.Mesh(new THREE.CircleGeometry(0.09, 12), trimMat);
    this.group.add(this.patch);

    // face plane
    this.faceTex = makeFaceTexture(`#${trimColor.toString(16).padStart(6, '0')}`);
    this.face = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.34),
      new THREE.MeshBasicMaterial({ map: this.faceTex, transparent: true }),
    );
    this.group.add(this.face);

    // selection/hover rim (scaled duplicate, backside) + grounded marker
    this.rim = new THREE.Mesh(this.torsoGeo, new THREE.MeshBasicMaterial({
      color: theme.accent, side: THREE.BackSide, transparent: true, opacity: 0.55,
    }));
    this.rim.scale.setScalar(1.07);
    this.rim.visible = false;
    this.group.add(this.rim);
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.42, 28),
      new THREE.MeshBasicMaterial({ color: theme.accent, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    this.group.add(this.marker);

    parent.add(this.group);
    this._tmp = [];
  }

  // particles: interpolated positions (Float32Array x,y pairs), body: {start,count}
  update(pos, body, time, state = {}) {
    // layout: [headC, torsoC, headRing x6, torsoRing x8]
    const hx = pos[body.start * 2], hy = pos[body.start * 2 + 1];
    const tx = pos[(body.start + 1) * 2], ty = pos[(body.start + 1) * 2 + 1];
    const headRing = [], torsoRing = [];
    for (let i = 0; i < 6; i++) headRing.push([pos[(body.start + 2 + i) * 2], pos[(body.start + 2 + i) * 2 + 1]]);
    for (let i = 0; i < 8; i++) torsoRing.push([pos[(body.start + 8 + i) * 2], pos[(body.start + 8 + i) * 2 + 1]]);
    const headC = updateBlob(this.headGeo, sampleRing(headRing, RING_SAMPLES, 0.085), 0);
    const torsoC = updateBlob(this.torsoGeo, sampleRing(torsoRing, RING_SAMPLES, 0.1), 0);

    // face follows head center, tilts with the up-vector
    const upx = hx - tx, upy = hy - ty;
    const ang = Math.atan2(upx, upy); // 0 = upright
    this.face.position.set(headC.cx, headC.cy, DEPTH / 2 + 0.01);
    this.face.rotation.z = ang * 0.8;
    // scarf at neck
    this.scarf.position.set((headC.cx + torsoC.cx) / 2, (headC.cy + torsoC.cy) / 2, 0);
    this.scarf.rotation.z = ang * 0.5;
    this.scarf.scale.setScalar(1 + Math.sin(time * 2.1) * 0.02);
    // patch on belly
    this.patch.position.set(torsoC.cx + upx * 0.1, torsoC.cy + upy * 0.06, DEPTH / 2 + 0.01);
    this.patch.rotation.z = ang;

    // squash & stretch from speed (bounded, readable)
    const squash = state.squash ?? 1;
    this.torso.scale.set(1 / Math.sqrt(squash), squash, 1);
    this.head.scale.set(1 / Math.sqrt(squash), squash, 1);

    this.group.position.z = 0;
  }

  setSelected(sel) {
    this.rim.visible = sel;
    this.marker.visible = sel;
  }

  setMarkerPos(x, y) {
    this.marker.position.set(x, y + 0.02, 0);
  }

  dispose() {
    this.torsoGeo.dispose();
    this.headGeo.dispose();
    this.faceTex.dispose();
    this.face.material.dispose();
    this.rim.material.dispose();
    this.marker.material.dispose();
    this.group.removeFromParent();
  }
}
