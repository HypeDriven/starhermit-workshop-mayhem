// Display helpers over the string tables (assets/strings.json: flat keys,
// `group.id` for content groups): the client binds the engine's `strings`, the
// tests a table of their own.
let impl = {
  t: (key) => key,
  tn: (group, id, fallback = id) => fallback,
  locale: () => 'en-US',
};
export function bindStrings(next) { impl = next; }

/** Flat UI string with {var} substitution. */
export function t(key, vars) { return impl.t(key, vars); }

/** Content-group lookup (levels, tools, themes…), else `fallback`. */
export function tn(group, id, fallback = id) { return impl.tn(group, id, fallback); }

export function locale() { return impl.locale(); }

/** The daily families' English intros (src/content/daily.js): their keys in `dailyIntros`. */
export const DAILY_INTRO_KEYS = {
  'One piston, one bell, one shared world. Everyone gets this exact setup today.': 'slide',
  'Pop the dummy into the chalk circle and keep it there.': 'popup',
  'A single gust stands between the dummy and the circle.': 'fan',
  'Ring the high bell with nothing but magnetism.': 'magnet',
  'Today’s order: reduce the stack to rubble.': 'demolition',
};

// --- content display helpers ------------------------------------------------------

const LEVEL_ID = /^([jct]\d+)(?:-practice-(easy|hard))?$/;

/** Display name of a level object (journey, challenge, lesson, practice variant, daily). */
export function levelName(lv) {
  if (!lv) return '';
  if (lv.daily) return t('dailyName', { date: new Date(lv.daily.day * 86400000).toISOString().slice(0, 10) });
  const m = LEVEL_ID.exec(lv.id || '');
  if (!m) return lv.name;
  const base = m[1].startsWith('t')
    ? t('lessonName', { name: tn('lessons', m[1], lv.name) })
    : tn('levels', m[1], lv.name);
  return m[2] ? t(`practiceName_${m[2]}`, { name: base }) : base;
}

/** Short lesson title (Learn screen cards). */
export function lessonTitle(lv) { return tn('lessons', lv.id, lv.name); }

export function levelIntro(lv) {
  if (!lv?.intro) return '';
  if (lv.daily) {
    const fam = DAILY_INTRO_KEYS[lv.intro];
    return fam ? tn('dailyIntros', fam, lv.intro) : lv.intro;
  }
  const m = LEVEL_ID.exec(lv.id || '');
  return m ? tn('intros', m[1], lv.intro) : lv.intro;
}

export function stepText(lv, i) {
  const m = LEVEL_ID.exec(lv?.id || '');
  const fallback = lv?.tutorial?.steps?.[i]?.text ?? '';
  return m ? tn('steps', `${m[1]}.${i}`, fallback) : fallback;
}

export const toolName = (key) => tn('tools', key);
export const toolShort = (key) => tn('toolShort', key);
export const toolBlurb = (key) => tn('toolBlurbs', key);
export const themeName = (id) => tn('themeNames', id);
export const themeBlurb = (id) => tn('themeBlurbs', id);
export const achName = (key) => tn('achNames', key);
export const achDesc = (key) => tn('achDescs', key);
export const chapterName = (n) => tn('chapters', String(n));
export const bindingLabel = (action) => tn('bindings', action);
export const invalidText = (reason) => tn('invalid', reason, reason);
export const captionText = (key) => tn('captions', key, key);

export function reasonText(reason) {
  const key = {
    'out-of-actions': 'reason_outOfActions', 'time-limit': 'reason_timeLimit',
    'move-limit': 'reason_moveLimit', abandoned: 'reason_abandoned',
  }[reason];
  return t(key || 'reason_other');
}

/** Number formatting in the current locale (decimal comma where expected). */
export function num(n, digits = 0) {
  try {
    return new Intl.NumberFormat(impl.locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
  } catch { return Number(n).toFixed(digits); }
}
