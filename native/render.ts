// The workshop in starhermit:scene: the browser build's src/render/*.js
// (scene.js orchestration, materials.js procedural PBR, workshop.js room,
// dummy-view.js soft-body plush, props-view.js statics/bells/zones/mounts/
// bodies/ghost, tools-view.js tool meshes, vfx.js pooled particles,
// camera.js spring rig) ported from three.js r170 nearly line for line. At
// engine minor 24 the old page's own light intensities (r155+ physical units),
// shadow values (bias −0.0004, normalBias 0.02, the shadow camera fitted to the
// arena) and reflections (r163+: `new RoomEnvironment(renderer)`, PMREM sigma
// 0.04, scene.environmentIntensity 0.16) are used unchanged. Differences:
// the plush sheen (MeshPhysicalMaterial sheen) does not exist in the engine
// and is left out; the dashed trajectory line (LineDashedMaterial) is drawn
// as line segments; the canvas textures are OffscreenCanvases, the metal
// speckle seeded instead of Math.random; post effects are the runtime's
// (GTAO, UnrealBloom → renderer.bloom, the grade ShaderPass → renderer.grade in
// display space). The runtime owns render scale, DPR caps and adaptive
// resolution. Context loss is the runtime's concern.
import {
  AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, CircleGeometry, Color, ConeGeometry,
  CylinderGeometry, DirectionalLight, DoubleSide, EdgesGeometry, Euler, Fog, Group, HemisphereLight, InstancedMesh, LatheGeometry,
  LineBasicMaterial, LineSegments, Material, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshPhysicalMaterial,
  MeshStandardMaterial, Object3D, PerspectiveCamera, PlaneGeometry, Plane, PMREMGenerator, PointLight, Points, PointsMaterial,
  Quaternion, Raycaster, RepeatWrapping, RingGeometry, RoomEnvironment, SphereGeometry, SRGBColorSpace, TorusGeometry, Vector2,
  Vector3, ACESFilmicToneMapping, renderer, scene, type Texture,
} from "starhermit:scene";
import { OffscreenCanvas, type OffscreenCanvasRenderingContext2D } from "starhermit:canvas";
import { Engine, Physics, Rng, Schema, Serialize, Themes, type Bounds, type GameEvent, type Level, type Session, type State, type Theme, type Tool, type ToolKey, type Goal } from "./game.ts";
import { particleCap, PARTICLE_MAX, type Look } from "./quality.ts";

const MAT = Physics.MAT;
type Ctx2D = OffscreenCanvasRenderingContext2D | null;
const hexs = (c: number): string => `#${c.toString(16).padStart(6, "0")}`;
function canvas(w: number, h: number): { c: OffscreenCanvas; g: NonNullable<Ctx2D> } {
  const c = new OffscreenCanvas(w, h);
  return { c, g: c.getContext("2d") as OffscreenCanvasRenderingContext2D };
}

// ============================================================ materials.js
function hash(i: number): number { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
function addDetail(g: NonNullable<Ctx2D>, kind: string, size: number): void {
  if (kind === "wood") {
    for (let k = 0; k < 2; k++) {
      const x = hash(k * 3 + 1) * size, y = hash(k * 3 + 2) * size, r = 2 + hash(k * 3 + 3) * 2.5;
      g.globalAlpha = 0.16; g.fillStyle = "#1a0f06";
      g.beginPath(); g.ellipse(x, y, r * 2.6, r, 0, 0, 7); g.fill();
    }
  }
  const n = kind === "fabric" ? 500 : 700;
  for (let i = 0; i < n; i++) {
    const lx = hash(i * 1.37 + 7) * size, ly = hash(i * 2.91 + 3) * size;
    g.globalAlpha = 0.03 + hash(i + 0.5) * 0.05;
    g.fillStyle = hash(i * 5.3) > 0.5 ? "#ffffff" : "#000000";
    g.fillRect(lx, ly, kind === "wood" ? 4 + hash(i * 0.7) * 6 : 1, 1);
  }
  g.globalAlpha = 1;
}
function makeTexture(kind: string, base: string, accent: string, detailed: boolean, px: number): CanvasTexture {
  const size = detailed ? 256 : 128;
  const real = detailed ? px : Math.min(128, px);
  const { c, g } = canvas(real, real);
  if (real !== size) g.scale(real / size, real / size);
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  g.strokeStyle = accent; g.globalAlpha = 0.35;
  if (kind === "wood") {
    for (let i = 0; i < 12; i++) {
      g.lineWidth = 1 + (i % 3);
      g.beginPath();
      const y = (i / 12) * size + Math.sin(i * 3.7) * 4;
      g.moveTo(0, y);
      for (let x = 0; x <= size; x += 8) g.lineTo(x, y + Math.sin(x * 0.08 + i) * 2.5);
      g.stroke();
    }
  } else if (kind === "fabric") {
    g.globalAlpha = 0.16;
    for (let i = 0; i < size; i += 4) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, size); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(size, i); g.stroke();
    }
  } else if (kind === "metal") {
    g.globalAlpha = 0.12;
    const rnd = Rng.createStream(base.length * 131 + accent.length);
    for (let i = 0; i < 40; i++) { g.beginPath(); g.arc(rnd.next() * size, rnd.next() * size, 1 + rnd.next() * 3, 0, 7); g.stroke(); }
  }
  if (detailed) addDetail(g, kind, size);
  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  if (detailed) tex.anisotropy = 4;
  return tex;
}
const texCache = new Map<string, CanvasTexture>();
function tex(kind: string, base: string, accent: string, detailed: boolean, px: number): CanvasTexture {
  const key = `${kind}:${base}:${accent}:${detailed ? "d" : "p"}:${px}`;
  let t = texCache.get(key);
  if (!t) { t = makeTexture(kind, base, accent, detailed, px); texCache.set(key, t); }
  return t;
}
type MatParams = Record<string, unknown>;
class MaterialFactory {
  owned: Material[] = [];
  constructor(public theme: Theme, public rich: boolean, public detailed: boolean, public shading: string, public texture: number, public segments: number) {}
  seg(n: number, min = 3): number { return Math.max(min, Math.round(n * this.segments)); }
  private lambert(p: MatParams): Material {
    const q: MatParams = {};
    for (const k of ["color", "map", "emissive", "emissiveIntensity", "transparent", "opacity", "side", "depthWrite"]) if (p[k] !== undefined) q[k] = p[k];
    return new MeshLambertMaterial(q as never);
  }
  make(p: MatParams): MeshStandardMaterial {
    const m = this.shading === "lambert" ? this.lambert(p) : new MeshStandardMaterial(p as never);
    this.owned.push(m);
    return m as MeshStandardMaterial;
  }
  makeRich(p: MatParams, extras: MatParams): MeshStandardMaterial {
    const m = this.shading === "lambert" ? this.lambert(p)
      : this.rich && this.shading === "physical" ? new MeshPhysicalMaterial({ ...p, ...extras } as never) : new MeshStandardMaterial(p as never);
    this.owned.push(m);
    return m as MeshStandardMaterial;
  }
  tex(kind: string, base: string, accent: string): CanvasTexture { return tex(kind, base, accent, this.detailed, this.texture); }
  floorMat(alt = false): Material {
    const t = this.theme;
    const map = this.tex("wood", hexs(alt ? t.floorAlt : t.floor), hexs(t.wall));
    map.repeat.set(2, 2);
    return this.makeRich({ map, roughness: 0.8, metalness: 0.02 }, { clearcoat: 0.12, clearcoatRoughness: 0.55 });
  }
  wallMat(): Material {
    const t = this.theme;
    const map = this.tex("wood", hexs(t.wall), hexs(t.shelf));
    map.repeat.set(3, 2);
    return this.make({ map, roughness: 0.9, metalness: 0.02 });
  }
  woodMat(color: number, rough = 0.8): Material {
    return this.makeRich({ color: 0xffffff, roughness: rough, metalness: 0.03, map: this.tex("wood", hexs(color), "#00000055") }, { clearcoat: 0.3, clearcoatRoughness: 0.35 });
  }
  metalMat(color: number, rough = 0.35, metal = 0.85): MeshStandardMaterial {
    const metalness = this.rich ? metal : Math.min(metal, 0.45);
    return this.makeRich({ color: 0xffffff, roughness: rough, metalness, map: this.tex("metal", hexs(color), "#ffffff44") }, { clearcoat: 0.6, clearcoatRoughness: 0.12 });
  }
  /** The old plush also had sheen 0.45 (High/Ultra); the engine has no sheen. */
  plushMat(color: number): Material {
    return this.makeRich({ color: 0xffffff, map: this.tex("fabric", hexs(color), "#00000033"), roughness: 0.95, metalness: 0 }, {});
  }
  emissiveMat(color: number, intensity = 1.4): MeshStandardMaterial {
    return this.make({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.5 });
  }
  ghostMat(valid: boolean, colors: Palette): MeshBasicMaterial {
    return new MeshBasicMaterial({ color: valid ? colors.valid : colors.invalid, transparent: true, opacity: 0.45, depthWrite: false });
  }
  dispose(): void { for (const m of this.owned) m.dispose(); this.owned.length = 0; }
}
export interface Palette { valid: number; invalid: number; zone: number; goal: number }
export const STATE_PALETTES: Record<string, Palette> = {
  default: { valid: 0x51ff9a, invalid: 0xff5151, zone: 0x64d8ff, goal: 0xffe083 },
  deuteranopia: { valid: 0x51b0ff, invalid: 0xffb051, zone: 0xff6ad8, goal: 0xf0f0f0 },
  tritanopia: { valid: 0x51ffd8, invalid: 0xff6a6a, zone: 0xffd851, goal: 0xf0f0f0 },
  highContrast: { valid: 0x00ff88, invalid: 0xff3333, zone: 0x00ccff, goal: 0xffff00 },
};

// ============================================================ camera.js
export const FRAMING = {
  fov: 33, target: [0, 2.35, 0] as const, distance: 13.6, height: 5.1, portraitDistance: 18.0, portraitHeight: 5.8,
  title: { target: [-0.8, 2.1, 0] as const, distance: 12.6, height: 4.4 }, results: { distance: 11.0, height: 4.2 }, margin: 1.18,
};
const damp = (c: number, t: number, l: number, dt: number): number => c + (t - c) * (1 - Math.exp(-l * dt));
class CameraRig {
  mode = "game";
  pos = new Vector3(0, FRAMING.height, FRAMING.distance);
  look = new Vector3(...FRAMING.target);
  goalPos = this.pos.clone();
  goalLook = this.look.clone();
  shakes: { t: number; duration: number; strength: number }[] = [];
  reducedMotion = false;
  aspect = 16 / 9;
  focusBounds: Bounds | null = null;
  time = 0;
  constructor(public camera: PerspectiveCamera) { this.applyImmediate(); }
  setBounds(b: Bounds): void { this.focusBounds = b; this.retarget(this.mode); }
  setReducedMotion(on: boolean): void { this.reducedMotion = on; if (on) this.shakes.length = 0; }
  retarget(mode: string): void {
    this.mode = mode;
    const F = FRAMING;
    const portrait = this.aspect < 1;
    let dist = portrait ? F.portraitDistance : F.distance;
    let height = portrait ? F.portraitHeight : F.height;
    let look = new Vector3(...F.target);
    if (mode === "title") { look = new Vector3(...F.title.target); dist = F.title.distance; height = F.title.height; }
    else if (mode === "results") { dist *= F.results.distance / F.distance; height = F.results.height; }
    if (this.focusBounds && mode === "game") {
      const b = this.focusBounds;
      look = new Vector3(b.x + b.w / 2, Math.max(1.6, b.y + b.h * 0.32), 0);
      const needW = (b.w * F.margin) / this.aspect;
      const needH = b.h * F.margin * (this.aspect > 1.9 ? 1.15 : this.aspect < 1 ? 0.95 : 0.8);
      const fit = Math.max(needH, needW);
      const fov = this.aspect < 1 ? 46 : F.fov;
      if (this.camera.fov !== fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
      dist = Math.max(dist, Math.min(fit / (2 * Math.tan((fov * Math.PI / 180) / 2)) * 1.05, 26));
    }
    this.goalLook.copy(look);
    this.goalPos.set(look.x, height, look.z + dist);
  }
  resize(aspect: number): void { this.aspect = aspect; this.retarget(this.mode); }
  shake(strength: number, duration = 0.35): void {
    if (this.reducedMotion) return;
    this.shakes.push({ t: 0, duration, strength: Math.min(strength, 0.22) });
    if (this.shakes.length > 4) this.shakes.shift();
  }
  applyImmediate(): void { this.pos.copy(this.goalPos); this.look.copy(this.goalLook); this.camera.position.copy(this.pos); this.camera.lookAt(this.look); }
  snapToGameplay(): void { this.retarget("game"); this.applyImmediate(); }
  update(dt: number): void {
    this.time += dt;
    const l = 4.5;
    this.pos.set(damp(this.pos.x, this.goalPos.x, l, dt), damp(this.pos.y, this.goalPos.y, l, dt), damp(this.pos.z, this.goalPos.z, l, dt));
    this.look.set(damp(this.look.x, this.goalLook.x, l, dt), damp(this.look.y, this.goalLook.y, l, dt), damp(this.look.z, this.goalLook.z, l, dt));
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    if (!this.reducedMotion && this.mode === "title") {
      this.camera.position.x += Math.sin(this.time * 0.3) * 0.15;
      this.camera.position.y += Math.sin(this.time * 0.43) * 0.08;
    }
    if (this.shakes.length) {
      let ox = 0, oy = 0;
      for (const s of this.shakes) {
        s.t += dt;
        const f = Math.max(0, 1 - s.t / s.duration);
        const n = Math.sin(s.t * 91.7) + Math.sin(s.t * 47.3) * 0.6;
        ox += n * s.strength * f * 0.5;
        oy += Math.cos(s.t * 83.1) * s.strength * f * 0.4;
      }
      this.shakes = this.shakes.filter((s) => s.t < s.duration);
      this.camera.position.x += ox;
      this.camera.position.y += oy;
    }
  }
}

// ============================================================ workshop.js
class Workshop {
  group = new Group();
  disposables: { dispose(): void }[] = [];
  lampPivot: Group | null = null;
  bulb: Mesh | null = null;
  dust: Points | null = null;
  dustSeed: Float32Array | null = null;
  constructor(parent: Object3D, public F: MaterialFactory, public theme: Theme, rng: { next(): number }, detailSetting: boolean, particles: string, public budget: Look["budget"]) {
    this.build(rng, detailSetting ? 1 : 0.35, particles);
    parent.add(this.group);
  }
  track<T extends { dispose(): void }>(o: T): T { this.disposables.push(o); return o; }
  build(rng: { next(): number }, detail: number, particles: string): void {
    const t = this.theme, F = this.F;
    const floor = new Mesh(this.track(new BoxGeometry(17, 0.4, 9)), F.floorMat());
    floor.position.set(0, -0.22, 0.5); floor.receiveShadow = true; this.group.add(floor);
    const boards = new InstancedMesh(this.track(new BoxGeometry(0.06, 0.02, 9)), F.floorMat(true), 40);
    const m4 = new Matrix4();
    for (let i = 0; i < 40; i++) { m4.makeTranslation(-8.5 + i * 0.43, 0.0, 0.5); boards.setMatrixAt(i, m4); }
    boards.receiveShadow = true; this.group.add(boards);
    const back = new Mesh(this.track(new BoxGeometry(17, 8.4, 0.4)), F.wallMat());
    back.position.set(0, 4.0, -3.3); back.receiveShadow = true; this.group.add(back);
    const sideGeo = this.track(new BoxGeometry(0.4, 8.4, 9));
    const sideL = new Mesh(sideGeo, F.wallMat()); sideL.position.set(-8.3, 4.0, 0.5); this.group.add(sideL);
    const sideR = new Mesh(sideGeo, F.wallMat()); sideR.position.set(8.3, 4.0, 0.5); this.group.add(sideR);
    const skirt = new Mesh(this.track(new BoxGeometry(17, 0.3, 0.1)), F.woodMat(t.accent, 0.7));
    skirt.position.set(0, 0.15, -3.05); this.group.add(skirt);
    this.buildShelves(rng, detail);
    this.buildPegboard(detail);
    this.buildLamp();
    this.buildWindow(detail > 0.5);
    if (detail > 0.5) this.buildBench();
    if (particles === "high") this.buildDust();
  }
  buildDust(): void {
    const n = this.budget.dust;
    const pos = new Float32Array(n * 3);
    this.dustSeed = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const h = (k: number): number => { const x = Math.sin((i * 4 + k) * 91.7 + 12.3) * 43758.5; return x - Math.floor(x); };
      this.dustSeed.set([-7 + h(0) * 14, 0.4 + h(1) * 7, -2.8 + h(2) * 4.2, h(3) * 6.28], i * 4);
      pos.set([this.dustSeed[i * 4]!, this.dustSeed[i * 4 + 1]!, this.dustSeed[i * 4 + 2]!], i * 3);
    }
    const geo = this.track(new BufferGeometry());
    geo.setAttribute("position", new BufferAttribute(pos, 3));
    const { c, g } = canvas(32, 32);
    const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd; g.fillRect(0, 0, 32, 32);
    const map = this.track(new CanvasTexture(c));
    const mat = this.track(new PointsMaterial({ size: 0.05, map, color: this.theme.lamp.color, transparent: true, opacity: 0.55, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: true }));
    this.dust = new Points(geo, mat);
    this.dust.frustumCulled = false;
    this.group.add(this.dust);
  }
  buildShelves(rng: { next(): number }, detail: number): void {
    const t = this.theme, F = this.F;
    const shelfMat = F.woodMat(t.shelf, 0.75);
    const shelfGeo = this.track(new BoxGeometry(5.6, 0.14, 1.1));
    for (const y of [3.4, 4.6]) {
      const s = new Mesh(shelfGeo, shelfMat); s.position.set(-4.4, y, -2.7); s.castShadow = s.receiveShadow = true; this.group.add(s);
    }
    const n = Math.floor(14 * detail);
    const sets = [
      new InstancedMesh(this.track(new CylinderGeometry(0.16, 0.18, 0.42, F.seg(10, 6))), F.make({ color: t.accent, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.75 }), n),
      new InstancedMesh(this.track(new BoxGeometry(0.34, 0.3, 0.3)), F.woodMat(t.floorAlt, 0.85), n),
      new InstancedMesh(this.track(new TorusGeometry(0.17, 0.06, F.seg(8, 4), F.seg(14, 8))), F.metalMat(t.bell, 0.4, 0.8), n),
      new InstancedMesh(this.track(new BoxGeometry(0.1, 0.34, 0.26)), F.make({ color: t.pad, roughness: 0.8 }), n),
    ];
    for (const s of sets) s.count = 0;
    const m4 = new Matrix4(), e = new Euler(), q = new Quaternion(), v = new Vector3(), one = new Vector3(1, 1, 1);
    let i = 0;
    for (const y of [3.4, 4.6]) {
      let x = -6.8;
      while (x < -2.2 && i < n * sets.length) {
        const which = Math.floor(rng.next() * 4);
        const mesh = sets[which]!;
        const idx = Math.floor(i / 4) % n;
        e.set(0, rng.next() * Math.PI, which === 2 ? Math.PI / 2 : 0);
        q.setFromEuler(e);
        v.set(x + rng.next() * 0.2, y + 0.28, -2.7 + (rng.next() - 0.5) * 0.4);
        m4.compose(v, q, one);
        mesh.setMatrixAt(idx, m4);
        mesh.count = Math.max(mesh.count, idx + 1);
        x += 0.5 + rng.next() * 0.45;
        i++;
      }
    }
    for (const mesh of sets) { mesh.castShadow = true; if (mesh.count > 0) this.group.add(mesh); }
    const crates = new InstancedMesh(this.track(new BoxGeometry(0.6, 0.6, 0.6)), F.woodMat(t.shelf, 0.85), 5);
    const pos: [number, number, number][] = [[6.4, 0.3, -2.4], [7.1, 0.3, -2.2], [6.7, 0.9, -2.35], [6.3, 0.3, -1.7], [6.9, 0.9, -2.0]];
    pos.forEach((p, k) => { e.set(0, (k * 0.4) % 0.6 - 0.3, 0); q.setFromEuler(e); m4.compose(new Vector3(...p), q, one); crates.setMatrixAt(k, m4); });
    crates.castShadow = crates.receiveShadow = true;
    this.group.add(crates);
  }
  buildPegboard(detail: number): void {
    const t = this.theme, F = this.F;
    const board = new Mesh(this.track(new BoxGeometry(3.4, 2.2, 0.08)), F.woodMat(t.floorAlt, 0.9));
    board.position.set(4.6, 4.4, -3.05); this.group.add(board);
    const n = Math.floor(6 * detail);
    const silMat = F.make({ color: t.wall, roughness: 0.9 });
    const shapes = [
      new CylinderGeometry(0.05, 0.05, 0.7, 8), new BoxGeometry(0.3, 0.3, 0.1), new TorusGeometry(0.2, 0.045, 8, 16, Math.PI),
      new ConeGeometry(0.16, 0.5, 8), new BoxGeometry(0.1, 0.6, 0.08), new CylinderGeometry(0.12, 0.12, 0.16, 10),
    ].map((g) => this.track(g));
    for (let i = 0; i < n; i++) {
      const m = new Mesh(shapes[i % shapes.length]!, silMat);
      m.position.set(3.4 + (i % 3) * 1.1, 4.9 - Math.floor(i / 3) * 0.9, -2.98);
      m.castShadow = true; this.group.add(m);
    }
  }
  buildLamp(): void {
    const t = this.theme, F = this.F;
    this.lampPivot = new Group(); this.lampPivot.position.set(0, 8.6, -0.6); this.group.add(this.lampPivot);
    const cord = new Mesh(this.track(new CylinderGeometry(0.015, 0.015, 2.0, 6)), F.make({ color: 0x222222, roughness: 0.9 }));
    cord.position.set(0, -1.0, 0); this.lampPivot.add(cord);
    const shade = new Mesh(this.track(new ConeGeometry(0.55, 0.5, F.seg(18, 10), 1, true)), F.metalMat(t.accent, 0.5, 0.6));
    shade.position.set(0, -2.0, 0); this.lampPivot.add(shade);
    const bulb = new Mesh(this.track(new SphereGeometry(0.16, F.seg(12, 6), F.seg(10, 5))), F.emissiveMat(t.lamp.color, 2.2));
    bulb.position.set(0, -2.15, 0); this.lampPivot.add(bulb);
    this.bulb = bulb;
  }
  buildWindow(shaft: boolean): void {
    const t = this.theme, F = this.F;
    const frame = new Mesh(this.track(new BoxGeometry(2.2, 2.6, 0.12)), F.woodMat(t.accent, 0.7));
    frame.position.set(6.6, 5.2, -3.06); this.group.add(frame);
    const pane = new Mesh(this.track(new PlaneGeometry(1.9, 2.3)), F.emissiveMat(t.hemi.sky, 0.7));
    pane.position.set(6.6, 5.2, -2.99); this.group.add(pane);
    const barGeo = this.track(new BoxGeometry(0.06, 2.3, 0.04));
    for (const x of [-0.32, 0.32]) { const bar = new Mesh(barGeo, F.woodMat(t.accent, 0.7)); bar.position.set(6.6 + x, 5.2, -2.97); this.group.add(bar); }
    if (shaft) {
      const { c, g } = canvas(64, 128);
      const lin = g.createLinearGradient(0, 0, 0, 128);
      lin.addColorStop(0, "rgba(255,255,255,0.9)"); lin.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = lin; g.fillRect(0, 0, 64, 128);
      const side = g.createLinearGradient(0, 0, 64, 0);
      g.globalCompositeOperation = "destination-in";
      side.addColorStop(0, "rgba(0,0,0,0)"); side.addColorStop(0.3, "rgba(0,0,0,1)"); side.addColorStop(0.7, "rgba(0,0,0,1)"); side.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = side; g.fillRect(0, 0, 64, 128);
      const map = this.track(new CanvasTexture(c));
      const mat = this.track(new MeshBasicMaterial({ map, color: t.hemi.sky, transparent: true, opacity: 0.045, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, fog: false }));
      const beam = new Mesh(this.track(new PlaneGeometry(1.6, 6.0)), mat);
      beam.position.set(5.6, 3.0, -1.6); beam.rotation.set(-0.55, 0.35, 0.28); this.group.add(beam);
    }
  }
  buildBench(): void {
    const t = this.theme, F = this.F;
    const top = new Mesh(this.track(new BoxGeometry(2.6, 0.16, 1.0)), F.woodMat(t.shelf, 0.7));
    top.position.set(-6.6, 1.0, -1.8); top.castShadow = top.receiveShadow = true; this.group.add(top);
    const legGeo = this.track(new BoxGeometry(0.12, 1.0, 0.12));
    for (const [dx, dz] of [[-1.1, -0.4], [1.1, -0.4], [-1.1, 0.4], [1.1, 0.4]] as const) {
      const leg = new Mesh(legGeo, F.woodMat(t.wall, 0.9)); leg.position.set(-6.6 + dx, 0.5, -1.8 + dz); this.group.add(leg);
    }
  }
  update(time: number, reducedMotion: boolean, lamp: PointLight): void {
    const bulbMat = this.bulb?.material as MeshStandardMaterial | undefined;
    if (reducedMotion) {
      this.lampPivot?.rotation.set(0, 0, 0);
      if (bulbMat) bulbMat.emissiveIntensity = 2.2;
    } else {
      if (bulbMat) bulbMat.emissiveIntensity = 2.2 * (1 + Math.sin(time * 7.3) * 0.02 + Math.sin(time * 17.7) * 0.015);
      if (this.lampPivot) { this.lampPivot.rotation.z = Math.sin(time * 0.9) * 0.035; this.lampPivot.rotation.x = Math.sin(time * 0.63 + 1.1) * 0.02; }
      if (this.dust && this.dustSeed) {
        const attr = this.dust.geometry.getAttribute("position")!;
        const a = attr.array as Float32Array, sd = this.dustSeed;
        for (let i = 0; i < a.length / 3; i++) {
          const ph = sd[i * 4 + 3]!;
          a[i * 3] = sd[i * 4]! + Math.sin(time * 0.21 + ph) * 0.35;
          a[i * 3 + 1] = sd[i * 4 + 1]! + Math.sin(time * 0.13 + ph * 1.7) * 0.3;
          a[i * 3 + 2] = sd[i * 4 + 2]! + Math.cos(time * 0.17 + ph) * 0.2;
        }
        attr.needsUpdate = true;
      }
    }
    if (this.bulb) {
      this.bulb.updateWorldMatrix(true, false);
      lamp.position.setFromMatrixPosition(this.bulb.matrixWorld);
      lamp.position.y -= 0.15;
    }
  }
  dispose(): void { for (const d of this.disposables) d.dispose(); this.group.removeFromParent(); }
}

// ============================================================ dummy-view.js
const RING = 28, DEPTH = 0.34;
function makeBlobGeo(): BufferGeometry {
  const n = RING;
  const vertCount = (n + 2) * 2 + n * 2;
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(vertCount * 3), 3));
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    idx.push(0, 1 + i, 1 + ((i + 1) % n));
    const c2 = n + 1;
    idx.push(c2, c2 + 1 + ((i + 1) % n), c2 + 1 + i);
    const s0 = (n + 2) * 2;
    const a = s0 + i * 2, b = s0 + ((i + 1) % n) * 2;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
function sampleRing(ctrl: [number, number][], n: number, inflate: number): { pts: [number, number][]; cx: number; cy: number } {
  const pts: [number, number][] = [];
  const len = ctrl.length;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * len;
    const i0 = Math.floor(t) % len, i1 = (i0 + 1) % len;
    const f = t - Math.floor(t);
    const u = f * f * (3 - 2 * f);
    const a = ctrl[i0]!, b = ctrl[i1]!;
    let x = a[0] + (b[0] - a[0]) * u, y = a[1] + (b[1] - a[1]) * u;
    if (Math.abs(b[0] - a[0]) > 1 || Math.abs(b[1] - a[1]) > 1) { x = (a[0] + b[0]) / 2; y = (a[1] + b[1]) / 2; }
    pts.push([x, y]);
  }
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; }
  cx /= n; cy /= n;
  return { pts: pts.map((p) => { const dx = p[0] - cx, dy = p[1] - cy, d = Math.sqrt(dx * dx + dy * dy) || 1; return [p[0] + (dx / d) * inflate, p[1] + (dy / d) * inflate] as [number, number]; }), cx, cy };
}
function updateBlob(geo: BufferGeometry, ring: { pts: [number, number][]; cx: number; cy: number }, z: number): { cx: number; cy: number } {
  const attr = geo.getAttribute("position")!;
  const pos = attr.array as Float32Array;
  const n = RING, { pts, cx, cy } = ring;
  const set = (i: number, x: number, y: number, zz: number): void => { pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = zz; };
  set(0, cx, cy, z + DEPTH / 2);
  for (let i = 0; i < n; i++) set(1 + i, pts[i]![0], pts[i]![1], z + DEPTH / 2);
  const c2 = n + 1;
  set(c2, cx, cy, z - DEPTH / 2);
  for (let i = 0; i < n; i++) set(c2 + 1 + i, pts[i]![0], pts[i]![1], z - DEPTH / 2);
  const s0 = (n + 2) * 2;
  for (let i = 0; i < n; i++) { set(s0 + i * 2, pts[i]![0], pts[i]![1], z + DEPTH / 2); set(s0 + i * 2 + 1, pts[i]![0], pts[i]![1], z - DEPTH / 2); }
  attr.needsUpdate = true;
  geo.computeVertexNormals();
  return { cx, cy };
}
function makeFaceTexture(trim: string): CanvasTexture {
  const { c, g } = canvas(128, 128);
  g.fillStyle = "#2a2018";
  for (const x of [44, 84]) {
    g.beginPath(); g.arc(x, 52, 9, 0, 7); g.fill();
    g.fillStyle = "#ffffff"; g.beginPath(); g.arc(x + 2.5, 49.5, 2.8, 0, 7); g.fill();
    g.fillStyle = "#2a2018";
  }
  g.strokeStyle = "#2a2018"; g.lineWidth = 4;
  g.beginPath(); g.arc(64, 70, 18, 0.35, Math.PI - 0.35); g.stroke();
  g.lineWidth = 2;
  for (let i = -2; i <= 2; i++) {
    const x = 64 + i * 8.5, y = 70 + Math.sqrt(Math.max(0, 18 * 18 - (x - 64) ** 2)) * 0.9;
    g.beginPath(); g.moveTo(x - 2.5, y - 2); g.lineTo(x + 2.5, y + 4); g.stroke();
  }
  g.fillStyle = trim; g.globalAlpha = 0.5;
  for (const x of [32, 96]) { g.beginPath(); g.arc(x, 66, 6, 0, 7); g.fill(); }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
class DummyView {
  group = new Group();
  torsoGeo = makeBlobGeo(); headGeo = makeBlobGeo();
  torso: Mesh; head: Mesh; scarf: Mesh; patch: Mesh; face: Mesh; faceTex: CanvasTexture;
  constructor(parent: Object3D, F: MaterialFactory, t: Theme) {
    const bodyMat = F.plushMat(t.dummy.body), trimMat = F.plushMat(t.dummy.trim);
    this.torso = new Mesh(this.torsoGeo, bodyMat); this.head = new Mesh(this.headGeo, bodyMat);
    this.torso.castShadow = this.head.castShadow = true;
    this.group.add(this.torso, this.head);
    this.scarf = new Mesh(new TorusGeometry(0.19, 0.055, 10, 20), trimMat); this.scarf.castShadow = true; this.group.add(this.scarf);
    this.patch = new Mesh(new CircleGeometry(0.09, 12), trimMat); this.group.add(this.patch);
    this.faceTex = makeFaceTexture(hexs(t.dummy.trim));
    this.face = new Mesh(new PlaneGeometry(0.34, 0.34), new MeshBasicMaterial({ map: this.faceTex, transparent: true }));
    this.group.add(this.face);
    parent.add(this.group);
  }
  update(pos: Float32Array, body: { start: number }, time: number, squash: number): void {
    const s = body.start;
    const hx = pos[s * 2]!, hy = pos[s * 2 + 1]!, tx = pos[(s + 1) * 2]!, ty = pos[(s + 1) * 2 + 1]!;
    const headRing: [number, number][] = [], torsoRing: [number, number][] = [];
    for (let i = 0; i < 6; i++) headRing.push([pos[(s + 2 + i) * 2]!, pos[(s + 2 + i) * 2 + 1]!]);
    for (let i = 0; i < 8; i++) torsoRing.push([pos[(s + 8 + i) * 2]!, pos[(s + 8 + i) * 2 + 1]!]);
    const headC = updateBlob(this.headGeo, sampleRing(headRing, RING, 0.085), 0);
    const torsoC = updateBlob(this.torsoGeo, sampleRing(torsoRing, RING, 0.1), 0);
    const upx = hx - tx, upy = hy - ty, ang = Math.atan2(upx, upy);
    this.face.position.set(headC.cx, headC.cy, DEPTH / 2 + 0.01); this.face.rotation.z = ang * 0.8;
    this.scarf.position.set((headC.cx + torsoC.cx) / 2, (headC.cy + torsoC.cy) / 2, 0);
    this.scarf.rotation.z = ang * 0.5; this.scarf.scale.setScalar(1 + Math.sin(time * 2.1) * 0.02);
    this.patch.position.set(torsoC.cx + upx * 0.1, torsoC.cy + upy * 0.06, DEPTH / 2 + 0.01); this.patch.rotation.z = ang;
    this.torso.scale.set(1 / Math.sqrt(squash), squash, 1);
    this.head.scale.set(1 / Math.sqrt(squash), squash, 1);
  }
  dispose(): void {
    this.torsoGeo.dispose(); this.headGeo.dispose(); this.faceTex.dispose();
    (this.face.material as Material).dispose(); this.group.removeFromParent();
  }
}

// ============================================================ props-view.js
const MAT_COLOR: Record<number, (t: Theme) => number> = {
  [MAT.WOOD!]: (t) => t.floor, [MAT.METAL!]: (t) => t.bell, [MAT.RUBBER!]: (t) => t.pad, [MAT.STONE!]: (t) => t.shelf,
};
interface BellView { group: Group; halo: Mesh; bell: Mesh; anim: number; x: number; y: number; r: number }
interface ZoneView { group: Group; ring: Mesh; fill: Mesh; z: { x: number; y: number; r: number } }
export interface MountView { mesh: Mesh; marker: Mesh; id: string; x: number; y: number }
class LevelView {
  group = new Group();
  disposables: { dispose(): void }[] = [];
  crateMeshes: Group[] = []; ballMeshes: Mesh[] = []; weightMeshes = new Map<number, Mesh>();
  bellViews: BellView[] = []; zoneViews: ZoneView[] = []; mountViews: MountView[] = [];
  constructor(parent: Object3D, public F: MaterialFactory, public theme: Theme, level: Level) { this.build(level); parent.add(this.group); }
  track<T extends { dispose(): void }>(o: T): T { this.disposables.push(o); return o; }
  build(level: Level): void {
    const F = this.F, t = this.theme;
    for (const s of level.statics.segments) {
      const [x1, y1, x2, y2, matName] = s;
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
      const wallish = Math.abs(dy) > Math.abs(dx);
      const color = MAT_COLOR[MAT[matName ?? "WOOD"] ?? -1]?.(t) ?? t.floorAlt;
      const mat = matName === "RUBBER" ? F.plushMat(color) : F.woodMat(color, 0.85);
      let m: Mesh;
      if (wallish) {
        m = new Mesh(this.track(new BoxGeometry(0.34, len + 0.3, 2.2)), mat);
        m.position.set(x1, (y1 + y2) / 2, -0.15);
        m.scale.set(1, Math.max(1, len / 0.34), 1);
        m.castShadow = true;
      } else {
        m = new Mesh(this.track(new BoxGeometry(len, 0.34, 2.2)), mat);
        m.position.set((x1 + x2) / 2, (y1 + y2) / 2 - 0.05, -0.15);
        m.rotation.z = Math.atan2(dy, dx);
      }
      m.receiveShadow = true;
      this.group.add(m);
    }
    for (const c of level.statics.circles) {
      const [x, y, r, matName] = c;
      const color = MAT_COLOR[MAT[matName ?? "WOOD"] ?? -1]?.(t) ?? t.floorAlt;
      const m = new Mesh(this.track(new CylinderGeometry(r, r, 1.8, F.seg(20, 10))), F.woodMat(color, 0.7));
      m.rotation.x = Math.PI / 2; m.position.set(x, y, -0.15); m.castShadow = m.receiveShadow = true; this.group.add(m);
    }
    for (const b of level.bells ?? []) { const v = this.makeBell(b); this.bellViews.push(v); this.group.add(v.group); }
    for (const z of level.zones ?? []) { const v = this.makeZone(z); this.zoneViews.push(v); this.group.add(v.group); }
    for (const m of level.mounts ?? []) { const v = this.makeMount(m); this.mountViews.push(v); this.group.add(v.mesh); }
  }
  makeBell(b: { x: number; y: number; r: number }): BellView {
    const F = this.F, t = this.theme;
    const group = new Group();
    const pts: Vector2[] = [];
    for (let i = 0; i <= 8; i++) { const f = i / 8; pts.push(new Vector2(0.05 + f * b.r * (0.6 + 0.55 * f), -b.r * 0.9 + f * b.r * 1.5)); }
    const bell = new Mesh(this.track(new LatheGeometry(pts, F.seg(18, 10))), F.metalMat(t.bell, 0.25, 0.95));
    bell.castShadow = true; group.add(bell);
    const clapper = new Mesh(this.track(new SphereGeometry(0.07, 8, 8)), F.metalMat(t.accent, 0.4, 0.8));
    clapper.position.y = -b.r * 0.7; group.add(clapper);
    const post = new Mesh(this.track(new CylinderGeometry(0.03, 0.03, 7 - b.y, 6)), F.metalMat(t.accent, 0.5, 0.7));
    post.position.y = b.y + b.r * 0.6 + (7 - b.y - b.r * 0.6) / 2;
    group.add(post);
    group.position.set(b.x, b.y, -0.15);
    const halo = new Mesh(this.track(new RingGeometry(b.r * 1.1, b.r * 1.35, 24)),
      this.track(new MeshBasicMaterial({ color: t.zone, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide })));
    halo.position.set(b.x, b.y, 0.15); this.group.add(halo);
    return { group, halo, bell, anim: 0, x: b.x, y: b.y, r: b.r };
  }
  ringBell(i: number): void { const v = this.bellViews[i]; if (v) v.anim = 1; }
  makeZone(z: { x: number; y: number; r: number }): ZoneView {
    const t = this.theme;
    const group = new Group();
    const ring = new Mesh(this.track(new RingGeometry(z.r * 0.86, z.r, 40)), this.track(new MeshBasicMaterial({ color: t.zone, transparent: true, opacity: 0.85, depthWrite: false, side: DoubleSide })));
    ring.rotation.x = -Math.PI / 2; group.add(ring);
    const fill = new Mesh(this.track(new CircleGeometry(z.r * 0.86, 40)), this.track(new MeshBasicMaterial({ color: t.zone, transparent: true, opacity: 0.16, depthWrite: false })));
    fill.rotation.x = -Math.PI / 2; group.add(fill);
    const dashes = new InstancedMesh(this.track(new BoxGeometry(0.08, 0.02, 0.16)), this.track(new MeshBasicMaterial({ color: t.zone, transparent: true, opacity: 0.9, depthWrite: false })), 16);
    const m4 = new Matrix4();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      m4.makeRotationY(-a); m4.setPosition(Math.cos(a) * z.r * 0.93, 0, Math.sin(a) * z.r * 0.93);
      dashes.setMatrixAt(i, m4);
    }
    group.add(dashes);
    if (z.y > 0.4) group.position.set(z.x, z.y, 0.25);
    else group.position.set(z.x, 0.04, 0);
    return { group, ring, fill, z };
  }
  makeMount(m: { id: string; x: number; y: number }): MountView {
    const t = this.theme;
    const mesh = new Mesh(this.track(new CylinderGeometry(0.22, 0.22, 0.1, 6)), this.F.metalMat(t.accent, 0.45, 0.75));
    mesh.rotation.x = Math.PI / 2; mesh.position.set(m.x, m.y, -0.3); mesh.castShadow = true;
    const marker = new Mesh(this.track(new RingGeometry(0.26, 0.32, 6)), this.track(new MeshBasicMaterial({ color: t.accent, transparent: true, opacity: 0, depthWrite: false })));
    marker.position.set(m.x, m.y, 0.05); this.group.add(marker);
    return { mesh, marker, id: m.id, x: m.x, y: m.y };
  }
  ensureBodies(bodies: State["bodies"]): void {
    const F = this.F, t = this.theme;
    for (let bi = 1; bi < bodies.length; bi++) {
      const b = bodies[bi]!;
      if (b.kind === "crate" && !this.crateMeshes[bi]) {
        const g = new Group();
        const geo = this.track(new BoxGeometry(0.42, 0.42, 0.42));
        const box = new Mesh(geo, F.woodMat(t.shelf, 0.85)); box.castShadow = true;
        const edges = new LineSegments(this.track(new EdgesGeometry(geo)), this.track(new LineBasicMaterial({ color: t.wall })));
        g.add(box, edges);
        this.crateMeshes[bi] = g; this.group.add(g);
      } else if (b.kind === "ball" && !this.ballMeshes[bi]) {
        const m = new Mesh(this.track(new SphereGeometry(0.24, F.seg(16, 8), F.seg(12, 6))), F.woodMat(t.accent, 0.6));
        m.castShadow = true; this.ballMeshes[bi] = m; this.group.add(m);
      } else if (b.kind === "weight" && b.toolId != null && !this.weightMeshes.has(b.toolId)) {
        const m = new Mesh(this.track(new BoxGeometry(0.62, 0.5, 0.5)), F.metalMat(0x3a3f4a, 0.4, 0.95));
        m.castShadow = true; this.weightMeshes.set(b.toolId, m); this.group.add(m);
      }
    }
  }
  updateBodies(pos: Float32Array, bodies: State["bodies"]): void {
    for (let bi = 1; bi < bodies.length; bi++) {
      const b = bodies[bi]!;
      const p = (i: number): [number, number] => [pos[i * 2]!, pos[i * 2 + 1]!];
      if (b.kind === "crate") {
        const g = this.crateMeshes[bi]; if (!g) continue;
        const [x0, y0] = p(b.start), [x1, y1] = p(b.start + 1);
        g.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0); g.rotation.z = Math.atan2(y1 - y0, x1 - x0);
      } else if (b.kind === "ball") {
        const m = this.ballMeshes[bi]; if (m) { const [x, y] = p(b.start); m.position.set(x, y, 0); }
      } else if (b.kind === "weight" && b.toolId != null) {
        const m = this.weightMeshes.get(b.toolId); if (m) { const [x, y] = p(b.start); m.position.set(x, y, 0); }
      }
    }
  }
  update(time: number, dt: number, goals: Goal[]): void {
    this.bellViews.forEach((v, i) => {
      const hm = v.halo.material as MeshBasicMaterial;
      if (v.anim > 0) {
        v.anim = Math.max(0, v.anim - dt * 1.8);
        hm.opacity = Math.sin(v.anim * Math.PI) * 0.8;
        v.halo.scale.setScalar(1 + (1 - v.anim) * 0.8);
        v.bell.rotation.z = Math.sin(v.anim * 20) * 0.12;
      }
      if (goals[i]?.done) { const bm = v.bell.material as MeshStandardMaterial; bm.emissive.set(this.theme.bell); bm.emissiveIntensity = 0.25; }
    });
    this.zoneViews.forEach((v, i) => {
      const g = goals.find((gg) => gg.type === "zone" && gg.x === v.z.x && gg.y === v.z.y);
      v.group.scale.setScalar(1 + Math.sin(time * 2.4 + i) * 0.03);
      if (g) {
        (v.fill.material as MeshBasicMaterial).opacity = 0.16 + Math.min(1, g.value / (g.holdTicks || 1)) * 0.4;
        if (g.done) (v.ring.material as MeshBasicMaterial).opacity = 1;
      }
    });
  }
  setMountHighlight(show: boolean, freeIds: string[] | null = null): void {
    for (const v of this.mountViews) (v.marker.material as MeshBasicMaterial).opacity = show && (!freeIds || freeIds.includes(v.id)) ? 0.75 : 0;
  }
  dispose(): void { for (const d of this.disposables) d.dispose(); this.group.removeFromParent(); }
}
class GhostPreview {
  mesh: Group | null = null;
  line: LineSegments | null = null;
  kind: string | null = null;
  constructor(public parent: Object3D, public F: MaterialFactory, public colors: Palette) {}
  show(kind: ToolKey): void {
    this.hide();
    this.kind = kind;
    this.mesh = makeToolMesh(kind, this.F, theme);
    const mat = this.F.ghostMat(true, this.colors);
    this.mesh.traverse((o) => { if (o instanceof Mesh) { o.material = mat; o.castShadow = false; } });
    this.parent.add(this.mesh);
  }
  setValidity(valid: boolean): void {
    if (!this.mesh) return;
    const mat = this.F.ghostMat(valid, this.colors);
    this.mesh.traverse((o) => { if (o instanceof Mesh) o.material = mat; });
  }
  setPose(x: number, y: number, angle: number): void { if (this.mesh) { this.mesh.position.set(x, y, 0.3); this.mesh.rotation.z = angle; } }
  /** LineDashedMaterial (dash 0.16, gap 0.12) as segments along the path. */
  setTrajectory(points: [number, number][] | null): void {
    this.hideTrajectory();
    if (!points || points.length < 2) return;
    const out: Vector3[] = [];
    let on = true, left = 0.16;
    for (let i = 1; i < points.length; i++) {
      let [ax, ay] = points[i - 1]!;
      const [bx, by] = points[i]!;
      let seg = Math.hypot(bx - ax, by - ay);
      while (seg > 1e-6) {
        const step = Math.min(left, seg);
        const f = step / seg;
        const nx = ax + (bx - ax) * f, ny = ay + (by - ay) * f;
        if (on) out.push(new Vector3(ax, ay, 0.35), new Vector3(nx, ny, 0.35));
        ax = nx; ay = ny; seg -= step; left -= step;
        if (left <= 1e-6) { on = !on; left = on ? 0.16 : 0.12; }
      }
    }
    if (out.length < 2) return;
    const geo = new BufferGeometry().setFromPoints(out);
    this.line = new LineSegments(geo, new LineBasicMaterial({ color: this.colors.valid, transparent: true, opacity: 0.85 }));
    this.parent.add(this.line);
  }
  hideTrajectory(): void {
    if (this.line) { this.line.geometry.dispose(); (this.line.material as Material).dispose(); this.line.removeFromParent(); this.line = null; }
  }
  hide(): void { if (this.mesh) { this.mesh.removeFromParent(); this.mesh = null; } this.hideTrajectory(); this.kind = null; }
}

// ============================================================ tools-view.js
function makeToolMesh(kind: ToolKey, F: MaterialFactory, t: Theme): Group {
  const g = new Group();
  const u = g.userData as Record<string, Object3D>;
  const add = (...o: Object3D[]): void => { g.add(...o); };
  if (kind === "piston") {
    const plate = new Mesh(new BoxGeometry(0.1, 0.5, 0.5), F.metalMat(t.accent, 0.5, 0.7)); plate.castShadow = true;
    const sleeve = new Group();
    for (let i = 0; i < 3; i++) {
      const seg = new Mesh(new BoxGeometry(0.22 - i * 0.05, 0.34 - i * 0.05, 0.34 - i * 0.05), F.metalMat(t.bell, 0.4, 0.8));
      seg.position.x = 0.16 + i * 0.2; seg.castShadow = true; sleeve.add(seg);
    }
    const fist = new Mesh(new BoxGeometry(0.3, 0.42, 0.42), F.plushMat(t.pad)); fist.position.x = 0.85; fist.castShadow = true;
    const glove = new Mesh(new SphereGeometry(0.16, 10, 8), F.plushMat(t.pad)); glove.position.set(0.98, 0.1, 0.12);
    add(plate, sleeve, fist, glove);
    u.fist = fist; u.sleeve = sleeve; u.glove = glove;
  } else if (kind === "pad") {
    const base = new Mesh(new CylinderGeometry(0.46, 0.5, 0.08, 22), F.plushMat(t.pad)); base.castShadow = true;
    const ring = new Mesh(new TorusGeometry(0.34, 0.05, 8, 22), F.emissiveMat(t.accent, 0.5)); ring.rotation.x = Math.PI / 2; ring.position.y = 0.06;
    const spring = new Mesh(new TorusGeometry(0.2, 0.035, 8, 16), F.metalMat(t.bell, 0.4, 0.8)); spring.rotation.x = Math.PI / 2; spring.position.y = 0.1;
    add(base, ring, spring); u.spring = spring;
  } else if (kind === "fan") {
    const base = new Mesh(new CylinderGeometry(0.2, 0.28, 0.16, 12), F.metalMat(t.accent, 0.5, 0.7)); base.castShadow = true;
    const cage = new Mesh(new TorusGeometry(0.34, 0.03, 8, 24), F.metalMat(t.bell, 0.35, 0.85)); cage.position.y = 0.3;
    const blades = new Group();
    for (let i = 0; i < 3; i++) {
      const blade = new Mesh(new BoxGeometry(0.1, 0.28, 0.02), F.plushMat(t.zone)); blade.position.y = 0.14;
      const holder = new Group(); holder.add(blade); holder.rotation.z = (i / 3) * Math.PI * 2; blades.add(holder);
    }
    blades.position.y = 0.3;
    const hub = new Mesh(new SphereGeometry(0.07, 10, 8), F.metalMat(t.bell, 0.3, 0.9)); hub.position.y = 0.3;
    add(base, cage, blades, hub); u.blades = blades; u.cage = cage;
  } else if (kind === "magnet") {
    const arc = new Mesh(new TorusGeometry(0.3, 0.11, 10, 20, Math.PI), F.plushMat(t.pad)); arc.castShadow = true;
    const poleGeo = new CylinderGeometry(0.11, 0.11, 0.18, 10), poleMat = F.metalMat(t.bell, 0.3, 0.9);
    const poleL = new Mesh(poleGeo, poleMat); poleL.position.set(-0.3, -0.05, 0);
    const poleR = new Mesh(poleGeo, poleMat); poleR.position.set(0.3, -0.05, 0);
    const coil = new Mesh(new TorusGeometry(0.3, 0.03, 6, 20, Math.PI), F.emissiveMat(t.zone, 0.6));
    add(arc, poleL, poleR, coil); u.coil = coil;
  } else if (kind === "weight") {
    const waist = new Mesh(new BoxGeometry(0.34, 0.3, 0.3), F.metalMat(0x3a3f4a, 0.45, 0.9)); waist.position.y = -0.1;
    const top = new Mesh(new BoxGeometry(0.66, 0.2, 0.34), F.metalMat(0x4a505c, 0.35, 0.95)); top.position.y = 0.15;
    const horn = new Mesh(new ConeGeometry(0.12, 0.34, 10), F.metalMat(0x4a505c, 0.35, 0.95)); horn.rotation.z = -Math.PI / 2; horn.position.set(0.45, 0.15, 0);
    const stamp = new Mesh(new CircleGeometry(0.07, 10), F.emissiveMat(t.accent, 0.8)); stamp.position.set(0, 0.15, 0.18);
    add(waist, top, horn, stamp);
    g.traverse((o) => { if (o instanceof Mesh) o.castShadow = true; });
    const chain = new Group();
    const linkMat = F.metalMat(t.bell, 0.4, 0.85);
    for (let i = 0; i < 6; i++) {
      const link = new Mesh(new TorusGeometry(0.05, 0.014, 6, 10), linkMat);
      link.position.y = 0.4 + i * 0.09; link.rotation.y = (i % 2) * Math.PI / 2; chain.add(link);
    }
    g.add(chain); u.chain = chain;
  }
  return g;
}
class ToolView {
  kind: ToolKey; group: Group; baseRotZ: number; anim = 0;
  constructor(parent: Object3D, F: MaterialFactory, t: Theme, tool: Tool) {
    this.kind = tool.type;
    this.group = makeToolMesh(tool.type, F, t);
    this.group.position.set(tool.x, tool.y, 0);
    this.group.rotation.z = tool.type === "piston" || tool.type === "fan" ? Math.atan2(tool.dy, tool.dx) : 0;
    this.baseRotZ = this.group.rotation.z;
    parent.add(this.group);
  }
  onTrigger(): void { this.anim = 1; }
  update(tool: Tool, time: number, dt: number): void {
    const u = this.group.userData as Record<string, Mesh & Group>;
    if (this.kind === "piston") {
      if (tool.status === "spent" && this.anim > 0) this.anim = Math.max(0, this.anim - dt * 6);
      const ext = tool.status === "spent" ? this.anim : 0;
      const punch = ext > 0.5 ? (1 - ext) * 2 : ext * 2;
      u.fist!.position.x = 0.85 + punch * 0.7; u.glove!.position.x = 0.98 + punch * 0.7;
      u.sleeve!.scale.x = 1 + punch * 1.2; u.sleeve!.position.x = punch * 0.35;
    } else if (this.kind === "pad") {
      const s = 1 + Math.sin(time * 3.2) * 0.02;
      this.group.scale.set(s, 1, s);
      if (this.anim > 0) {
        this.anim = Math.max(0, this.anim - dt * 5);
        const bounce = Math.sin(this.anim * Math.PI) * 0.18;
        u.spring!.scale.setScalar(1 + bounce); this.group.scale.y = 1 - bounce * 0.5;
      }
    } else if (this.kind === "fan") {
      const active = tool.status === "active";
      u.blades!.rotation.z += (active ? 22 : 1.2) * dt;
      const cm = u.cage!.material as MeshStandardMaterial;
      if ("emissiveIntensity" in cm) cm.emissiveIntensity = active ? 0.8 : 0;
    } else if (this.kind === "magnet") {
      this.group.position.y = tool.y + Math.sin(time * 1.8) * 0.05;
      const active = tool.status === "active";
      const cm = u.coil!.material as MeshStandardMaterial;
      if ("emissiveIntensity" in cm) cm.emissiveIntensity = active ? 1.6 + Math.sin(time * 20) * 0.6 : 0.6;
      if (active) this.group.rotation.z = this.baseRotZ + Math.sin(time * 6) * 0.06;
    } else if (this.kind === "weight") {
      const pinned = tool.status === "armed";
      u.chain!.visible = pinned;
      if (!pinned) this.group.visible = false;
      else this.group.rotation.z = Math.sin(time * 1.1) * 0.05;
    }
  }
  dispose(): void { this.group.traverse((o) => { if (o instanceof Mesh) o.geometry.dispose(); }); this.group.removeFromParent(); }
}

// ============================================================ vfx.js
interface P { life: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; g: number; r: number; gc: number; b: number }
class VfxPool {
  cap: number; pos = new Float32Array(PARTICLE_MAX * 3); col = new Float32Array(PARTICLE_MAX * 3);
  points: Points; p: P[] = []; head = 0; alive = 0; enabled = true;
  rnd = Rng.createStream(0x5eed);
  constructor(parent: Object3D, cap: number, public theme: Theme) {
    this.cap = Math.min(PARTICLE_MAX, cap || PARTICLE_MAX);
    for (let i = 0; i < PARTICLE_MAX; i++) this.pos[i * 3 + 1] = -1000;
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(this.pos, 3));
    geo.setAttribute("color", new BufferAttribute(this.col, 3));
    const { c, g } = canvas(64, 64);
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(0.55, "rgba(255,255,255,0.9)"); grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    const map = new CanvasTexture(c); map.colorSpace = SRGBColorSpace;
    this.points = new Points(geo, new PointsMaterial({ size: 0.11, vertexColors: true, transparent: true, opacity: 0.95, map, alphaTest: 0.02, depthWrite: false, sizeAttenuation: true }));
    geo.setDrawRange(0, this.cap);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    parent.add(this.points);
    for (let i = 0; i < PARTICLE_MAX; i++) this.p.push({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: 0, r: 1, gc: 1, b: 1 });
  }
  R(): number { return this.rnd.next(); }
  setCap(cap: number): void {
    this.cap = Math.min(PARTICLE_MAX, cap || PARTICLE_MAX);
    if (this.head >= this.cap) this.head = 0;
    for (let i = this.cap; i < PARTICLE_MAX; i++) { this.p[i]!.life = 0; this.pos[i * 3 + 1] = -1000; }
    this.points.geometry.getAttribute("position")!.needsUpdate = true;
    this.points.geometry.setDrawRange(0, this.cap);
  }
  emit(n: number, fn: (p: P, k: number) => void): void {
    if (!this.enabled) return;
    n = Math.min(n, this.cap);
    for (let k = 0; k < n; k++) { const p = this.p[this.head]!; this.head = (this.head + 1) % this.cap; fn(p, k); p.life = p.life || 1; }
  }
  col3(c: number, p: P): void { const x = new Color(c); p.r = x.r; p.gc = x.g; p.b = x.b; }
  impact(x: number, y: number, speed: number): void {
    const n = Math.min(4 + Math.floor(speed * 1.5), 18);
    this.emit(n, (p) => {
      const a = this.R() * Math.PI * 2, v = 0.4 + this.R() * speed * 0.35;
      p.x = x; p.y = y; p.z = 0.2 + this.R() * 0.3; p.vx = Math.cos(a) * v; p.vy = Math.abs(Math.sin(a) * v) * 0.8;
      p.vz = (this.R() - 0.5) * 0.6; p.g = -4; p.life = 0.5 + this.R() * 0.4; this.col3(this.theme.dummy.body, p);
    });
  }
  boing(x: number, y: number): void {
    this.emit(10, (p, i) => {
      const a = (i / 10) * Math.PI;
      p.x = x + Math.cos(a) * 0.3; p.y = y + 0.05; p.z = 0.15; p.vx = Math.cos(a) * 1.2; p.vy = 1.8 + this.R() * 1.2; p.vz = 0;
      p.g = -5; p.life = 0.6; this.col3(this.theme.pad, p);
    });
  }
  bellRing(x: number, y: number): void {
    this.emit(16, (p, i) => {
      const a = (i / 16) * Math.PI * 2;
      p.x = x + Math.cos(a) * 0.3; p.y = y + Math.sin(a) * 0.3; p.z = 0.25; p.vx = Math.cos(a) * 1.6; p.vy = Math.sin(a) * 1.6; p.vz = 0;
      p.g = 0; p.life = 0.7; this.col3(this.theme.bell, p);
    });
  }
  confetti(x: number, y: number): void {
    const cols = [this.theme.accent, this.theme.pad, this.theme.zone, this.theme.bell];
    this.emit(90, (p) => {
      this.col3(cols[Math.floor(this.R() * cols.length)]!, p);
      p.x = x + (this.R() - 0.5) * 1.2; p.y = y + this.R() * 0.8; p.z = 0.3 + this.R() * 0.4;
      p.vx = (this.R() - 0.5) * 3; p.vy = 2 + this.R() * 3.5; p.vz = (this.R() - 0.5) * 1.5; p.g = -6; p.life = 1.6 + this.R();
    });
  }
  fanStream(x: number, y: number, dx: number, dy: number): void {
    this.emit(2, (p) => {
      p.x = x + (this.R() - 0.5) * 0.3; p.y = y + (this.R() - 0.5) * 0.3; p.z = 0.1;
      const v = 3 + this.R() * 2;
      p.vx = dx * v + (this.R() - 0.5) * 0.5; p.vy = dy * v + (this.R() - 0.5) * 0.5; p.vz = 0; p.g = 0; p.life = 0.7; p.r = p.gc = p.b = 1;
    });
  }
  magnetArc(x: number, y: number): void {
    this.emit(2, (p) => {
      const a = this.R() * Math.PI * 2, r = 0.25 + this.R() * 0.4;
      p.x = x + Math.cos(a) * r; p.y = y + Math.sin(a) * r; p.z = 0.15; p.vx = -Math.sin(a) * 1.5; p.vy = Math.cos(a) * 1.5; p.vz = 0;
      p.g = 0; p.life = 0.35; this.col3(this.theme.zone, p);
    });
  }
  puff(x: number, y: number, color: number): void {
    this.emit(14, (p) => {
      p.x = x + (this.R() - 0.5) * 0.4; p.y = y + (this.R() - 0.5) * 0.3; p.z = 0.2; p.vx = (this.R() - 0.5) * 1.4; p.vy = 0.8 + this.R(); p.vz = 0;
      p.g = -1.5; p.life = 0.8; this.col3(color, p);
    });
  }
  update(dt: number): void {
    if (!this.enabled) return;
    let alive = 0;
    for (let i = 0; i < this.cap; i++) {
      const p = this.p[i]!;
      if (p.life <= 0) { this.pos[i * 3 + 1] = -1000; continue; }
      p.life -= dt; p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.02 && p.vy < 0) { p.vy *= -0.4; p.y = 0.02; p.vx *= 0.7; }
      const f = Math.min(1, Math.max(0, p.life * 2.5));
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      this.col[i * 3] = p.r * f; this.col[i * 3 + 1] = p.gc * f; this.col[i * 3 + 2] = p.b * f;
      alive++;
    }
    this.alive = alive;
    this.points.geometry.getAttribute("position")!.needsUpdate = true;
    this.points.geometry.getAttribute("color")!.needsUpdate = true;
  }
  clear(): void {
    for (const p of this.p) p.life = 0;
    for (let i = 0; i < PARTICLE_MAX; i++) this.pos[i * 3 + 1] = -1000;
    this.points.geometry.getAttribute("position")!.needsUpdate = true;
  }
}

// ============================================================ scene.js
let theme: Theme = Themes.themeById("brassworks");
let colors: Palette = STATE_PALETTES.default!;
let look: Look | null = null;
let reduced = false;
const camera = new PerspectiveCamera(FRAMING.fov, 16 / 9, 0.1, 60);
export const rig = new CameraRig(camera);
const key = new DirectionalLight(theme.key.color, theme.key.intensity);
const hemi = new HemisphereLight(theme.hemi.sky, theme.hemi.ground, theme.hemi.intensity);
const fill = new DirectionalLight(0xfff2e0, 0.85);
const lamp = new PointLight(theme.lamp.color, theme.lamp.intensity, 12, 1.8);
const envGroup = new Group(), levelGroup = new Group(), fxGroup = new Group();
let factory: MaterialFactory | null = null;
let workshop: Workshop | null = null;
let levelView: LevelView | null = null;
let dummyView: DummyView | null = null;
const toolViews = new Map<number, ToolView>();
let vfx: VfxPool | null = null;
let ghost: GhostPreview | null = null;
let level: Level | null = null;
let posBuf = new Float32Array(512);
let envTex: Texture | null = null;
let time = 0;
let aspect = 0;
const pickPlane = new Plane(new Vector3(0, 0, 1), 0);
const raycaster = new Raycaster();

/** Once, from onStart. */
export function init(): void {
  renderer.camera = camera;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.outputColorSpace = SRGBColorSpace;
  key.position.set(...theme.key.pos);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key, key.target, hemi);
  fill.position.set(-2, 4.5, 10);
  scene.add(fill);
  lamp.position.set(0, 6.3, -0.6);
  scene.add(lamp);
  scene.add(envGroup, levelGroup, fxGroup);
}
function makeFactory(): MaterialFactory {
  const l = look!;
  return new MaterialFactory(theme, l.reflections, l.detailed, l.budget.material, l.budget.texture, l.budget.segments);
}
function buildEnvironment(): void {
  workshop?.dispose();
  workshop = new Workshop(envGroup, factory!, theme, Rng.createStream(theme.id.length * 7919 + 13), look!.detailed, look!.particles, look!.budget);
}
function fitShadow(): void {
  const b = level?.bounds ?? Schema.BOUNDS;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  key.target.position.set(cx, cy * 0.5, -0.6);
  const dir = new Vector3(...theme.key.pos).normalize();
  key.position.copy(key.target.position).addScaledVector(dir, 14);
  key.updateMatrixWorld(); key.target.updateMatrixWorld();
  const view = new Matrix4().lookAt(key.position, key.target.position, new Vector3(0, 1, 0));
  const inv = view.clone().invert();
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const v = new Vector3();
  for (const x of [b.x - 1.2, b.x + b.w + 1.2]) for (const y of [-0.3, b.y + b.h + 1.0]) for (const z of [-3.3, 2.2]) {
    v.set(x, y, z).sub(key.position).applyMatrix4(inv);
    minX = Math.min(minX, v.x); minY = Math.min(minY, v.y); minZ = Math.min(minZ, v.z);
    maxX = Math.max(maxX, v.x); maxY = Math.max(maxY, v.y); maxZ = Math.max(maxZ, v.z);
  }
  const cam = key.shadow.camera as unknown as { left: number; right: number; top: number; bottom: number; near: number; far: number; updateProjectionMatrix(): void };
  cam.left = minX; cam.right = maxX; cam.bottom = minY; cam.top = maxY;
  cam.near = Math.max(0.1, -maxZ - 1); cam.far = -minZ + 1;
  cam.updateProjectionMatrix();
}
function applyShadows(): void {
  const size = look!.shadows;
  renderer.shadowMap.enabled = size > 0;
  key.castShadow = size > 0;
  if (size > 0) key.shadow.mapSize = new Vector2(size, size);
  fitShadow();
}
function applyReflections(): void {
  if (look!.reflections) {
    if (!envTex) {
      const pmrem = new PMREMGenerator(renderer);
      const room = new RoomEnvironment(renderer);
      envTex = pmrem.fromScene(room, 0.04).texture;
      room.dispose();
      pmrem.dispose();
    }
    scene.environment = envTex;
    scene.environmentIntensity = 0.16;
  } else scene.environment = null;
}
function applyPost(): void {
  const l = look!;
  renderer.antialias = l.antialias;
  renderer.ao = l.ao === "off" ? null : {
    blendIntensity: 0.75, radius: 0.55, distanceExponent: 2, thickness: 1.2, scale: 1.0, samples: l.ao === "high" ? 16 : 8, resolution: l.budget.aoRes,
    denoise: { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: l.ao === "high" ? 8 : 4, rings: 2, samples: l.ao === "high" ? 16 : 8, radiusExponent: 2 },
  };
  // threshold on HDR (pre-tone-map) values: only the lamp bulb, window glow and hot highlights bloom
  // three r170 page: r176 UnrealBloom at the page's strength
  renderer.bloom = l.bloom ? { model: "r176", strength: 0.4, radius: 0.5, threshold: 1.05, resolution: l.budget.bloomRes } : null;
  // scene.js GradeShader after OutputPass: S-curve 0.22, saturation 1.1, cool shadows / warm highlights over
  // smoothstep(0.15, 0.8), blacks lifted ×0.97 + 0.02, vignette 0.28 over 0.38–0.9 (x stretched 1.1)
  renderer.grade = l.grade ? {
    space: "display", contrastCurve: "s", contrast: 0.22, saturation: 1.1, levels: [0.97, 0.02],
    shadows: [0.95, 0.98, 1.05], highlights: [1.05, 1.0, 0.94], split: [0.15, 0.8],
    vignette: { amount: 0.28, inner: 0.38, outer: 0.9, scale: [1.1, 1] },
  } : null;
}
function applyTheme(): void {
  renderer.toneMappingExposure = theme.exposure;
  scene.fog = new Fog(theme.fog.color, theme.fog.near, theme.fog.far);
  scene.background = new Color(theme.fog.color);
  key.color.set(theme.key.color); key.intensity = theme.key.intensity;
  hemi.color.set(theme.hemi.sky); hemi.groundColor.set(theme.hemi.ground); hemi.intensity = theme.hemi.intensity;
  lamp.color.set(theme.lamp.color); lamp.intensity = theme.lamp.intensity;
  factory?.dispose();
  for (const t of texCache.values()) t.dispose();
  texCache.clear();
  factory = makeFactory();
  ghost?.hide();
  ghost = new GhostPreview(fxGroup, factory, colors);
  if (!vfx) vfx = new VfxPool(fxGroup, particleCap(look!), theme);
  vfx.theme = theme;
  fitShadow();
  buildEnvironment();
  if (level) loadLevel(level, true);
  applyFog();
}
let themeKey = "";
/** The theme and colour palette (rebuilds the look when either changes). */
export function setTheme(id: string, palette: string): void {
  const k = `${id}|${palette}`;
  if (k === themeKey && factory) return;
  themeKey = k;
  theme = Themes.themeById(id);
  colors = STATE_PALETTES[palette] ?? STATE_PALETTES.default!;
  if (look) applyTheme();
}
let lookKey = "";
/** The graphics level's look (from main.ts each frame; cheap when unchanged). */
export function applyLook(next: Look): void {
  const k = JSON.stringify(next);
  if (k === lookKey) return;
  const rebuild = !look || look.reflections !== next.reflections || look.detailed !== next.detailed || look.particles !== next.particles || JSON.stringify(look.budget) !== JSON.stringify(next.budget);
  lookKey = k;
  look = next;
  applyShadows();
  applyReflections();
  applyPost();
  vfx?.setCap(particleCap(next));
  if (rebuild) applyTheme();
}
export function themeNow(): Theme { return theme; }
export function setReducedMotion(on: boolean): void { reduced = on; rig.setReducedMotion(on); }

/** Builds the level's views (statics, bells, zones, mounts, dummy). */
export function loadLevel(lv: Level, keepTheme = false): void {
  level = lv;
  if (!keepTheme) { setTheme(lv.theme || "brassworks", paletteName()); if (level !== lv) return; }
  levelView?.dispose();
  dummyView?.dispose();
  for (const tv of toolViews.values()) tv.dispose();
  toolViews.clear();
  ghost?.hide();
  levelGroup.clear();
  if (!factory) return;
  levelView = new LevelView(levelGroup, factory, theme, lv);
  dummyView = new DummyView(levelGroup, factory, theme);
  rig.setBounds(lv.bounds);
  rig.snapToGameplay();
  fitShadow();
  applyFog();
}
function paletteName(): string { return Object.keys(STATE_PALETTES).find((k) => STATE_PALETTES[k] === colors) ?? "default"; }
/** Clears leftover tool views and particles (a restart or undo rebuilds tools from state). */
export function resetTools(): void { for (const tv of toolViews.values()) tv.dispose(); toolViews.clear(); }
export function clearFx(): void { vfx?.clear(); }

function applyFog(): void {
  const f = scene.fog as Fog | null;
  if (!f) return;
  const d = rig.goalPos.distanceTo(rig.goalLook);
  const k = Math.max(1, d / FRAMING.distance);
  f.near = theme.fog.near * k; f.far = theme.fog.far * k;
}

/** Per frame: sync the views from the session (interpolated), animate, move the camera. */
export function update(dt: number, width: number, height: number, session: Session | null): void {
  time += dt;
  if (width > 0 && height > 0 && Math.abs(width / height - aspect) > 1e-6) {
    aspect = width / height;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    rig.resize(aspect);
    applyFog();
  }
  const st = session?.state;
  if (st && session && levelView && dummyView) {
    const n = st.world.particles.length;
    if (posBuf.length < n * 2) posBuf = new Float32Array(n * 2);
    session.renderPositions(posBuf);
    levelView.ensureBodies(st.bodies);
    levelView.updateBodies(posBuf, st.bodies);
    const live = new Set<number>();
    for (const tool of st.tools) {
      live.add(tool.id);
      if (!toolViews.has(tool.id) && tool.type !== "weight") toolViews.set(tool.id, new ToolView(levelGroup, factory!, theme, tool));
      toolViews.get(tool.id)?.update(tool, time, dt);
    }
    for (const [id, tv] of toolViews) if (!live.has(id)) { tv.dispose(); toolViews.delete(id); }
    for (const [id, m] of levelView.weightMeshes) if (!live.has(id)) { m.removeFromParent(); levelView.weightMeshes.delete(id); }
    const sx = st as unknown as { _dummySpeed?: number; _dummyAir?: boolean };
    const spd = sx._dummySpeed || 0;
    const squash = Math.max(0.82, Math.min(1.18, 1 + (sx._dummyAir ? 0 : spd > 6 ? -0.12 : 0)));
    dummyView.update(posBuf, st.bodies[st.dummyBody]!, time, squash);
    levelView.update(time, dt, st.goals);
    if (!reduced) for (const f of st.world.fields) {
      if (f.kind === "fan") vfx?.fanStream(f.x + f.dx * 0.4, f.y + f.dy * 0.4, f.dx, f.dy);
      else vfx?.magnetArc(f.x, f.y);
    }
  }
  workshop?.update(time, reduced, lamp);
  vfx?.update(dt);
  rig.update(dt);
}

/** scene.js handleEvent: session events → effects. */
export function handleEvent(ev: GameEvent, dc: { x: number; y: number } | null): void {
  const x = Number(ev.x ?? 0), y = Number(ev.y ?? 0);
  const burst = !reduced;
  switch (ev.t) {
    case "impact": { const s = Number(ev.speed ?? 0); if (s > 2.5 && burst) vfx?.impact(x, y, s); if (s > 6) rig.shake(0.03 + Math.min(s, 14) * 0.004, 0.3); break; }
    case "boing": if (burst) vfx?.boing(x, y); rig.shake(0.02, 0.22); break;
    case "bell": levelView?.ringBell(0); if (burst) vfx?.bellRing(x, y); rig.shake(0.035, 0.35); break;
    case "goal": if (burst) vfx?.confetti(dc?.x ?? 0, (dc?.y ?? 1) + 0.5); rig.shake(0.05, 0.5); break;
    case "win-pending": rig.retarget("results"); break;
    case "trigger": toolViews.get(Number(ev.id))?.onTrigger(); break;
    case "place": if (burst) vfx?.puff(x, y, theme.accent); break;
    case "terminal":
      if (ev.reason === "goal-complete" && burst) {
        const cx = dc?.x ?? 0, cy = dc?.y ?? 1;
        vfx?.confetti(cx, cy + 0.8); vfx?.confetti(cx - 1, cy + 1.2); vfx?.confetti(cx + 1, cy + 1.2);
      }
      break;
  }
}

// --- picking (window pixels) ---
/** A window point on the z = 0 gameplay plane. */
export function screenToWorld(px: number, py: number, w: number, h: number): { x: number; y: number } | null {
  if (w <= 0 || h <= 0) return null;
  raycaster.setFromCamera(new Vector2((px / w) * 2 - 1, -((py / h) * 2 - 1)), camera);
  const pt = new Vector3();
  const hit = raycaster.ray.intersectPlane(pickPlane, pt);
  return hit ? { x: pt.x, y: pt.y } : null;
}
/** World → window pixels. */
export function worldToScreen(x: number, y: number, z: number, w: number, h: number): { x: number; y: number; behind: boolean } {
  const v = new Vector3(x, y, z).project(camera);
  return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, behind: v.z > 1 };
}
export function mountViews(): MountView[] { return levelView?.mountViews ?? []; }
export function nearestMount(pt: { x: number; y: number }, maxDist = 0.55): MountView | null {
  let best: MountView | null = null, bd = maxDist;
  for (const v of mountViews()) { const d = Math.hypot(v.x - pt.x, v.y - pt.y); if (d < bd) { bd = d; best = v; } }
  return best;
}
export function setMountHighlight(show: boolean, ids?: string[] | null): void { levelView?.setMountHighlight(show, ids ?? null); }

/** scene.js previewTrajectory: clone the state, place + trigger, sample the dummy path. */
export function previewTrajectory(state: State, cmd: Record<string, unknown>, steps = 260, stride = 6): [number, number][] | null {
  try {
    const s = Serialize.cloneState(state);
    const r = Engine.applyCommand(s, { ...cmd, id: "preview" });
    if (!r.accepted) return null;
    Engine.applyCommand(s, { id: "preview2", type: "trigger", toolId: r.toolId });
    const pts: [number, number][] = [];
    const body = s.bodies[s.dummyBody]!;
    for (let i = 0; i < steps; i++) {
      Engine.step(s);
      if (i % stride === 0) {
        let cx = 0, cy = 0;
        for (let b = body.start; b < body.start + body.count; b++) { cx += s.world.particles[b]!.x; cy += s.world.particles[b]!.y; }
        pts.push([cx / body.count, cy / body.count]);
      }
      if (s.settled && i > 30) break;
    }
    return pts;
  } catch { return null; }
}
export function showGhost(kind: ToolKey): void { ghost?.show(kind); }
export function setGhostPose(pt: { x: number; y: number }, angle: number, valid: boolean): void { ghost?.setPose(pt.x, pt.y, angle); ghost?.setValidity(valid); }
export function setTrajectory(pts: [number, number][] | null): void { ghost?.setTrajectory(pts); }
export function hideGhost(): void { ghost?.hide(); }
export function ghostKind(): string | null { return ghost?.kind ?? null; }
