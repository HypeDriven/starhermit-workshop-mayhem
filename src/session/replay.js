// Replay envelope: schema version, build/content version, seed, initial hash,
// ordered commands, periodic state hashes, terminal result (spec §5).
// Pure and node-safe: used by the browser session, the authoritative
// validator (server.js), and the test-suite property checks.

import { createGame, applyCommand, step, isTerminal, finalScore, RULES_VERSION } from '../rules/engine.js';
import { serialize, deserialize, hashState } from '../rules/serialize.js';
import { CONTENT_VERSION } from '../content/schema.js';

export const REPLAY_SCHEMA = 1;
export const HASH_EVERY = 120; // periodic hash cadence in ticks

export function createEnvelope({ level, seed, mode, build = 'dev' }) {
  return {
    schema: REPLAY_SCHEMA,
    build,
    rulesVersion: RULES_VERSION,
    contentVersion: level.version ?? CONTENT_VERSION,
    levelId: level.id,
    levelVersion: level.version,
    mode: mode || 'journey',
    seed: seed >>> 0,
    initialHash: null,       // set on first record()
    startedAtOffset: 0,      // host timestamp offset (informational)
    commands: [],            // [{id, tick, ...cmd}] in issue order
    hashes: [],              // [{tick, hash}] periodic
    terminal: null,          // {reason, tick, score}
  };
}

// Records a command at the current tick and returns engine result. Rejected
// commands are recorded too: they mutate stats.invalid / lastInvalid, which
// are score- and hash-relevant, so an honest replay needs them (spec §5).
export function recordCommand(state, envelope, cmd) {
  const result = applyCommand(state, cmd);
  if (envelope.initialHash === null) envelope.initialHash = hashState(state);
  envelope.commands.push({ tick: state.tick, accepted: result.accepted, ...cmd });
  return result;
}

// Advance one tick, collecting periodic hashes and the terminal result.
export function recordStep(state, envelope) {
  const events = step(state);
  if (envelope.initialHash === null) envelope.initialHash = hashState(state);
  if (state.tick % HASH_EVERY === 0) {
    envelope.hashes.push({ tick: state.tick, hash: hashState(state) });
  }
  if (state.phase === 'terminal' && !envelope.terminal) {
    envelope.terminal = {
      reason: state.terminalReason,
      tick: state.tick,
      score: finalScore(state),
    };
    envelope.hashes.push({ tick: state.tick, hash: hashState(state) });
  }
  return events;
}

// Re-run an envelope against fresh rules and verify every recorded hash plus
// the terminal result. Returns {valid, reason, score} — the authoritative
// score-validation path (spec §6 leaderboard validation).
export function verifyReplay(envelope, level) {
  try {
    if (!envelope || envelope.schema !== REPLAY_SCHEMA) return { valid: false, reason: 'schema' };
    if (envelope.rulesVersion !== RULES_VERSION) return { valid: false, reason: 'rules-version' };
    if ((envelope.levelVersion ?? envelope.contentVersion) !== level.version) {
      return { valid: false, reason: 'content-version' };
    }
    const state = createGame(level, {
      seed: envelope.seed,
      mode: envelope.mode,
      allowUndo: false,
    });
    // settle to the natural start, as a live session would
    let guard = 0;
    while (!state.settled && state.phase !== 'terminal' && guard++ < 3600) step(state);

    const byTick = new Map();
    for (const c of envelope.commands) {
      if (byTick.has(c.tick)) byTick.get(c.tick).push(c); else byTick.set(c.tick, [c]);
    }
    const lastCmdTick = envelope.commands.reduce((a, c) => Math.max(a, c.tick), 0);
    const hashQueue = [...(envelope.hashes || [])];
    const endTick = envelope.terminal?.tick ?? (lastCmdTick + 4800);
    const seen = new Set();

    while (state.phase !== 'terminal' && state.tick <= endTick + 2400) {
      const cmds = byTick.get(state.tick);
      if (cmds) {
        for (const c of cmds) {
          const { tick, accepted, ...cmd } = c;
          if (accepted) {
            if (seen.has(cmd.id)) return { valid: false, reason: 'duplicate-command-id' };
            seen.add(cmd.id);
            const r = applyCommand(state, cmd);
            if (!r.accepted) return { valid: false, reason: `command-rejected:${r.reason}` };
          } else {
            // recorded rejection: must reject identically (idempotent duplicates too)
            const r = applyCommand(state, cmd);
            if (r.accepted) return { valid: false, reason: 'expected-rejection' };
          }
        }
      }
      step(state);
      if (hashQueue.length && hashQueue[0].tick === state.tick) {
        const h = hashQueue.shift();
        if (hashState(state) !== h.hash) return { valid: false, reason: `hash-mismatch@${h.tick}` };
      }
    }
    if (!envelope.terminal) return { valid: true, reason: 'partial', score: finalScore(state) };
    if (state.phase !== 'terminal') return { valid: false, reason: 'never-terminates' };
    const score = finalScore(state);
    if (state.terminalReason !== envelope.terminal.reason) return { valid: false, reason: 'terminal-mismatch' };
    if (score.total !== envelope.terminal.score.total) return { valid: false, reason: 'score-mismatch' };
    return { valid: true, reason: 'ok', score };
  } catch (err) {
    return { valid: false, reason: `exception:${err.message}` };
  }
}

// Serialize a live session's resumable snapshot (spec §5 last safe snapshot).
export function snapshotSession(state, envelope) {
  return {
    v: 1,
    state: serialize(state),
    envelope,
  };
}

export function restoreSession(snap, level) {
  if (!snap || snap.v !== 1) throw new Error('bad session snapshot');
  return {
    state: deserialize(snap.state, level),
    envelope: snap.envelope,
  };
}
