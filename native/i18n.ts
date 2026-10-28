// Localization: the browser build's tables (src/ui/strings/*.js through
// src/ui/i18n.js: symbolic keys, the nine StarHermit locales; the account
// strings in src/ui/platform-strings.js) in the interface language the
// runtime reports (preferences().language: the player's choice in Options ›
// Language, else the account's preferred language or the device's). The
// runtime's Options replace the game's own Language setting (sh-language.js)
// and the DOM re-labelling: every string is drawn through T() each frame, so
// a change shows on the next frame and never restarts a round or its clock.
import { onPreferencesChange, preferences } from "starhermit:engine";
import * as ui from "starhermit:ui";
import * as I from "../src/ui/i18n.js";
import * as A from "../src/ui/a11y.js";
import { platformStrings } from "../src/ui/platform-strings.js";
import type { Goal, Level } from "./game.ts";

type Vars = Record<string, string | number>;
const L = I as unknown as {
  SUPPORTED: string[]; setLocale(l: string): void; locale(): string; t(k: string, v?: Vars): string;
  levelName(lv: Level | null): string; levelIntro(lv: Level | null): string; lessonTitle(lv: Level): string; stepText(lv: Level, i: number): string;
  toolName(k: string): string; toolShort(k: string): string; toolBlurb(k: string): string; themeName(id: string): string; themeBlurb(id: string): string;
  achName(k: string): string; achDesc(k: string): string; chapterName(n: number): string; bindingLabel(a: string): string;
  invalidText(r: string): string; captionText(k: string): string; reasonText(r: string): string; num(n: number, d?: number): string;
};
const A11y = A as unknown as {
  objectiveText(lv: Level): { main: string; bonus: string[] }; goalText(g: Goal): string; goalProgressLabel(g: Goal): string;
};

/** The supported locale for a language tag (exact, then by language, else en-US). */
export function pickLocale(tag: string): string {
  const t = String(tag || "en-US");
  if (L.SUPPORTED.includes(t)) return t;
  const lang = t.split("-")[0]!.toLowerCase();
  const region = (t.split("-")[1] ?? "").toUpperCase();
  if (lang === "es") return region && region !== "ES" ? "es-419" : "es-ES";
  if (lang === "pt") return "pt-BR";
  if (lang === "fr") return region === "CA" ? "fr-CA" : "fr-FR";
  if (lang === "en") return ["GB", "IE", "AU", "NZ", "ZA", "IN"].includes(region) ? "en-GB" : "en-US";
  return L.SUPPORTED.find((s) => s.split("-")[0] === lang) ?? "en-US";
}
let locale = "";
function apply(tag: string): void {
  const next = pickLocale(tag);
  if (next === locale) return;
  locale = next;
  L.setLocale(locale);
  ui.setLanguage(locale);
}
apply(preferences().language);
onPreferencesChange((p) => apply(p.language));

export function currentLocale(): string { return locale; }
/** A UI string by key in the player's language; `{name}` placeholders from vars. */
export const T = (key: string, vars?: Vars): string => L.t(key, vars);
/** The account strings (signIn, invite, inviteCopied, inviteFailed, signedOut, lbPosting, lbRank, lbPosted, lbNotPosted). */
export function S(key: string, vars?: Vars): string {
  return String((platformStrings as unknown as (l: string) => (k: string, v?: Vars) => string)(locale)(key, vars));
}
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
