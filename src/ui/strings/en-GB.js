// UK English: US table with British spelling.
import US from './en-US.js';

export default {
  ...US,
  startPractice: 'Start practising',
  colorPalette: 'Colour palette',
  goal_distance: 'Send the dummy {n} metres from home',
  mirror_dummy: 'Dummy at {x} metres right, {y} up',
  intros: {
    ...US.intros,
    j14: 'Weaponise the breeze: the dummy becomes a very soft bowling ball.',
    j36: 'A three-metre wall says no. The magnet disagrees.',
  },
};
