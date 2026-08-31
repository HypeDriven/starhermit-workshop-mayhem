// Audio: synthesized original sounds via WebAudio. Buses for music, effects,
// ambience, voice (UI narration-ish blips); event-mapped transients with
// seeded pitch variants for replay consistency; quiet ambience + adaptive
// music stems; background/visibility policy (spec §4 audio, §5 audio module).
export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.buses = {};
    this.volumes = { music: 0.7, effects: 0.9, ambience: 0.5, voice: 0.8 };
    this.muted = false;
    this.started = false;
    this.musicMode = null;
    this.musicTimer = null;
    this.ambienceNodes = [];
    this.musicNodes = [];
    this.captionCb = null;
    this.intensity = 0; // adaptive music: 0 calm, 1 action, 2 celebration
    this.samples = new Map(); // name -> AudioBuffer (loaded from sfx/, see manifest)
  }

  // Pre-recorded one-shots (sfx/*.opus, see sfx/manifest.md). Loaded after the
  // first user gesture; until a buffer is ready the synth fallback below plays.
  static SAMPLES = {
    'ui-click': 'ui-click', 'ui-hover': 'ui-hover', 'ui-confirm': 'ui-confirm',
    'ui-back': 'ui-back', 'ui-error': 'ui-error', 'ui-success': 'ui-success',
    'ui-modal-open': 'ui-modal-open', 'ui-panel-close': 'ui-panel-close',
    'ui-toggle': 'ui-toggle', 'ui-toast': 'ui-toast', 'ui-pause': 'ui-pause',
    'ui-resume': 'ui-resume', 'ui-tab-switch': 'ui-tab-switch',
    'ui-countdown-tick': 'ui-countdown-tick', 'ui-timer-warning': 'ui-timer-warning',
    'ui-slider-drag': 'ui-slider-drag', 'ui-drag-start': 'ui-drag-start',
    'ui-drop': 'ui-drop', 'ui-scroll-tick': 'ui-scroll-tick',
    'undo-rewind': 'undo-rewind',
    'tool-select': 'tool-select', 'tool-place': 'tool-place',
    'piston-wallop': 'piston-wallop', 'boing-bounce': 'boing-bounce',
    'plush-thud': 'plush-thud', 'dummy-launch': 'dummy-launch',
    'dummy-land': 'dummy-land', 'streak-combo': 'streak-combo',
    'target-hit': 'target-hit', 'star-ding': 'star-ding',
    'hint-sparkle': 'hint-sparkle', 'round-start': 'round-start',
    'round-win': 'round-win', 'round-lose': 'round-lose',
    'score-tally': 'score-tally', 'new-record': 'new-record',
  };

  loadSamples() {
    if (this._samplesLoading || !this.ctx) return;
    this._samplesLoading = true;
    for (const name of Object.values(AudioSystem.SAMPLES)) {
      fetch(`./sfx/${name}.opus`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
        .then((buf) => this.ctx.decodeAudioData(buf))
        .then((audio) => this.samples.set(name, audio))
        .catch(() => { /* missing/undecodable file: synth fallback keeps working */ });
    }
  }

  playSample(name, bus = 'effects', volume = 1) {
    const buf = this.samples.get(name);
    if (!buf || !this.started) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.buses[bus] ?? this.master);
    src.start();
    return true;
  }

  // must be called from a user gesture
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      for (const bus of ['music', 'effects', 'ambience', 'voice']) {
        const g = this.ctx.createGain();
        g.gain.value = this.volumes[bus];
        g.connect(this.master);
        this.buses[bus] = g;
      }
      this.applyVolumes();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.started = true;
    this.loadSamples();
  }

  setVolumes(v) {
    Object.assign(this.volumes, v);
    this.applyVolumes();
  }

  setMuted(m) {
    this.muted = m;
    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.master) return;
    this.master.gain.value = this.muted ? 0 : 1;
    for (const [bus, g] of Object.entries(this.buses)) {
      g.gain.value = this.volumes[bus];
    }
  }

  setHidden(hidden) {
    if (!this.ctx) return;
    // background: keep ambience/music lifecycle but ducked (spec §5 audio)
    this.master.gain.setTargetAtTime(hidden || this.muted ? 0 : 1, this.ctx.currentTime, 0.1);
  }

  onCaption(cb) { this.captionCb = cb; }
  caption(text) { this.captionCb?.(text); }

  // --- synth primitives --------------------------------------------------------
  env(gainNode, t0, a, peak, d, sustain = 0) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t0);
    g.linearRampToValueAtTime(peak, t0 + a);
    g.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t0 + a + d);
  }

  osc(type, freq, t0, dur, bus, peak = 0.2, bend = null) {
    if (!this.started) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (bend) o.frequency.exponentialRampToValueAtTime(Math.max(20, bend), t0 + dur);
    this.env(g, t0, 0.005, peak, dur);
    o.connect(g).connect(this.buses[bus]);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  noise(t0, dur, bus, peak = 0.15, filterFreq = 1200, q = 1, type = 'bandpass') {
    if (!this.started) return;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    if (!this._noiseBuf || this._noiseBuf.length < len) {
      const buf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this._noiseBuf = buf;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filterFreq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    this.env(g, t0, 0.004, peak, dur);
    src.connect(f).connect(g).connect(this.buses[bus]);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  // --- event sounds ---------------------------------------------------------------
  // Picks the pre-recorded sample for an event (null = synth only).
  sampleFor(ev) {
    switch (ev.t) {
      case 'ui-click': case 'ui-hover': case 'ui-confirm': case 'ui-back':
      case 'ui-modal-open': case 'ui-panel-close': case 'ui-toggle':
      case 'ui-tab-switch': case 'ui-countdown-tick': case 'ui-timer-warning':
      case 'ui-slider-drag': case 'ui-drag-start': case 'ui-drop':
      case 'ui-scroll-tick':
      case 'round-start': case 'score-tally': case 'new-record':
        return AudioSystem.SAMPLES[ev.t];
      case 'pause': return 'ui-pause';
      case 'resume': return 'ui-resume';
      case 'hint': return 'hint-sparkle';
      case 'select': return 'tool-select';
      case 'place': return 'tool-place';
      // piston slams; a triggered fan whooshes the dummy through the air
      case 'trigger': return ev.tool === 'piston' ? 'piston-wallop' : ev.tool === 'fan' ? 'dummy-launch' : null;
      // soft dummy hits; dummy (body 0) tumbling onto a static surface lands softly
      case 'impact':
        if (ev.mat === 0) return 'plush-thud';
        if (ev.a === 0 && ev.b === -1) return 'dummy-land';
        return null;
      case 'boing': return 'boing-bounce';
      case 'bell': return 'target-hit';
      case 'goal': return 'star-ding';
      case 'win-pending': return 'ui-success';
      case 'terminal': return ev.reason === 'goal-complete' ? 'round-win' : 'round-lose';
      case 'invalid': return 'ui-error';
      case 'undo': return 'undo-rewind';
      case 'tutorial-step': return 'ui-toast';
      case 'achievement': return ev.key === 'streak-3' ? 'streak-combo' : 'ui-success';
      case 'results': return 'score-tally';
      default: return null;
    }
  }

  event(ev) {
    if (!this.started) return;
    const sample = this.sampleFor(ev);
    if (sample && this.playSample(sample, ev.bus ?? 'effects')) {
      if (ev.t === 'place') this.caption('placing tool');
      if (ev.t === 'trigger') this.caption('triggered!');
      if (ev.t === 'boing') this.caption('boing!');
      if (ev.t === 'bell') this.caption(ev.done ? 'bell rung!' : 'bell tapped');
      if (ev.t === 'goal') this.caption('goal complete!');
      if (ev.t === 'achievement') this.caption('achievement unlocked!');
      return;
    }
    const t = this.ctx.currentTime;
    const v = 1 + ((ev.variant ?? 0) - 1.5) * 0.06; // seeded variant pitch
    switch (ev.t) {
      case 'ui-click':
        this.osc('triangle', 720, t, 0.06, 'voice', 0.08);
        break;
      case 'select':
        this.osc('triangle', 520, t, 0.05, 'voice', 0.08);
        this.osc('triangle', 780, t + 0.05, 0.07, 'voice', 0.08);
        break;
      case 'place':
        this.noise(t, 0.08, 'effects', 0.12, 900);
        this.osc('sine', 300, t, 0.1, 'effects', 0.12, 180);
        this.caption('placing tool');
        break;
      case 'trigger':
        this.noise(t, 0.12, 'effects', 0.18, 1600, 1.5);
        this.osc('square', 180, t, 0.14, 'effects', 0.1, 90);
        this.caption('triggered!');
        break;
      case 'impact': {
        const s = Math.min(ev.speed ?? 2, 14);
        const soft = ev.mat === 0;
        this.noise(t, 0.06 + s * 0.012, 'effects', 0.05 + s * 0.02, soft ? 500 : 1400, 1, soft ? 'lowpass' : 'bandpass');
        if (s > 4) this.osc('sine', 90 * v, t, 0.12, 'effects', 0.14, 50);
        break;
      }
      case 'boing':
        this.osc('sine', 240 * v, t, 0.22, 'effects', 0.2, 720);
        this.osc('triangle', 480 * v, t + 0.03, 0.16, 'effects', 0.1, 960);
        this.caption('boing!');
        break;
      case 'bell': {
        // FM-ish bell: carrier + partials with long decay
        const f0 = 620 * v;
        for (const [mult, peak, dur] of [[1, 0.22, 1.4], [2.4, 0.1, 0.9], [3.9, 0.05, 0.5]]) {
          this.osc('sine', f0 * mult, t, dur, 'effects', peak * (ev.done ? 1.2 : 0.7));
        }
        this.caption(ev.done ? 'bell rung!' : 'bell tapped');
        break;
      }
      case 'goal':
        [523, 659, 784].forEach((f, i) => this.osc('triangle', f, t + i * 0.07, 0.24, 'effects', 0.14));
        this.caption('goal complete!');
        break;
      case 'win-pending':
        [392, 523, 659, 784].forEach((f, i) => this.osc('triangle', f, t + i * 0.09, 0.3, 'music', 0.1));
        break;
      case 'terminal':
        if (ev.reason === 'goal-complete') {
          [523, 659, 784, 1047].forEach((f, i) => this.osc('triangle', f, t + i * 0.1, 0.5, 'music', 0.12));
        } else {
          this.osc('sine', 220, t, 0.4, 'music', 0.1, 160);
          this.osc('sine', 165, t + 0.25, 0.5, 'music', 0.1, 110);
        }
        break;
      case 'invalid':
        this.osc('square', 160, t, 0.09, 'voice', 0.06, 120);
        break;
      case 'undo':
        this.osc('triangle', 440, t, 0.08, 'voice', 0.08, 660);
        break;
      case 'skip':
        this.noise(t, 0.2, 'voice', 0.08, 2400, 1, 'highpass');
        break;
      case 'spent':
        this.noise(t, 0.1, 'effects', 0.05, 600);
        break;
      case 'tutorial-step':
        this.osc('sine', 880, t, 0.09, 'voice', 0.09);
        this.osc('sine', 1174, t + 0.08, 0.12, 'voice', 0.09);
        break;
      case 'achievement':
        [784, 988, 1175].forEach((f, i) => this.osc('sine', f, t + i * 0.08, 0.3, 'voice', 0.1));
        this.caption('achievement unlocked!');
        break;
      case 'results':
        this.osc('triangle', 523, t, 0.2, 'voice', 0.1);
        break;
      // --- UI/navigation events backed by sfx samples (synth fallbacks) ----------
      case 'ui-hover':
        this.osc('triangle', 980, t, 0.03, 'voice', 0.04);
        break;
      case 'ui-confirm':
        this.osc('triangle', 660, t, 0.06, 'voice', 0.08);
        this.osc('triangle', 880, t + 0.06, 0.09, 'voice', 0.08);
        break;
      case 'ui-back':
        this.osc('triangle', 620, t, 0.06, 'voice', 0.07, 440);
        break;
      case 'ui-modal-open':
        this.noise(t, 0.12, 'voice', 0.06, 900, 1, 'highpass');
        break;
      case 'ui-panel-close':
        this.noise(t, 0.08, 'voice', 0.08, 500, 1, 'lowpass');
        break;
      case 'ui-toggle':
        this.osc('square', 500, t, 0.04, 'voice', 0.05);
        break;
      case 'ui-tab-switch':
        this.osc('triangle', 540, t, 0.04, 'voice', 0.07);
        this.osc('triangle', 700, t + 0.04, 0.05, 'voice', 0.07);
        break;
      case 'ui-countdown-tick':
        this.osc('triangle', 840, t, 0.07, 'voice', 0.09);
        break;
      case 'ui-timer-warning':
        this.osc('square', 880, t, 0.09, 'voice', 0.06);
        this.osc('square', 880, t + 0.12, 0.09, 'voice', 0.06);
        break;
      case 'ui-slider-drag':
        this.osc('square', 420, t, 0.03, 'voice', 0.04);
        break;
      case 'ui-scroll-tick':
        this.osc('triangle', 1180, t, 0.025, 'voice', 0.04);
        break;
      case 'ui-drag-start':
        this.noise(t, 0.06, 'voice', 0.06, 1400);
        break;
      case 'ui-drop':
        this.noise(t, 0.08, 'voice', 0.08, 700);
        break;
      case 'pause':
        this.osc('sine', 300, t, 0.12, 'voice', 0.09, 200);
        break;
      case 'resume':
        this.osc('sine', 240 * v, t, 0.14, 'voice', 0.09, 480);
        break;
      case 'hint':
        this.osc('sine', 1046, t, 0.12, 'voice', 0.08);
        this.osc('sine', 1568, t + 0.09, 0.16, 'voice', 0.07);
        this.caption('hint shown');
        break;
      case 'round-start':
        this.noise(t, 0.15, 'effects', 0.1, 1800, 1, 'highpass');
        this.osc('triangle', 523, t, 0.15, 'effects', 0.12);
        this.osc('triangle', 784, t + 0.12, 0.2, 'effects', 0.12);
        break;
      case 'new-record':
        [659, 784, 988, 1319].forEach((f, i) => this.osc('sine', f, t + i * 0.07, 0.3, 'voice', 0.1));
        this.caption('new record!');
        break;
    }
  }

  // --- ambience ----------------------------------------------------------------------
  startAmbience(kind = 'room') {
    if (!this.started) return;
    this.stopAmbience();
    const t = this.ctx.currentTime;
    const mk = (setup) => {
      const nodes = setup(t);
      this.ambienceNodes.push(...nodes);
    };
    if (kind === 'room' || kind === 'garden') {
      mk(() => this.loopNoise(140, 0.5, 0.012, 'lowpass'));
      mk(() => this.loopNoise(800, 8, 0.004, 'bandpass'));
    } else if (kind === 'water') {
      mk(() => this.loopNoise(300, 2.2, 0.014, 'bandpass'));
    } else if (kind === 'forge') {
      mk(() => this.loopNoise(90, 0.4, 0.02, 'lowpass'));
      mk(() => this.loopNoise(1400, 12, 0.004, 'bandpass'));
    } else if (kind === 'night') {
      mk(() => this.loopNoise(500, 6, 0.007, 'bandpass'));
    }
  }

  loopNoise(freq, lfoRate, peak, type) {
    const src = this.ctx.createBufferSource();
    if (!this._noiseBuf) {
      const buf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this._noiseBuf = buf;
    }
    src.buffer = this._noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = peak;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = lfoRate * 0.1;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = peak * 0.5;
    lfo.connect(lfoG).connect(g.gain);
    src.connect(f).connect(g).connect(this.buses.ambience);
    src.start();
    lfo.start();
    return [src, lfo, g];
  }

  stopAmbience() {
    for (const n of this.ambienceNodes) {
      try { n.stop?.(); } catch { /* gain nodes */ }
      try { n.disconnect?.(); } catch { /* */ }
    }
    this.ambienceNodes = [];
  }

  // --- adaptive music ------------------------------------------------------------------
  // simple two-stem pattern (bass + arp) whose density follows intensity.
  startMusic(mode = 'warm') {
    if (!this.started || this.musicMode === mode) return;
    this.stopMusic();
    this.musicMode = mode;
    const scale = mode === 'cool' ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9];
    const root = mode === 'cool' ? 196 : 220;
    let step = 0;
    const tickRate = 0.24;
    this.musicTimer = setInterval(() => {
      if (!this.started || this.muted) return;
      const t = this.ctx.currentTime;
      const bar = Math.floor(step / 8);
      const beat = step % 8;
      // bass on 0 and 4
      if (beat === 0 || (beat === 4 && this.intensity > 0)) {
        const deg = scale[[0, 3, 4, 2][bar % 4] % scale.length];
        this.osc('sine', root * Math.pow(2, deg / 12) / 2, t, 0.5, 'music', 0.09);
      }
      // arp (denser with intensity)
      if ((beat % 2 === 0 && this.intensity > 0) || beat % 4 === 1 || this.intensity > 1) {
        const deg = scale[(step * 3 + bar) % scale.length] + 12;
        this.osc('triangle', root * Math.pow(2, deg / 12), t, 0.18, 'music', this.intensity > 1 ? 0.055 : 0.035);
      }
      step++;
    }, tickRate * 1000);
  }

  setIntensity(i) { this.intensity = i; }

  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
    this.musicMode = null;
  }

  dispose() {
    this.stopMusic();
    this.stopAmbience();
    this.ctx?.close();
  }
}
