// Accessibility layer: live announcer, navigable board mirror, captions for
// meaningful audio, contrast/palette application (spec §3 accessibility).
import { t, num, toolName, reasonText } from './i18n.js';
export class Announcer {
  constructor(el) {
    this.el = el;
    this.last = '';
    this.queue = [];
    this.timer = null;
  }

  say(text, priority = 'polite') {
    if (!text || text === this.last) return;
    this.last = text;
    if (priority === 'assertive') {
      this.el.setAttribute('aria-live', 'assertive');
    }
    this.el.textContent = text;
    if (priority === 'assertive') {
      setTimeout(() => this.el.setAttribute('aria-live', 'polite'), 500);
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.last = ''; }, 4000);
  }
}

// Concise navigable model of the board (spec: announce board state, not
// decoration). Rendered as an sr-only list, refreshed on state transitions.
export class BoardMirror {
  constructor(el, captionEl) {
    this.el = el;
    this.captionEl = captionEl;
    this.lastTick = -1;
    this.lastPhase = null;
    this.captionTimeout = null;
    this.captionsEnabled = true;
  }

  // `goals` = live goal state (session.state.goals) so progress reads in the
  // player's language; falls back to the summary's own goal list.
  update(summary, force = false, goals = null) {
    if (!summary) return;
    const big = summary.phase !== this.lastPhase || force;
    const moved = summary.tick - this.lastTick > 240;
    if (!big && !moved) return;
    this.lastTick = summary.tick;
    this.lastPhase = summary.phase;
    const d = summary.dummy;
    const parts = [];
    parts.push(`<li>${t('mirror_dummy', { x: num(d.x, 1), y: num(d.y, 1) })}${t(d.moving ? 'mirror_moving' : 'mirror_rest')}${d.airborne ? t('mirror_airborne') : ''}.</li>`);
    const stocks = Object.entries(summary.stock).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${toolName(k)}`).join(', ');
    parts.push(`<li>${t('mirror_tools', { list: stocks || t('mirror_none') })}</li>`);
    const armed = summary.tools.filter(tl => tl.status === 'armed');
    if (armed.length) parts.push(`<li>${t('mirror_armed', { list: armed.map(tl => toolName(tl.type)).join(', ') })}</li>`);
    for (const g of goals ?? summary.goals) {
      const status = g.done ? t('prog_done') : (goals ? goalProgressLabel(g) || t('prog_notYet') : g.progress);
      parts.push(`<li>${t('mirror_goal', { label: t(g.primary ? 'mirror_main' : 'mirror_bonus'), text: goals ? goalText(g) : g.type, status })}</li>`);
    }
    parts.push(`<li>${t('mirror_score', { n: summary.score })}</li>`);
    if (summary.phase === 'terminal') parts.push(`<li>${t('mirror_over', { reason: reasonText(summary.terminalReason) })}</li>`);
    this.el.innerHTML = `<ul>${parts.join('')}</ul>`;
  }

  caption(text) {
    if (!this.captionsEnabled || !this.captionEl) return;
    const chip = document.createElement('span');
    chip.className = 'caption-chip';
    chip.textContent = text;
    this.captionEl.appendChild(chip);
    requestAnimationFrame(() => chip.classList.add('show'));
    setTimeout(() => {
      chip.classList.remove('show');
      setTimeout(() => chip.remove(), 400);
    }, 1400);
    while (this.captionEl.children.length > 3) this.captionEl.firstChild.remove();
  }
}

export function objectiveText(level) {
  const g = level.goals.find(g => g.primary);
  const bonus = level.goals.filter(g => !g.primary);
  const main = goalText(g);
  return { main, bonus: bonus.map(goalText) };
}

export function goalText(g) {
  switch (g.type) {
    case 'bell': return t('goal_bell', { speed: num(g.minSpeed ?? 1, 1) });
    case 'zone': return t('goal_zone');
    case 'distance': return t('goal_distance', { n: g.dist });
    case 'topple': return g.count > 1 ? t('goal_topple', { n: g.count }) : t('goal_topple1');
    case 'air': return t('goal_air', { s: num(g.ticks / 120, 1) });
    case 'speed': return t('goal_speed', { n: g.value2 });
    case 'score': return t('goal_score', { n: g.value2 });
    default: return g.type;
  }
}

export function goalProgressLabel(g) {
  switch (g.type) {
    case 'bell': return g.done ? t('prog_rung') : g.best > 0.05 ? t('prog_best', { n: num(g.best, 1) }) : '';
    case 'zone': return g.done ? t('prog_held') : g.value > 0 ? `${Math.round(100 * g.value / g.holdTicks)}%` : '';
    case 'distance': return `${num(g.value, 1)}/${g.dist} m`;
    case 'topple': return `${g.value}/${g.count}`;
    case 'air': return `${num(g.value / 120, 1)}/${num(g.ticks / 120, 1)} s`;
    case 'speed': return `${num(g.value, 1)}/${g.value2} m/s`;
    case 'score': return `${g.value}/${g.value2}`;
    default: return g.done ? t('prog_done') : '';
  }
}
