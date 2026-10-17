// Español (España): es-419 with Peninsular usage (suelo, ordenador-style wording, «tirar»).
import LA from './es-419.js';

export default {
  ...LA,
  jamTitle: 'Algo se ha atascado',
  jamBody: 'El taller no ha podido arrancar: {msg}',
  sync_error: 'Fallo de sincronización: se volverá a intentar automáticamente.',
  settings: 'Ajustes',
  settingsBtn: '⚙ Ajustes',
  gamepadHelp: 'el joystick mueve el cursor, A coloca, X activa, B cancela, Start pausa. Reasigna en Ajustes.',
  gamepad: 'Mando',
  gamepadConnected: 'Mando conectado',
  place_ground: 'suelos y repisas',
  modeBoards: 'Clasificaciones globales y de amigos para cada nivel. Ve a por la corona.',
  practiceNote: 'La práctica nunca afecta a las clasificaciones. Reinicios y deshacer son gratis.',
  pressKey: 'pulsa una tecla…',
  guestChip: 'Invitado: pulsa para guardar el progreso',
  awayNote: 'Mientras estabas fuera ({n} s), la simulación ha estado en pausa. No se ha movido nada.',
  'invalid': {
    ...LA.invalid,
    'terminal-state': 'La ronda ha terminado.',
    'not-on-ground': 'Los Boing deben fijarse a un suelo o una repisa.',
  },
  toolBlurbs: {
    ...LA.toolBlurbs,
    pad: 'Un disco trampolín que chirría. Se fija a suelos y repisas.',
    magnet: 'Atrae hacia sí todo lo que sea de peluche durante un rato.',
  },
  intros: {
    ...LA.intros,
    j03: 'Un Cojín Boing en el suelo impulsa todo lo que se desliza por encima.',
    j04: 'Algunos soportes están en el suelo y disparan hacia arriba. Toca la campana colgante de paso.',
    j13: 'El muñeco está en una estantería. Sóplalo por el borde y a través del suelo.',
    j25: 'El Imán Atrapón tira del peluche hacia arriba. Toca la campana de paso.',
    j27: 'Una división alta bloquea el suelo. Pasa por encima.',
    t2: 'Algunos soportes están en el suelo y disparan hacia arriba.',
    t5: 'El Imán Atrapón atrae hacia sí todo lo que sea de peluche.',
  },
  lessons: { ...LA.lessons, t2: 'Soportes de suelo' },
  steps: {
    ...LA.steps,
    't2.0': 'Este soporte está en el suelo. Coloca el pistón ahí.',
  },
};
