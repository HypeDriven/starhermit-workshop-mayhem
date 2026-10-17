// Screen manager + all screens/overlays (spec §3 screens). Semantic HTML,
// focus management with restoration, live announcements, responsive rails.
// Every visible string comes from i18n.js; relocalize() re-renders the open
// screen/overlay in place when the language changes.
import { JOURNEY, CHALLENGES } from '../content/stages.js';
import { TUTORIALS } from '../content/tutorials.js';
import { THEMES, THEME_ORDER, themeUnlocked } from '../content/themes.js';
import { ACHIEVEMENTS } from '../content/achievements.js';
import { TOOLS } from '../rules/engine.js';
import { BINDING_LABELS, bindingText } from './input.js';
import { platformStrings } from './platform-strings.js';
import { objectiveText } from './a11y.js';
import { graphicsCardHtml, bindGraphicsCard } from './gfx-panel.js';
import {
  t, applyDom, locale, levelName, levelIntro, lessonTitle, toolName, toolBlurb,
  themeName, themeBlurb, achName, achDesc, chapterName, bindingLabel, reasonText,
} from './i18n.js';

const pt = (key, vars) => platformStrings()(key, vars);
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const syncLabel = (s) => (['offline', 'saving', 'synced', 'error'].includes(s) ? t(`sync_${s}`) : '');
const stars = (n) => `${'★'.repeat(n)}${'☆'.repeat(3 - n)}`;
const backRow = () => `<div class="row"><button class="action-btn" data-act="back">${esc(t('back'))}</button></div>`;
// stored default guest name shows in the player's language
const shownName = (p) => (p.guest && p.displayName === 'Guest Inventor' ? t('guestName') : p.displayName);

export class App {
  constructor(game) {
    this.game = game;           // main.js controller
    this.screenRoot = document.getElementById('screen-root');
    this.overlayRoot = document.getElementById('overlay-root');
    this.current = null;
    this.currentParams = {};
    this.overlay = null;
    this.lastFocus = null;
    // soft tick when hovering/focusing interactive elements (delegated)
    this.hover = (e) => {
      if (e.target.closest?.('button, select, input, a[href]')) {
        this.game.audio?.event({ t: 'ui-hover' });
      }
    };
    this.screenRoot.addEventListener('pointerover', this.hover);
    this.overlayRoot.addEventListener('pointerover', this.hover);
  }

  // Each screen/overlay delegates clicks by attaching a listener to the shared
  // root. Clearing innerHTML does not remove those listeners, so the root node
  // itself is replaced on every transition — otherwise a previous screen's
  // handler still fires for the current screen's buttons.
  freshRoot(which) {
    const old = this[which];
    const fresh = old.cloneNode(false);
    old.replaceWith(fresh);
    fresh.addEventListener('pointerover', this.hover);
    this[which] = fresh;
    return fresh;
  }

  announce(text, priority) { this.game.announcer.say(text, priority); }

  show(name, params = {}, { relocalize = false } = {}) {
    const wasHidden = this.screenRoot.classList.contains('hidden');
    const focusKey = relocalize ? focusSelector(document.activeElement, this.screenRoot) : null;
    this.current = name;
    this.currentParams = params;
    if (!relocalize) {
      this.overlayRoot.classList.add('hidden');
      this.overlay = null;
    }
    const fn = this[`screen_${name}`];
    const root = this.freshRoot('screenRoot');
    root.innerHTML = '';
    root.className = `screen-root screen-${name}`;
    fn.call(this, root, params);
    if (relocalize) {
      // a language change re-renders in place: same visibility, same focus, no announcement
      if (wasHidden) root.classList.add('hidden');
      if (focusKey) $(focusKey, root)?.focus?.();
      return;
    }
    root.classList.remove('hidden');
    const h = this.screenRoot.querySelector('h1, h2, [autofocus], button');
    (this.screenRoot.querySelector('[autofocus]') || h)?.focus?.();
    const heading = this.screenRoot.querySelector('h1, h2');
    if (heading) this.announce(heading.textContent);
  }

  showOverlay(name, params = {}) {
    this.lastFocus = document.activeElement;
    this.overlay = name;
    const fn = this[`overlay_${name}`];
    const root = this.freshRoot('overlayRoot');
    root.innerHTML = '';
    root.className = `overlay-root overlay-${name}`;
    fn.call(this, root, params);
    root.classList.remove('hidden');
    const first = this.overlayRoot.querySelector('button');
    first?.focus();
    this.game.audio?.event({ t: 'ui-modal-open' });
  }

  closeOverlay() {
    if (this.overlay) this.game.audio?.event({ t: 'ui-panel-close' });
    this.overlayRoot.classList.add('hidden');
    this.overlayRoot.innerHTML = '';
    this.overlay = null;
    this.lastFocus?.focus?.();
  }

  // Language changed: re-render the current screen and overlay in place.
  // Settings relabels instead (its shared Sound/Language/Report sections and
  // the language select the player is using must stay put).
  relocalize() {
    if (this.current === 'settings') this.relabelSettings();
    else if (this.current) this.show(this.current, this.currentParams, { relocalize: true });
    if (this.overlay === 'pause') applyDom(this.overlayRoot);
    if (this.overlay === 'results' && this.resultsCtx) this.renderResults(this.overlayRoot);
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
        <ul class="load-groups">${groups.map(g => `<li class="${g.done ? 'done' : ''}">${esc(t(g.label))}</li>`).join('')}</ul>
      </div>`;
  }

  screen_title(root) {
    const g = this.game;
    const prog = g.progression;
    const day = g.dailyInfo;
    root.innerHTML = `
      <div class="title-hero">
        <h1 class="game-logo"><span class="logo-gear">⚙</span> Workshop Mayhem</h1>
        <p class="tagline">${esc(t('tagline'))}</p>
        <div class="title-actions">
          <button class="mega-btn" data-act="play" autofocus>${esc(t('play'))}</button>
          <div class="title-chips">
            <button class="chip" data-act="daily">
              <strong>${esc(t('dailyChallenge'))}</strong>
              <span>${esc(day ? t('dailyDay', { label: day.label }) : t('dailyShared'))}</span>
            </button>
            <button class="chip" data-act="journey">
              <strong>${esc(t('journey'))}</strong>
              <span>${esc(t('journeyChip', { stars: prog.totalStars, stage: prog.journey?.furthest ?? 'j01' }))}</span>
            </button>
            <button class="chip" data-act="profile">
              <strong>${esc(shownName(g.profile))}</strong>
              <span>${esc(g.profile.guest ? t('guestChip') : t('profile'))}</span>
            </button>
          </div>
        </div>
        <nav class="title-links" aria-label="${esc(t('moreNav'))}">
          <button data-act="learn">${esc(t('learn'))}</button>
          <button data-act="practice">${esc(t('practice'))}</button>
          <button data-act="challenge">${esc(t('challenge'))}</button>
          <button data-act="boards">${esc(t('leaderboards'))}</button>
          <button data-act="achievements">${esc(t('achievements'))}</button>
          <button data-act="cosmetics">${esc(t('workshopStyle'))}</button>
          <button data-act="help">${esc(t('help'))}</button>
          <button data-act="settings">${esc(t('settings'))}</button>
          ${g.platform.canSignIn() ? `<button data-act="signin" id="btn-signin">${esc(pt('signIn'))}</button>` : ''}
          ${g.platform.hosted && g.platform.inviteLink() ? `<button data-act="invite" id="btn-invite">${esc(pt('invite'))}</button>` : ''}
        </nav>
      </div>`;
    root.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      g.audio.event({ t: 'ui-click' });
      if (act === 'signin') { g.platform.signIn(); return; }
      if (act === 'invite') { g.copyInvite(); return; }
      g.route(act);
    });
  }

  screen_profile(root) {
    const g = this.game;
    const p = g.profile;
    root.innerHTML = `
      <div class="panel narrow">
        <h1>${esc(t('profile'))}</h1>
        <div class="profile-card card">
          <div class="avatar" aria-hidden="true">${p.guest ? '🧰' : '🧑‍🔧'}</div>
          <div>
            <h2>${esc(shownName(p))}</h2>
            <p>${esc(p.guest ? t('profileGuest') : t('profileSignedIn'))}</p>
          </div>
        </div>
        ${p.guest ? `
          <form id="name-form" class="form-row">
            <label for="display-name">${esc(t('displayName'))}</label>
            <input id="display-name" maxlength="24" value="${esc(shownName(p))}" />
            <button class="action-btn" type="submit">${esc(t('save'))}</button>
          </form>
          ${g.platform.canSignIn() ? `<button class="action-btn" data-act="signin">${esc(pt('signIn'))}</button>` : ''}
          <p class="muted">${esc(t('guestNote'))}</p>
        ` : `<p class="muted">${esc(t('signedInAs', { name: p.name }))}</p>
          <p class="muted">${esc(syncLabel(g.platform.syncStatus))}</p>
          ${g.platform.hosted && g.platform.inviteLink() ? `<button class="action-btn" data-act="invite">${esc(pt('invite'))}</button>` : ''}`}
        <fieldset class="form-row">
          <legend>${esc(t('privacyLegend'))}</legend>
          ${['public', 'friends', 'hidden'].map(v => `<label><input type="radio" name="privacy" value="${v}" ${p.privacy === v ? 'checked' : ''} /> ${esc(t(`privacy_${v}`))}</label>`).join('')}
        </fieldset>
        ${backRow()}
      </div>`;
    $('#name-form', root)?.addEventListener('submit', (e) => {
      e.preventDefault();
      g.setDisplayName($('#display-name', root).value.trim() || 'Guest Inventor');
      this.announce(t('nameSaved'));
    });
    root.addEventListener('change', (e) => {
      if (e.target.name === 'privacy') g.setPrivacy(e.target.value);
    });
    $('[data-act="signin"]', root)?.addEventListener('click', () => g.platform.signIn());
    $('[data-act="invite"]', root)?.addEventListener('click', () => g.copyInvite());
    $('[data-act="back"]', root).addEventListener('click', () => g.route('title'));
  }

  screen_modes(root) {
    const cards = [
      ['journey', '🗺️', t('journey'), t('modeJourney', { n: JOURNEY.length })],
      ['daily', '📅', t('dailyChallenge'), t('modeDaily')],
      ['learn', '🎓', t('learn'), t('modeLearn')],
      ['practice', '🧪', t('practice'), t('modePractice')],
      ['challenge', '⏱️', t('challenge'), t('modeChallenge')],
      ['boards', '🏆', t('scoreChase'), t('modeBoards')],
    ];
    root.innerHTML = `
      <div class="panel">
        <h1>${esc(t('chooseMode'))}</h1>
        <div class="mode-grid">
          ${cards.map(([id, icon, name, desc]) => `
            <button class="mode-card card" data-act="${id}">
              <span class="mode-icon">${icon}</span>
              <strong>${esc(name)}</strong>
              <span>${esc(desc)}</span>
            </button>`).join('')}
        </div>
        ${backRow()}
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
    let unlocked = true; // first stage unlocked; each stage unlocks the next
    root.innerHTML = `
      <div class="panel wide">
        <h1>${esc(t('journey'))}</h1>
        <p class="muted">${esc(t('journeyStats', { stars: prog.totalStars, done: Object.values(prog.stars).filter(s => s > 0).length, total: JOURNEY.length }))}</p>
        <div class="journey-map">
          ${[...chapters.entries()].map(([ch, levels]) => `
            <section class="chapter">
              <h2>${esc(t('chapterTitle', { n: ch, name: chapterName(ch) }))}</h2>
              <div class="stage-row">
                ${levels.map((lv) => {
                  const n = prog.stars[lv.id] || 0;
                  const open = unlocked;
                  if (n === 0) unlocked = false;
                  const name = levelName(lv);
                  return `<button class="stage-node ${n ? 'done' : ''} ${open ? '' : 'locked'}"
                      data-level="${lv.id}" ${open ? '' : 'disabled'}
                      aria-label="${esc(t(open ? 'stageAria' : 'stageAriaLocked', { name, stars: n }))}">
                    <span class="stage-id">${lv.id.replace('j', '')}</span>
                    <span class="stage-stars">${stars(n)}</span>
                    <span class="stage-name">${/mastery/i.test(lv.name) ? '👑 ' : ''}${esc(name)}</span>
                  </button>`;
                }).join('')}
              </div>
            </section>`).join('')}
        </div>
        ${backRow()}
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
        <h1>${esc(t('learnTitle'))}</h1>
        <p class="muted">${esc(t('learnIntro'))}</p>
        <div class="mode-grid">
          ${TUTORIALS.map((lv, i) => `
            <button class="mode-card card" data-level="${lv.id}">
              <span class="mode-icon">${['🥊', '🚀', '🌀', '🏋️', '🧲'][i]}</span>
              <strong>${esc(lessonTitle(lv))}</strong>
              <span>${esc(levelIntro(lv))}</span>
              ${g.settings.tutorialDone.includes(lv.id) ? `<em>${esc(t('lessonDone'))}</em>` : ''}
            </button>`).join('')}
        </div>
        ${backRow()}
      </div>`;
    root.addEventListener('click', (e) => {
      const id = e.target.closest('[data-level]')?.dataset.level;
      if (id) g.startStage(id, 'learn');
      else if (e.target.closest('[data-act]')) g.route('title');
    });
  }

  screen_practice(root, params = {}) {
    const g = this.game;
    const sel = params.levelId ?? JOURNEY[0].id;
    const diff = params.difficulty ?? 'normal';
    const undo = params.undo ?? g.settings.rules.undoInPractice;
    const options = JOURNEY.map(l => `<option value="${l.id}" ${l.id === sel ? 'selected' : ''}>${l.id} — ${esc(levelName(l))}</option>`).join('');
    root.innerHTML = `
      <div class="panel narrow">
        <h1>${esc(t('practice'))}</h1>
        <div class="card setup-card">
          <div class="form-row">
            <label for="practice-level">${esc(t('stage'))}</label>
            <select id="practice-level">${options}</select>
          </div>
          <fieldset class="form-row">
            <legend>${esc(t('difficulty'))}</legend>
            ${['easy', 'normal', 'hard'].map(d => `<label><input type="radio" name="diff" value="${d}" ${d === diff ? 'checked' : ''} /> ${esc(t(`diff_${d}`))}</label>`).join('')}
          </fieldset>
          <label class="form-row"><input type="checkbox" id="practice-undo" ${undo ? 'checked' : ''} /> ${esc(t('allowUndo'))}</label>
          <p class="muted">${esc(t('practiceNote'))}</p>
          <button class="mega-btn" data-act="start">${esc(t('startPractice'))}</button>
        </div>
        ${backRow()}
      </div>`;
    // remember the choices so a language change keeps them
    root.addEventListener('change', () => {
      params.levelId = $('#practice-level', root).value;
      params.difficulty = root.querySelector('[name=diff]:checked').value;
      params.undo = $('#practice-undo', root).checked;
    });
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
      if (c.moveLimit) bits.push(c.moveLimit > 1 ? t('movesMax', { n: c.moveLimit }) : t('movesMax1'));
      if (c.timeLimitTicks) bits.push(t('timeLimit', { n: (c.timeLimitTicks / 120).toFixed(0) }));
      return bits.join(' · ') || t('standardRules');
    };
    root.innerHTML = `
      <div class="panel">
        <h1>${esc(t('challenge'))}</h1>
        <div class="mode-grid">
          ${CHALLENGES.map(lv => `
            <button class="mode-card card" data-level="${lv.id}">
              <strong>${esc(levelName(lv))}</strong>
              <span>${esc(levelIntro(lv))}</span>
              <em>${esc(constraintText(lv))}</em>
              <span class="stage-stars">${stars(g.progression.stars[lv.id] || 0)}</span>
            </button>`).join('')}
        </div>
        ${backRow()}
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
    const toolList = Object.entries(lv.tools).filter(([, v]) => v > 0).map(([k, v]) => t('toolCount', { n: v, tool: toolName(k) })).join(', ');
    root.innerHTML = `
      <div class="panel narrow">
        <h1>${esc(t('dailyChallenge'))}</h1>
        <div class="card setup-card">
          <h2>${esc(levelName(lv))}</h2>
          <p>🎯 ${esc(main)}</p>
          ${bonus.map(b => `<p>✦ ${esc(b)}</p>`).join('')}
          <dl class="facts">
            <div><dt>${esc(t('ruleset'))}</dt><dd>${esc(lv.daily.excluded ? t('rulesetExcluded', { v: lv.daily.ruleset }) : `v${lv.daily.ruleset}`)}</dd></div>
            <div><dt>${esc(t('seed'))}</dt><dd>${lv.seed}</dd></div>
            <div><dt>${esc(t('toolsLabel'))}</dt><dd>${esc(toolList)}</dd></div>
            <div><dt>${esc(t('expected'))}</dt><dd>${esc(t('expectedTime'))}</dd></div>
            <div><dt>${esc(t('ranked'))}</dt><dd>${esc(g.platform.hosted ? t('dailyBoard') : t('dailyBoardCasual'))}</dd></div>
          </dl>
          <button class="mega-btn" data-act="start" autofocus>${esc(t('takeShot'))}</button>
          <button class="action-btn" data-act="board">${esc(t('viewDailyBoard'))}</button>
        </div>
        ${backRow()}
      </div>`;
    root.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'start') g.startDaily();
      else if (act === 'board') g.route('boards', { board: `daily-${lv.daily.day}` });
      else if (act === 'back') g.route('title');
    });
  }

  screen_boards(root, params = {}) {
    const g = this.game;
    const boardId = params.board ?? 'global';
    const today = `daily-${g.platform.utcDay()}`;
    const tab = (id, key, on) => `<button role="tab" data-board="${id}" aria-selected="${on}" class="${on ? 'active' : ''}">${esc(t(key))}</button>`;
    root.innerHTML = `
      <div class="panel wide">
        <h1>${esc(t('leaderboards'))}</h1>
        <div class="tabs" role="tablist">
          ${tab('global', 'tab_global', boardId === 'global')}
          ${tab('friends', 'tab_friends', boardId === 'friends')}
          ${tab(today, 'tab_today', boardId.startsWith('daily'))}
        </div>
        <div id="board-body" aria-live="polite"><p class="muted">${esc(t('loadingText'))}</p></div>
        ${backRow()}
      </div>`;
    let loadToken = 0;
    const load = async (b) => {
      const body = $('#board-body', root);
      const token = ++loadToken;
      body.innerHTML = `<p class="muted">${esc(t('loadingText'))}</p>`;
      const actual = b === 'friends' ? 'global' : b;
      const r = await g.platform.fetchBoard(actual, { friends: b === 'friends' });
      if (token !== loadToken) return;   // a newer tab click already won
      if (!r.rows.length) {
        body.innerHTML = `<p class="muted">${esc(t(r.casual ? 'noScoresDevice' : 'noScores'))}</p>`;
        return;
      }
      body.innerHTML = `
        ${r.casual ? `<p class="muted">${esc(t('casualBoard'))}</p>` : ''}
        <table class="board-table">
          <thead><tr><th>#</th><th>${esc(t('th_player'))}</th><th>${esc(t('th_level'))}</th><th>${esc(t('th_score'))}</th><th>${esc(t('th_time'))}</th></tr></thead>
          <tbody>
            ${r.rows.slice(0, 25).map((row, i) => `
              <tr>
                <td>${i + 1}</td><td>${esc(row.name === 'You' ? t('you') : (row.name ?? t('player')))}</td>
                <td>${esc(row.levelId ?? '—')}</td><td>${row.score}</td>
                <td>${esc(t('seconds', { n: Math.floor((row.ticks ?? 0) / 120) }))}</td>
              </tr>`).join('')}
          </tbody>
        </table>`;
    };
    load(boardId);
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-board]')?.dataset.board;
      if (b) {
        g.audio.event({ t: 'ui-tab-switch' });
        params.board = b;
        root.querySelectorAll('[role=tab]').forEach(el => {
          const on = el.dataset.board === b;
          el.classList.toggle('active', on);
          el.setAttribute('aria-selected', String(on));
        });
        load(b);
      } else if (e.target.closest('[data-act]')) g.route('title');
    });
  }

  screen_achievements(root) {
    const g = this.game;
    const doc = g.achievementsDoc;
    root.innerHTML = `
      <div class="panel">
        <h1>${esc(t('achievements'))}</h1>
        <div class="ach-list">
          ${ACHIEVEMENTS.map(a => `
            <div class="ach-card card ${doc.unlocked[a.key] ? 'unlocked' : ''}">
              <span class="ach-icon">${doc.unlocked[a.key] ? '🏅' : '🔒'}</span>
              <div><strong>${esc(achName(a.key))}</strong><p>${esc(achDesc(a.key))}</p>
              ${doc.unlocked[a.key] ? `<em>${esc(t('unlockedOn', { date: new Date(doc.unlocked[a.key]).toLocaleDateString(locale()) }))}</em>` : ''}</div>
            </div>`).join('')}
        </div>
        ${backRow()}
      </div>`;
    $('[data-act="back"]', root).addEventListener('click', () => g.route('title'));
  }

  screen_cosmetics(root) {
    const g = this.game;
    const prog = g.progression;
    const unlockText = (u) => {
      const [kind, n] = u.split('-');
      return kind === 'stars' ? t('unlock_stars', { n }) : t('unlock_chapter', { n });
    };
    root.innerHTML = `
      <div class="panel wide">
        <h1>${esc(t('workshopStyle'))}</h1>
        <div class="card mastery-card">
          <h2>${esc(t('masteryTrack'))}</h2>
          <div class="xp-bar"><div style="width:${Math.min(100, (prog.xp % 500) / 5)}%"></div></div>
          <p>${esc(t('xpLine', { xp: prog.xp, next: Math.ceil((prog.xp + 1) / 500) * 500 }))}</p>
          <p class="muted">${esc(t('cosmeticsNote'))}</p>
        </div>
        <h2>${esc(t('themes'))}</h2>
        <div class="theme-grid">
          ${THEME_ORDER.map(tid => {
            const th = THEMES[tid];
            const un = themeUnlocked(th, prog);
            const active = g.settings.lastTheme === tid || prog.cosmetics.theme === tid;
            return `<button class="theme-card card ${active ? 'active' : ''} ${un ? '' : 'locked'}" data-theme="${tid}" ${un ? '' : 'disabled'}>
              <span class="theme-swatch" style="background:linear-gradient(135deg,#${th.floor.toString(16).padStart(6, '0')},#${th.accent.toString(16).padStart(6, '0')})"></span>
              <strong>${esc(themeName(tid))}</strong>
              <span>${esc(themeBlurb(tid))}</span>
              ${un ? '' : `<em>${esc(unlockText(th.unlock))}</em>`}
            </button>`;
          }).join('')}
        </div>
        ${backRow()}
      </div>`;
    root.addEventListener('click', (e) => {
      const tid = e.target.closest('[data-theme]')?.dataset.theme;
      if (tid) {
        g.setTheme(tid);
        this.announce(t('themeApplied', { name: themeName(tid) }));
        this.show('cosmetics');
      } else if (e.target.closest('[data-act]')) g.route('title');
    });
  }

  screen_help(root) {
    const g = this.game;
    const kb = g.input.bindings.keyboard;
    const toolCards = Object.values(TOOLS).map(tool => `
      <div class="rule-card card">
        <h3>${esc(toolName(tool.key))}</h3>
        <p>${esc(toolBlurb(tool.key))}</p>
        <p class="muted">${esc(t('placement', { where: t(`place_${tool.placement}`) }))}</p>
      </div>`).join('');
    root.innerHTML = `
      <div class="panel wide">
        <h1>${esc(t('howToPlay'))}</h1>
        <div class="card rule-card">
          <h3>${esc(t('theLoop'))}</h3>
          <p>${esc(t('loopBody'))}</p>
          <p>${esc(t('scoreBody'))}</p>
        </div>
        <div class="rule-grid">${toolCards}</div>
        <div class="card rule-card">
          <h3>${esc(t('controlsCurrent'))}</h3>
          <ul class="bindings-list">
            ${Object.entries(kb).map(([act, code]) => `<li><strong>${esc(bindingLabel(act))}</strong>: <kbd>${esc(bindingText(code))}</kbd></li>`).join('')}
            <li><strong>${esc(t('gamepad'))}</strong>: ${esc(t('gamepadHelp'))}</li>
          </ul>
        </div>
        ${backRow()}
      </div>`;
    $('[data-act="back"]', root).addEventListener('click', () => g.route('title'));
  }

  screen_settings(root) {
    const g = this.game;
    const s = g.settings;
    const a = s.accessibility;
    const L = (key) => `<span data-i18n="${key}">${esc(t(key))}</span>`;
    root.innerHTML = `
      <div class="panel wide settings">
        <h1 data-i18n="settings">${esc(t('settings'))}</h1>
        <div class="settings-cols">
          <section class="card">
            <h2 data-i18n="audio">${esc(t('audio'))}</h2>
            ${['music', 'effects', 'ambience', 'voice'].map(bus => `
              <label class="slider-row">${L(`bus_${bus}`)}
                <input type="range" min="0" max="1" step="0.05" value="${s.audio[bus]}" data-audio="${bus}" />
              </label>`).join('')}
            <label><input type="checkbox" data-setting="audio.muted" ${s.audio.muted ? 'checked' : ''} /> ${L('muteAll')}</label>
          </section>
          <section class="card gfx-card" id="gfx-card" data-section="graphics" data-options-graphics>
            <div id="gfx-own">${graphicsCardHtml(s.graphics, g.scene.graphicsInfo())}</div>
          </section>
          <section class="card">
            <h2 data-i18n="accessibility">${esc(t('accessibility'))}</h2>
            ${['reducedMotion', 'highContrast', 'largeText', 'leftHanded', 'holdToAim', 'timingAssist', 'captions', 'haptics'].map(k => `
              <label><input type="checkbox" data-acc="${k}" ${a[k] ? 'checked' : ''} /> ${L(`acc_${k}`)}</label>`).join('')}
            <label class="form-row">${L('colorPalette')}
              <select data-acc-sel="colorPalette">
                ${['default', 'deuteranopia', 'tritanopia', 'highContrast'].map(p => `<option value="${p}" data-i18n="pal_${p}" ${a.colorPalette === p ? 'selected' : ''}>${esc(t(`pal_${p}`))}</option>`).join('')}
              </select>
            </label>
          </section>
          <section class="card">
            <h2 data-i18n="controls">${esc(t('controls'))}</h2>
            <div id="bindings-list"></div>
            <label><input type="checkbox" data-setting="rules.undoInPractice" ${s.rules.undoInPractice ? 'checked' : ''} /> ${L('undoInPractice')}</label>
            <button class="action-btn" data-act="replay-tutorial" data-i18n="replayTutorials">${esc(t('replayTutorials'))}</button>
          </section>
          <section class="card">
            <h2 data-i18n="privacy">${esc(t('privacy'))}</h2>
            <label><input type="checkbox" data-telemetry ${s.telemetryConsent ? 'checked' : ''} /> ${L('telemetry')}</label>
            <p class="muted" data-i18n="telemetryNote">${esc(t('telemetryNote'))}</p>
          </section>
        </div>
        <div class="row"><button class="action-btn" data-act="back" data-i18n="back">${esc(t('back'))}</button></div>
      </div>`;
    this.renderBindings($('#bindings-list', root));
    bindGraphicsCard($('#gfx-own', root), {
      getSaved: () => g.settings.graphics,
      apply: (next) => g.setGraphics(next),
      getInfo: () => g.scene.graphicsInfo(),
    });
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
      if (e.target.type === 'checkbox') g.audio.event({ t: 'ui-toggle' });
    });
    root.addEventListener('change', (e) => {
      if (e.target.type === 'range') g.audio.event({ t: 'ui-slider-drag' });
    });
    root.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'back') g.route(g.returnTo ?? 'title');
      if (act === 'replay-tutorial') { g.settings.tutorialDone = []; g.saveSettings(); g.route('learn'); }
      const rebind = e.target.closest('[data-rebind]');
      if (rebind) this.captureRebind(rebind.dataset.rebind, rebind);
    });
  }

  // Settings stays mounted on a language change: only the game's own labels,
  // the Graphics box and the bindings list are rewritten.
  relabelSettings() {
    const root = this.screenRoot;
    applyDom(root);
    $('#gfx-own', root)?.relabel?.();
    const list = $('#bindings-list', root);
    if (list && !this.cancelRebind) this.renderBindings(list);
  }

  renderBindings(el) {
    const g = this.game;
    const kb = g.input.bindings.keyboard;
    el.innerHTML = Object.keys(BINDING_LABELS).filter((k) => kb[k]).map((act) => `
      <div class="binding-row">
        <span>${esc(bindingLabel(act))}</span>
        <button class="binding-key" data-rebind="${act}">${esc(bindingText(kb[act]))}</button>
      </div>`).join('');
  }

  captureRebind(action, btn) {
    const list = btn.parentElement.parentElement;
    if (this.cancelRebind) this.cancelRebind();   // only one capture at a time
    btn.textContent = t('pressKey');
    btn.classList.add('listening');
    const stop = () => {
      window.removeEventListener('keydown', handler, true);
      window.removeEventListener('pointerdown', cancel, true);
      this.cancelRebind = null;
    };
    const cancel = () => { stop(); this.renderBindings(list); };
    const handler = (e) => {
      e.preventDefault();
      stop();
      if (e.code !== 'Escape') this.game.rebind(action, e.code);  // Escape cancels
      this.renderBindings(list);
    };
    this.cancelRebind = cancel;
    window.addEventListener('keydown', handler, true);
    window.addEventListener('pointerdown', cancel, true);
  }

  // ============================ OVERLAYS =====================================

  overlay_pause(root) {
    const g = this.game;
    const btn = (cls, act, key, extra = '') => `<button class="${cls}" data-act="${act}" data-i18n="${key}"${extra}>${esc(t(key))}</button>`;
    root.innerHTML = `
      <div class="scrim"></div>
      <div class="panel narrow overlay-panel" role="dialog" aria-modal="true" aria-label="${esc(t('paused'))}" data-i18n-aria="paused">
        <h1 data-i18n="paused">${esc(t('paused'))}</h1>
        <div class="pause-actions">
          ${btn('mega-btn', 'resume', 'resume', ' autofocus')}
          ${btn('action-btn', 'restart-round', 'restartRound')}
          ${btn('action-btn', 'settings', 'settingsBtn')}
          ${btn('action-btn', 'help', 'helpBtn')}
          ${btn('action-btn danger', 'leave', 'leaveRound')}
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
    const won = r.score.primaryComplete;
    // lb / cmp hold the leaderboard + comparison lines as {key, vars} so a
    // language change repaints them without posting or fetching again
    this.resultsCtx = { results: r, lb: null, cmp: null };
    this.renderResults(root);
    this.postToLeaderboard(r);
    root.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      this.closeOverlay();
      this.resultsCtx = null;
      if (act === 'retry') { g.platform.telemetry('retry', { level: r.levelId, mode: r.mode }); g.retryStage(); }
      if (act === 'next') won ? g.nextStage(r) : g.retryStage();
      if (act === 'map') g.route(r.mode === 'challenge' ? 'challenge' : 'journey');
      if (act === 'title') g.route('title');
    });
  }

  renderResults(root) {
    const ctx = this.resultsCtx;
    if (!ctx) return;
    const focusKey = focusSelector(document.activeElement, root);
    const r = ctx.results;
    const c = r.score.components;
    const won = r.score.primaryComplete;
    const rows = [
      ['row_goal', c.goal], ['row_objectives', c.objectives],
      ['row_efficiency', c.efficiency], ['row_swiftness', c.swiftness],
      ['row_style', c.style], ['row_penalty', c.penalty],
    ];
    root.innerHTML = `
      <div class="scrim"></div>
      <div class="panel narrow overlay-panel results-panel" role="dialog" aria-modal="true" aria-label="${esc(t('resultsAria'))}">
        <h1>${esc(won ? t('goalCompleteTitle') : '🔧 ' + reasonText(r.reason))}</h1>
        <div class="results-stars" aria-label="${esc(t('starsAria', { n: r.stars }))}">${stars(r.stars)}</div>
        <div class="results-total">${r.score.total}<small> ${esc(t('points'))}</small></div>
        <table class="breakdown">
          ${rows.filter(([, v]) => v !== 0).map(([k, v]) => `<tr><td>${esc(t(k))}</td><td>${v > 0 ? '+' : ''}${v}</td></tr>`).join('')}
        </table>
        ${r.newAchievements?.length ? `<div class="ach-unlocks">${r.newAchievements.map(a => `<span class="ach-unlock">🏅 ${esc(achName(a.key))}</span>`).join('')}</div>` : ''}
        <div id="results-compare" class="compare"></div>
        <p id="results-lb" class="muted" aria-live="polite" hidden></p>
        <div class="results-actions">
          <button class="mega-btn" data-act="next" autofocus>${esc(won ? nextLabel(r) : t('retry'))}</button>
          <button class="action-btn" data-act="retry">${esc(t('retry'))}</button>
          <button class="action-btn" data-act="map">${esc(t('stagesBtn'))}</button>
          <button class="action-btn" data-act="title">${esc(t('titleBtn'))}</button>
        </div>
      </div>`;
    this.paintResultsLines();
    if (focusKey) $(focusKey, root)?.focus?.();
  }

  paintResultsLines() {
    const ctx = this.resultsCtx;
    const line = $('#results-lb', this.overlayRoot);
    const compare = $('#results-compare', this.overlayRoot);
    if (!ctx || !line || !compare) return;
    line.hidden = !ctx.lb;
    line.textContent = ctx.lb ? pt(ctx.lb.key, ctx.lb.vars) : '';
    compare.innerHTML = ctx.cmp ? `<p${ctx.cmp.muted ? ' class="muted"' : ''}>${esc(t(ctx.cmp.key, ctx.cmp.vars))}</p>` : '';
  }

  // Signed in, completed Journey/Daily/Challenge rounds post their total to
  // the platform high-score board (then compare against it); otherwise
  // only the comparison runs.
  async postToLeaderboard(r) {
    const ctx = this.resultsCtx;
    const p = this.game.platform;
    const ranked = ['daily', 'journey', 'challenge'].includes(r.mode) && r.score.primaryComplete;
    if (!p.hosted || !ranked) { this.loadComparison(ctx, r); return; }
    ctx.lb = { key: 'lbPosting' };
    this.paintResultsLines();
    const res = await p.postScore(r.score.total);
    ctx.lb = !res.posted ? { key: 'lbNotPosted' }
      : res.rank ? { key: 'lbRank', vars: { rank: res.rank } } : { key: 'lbPosted' };
    if (this.resultsCtx === ctx) this.paintResultsLines();
    this.loadComparison(ctx, r);
  }

  async loadComparison(ctx, r) {
    if (!r.score.primaryComplete) { ctx.cmp = null; return; }
    const boardId = r.mode === 'daily' ? `daily-${this.game.dailyLevel.daily.day}` : 'global';
    const res = await this.game.platform.fetchBoard(boardId);
    if (!res.rows.length) ctx.cmp = { key: 'firstScore', muted: true };
    else {
      const better = res.rows.filter(row => row.score > r.score.total).length;
      ctx.cmp = better === 0 ? { key: 'topOfBoard' }
        : { key: res.casual ? 'beatsCasual' : 'beats', vars: { n: res.rows.length - better, total: res.rows.length } };
    }
    if (this.resultsCtx === ctx) this.paintResultsLines();
  }
}

function nextLabel(r) {
  const m = /^j(\d+)$/.exec(r.levelId);
  if (m && parseInt(m[1], 10) < 40) return t('nextStage');
  if (r.mode === 'learn') return t('nextLesson');
  return t('keepGoing');
}

// A selector that finds the "same" control again after a re-render.
function focusSelector(el, root) {
  if (!el || !root?.contains(el) || el === root) return null;
  if (el.id) return `#${CSS.escape(el.id)}`;
  for (const attr of ['data-act', 'data-level', 'data-board', 'data-theme', 'data-rebind']) {
    const v = el.getAttribute(attr);
    if (v != null) return `[${attr}="${CSS.escape(v)}"]`;
  }
  return null;
}
