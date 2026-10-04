// Platform adapter over the canonical StarHermit SDK (`starhermit-sdk.js`,
// global `StarHermit`, initialised from index.html before any module runs).
// Hosted = the SDK holds a launch token: account nickname, cloud save in the
// `game:<slug>` slot (localStorage stays the offline cache), settings KV,
// control bindings, invite link and the read-only platform leaderboard.
// Without a token nothing touches the network. Never persists tokens.

export class Platform {
  constructor(sh = globalThis.StarHermit || null) {
    this.sh = sh;
    this.hosted = !!(sh && sh.token);
    this.slug = sh ? sh.slug : null;  // from the token's game_scope / host — never hard-coded
    this.sub = this.hosted ? sh.userId : null;
    this.nickname = null;
    this.profile = this.sub ? { id: this.sub, nickname: null, guest: false } : null;
    this.syncStatus = this.hosted ? 'synced' : 'offline'; // offline | saving | synced | error
    this.timeOffset = 0;       // serverNow - clientNow (ms)
    this.timeSynced = false;
    this.telemetryQueue = [];  // anonymous funnel events, in memory only
    this.telemetryConsent = false;
    this.sessionRand = Math.random().toString(36).slice(2, 10);
    this.onAuthChange = null;  // (signedIn) => void
    if (sh) {
      sh.on('saved', (ok) => { if (this.hosted) this.syncStatus = ok ? 'synced' : 'error'; });
      sh.on('auth', (e) => {
        if (e && e.signedIn) return;
        this.hosted = false;
        this.syncStatus = 'offline';
        this.onAuthChange?.(false);
      });
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => this.flushCloudSave());
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.flushCloudSave();
      });
    }
  }

  get token() { return this.sh ? this.sh.token : null; }

  // --- account profile & sign-in -------------------------------------------------
  // nickname from the profile endpoint (fallback "Player <id prefix>"); never
  // /api/v1/me, never usernames
  async loadAccountProfile() {
    if (!this.hosted || !this.sub) return null;
    this.nickname = await this.nicknameFor(this.sub);
    this.profile = { id: this.sub, nickname: this.nickname, guest: false };
    return this.nickname;
  }

  async nicknameFor(userId) {
    if (!userId) return 'Player';
    const p = this.hosted ? await this.sh.profile(String(userId)) : null;
    return p ? p.displayName : 'Player ' + String(userId).slice(0, 6);
  }

  canSignIn() { return !!(this.sh && this.sh.canSignIn()); }
  signIn() { return !!(this.sh && this.sh.signIn()); }
  inviteLink() { return this.hosted ? this.sh.inviteLink() : null; }

  // --- settings KV & controls ------------------------------------------------------
  async getSettings() { return this.hosted ? this.sh.getSettings() : {}; }
  patchSettings(obj) { if (this.hosted) this.sh.patchSettings(obj); }
  async loadBindings(defaults) {
    if (this.hosted) return this.sh.loadBindings(defaults);
    return Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, v.slice()]));
  }
  setControl(action, codes) {
    return this.hosted ? this.sh.setControl(action, codes).catch(() => null) : Promise.resolve(null);
  }
  resetControls() { return this.hosted ? this.sh.resetControls() : Promise.resolve(null); }

  // --- time sync ---------------------------------------------------------------
  async syncTime() {
    if (!this.hosted) { this.timeSynced = true; return; }
    const t0 = Date.now();
    let r = null;
    try { r = await this.sh.api('/api/v1/time'); } catch { return; }
    const t1 = Date.now();
    if (!r || typeof r.now !== 'number') return;
    this.timeOffset = r.now + (t1 - t0) / 2 - t1;
    this.timeSynced = true;
  }

  now() { return Date.now() + this.timeOffset; }
  utcDay() { return Math.floor(this.now() / 86400000); }

  // --- presence & activity: no route reachable by a launch token, and offline
  // play makes no network calls, so these are no-ops
  startActivity() {}
  endActivity() {}

  // --- leaderboards ------------------------------------------------------------------
  // clients can NEVER submit scores to a game leaderboard (script/elo-owned);
  // personal bests stay local and travel inside the cloud-saved doc
  submitScore(entry) {
    return this.localSubmit(entry);
  }

  localSubmit(entry) {
    const key = `workshop-mayhem:board:${entry.board}`;
    let rows = [];
    try { rows = JSON.parse(localStorage.getItem(key) || '[]'); } catch { /* */ }
    const row = {
      name: this.nickname ?? 'You',
      score: entry.score, ticks: entry.ticks, levelId: entry.levelId,
      when: Date.now(), sessionId: this.sessionRand, casual: true,
    };
    rows.push(row);
    rows.sort((a, b) => b.score - a.score || a.ticks - b.ticks);
    rows = rows.slice(0, 50);
    try { localStorage.setItem(key, JSON.stringify(rows)); } catch { /* */ }
    // rank of *this* row — several rows can share this session id
    const idx = rows.indexOf(row);
    return { ok: true, casual: true, rank: idx < 0 ? 0 : idx + 1 };
  }

  async fetchBoard(board, { friends = false } = {}) {
    if (this.hosted && board === 'global') {
      const rows = await this.fetchPlatformBoard({ friends });
      if (rows) return { rows, casual: false };
      // no leaderboardId: local records only
    }
    let rows = [];
    try { rows = JSON.parse(localStorage.getItem(`workshop-mayhem:board:${board}`) || '[]'); } catch { /* */ }
    return { rows, casual: true };
  }

  async fetchPlatformBoard({ friends } = {}) {
    try {
      const r = await this.sh.leaderboard(null, { pageSize: 50, scope: friends ? 'friends' : undefined });
      if (!r.board) return null;
      return await Promise.all((r.items || []).map(async (e, i) => ({
        name: e.nickname || await this.nicknameFor(e.userId ?? e.id),
        score: e.score ?? e.value ?? 0,
        ticks: e.ticks ?? 0,
        levelId: e.levelId ?? null,
        rank: e.rank ?? i + 1,
      })));
    } catch {
      return null;
    }
  }

  // --- cloud save: one platform slot; localStorage stays the offline cache and
  // the cloud slot is its cross-device mirror --------------------------------
  cloudSave(kind, doc) {
    if (!this.hosted) return;
    this.syncStatus = 'saving';
    this.sh.saveJSON({ kind, doc }, 2000);
  }

  flushCloudSave() {
    if (!this.hosted) return Promise.resolve(false);
    return this.sh.flushSave(true);
  }

  async cloudLoad(kind) {
    if (!this.hosted) return { error: 'not-hosted' };
    const saved = await this.sh.loadJSON();
    if (!saved) return { doc: null };
    this.syncStatus = 'synced';
    // { kind, doc } envelope; older saves stored the document itself
    return { doc: saved.kind === kind && 'doc' in saved ? saved.doc : saved };
  }

  // --- telemetry (anonymous funnel only, consent-gated, kept in memory; no
  // telemetry route is reachable with a launch token) ------------------------
  setTelemetryConsent(on) {
    this.telemetryConsent = on;
    if (!on) this.telemetryQueue.length = 0;
  }

  telemetry(kind, data = {}) {
    if (!this.telemetryConsent) return;
    const allowed = ['start', 'tutorial-step', 'round-end', 'retry', 'settings-change', 'error'];
    if (!allowed.includes(kind)) return;
    this.telemetryQueue.push({
      kind, at: Date.now(), session: this.sessionRand,
      // no raw text, no personal data, no cross-title ids
      data: pick(data, ['level', 'mode', 'reason', 'score', 'stars', 'step', 'category', 'setting']),
    });
    if (this.telemetryQueue.length > 50) this.telemetryQueue.splice(0, this.telemetryQueue.length - 50);
  }

  flushTelemetry() {}
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}
