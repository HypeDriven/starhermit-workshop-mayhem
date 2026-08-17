// Bootstrap + game flow: boot → title → profile-ready → mode-select →
// preparing → countdown → active ↔ paused → resolving → results →
// progression (spec §2 game-state model). Wires rules, session, render, ui,
// audio, content and platform with one owner per transition.
import { GameScene } from './render/scene.js';
import { SessionController } from './session/session.js';
import { App } from './ui/app.js';
import { Hud } from './ui/hud.js';
import { InputController } from './ui/input.js';
import { Announcer, BoardMirror } from './ui/a11y.js';
import { AudioSystem } from './audio/audio.js';
import { Platform } from './platform/client.js';
import { JOURNEY, journeyById } from './content/stages.js';
import { TUTORIALS, tutorialById } from './content/tutorials.js';
import { dailyLevel } from './content/daily.js';
import { themeById } from './content/themes.js';
import { emptyAchievementDoc } from './content/achievements.js';
import {
  loadLocal, saveLocal, DEFAULT_SETTINGS, DEFAULT_PROFILE, DEFAULT_PROGRESSION,
  resolveConflict,
} from './session/persistence.js';

const MAX_DT = 1 / 20;

class GameApp {
  constructor() {
    this.state = 'boot';
    this.settings = loadLocal('settings') ?? structuredClone(DEFAULT_SETTINGS);
    this.profile = loadLocal('profile') ?? structuredClone(DEFAULT_PROFILE);
    this.progression = loadLocal('progression') ?? structuredClone(DEFAULT_PROGRESSION);
    this.achievementsDoc = loadLocal('achievements') ?? emptyAchievementDoc();
    this.awayAt = null;
    this.loadGroups = [
      { label: 'Rules engine', done: false },
      { label: 'Content & stages', done: false },
      { label: 'Workshop scene', done: false },
      { label: 'Interface', done: false },
      { label: 'Platform & time sync', done: false },
    ];
  }

  async boot() {
    this.announcer = new Announcer(document.getElementById('announcer'));
    this.mirror = new BoardMirror(
      document.getElementById('board-mirror'),
      document.getElementById('captions'),
    );
    this.app = new App(this);
    this.app.show('loading', { progress: 0.05, groups: this.loadGroups });

    // WebGL capability check with clear compatibility fallback
    const canvas = document.getElementById('gl');
    if (!webglAvailable(canvas)) {
      this.showCompatibility();
      return;
    }

    this.markLoaded(0, 0.2);
    this.platform = new Platform();
    this.platform.setTelemetryConsent(!!this.settings.telemetryConsent);
    this.audio = new AudioSystem();
    this.audio.setVolumes(this.settings.audio);
    this.audio.setMuted(this.settings.audio.muted);
    this.audio.onCaption((t) => this.mirror.caption(t));

    this.scene = new GameScene(canvas, {
      tier: this.settings.graphics.tier,
      palette: this.settings.accessibility.colorPalette,
      onContextLoss: (lost) => this.onContextLoss(lost),
    });
    this.scene.setReducedMotion(this.settings.accessibility.reducedMotion);
    this.markLoaded(2, 0.45);

    this.session = new SessionController({
      platform: this.platform,
      onEvent: (ev) => this.onSessionEvent(ev),
    });
    this.input = new InputController({
      canvas, session: this.session, scene: this.scene,
      callbacks: {
        pause: () => this.pauseGame(),
        cameraReset: () => this.scene.rig.snapToGameplay(),
        mute: () => this.toggleMute(),
        hint: () => this.showHint(),
        undo: () => this.doUndo(),
        restart: () => this.session.restart(),
        skip: () => this.doSkip(),
        announce: (t) => this.announcer.say(t),
        trayChanged: () => {},
        tutorialUi: (kind, data) => this.session.tutorialUi(kind, data),
      },
    });
    this.input.setBindings(this.settings.bindings);
    this.hud = new Hud(document.getElementById('hud-root'), {
      onAction: (act, arg) => this.onHudAction(act, arg),
      announce: (t, p) => this.announcer.say(t, p),
    });
    this.markLoaded(1, 0.6);
    this.markLoaded(3, 0.75);

    // platform: time sync + activity + cloud conflict resolution
    await this.platform.syncTime();
    this.platform.startActivity();
    this.markLoaded(4, 0.9);
    await this.reconcileCloud();

    this.dailyLevel = dailyLevel(this.platform.utcDay());
    this.dailyInfo = { label: new Date(this.platform.now()).toISOString().slice(5, 10) };
    this.scene.setTheme(this.settings.lastTheme || 'brassworks', this.settings.accessibility.colorPalette);
    this.applyAccessibility();
    this.bindGlobal();
    this.app.show('loading', { progress: 1, groups: this.loadGroups });
    this.toTitle();
    this.platform.telemetry('start', { mode: 'boot' });
    this.startLoop();
  }

  markLoaded(i, p) {
    this.loadGroups[i].done = true;
    this.app.show('loading', { progress: p, groups: this.loadGroups });
  }

  showCompatibility() {
    document.getElementById('screen-root').innerHTML = `
      <div class="panel narrow">
        <h1>Workshop Mayhem needs WebGL</h1>
        <div class="card"><p>Your browser or device has WebGL disabled, so the workshop can't be drawn. Your profile and progress are safe on this device.</p>
        <p>Try a current version of Chrome, Edge, Firefox or Safari, or enable hardware acceleration.</p></div>
      </div>`;
  }

  onContextLoss(lost) {
    if (lost) {
      this.announcer.say('Graphics context lost — rebuilding the workshop', 'assertive');
    } else {
      this.announcer.say('Workshop restored');
    }
  }

  async reconcileCloud() {
    if (!this.platform.hosted) return;
    const r = await this.platform.cloudLoad('progression');
    if (r.error || !r.doc) {
      await this.platform.cloudSave('progression', saveLocal('progression', this.progression));
      return;
    }
    const local = JSON.parse(localStorage.getItem('workshop-mayhem:progression') || 'null');
    if (!local) {
      this.progression = r.doc.data ?? r.doc;
      saveLocal('progression', this.progression);
      return;
    }
    const res = resolveConflict(local, r.doc);
    if (res.conflict) {
      this.app.showOverlay('conflict', {
        local: JSON.stringify(local), remote: JSON.stringify(r.doc),
        onPick: (pick) => {
          const chosen = pick === 'local' ? local : r.doc;
          this.progression = chosen.data ?? chosen;
          saveLocal('progression', this.progression);
          if (this.current === 'journey') this.route('journey');
        },
      });
    } else if (res.winner === 'remote') {
      this.progression = r.doc.data ?? r.doc;
      saveLocal('progression', this.progression);
    }
  }

  // --- routing ------------------------------------------------------------------
  route(name, params) {
    this.audio.event({ t: 'ui-click' });
    // leaving an active round for menus: abandon it quietly (no overlay)
    if (this.state === 'active') {
      this.suppressNextResults = true;
      this.session.abandon();
    }
    if (!['pause-resume'].includes(name)) {
      clearTimeout(this.resultsTimer);
      if (this.state === 'results') this.state = 'menu';
      this.app.closeOverlay();
    }
    const map = {
      title: () => this.toTitle(),
      play: () => this.app.show('modes'),
      modes: () => this.app.show('modes'),
      journey: () => this.app.show('journey'),
      learn: () => this.app.show('learn'),
      practice: () => this.app.show('practice'),
      challenge: () => this.app.show('challenge'),
      daily: () => this.app.show('daily'),
      boards: () => this.app.show('boards', params),
      achievements: () => this.app.show('achievements'),
      cosmetics: () => this.app.show('cosmetics'),
      help: () => this.app.show('help'),
      settings: () => this.app.show('settings'),
      profile: () => this.app.show('profile'),
      'pause-resume': () => { this.returnTo = null; this.app.showOverlay('pause'); },
    };
    (map[name] ?? map.title)();
  }

  toTitle() {
    this.state = 'title';
    this.input.setEnabled(false);
    this.hud.root.classList.add('hidden');
    document.getElementById('screen-root').classList.remove('hidden');
    this.scene.rig.retarget('title');
    if (!this.titleSceneBuilt) {
      this.titleSceneBuilt = true;
      const lvl = journeyById('j01');
      this.scene.loadLevel(lvl);
      this.scene.rig.retarget('title');
    }
    this.audio.startMusic('warm');
    this.audio.setIntensity(0);
    this.app.show('title');
  }

  // --- stage lifecycle ------------------------------------------------------------
  startStage(levelId, mode) {
    const level = journeyById(levelId) || tutorialById(levelId);
    if (!level) return;
    this.beginRound(level, { mode, allowUndo: mode === 'learn' || mode === 'practice' });
  }

  startPractice({ levelId, difficulty, undo }) {
    let level = journeyById(levelId);
    if (!level) return;
    level = practiceVariant(level, difficulty);
    this.beginRound(level, { mode: 'practice', allowUndo: undo });
  }

  startDaily() {
    this.beginRound(this.dailyLevel, { mode: 'daily', allowUndo: false });
  }

  retryStage() {
    const f = this.session.finished;
    if (!f) return;
    const level = journeyById(f.levelId) || tutorialById(f.levelId) || this.dailyLevel;
    this.beginRound(level, { mode: f.mode, allowUndo: f.mode === 'practice' || f.mode === 'learn' });
  }

  nextStage(results) {
    const m = /^j(\d+)$/.exec(results.levelId);
    if (m) {
      const next = journeyById(`j${String(parseInt(m[1], 10) + 1).padStart(2, '0')}`);
      if (next) return this.beginRound(next, { mode: 'journey' });
      return this.route('journey');
    }
    if (results.mode === 'learn') {
      const idx = TUTORIALS.findIndex(t => t.id === results.levelId);
      const next = TUTORIALS[idx + 1];
      if (next) return this.beginRound(next, { mode: 'learn', allowUndo: true });
      return this.route('journey');
    }
    if (results.mode === 'challenge') {
      const idx = (results.levelId || 'c1').slice(1) | 0;
      const next = journeyById(`c${idx + 1}`);
      if (next) return this.beginRound(next, { mode: 'challenge' });
      return this.route('challenge');
    }
    this.route('title');
  }

  beginRound(level, { mode, allowUndo }) {
    clearTimeout(this.resultsTimer);
    clearTimeout(this.countdownTimer);
    this.state = 'preparing';
    this.app.screenRoot.classList.add('hidden');
    this.app.closeOverlay();
    document.getElementById('screen-root').classList.add('hidden');
    this.hud.root.classList.remove('hidden');
    this.scene.loadLevel(level);
    this.session.start(level, { mode, allowUndo });
    this.hud.buildLevel(level, mode);
    this.input.setEnabled(false);
    this.input.deselect?.();
    this.audio.event({ t: 'results' });
    this.audio.startMusic(themeById(level.theme).music);
    this.audio.startAmbience(themeById(level.theme).ambience);
    this.audio.setIntensity(1);
    this.announcer.say(`${level.name}. ${level.intro || ''}`);
    // tutorial setup
    if (mode === 'learn' && level.tutorial) {
      this.session.tutorialStep = 0;
      this.hud.tutorialStep(level, 0);
    }
    // countdown
    this.state = 'countdown';
    let n = 3;
    this.hud.countdown(n);
    const tick = () => {
      n--;
      if (n < 0) {
        this.hud.countdown(null);
        this.state = 'active';
        this.input.setEnabled(true);
        this.announcer.say('Go!');
        return;
      }
      this.hud.countdown(n || 'Go!');
      this.audio.event({ t: 'ui-click' });
      this.countdownTimer = setTimeout(tick, 700);
    };
    this.countdownTimer = setTimeout(tick, 700);
  }

  pauseGame() {
    if (this.state !== 'active') return;
    this.state = 'paused';
    this.session.setPaused(true);
    this.app.showOverlay('pause');
    this.announcer.say('Paused');
  }

  resumeGame() {
    if (this.state !== 'paused') return;
    this.app.closeOverlay();
    this.session.setPaused(false);
    this.state = 'active';
    this.announcer.say('Resumed');
    // "while you were away" summary
    const awayEl = document.getElementById('pause-away');
    if (this.awayAt && awayEl) {
      const secs = Math.round((Date.now() - this.awayAt) / 1000);
      if (secs > 20) awayEl.textContent = `While you were away (${secs}s), the simulation was paused. Nothing moved.`;
      this.awayAt = null;
    }
  }

  leaveRound() {
    this.app.closeOverlay();
    this.session.abandon();
    this.session.setPaused(false);
  }

  onHudAction(act, arg) {
    this.audio.event({ t: 'ui-click' });
    switch (act) {
      case 'pause': this.pauseGame(); break;
      case 'trigger': {
        const t = this.session.legal?.triggers?.[0];
        if (t) this.session.trigger(t.toolId);
        break;
      }
      case 'trigger-tool': this.session.trigger(arg); break;
      case 'skip': this.doSkip(); break;
      case 'undo': this.doUndo(); break;
      case 'hint': this.showHint(); break;
      case 'restart': this.session.restart(); break;
      case 'select-tool': this.input.selectTool(arg); break;
    }
  }

  doSkip() {
    const r = this.session.skip();
    if (!r.accepted) this.hud.showInvalid(r.reason);
    else this.audio.event({ t: 'skip' });
  }

  doUndo() {
    const r = this.session.undo();
    if (!r.accepted) this.hud.showInvalid(r.reason);
  }

  showHint() {
    const hint = this.session.hint();
    if (!hint) {
      this.announcer.say('No more hints — improvise!');
      return;
    }
    this.announcer.say(hint.kind === 'place'
      ? `Hint: place a ${hint.tool} near (${hint.x.toFixed(1)}, ${hint.y.toFixed(1)})`
      : `Hint: trigger the ${hint.type ?? 'tool'}`);
    if (hint.kind === 'place') {
      this.scene.showGhost(hint.tool);
      this.scene.setGhostPose({ x: hint.x, y: hint.y }, Math.atan2(hint.dy ?? 0, hint.dx ?? 1), true);
      setTimeout(() => { if (!this.input.selectedTool) this.scene.hideGhost(); }, 3200);
    }
  }

  onSessionEvent(ev) {
    this.audio.event(ev);
    this.scene.handleEvent(ev, this.session);
    switch (ev.t) {
      case 'invalid': this.hud.showInvalid(ev.reason); break;
      case 'goal': this.announcer.say('Goal complete!'); break;
      case 'bell': this.mirror.caption(ev.done ? 'bell rung!' : 'bell tapped'); break;
      case 'tutorial-step': {
        const lvl = this.session.level;
        this.hud.tutorialStep(lvl, ev.index);
        if (ev.index >= (lvl.tutorial?.steps.length ?? 0)) {
          if (!this.settings.tutorialDone.includes(lvl.id)) {
            this.settings.tutorialDone.push(lvl.id);
            this.saveSettings();
          }
        }
        this.platform.telemetry('tutorial-step', { level: lvl.id, step: ev.index });
        break;
      }
      case 'results': this.showResults(ev.results); break;
      case 'terminal': this.audio.setIntensity(ev.reason === 'goal-complete' ? 2 : 0); break;
    }
  }

  showResults(results) {
    if (this.state === 'preparing' || this.state === 'countdown') return; // stale round
    if (this.suppressNextResults) {
      this.suppressNextResults = false;
      this.session.finished = null;
      return;
    }
    this.state = 'results';
    this.input.setEnabled(false);
    this.progression = loadLocal('progression') ?? this.progression;
    this.achievementsDoc = loadLocal('achievements') ?? this.achievementsDoc;
    for (const a of results.newAchievements ?? []) {
      this.announcer.say(`Achievement unlocked: ${a.name}`, 'assertive');
      this.audio.event({ t: 'achievement' });
    }
    if (this.platform.hosted) this.platform.cloudSave('progression', saveLocal('progression', this.progression));
    this.announcer.say(
      results.score.primaryComplete
        ? `Goal complete! ${results.score.total} points, ${results.stars} stars.`
        : `Round over: ${results.reason}. ${results.score.total} points.`,
    );
    clearTimeout(this.resultsTimer);
    this.resultsTimer = setTimeout(() => {
      if (this.state === 'results') this.app.showOverlay('results', { results });
    }, 700);
  }

  // --- settings -------------------------------------------------------------------
  saveSettings() { saveLocal('settings', this.settings); }

  setAudioBus(bus, v) {
    this.settings.audio[bus] = v;
    this.audio.setVolumes({ [bus]: v });
    this.saveSettings();
    this.platform.telemetry('settings-change', { setting: `audio.${bus}` });
  }

  setSetting(path, value) {
    const [a, b] = path.split('.');
    this.settings[a][b] = value;
    if (path === 'audio.muted') this.audio.setMuted(value);
    if (path === 'graphics.tier') this.scene.setTier(value);
    this.saveSettings();
    this.platform.telemetry('settings-change', { setting: path });
  }

  setAccessibility(key, value) {
    this.settings.accessibility[key] = value;
    this.saveSettings();
    this.applyAccessibility();
    this.platform.telemetry('settings-change', { setting: `acc.${key}` });
  }

  applyAccessibility() {
    const a = this.settings.accessibility;
    document.body.classList.toggle('reduced-motion', a.reducedMotion);
    document.body.classList.toggle('high-contrast', a.highContrast);
    document.body.classList.toggle('large-text', a.largeText);
    document.body.classList.toggle('left-handed', a.leftHanded);
    this.scene.setReducedMotion(a.reducedMotion);
    this.mirror.captionsEnabled = a.captions;
    if (a.colorPalette !== this.scene.paletteName) {
      this.scene.paletteName = a.colorPalette;
      this.scene.setTheme(this.settings.lastTheme || 'brassworks', a.colorPalette);
    }
  }

  setTelemetryConsent(on) {
    this.settings.telemetryConsent = on;
    this.platform.setTelemetryConsent(on);
    this.saveSettings();
  }

  setDisplayName(name) {
    this.profile.displayName = name.slice(0, 24);
    saveLocal('profile', this.profile);
    this.route('profile');
  }

  setPrivacy(p) {
    this.profile.privacy = p;
    saveLocal('profile', this.profile);
  }

  setTheme(tid) {
    this.settings.lastTheme = tid;
    this.progression.cosmetics.theme = tid;
    this.saveSettings();
    saveLocal('progression', this.progression);
    this.scene.setTheme(tid, this.settings.accessibility.colorPalette);
  }

  rebind(action, code) {
    if (!this.settings.bindings) this.settings.bindings = { keyboard: {}, gamepad: {} };
    this.settings.bindings.keyboard[action] = code;
    this.input.setBindings(this.settings.bindings);
    this.saveSettings();
  }

  toggleMute() {
    this.settings.audio.muted = !this.settings.audio.muted;
    this.audio.setMuted(this.settings.audio.muted);
    this.saveSettings();
    this.announcer.say(this.settings.audio.muted ? 'Muted' : 'Sound on');
  }

  // --- global events ------------------------------------------------------------
  bindGlobal() {
    const unlock = () => {
      this.audio.unlock();
      this.audio.startMusic('warm');
      this.audio.startAmbience(themeById(this.settings.lastTheme || 'brassworks').ambience);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.awayAt = Date.now();
        if (this.state === 'active') this.pauseGame();
        this.scene.setHidden(true);
        this.audio.setHidden(true);
      } else {
        this.scene.setHidden(false);
        this.audio.setHidden(false);
      }
    });

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => this.scene.resize(), 60);
    });
    window.addEventListener('orientationchange', () => {
      setTimeout(() => this.scene.resize(), 120);
    });
    window.addEventListener('beforeunload', () => {
      this.platform.endActivity();
      this.platform.flushTelemetry();
    });
    window.addEventListener('error', (e) => {
      this.platform.telemetry('error', { category: e.error?.name ?? 'unknown' });
    });
  }

  // --- frame loop -----------------------------------------------------------------
  startLoop() {
    let last = performance.now();
    const loop = (now) => {
      requestAnimationFrame(loop);
      const dt = Math.min((now - last) / 1000, MAX_DT);
      last = now;
      this.input.frame(dt);
      if (this.state === 'active' || this.state === 'countdown') {
        this.session.advance(dt);
      }
      this.scene.frame(dt, this.session.state ? this.session : null);
      if (this.session.state) {
        this.hud.update(this.session, this.input);
        this.mirror.update(this.session.summary);
      }
    };
    requestAnimationFrame(loop);
  }
}

function webglAvailable(canvas) {
  try {
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function practiceVariant(level, difficulty) {
  if (difficulty === 'normal') return level;
  const tools = { ...level.tools };
  if (difficulty === 'easy') {
    for (const k of Object.keys(tools)) if (tools[k] > 0) tools[k] += 1;
  } else {
    for (const k of Object.keys(tools)) if (tools[k] > 1) tools[k] -= 1;
  }
  return {
    ...level, tools,
    name: `${level.name} (${difficulty})`,
    id: `${level.id}-practice-${difficulty}`,
  };
}

const app = new GameApp();
if (typeof window !== 'undefined') window.app = app; // debug/validation handle
app.boot().catch((err) => {
  console.error(err);
  document.getElementById('screen-root').innerHTML = `
    <div class="panel narrow"><h1>Something jammed</h1>
    <div class="card"><p>The workshop failed to start: ${err.message}</p>
    <p>Reload to try again. Your progress is stored locally.</p></div></div>`;
});
export { app };
