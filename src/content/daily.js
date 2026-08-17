// Daily challenge: one shared seed and ruleset per UTC day (spec §2 Daily).
// The level is generated deterministically from the day number by picking an
// archetype family and parameterized layout; solutions are constructive, so
// every daily is provably solvable offline. Seeds are immutable after
// publication; defective days are flagged excluded, never silently replaced.

import { createStream } from '../rules/rng.js';
import {
  archSlideBell, archPopUp, archFanPush, archMagnetLift, archDemolition,
} from './archetypes.js';
import { stack, crateRow } from './schema.js';

export const DAILY_RULESET = 1; // bump only with a published rules change

// Synchronized to platform time by the session layer; pure function of day.
export function dailySeed(dayNumber) {
  return ((dayNumber * 2654435761) ^ 0x9e3779b9) >>> 0;
}

export function dayNumberFromUTC(ms) {
  return Math.floor(ms / 86400000);
}

const FAMILIES = ['slide', 'popup', 'fan', 'magnet', 'demolition'];
const THEMES = ['brassworks', 'tidepool', 'emberworks', 'nocturne', 'verdant', 'midnight'];

export function dailyLevel(dayNumber) {
  const seed = dailySeed(dayNumber);
  const rng = createStream(seed);
  const family = FAMILIES[rng.int(0, FAMILIES.length - 1)];
  const theme = THEMES[rng.int(0, THEMES.length - 1)];
  const id = `d${dayNumber}`;
  const dateStr = new Date(dayNumber * 86400000).toISOString().slice(0, 10);
  const common = {
    id, name: `Daily ${dateStr}`, chapter: -1, difficulty: 3, theme, seed,
    daily: { day: dayNumber, ruleset: DAILY_RULESET, excluded: EXCLUDED_DAYS.includes(dayNumber) },
  };
  switch (family) {
    case 'slide': {
      const bellX = 2.2 + rng.range(0, 1.4);
      const aimDy = 0.3;
      return archSlideBell({
        ...common, mechanics: ['piston'], bellX, aimDy, minSpeed: 1.2,
        distBonus: rng.next() < 0.5 ? 4 : 0,
        par: { ticks: 420, score: 950, star3: 1050 },
        intro: 'One piston, one bell, one shared world. Everyone gets this exact setup today.',
      });
    }
    case 'popup': {
      const aim = rng.next() < 0.5 ? [0.55, 1] : [0.7, 0.7];
      const zx = aim[0] === 0.55 ? 2.9 : 2.0;
      return archPopUp({
        ...common, mechanics: ['piston'], aim,
        targetZone: { x: zx, y: 0.55, r: 0.65 }, holdTicks: 45, airBonus: 60,
        par: { ticks: 1020, score: 1230, star3: 1580 },
        intro: 'Pop the dummy into the chalk circle and keep it there.',
      });
    }
    case 'fan': {
      const back = [0.8, 1.2, 1.6][rng.int(0, 2)];
      const zx = back === 0.8 ? 1.5 : back === 1.2 ? 2.7 : 3.8;
      return archFanPush({
        ...common, mechanics: ['fan'], fanBack: back,
        targetZone: { x: Math.min(zx, 4.6), y: 0.5, r: 0.75 }, holdTicks: 45,
        par: { ticks: 1140, score: 990, star3: 1260 },
        intro: 'A single gust stands between the dummy and the circle.',
      });
    }
    case 'magnet': {
      return archMagnetLift({
        ...common, mechanics: ['magnet'], magnetY: 2.6 + rng.range(0, 0.5),
        bell: { x: -3, y: 2.5, r: 0.42, minSpeed: 1.0 },
        par: { ticks: 300, score: 960, star3: 1080 },
        intro: 'Ring the high bell with nothing but magnetism.',
      });
    }
    default: {
      const n = rng.int(2, 3);
      const x = 2.4 + rng.range(0, 0.8);
      return archDemolition({
        ...common, mechanics: ['weight'], useWeight: true, count: n,
        crates: stack(x, n), dropX: x - 0.3, dropY: 3.4,
        par: { ticks: 1200, score: 1000, star3: 1280 },
        intro: 'Today’s order: reduce the stack to rubble.',
      });
    }
  }
}

// Defective days are excluded from ranking, never replaced (spec §2).
export const EXCLUDED_DAYS = [];
