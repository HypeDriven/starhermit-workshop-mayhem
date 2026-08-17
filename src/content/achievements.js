// Static achievement set (spec §6): stable lowercase keys, idempotent unlocks.
// first completion, mechanic mastery, sustained streak, difficult milestone,
// and an accessibility-neutral long-term goal.

export const ACHIEVEMENTS = [
  {
    key: 'first-ring', name: 'First Ring',
    desc: 'Complete any stage for the first time.',
    test: (ctx) => ctx.completedCount >= 1,
  },
  {
    key: 'full-toolbox', name: 'Full Toolbox',
    desc: 'Ring a bell or finish a goal using every kind of tool.',
    test: (ctx) => ctx.toolsUsed.size >= 5,
  },
  {
    key: 'streak-3', name: 'Three-Day Tinker',
    desc: 'Complete the daily challenge on three different days in a row.',
    test: (ctx) => ctx.dailyStreak >= 3,
  },
  {
    key: 'gauntlet-clear', name: 'Gauntlet Clear',
    desc: 'Complete any Chapter 6 mastery stage.',
    test: (ctx) => ctx.gauntletClears >= 1,
  },
  {
    key: 'century-bench', name: 'Century Bench',
    desc: 'Log one hundred total stage completions.',
    test: (ctx) => ctx.completionsTotal >= 100,
  },
];

export function emptyAchievementDoc() {
  return { unlocked: {}, seenTools: [], dailyDays: [], completionsTotal: 0 };
}

// ctx is built by the session from progression + session events.
// Returns newly unlocked keys (unlocking is idempotent).
export function evaluateAchievements(doc, ctx) {
  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (doc.unlocked[a.key]) continue; // idempotent
    if (a.test(ctx)) {
      doc.unlocked[a.key] = new Date().toISOString();
      fresh.push(a.key);
    }
  }
  return fresh;
}

export function achievementContext(prog, achDoc, extras = {}) {
  return {
    completedCount: Object.values(prog.stars || {}).filter(s => s > 0).length,
    completionsTotal: achDoc.completionsTotal,
    toolsUsed: new Set(achDoc.seenTools),
    dailyStreak: currentDailyStreak(achDoc.dailyDays),
    gauntletClears: ['j33', 'j34', 'j35', 'j36', 'j37', 'j38', 'j39', 'j40']
      .filter(id => (prog.stars[id] || 0) > 0).length,
    ...extras,
  };
}

export function currentDailyStreak(days) {
  if (!days.length) return 0;
  const set = new Set(days);
  let streak = 0;
  let d = Math.max(...days);
  // streak counts backward from the most recent completed day
  while (set.has(d)) { streak++; d--; }
  return streak;
}
