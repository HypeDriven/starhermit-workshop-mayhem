// Learn mode: interactive lessons. Each lesson introduces exactly one rule and
// requires the player to perform the action; steps are validated against the
// same legal-action API used by play (spec §2 modes: Learn).
import { archSlideBell, archPopUp, archFanPush, archMagnetLift, archDemolition } from './archetypes.js';
import { stack } from './schema.js';

function lesson(base, steps) {
  base.tutorial = { steps, replayable: true };
  return base;
}

export const TUTORIALS = [
  lesson(archSlideBell({
    id: 't1', name: 'Lesson: The Piston', chapter: 0, difficulty: 1, theme: 'brassworks',
    mechanics: ['piston'], bellX: 0.8, aimDy: 0.2, minSpeed: 1.2,
    par: { ticks: 300, score: 720, star3: 940 },
    intro: 'Meet the Wallop Piston.',
  }), [
    { text: 'Select the Wallop Piston in the tool tray.', expect: { ui: 'select-tool', tool: 'piston' } },
    { text: 'Place it on the glowing wall mount.', expect: { do: 'place', tool: 'piston' }, hint: { x: -4.7, y: 0.9, mountId: 'mw' } },
    { text: 'Aim toward the bell (drag or use the aim keys), then confirm.', expect: { ui: 'aim' } },
    { text: 'Trigger the piston and watch the dummy fly!', expect: { do: 'trigger' } },
  ]),

  lesson(archPopUp({
    id: 't2', name: 'Lesson: Floor Mounts', chapter: 0, difficulty: 1, theme: 'brassworks',
    mechanics: ['piston'], aim: [0, 1], bell: { x: -3, y: 2.55, r: 0.45, minSpeed: 1.0 },
    par: { ticks: 240, score: 750, star3: 970 },
    intro: 'Some mounts live on the floor and fire upward.',
  }), [
    { text: 'This mount is on the floor. Place the piston on it.', expect: { do: 'place', tool: 'piston' }, hint: { x: -3.35, y: 0.12, mountId: 'mf' } },
    { text: 'Aim straight up, then confirm.', expect: { ui: 'aim' } },
    { text: 'Trigger it and enjoy the view.', expect: { do: 'trigger' } },
  ]),

  lesson(archFanPush({
    id: 't3', name: 'Lesson: The Gust Fan', chapter: 0, difficulty: 1, theme: 'tidepool',
    mechanics: ['fan'], fanBack: 1.0, targetZone: { x: 2.0, y: 0.5, r: 0.85 }, holdTicks: 40,
    par: { ticks: 1080, score: 750, star3: 980 },
    intro: 'The Gust Fan blows a cone of air for about two seconds.',
  }), [
    { text: 'Place the fan behind the dummy, pointing at the circle.', expect: { do: 'place', tool: 'fan' }, hint: { x: -4.0, y: 0.7, dx: 1, dy: 0.08 } },
    { text: 'Trigger the fan and ride the breeze.', expect: { do: 'trigger' } },
  ]),

  lesson(archDemolition({
    id: 't4', name: 'Lesson: The Thumper', chapter: 0, difficulty: 1, theme: 'emberworks',
    mechanics: ['weight'], useWeight: true, count: 2, crates: stack(2.6, 2), dropX: 2.7,
    par: { ticks: 1440, score: 770, star3: 1000 },
    intro: 'The Thumper Weight hangs in mid-air until released.',
  }), [
    { text: 'Place the weight above the crate stack.', expect: { do: 'place', tool: 'weight' }, hint: { x: 2.7, y: 3.2 } },
    { text: 'Release it. Timber!', expect: { do: 'trigger' } },
  ]),

  lesson(archMagnetLift({
    id: 't5', name: 'Lesson: The Magnet', chapter: 0, difficulty: 1, theme: 'nocturne',
    mechanics: ['magnet'], magnetY: 2.8, bell: { x: -3, y: 2.55, r: 0.45, minSpeed: 1.0 },
    par: { ticks: 240, score: 740, star3: 950 },
    intro: 'The Snatch Magnet pulls everything plush toward itself.',
  }), [
    { text: 'Place the magnet high above the dummy.', expect: { do: 'place', tool: 'magnet' }, hint: { x: -3, y: 2.8 } },
    { text: 'Switch it on. Up we go!', expect: { do: 'trigger' } },
  ]),
];

export function tutorialById(id) { return TUTORIALS.find(t => t.id === id) || null; }
