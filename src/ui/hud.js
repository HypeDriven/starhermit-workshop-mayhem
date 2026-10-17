// Play HUD: objective card, live score, tool tray, context actions, tutorial
// card, trigger chips projected onto world targets (single shared layout
// model: DOM labels align with projected Three.js targets, spec §3).
import { objectiveText, goalProgressLabel } from './a11y.js';
import { t, applyDom, levelName, levelIntro, stepText, toolName, toolShort, invalidText } from './i18n.js';

const translate = t; // `t` is shadowed by trigger loops below
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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
      <section class="hud-top" aria-label="${t('roundStatus')}" data-i18n-aria="roundStatus">
        <div class="objective-card card" id="objective-card"></div>
        <div class="status-card card">
          <div class="status-score"><span id="hud-score">0</span><label data-i18n="hudScore">${t('hudScore')}</label></div>
          <div class="status-time"><span id="hud-time">0:00</span><label data-i18n="hudTime">${t('hudTime')}</label></div>
          <div class="status-stars" id="hud-stars" aria-label="${t('starTargets')}" data-i18n-aria="starTargets"></div>
          <button class="icon-btn" id="btn-pause" aria-label="${t('pause')}" data-i18n-aria="pause">⏸</button>
        </div>
      </section>
      <div class="tutorial-card card hidden" id="tutorial-card" role="status"></div>
      <div class="hud-bottom">
        <div class="tool-tray card" id="tool-tray" role="toolbar" aria-label="${t('toolTray')}" data-i18n-aria="toolTray"></div>
        <div class="context-actions" id="context-actions">
          <button class="action-btn primary hidden" id="btn-trigger">${t('trigger')} <kbd>Space</kbd></button>
          <button class="action-btn hidden" id="btn-skip"><span data-i18n="settle">${t('settle')}</span> <kbd>S</kbd></button>
          <button class="action-btn hidden" id="btn-undo"><span data-i18n="undo">${t('undo')}</span> <kbd>U</kbd></button>
          <button class="action-btn" id="btn-hint"><span data-i18n="hint">${t('hint')}</span> <kbd>H</kbd></button>
          <button class="action-btn" id="btn-restart"><span data-i18n="restart">${t('restart')}</span> <kbd>R</kbd></button>
        </div>
      </div>
      <div class="trigger-chips" id="trigger-chips" aria-hidden="true"></div>
      <div class="toast-stack" id="toast-stack" aria-hidden="true"></div>
      <div class="countdown hidden" id="countdown" aria-hidden="true"></div>`;
    // the tutorial card is placed below the objective/status row, whose
    // height depends on wrapping: publish it as a CSS variable
    {
      const top = this.root.querySelector('.hud-top');
      const sync = () => {
        if (!top) return;
        const base = this.root.getBoundingClientRect().top;
        let bottom = top.getBoundingClientRect().bottom;
        for (const c of top.children) bottom = Math.max(bottom, c.getBoundingClientRect().bottom); // cards may overflow the row
        this.root.style.setProperty('--hud-top-h', `${Math.round((bottom - base) / (window.UIScale?.value || 1))}px`); // layout px inside the zoomed HUD
      };
      if (top && typeof ResizeObserver === 'function') { const ro = new ResizeObserver(sync); ro.observe(top); for (const c of top.children) ro.observe(c); }
      window.addEventListener('resize', sync);
      sync();
    }
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
    this.lastArmed = -1;
  }

  buildLevel(level, mode) {
    this.level = level;
    this.mode = mode;
    this.renderObjective();
    this.buildTray(level);
    this.$('#tutorial-card').classList.toggle('hidden', !level.tutorial);
    this.chips.forEach(c => c.remove());
    this.chips.clear();
    this.lastScore = -1;
    this.lastTime = -1;
    this.lastArmed = -1;
  }

  renderObjective() {
    const level = this.level;
    if (!level) return;
    const { main, bonus } = objectiveText(level);
    const intro = levelIntro(level);
    this.$('#objective-card').innerHTML = `
      <h2>${esc(levelName(level))}</h2>
      <p class="objective-main">🎯 ${esc(main)}</p>
      ${bonus.map(b => `<p class="objective-bonus">✦ ${esc(b)}</p>`).join('')}
      <div class="goal-progress" id="goal-progress"></div>
      ${intro && this.mode !== 'journey' ? `<p class="objective-intro">${esc(intro)}</p>` : ''}`;
    const par = level.par;
    this.$('#hud-stars').innerHTML = par
      ? `<span title="${esc(t('star2'))}">★★ ${par.score}</span><span title="${esc(t('star3'))}">★★★ ${par.star3}</span>` : '';
  }

  // Language change mid-round: relabel everything in place (stock, selection,
  // chips and the tutorial position are kept).
  relocalize(tutorialIndex) {
    applyDom(this.root);
    if (!this.level) return;
    this.renderObjective();
    for (const [tool, btn] of this.trayButtons ?? []) {
      btn.querySelector('.tool-name').textContent = toolShort(tool);
      btn.dataset.label = toolName(tool);
    }
    this.lastArmed = -1;
    this.lastScore = -1;
    for (const [, chip] of this.chips) chip.setAttribute('aria-label', t('triggerTool', { tool: toolName(chip.dataset.type) }));
    if (this.level.tutorial && tutorialIndex != null) this.tutorialStep(this.level, tutorialIndex);
    if (this.countdownValue != null) this.countdown(this.countdownValue);
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
      btn.dataset.label = toolName(tool);
      btn.innerHTML = `
        <span class="tool-icon">${TOOL_ICONS[tool]}</span>
        <span class="tool-name">${esc(toolShort(tool))}</span>
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
      const label = n > 0 ? t('toolAvailable', { tool: btn.dataset.label, n }) : t('toolOut', { tool: btn.dataset.label });
      if (btn.getAttribute('aria-label') !== label) btn.setAttribute('aria-label', label);
      btn.classList.toggle('depleted', n <= 0);
      btn.classList.toggle('selected', input.selectedTool === tool);
      btn.setAttribute('aria-pressed', input.selectedTool === tool ? 'true' : 'false');
    }
    // context actions
    const legal = session.legal;
    this.$('#btn-trigger').classList.toggle('hidden', !(legal?.triggers.length > 0));
    // relabel only when the armed count changes (this runs every frame)
    const armedCount = legal?.triggers.length ?? 0;
    if (armedCount !== this.lastArmed) {
      this.lastArmed = armedCount;
      const btn = this.$('#btn-trigger');
      btn.textContent = `${armedCount > 1 ? t('triggerArmed', { n: armedCount }) : t('trigger')} `;
      btn.appendChild(kbdEl('Space'));
    }
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
          chip.dataset.type = t.type;
          chip.setAttribute('aria-label', translate('triggerTool', { tool: toolName(t.type) }));
          chip.addEventListener('click', () => this.onAction('trigger-tool', t.toolId));
          chipsEl.appendChild(chip);
          this.chips.set(t.toolId, chip);
        }
        const scr = input.scene.worldToScreen(t.x, t.y + 0.55, 0);
        const z = window.UIScale?.value || 1; // scr is visual px; the HUD is zoomed by --ui-scale
        // keep the 44px chip on screen even when its tool sits at the viewport edge
        const cx = Math.max(0, Math.min(window.innerWidth / z - 44, scr.x / z - 22));
        const cy = Math.max(0, Math.min(window.innerHeight / z - 44, scr.y / z - 22));
        chip.style.transform = `translate(${cx}px, ${cy}px)`;
        chip.style.display = scr.behind ? 'none' : 'block';
      }
    }
    for (const [id, chip] of this.chips) {
      if (!seen.has(id)) { chip.remove(); this.chips.delete(id); }
    }
  }

  showInvalid(reason) {
    const text = invalidText(reason);
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
      card.innerHTML = `<strong>${esc(t('lessonComplete'))}</strong> ${esc(t('lessonFinish'))}`;
      return;
    }
    card.innerHTML = `
      <div class="tutorial-text">${esc(stepText(level, index))}</div>
      <div class="tutorial-dots">${steps.map((_, i) => `<span class="dot ${i < index ? 'done' : i === index ? 'now' : ''}"></span>`).join('')}</div>`;
  }

  countdown(n) {
    const el = this.$('#countdown');
    this.countdownValue = n;
    if (n === null) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.textContent = n > 0 ? n : t('go');
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
