// Browser-side session controller: owns the live rules state, fixed-step
// timing with interpolation alpha, command dispatch with action ids, undo,
// tutorial step tracking, results computation and persistence (spec §5:
// no module mutates rules state except through validated commands; rendering
// consumes immutable snapshots plus interpolation data).

import {
  createGame, applyCommand, step, legalActions, isTerminal, finalScore,
  makeCommandId, summarize, dummyCenter, TOOLS, RULES_VERSION,
} from '../rules/engine.js';
import { hashState, cloneState } from '../rules/serialize.js';
import { starsFor } from '../rules/scoring.js';
import {
  createEnvelope, recordCommand, recordStep, snapshotSession, restoreSession,
} from './replay.js';
import {
  saveLocal, loadLocal, DEFAULT_PROGRESSION,
} from './persistence.js';
import { evaluateAchievements, achievementContext, emptyAchievementDoc, ACHIEVEMENTS } from '../content/achievements.js';
import { DT } from '../rules/physics.js';

const BUILD = '1.0.0';

export class SessionController {
  constructor({ platform, onEvent }) {
    this.platform = platform;
    this.onEvent = onEvent || (() => {});
    this.state = null;
    this.envelope = null;
    this.level = null;
    this.mode = null;
    this.accumulator = 0;
    this.speed = 1;             // 1 or 2 (fast-forward toggle)
    this.paused = false;
    this.undoStack = [];
    this.tutorialStep = 0;
    this.finished = null;       // results object once terminal
    this.interpAlpha = 0;
    this.prevPositions = null;  // for render interpolation
    this.sessionId = makeCommandId('s');
    this.startedAt = 0;
  }

  start(level, { mode = 'journey', allowUndo = false, seed = null } = {}) {
    this.level = level;
    this.mode = mode;
    this.state = createGame(level, { mode, allowUndo, seed: seed ?? level.seed });
    this.envelope = createEnvelope({ level, seed: seed ?? level.seed, mode, build: BUILD });
    this.accumulator = 0;
    this.paused = false;
    this.undoStack = [];
    this.tutorialStep = 0;
    this.finished = null;
    this.prevPositions = null;
    this.startedAt = Date.now();
    // settle the world to its natural rest before the player acts
    let guard = 0;
    while (!this.state.settled && this.state.phase !== 'terminal' && guard++ < 3600) step(this.state);
    this._capturePrev();
    return this.state;
  }

  resume(snap) {
    const { state, envelope } = restoreSession(snap, this.level);
    this.state = state;
    this.envelope = envelope;
    this.finished = null;
    this._capturePrev();
    return state;
  }

  snapshot() {
    return this.state ? snapshotSession(this.state, this.envelope) : null;
  }

  // --- commands (validated, recorded) ---------------------------------------
  place(tool, x, y, dx, dy, mountId = null) {
    if (!this.state || this.finished) return { accepted: false, reason: 'no-session' };
    this._pushUndo();
    const cmd = { id: makeCommandId('p'), type: 'place', tool, x, y, dx, dy, mountId };
    const result = recordCommand(this.state, this.envelope, cmd);
    if (!result.accepted) this.undoStack.pop();
    else this._tutorialEvent({ do: 'place', tool });
    this._afterCommand(result);
    return result;
  }

  trigger(toolId) {
    if (!this.state || this.finished) return { accepted: false, reason: 'no-session' };
    this._pushUndo();
    const cmd = { id: makeCommandId('t'), type: 'trigger', toolId };
    const result = recordCommand(this.state, this.envelope, cmd);
    if (!result.accepted) this.undoStack.pop();
    else this._tutorialEvent({ do: 'trigger', tool: this.state.tools.find(t => t.id === toolId)?.type });
    this._afterCommand(result);
    return result;
  }

  skip() {
    if (!this.state || this.finished || this.state.settled) return { accepted: false, reason: 'nothing-to-skip' };
    const cmd = { id: makeCommandId('k'), type: 'skip' };
    const result = recordCommand(this.state, this.envelope, cmd);
    this._capturePrev();
    this._afterCommand(result);
    return result;
  }

  undo() {
    if (!this.state?.options.allowUndo || !this.undoStack.length) {
      return { accepted: false, reason: 'no-undo' };
    }
    const snap = this.undoStack.pop();
    this.resume(snap);
    this.onEvent({ t: 'undo' });
    return { accepted: true };
  }

  restart() {
    if (!this.level) return;
    this.start(this.level, { mode: this.mode, allowUndo: this.state?.options.allowUndo });
    this.onEvent({ t: 'restart' });
  }

  abandon() {
    if (!this.state || this.finished) return;
    this.state.phase = 'terminal';
    this.state.terminalReason = 'abandoned';
    this._finish();
  }

  _pushUndo() {
    if (!this.state?.options.allowUndo) return;
    this.undoStack.push(snapshotSession(this.state, this.envelope));
    if (this.undoStack.length > 24) this.undoStack.shift();
  }

  _afterCommand(result) {
    for (const ev of result.events || []) this.onEvent(ev);
    if (!result.accepted) this.onEvent({ t: 'invalid', reason: result.reason });
  }

  _tutorialEvent(cmd) {
    if (this.mode !== 'learn' || !this.level.tutorial) return;
    const steps = this.level.tutorial.steps;
    const cur = steps[this.tutorialStep];
    if (!cur || !cur.expect?.do) return;
    if (cur.expect.do === cmd.do && (!cur.expect.tool || cur.expect.tool === cmd.tool)) {
      this.tutorialStep++;
      this.onEvent({ t: 'tutorial-step', index: this.tutorialStep, total: steps.length });
    }
  }

  // called by UI when the player performs a UI-side tutorial expectation
  tutorialUi(kind, data = {}) {
    if (this.mode !== 'learn' || !this.level.tutorial) return;
    const steps = this.level.tutorial.steps;
    const cur = steps[this.tutorialStep];
    if (!cur || cur.expect?.ui !== kind) return;
    if (cur.expect.tool && cur.expect.tool !== data.tool) return;
    this.tutorialStep++;
    this.onEvent({ t: 'tutorial-step', index: this.tutorialStep, total: steps.length });
  }

  hint() {
    // next unperformed reference-solution command, through the same
    // legal-action semantics used by play (spec §2).
    if (!this.level?.solution) return null;
    const used = this.envelope.commands.filter(c => c.accepted).length;
    let idx = 0;
    for (const entry of this.level.solution) {
      if (entry.do === 'wait') continue;
      if (idx === used) {
        if (entry.do === 'place') {
          const chk = { ...entry };
          return { kind: 'place', ...chk };
        }
        if (entry.do === 'trigger') {
          const armed = this.state.tools.find(t => t.status === 'armed' && (!entry.tool || t.type === entry.tool));
          if (armed) return { kind: 'trigger', toolId: armed.id, type: armed.type, x: armed.x, y: armed.y };
          return null;
        }
      }
      idx++;
    }
    return null;
  }

  // --- timing ----------------------------------------------------------------
  // frameDt: real seconds since last call (already clamped by host).
  // Returns events produced this frame.
  advance(frameDt) {
    if (!this.state || this.paused || this.finished) return [];
    const events = [];
    this.accumulator += frameDt * this.speed;
    const maxSteps = 240; // spiral-of-death guard: drop time, never physics
    let steps = 0;
    while (this.accumulator >= DT && steps < maxSteps) {
      this._capturePrev();
      const evs = recordStep(this.state, this.envelope);
      for (const e of evs) events.push(e);
      this.accumulator -= DT;
      steps++;
      if (this.state.phase === 'terminal') break;
    }
    if (steps === maxSteps) this.accumulator = 0;
    this.interpAlpha = this.accumulator / DT;
    for (const e of events) this.onEvent(e);
    if (this.state.phase === 'terminal' && !this.finished) this._finish();
    return events;
  }

  setPaused(p) {
    this.paused = p;
    if (!p) this._capturePrev();
  }

  _capturePrev() {
    const ps = this.state.world.particles;
    if (!this.prevPositions || this.prevPositions.length !== ps.length) {
      this.prevPositions = new Float32Array(ps.length * 2);
    }
    for (let i = 0; i < ps.length; i++) {
      this.prevPositions[i * 2] = ps[i].px;
      this.prevPositions[i * 2 + 1] = ps[i].py;
    }
  }

  // interpolated positions for rendering (alpha in [0,1))
  renderPositions(out) {
    const ps = this.state.world.particles;
    const a = this.interpAlpha;
    for (let i = 0; i < ps.length; i++) {
      out[i * 2] = this.prevPositions[i * 2] + (ps[i].x - this.prevPositions[i * 2]) * a;
      out[i * 2 + 1] = this.prevPositions[i * 2 + 1] + (ps[i].y - this.prevPositions[i * 2 + 1]) * a;
    }
    return out;
  }

  // --- results -----------------------------------------------------------------
  _finish() {
    const score = finalScore(this.state);
    const stars = starsFor(this.level, score);
    const summary = summarize(this.state);
    this.finished = {
      levelId: this.level.id,
      mode: this.mode,
      reason: this.state.terminalReason,
      score,
      stars,
      ticks: this.state.tick,
      summary,
      envelope: this.envelope,
      sessionId: this.sessionId,
      elapsedMs: Date.now() - this.startedAt,
    };
    this._persist();
    this.onEvent({ t: 'results', results: this.finished });
  }

  _persist() {
    const r = this.finished;
    const prog = loadLocal('progression') || JSON.parse(JSON.stringify(DEFAULT_PROGRESSION));
    prog.totals.plays++;
    const completed = r.score.primaryComplete;
    if (completed) prog.totals.completions++;
    if (this.mode === 'journey' || this.mode === 'challenge' || this.mode === 'learn') {
      const prev = prog.stars[r.levelId] || 0;
      if (r.stars > prev) {
        prog.totalStars += r.stars - prev;
        prog.stars[r.levelId] = r.stars;
      }
      const best = prog.bestScores[r.levelId];
      if (!best || r.score.total > best.total) {
        prog.bestScores[r.levelId] = { total: r.score.total, components: r.score.components, ticks: r.ticks };
      }
      if (completed) prog.xp += 50 + r.stars * 25 + Math.floor(r.score.total / 100);
      else prog.xp += 10;
      prog.journey.furthest = nextJourneyId(r.levelId) || prog.journey.furthest;
    }
    // achievements (idempotent)
    const achDoc = loadLocal('achievements') || emptyAchievementDoc();
    if (completed) achDoc.completionsTotal++;
    for (const t of this.envelope.commands.filter(c => c.accepted && c.type === 'place')) {
      if (!achDoc.seenTools.includes(t.tool)) achDoc.seenTools.push(t.tool);
    }
    let fresh = [];
    if (this.mode === 'daily' && completed) {
      const day = this.level.daily?.day;
      if (day && !achDoc.dailyDays.includes(day)) achDoc.dailyDays.push(day);
    }
    fresh = evaluateAchievements(achDoc, achievementContext(prog, achDoc));
    saveLocal('achievements', achDoc);
    saveLocal('progression', prog);
    r.newAchievements = fresh.map(k => ACHIEVEMENTS.find(a => a.key === k)).filter(Boolean);
    r.progression = prog;
    // telemetry (anonymous funnel: round end)
    this.platform?.telemetry('round-end', {
      level: r.levelId, mode: r.mode, reason: r.reason, score: r.score.total, stars: r.stars,
    });
    // leaderboard submission (validated server-side when hosted)
    if ((this.mode === 'daily' || this.mode === 'journey' || this.mode === 'challenge') && r.score.primaryComplete) {
      this.platform?.submitScore({
        board: this.mode === 'daily' ? `daily-${this.level.daily?.day}` : 'global',
        levelId: r.levelId,
        score: r.score.total,
        components: r.score.components,
        ticks: r.ticks,
        ruleset: RULES_VERSION,
        contentVersion: this.level.version,
        seed: this.state.seed,
        assists: { undo: false, timingAssist: false },
        durationMs: r.elapsedMs,
        envelope: this.envelope,
      });
    }
  }

  get legal() {
    return this.state ? legalActions(this.state, { history: this.undoStack.length }) : null;
  }

  get summary() {
    return this.state ? summarize(this.state) : null;
  }

  get dummyCenter() {
    return this.state ? dummyCenter(this.state) : { x: 0, y: 0 };
  }
}

function nextJourneyId(id) {
  const m = /^j(\d+)$/.exec(id);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n < 40 ? `j${String(n + 1).padStart(2, '0')}` : null;
}
