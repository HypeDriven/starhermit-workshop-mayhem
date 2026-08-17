// Accessibility layer: live announcer, navigable board mirror, captions for
// meaningful audio, contrast/palette application (spec §3 accessibility).
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

  update(summary, force = false) {
    if (!summary) return;
    const big = summary.phase !== this.lastPhase || force;
    const moved = summary.tick - this.lastTick > 240;
    if (!big && !moved) return;
    this.lastTick = summary.tick;
    this.lastPhase = summary.phase;
    const d = summary.dummy;
    const parts = [];
    parts.push(`<li>Dummy at ${d.x.toFixed(1)} metres right, ${d.y.toFixed(1)} up${d.moving ? ', moving' : ', at rest'}${d.airborne ? ', airborne' : ''}.</li>`);
    const stocks = Object.entries(summary.stock).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${k}`).join(', ');
    parts.push(`<li>Tools left: ${stocks || 'none'}.</li>`);
    const armed = summary.tools.filter(t => t.status === 'armed');
    if (armed.length) parts.push(`<li>Armed: ${armed.map(t => t.type).join(', ')}.</li>`);
    for (const g of summary.goals) {
      parts.push(`<li>${g.primary ? 'Main goal' : 'Bonus'} (${g.type}): ${g.done ? 'done' : g.progress}.</li>`);
    }
    parts.push(`<li>Score: ${summary.score}.</li>`);
    if (summary.phase === 'terminal') parts.push(`<li>Round over: ${summary.terminalReason}.</li>`);
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
    case 'bell': return `Ring the bell fast enough (${(g.minSpeed ?? 1).toFixed(1)} m/s impact)`;
    case 'zone': return 'Hold the dummy inside the chalk circle';
    case 'distance': return `Send the dummy ${g.dist} metres from home`;
    case 'topple': return `Topple ${g.count} crate${g.count > 1 ? 's' : ''}`;
    case 'air': return `Keep the dummy airborne for ${(g.ticks / 120).toFixed(1)} seconds total`;
    case 'speed': return `Reach ${g.value2} m/s with the dummy`;
    case 'score': return `Score ${g.value2} points`;
    default: return g.type;
  }
}

export function goalProgressLabel(g) {
  switch (g.type) {
    case 'bell': return g.done ? 'Rung!' : g.best > 0.05 ? `best ${g.best.toFixed(1)} m/s` : '';
    case 'zone': return g.done ? 'Held!' : g.value > 0 ? `${Math.round(100 * g.value / g.holdTicks)}%` : '';
    case 'distance': return `${g.value.toFixed(1)}/${g.dist} m`;
    case 'topple': return `${g.value}/${g.count}`;
    case 'air': return `${(g.value / 120).toFixed(1)}/${(g.ticks / 120).toFixed(1)} s`;
    case 'speed': return `${g.value.toFixed(1)}/${g.value2} m/s`;
    case 'score': return `${g.value}/${g.value2}`;
    default: return g.done ? 'done' : '';
  }
}

export const INVALID_TEXT = {
  'terminal-state': 'The round is over.',
  'duplicate-command': 'Already registered — no double commits.',
  'bad-command': 'That command made no sense.',
  'out-of-stock': 'None of that tool left in the tray.',
  'out-of-bounds': 'Outside the workshop bounds.',
  'no-mount': 'Pistons need a wall mount — aim for the glowing brackets.',
  'mount-occupied': 'That mount already has a piston.',
  'not-on-ground': 'Boing Pads must snap onto a floor or ledge.',
  'overlap': 'Too close to something else — give it room.',
  'no-such-tool': 'That tool is gone.',
  'already-spent': 'Already used up.',
  'unsupported-here': 'Not allowed in this mode.',
  'no-undo': 'Nothing to undo here.',
  'nothing-to-skip': 'Everything is already settled.',
};
