// Integer scoring. Components are stored as integers; formatting is a
// presentation concern only (spec §2 scoring).

export const SCORE_WEIGHTS = {
  goal: 1000,          // primary objective complete
  objective: 250,      // each secondary goal complete
  efficiency: 120,     // each unused tool when primary complete
  swiftnessPer4: 1,    // 1 point per 4 ticks under par
  styleCap: 300,
  airPer2: 1,          // 1 point per 2 airborne ticks
  spin: 40,            // per full flip
  peakPer: 25,         // per metre above spawn (capped by styleCap)
  invalidPenalty: 25,  // per invalid action
};

export function computeScore(state, final) {
  const primaries = state.goals.filter(g => g.primary);
  const primaryComplete = primaries.every(g => g.done);
  const secondaryDone = state.goals.filter(g => !g.primary && g.done).length;

  const goal = primaryComplete ? SCORE_WEIGHTS.goal : 0;
  const objectives = secondaryDone * SCORE_WEIGHTS.objective;

  let efficiency = 0, swiftness = 0;
  if (primaryComplete) {
    const unused = Object.values(state.stock).reduce((a, v) => a + Math.max(0, v), 0);
    efficiency = unused * SCORE_WEIGHTS.efficiency;
    const par = state.level?.par?.ticks ?? state.options.maxTicks;
    const under = Math.max(0, par - state.tick);
    swiftness = Math.floor(under / 4) * SCORE_WEIGHTS.swiftnessPer4;
  }

  const spins = Math.floor(Math.abs(state.stats.spinSum) / 6.2832);
  const style = Math.min(
    SCORE_WEIGHTS.styleCap,
    Math.floor(state.stats.airTicks / 2) * SCORE_WEIGHTS.airPer2 +
    spins * SCORE_WEIGHTS.spin +
    Math.floor(state.stats.peakY) * SCORE_WEIGHTS.peakPer,
  );

  const penalty = -SCORE_WEIGHTS.invalidPenalty * state.stats.invalid;
  const total = Math.max(0, goal + objectives + efficiency + swiftness + style + penalty);

  return {
    primaryComplete,
    components: { goal, objectives, efficiency, swiftness, style, penalty },
    total,
    // tie-break fields (spec §2): completion, fewer invalids, lower time, session id
    tie: {
      complete: primaryComplete ? 1 : 0,
      invalid: state.stats.invalid,
      ticks: state.tick,
    },
  };
}

// Star thresholds for journey progression: 1 = complete, 2 = par, 3 = star3.
export function starsFor(level, score) {
  if (!score.primaryComplete) return 0;
  let stars = 1;
  if (score.total >= (level.par?.score ?? Infinity)) stars = 2;
  if (score.total >= (level.par?.star3 ?? Infinity)) stars = 3;
  return stars;
}

// Deterministic result ordering. Returns negative if a beats b.
export function compareResults(a, b, sessionA = '', sessionB = '') {
  if (a.tie.complete !== b.tie.complete) return b.tie.complete - a.tie.complete;
  if (a.total !== b.total) return b.total - a.total;
  if (a.tie.invalid !== b.tie.invalid) return a.tie.invalid - b.tie.invalid;
  if (a.tie.ticks !== b.tie.ticks) return a.tie.ticks - b.tie.ticks;
  return sessionA < sessionB ? -1 : sessionA > sessionB ? 1 : 0;
}
