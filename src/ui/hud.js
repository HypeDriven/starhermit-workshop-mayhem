// Play HUD: objective card, live score, tool tray, context actions, tutorial
// card, trigger chips projected onto world targets (single shared layout
// model: DOM labels align with projected Three.js targets, spec §3).
import { TOOLS } from '../rules/engine.js';
import { objectiveText, goalProgressLabel, INVALID_TEXT } from './a11y.js';

const TOOL_ICONS = {
  piston: '🥊', pad: '🟢', fan: '🌀', magnet: '🧲', weight: '🏋️',
};
const TOOL_KEYS = ['1', '2', '3', '4', '5'];
const TOOL_ORDER = ['piston', 'pad', 'fan', 'magnet', 'weight'];

export class Hud {
  constructor(root, { onAction, announce }) {
    this.root = root;
    this.onAction = onAction;
    this.announce = announce;
    this.root.innerHTML = `
      <section class="hud-top" aria-label="Round status">
        <div class="objective-card card" id="objective-card"></div>
        <div class="status-card card">
          <div class="status-score"><span id="hud-score">0</span><label>score</label></div>
          <div class="status-time"><span id="hud-time">0:00</span><label>time</label></div>
          <div class="status-stars" id="hud-stars" aria-label="Star targets"></div>
          <button class="icon-btn" id="btn-pause" aria-label="Pause">⏸</button>
        </div>
      </section>
      <div class="tutorial-card card hidden" id="tutorial-card" role="status"></div>
      <div class="hud-bottom">
        <div class="tool-tray card" id="tool-tray" role="toolbar" aria-label="Tool tray"></div>
        <div class="context-actions" id="context-actions">
          <button class="action-btn primary hidden" id="btn-trigger">⚡ Trigger <kbd>Space</kbd></button>
          <button class="action-btn hidden" id="btn-skip">⏩ Settle <kbd>S</kbd></button>
          <button class="action-btn hidden" id="btn-undo">↩ Undo <kbd>U</kbd></button>
          <button class="action-btn" id="btn-hint">💡 Hint <kbd>H</kbd></button>
          <button class="action-btn" id="btn-restart">🔁 Restart <kbd>R</kbd></button>
        </div>
      </div>
      <div class="trigger-chips" id="trigger-chips" aria-hidden="true"></div>
      <div class="toast-stack" id="toast-stack" aria-hidden="true"></div>
      <div class="countdown hidden" id="countdown" aria-hidden="true"></div>`;
    this.$ = (id) => this.root.querySelector(id);
    this.$('#btn-pause').addEventListener('click', () => onAction('pause'));
    this.$('#btn-trigger').addEventListener('click', () => onAction('trigger'));
    this.$('#btn-skip').addEventListener('click', () => onAction('skip'));
    this.$('#btn-undo').addEventListener('click', () => onAction('undo'));
    this.$('#btn-hint').addEventListener('click', () => onAction('hint'));
    this.$('#btn-restart').addEventListener('click', () => onAction('restart'));
    this.chips = new Map();
    this.lastScore = -1;
    this.lastTime = -1;
  }

  buildLevel(level, mode) {
    const { main, bonus } = objectiveText(level);
    this.$('#objective-card').innerHTML = `
      <h2>${level.name}</h2>
      <p class="objective-main">🎯 ${main}</p>
      ${bonus.map(b => `<p class="objective-bonus">✦ ${b}</p>`).join('')}
      <div class="goal-progress" id="goal-progress"></div>
      ${level.intro && mode !== 'journey' ? `<p class="objective-intro">${level.intro}</p>` : ''}`;
    const par = level.par;
    this.$('#hud-stars').innerHTML = par
      ? `<span title="2-star target">★★ ${par.score}</span><span title="3-star target">★★★ ${par.star3}</span>` : '';
    this.buildTray(level);
    this.$('#tutorial-card').classList.toggle('hidden', !level.tutorial);
    this.chips.forEach(c => c.remove());
    this.chips.clear();
  }

  buildTray(level) {
    const tray = this.$('#tool-tray');
    tray.innerHTML = '';
    this.trayButtons = new Map();
    let keyIdx = 0;
    for (const tool of TOOL_ORDER) {
      const count = level.tools[tool] ?? 0;
      const btn = document.createElement('button');
      btn.className = 'tool-btn';
      btn.dataset.tool = tool;
      btn.setAttribute('aria-label', `${TOOLS[tool].name}${count ? `, ${count} available` : ', out of stock'}`);
      btn.innerHTML = `
        <span class="tool-icon">${TOOL_ICONS[tool]}</span>
        <span class="tool-name">${TOOLS[tool].name.split(' ')[0]}</span>
        <span class="tool-stock" data-stock>${count}</span>
        ${count ? `<kbd>${TOOL_KEYS[keyIdx++]}</kbd>` : ''}`;
      btn.addEventListener('click', () => this.onAction('select-tool', tool));
      tray.appendChild(btn);
      this.trayButtons.set(tool, btn);
    }
  }

  update(session, input) {
    const s = session.state;
    if (!s) return;
    // score/time (throttled to changes)
    const live = session.finished ? session.finished.score.total : session.summary.score;
    if (live !== this.lastScore) {
      this.$('#hud-score').textContent = live;
      this.lastScore = live;
    }
    const secs = Math.floor(s.tick / 120);
    if (secs !== this.lastTime) {
      this.$('#hud-time').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      this.lastTime = secs;
    }
    // goal progress
    const gp = this.$('#goal-progress');
    if (gp) {
      gp.innerHTML = s.goals.map(g => {
        const pct = g.done ? 100 : Math.round(100 * Math.min(1, progress01(g)));
        return `<div class="goal-row ${g.done ? 'done' : ''}">
          <span class="goal-kind">${g.primary ? '🎯' : '✦'}</span>
          <div class="goal-bar"><div style="width:${pct}%"></div></div>
          <span class="goal-label">${g.done ? '✓' : goalProgressLabel(g)}</span>
        </div>`;
      }).join('');
    }
    // tray stock + selection
    for (const [tool, btn] of this.trayButtons ?? []) {
      const n = s.stock[tool] ?? 0;
      btn.querySelector('[data-stock]').textContent = n;
      btn.classList.toggle('depleted', n <= 0);
      btn.classList.toggle('selected', input.selectedTool === tool);
      btn.setAttribute('aria-pressed', input.selectedTool === tool ? 'true' : 'false');
    }
    // context actions
    const legal = session.legal;
    this.$('#btn-trigger').classList.toggle('hidden', !(legal?.triggers.length > 0));
    this.$('#btn-trigger').textContent = legal?.triggers.length > 1
      ? `⚡ Trigger (${legal.triggers.length} armed) ` : '⚡ Trigger ';
    this.$('#btn-trigger').appendChild(kbdEl('Space'));
    this.$('#btn-skip').classList.toggle('hidden', !legal?.skip);
    this.$('#btn-undo').classList.toggle('hidden', !legal?.undo);
    // trigger chips at armed tool positions
    const chipsEl = this.$('#trigger-chips');
    const seen = new Set();
    if (legal && input.scene) {
      for (const t of legal.triggers) {
        seen.add(t.toolId);
        let chip = this.chips.get(t.toolId);
        if (!chip) {
          chip = document.createElement('button');
          chip.className = 'trigger-chip';
          chip.textContent = '⚡';
          chip.setAttribute('aria-label', `Trigger ${t.type}`);
          chip.addEventListener('click', () => this.onAction('trigger-tool', t.toolId));
          chipsEl.appendChild(chip);
          this.chips.set(t.toolId, chip);
        }
        const scr = input.scene.worldToScreen(t.x, t.y + 0.55, 0);
        chip.style.transform = `translate(${scr.x - 22}px, ${scr.y - 22}px)`;
        chip.style.display = scr.behind ? 'none' : 'block';
      }
    }
    for (const [id, chip] of this.chips) {
      if (!seen.has(id)) { chip.remove(); this.chips.delete(id); }
    }
  }

  showInvalid(reason) {
    const text = INVALID_TEXT[reason] ?? reason;
    this.announce?.(text, 'assertive');
    const stack = this.$('#toast-stack');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = text;
    stack.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 350); }, 2400);
    while (stack.children.length > 3) stack.firstChild.remove();
  }

  tutorialStep(level, index) {
    const card = this.$('#tutorial-card');
    const steps = level.tutorial?.steps ?? [];
    if (index >= steps.length) {
      card.innerHTML = `<strong>Lesson complete!</strong> Finish the goal to pass.`;
      return;
    }
    card.innerHTML = `
      <div class="tutorial-text">${steps[index].text}</div>
      <div class="tutorial-dots">${steps.map((_, i) => `<span class="dot ${i < index ? 'done' : i === index ? 'now' : ''}"></span>`).join('')}</div>`;
  }

  countdown(n) {
    const el = this.$('#countdown');
    if (n === null) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.textContent = n > 0 ? n : 'Go!';
  }
}

function progress01(g) {
  switch (g.type) {
    case 'bell': return g.done ? 1 : Math.min(0.99, g.best / (g.minSpeed ?? 1));
    case 'zone': return g.value / g.holdTicks;
    case 'distance': return g.value / g.dist;
    case 'topple': return g.value / g.count;
    case 'air': return g.value / g.ticks;
    case 'speed': return g.value / g.value2;
    case 'score': return g.value / g.value2;
    default: return g.done ? 1 : 0;
  }
}

function kbdEl(k) {
  const el = document.createElement('kbd');
  el.textContent = k;
  return el;
}
