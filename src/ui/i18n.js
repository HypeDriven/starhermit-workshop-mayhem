// Localization runtime: one language source for every string module (UI,
// Graphics panel, StarHermit buttons). The locale comes from sh-language.js
// (loaded as a classic script before the game modules): explicit game choice
// (`ui.language`) → StarHermit account preferredLanguage → navigator.languages
// → en-US. A change re-applies [data-i18n] markup and notifies onLanguage
// listeners so screens, HUD and overlays re-render in place — the round, the
// simulation and progress are untouched.
import enUS from './strings/en-US.js';
import enGB from './strings/en-GB.js';
import es419 from './strings/es-419.js';
import esES from './strings/es-ES.js';
import deDE from './strings/de-DE.js';
import frFR from './strings/fr-FR.js';
import frCA from './strings/fr-CA.js';
import ptBR from './strings/pt-BR.js';
import itIT from './strings/it-IT.js';

export const STRINGS = {
  'en-US': enUS, 'en-GB': enGB, 'es-419': es419, 'es-ES': esES, 'de-DE': deDE,
  'fr-FR': frFR, 'fr-CA': frCA, 'pt-BR': ptBR, 'it-IT': itIT,
};
export const SUPPORTED = Object.keys(STRINGS);
const EN = STRINGS['en-US'];

let lang = 'en-US';
let dict = EN;
const listeners = new Set();

function fill(s, vars) {
  if (!vars) return s;
  return String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

/** Flat UI string with {var} substitution and en-US fallback. */
export function t(key, vars) {
  const s = dict[key] != null ? dict[key] : (EN[key] != null ? EN[key] : key);
  return fill(s, vars);
}

/** Content-group lookup (levels, tools, themes…) with en-US then `fallback`. */
export function tn(group, id, fallback = id) {
  const own = dict[group]?.[id];
  if (own != null) return own;
  const en = EN[group]?.[id];
  return en != null ? en : fallback;
}

export function locale() { return lang; }

export function onLanguage(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Re-apply data-i18n / -aria / -title / -placeholder below `root`. */
export function applyDom(root = globalThis.document) {
  if (!root?.querySelectorAll) return;
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
}

export function setLocale(next) {
  lang = STRINGS[next] ? next : 'en-US';
  dict = STRINGS[lang];
  const doc = globalThis.document;
  if (doc?.documentElement) doc.documentElement.lang = lang;
  if (doc && doc.readyState !== 'loading') applyDom(doc);
  for (const fn of [...listeners]) {
    try { fn(lang); } catch (err) { console.error(err); }
  }
}

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
    const fam = Object.keys(EN.dailyIntros).find((k) => EN.dailyIntros[k] === lv.intro);
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
    return new Intl.NumberFormat(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
  } catch { return Number(n).toFixed(digits); }
}

// --- language source ------------------------------------------------------------------
const SL = globalThis.StarHermitLanguage;
export const language = (SL && globalThis.document)
  ? SL.create({ game: 'workshop-mayhem', supported: SUPPORTED, apply: (l) => setLocale(l) })
  : null;
if (!language) setLocale('en-US');
