// Localization: the engine's string tables (assets/strings.json: the nine
// StarHermit locales, content groups as `group.id`) in the interface language
// the runtime reports (the player's choice in Options › Language, else the
// account's preferred language or the device's); the engine's fallback chain
// picks the table. The account lines are the engine's own `starhermit.*` strings.
// Every string is drawn through T() each frame, so a change shows on the next
// frame and never restarts a round or its clock.
import {files, preferences, strings} from "starhermit:engine";

// Locale tables are split per language. Only the player's fallback chain is
// parsed and kept (en-US first, so it remains the default). Other locales stay
// in the package until the language changes.
const __stringLocales = new Set<string>();
let __stringsBusy = false;
let __stringsWatching = false;
function loadGameStrings(dir: string): void {
  if (__stringsBusy) return;
  __stringsBusy = true;
  try {
    let tag = "en";
    try {
      const language = preferences().language;
      if (language) tag = language;
    } catch { /* preferences are not ready while the module is still loading */ }
    const want = stringLocalesFor(tag);
    const ordered = [...want.filter((locale) => locale === "en-US"), ...want.filter((locale) => locale !== "en-US")];
    const batch: { [locale: string]: unknown } = {};
    for (const locale of ordered) {
      if (__stringLocales.has(locale)) continue;
      const path = `${dir}/${locale}.json`;
      if (!files.exists(path)) continue;
      const table = files.readJson(path);
      if (!table || typeof table !== "object" || Array.isArray(table)) continue;
      batch[locale] = table;
    }
    const added = Object.keys(batch);
    if (added.length) {
      strings.load(batch);
      for (const locale of added) __stringLocales.add(locale);
    }
  } finally {
    __stringsBusy = false;
  }
  if (!__stringsWatching) {
    __stringsWatching = true;
    strings.onChange(() => loadGameStrings(dir));
  }
}
function stringLocalesFor(tag: string): string[] {
  const out: string[] = [];
  const add = (locale: string): void => { if (locale && !out.includes(locale)) out.push(locale); };
  const bits = tag.replace(/_/g, "-").split("-").filter(Boolean);
  const language = (bits[0] || "en").toLowerCase();
  const regionBit = bits.slice(1).find((part) => /^[A-Za-z]{2}$/.test(part) || /^\d{3}$/.test(part));
  const region = regionBit ? (/^\d{3}$/.test(regionBit) ? regionBit : regionBit.toUpperCase()) : "";
  add(region ? `${language}-${region}` : language);
  if (bits.length > 2) {
    add(bits.map((part, index) => index === 0 ? language : (/^[A-Za-z]{2}$/.test(part) ? part.toUpperCase() : part)).join("-"));
  }
  if (language === "en" && region && region !== "US" && region !== "CA") add("en-001");
  if (language === "en" && region && region !== "US") add("en-GB");
  if (language === "es" && region !== "ES") add("es-419");
  if (language === "es") add("es-ES");
  if (language === "fr") add("fr-FR");
  if (language === "fr" && region === "CA") add("fr-CA");
  if (language === "de") add("de-DE");
  if (language === "pt" && region !== "BR") add("pt-PT");
  if (language === "pt") add("pt-BR");
  if (language === "it") add("it-IT");
  if (language === "nl") add("nl-NL");
  if (language === "ja") add("ja-JP");
  if (language === "zh") {
    const traditional = region === "HK" || region === "TW" || region === "MO";
    add(traditional ? "zh-HK" : "zh-CN");
    if (!traditional) add("zh-SG");
  }
  if (language === "yue") add("yue-HK");
  if (language === "ru") add("ru-FI");
  add(language);
  add("en-US");
  return out;
}
import * as ui from "starhermit:ui";
import * as I from "../src/ui/i18n.js";
import * as A from "../src/ui/a11y.js";
import type { Goal, Level } from "./game.ts";

type Vars = Record<string, string | number>;
const L = I as unknown as {
  bindStrings(b: { t(k: string, v?: Vars): string; tn(g: string, id: string, fallback?: string): string; locale(): string }): void;
  locale(): string; t(k: string, v?: Vars): string;
  levelName(lv: Level | null): string; levelIntro(lv: Level | null): string; lessonTitle(lv: Level): string; stepText(lv: Level, i: number): string;
  toolName(k: string): string; toolShort(k: string): string; toolBlurb(k: string): string; themeName(id: string): string; themeBlurb(id: string): string;
  achName(k: string): string; achDesc(k: string): string; chapterName(n: number): string; bindingLabel(a: string): string;
  invalidText(r: string): string; captionText(k: string): string; reasonText(r: string): string; num(n: number, d?: number): string;
};
const A11y = A as unknown as {
  objectiveText(lv: Level): { main: string; bonus: string[] }; goalText(g: Goal): string; goalProgressLabel(g: Goal): string;
};

loadGameStrings("assets/l10n/strings");
strings.defaultLocale = "en-US";
ui.setLanguage(strings.locale);
strings.onChange((locale) => ui.setLanguage(locale));
L.bindStrings({
  t: (k, v) => strings.t(k, v),
  tn: (g, id, fallback = id) => { const k = `${g}.${id}`; return strings.has(k) ? strings.t(k) : fallback; },
  locale: () => strings.locale,
});

export function currentLocale(): string { return strings.locale; }
/** A UI string by key in the player's language; `{name}` placeholders from vars. */
export const T = (key: string, vars?: Vars): string => strings.t(key, vars);
export const levelName = (lv: Level | null): string => L.levelName(lv);
export const levelIntro = (lv: Level | null): string => L.levelIntro(lv);
export const lessonTitle = (lv: Level): string => L.lessonTitle(lv);
export const stepText = (lv: Level, i: number): string => L.stepText(lv, i);
export const toolName = (k: string): string => L.toolName(k);
export const toolShort = (k: string): string => L.toolShort(k);
export const toolBlurb = (k: string): string => L.toolBlurb(k);
export const themeName = (id: string): string => L.themeName(id);
export const themeBlurb = (id: string): string => L.themeBlurb(id);
export const achName = (k: string): string => L.achName(k);
export const achDesc = (k: string): string => L.achDesc(k);
export const chapterName = (n: number): string => L.chapterName(n);
export const bindingLabel = (a: string): string => L.bindingLabel(a);
export const invalidText = (r: string): string => L.invalidText(r);
export const captionText = (k: string): string => L.captionText(k);
export const reasonText = (r: string): string => L.reasonText(r);
export const num = (n: number, d = 0): string => L.num(n, d);
export const objectiveText = (lv: Level): { main: string; bonus: string[] } => A11y.objectiveText(lv);
export const goalText = (g: Goal): string => A11y.goalText(g);
export const goalProgressLabel = (g: Goal): string => A11y.goalProgressLabel(g);
