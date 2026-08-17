// Screen manager + all screens/overlays (spec §3 screens). Semantic HTML,
// focus management with restoration, live announcements, responsive rails.
import { JOURNEY, CHALLENGES } from '../content/stages.js';
import { TUTORIALS } from '../content/tutorials.js';
import { THEMES, THEME_ORDER, themeUnlocked } from '../content/themes.js';
import { ACHIEVEMENTS } from '../content/achievements.js';
import { TOOLS } from '../rules/engine.js';
import { BINDING_LABELS } from './input.js';
import { objectiveText } from './a11y.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class App {
  constructor(game) {
    this.game = game;           // main.js controller
    this.screenRoot = document.getElementById('screen-root');
    this.overlayRoot = document.getElementById('overlay-root');
    this.current = null;
    this.overlay = null;
    this.lastFocus = null;
  }

  announce(text, priority) { this.game.announcer.say(text, priority); }

  show(name, params = {}) {
    this.current = name;
    this.overlayRoot.classList.add('hidden');
    this.overlay = null;
    const fn = this[`screen_${name}`];
    this.screenRoot.innerHTML = '';
    this.screenRoot.className = `screen-root screen-${name}`;
    fn.call(this, this.screenRoot, params);
    this.screenRoot.classList.remove('hidden');
    const h = this.screenRoot.querySelector('h1, h2, [autofocus], button');
    (this.screenRoot.querySelector('[autofocus]') || h)?.focus?.();
    const heading = this.screenRoot.querySelector('h1, h2');
    if (heading) this.announce(heading.textContent);
  }

  showOverlay(name, params = {}) {
    this.lastFocus = document.activeElement;
    this.overlay = name;
    const fn = this[`overlay_${name}`];
    this.overlayRoot.innerHTML = '';
    this.overlayRoot.className = `overlay-root overlay-${name}`;
    fn.call(this, this.overlayRoot, params);
    this.overlayRoot.classList.remove('hidden');
    const first = this.overlayRoot.querySelector('button');
    first?.focus();
  }

  closeOverlay() {
    this.overlayRoot.classList.add('hidden');
    this.overlayRoot.innerHTML = '';
    this.overlay = null;
    this.lastFocus?.focus?.();
  }

  // ============================ SCREENS =====================================

  screen_loading(root, { progress = 0, groups = [] }) {
    root.innerHTML = `
      <div class="loading-wrap">
        <div class="logo-badge">🔧</div>
        <h1>Workshop Mayhem</h1>
        <div class="load-bar" role="progressbar" aria-valuenow="${Math.round(progress * 100)}" aria-valuemin="0" aria-valuemax="100">
          <div style="width:${progress * 100}%"></div>
        </div>
        <ul class="load-groups">${groups.map(g => `<li class="${g.done ? 'done' : ''}">${g.label}</li>`).join('')}</ul>
      </div>`;
  }

  screen_title(root) {
    const g = this.game;
    const prog = g.progression;
    const day = g.dailyInfo;
    root.innerHTML = `
      <div class="title-hero">
        <h1 class="game-logo"><span class="logo-gear">⚙</span> Workshop Mayhem</h1>
        <p class="tagline">Whimsical tools. One resilient dummy. Pure physics chaos.</p>
        <div class="title-actions">
          <button class="mega-btn" data-act="play" autofocus>▶ Play</button>
          <div class="title-chips">
            <button class="chip" data-act="daily">
              <strong>Daily Challenge</strong>
              <span>${day ? `Day ${day.label}` : 'One shared puzzle'}</span>
            </button>
            <button class="chip" data-act="journey">
              <strong>Journey</strong>
              <span>${prog.totalStars}★ · stage ${prog.journey?.furthest ?? 'j01'}</span>
            </button>
            <button class="chip" data-act="profile">
              <strong>${esc(g.profile.displayName)}</strong>
              <span>${g.profile.guest ? 'Guest — tap to save progress' : 'Profile'}</span>
            </button>
          </div>
        </div>
        <nav class="title-links" aria-label="More">
          <button data-act="learn">Learn</button>
          <button data-act="practice">Practice</button>
          <button data-act="challenge">Challenge</button>
          <button data-act="boards">Leaderboards</button>
          <button data-act="achievements">Achievements</button>
          <button data-act="cosmetics">Workshop&nbsp;&amp;&nbsp;Style</button>
          <button data-act="help">Help</button>
          <button data-act="settings">Settings</button>
        </nav>
      </div>`;
    root.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      g.audio.event({ t: 'ui-click' });
      g.route(act);
    });
  }

  screen_profile(root) {
    const g = this.game;
    root.innerHTML = `
      <div class="panel narrow">
        <h1>Profile</h1>
        <div class="profile-card card">
          <div class="avatar" aria-hidden="true">${g.profile.guest ? '🧰' : '🧑‍🔧'}</div>
          <div>
            <h2>${esc(g.profile.displayName)}</h2>
            <p>${g.profile.guest ? 'Playing as a guest. Progress lives on this device.' : 'Signed in — progress syncs to your account.'}</p>
          </div>
        </div>
        ${g.profile.guest ? `
          <form id="name-form" class="form-row">
            <label for="display-name">Display name</label>
            <input id="display-name" maxlength="24" value="${esc(g.profile.displayName)}" />
            <button class="action-btn" type="submit">Save</button>
          </form>
          <p class="muted">Account sign-in arrives with the hosted release; local guests keep full progress, boards and cosmetics.</p>
        ` : `<p class="muted">Signed in as ${esc(g.profile.name)}.</p>`}
        <fieldset class="form-row">
          <legend>Profile privacy</legend>
          <label><input type="radio" name="privacy" value="public" ${g.profile.privacy === 'public' ? 'checked' : ''} /> Public boards</label>
          <label><input type="radio" name="privacy" value="friends" ${g.profile.privacy === 'friends' ? 'checked' : ''} /> Friends only</label>
          <label><input type="radio" name="privacy" value="hidden" ${g.profile.privacy === 'hidden' ? 'checked' : ''} /> Hidden</label>
        </fieldset>
        <div class="row"><button class="action-btn" data-act="back">← Back</button></div>
      </div>`;
    $('#name-form', root)?.addEventListener('submit', (e) => {
      e.preventDefault();
      g.setDisplayName($('#display-name', root).value.trim() || 'Guest Inventor');
      this.announce('Display name saved');
    });
    root.addEventListener('change', (e) => {
      if (e.target.name === 'privacy') g.setPrivacy(e.target.value);
    });
    $('[data-act="back"]', root).addEventListener('click', () => g.route('title'));
  }

  screen_modes(root) {
    const cards = [
      ['journey', '🗺️', 'Journey', '48 authored stages across six chapters. Earn stars, unlock mastery stages.'],
      ['daily', '📅', 'Daily Challenge', 'One shared seed for everyone today. Compare scores on the daily board.'],
      ['learn', '🎓', 'Learn', 'Five hands-on lessons. One rule at a time — you do the doing.'],
      ['practice', '🧪', 'Practice', 'Any stage, your rules: undo, restarts, no pressure, unranked.'],
      ['challenge', '⏱️', 'Challenge', 'Constrained goals: move limits, speed targets, restricted tools.'],
      ['boards', '🏆', 'Score Chase', 'Global and friends boards for every stage. Chase the crown.'],
    ];
    root.innerHTML = `
      <div class="panel">
        <h1>Choose a mode</h1>
        <div class="mode-grid">
          ${cards.map(([id, icon, name, desc]) => `
            <button class="mode-card card" data-act="${id}">
              <span class="mode-icon">${icon}</span>
              <strong>${name}</strong>
              <span>${desc}</span>
            </button>`).join('')}
        </div>
        <div class="row"><button class="action-btn" data-act="back">← Back</button></div>
      </div>`;
    root.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      if (act === 'back') this.game.route('title');
      else this.game.route(act);
    });
  }

  screen_journey(root) {
    const g = this.game;
    const prog = g.progression;
    const chapters = new Map();
    for (const lv of JOURNEY) {
      if (!chapters.has(lv.chapter)) chapters.set(lv.chapter, []);
      chapters.get(lv.chapter).push(lv);
    }
    const chapterNames = {
      1: 'First Sparks', 2: 'Moving Air', 3: 'Heavy Metal',
      4: 'Attractive Forces', 5: 'Grand Mayhem', 6: 'Inventor’s Gauntlet',
    };
    let unlocked = true; // first stage unlocked; each stage unlocks the next
    root.innerHTML = `
      <div class="panel wide">
        <h1>Journey</h1>
        <p class="muted">${prog.totalStars} stars earned · ${Object.values(prog.stars).filter(s => s > 0).length}/${JOURNEY.length} stages complete</p>
        <div class="journey-map">
          ${[...chapters.entries()].map(([ch, levels]) => `
            <section class="chapter">
              <h2>Chapter ${ch}: ${chapterNames[ch]}</h2>
              <div class="stage-row">
                ${levels.map((lv) => {
                  const stars = prog.stars[lv.id] || 0;
                  const open = unlocked;
                  if ((prog.stars[lv.id] || 0) === 0) unlocked = false;
                  return `<button class="stage-node ${stars ? 'done' : ''} ${open ? '' : 'locked'}"
                      data-level="${lv.id}" ${open ? '' : 'disabled'}
                      aria-label="${esc(lv.name)}, ${stars} stars${open ? '' : ', locked'}">
                    <span class="stage-id">${lv.id.replace('j', '')}</span>
                    <span class="stage-stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>
                    <span class="stage-name">${/mastery/i.test(lv.name) ? '👑 ' : ''}${esc(lv.name)}</span>
                  </button>`;
                }).join('')}
              </div>
            </section>`).join('')}
        </div>
        <div class="row"><button class="action-btn" data-act="back">← Back</button></div>
      </div>`;
    root.addEventListener('click', (e) => {
      const id = e.target.closest('[data-level]')?.dataset.level;
      if (id) g.startStage(id, 'journey');
      else if (e.target.closest('[data-act]')) g.route('title');
    });
  }

  screen_learn(root) {
    const g = this.game;
    root.innerHTML = `
      <div class="panel">
        <h1>Learn the tools</h1>
        <p class="muted">Short interactive lessons. Each introduces exactly one idea — and you perform it.</p>
        <div class="mode-grid">
          ${TUTORIALS.map((t, i) => `
            <button class="mode-card card" data-level="${t.id}">
              <span class="mode-icon">${['🥊', '🚀', '🌀', '🏋️', '🧲'][i]}</span>
              <strong>${t.name.replace('Lesson: ', '')}</strong>
              <span>${t.intro}</span>
              ${g.settings.tutorialDone.includes(t.id) ? '<em>✓ completed</em>' : ''}
            </button>`).join('')}
        </div>
        <div class="row"><button class="action-btn" data-act="back">← Back</button></div>
      </div>`;
    root.addEventListener('click', (e) => {
      const id = e.target.closest('[data-level]')?.dataset.level;
      if (id) g.startStage(id, 'learn');
      else if (e.target.closest('[data-act]')) g.route('title');
    });
  }

  screen_practice(root) {
    const g = this.game;
    const options = [...JOURNEY].map(l => `<option value="${l.id}">${l.id} — ${l.name}</option>`).join('');
    root.innerHTML = `
      <div class="panel narrow">
        <h1>Practice</h1>
        <div class="card setup-card">
          <div class="form-row">
            <label for="practice-level">Stage</label>
            <select id="practice-level">${options}</select>
          </div>
          <fieldset class="form-row">
            <legend>Difficulty</legend>
            <label><input type="radio" name="diff" value="easy" /> Easy — extra tool stock</label>
            <label><input type="radio" name="diff" value="normal" checked /> Normal — as authored</label>
            <label><input type="radio" name="diff" value="hard" /> Hard — one less of each tool</label>
          </fieldset>
          <label class="form-row"><input type="checkbox" id="practice-undo" ${g.settings.rules.undoInPractice ? 'checked' : ''} /> Allow undo (practice always unranked)</label>
          <p class="muted">Practice never affects ratings or boards. Restarts and undos are free.</p>
          <button class="mega-btn" data-act="start">Start practicing</button>
        </div>
        <div class="row"><button class="action-btn" data-act="back">← Back</button></div>
      </div>`;
    root.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'start') {
        g.startPractice({
          levelId: $('#practice-level', root).value,
          difficulty: root.querySelector('[name=diff]:checked').value,
          undo: $('#practice-undo', root).checked,
        });
      } else if (act === 'back') g.route('title');
    });
  }

  screen_challenge(root) {
    const g = this.game;
    const constraintText = (lv) => {
      const c = lv.challenge || {};
      const bits = [];
      if (c.moveLimit) bits.push(`${c.moveLimit} move${c.moveLimit > 1 ? 's' : ''} max`);
      if (c.timeLimitTicks) bits.push(`${(c.timeLimitTicks / 120).toFixed(0)}s limit`);
      return bits.join(' · ') || 'Standard rules';
    };
    root.innerHTML = `
      <div class="panel">
        <h1>Challenge</h1>
        <div class="mode-grid">
          ${CHALLENGES.map(lv => `
            <button class="mode-card card" data-level="${lv.id}">
              <strong>${lv.name}</strong>
              <span>${lv.intro}</span>
              <em>${constraintText(lv)}</em>
              <span class="stage-stars">${'★'.repeat(g.progression.stars[lv.id] || 0)}${'☆'.repeat(3 - (g.progression.stars[lv.id] || 0))}</span>
            </button>`).join('')}
        </div>
        <div class="row"><button class="action-btn" data-act="back">← Back</button></div>
      </div>`;
    root.addEventListener('click', (e) => {
      const id = e.target.closest('[data-level]')?.dataset.level;
      if (id) g.startStage(id, 'challenge');
      else if (e.target.closest('[data-act]')) g.route('title');
    });
  }

  screen_daily(root) {
    const g = this.game;
    const lv = g.dailyLevel;
    const { main, bonus } = objectiveText(lv);
    root.innerHTML = `
      <div class="panel narrow">
        <h1>Daily Challenge</h1>
        <div class="card setup-card">
          <h2>${lv.name}</h2>
          <p>🎯 ${main}</p>
          ${bonus.map(b => `<p>✦ ${b}</p>`).join('')}
          <dl class="facts">
            <div><dt>Ruleset</dt><dd>v${lv.daily.ruleset}${lv.daily.excluded ? ' (excluded from ranking)' : ''}</dd></div>
            <div><dt>Seed</dt><dd>${lv.seed}</dd></div>
            <div><dt>Tools</dt><dd>${Object.entries(lv.tools).filter(([, v]) => v > 0).map(([k, v]) => `${v}× ${TOOLS[k].name}`).join(', ')}</dd></div>
            <div><dt>Expected</dt><dd>1–3 minutes</dd></div>
            <div><dt>Ranked</dt><dd>Daily board${g.platform.hosted ? '' : ' (casual locally)'}</dd></div>
          </dl>
          <button class="mega-btn" data-act="start" autofocus>Take today's shot</button>
          <button class="action-btn" data-act="board">View daily board</button>
        </div>
        <div class="row"><button class="action-btn" data-act="back">← Back</button></div>
      </div>`;
    root.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'start') g.startDaily();
      else if (act === 'board') g.route('boards', { board: `daily-${lv.daily.day}` });
      else if (act === 'back') g.route('title');
    });
  }

  screen_boards(root, { board = null } = {}) {
    const g = this.game;
    const boardId = board ?? 'global';
    root.innerHTML = `
      <div class="panel wide">
        <h1>Leaderboards</h1>
        <div class="tabs" role="tablist">
          <button role="tab" data-board="global" class="${boardId === 'global' ? 'active' : ''}">Global</button>
          <button role="tab" data-board="friends" class="${boardId === 'friends' ? 'active' : ''}">Friends</button>
          <button role="tab" data-board="daily-${g.platform.utcDay()}" class="${boardId.startsWith('daily') ? 'active' : ''}">Today</button>
        </div>
        <div id="board-body" aria-live="polite"><p class="muted">Loading…</p></div>
        <div class="row"><button class="action-btn" data-act="back">← Back</button></div>
      </div>`;
    const load = async (b) => {
      const body = $('#board-body', root);
      body.innerHTML = '<p class="muted">Loading…</p>';
      const actual = b === 'friends' ? 'global' : b;
      const r = await g.platform.fetchBoard(actual, { friends: b === 'friends' });
      if (!r.rows.length) {
        body.innerHTML = `<p class="muted">No scores yet${r.casual ? ' on this device' : ''}. Be the first!</p>`;
        return;
      }
      body.innerHTML = `
        ${r.casual ? '<p class="muted">Casual local board — hosted boards validate every score by replay.</p>' : ''}
        <table class="board-table">
          <thead><tr><th>#</th><th>Player</th><th>Level</th><th>Score</th><th>Time</th></tr></thead>
          <tbody>
            ${r.rows.slice(0, 25).map((row, i) => `
              <tr>
                <td>${i + 1}</td><td>${esc(row.name ?? 'Inventor')}</td>
                <td>${row.levelId ?? '—'}</td><td>${row.score}</td>
                <td>${Math.floor((row.ticks ?? 0) / 120)}s</td>
              </tr>`).join('')}
          </tbody>
        </table>`;
    };
    load(boardId);
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-board]')?.dataset.board;
      if (b) {
        root.querySelectorAll('[role=tab]').forEach(t => t.classList.toggle('active', t.dataset.board === b));
        load(b);
      } else if (e.target.closest('[data-act]')) g.route('title');
    });
  }

  screen_achievements(root) {
    const g = this.game;
    const doc = g.achievementsDoc;
    root.innerHTML = `
      <div class="panel">
        <h1>Achievements</h1>
        <div class="ach-list">
          ${ACHIEVEMENTS.map(a => `
            <div class="ach-card card ${doc.unlocked[a.key] ? 'unlocked' : ''}">
              <span class="ach-icon">${doc.unlocked[a.key] ? '🏅' : '🔒'}</span>
              <div><strong>${a.name}</strong><p>${a.desc}</p>
              ${doc.unlocked[a.key] ? `<em>Unlocked ${new Date(doc.unlocked[a.key]).toLocaleDateString()}</em>` : ''}</div>
            </div>`).join('')}
        </div>
        <div class="row"><button class="action-btn" data-act="back">← Back</button></div>
      </div>`;
    $('[data-act="back"]', root).addEventListener('click', () => g.route('title'));
  }

  screen_cosmetics(root) {
    const g = this.game;
    const prog = g.progression;
    root.innerHTML = `
      <div class="panel wide">
        <h1>Workshop &amp; Style</h1>
        <div class="card mastery-card">
          <h2>Mastery track</h2>
          <div class="xp-bar"><div style="width:${Math.min(100, (prog.xp % 500) / 5)}%"></div></div>
          <p>${prog.xp} XP · next flourish at ${Math.ceil((prog.xp + 1) / 500) * 500} XP</p>
          <p class="muted">Cosmetics change looks only — never hitboxes, timing, information, or power.</p>
        </div>
        <h2>Themes</h2>
        <div class="theme-grid">
          ${THEME_ORDER.map(tid => {
            const t = THEMES[tid];
            const un = themeUnlocked(t, prog);
            const active = g.settings.lastTheme === tid || prog.cosmetics.theme === tid;
            return `<button class="theme-card card ${active ? 'active' : ''} ${un ? '' : 'locked'}" data-theme="${tid}" ${un ? '' : 'disabled'}>
              <span class="theme-swatch" style="background:linear-gradient(135deg,#${t.floor.toString(16).padStart(6, '0')},#${t.accent.toString(16).padStart(6, '0')})"></span>
              <strong>${t.name}</strong>
              <span>${t.blurb}</span>
              ${un ? '' : `<em>🔒 ${t.unlock.replace('-', ' ')}</em>`}
            </button>`;
          }).join('')}
        </div>
        <div class="row"><button class="action-btn" data-act="back">← Back</button></div>
      </div>`;
    root.addEventListener('click', (e) => {
      const tid = e.target.closest('[data-theme]')?.dataset.theme;
      if (tid) {
        g.setTheme(tid);
        this.announce(`${THEMES[tid].name} applied`);
        this.show('cosmetics');
      } else if (e.target.closest('[data-act]')) g.route('title');
    });
  }

  screen_help(root) {
    const g = this.game;
    const kb = g.input.bindings.keyboard;
    const toolCards = Object.values(TOOLS).map(t => `
      <div class="rule-card card">
        <h3>${t.name}</h3>
        <p>${t.blurb}</p>
        <p class="muted">Placement: ${({ mount: 'wall mounts only', ground: 'floors and ledges', air: 'any open space' })[t.placement]}</p>
      </div>`).join('');
    root.innerHTML = `
      <div class="panel wide">
        <h1>How to play</h1>
        <div class="card rule-card">
          <h3>The loop</h3>
          <p>Choose a tool, place or trigger it, watch the physics, satisfy the goal. Ring bells fast, hold circles, topple crates, stay airborne — every stage states its goal up front.</p>
          <p>Score = goal + bonuses + spare tools + speed + style − fumbles. Ties break on completion, fewer invalid actions, then faster time.</p>
        </div>
        <div class="rule-grid">${toolCards}</div>
        <div class="card rule-card">
          <h3>Controls (current bindings)</h3>
          <ul class="bindings-list">
            ${Object.entries(kb).map(([act, code]) => `<li><strong>${BINDING_LABELS[act] ?? act}</strong>: <kbd>${code.replace('Key', '').replace('Digit', '')}</kbd></li>`).join('')}
            <li><strong>Gamepad</strong>: stick moves cursor, A places, X triggers, B cancels, Start pauses. Rebind in Settings.</li>
          </ul>
        </div>
        <div class="row"><button class="action-btn" data-act="back">← Back</button></div>
      </div>`;
    $('[data-act="back"]', root).addEventListener('click', () => g.route('title'));
  }

  screen_settings(root) {
    const g = this.game;
    const s = g.settings;
    const a = s.accessibility;
    root.innerHTML = `
      <div class="panel wide settings">
        <h1>Settings</h1>
        <div class="settings-cols">
          <section class="card">
            <h2>Audio</h2>
            ${['music', 'effects', 'ambience', 'voice'].map(bus => `
              <label class="slider-row">${bus[0].toUpperCase() + bus.slice(1)}
                <input type="range" min="0" max="1" step="0.05" value="${s.audio[bus]}" data-audio="${bus}" />
              </label>`).join('')}
            <label><input type="checkbox" data-setting="audio.muted" ${s.audio.muted ? 'checked' : ''} /> Mute all</label>
          </section>
          <section class="card">
            <h2>Graphics</h2>
            <label class="form-row">Quality tier
              <select data-setting="graphics.tier">
                ${['auto', 'low', 'medium', 'high'].map(t => `<option ${s.graphics.tier === t ? 'selected' : ''}>${t}</option>`).join('')}
              </select>
            </label>
            <p class="muted">Tiers control shadows, environment detail, particles, post effects, AA and render scale — never the rules.</p>
          </section>
          <section class="card">
            <h2>Accessibility</h2>
            ${[
              ['reducedMotion', 'Reduced motion (no shake, swoops, or particles bursts)'],
              ['highContrast', 'High contrast'],
              ['largeText', 'Larger text'],
              ['leftHanded', 'Left-handed controls'],
              ['holdToAim', 'Hold to aim (off = toggle)'],
              ['timingAssist', 'Timing assistance (wider chain windows)'],
              ['captions', 'Captions for meaningful audio'],
              ['haptics', 'Haptics'],
            ].map(([k, label]) => `
              <label><input type="checkbox" data-acc="${k}" ${a[k] ? 'checked' : ''} /> ${label}</label>`).join('')}
            <label class="form-row">Color palette
              <select data-acc-sel="colorPalette">
                ${['default', 'deuteranopia', 'tritanopia', 'highContrast'].map(p => `<option ${a.colorPalette === p ? 'selected' : ''}>${p}</option>`).join('')}
              </select>
            </label>
          </section>
          <section class="card">
            <h2>Controls</h2>
            <div id="bindings-list"></div>
            <label><input type="checkbox" data-setting="rules.undoInPractice" ${s.rules.undoInPractice ? 'checked' : ''} /> Undo in practice</label>
            <button class="action-btn" data-act="replay-tutorial">Replay tutorials</button>
          </section>
          <section class="card">
            <h2>Privacy</h2>
            <label><input type="checkbox" data-telemetry ${s.telemetryConsent ? 'checked' : ''} /> Share anonymous usage stats (start, tutorial steps, round ends, settings changes, error categories)</label>
            <p class="muted">No text, no pointer trails, no personal data. Aggregated only.</p>
          </section>
        </div>
        <div class="row"><button class="action-btn" data-act="back">← Back</button></div>
      </div>`;
    this.renderBindings($('#bindings-list', root));
    root.addEventListener('input', (e) => {
      const audioBus = e.target.dataset.audio;
      if (audioBus) g.setAudioBus(audioBus, parseFloat(e.target.value));
      const setting = e.target.dataset.setting;
      if (setting) g.setSetting(setting, e.target.type === 'checkbox' ? e.target.checked : e.target.value);
      const acc = e.target.dataset.acc;
      if (acc !== undefined && acc) g.setAccessibility(acc, e.target.checked);
      const accSel = e.target.dataset.accSel;
      if (accSel) g.setAccessibility(accSel, e.target.value);
      if (e.target.hasAttribute('data-telemetry')) g.setTelemetryConsent(e.target.checked);
    });
    root.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'back') g.route(g.returnTo ?? 'title');
      if (act === 'replay-tutorial') { g.settings.tutorialDone = []; g.saveSettings(); g.route('learn'); }
      const rebind = e.target.closest('[data-rebind]');
      if (rebind) this.captureRebind(rebind.dataset.rebind, rebind);
    });
  }

  renderBindings(el) {
    const g = this.game;
    const kb = g.input.bindings.keyboard;
    el.innerHTML = Object.entries(BINDING_LABELS).filter(([k]) => kb[k]).map(([act]) => `
      <div class="binding-row">
        <span>${BINDING_LABELS[act]}</span>
        <button class="binding-key" data-rebind="${act}">${kb[act].replace('Key', '').replace('Digit', '')}</button>
      </div>`).join('');
  }

  captureRebind(action, btn) {
    btn.textContent = 'press a key…';
    btn.classList.add('listening');
    const handler = (e) => {
      e.preventDefault();
      this.game.rebind(action, e.code);
      window.removeEventListener('keydown', handler, true);
      this.renderBindings(btn.parentElement.parentElement);
    };
    window.addEventListener('keydown', handler, true);
  }

  // ============================ OVERLAYS =====================================

  overlay_pause(root) {
    const g = this.game;
    root.innerHTML = `
      <div class="scrim"></div>
      <div class="panel narrow overlay-panel" role="dialog" aria-modal="true" aria-label="Paused">
        <h1>Paused</h1>
        <div class="pause-actions">
          <button class="mega-btn" data-act="resume" autofocus>▶ Resume</button>
          <button class="action-btn" data-act="restart-round">🔁 Restart round</button>
          <button class="action-btn" data-act="settings">⚙ Settings</button>
          <button class="action-btn" data-act="help">❓ Help</button>
          <button class="action-btn danger" data-act="leave">🚪 Leave round</button>
        </div>
        <p class="muted" id="pause-away"></p>
      </div>`;
    root.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      if (act === 'resume') g.resumeGame();
      if (act === 'restart-round') { this.closeOverlay(); g.session.restart(); g.resumeGame(); }
      if (act === 'settings') { g.returnTo = 'pause-resume'; g.route('settings'); }
      if (act === 'help') { g.returnTo = 'pause-resume'; g.route('help'); }
      if (act === 'leave') g.leaveRound();
    });
  }

  overlay_results(root, { results }) {
    const g = this.game;
    const r = results;
    const c = r.score.components;
    const won = r.score.primaryComplete;
    const rows = [
      ['🎯 Main goal', c.goal], ['✦ Bonuses', c.objectives],
      ['🧰 Spare tools', c.efficiency], ['⏱ Swiftness', c.swiftness],
      ['🤸 Style (air, flips, height)', c.style],
      ['🧯 Fumbles', c.penalty],
    ];
    root.innerHTML = `
      <div class="scrim"></div>
      <div class="panel narrow overlay-panel results-panel" role="dialog" aria-modal="true" aria-label="Round results">
        <h1>${won ? '🎉 Goal complete!' : '🔧 ' + reasonText(r.reason)}</h1>
        <div class="results-stars" aria-label="${r.stars} stars">${'★'.repeat(r.stars)}${'☆'.repeat(3 - r.stars)}</div>
        <div class="results-total">${r.score.total}<small> points</small></div>
        <table class="breakdown">
          ${rows.filter(([, v]) => v !== 0).map(([k, v]) => `<tr><td>${k}</td><td>${v > 0 ? '+' : ''}${v}</td></tr>`).join('')}
        </table>
        ${r.newAchievements?.length ? `<div class="ach-unlocks">${r.newAchievements.map(a => `<span class="ach-unlock">🏅 ${a.name}</span>`).join('')}</div>` : ''}
        <div id="results-compare" class="compare"></div>
        <div class="results-actions">
          <button class="mega-btn" data-act="next" autofocus>${won ? nextLabel(g, r) : '🔁 Retry'}</button>
          <button class="action-btn" data-act="retry">🔁 Retry</button>
          <button class="action-btn" data-act="map">🗺 Stages</button>
          <button class="action-btn" data-act="title">🏠 Title</button>
        </div>
      </div>`;
    this.loadComparison($('#results-compare', root), r);
    root.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      this.closeOverlay();
      if (act === 'retry') { g.platform.telemetry('retry', { level: r.levelId, mode: r.mode }); g.retryStage(); }
      if (act === 'next') won ? g.nextStage(r) : g.retryStage();
      if (act === 'map') g.route(r.mode === 'challenge' ? 'challenge' : 'journey');
      if (act === 'title') g.route('title');
    });
  }

  async loadComparison(el, r) {
    if (!r.score.primaryComplete) { el.innerHTML = ''; return; }
    const boardId = r.mode === 'daily' ? `daily-${this.game.dailyLevel.daily.day}` : 'global';
    const res = await this.game.platform.fetchBoard(boardId);
    if (!res.rows.length) { el.innerHTML = '<p class="muted">First score on this board!</p>'; return; }
    const better = res.rows.filter(row => row.score > r.score.total).length;
    el.innerHTML = `<p>${better === 0 ? '👑 Top of the board!' : `Beats ${res.rows.length - better} of ${res.rows.length} scores${res.casual ? ' (casual board)' : ''}.`}</p>`;
  }

  overlay_conflict(root, { local, remote, onPick }) {
    root.innerHTML = `
      <div class="scrim"></div>
      <div class="panel narrow overlay-panel" role="dialog" aria-modal="true" aria-label="Save conflict">
        <h1>Two saves found</h1>
        <p>Your local progress and cloud progress have diverged. Both are kept — pick which to continue from.</p>
        <div class="conflict-grid">
          <button class="card" data-pick="local">
            <strong>This device</strong>
            <span>${describeProg(local)}</span>
          </button>
          <button class="card" data-pick="remote">
            <strong>Cloud</strong>
            <span>${describeProg(remote)}</span>
          </button>
        </div>
      </div>`;
    root.addEventListener('click', (e) => {
      const pick = e.target.closest('[data-pick]')?.dataset.pick;
      if (pick) { this.closeOverlay(); onPick(pick); }
    });
  }
}

function describeProg(doc) {
  try {
    const d = JSON.parse(doc);
    const p = d.data ?? d;
    return `${p.totalStars ?? 0}★ · ${p.xp ?? 0} XP · ${Object.keys(p.stars ?? {}).length} stages`;
  } catch { return 'progress data'; }
}

function reasonText(reason) {
  return ({
    'out-of-actions': 'Out of tools',
    'time-limit': 'Time up',
    'move-limit': 'Move limit reached',
    'abandoned': 'Round left',
  })[reason] ?? 'Round over';
}

function nextLabel(g, r) {
  const m = /^j(\d+)$/.exec(r.levelId);
  if (m && parseInt(m[1], 10) < 40) return '▶ Next stage';
  if (r.mode === 'learn') return '▶ Next lesson';
  return '▶ Keep going';
}
