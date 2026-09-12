// Platform adapter: launch-token scope, same-origin /api routes with retries
// and rate-limit handling, round-trip server time sync, account nickname via
// the profile endpoint, read-only platform leaderboards, one-slot cloud save
// (zip+base64) with localStorage as the offline cache, and consent-gated
// anonymous telemetry (spec §6). Never persists tokens.

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const REFRESH_MS = 45 * 60 * 1000;   // re-mint scoped launch tokens well inside their 60-min life
const REFRESH_RETRY_MS = 60 * 1000;
const CLOUD_DEBOUNCE_MS = 2000;

export class Platform {
  constructor() {
    this.hosted = false;
    this.slug = 'workshop-mayhem';
    this.token = null;
    this.sub = null;
    this.nickname = null;
    this.profile = null;       // hosted identity: {id, nickname, guest:false}
    this.syncStatus = 'offline'; // offline | saving | synced | error
    this.leaderboardId = undefined;
    this.meStats = null;
    this.timeOffset = 0;       // serverNow - clientNow (ms)
    this.timeSynced = false;
    this.heartbeatTimer = null;
    this.telemetryQueue = [];
    this.telemetryConsent = false;
    this.sessionRand = Math.random().toString(36).slice(2, 10);
    this.refreshTimer = null;
    this.cloudTimer = null;
    this.pendingCloudDoc = null;
    this.nicknameCache = new Map();
    this.detectHost();
    // the game's own `node server.js` dev shell keeps the legacy local routes;
    // the hosted platform never sees them
    this.devServer = !this.hosted && /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(location.hostname);
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => this.flushCloudSave());
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.flushCloudSave();
      });
    }
  }

  detectHost() {
    // hosted launch: the token arrives in the URL fragment, read once, then
    // stripped so it never lingers in history or referrals
    try {
      let token = null;
      if (location.hash.includes('game_token=')) {
        const frag = new URLSearchParams(location.hash.slice(1));
        token = frag.get('game_token') || null;
        history.replaceState(null, '', location.pathname + location.search);
      }
      // local-dev fallbacks only: the platform itself always uses the fragment
      if (!token) {
        const params = new URLSearchParams(location.search);
        const injected = globalThis.__STARHERMIT_LAUNCH__;
        token = injected?.token ?? params.get('launch_token');
      }
      if (!token) return;
      this.token = token;
      const payload = decodeToken(token);
      this.sub = payload?.sub ?? null;
      if (payload?.game_scope) this.slug = payload.game_scope;
      this.profile = this.sub ? { id: this.sub, nickname: null, guest: false } : null;
      this.hosted = true;
      this.scheduleRefresh();
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

  // raw variant for non-JSON payloads (cloud-save zip bytes)
  async apiRaw(path, { method = 'GET' } = {}) {
    const headers = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    try {
      return await fetch(path, { method, headers });
    } catch {
      return null;
    }
  }

  // --- token lifecycle ---------------------------------------------------------
  scheduleRefresh() {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refreshToken(), REFRESH_MS);
  }

  async refreshToken() {
    if (!this.hosted || !this.token) return;
    const r = await this.api(`/api/v1/games/${encodeURIComponent(this.slug)}/launch-token`, {
      method: 'POST', body: { token: this.token },
    });
    if (!r.error && r.token) {
      this.token = r.token;          // swap in the re-minted scoped token
      this.scheduleRefresh();
    } else {
      this.refreshTimer = setTimeout(() => this.refreshToken(), REFRESH_RETRY_MS);
    }
  }

  // --- account profile -----------------------------------------------------------
  // nickname comes from the profile endpoint — never from JWT claims, never
  // /api/v1/me (403 under game scope), never usernames
  async loadAccountProfile() {
    if (!this.hosted || !this.sub) return null;
    const r = await this.api(`/api/v1/users/${encodeURIComponent(this.sub)}/profile`);
    this.nickname = r.error
      ? 'Player ' + this.sub.slice(0, 8)
      : (r.nickname || 'Player ' + this.sub.slice(0, 8));
    this.profile = { id: this.sub, nickname: this.nickname, guest: false };
    return this.nickname;
  }

  async nicknameFor(userId) {
    if (!userId) return 'Player';
    const key = String(userId);
    if (this.nicknameCache.has(key)) return this.nicknameCache.get(key);
    const r = await this.api(`/api/v1/users/${encodeURIComponent(key)}/profile`);
    const name = (!r.error && r.nickname) || 'Player ' + key.slice(0, 8);
    this.nicknameCache.set(key, name);
    return name;
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

  // --- presence & activity (game's own dev server only; the hosted platform
  // has no per-game presence/activity endpoints reachable by launch tokens)
  startActivity() {
    if (!this.devServer) return;
    this.api('/api/v1/activity/start', { method: 'POST', body: { game: this.slug } });
    this.heartbeatTimer = setInterval(() => {
      this.api('/api/v1/presence', { method: 'POST', body: { game: this.slug, playing: true } });
    }, 45000);
  }

  endActivity() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    if (!this.devServer) return;
    this.api('/api/v1/activity/end', { method: 'POST', body: { game: this.slug } });
  }

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
      if (this.leaderboardId === undefined) {
        const info = await this.api(`/api/v1/games/${encodeURIComponent(this.slug)}`);
        if (info.error) return null;
        this.leaderboardId = info.leaderboardId ?? null;
        this.meStats = info.me ?? null;
      }
      if (!this.leaderboardId) return null;
      const q = new URLSearchParams({ page: '1', pageSize: '50' });
      if (friends) q.set('friendsOnly', '1');
      const r = await this.api(`/api/v1/leaderboards/${encodeURIComponent(this.leaderboardId)}/entries?${q}`);
      const entries = Array.isArray(r?.entries) ? r.entries : (Array.isArray(r?.rows) ? r.rows : null);
      if (!entries) return null;
      return await Promise.all(entries.map(async (e, i) => ({
        name: await this.nicknameFor(e.userId ?? e.user_id ?? e.id),
        score: e.score ?? e.value ?? 0,
        ticks: e.ticks ?? 0,
        levelId: e.levelId ?? null,
        rank: e.rank ?? i + 1,
      })));
    } catch {
      return null;
    }
  }

  // --- cloud save: one platform slot (zip+base64); localStorage stays the
  // offline cache and the cloud slot is its cross-device mirror --------------
  cloudSave(kind, doc) {
    this.pendingCloudDoc = { kind, doc };
    this.syncStatus = 'saving';
    clearTimeout(this.cloudTimer);
    this.cloudTimer = setTimeout(() => this.flushCloudSave(), CLOUD_DEBOUNCE_MS);
  }

  async flushCloudSave() {
    clearTimeout(this.cloudTimer);
    this.cloudTimer = null;
    const pending = this.pendingCloudDoc;
    if (!pending) return;
    if (!this.hosted || !this.token) {
      this.pendingCloudDoc = null;
      this.syncStatus = 'offline';
      return;
    }
    const bytes = zipStore(`${pending.kind}.json`, new TextEncoder().encode(JSON.stringify(pending.doc)));
    const r = await this.api(`/api/v1/me/cloud-saves/${encodeURIComponent(this.slug)}`, {
      method: 'PUT', body: { dataBase64: bytesToBase64(bytes) },
    });
    if (r.error) {
      // keep the pending doc for the next flush; surface the state
      this.syncStatus = r.offline ? 'offline' : 'error';
      return;
    }
    this.pendingCloudDoc = null;
    this.syncStatus = 'synced';
  }

  async cloudLoad(kind) {
    if (!this.hosted || !this.token) return { error: 'not-hosted' };
    const res = await this.apiRaw(`/api/v1/me/cloud-saves/${encodeURIComponent(this.slug)}`);
    if (!res) return { error: 'network', offline: true };
    if (res.status === 404) return { doc: null };
    if (!res.ok) return { error: `http-${res.status}`, status: res.status };
    try {
      const bytes = new Uint8Array(await res.arrayBuffer());
      const data = unzipFirstEntry(bytes);
      this.syncStatus = 'synced';
      return { doc: JSON.parse(new TextDecoder().decode(data)) };
    } catch {
      return { error: 'bad-save' };
    }
  }

  // --- telemetry (anonymous funnel only, consent-gated; sent only to the
  // game's own dev server — the hosted platform has no per-game telemetry) ----
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
    if (!this.devServer || !this.telemetryQueue.length) { this.telemetryQueue.length = 0; return; }
    const batch = this.telemetryQueue.splice(0);
    await this.api('/api/v1/telemetry', { method: 'POST', body: { events: batch } });
  }
}

function decodeToken(token) {
  try {
    let part = token.split('.')[1];
    part = part.replace(/-/g, '+').replace(/_/g, '/');
    part += '='.repeat((4 - part.length % 4) % 4);
    return JSON.parse(atob(part));
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

// Minimal ZIP writer/reader (stored entries only, no compression).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(name, dataBytes) {
  const enc = new TextEncoder();
  const nameB = enc.encode(name);
  const crc = crc32(dataBytes);
  const out = [];
  const u16 = (v) => out.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v) => out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  u32(0x04034b50); u16(20); u16(0); u16(0); u16(0); u16(0);
  u32(crc); u32(dataBytes.length); u32(dataBytes.length);
  u16(nameB.length); u16(0);
  const head = new Uint8Array(out);
  const cd = [];
  const c16 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff);
  const c32 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  c32(0x02014b50); c16(20); c16(20); c16(0); c16(0); c16(0); c16(0);
  c32(crc); c32(dataBytes.length); c32(dataBytes.length);
  c16(nameB.length); c16(0); c16(0); c16(0); c16(0); c32(0); c32(0); // attrs + local-header offset
  const cdHead = new Uint8Array(cd);
  const cdOff = head.length + nameB.length + dataBytes.length;
  const parts = [head, nameB, dataBytes, cdHead, nameB];
  const eocd = [];
  const e32 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  const e16 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff);
  e32(0x06054b50); e16(0); e16(0); e16(1); e16(1);
  e32(cdHead.length + nameB.length); e32(cdOff); e16(0);
  parts.push(new Uint8Array(eocd));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  return buf;
}
function unzipFirstEntry(zipBytes) {
  // Stored single-entry reader: scan local headers for compression 0.
  const dv = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  let off = 0;
  while (off + 30 <= zipBytes.length && dv.getUint32(off, true) === 0x04034b50) {
    const method = dv.getUint16(off + 8, true);
    const size = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const dataOff = off + 30 + nameLen + extraLen;
    if (method !== 0) throw new Error('unsupported zip entry');
    return zipBytes.slice(dataOff, dataOff + size);
  }
  throw new Error('bad zip');
}
function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function base64ToBytes(b64) {
  const s = atob(b64);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}
