// Platform adapter: launch-token scope, same-origin /api routes with retries
// and rate-limit handling, round-trip server time sync, presence heartbeats,
// activity lifecycle, leaderboard + cloud-save with local fallback, and
// consent-gated anonymous telemetry (spec §6). Never persists tokens.

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export class Platform {
  constructor() {
    this.hosted = false;
    this.slug = 'workshop-mayhem';
    this.token = null;
    this.profile = null;
    this.timeOffset = 0;       // serverNow - clientNow (ms)
    this.timeSynced = false;
    this.heartbeatTimer = null;
    this.telemetryQueue = [];
    this.telemetryConsent = false;
    this.sessionRand = Math.random().toString(36).slice(2, 10);
    this.detectHost();
  }

  detectHost() {
    // host shell may inject a launch context; otherwise read short-lived
    // launch token from the URL (never stored)
    try {
      const params = new URLSearchParams(location.search);
      const injected = globalThis.__STARHERMIT_LAUNCH__;
      const token = injected?.token ?? params.get('launch_token');
      if (token) {
        this.token = token;
        const payload = decodeToken(token);
        if (payload?.game) this.slug = payload.game;
        if (payload?.sub) this.profile = { id: payload.sub, name: payload.name ?? 'Inventor', guest: false };
        this.hosted = true;
      } else if (injected) {
        this.hosted = true;
        if (injected.game) this.slug = injected.game;
      }
    } catch { /* standalone */ }
  }

  async api(path, { method = 'GET', body = null, retries = 2 } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let attempt = 0;
    for (;;) {
      let res;
      try {
        res = await fetch(path, {
          method, headers,
          body: body ? JSON.stringify(body) : null,
        });
      } catch (err) {
        if (attempt++ >= retries) return { error: 'network', offline: true };
        await sleep(400 * attempt);
        continue;
      }
      if (res.status === 429 && attempt <= retries) {
        const wait = parseFloat(res.headers.get('Retry-After') || '1');
        await sleep(Math.min(wait, 8) * 1000 * ++attempt);
        continue;
      }
      let data = null;
      try { data = await res.json(); } catch { /* empty */ }
      if (!res.ok) {
        // structured {"error":"..."} responses are recoverable UI states
        return { error: data?.error ?? `http-${res.status}`, status: res.status };
      }
      return data ?? {};
    }
  }

  // --- time sync ---------------------------------------------------------------
  async syncTime() {
    if (!this.hosted) { this.timeSynced = true; return; }
    const t0 = Date.now();
    const r = await this.api('/api/v1/time');
    const t1 = Date.now();
    if (r.error) return;
    const rtt = t1 - t0;
    this.timeOffset = r.now + rtt / 2 - t1;
    this.timeSynced = true;
  }

  now() { return Date.now() + this.timeOffset; }
  utcDay() { return Math.floor(this.now() / 86400000); }

  // --- presence & activity -------------------------------------------------------
  startActivity() {
    if (!this.hosted) return;
    this.api('/api/v1/activity/start', { method: 'POST', body: { game: this.slug } });
    this.heartbeatTimer = setInterval(() => {
      this.api('/api/v1/presence', { method: 'POST', body: { game: this.slug, playing: true } });
    }, 45000);
  }

  endActivity() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    if (!this.hosted) return;
    this.api('/api/v1/activity/end', { method: 'POST', body: { game: this.slug } });
  }

  // --- leaderboards ------------------------------------------------------------------
  async submitScore(entry) {
    if (this.hosted) {
      const r = await this.api('/api/v1/leaderboard/submit', { method: 'POST', body: entry });
      if (!r.error) return r;
      // recoverable: fall through to local casual board
    }
    return this.localSubmit(entry);
  }

  localSubmit(entry) {
    const key = `workshop-mayhem:board:${entry.board}`;
    let rows = [];
    try { rows = JSON.parse(localStorage.getItem(key) || '[]'); } catch { /* */ }
    rows.push({
      name: this.profile?.name ?? 'You',
      score: entry.score, ticks: entry.ticks, levelId: entry.levelId,
      when: Date.now(), sessionId: this.sessionRand, casual: true,
    });
    rows.sort((a, b) => b.score - a.score || a.ticks - b.ticks);
    rows = rows.slice(0, 50);
    try { localStorage.setItem(key, JSON.stringify(rows)); } catch { /* */ }
    return { ok: true, casual: true, rank: rows.findIndex(r => r.sessionId === this.sessionRand) + 1 };
  }

  async fetchBoard(board, { friends = false } = {}) {
    if (this.hosted) {
      const r = await this.api(`/api/v1/leaderboard/${encodeURIComponent(board)}${friends ? '?friends=1' : ''}`);
      if (!r.error) return { rows: r.rows ?? [], casual: false };
    }
    let rows = [];
    try { rows = JSON.parse(localStorage.getItem(`workshop-mayhem:board:${board}`) || '[]'); } catch { /* */ }
    return { rows, casual: true };
  }

  // --- cloud save ----------------------------------------------------------------------
  async cloudSave(kind, doc) {
    if (!this.hosted) return { error: 'not-hosted' };
    return this.api(`/api/v1/save/${this.slug}/${kind}`, { method: 'PUT', body: { doc } });
  }

  async cloudLoad(kind) {
    if (!this.hosted) return { error: 'not-hosted' };
    return this.api(`/api/v1/save/${this.slug}/${kind}`);
  }

  // --- telemetry (anonymous funnel only, consent-gated) --------------------------------
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
    if (this.telemetryQueue.length >= 8) this.flushTelemetry();
  }

  async flushTelemetry() {
    if (!this.hosted || !this.telemetryQueue.length) { this.telemetryQueue.length = 0; return; }
    const batch = this.telemetryQueue.splice(0);
    await this.api('/api/v1/telemetry', { method: 'POST', body: { events: batch } });
  }
}

function decodeToken(token) {
  try {
    const part = token.split('.')[1];
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
