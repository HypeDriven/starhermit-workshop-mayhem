// Content validation suite: every authored/generated document proves legal,
// reachable, bounded, and soft-lock-free (spec §9 rules & content).
import { suite, ok, eq } from './harness.mjs';
import { validateLevel } from '../tools/validate-content.mjs';
import { JOURNEY, CHALLENGES } from '../src/content/stages.js';
import { TUTORIALS } from '../src/content/tutorials.js';
import { dailyLevel, dailySeed } from '../src/content/daily.js';
import { THEMES, THEME_ORDER, themeUnlocked } from '../src/content/themes.js';
import { ACHIEVEMENTS, evaluateAchievements, emptyAchievementDoc, achievementContext } from '../src/content/achievements.js';
import { DEFAULT_PROGRESSION } from '../src/session/persistence.js';

suite('content: journey stage count and structure', () => {
  ok(JOURNEY.length >= 40, `>= 40 authored stages (got ${JOURNEY.length})`);
  eq(new Set(JOURNEY.map(l => l.id)).size, JOURNEY.length, 'unique ids');
  // mastery stage closes each chapter
  const chapters = [...new Set(JOURNEY.map(l => l.chapter))].filter(c => c > 0);
  ok(chapters.length >= 5, 'chapters present');
  for (const ch of chapters) {
    ok(JOURNEY.some(l => l.chapter === ch && /mastery|gauntlet/i.test(l.name)), `chapter ${ch} has mastery`);
  }
});

suite('content: every authored stage validates (solution replays to completion)', () => {
  const bad = [];
  for (const l of [...JOURNEY, ...CHALLENGES, ...TUTORIALS]) {
    const errs = validateLevel(l);
    if (errs.length) bad.push(`${l.id}: ${errs.join('; ')}`);
  }
  eq(bad.length, 0, `all stages validate:\n${bad.slice(0, 5).join('\n')}`);
});

suite('content: 60 daily challenges validate', () => {
  const bad = [];
  for (let i = 0; i < 60; i++) {
    const day = 20400 + i;
    const l = dailyLevel(day);
    const errs = validateLevel(l, { mode: 'daily' });
    if (errs.length) bad.push(`day ${day}: ${errs.join('; ')}`);
  }
  eq(bad.length, 0, `all dailies validate:\n${bad.slice(0, 3).join('\n')}`);
});

suite('content: daily seeds immutable and deterministic', () => {
  const a = dailyLevel(20500), b = dailyLevel(20500);
  eq(JSON.stringify(a.solution), JSON.stringify(b.solution), 'same day same solution');
  eq(dailySeed(20500), dailySeed(20500), 'seed stable');
  ok(dailySeed(20500) !== dailySeed(20501), 'different days differ');
});

suite('content: five+ cosmetic themes with distinct palettes', () => {
  ok(THEME_ORDER.length >= 5, 'five themes');
  const palettes = new Set(THEME_ORDER.map(t => THEMES[t].floor));
  eq(palettes.size, THEME_ORDER.length, 'distinct floors');
  const prog = { totalStars: 0, stars: {} };
  ok(themeUnlocked(THEMES.brassworks, prog), 'default theme unlocked');
  ok(!themeUnlocked(THEMES.verdant, prog), 'late theme locked at start');
  ok(themeUnlocked(THEMES.verdant, { totalStars: 95, stars: {} }), 'star unlock works');
});

suite('content: achievements idempotent and well-formed', () => {
  const keys = ACHIEVEMENTS.map(a => a.key);
  eq(new Set(keys).size, keys.length, 'unique keys');
  ok(keys.every(k => k === k.toLowerCase()), 'lowercase keys');
  const doc = emptyAchievementDoc();
  const prog = JSON.parse(JSON.stringify(DEFAULT_PROGRESSION));
  prog.stars = { j01: 2, j33: 1 };
  doc.seenTools = ['piston', 'pad', 'fan', 'magnet', 'weight'];
  doc.completionsTotal = 100;
  doc.dailyDays = [100, 101, 102];
  const ctx = achievementContext(prog, doc);
  const fresh = evaluateAchievements(doc, ctx);
  ok(fresh.includes('first-ring'), 'first completion unlocks');
  ok(fresh.includes('full-toolbox'), 'mechanic mastery unlocks');
  ok(fresh.includes('streak-3'), 'streak unlocks');
  ok(fresh.includes('gauntlet-clear'), 'milestone unlocks');
  ok(fresh.includes('century-bench'), 'long-term unlocks');
  const again = evaluateAchievements(doc, ctx);
  eq(again.length, 0, 'no double unlock (idempotent)');
});
