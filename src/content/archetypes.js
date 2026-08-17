// Stage archetypes: authored play patterns parameterized into many stages.
// Every archetype emits a constructive reference solution built from the same
// parameters as the layout; the offline validator replays each solution
// through the real rules engine to prove reachability (spec §2 validators).
//
// Physics envelope (measured by tools/calibrate.mjs, mount presets below):
//  - wall piston slide: dummy crosses the arena low; dy 0.2-0.45 -> endX 0..5.5
//  - floor piston (0,1): straight up ~3.7m, ~240 air ticks
//  - floor piston (0.2,1): arc to x ~ +8.4 relative, apex ~3.9m
//  - floor piston (0.45,1): arc lands ~ +5.3 relative, apex ~3.4m
//  - fan strength 20: back 0.8 -> +2.6m, 1.4 -> +4.2m, 2.2 -> +6.7m
//  - magnet above at h: lifts dummy to ~h+0.5..0.7 peak
//  - weight on stack: scatters crates

import {
  BOUNDS, arena, floor, ledge, wall, ramp, peg, stack, crateRow,
  gBell, gZone, gDistance, gTopple, gAir, gSpeed, gScore,
  sPlace, sTrigger, CONTENT_VERSION,
} from './schema.js';

const M_WALL_L = { id: 'mw', x: -4.7, y: 0.9 };   // left wall, slide shots
const M_WALL_L2 = { id: 'mw2', x: -4.7, y: 2.2 };  // left wall, high shots
const M_FLOOR = { id: 'mf', x: -3.35, y: 0.12 };   // floor pop-up launcher

let uid = 0;
function base(p) {
  const b = p.bounds || BOUNDS;
  return {
    id: p.id, version: CONTENT_VERSION, seed: p.seed ?? (1000 + (uid++)),
    name: p.name, chapter: p.chapter || 0, difficulty: p.difficulty || 1,
    theme: p.theme || 'brassworks', mechanics: p.mechanics || [],
    bounds: { ...b },
    dummy: p.dummy || { x: -3, y: 0 },
    statics: { segments: p.noArena ? [] : [...arena(b)], circles: [] },
    props: [], mounts: [], bells: [], zones: [],
    goals: [], tools: {}, solution: [],
    par: p.par || { ticks: 2400, score: 1000, star3: 1500 },
    maxTicks: p.maxTicks || 7200,
    intro: p.intro || '',
    tutorial: p.tutorial || null,
    challenge: p.challenge || null,
    daily: p.daily || null,
  };
}

// 1. Slide shot into a ground bell (optionally through/around crates).
export function archSlideBell(p) {
  const L = base(p);
  const bx = p.bellX, aimDy = p.aimDy ?? 0.3;
  L.mounts.push({ ...M_WALL_L });
  L.bells.push({ x: bx, y: p.bellY ?? 0.35, r: p.bellR ?? 0.38, minSpeed: p.minSpeed ?? 1.8 });
  L.goals.push(gBell(0, p.minSpeed ?? 1.8, true));
  if (p.crates) L.props.push(...p.crates);
  if (p.airBonus) L.goals.push(gAir(p.airBonus, false));
  if (p.distBonus) L.goals.push(gDistance(p.distBonus, false));
  L.tools.piston = 1;
  if (p.extraPiston) L.tools.piston += p.extraPiston;
  L.solution.push(sPlace('piston', M_WALL_L.x, M_WALL_L.y, 1, aimDy, M_WALL_L.id), sTrigger());
  return L;
}

// 2. Pop-up launch: floor piston arcs the dummy onto a target (zone or bell).
export function archPopUp(p) {
  const L = base(p);
  const aim = p.aim || [0.45, 1];
  L.mounts.push({ ...M_FLOOR, ...(p.mountPos || {}) });
  const mp = L.mounts[0];
  if (p.targetZone) {
    L.zones.push(p.targetZone);
    L.goals.push(gZone(p.targetZone.x, p.targetZone.y, p.targetZone.r, p.holdTicks ?? 45, true));
  }
  if (p.bell) {
    L.bells.push(p.bell);
    L.goals.push(gBell(0, p.bell.minSpeed ?? 1.5, true));
  }
  if (p.ledge) L.statics.segments.push(ledge(...p.ledge));
  if (p.extraStatics) L.statics.segments.push(...p.extraStatics);
  if (p.crates) L.props.push(...p.crates);
  if (p.airBonus) L.goals.push(gAir(p.airBonus, false));
  L.tools.piston = 1;
  L.solution.push(sPlace('piston', mp.x, mp.y, aim[0], aim[1], mp.id), sTrigger());
  return L;
}

// 3. Pad-assisted slide: pad boosts the dummy to a far target.
export function archPadBoost(p) {
  const L = base(p);
  L.mounts.push({ ...M_WALL_L });
  const padX = p.padX;
  if (p.bell) {
    L.bells.push(p.bell);
    L.goals.push(gBell(0, p.bell.minSpeed ?? 1.5, true));
  }
  if (p.speedGoal) L.goals.push(gSpeed(p.speedGoal, !p.bell));
  if (p.targetZone) {
    L.zones.push(p.targetZone);
    L.goals.push(gZone(p.targetZone.x, p.targetZone.y, p.targetZone.r, p.holdTicks ?? 45, !p.bell && !p.speedGoal));
  }
  if (p.distGoal) L.goals.push(gDistance(p.distGoal, !p.bell && !p.speedGoal && !p.targetZone));
  if (p.crates) L.props.push(...p.crates);
  if (p.extraStatics) L.statics.segments.push(...p.extraStatics);
  L.tools.piston = 1; L.tools.pad = 1;
  L.solution.push(
    sPlace('pad', padX, 0.1),
    sPlace('piston', M_WALL_L.x, M_WALL_L.y, 1, p.aimDy ?? 0.25, M_WALL_L.id),
    sTrigger(),
  );
  return L;
}

// 4. Fan push: place a fan to blow the dummy into a zone / onto a bell.
export function archFanPush(p) {
  const L = base(p);
  const fx = p.fanX ?? L.dummy.x - (p.fanBack ?? 1.2);
  const fy = p.fanY ?? 0.7;
  const fdir = p.fanDir || [1, 0.08];
  if (p.targetZone) {
    L.zones.push(p.targetZone);
    L.goals.push(gZone(p.targetZone.x, p.targetZone.y, p.targetZone.r, p.holdTicks ?? 45, true));
  }
  if (p.bell) {
    L.bells.push(p.bell);
    L.goals.push(gBell(0, p.bell.minSpeed ?? 1.5, true));
  }
  if (p.distGoal) L.goals.push(gDistance(p.distGoal, true));
  if (p.ledge) L.statics.segments.push(ledge(...p.ledge));
  if (p.extraStatics) L.statics.segments.push(...p.extraStatics);
  if (p.crates) L.props.push(...p.crates);
  if (p.toppleGoal) L.goals.push(gTopple(p.toppleGoal, !p.targetZone && !p.bell && !p.distGoal));
  L.tools.fan = 1;
  L.solution.push(sPlace('fan', fx, fy, fdir[0], fdir[1]), sTrigger());
  return L;
}

// 5. Magnet lift/carry: raise the dummy over an obstacle or onto a perch.
export function archMagnetLift(p) {
  const L = base(p);
  const mx = p.magnetX ?? L.dummy.x;
  const my = p.magnetY ?? 2.8;
  if (p.targetZone) {
    L.zones.push(p.targetZone);
    L.goals.push(gZone(p.targetZone.x, p.targetZone.y, p.targetZone.r, p.holdTicks ?? 45, true));
  }
  if (p.bell) {
    L.bells.push(p.bell);
    L.goals.push(gBell(0, p.bell.minSpeed ?? 1.2, true));
  }
  if (p.airGoal) L.goals.push(gAir(p.airGoal, true));
  if (p.wallSeg) L.statics.segments.push(wall(...p.wallSeg));
  if (p.ledge) L.statics.segments.push(ledge(...p.ledge));
  if (p.extraStatics) L.statics.segments.push(...p.extraStatics);
  L.tools.magnet = 1;
  L.solution.push(sPlace('magnet', mx, my), sTrigger());
  return L;
}

// 6. Crate demolition: weight drop (or piston slam) topples crates.
export function archDemolition(p) {
  const L = base(p);
  L.props.push(...p.crates);
  L.goals.push(gTopple(p.count, true));
  if (p.useWeight) {
    L.tools.weight = 1;
    L.solution.push(sPlace('weight', p.dropX, p.dropY ?? 3.2), sTrigger());
  } else {
    L.mounts.push({ ...M_WALL_L });
    L.tools.piston = 1;
    L.solution.push(sPlace('piston', M_WALL_L.x, M_WALL_L.y, 1, p.aimDy ?? 0.3, M_WALL_L.id), sTrigger());
  }
  if (p.distBonus) L.goals.push(gDistance(p.distBonus, false));
  return L;
}

// 7. Air show: floor piston (+optional pad) for cumulative air time.
export function archAirShow(p) {
  const L = base(p);
  L.mounts.push({ ...M_FLOOR, ...(p.mountPos || {}) });
  const mp = L.mounts[0];
  L.goals.push(gAir(p.airTicks, true));
  if (p.bell) {
    L.bells.push(p.bell);
    L.goals.push(gBell(0, p.bell.minSpeed ?? 1.2, false));
  }
  L.tools.piston = 1;
  const aim = p.aim || [0, 1];
  if (p.withPad) {
    L.tools.pad = 1;
    L.solution.push(sPlace('pad', p.padX ?? L.dummy.x, 0.1));
  }
  L.solution.push(sPlace('piston', mp.x, mp.y, aim[0], aim[1], mp.id), sTrigger());
  return L;
}

// 8. Timed chain (mastery): place several tools, trigger them on a schedule.
// entries: [{at:'settled'|ticks, cmd}] — validator triggers after settle or
// after N ticks from chain start, enabling mid-flight setups.
export function archChain(p) {
  const L = base(p);
  for (const m of p.mounts || []) L.mounts.push(m);
  for (const s of p.extraStatics || []) L.statics.segments.push(s);
  for (const c of p.props || []) L.props.push(c);
  for (const b of p.bells || []) L.bells.push(b);
  for (const z of p.zones || []) L.zones.push(z);
  for (const g of p.goalDefs || []) L.goals.push(g);
  Object.assign(L.tools, p.toolCounts);
  L.solution.push(...p.plays);
  return L;
}

// timed-trigger solution entries for archChain
export const sWait = (ticks) => ({ do: 'wait', ticks });
export { M_WALL_L, M_WALL_L2, M_FLOOR };
