// Localization: every key in every one of the nine locales, matching {vars},
// every t('key') used in the source exists, and every content id (levels,
// lessons, tools, themes, achievements, bindings, invalid reasons) has a name.
import fs from 'node:fs';
import path from 'node:path';
import { suite, ok, eq } from './harness.mjs';
import { STRINGS, SUPPORTED, setLocale, t, levelName, levelIntro, stepText, reasonText } from '../src/ui/i18n.js';
import { JOURNEY, CHALLENGES } from '../src/content/stages.js';
import { TUTORIALS } from '../src/content/tutorials.js';
import { THEME_ORDER } from '../src/content/themes.js';
import { ACHIEVEMENTS } from '../src/content/achievements.js';
import { TOOLS, INVALID } from '../src/rules/engine.js';
import { BINDING_LABELS } from '../src/ui/input.js';
import { dailyLevel } from '../src/content/daily.js';

const LOCALES = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];
const EN = STRINGS['en-US'];
const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

suite('i18n: nine locales with every key and matching placeholders', () => {
  eq(SUPPORTED, LOCALES, 'supported locales');
  for (const loc of LOCALES) {
    const d = STRINGS[loc];
    for (const [k, v] of Object.entries(EN)) {
      if (typeof v === 'object') {
        for (const [id, s] of Object.entries(v)) {
          ok(typeof d[k]?.[id] === 'string' && d[k][id].length, `${loc} missing ${k}.${id}`);
          eq(vars(d[k][id]), vars(s), `${loc} ${k}.${id} placeholders`);
        }
      } else {
        ok(typeof d[k] === 'string' && d[k].length, `${loc} missing ${k}`);
        eq(vars(d[k]), vars(v), `${loc} ${k} placeholders`);
      }
    }
    for (const k of Object.keys(d)) ok(k in EN, `${loc} has unknown key ${k}`);
  }
});

suite('i18n: every t() key used in the source exists', () => {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'strings') walk(p); } else if (p.endsWith('.js')) files.push(p);
    }
  };
  walk(new URL('../src', import.meta.url).pathname);
  let seen = 0;
  for (const f of files) {
    if (/gfx-panel|platform-strings/.test(f)) continue; // own tables, tested in gfx.test
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\b(?:t|translate)\(\s*'([A-Za-z0-9_]+)'(?!\s*\+)/g)) {
      seen++;
      ok(typeof EN[m[1]] === 'string', `${path.basename(f)}: unknown key ${m[1]}`);
    }
    for (const m of src.matchAll(/data-i18n(?:-aria|-title)?="([A-Za-z0-9_]+)"/g)) ok(typeof EN[m[1]] === 'string', `${path.basename(f)}: unknown data-i18n ${m[1]}`);
  }
  ok(seen > 100, `found ${seen} keys`);
});

suite('i18n: content ids all have names in the tables', () => {
  for (const lv of [...JOURNEY, ...CHALLENGES]) {
    ok(EN.levels[lv.id] === lv.name, `level name ${lv.id}`);
    ok(EN.intros[lv.id] === lv.intro.replace('three-metre', 'three-meter'), `intro ${lv.id}`);
  }
  for (const lv of TUTORIALS) {
    ok(EN.lessons[lv.id], `lesson ${lv.id}`);
    eq(EN.intros[lv.id], lv.intro, `lesson intro ${lv.id}`);
    lv.tutorial.steps.forEach((s, i) => eq(EN.steps[`${lv.id}.${i}`], s.text, `step ${lv.id}.${i}`));
  }
  for (const id of THEME_ORDER) ok(EN.themeNames[id] && EN.themeBlurbs[id], `theme ${id}`);
  for (const a of ACHIEVEMENTS) ok(EN.achNames[a.key] === a.name && EN.achDescs[a.key] === a.desc, `achievement ${a.key}`);
  for (const k of Object.keys(TOOLS)) ok(EN.tools[k] === TOOLS[k].name && EN.toolBlurbs[k] === TOOLS[k].blurb && EN.toolShort[k], `tool ${k}`);
  for (const k of Object.keys(BINDING_LABELS)) eq(EN.bindings[k], BINDING_LABELS[k], `binding ${k}`);
  for (const r of Object.values(INVALID)) ok(EN.invalid[r], `invalid reason ${r}`);
  for (let day = 20000; day < 20040; day++) {
    const lv = dailyLevel(day);
    ok(Object.values(EN.dailyIntros).includes(lv.intro), `daily intro ${day}`);
  }
});

suite('i18n: helpers follow the locale', () => {
  setLocale('de-DE');
  eq(t('settings'), 'Einstellungen', 'flat key');
  eq(levelName(JOURNEY[0]), 'Weck den Dummy', 'level');
  eq(levelName({ ...JOURNEY[0], id: 'j01-practice-easy' }), 'Weck den Dummy (leicht)', 'practice variant');
  eq(levelName(TUTORIALS[0]), 'Lektion: Der Kolben', 'lesson');
  ok(/^Tag \d{4}-\d\d-\d\d$/.test(levelName(dailyLevel(20000))), 'daily');
  ok(levelIntro(dailyLevel(20000)) !== dailyLevel(20000).intro, 'daily intro translated');
  eq(stepText(TUTORIALS[0], 0), 'Wähle den Wumms-Kolben in der Werkzeugleiste.', 'tutorial step');
  eq(reasonText('time-limit'), 'Zeit abgelaufen', 'reason');
  setLocale('xx-YY');
  eq(t('settings'), 'Settings', 'unknown locale falls back to en-US');
  setLocale('en-US');
});
