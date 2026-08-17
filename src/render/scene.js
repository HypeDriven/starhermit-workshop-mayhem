// Scene orchestrator: renderer, lighting rig, entity views, picking planes,
// quality tiers, context-loss recovery, prewarming, and the per-frame sync
// from session state (immutable snapshots + interpolation) to views.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { MaterialFactory, statePalette } from './materials.js';
import { Workshop } from './workshop.js';
import { DummyView } from './dummy-view.js';
import { LevelView, GhostPreview } from './props-view.js';
import { ToolView, makeToolMesh } from './tools-view.js';
import { VfxPool } from './vfx.js';
import { CameraRig, FRAMING } from './camera.js';
import { resolveTier, RenderScaleGovernor } from './quality.js';
import { themeById } from '../content/themes.js';
import { createStream } from '../rules/rng.js';
import { cloneState } from '../rules/serialize.js';
import { step as ruleStep, applyCommand } from '../rules/engine.js';

export class GameScene {
  constructor(canvas, { tier: tierSetting = 'auto', onContextLoss = () => {}, palette = 'default' } = {}) {
    this.canvas = canvas;
    this.onContextLoss = onContextLoss;
    this.paletteName = palette;
    this.tierSetting = tierSetting;
    this.tier = resolveTier(tierSetting);
    this.theme = themeById('brassworks');
    this.stateColors = statePalette(palette);
    this.reducedMotion = false;
    this.decorative = true;   // decorative motion/particles paused when hidden
    this.level = null;
    this.renderPositionsBuf = null;
    this.time = 0;
    this.toolViews = new Map();
    this.hidden = false;
    this.initRenderer();
    this.initScene();
    this.bindContextEvents();
  }

  initRenderer() {
    const r = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: true, powerPreference: 'high-performance',
    });
    r.info.autoReset = false; // accumulate across composer passes; reset per frame
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = this.theme.exposure;
    r.shadowMap.enabled = this.tier.shadows;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = r;
    this.scaleGov = new RenderScaleGovernor(this.tier.renderScale);
    this.applySize();
  }

  initScene() {
    const t = this.theme;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(t.fog.color, t.fog.near, t.fog.far);
    this.scene.background = new THREE.Color(t.fog.color);
    this.camera = new THREE.PerspectiveCamera(FRAMING.fov, 16 / 9, 0.1, 60);
    this.rig = new CameraRig(this.camera);
    this.rig.setReducedMotion(this.reducedMotion);

    // lighting rig: dominant key + soft environment fill + lamp point
    this.key = new THREE.DirectionalLight(t.key.color, t.key.intensity);
    this.key.position.set(...t.key.pos);
    if (this.tier.shadows) {
      this.key.castShadow = true;
      this.key.shadow.mapSize.setScalar(this.tier.shadowSize);
      this.key.shadow.camera.left = -9; this.key.shadow.camera.right = 9;
      this.key.shadow.camera.top = 9; this.key.shadow.camera.bottom = -3;
      this.key.shadow.camera.far = 24;
      this.key.shadow.bias = -0.0004;
      this.key.shadow.normalBias = 0.02;
    }
    this.scene.add(this.key);
    this.hemi = new THREE.HemisphereLight(t.hemi.sky, t.hemi.ground, t.hemi.intensity);
    this.scene.add(this.hemi);
    // soft camera-side fill so gameplay pieces never go muddy
    this.fill = new THREE.DirectionalLight(0xfff2e0, 0.85);
    this.fill.position.set(-2, 4.5, 10);
    this.scene.add(this.fill);
    this.lamp = new THREE.PointLight(t.lamp.color, t.lamp.intensity, 12, 1.8);
    this.lamp.position.set(0, 6.3, -0.6);
    this.scene.add(this.lamp);

    this.factory = new MaterialFactory(t);
    this.envGroup = new THREE.Group();
    this.levelGroup = new THREE.Group();
    this.fxGroup = new THREE.Group();
    this.scene.add(this.envGroup, this.levelGroup, this.fxGroup);
    this.vfx = new VfxPool(this.fxGroup, this.tier.id, t);
    this.ghost = new GhostPreview(this.fxGroup, this.factory, t, this.stateColors);
    this.pickPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this.raycaster = new THREE.Raycaster();
    this.buildEnvironment();
    this.buildComposer();
    this.prewarm();
  }

  buildEnvironment() {
    if (this.workshop) this.workshop.dispose();
    const rng = createStream(this.theme.id.length * 7919 + 13);
    this.workshop = new Workshop(this.envGroup, this.factory, this.theme, rng, this.tier.id);
  }

  buildComposer() {
    const size = this.renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(size, 0.35, 0.6, 0.85);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  prewarm() {
    // compile all shader variants before active play (spec §4 budgets)
    this.renderer.compile(this.scene, this.camera);
    this.renderFrame();
  }

  bindContextEvents() {
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.onContextLoss(true);
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      // rebuild GPU resources from retained CPU descriptors
      this.contextLost = false;
      this.initRenderer();
      this.initScene();
      if (this.level) this.loadLevel(this.level, { keepTheme: true });
      this.onContextLoss(false);
    });
  }

  // --- theme -----------------------------------------------------------------
  setTheme(themeId, paletteName) {
    this.theme = themeById(themeId);
    if (paletteName) this.stateColors = statePalette(paletteName);
    const t = this.theme;
    this.renderer.toneMappingExposure = t.exposure;
    this.scene.fog = new THREE.Fog(t.fog.color, t.fog.near, t.fog.far);
    this.scene.background = new THREE.Color(t.fog.color);
    this.key.color.set(t.key.color); this.key.intensity = t.key.intensity;
    this.key.position.set(...t.key.pos);
    this.hemi.color.set(t.hemi.sky); this.hemi.groundColor.set(t.hemi.ground);
    this.hemi.intensity = t.hemi.intensity;
    this.lamp.color.set(t.lamp.color); this.lamp.intensity = t.lamp.intensity;
    this.factory.dispose();
    this.factory = new MaterialFactory(t);
    this.vfx.theme = t;
    this.buildEnvironment();
    if (this.level) this.loadLevel(this.level, { keepTheme: true });
  }

  // --- level -------------------------------------------------------------------
  loadLevel(level, { keepTheme = false } = {}) {
    this.level = level;
    if (!keepTheme) this.setTheme(level.theme || 'brassworks', this.paletteName);
    // clear prior level views
    if (this.levelView) this.levelView.dispose();
    if (this.dummyView) this.dummyView.dispose();
    for (const tv of this.toolViews.values()) tv.dispose();
    this.toolViews.clear();
    this.ghost.hide();
    this.levelGroup.clear();

    this.levelView = new LevelView(this.levelGroup, this.factory, this.theme, level);
    this.dummyView = new DummyView(this.levelGroup, this.factory, this.theme);
    this.renderPositionsBuf = new Float32Array(256 * 2);
    this.rig.setBounds(level.bounds);
    this.rig.snapToGameplay();
    this.prewarm();
  }

  // --- per-frame sync ------------------------------------------------------------
  frame(dt, session) {
    if (this.contextLost || this.hidden) return;
    this.renderer.info.reset();
    this.time += dt;
    if (session?.state) {
      const st = session.state;
      // interpolation buffer sized to particles
      const n = st.world.particles.length;
      if (this.renderPositionsBuf.length < n * 2) this.renderPositionsBuf = new Float32Array(n * 2);
      session.renderPositions(this.renderPositionsBuf);
      this.levelView.ensureBodies(st.bodies);
      this.levelView.updateBodies(this.renderPositionsBuf, st.bodies);
      // tool views
      for (const tool of st.tools) {
        if (!this.toolViews.has(tool.id) && tool.type !== 'weight') {
          this.toolViews.set(tool.id, new ToolView(this.levelGroup, this.factory, this.theme, tool));
        }
        const tv = this.toolViews.get(tool.id);
        if (tv) tv.update(tool, this.time, dt);
      }
      // dummy squash from vertical speed change (bounded)
      const spd = st._dummySpeed || 0;
      const squash = Math.max(0.82, Math.min(1.18, 1 + (st._dummyAir ? 0 : (spd > 6 ? -0.12 : 0))));
      this.dummyView.update(this.renderPositionsBuf, st.bodies[st.dummyBody], this.time, { squash });
      this.levelView.update(this.time, dt, st.goals);
      // active fields drive stream particles
      if (this.decorative) {
        for (const f of st.world.fields) {
          if (f.kind === 'fan') this.vfx.fanStream(f.x + f.dx * 0.4, f.y + f.dy * 0.4, f.dx, f.dy);
          else this.vfx.magnetArc(f.x, f.y);
        }
      }
    }
    if (this.decorative) this.workshop.update(this.time);
    this.vfx.setEnabled(this.decorative);
    if (this.decorative) this.vfx.update(dt);
    this.rig.update(dt);
    // dynamic render scale
    const newScale = this.scaleGov.frame(dt);
    if (newScale) this.applySize();
    this.renderFrame();
  }

  renderFrame() {
    if (this.tier.bloom && this.bloom) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  // --- events -> effects (tiered hierarchy, spec §4) ----------------------------
  handleEvent(ev, session) {
    const dc = session?.dummyCenter;
    switch (ev.t) {
      case 'impact':
        if (ev.speed > 2.5) this.vfx.impact(ev.x, ev.y, ev.speed);
        if (ev.speed > 6) this.rig.shake(0.03 + Math.min(ev.speed, 14) * 0.004, 0.3);
        break;
      case 'boing':
        this.vfx.boing(ev.x, ev.y);
        this.rig.shake(0.02, 0.22);
        break;
      case 'bell': {
        this.levelView?.ringBell(0);
        this.vfx.bellRing(ev.x, ev.y);
        this.rig.shake(0.035, 0.35);
        break;
      }
      case 'goal':
        this.vfx.confetti(dc?.x ?? 0, (dc?.y ?? 1) + 0.5);
        this.rig.shake(0.05, 0.5);
        break;
      case 'win-pending':
        this.rig.retarget('results');
        break;
      case 'trigger': {
        const tv = this.toolViews.get(ev.id);
        if (tv) tv.onTrigger();
        break;
      }
      case 'place':
        this.vfx.puff(ev.x, ev.y, this.theme.accent);
        break;
      case 'settled':
        break;
      case 'terminal':
        if (ev.reason === 'goal-complete') {
          this.vfx.confetti(dc?.x ?? 0, (dc?.y ?? 1) + 0.8);
          this.vfx.confetti((dc?.x ?? 0) - 1, (dc?.y ?? 1) + 1.2);
          this.vfx.confetti((dc?.x ?? 0) + 1, (dc?.y ?? 1) + 1.2);
        }
        break;
    }
  }

  // --- picking --------------------------------------------------------------------
  // ndx/ndy in [-1,1]; returns point on the z=0 gameplay plane
  screenToWorld(ndx, ndy) {
    this.raycaster.setFromCamera({ x: ndx, y: ndy }, this.camera);
    const pt = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.pickPlane, pt);
    return pt ? { x: pt.x, y: pt.y } : null;
  }

  nearestMount(pt, maxDist = 0.55) {
    if (!this.levelView) return null;
    let best = null, bd = maxDist;
    for (const v of this.levelView.mountViews) {
      const d = Math.hypot(v.x - pt.x, v.y - pt.y);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  worldToScreen(x, y, z = 0) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (v.x * 0.5 + 0.5) * rect.width + rect.left,
      y: (-v.y * 0.5 + 0.5) * rect.height + rect.top,
      behind: v.z > 1,
    };
  }

  // trajectory preview: clone state, place+trigger candidate, sample the
  // dummy path. Rules stay untouched — this runs on a clone (spec §3 preview).
  previewTrajectory(session, cmd, steps = 260, stride = 6) {
    try {
      const s = cloneState(session.state);
      const r = applyCommand(s, { ...cmd, id: 'preview' });
      if (!r.accepted) return null;
      applyCommand(s, { id: 'preview2', type: 'trigger', toolId: r.toolId });
      const pts = [];
      const bodies = s.bodies[s.dummyBody];
      for (let i = 0; i < steps; i++) {
        ruleStep(s);
        if (i % stride === 0) {
          let cx = 0, cy = 0;
          for (let b = bodies.start; b < bodies.start + bodies.count; b++) {
            cx += s.world.particles[b].x; cy += s.world.particles[b].y;
          }
          pts.push([cx / bodies.count, cy / bodies.count]);
        }
        if (s.settled && i > 30) break;
      }
      return pts;
    } catch {
      return null;
    }
  }

  // --- ghost ----------------------------------------------------------------------
  showGhost(kind) {
    this.ghost.show(kind, () => makeToolMesh(kind, this.factory, this.theme));
  }

  setGhostPose(pt, angle, valid) {
    this.ghost.setPose(pt.x, pt.y, angle);
    this.ghost.setValidity(valid);
  }

  hideGhost() { this.ghost.hide(); }

  // --- misc -------------------------------------------------------------------------
  setReducedMotion(on) {
    this.reducedMotion = on;
    this.rig?.setReducedMotion(on);
  }

  setHidden(hidden) {
    this.hidden = hidden;
    this.setDecorative(!hidden);
  }

  setDecorative(on) { this.decorative = on; }

  applySize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.tier.dprCap) * this.scaleGov.scale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w * dpr, h * dpr);
    if (this.camera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.rig?.resize(w / h);
  }

  resize() { this.applySize(); }

  setTier(tierSetting) {
    this.tierSetting = tierSetting;
    this.tier = resolveTier(tierSetting);
    this.renderer.shadowMap.enabled = this.tier.shadows;
    this.applySize();
    // rebuild environment at new detail level
    this.buildEnvironment();
    this.prewarm();
  }

  perf() {
    const i = this.renderer.info;
    return {
      calls: i.render.calls, triangles: i.render.triangles,
      geometries: i.memory.geometries, textures: i.memory.textures,
      particles: this.vfx.alive, tier: this.tier.id, scale: this.scaleGov.scale,
    };
  }

  captureStill() {
    this.renderFrame();
    return this.canvas.toDataURL('image/png');
  }
}
