// The look of the HUD, overlays and screens: the browser build's css/main.css,
// rewritten class-based in tools/ui-style.css and converted once with
// `starhermit css` into assets/ui-style.json (`npm run css`), registered at
// start with the theme the runtime's own widgets (scroll bars, focus rings,
// selects, text fields) take. The runtime's high-contrast option is the old
// body.high-contrast token set.
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";

type Tokens = Record<string, string>;
const BASE: Tokens = {
  ink: "#f4ead8", "ink-dim": "#c8bba0", panel: "#1e1810e0", "panel-solid": "#241d12", accent: "#d8a24a", "accent-2": "#64d8ff",
  good: "#51ff9a", bad: "#ff5151",
};
const CONTRAST: Tokens = {
  ink: "#ffffff", "ink-dim": "#e8e8e8", panel: "#000000eb", "panel-solid": "#000000", accent: "#ffd700", "accent-2": "#00ccff", good: "#00ff88", bad: "#ff4444",
};
let current: Tokens = { ...BASE };
let key = "";
export function initStyles(): void {
  const css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  ui.setFont({ family: "sans-serif" });
  ui.setTheme({
    fontSize: 16, smallSize: 13.6, headingSize: 25.6, padding: 8, spacing: 8, radius: 10,
    text: BASE.ink!, muted: BASE["ink-dim"]!, panel: BASE["panel-solid"]!, control: "#3c2e1abf", hovered: "#5a4628d9",
    pressed: "#6a5230", field: "#00000066", accent: BASE.accent!, focus: BASE["accent-2"]!, outline: "#d8a24a59",
  });
  ui.setTokens(css.tokens);
  ui.setStyles({
    ...css.styles,
    label: { text: { color: "$ink" } },
    paragraph: { text: { color: "$ink" } },
    heading: { text: { color: "$ink" } },
    widget: { focusRing: { color: "$accent-2", width: 3, offset: 2 } },
    scrollArea: { parts: { bar: { background: "#d8a24a80", radius: 4 } } },
    // .scrim: rgba(10, 8, 4, 0.55) behind the pause and results panels
    dialog: { background: "#00000000", padding: 0, parts: { backdrop: { background: "#0a08048c" } } },
  });
  key = "";
  applyTokens(false);
}
export function applyTokens(highContrast: boolean): void {
  const k = String(highContrast);
  if (k === key) return;
  key = k;
  current = { ...BASE, ...(highContrast ? CONTRAST : {}) };
  ui.setTokens(current);
  ui.setTheme({ text: current.ink!, muted: current["ink-dim"]!, accent: current.accent!, focus: current["accent-2"]! });
}
/** A token's current colour (for draw calls, which take real colours). */
export function token(name: string): string { return current[name] ?? "#000000"; }
