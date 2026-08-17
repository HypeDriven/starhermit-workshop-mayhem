// Workshop Mayhem — authoritative script + local dev server (zero deps).
// Declared by starhermit.txt as `server=server.js`.
//
// Two roles:
//  1. Authoritative functions (importable by the host sandbox): replay/score
//     validation, daily session descriptor, achievement definitions,
//     plausibility checks (spec §6 sessions & transport).
//  2. `node server.js` starts a local static + /api/v1 server so the game is
//     playable offline after initial load with real API behavior (time sync,
//     file-backed leaderboards, cloud save, telemetry sink).

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyReplay } from './src/session/replay.js';
import { dailyLevel, dailySeed, DAILY_RULESET, EXCLUDED_DAYS } from './src/content/daily.js';
import { journeyById } from './src/content/stages.js';
import { ACHIEVEMENTS } from './src/content/achievements.js';
import { RULES_VERSION } from './src/rules/engine.js';
import { CONTENT_VERSION } from './src/content/schema.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

// ---------------------------------------------------------------------------
// Authoritative surface
// ---------------------------------------------------------------------------

export function dailySessionDescriptor(dayNumber) {
  return {
    levelId: `d${dayNumber}`,
    seed: dailySeed(dayNumber),
    ruleset: DAILY_RULESET,
    contentVersion: CONTENT_VERSION,
    rulesVersion: RULES_VERSION,
    excluded: EXCLUDED_DAYS.includes(dayNumber),
  };
}

export function achievementDefinitions() {
  return ACHIEVEMENTS.map(a => ({ key: a.key, name: a.name, desc: a.desc }));
}

// Lightweight authoritative score validation: replays the input log against
// deterministic rules; falls back to plausibility/rate checks labelled
// 'casual' when a replay is absent (spec §6 leaderboard validation).
export function validateScoreClaim(claim, level) {
  if (!claim || typeof claim !== 'object') return { accepted: false, reason: 'malformed' };
  if (claim.ruleset !== RULES_VERSION) return { accepted: false, reason: 'stale-ruleset' };
  if ((claim.contentVersion ?? 0) !== CONTENT_VERSION) return { accepted: false, reason: 'stale-content' };
  if (!Number.isInteger(claim.score) || claim.score < 0 || claim.score > 100000) {
    return { accepted: false, reason: 'implausible-score' };
  }
  if (!Number.isInteger(claim.ticks) || claim.ticks < 10 || claim.ticks > 12000) {
    return { accepted: false, reason: 'implausible-duration' };
  }
  if (claim.envelope) {
    const v = verifyReplay(claim.envelope, level);
    if (!v.valid) return { accepted: false, reason: `replay:${v.reason}` };
    if (v.score.total !== claim.score) return { accepted: false, reason: 'replay-score-mismatch' };
    return { accepted: true, validated: 'replay', score: v.score.total };
  }
  return { accepted: true, validated: 'casual', score: claim.score };
}

export function levelForBoard(entry) {
  if (entry.levelId?.startsWith('d')) {
    const day = parseInt(entry.levelId.slice(1), 10);
    if (Number.isInteger(day)) return dailyLevel(day);
  }
  return journeyById(entry.levelId);
}

// ---------------------------------------------------------------------------
// Local dev server
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const DATA_DIR = join(ROOT, '.local-data');
const BOARDS_FILE = join(DATA_DIR, 'boards.json');
const SAVES_DIR = join(DATA_DIR, 'saves');

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

async function handleApi(req, res, url, body) {
  const json = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  if (url.pathname === '/api/v1/time') {
    return json(200, { now: Date.now() });
  }
  if (url.pathname === '/api/v1/leaderboard/submit' && req.method === 'POST') {
    const level = levelForBoard(body);
    if (!level) return json(400, { error: 'unknown-level' });
    const verdict = validateScoreClaim(body, level);
    if (!verdict.accepted) return json(422, { error: verdict.reason });
    const boards = await readJson(BOARDS_FILE, {});
    const rows = boards[body.board] ?? [];
    rows.push({
      name: body.name ?? 'Local Inventor', score: verdict.score, ticks: body.ticks,
      levelId: body.levelId, validated: verdict.validated, when: Date.now(),
    });
    rows.sort((a, b) => b.score - a.score || a.ticks - b.ticks);
    boards[body.board] = rows.slice(0, 100);
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(BOARDS_FILE, JSON.stringify(boards, null, 1));
    return json(200, { ok: true, validated: verdict.validated, rank: rows.findIndex(r => r.when === rows.at(-1)?.when) + 1 });
  }
  if (url.pathname.startsWith('/api/v1/leaderboard/') && req.method === 'GET') {
    const board = decodeURIComponent(url.pathname.slice('/api/v1/leaderboard/'.length));
    const boards = await readJson(BOARDS_FILE, {});
    return json(200, { rows: boards[board] ?? [] });
  }
  if (url.pathname.startsWith('/api/v1/save/') && req.method === 'PUT') {
    const key = url.pathname.slice('/api/v1/save/'.length).replace(/[^\w-]/g, '');
    await mkdir(SAVES_DIR, { recursive: true });
    await writeFile(join(SAVES_DIR, `${key}.json`), JSON.stringify(body.doc));
    return json(200, { ok: true });
  }
  if (url.pathname.startsWith('/api/v1/save/') && req.method === 'GET') {
    const key = url.pathname.slice('/api/v1/save/'.length).replace(/[^\w-]/g, '');
    const doc = await readJson(join(SAVES_DIR, `${key}.json`), null);
    if (!doc) return json(404, { error: 'not-found' });
    return json(200, { doc });
  }
  if (url.pathname === '/api/v1/telemetry' && req.method === 'POST') {
    return json(200, { ok: true, received: body.events?.length ?? 0 });
  }
  if (url.pathname === '/api/v1/activity/start' || url.pathname === '/api/v1/activity/end'
    || url.pathname === '/api/v1/presence') {
    return json(200, { ok: true });
  }
  return json(404, { error: 'not-found' });
}

export function startServer(port = 8080) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      let body = null;
      if (req.method === 'POST' || req.method === 'PUT') {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const raw = Buffer.concat(chunks).toString('utf8');
        if (raw.length > 1_000_000) {
          res.writeHead(413).end('too large');
          return;
        }
        try { body = JSON.parse(raw); } catch { body = null; }
      }
      return handleApi(req, res, url, body);
    }
    // static files (no traversal, no hidden files)
    let path = normalize(decodeURIComponent(url.pathname));
    if (path === '/' || path === '\\') path = '/index.html';
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT) || file.includes('/.')) {
      res.writeHead(403).end('forbidden');
      return;
    }
    try {
      const st = await stat(file);
      if (!st.isFile()) throw new Error('nf');
      const data = await readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': file.includes('/vendor/') ? 'public, max-age=86400, immutable' : 'no-cache',
      });
      res.end(data);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  server.listen(port, () => {
    console.log(`Workshop Mayhem dev server: http://localhost:${port}`);
  });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer(parseInt(process.env.PORT || '8080', 10));
}
