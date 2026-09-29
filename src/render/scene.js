// Scene orchestrator: renderer, lighting rig, entity views, picking planes,
// graphics presets + post chain, context-loss recovery, prewarming, and the per-frame sync
// from session state (immutable snapshots + interpolation) to views.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MaterialFactory, statePalette } from './materials.js';
import { Workshop } from './workshop.js';
import { DummyView } from './dummy-view.js';
import { LevelView, GhostPreview } from './props-view.js';
import { ToolView, makeToolMesh } from './tools-view.js';
import { VfxPool } from './vfx.js';
import { CameraRig, FRAMING } from './camera.js';
import { detectPreset, describe, migrate, resolve, SHADOW_MAP, PARTICLE_CAP } from './gfx.js';
import { themeById } from '../content/themes.js';
import { BOUNDS } from '../content/schema.js';
import { createStream } from '../rules/rng.js';
import { cloneState } from '../rules/serialize.js';
import { step as ruleStep, applyCommand } from '../rules/engine.js';

// Colour grade + vignette, applied after OutputPass (display-space in and out):
// gentle S-curve contrast, a touch more saturation, warm highlights / cool
// shadows, lifted blacks so pieces never sink into the murk.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 1.0 }, uVignette: { value: 0.28 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmount; uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = clamp(src.rgb, 0.0, 1.0);
      vec3 s = mix(c, c * c * (3.0 - 2.0 * c), 0.22);
      float l = dot(s, vec3(0.299, 0.587, 0.114));
      s = mix(vec3(l), s, 1.1);
      s *= mix(vec3(0.95, 0.98, 1.05), vec3(1.05, 1.0, 0.94), smoothstep(0.15, 0.8, l));
      s = s * 0.97 + 0.02;
      c = mix(c, s, uAmount);
      float d = length((vUv - 0.5) * vec2(1.1, 1.0));
      c *= 1.0 - uVignette * smoothstep(0.38, 0.9, d);
      gl_FragColor = vec4(c, src.a);
    }`,
};

// Unmasked GPU name (a throwaway context, so the real canvas can be created
// with the right antialias flag for the resolved preset).
function probeGpu() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return String(name || '');
  } catch {
    return '';
  }
}

function isMobileDevice() {
  try {
    const ua = navigator.userAgent || '';
    return /Android|iPhone|iPad|Mobile/i.test(ua) || !!window.matchMedia?.('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

export class GameScene {
  constructor(canvas, { graphics = {}, onContextLoss = () => {}, palette = 'default' } = {}) {
    this.canvas = canvas;
    this.onContextLoss = onContextLoss;
    this.paletteName = palette;
    this.gpu = probeGpu();
    this.detected = detectPreset(this.gpu, { mobile: isMobileDevice() });
    this.gfxSaved = migrate(graphics);
    this.q = resolve(this.gfxSaved, this.detected);
    this.adaptiveScale = 1;
    this._frames = [];
    this.fps = 0;
    this.pixelRatio = 1;
    this.postKey = null;
    this.postFailed = false;
    this.theme = themeById('brassworks');
    this.stateColors = statePalette(palette);
    this.reducedMotion = false;
    try {
      const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
      this.prefersReduced = !!mq?.matches;
      mq?.addEventListener?.('change', (e) => { this.prefersReduced = e.matches; });
    } catch { this.prefersReduced = false; }
    this.decorative = true;   // decorative motion/particles paused when hidden
    this.level = null;
    this.renderPositionsBuf = null;
    this.time = 0;
    this.toolViews = new Map();
    this.hidden = false;
    this.initRenderer();
    this.initScene();
    this.bindContextEvents();
    this._fpsVisible(this.q.showFps);
    this.canvas.dataset.gfxPreset = this.q.preset;
  }

  initRenderer() {
    // Canvas MSAA is fixed at context creation: use it when the resolved
    // preset asks for MSAA; later switches to MSAA go through a multisampled
    // composer target instead.
    this.ctxAA = this.q.antialias === 'msaa';
    const r = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: this.ctxAA, powerPreference: 'high-performance',
    });
    r.info.autoReset = false; // accumulate across composer passes; reset per frame
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = this.theme.exposure;
    r.shadowMap.enabled = this.q.shadows !== 'off';
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = r;
    this.envRT?.dispose();
    this.envRT = null;
    this.composer = null;
    this.postKey = null;
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
    // the renderer was sized before the camera existed: apply the real
    // aspect now so a portrait cold start is never framed at 16:9
    this.applySize();
    // the iframe can change size without a window resize event reaching us
    if (typeof ResizeObserver === 'function' && !this._ro) {
      this._ro = new ResizeObserver(() => this.applySize());
      this._ro.observe(this.canvas);
    }

    // lighting rig: dominant key + soft environment fill + lamp point
    this.key = new THREE.DirectionalLight(t.key.color, t.key.intensity);
    this.key.position.set(...t.key.pos);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    this.scene.add(this.key, this.key.target);
    this.hemi = new THREE.HemisphereLight(t.hemi.sky, t.hemi.ground, t.hemi.intensity);
    this.scene.add(this.hemi);
    // soft camera-side fill so gameplay pieces never go muddy
    this.fill = new THREE.DirectionalLight(0xfff2e0, 0.85);
    this.fill.position.set(-2, 4.5, 10);
    this.scene.add(this.fill);
    this.lamp = new THREE.PointLight(t.lamp.color, t.lamp.intensity, 12, 1.8);
    this.lamp.position.set(0, 6.3, -0.6);
    this.scene.add(this.lamp);

    this.factory = this.makeFactory(t);
    this.envGroup = new THREE.Group();
    this.levelGroup = new THREE.Group();
    this.fxGroup = new THREE.Group();
    this.scene.add(this.envGroup, this.levelGroup, this.fxGroup);
    this.vfx = new VfxPool(this.fxGroup, PARTICLE_CAP[this.q.particles], t);
    this.ghost = new GhostPreview(this.fxGroup, this.factory, t, this.stateColors);
    this.pickPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this.raycaster = new THREE.Raycaster();
    this.applyShadows();
    this.applyReflections();
    this.buildEnvironment();
    this.prewarm();
  }

  makeFactory(theme) {
    return new MaterialFactory(theme, {
      rich: this.q.reflections === 'on',
      detailed: this.q.detail === 'detailed',
    });
  }

  buildEnvironment() {
    if (this.workshop) this.workshop.dispose();
    const rng = createStream(this.theme.id.length * 7919 + 13);
    this.workshop = new Workshop(this.envGroup, this.factory, this.theme, rng, {
      detail: this.q.detail, particles: this.q.particles,
    });
  }

  // Key-light shadow box fitted tightly to the arena (plus the back wall it
  // throws onto), so the shadow texels are spent where the play happens.
  fitShadow() {
    const b = this.level?.bounds || BOUNDS;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const k = this.key;
    k.target.position.set(cx, cy * 0.5, -0.6);
    const dir = new THREE.Vector3(...this.theme.key.pos).normalize();
    k.position.copy(k.target.position).addScaledVector(dir, 14);
    k.updateMatrixWorld();
    k.target.updateMatrixWorld();
    const view = new THREE.Matrix4().lookAt(k.position, k.target.position, new THREE.Vector3(0, 1, 0));
    const inv = view.clone().invert();
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (const x of [b.x - 1.2, b.x + b.w + 1.2]) {
      for (const y of [-0.3, b.y + b.h + 1.0]) {
        for (const z of [-3.3, 2.2]) {
          v.set(x, y, z).sub(k.position).applyMatrix4(inv);
          box.expandByPoint(v);
        }
      }
    }
    const cam = k.shadow.camera;
    cam.left = box.min.x; cam.right = box.max.x;
    cam.bottom = box.min.y; cam.top = box.max.y;
    cam.near = Math.max(0.1, -box.max.z - 1);
    cam.far = -box.min.z + 1;
    cam.updateProjectionMatrix();
  }

  applyShadows() {
    const size = SHADOW_MAP[this.q.shadows];
    this.renderer.shadowMap.enabled = size > 0;
    this.key.castShadow = size > 0;
    if (size > 0 && this.key.shadow.mapSize.x !== size) {
      this.key.shadow.mapSize.set(size, size);
      this.key.shadow.map?.dispose();
      this.key.shadow.map = null;
    }
    this.fitShadow();
  }

  // Image-based lighting: a PMREM-filtered room so metals, varnish and the
  // bell pick up soft reflections instead of reading as flat black.
  applyReflections() {
    if (this.q.reflections === 'on') {
      if (!this.envRT) {
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        const room = new RoomEnvironment();
        this.envRT = pmrem.fromScene(room, 0.04);
        room.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
        pmrem.dispose();
      }
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = 0.16;
    } else {
      this.scene.environment = null;
    }
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
    this.factory = this.makeFactory(t);
    this.vfx.theme = t;
    this.fitShadow();
    this.buildEnvironment();
    if (this.level) this.loadLevel(this.level, { keepTheme: true });
    else this.applyFog();
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
    this.fitShadow();
    this.applyFog();
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
    if (this.decorative) this.workshop.update(this.time, dt, { reducedMotion: this.reducedMotion || this.prefersReduced, lamp: this.lamp });
    this.vfx.setEnabled(this.decorative);
    if (this.decorative) this.vfx.update(dt);
    this.rig.update(dt);
    // adaptive resolution from real wall-clock frame time (the loop's dt is capped)
    const now = performance.now();
    const realMs = this._lastFrame ? Math.min(250, now - this._lastFrame) : 16;
    this._lastFrame = now;
    if (this._adapt(realMs)) this.applySize();
    this.renderFrame();
  }

  renderFrame() {
    const key = this._postKey();
    if (key !== this.postKey) {
      this.postKey = key;
      this._buildPost();
    }
    if (this.composer) {
      try {
        this.composer.render();
        return;
      } catch {
        // post is an enhancement: fall back to direct rendering for good
        this.postFailed = true;
        this.composer = null;
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  // --- graphics settings -----------------------------------------------------------
  /** Apply saved graphics settings live (no reload). */
  setGraphics(saved) {
    const prev = this.q;
    this.gfxSaved = migrate(saved);
    const q = resolve(this.gfxSaved, this.detected);
    this.q = q;
    this.canvas.dataset.gfxPreset = q.preset;
    this.adaptiveScale = 1;
    this._frames = [];
    this.applyShadows();
    this.applyReflections();
    this.vfx.setCap(PARTICLE_CAP[q.particles]);
    this._fpsVisible(q.showFps);
    this.postKey = null; // rebuild the post chain on the next frame
    if (prev.reflections !== q.reflections || prev.detail !== q.detail || prev.particles !== q.particles) {
      // materials / environment geometry depend on these: rebuild the look
      this.setTheme(this.theme.id);
    } else {
      // materials pick up shadow-map changes on recompile
      this.scene.traverse((o) => {
        if (!o.material) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
      });
    }
    this.applySize();
    this.prewarm();
  }

  /** What the Graphics panel shows: GPU, auto choice, resolved tiers and cost. */
  graphicsInfo() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const px = [Math.round(w * this.pixelRatio), Math.round(h * this.pixelRatio)];
    return {
      gpu: this.gpu || 'unknown GPU',
      detected: this.detected,
      resolved: this.q,
      summary: describe(this.q, px),
      fps: Math.round(this.fps || 0),
      adaptiveScale: Math.round(this.adaptiveScale * 100) / 100,
      postFailed: !!this.postFailed,
    };
  }

  _fpsVisible(on) {
    let el = document.getElementById('fps-meter');
    if (on && !el) {
      el = document.createElement('div');
      el.id = 'fps-meter';
      el.setAttribute('aria-hidden', 'true');
      el.textContent = '… fps';
      document.body.append(el);
    }
    if (el) el.hidden = !on;
  }

  _needsPost() {
    const q = this.q;
    return !this.postFailed && (q.post || (q.antialias === 'msaa' && !this.ctxAA));
  }

  _postKey() {
    const q = this.q;
    if (!this._needsPost()) return 'none';
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    return [q.ao, q.bloom, q.grade, q.antialias, s.x, s.y].join('|');
  }

  _buildPost() {
    const q = this.q;
    this.composer?.dispose();
    this.composer = null;
    if (!this._needsPost()) return;
    try {
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      const W = size.x, H = size.y;
      const target = new THREE.WebGLRenderTarget(W, H, {
        type: THREE.HalfFloatType, samples: q.antialias === 'msaa' ? 4 : 0,
      });
      const composer = new EffectComposer(this.renderer, target);
      composer.setPixelRatio(1);
      composer.setSize(W, H);
      composer.addPass(new RenderPass(this.scene, this.camera));
      if (q.ao !== 'off') {
        const ao = new GTAOPass(this.scene, this.camera, W, H);
        ao.output = GTAOPass.OUTPUT.Default;
        ao.blendIntensity = 0.75;
        ao.updateGtaoMaterial({ radius: 0.55, distanceExponent: 2, thickness: 1.2, scale: 1.0, samples: q.ao === 'high' ? 16 : 8 });
        ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: q.ao === 'high' ? 8 : 4, rings: 2, samples: q.ao === 'high' ? 16 : 8 });
        composer.addPass(ao);
      }
      if (q.bloom === 'on') {
        // threshold on HDR (pre-tone-map) values: only the lamp bulb, window
        // glow and hot specular highlights bloom, never the lit dummy or UI
        composer.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), 0.4, 0.5, 1.05));
      }
      composer.addPass(new OutputPass());
      if (q.grade === 'on') composer.addPass(new ShaderPass(GradeShader));
      if (q.antialias === 'smaa') composer.addPass(new SMAAPass(W, H));
      if (q.antialias === 'fxaa') {
        const fxaa = new ShaderPass(FXAAShader);
        fxaa.material.uniforms.resolution.value.set(1 / W, 1 / H);
        composer.addPass(fxaa);
      }
      this.composer = composer;
    } catch {
      // post-processing is an enhancement: render directly and say so in Settings
      this.postFailed = true;
      this.composer = null;
    }
  }

  // Adaptive resolution: step the render scale down when frames are slow,
  // back up when fast; also drives the frame-rate readout.
  _adapt(ms) {
    const f = this._frames;
    f.push(ms);
    if (f.length < 90) return false;
    const avg = f.reduce((a, b) => a + b, 0) / f.length;
    f.length = 0;
    this.fps = 1000 / avg;
    const el = document.getElementById('fps-meter');
    if (el && !el.hidden) el.textContent = `${Math.round(this.fps)} fps · ${Math.round(this.pixelRatio * 100) / 100}×`;
    if (!this.q.adaptive) return false;
    const before = this.adaptiveScale;
    if (avg > 26) this.adaptiveScale = Math.max(0.6, this.adaptiveScale - 0.1);
    else if (avg < 14 && this.adaptiveScale < 1) this.adaptiveScale = Math.min(1, this.adaptiveScale + 0.05);
    return before !== this.adaptiveScale;
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
    // pixel ratio = min(dpr, preset cap) × preset/user scale × adaptive scale;
    // a size change alters the post key, so the chain is rebuilt at the new size
    const dpr = Math.min(window.devicePixelRatio || 1, this.q.dprCap) * this.q.scale * this.adaptiveScale;
    this.pixelRatio = dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    if (this.camera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.rig?.resize(w / h);
    this.applyFog();
  }

  // Fog follows the framed camera distance so a far (portrait) camera never
  // darkens the workshop into the murk.
  applyFog() {
    if (!this.scene?.fog || !this.rig) return;
    const t = this.theme;
    const d = this.rig.goalPos.distanceTo(this.rig.goalLook);
    const k = Math.max(1, d / FRAMING.distance);
    this.scene.fog.near = t.fog.near * k;
    this.scene.fog.far = t.fog.far * k;
  }

  resize() { this.applySize(); }

  perf() {
    const i = this.renderer.info;
    return {
      calls: i.render.calls, triangles: i.render.triangles,
      geometries: i.memory.geometries, textures: i.memory.textures,
      particles: this.vfx.alive, preset: this.q.preset, scale: this.pixelRatio,
    };
  }

  captureStill() {
    this.renderFrame();
    return this.canvas.toDataURL('image/png');
  }
}
