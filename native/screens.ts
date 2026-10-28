// The browser build's DOM shell (src/ui/app.js, src/ui/hud.js, css/main.css)
// as starhermit:ui, built every frame over the full-window workshop: the play
// HUD (the objective card with goal bars, the status card with score, time,
// star targets and Pause, the tutorial card, the tool tray with stock badges
// and key hints, the context actions — Trigger, Settle, Undo, Hint, Restart —,
// ⚡ trigger chips over armed tools, the cursor ring, invalid-action toasts,
// captions and the countdown), the pause and results overlays, and every menu
// screen (title, modes, journey map, learn, practice setup, challenges, daily,
// leaderboards, achievements, workshop style, help, settings, profile). The
// old media queries are layouts picked by the window's logical size: wide
// (≥ 1024 px), compact, phone portrait (≤ 700 px wide: actions above the tray,
// both centred) and short landscape (≤ 500 px tall: tool names hidden, the
// status card stacked). The old page's 3D canvas filled the window under the
// DOM; so does the scene here.
import { frame, openMenu } from "starhermit:engine";
import { bindings, requestRebind } from "starhermit:input";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { Achievements, Engine, Stages, Themes, Tutorials, type Goal, type Level, type ToolKey } from "./game.ts";
import {
  S, T, achDesc, achName, bindingLabel, chapterName, goalProgressLabel, lessonTitle, levelIntro, levelName, objectiveText, reasonText,
  stepText, themeBlurb, themeName, toolBlurb, toolName, toolShort, num,
} from "./i18n.ts";
import * as platform from "./platform.ts";
import * as render from "./render.ts";
import {
  TOOL_ORDER, achievementsDoc, app, back, cameraReset, copyInvite, dailyLevel, doSkip, doUndo, fresh, later, leaveRound, nextLabel,
  nextStage, pauseGame, progression, replayTutorials, restartRound, resultsLine, resumeGame, retryStage, route, selectTool, setDisplayName,
  setTheme, showHint, shownName, sfx, signIn, startDaily, startPractice, startStage, triggerFirst, triggerTool, profile, type ScreenName,
} from "./main.ts";
import { token } from "./style.ts";

// ------------------------------------------------------------------ layout helpers
interface Layout { lw: number; lh: number; sc: number; wide: boolean; phone: boolean; land: boolean; sa: { left: number; top: number; right: number; bottom: number } }
function layoutNow(): Layout {
  const f = frame();
  const sc = ui.preferences().scale;
  const sa = f.safeArea;
  const lw = Math.max(1, (f.width - sa.left - sa.right) / sc), lh = Math.max(1, (f.height - sa.top - sa.bottom) / sc);
  return { lw, lh, sc, sa, wide: lw >= 1024, phone: lw <= 700 && lh > lw, land: lh <= 500 && lw > lh };
}
const lastSize = new Map<string, ui.Rect>();
function textWidth(text: string, style: string, kind?: "button" | "heading"): number {
  return ui.measureText(text, { ...(kind ? { kind } : {}), style: [style] }).width / ui.preferences().scale;
}
/** Text up to `width` wide: one label when it fits, else a paragraph. */
function para(text: string, width: number, cls = "text", id?: string): void {
  if (!text) return;
  let u = ui.style(cls);
  if (id) u = u.id(id);
  if (textWidth(text, cls) <= width) u.label(text);
  else u.paragraph(text, Math.max(20, width));
}
interface Btn { id: string; text: string; style?: string; act: () => void; disabled?: boolean; name?: string; selected?: boolean; content?: () => void; width?: number; height?: number }
const buttonWidth = (text: string, style: string): number => textWidth(text, style, "button") + 2;
function button(b: Btn): boolean {
  const style = b.style ?? "btn";
  const opts: ui.ButtonOptions = {};
  if (b.disabled) opts.disabled = true;
  if (b.selected !== undefined) opts.selected = b.selected;
  if (b.content) opts.content = b.content;
  else if (b.width != null && buttonWidth(b.text, style) > b.width) {
    const inner = b.width - 34;
    opts.content = () => { ui.style("wrap").paragraph(b.text, Math.max(20, inner)); };
  } else if (b.name && b.name !== b.text) opts.content = () => { ui.label(b.text); };
  const s: ui.Style = {};
  if (b.width != null) s.width = b.width;
  if (b.height != null) s.height = b.height;
  const hit = ui.style(style, s).id(b.id).button(b.name ?? b.text, opts);
  if (hit && fresh()) later(b.act);
  return hit;
}
/** Buttons in rows that wrap at `width` (flex-wrap). */
function flow(label: string, list: Btn[], width: number, gap = 8, justify: "start" | "center" | "end" = "start", stretch = false): void {
  const rows: Btn[][] = [[]];
  let used = 0;
  const bw = (b: Btn): number => Math.min(width, b.width ?? buttonWidth(b.text, b.style ?? "btn"));
  for (const b of list) {
    const w = bw(b);
    if (rows[rows.length - 1]!.length && used + gap + w > width) { rows.push([]); used = 0; }
    used += (rows[rows.length - 1]!.length ? gap : 0) + w;
    rows[rows.length - 1]!.push(b);
  }
  ui.column(label, () => {
    rows.forEach((row, ri) => ui.row(`${label}-r${ri}`, () => {
      if (stretch) {
        const total = row.reduce((n, b) => n + bw(b), 0);
        const extra = (width - total - gap * (row.length - 1)) / row.length;
        for (const b of row) button({ ...b, width: bw(b) + extra });
      } else for (const b of row) button(b);
    }, { spacing: gap, width, justify, align: "center" }));
  }, { spacing: gap, width });
}
/** CSS repeat(auto-fill, minmax(min, 1fr)). */
function cardGrid(id: string, count: number, w: number, min: number, gap: number, cell: (i: number, cw: number) => void): void {
  const cols = Math.max(1, Math.floor((w + gap) / (min + gap)));
  const cw = (w - (cols - 1) * gap) / cols;
  ui.column(id, () => {
    for (let r = 0; r * cols < count; r++) {
      ui.row(`${id}-r${r}`, () => { for (let i = r * cols; i < Math.min(count, (r + 1) * cols); i++) cell(i, cw); }, { spacing: gap, align: "stretch" });
    }
  }, { spacing: gap, width: w });
}
/** A card button: an optional icon, a bold title and muted lines (.mode-card). */
function cardButton(id: string, icon: string, title: string, lines: [string, string][], cw: number, act: () => void, opts: { disabled?: boolean; selected?: boolean; style?: string } = {}): void {
  const inner = cw - 34;
  button({
    id, text: title, name: [title, ...lines.map((l) => l[0])].join(". "), style: opts.style ?? "mode-card", width: cw, act,
    ...(opts.disabled ? { disabled: true } : {}), ...(opts.selected !== undefined ? { selected: opts.selected } : {}),
    content: () => ui.column(`${id}-face`, () => {
      if (icon) ui.style("mode-icon").label(icon);
      para(title, inner, "card-title");
      for (const [l, cls] of lines) para(l, inner, cls);
    }, { spacing: 6, width: inner }),
  });
}
const stars = (n: number): string => `${"★".repeat(n)}${"☆".repeat(Math.max(0, 3 - n))}`;
/** A placed role-"none" widget painting a window rectangle. */
function paint(id: string, L: Layout, x: number, y: number, w: number, h: number, fn: (r: ui.Rect) => void): void {
  if (w <= 0 || h <= 0) return;
  ui.place(id, { anchor: "top-start", x: (x - L.sa.left) / L.sc, y: (y - L.sa.top) / L.sc }, () => {
    ui.widget("", { role: "none", size: { width: w / L.sc, height: h / L.sc }, draw: fn });
  });
}

// ------------------------------------------------------------------ the frame
export function drawScreens(): void {
  const L = layoutNow();
  const f = frame();
  if (app.screen) fullScreen(L);
  else if (app.session?.state) hud(L);
  if (app.overlay === "pause") pausePanel(L);
  else if (app.overlay === "results") resultsPanel(L);
  toasts(L);
  if (app.busy) {
    ui.place("busy", { anchor: "center" }, () => ui.column("busy-card", () => ui.style("busy").label(app.busy!), { style: "toast-info" }));
  }
  if (app.focusNext) {
    const age = f.frame - app.openedFrame;
    if (age >= 1) ui.setFocus(app.focusNext);
    if (age >= 3) app.focusNext = null;
  }
}

// ------------------------------------------------------------------ HUD (hud.js)
const TOOL_ICONS: Record<ToolKey, string> = { piston: "🥊", pad: "🟢", fan: "🌀", magnet: "🧲", weight: "🏋️" };
function progress01(g: Goal): number {
  switch (g.type) {
    case "bell": return g.done ? 1 : Math.min(0.99, g.best / (g.minSpeed ?? 1));
    case "zone": return g.value / (g.holdTicks ?? 1);
    case "distance": return g.value / (g.dist ?? 1);
    case "topple": return g.value / (g.count ?? 1);
    case "air": return g.value / (g.ticks ?? 1);
    case "speed": case "score": return g.value / (g.value2 ?? 1);
    default: return g.done ? 1 : 0;
  }
}
function keyText(action: string): string {
  try {
    const b = bindings(action).find((x) => x.device === "keyboard");
    return b ? b.label.replace(/^Digit /, "").replace(/^Arrow /, "") : "";
  } catch { return ""; }
}
function hud(L: Layout): void {
  const s = app.session!, st = s.state!, level = app.level!;
  const legal = s.legal;
  const pad = 10;
  const compact = !L.wide;
  const live = s.finished ? s.finished.score.total : (s.summary?.score ?? 0);
  // objective card (top start)
  const objW = L.phone ? Math.max(150, L.lw * 0.46) : L.land ? 220 : L.wide ? 300 : 260;
  const { main, bonus } = objectiveText(level);
  const top = ui.place("hud-top-l", { anchor: "top-start", x: pad, y: pad }, () => {
    ui.column("objective-card", () => {
      const iw = objW - 28;
      para(levelName(level), iw, "obj-title", "hud-level");
      para(`🎯 ${main}`, iw, "obj-text", "hud-goal");
      if (!L.phone && !L.land) for (const [i, b] of bonus.entries()) para(`✦ ${b}`, iw, "obj-text", `hud-bonus-${i}`);
      st.goals.forEach((g, i) => {
        const pct = g.done ? 1 : Math.max(0, Math.min(1, progress01(g)));
        ui.row(`goal-${i}`, () => {
          ui.style("obj-text").label(g.primary ? "🎯" : "✦");
          ui.widget("", {
            role: "none", size: { width: Math.max(30, iw - 100), height: 14 },
            draw: (r, ws) => {
              const h = 7 * ws.scale, y = r.y + (r.height - h) / 2;
              draw.roundRect(r.x, y, r.width, h, 4, "#ffffff1f");
              if (pct > 0) draw.roundRect(r.x, y, Math.max(h, r.width * pct), h, 4, g.done ? token("good") : token("accent-2"));
            },
          });
          ui.spacer();
          ui.style(g.done ? "goal-done" : "goal-label").label(g.done ? "✓" : goalProgressLabel(g) || " ");
        }, { spacing: 8, width: iw, align: "center" });
      });
      const intro = levelIntro(level);
      if (intro && app.mode !== "journey" && !L.phone && !L.land) para(intro, iw, "obj-intro", "hud-intro");
    }, { style: "card-tight", width: objW, spacing: 4 });
  });
  // status card (top end)
  const secs = Math.floor(st.tick / 120);
  const right = ui.place("hud-top-r", { anchor: "top-end", x: pad, y: pad }, () => {
    const body = (): void => {
      ui.column("status-score", () => { ui.style("status-num").id("hud-score").label(String(live)); ui.style("status-label").label(T("hudScore").toUpperCase()); }, { align: "center", spacing: 0 });
      ui.column("status-time", () => { ui.style("status-num").id("hud-time").label(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`); ui.style("status-label").label(T("hudTime").toUpperCase()); }, { align: "center", spacing: 0 });
      if (level.par && L.wide) ui.column("status-stars", () => { ui.style("star-line").label(`★★ ${level.par!.score}`); ui.style("star-line").label(`★★★ ${level.par!.star3}`); }, { spacing: 0 });
      button({ id: "btn-pause", text: "⏸", name: T("pause"), style: "icon-btn", act: pauseGame, disabled: app.state !== "active",
        content: () => ui.widget("", { role: "none", size: { width: 20, height: 20 }, draw: (r, ws) => {
          const k = ws.scale, w = 4 * k, h = 14 * k, y = r.y + (r.height - h) / 2, cx = r.x + r.width / 2;
          draw.rect(cx - 5 * k, y, w, h, token("ink")); draw.rect(cx + 1 * k, y, w, h, token("ink"));
        } }) });
    };
    if (L.land) ui.column("status-card", body, { style: "card-tight", spacing: 4, align: "center" });
    else ui.row("status-card", body, { style: "card-tight", spacing: L.phone ? 8 : 14, align: "center" });
  });
  // tutorial card
  if (app.mode === "learn" && level.tutorial) {
    const steps = level.tutorial.steps;
    const tw = Math.min(420, L.lw * 0.88);
    const y = Math.max(top.y + top.height, right.y + right.height) / L.sc - L.sa.top / L.sc + 8;
    ui.place("tutorial", { anchor: "top", y }, () => {
      ui.column("tutorial-card", () => {
        const iw = tw - 38;
        if (s.tutorialStep >= steps.length) para(`${T("lessonComplete")} ${T("lessonFinish")}`, iw, "tutorial-text", "tutorial-text");
        else {
          para(stepText(level, s.tutorialStep), iw, "tutorial-text", "tutorial-text");
          ui.row("tutorial-dots", () => steps.forEach((_, i) => ui.widget("", { role: "none", size: { width: 10, height: 10 }, draw: (r) => {
            draw.circle(r.x + r.width / 2, r.y + r.height / 2, r.width / 2, i < s.tutorialStep ? token("good") : i === s.tutorialStep ? token("accent-2") : "#ffffff33");
          } })), { spacing: 6, justify: "center", width: iw });
        }
      }, { style: "card-accent2", width: tw, spacing: 8, align: "center" });
    });
  }
  // trigger chips over armed tools (before the tray so the tray stays on top)
  const f = frame();
  if (legal && app.state === "active") {
    for (const t of legal.triggers) {
      const p = render.worldToScreen(t.x, t.y + 0.55, 0, f.width, f.height);
      if (p.behind) continue;
      const cx = Math.max(0, Math.min(L.lw - 44, (p.x - L.sa.left) / L.sc - 22)), cy = Math.max(0, Math.min(L.lh - 44, (p.y - L.sa.top) / L.sc - 22));
      ui.place(`chip-${t.toolId}`, { anchor: "top-start", x: cx, y: cy }, () => {
        button({ id: `chip-${t.toolId}`, text: "⚡", name: T("triggerTool", { tool: toolName(t.type) }), style: "chipbtn", width: 44, height: 44, act: () => triggerTool(t.toolId) });
      });
    }
  }
  // the cursor ring (#crosshair) at the ghost / virtual cursor
  if (app.selectedTool && app.cursor && app.state === "active") {
    const p = render.worldToScreen(app.cursor.x, app.cursor.y, 0.3, f.width, f.height);
    paint("crosshair", L, p.x - 14 * L.sc, p.y - 14 * L.sc, 28 * L.sc, 28 * L.sc, (r) => {
      const c = token("accent-2"), cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      draw.circle(cx, cy, r.width / 2, "#00000066");
      draw.circle(cx, cy, r.width / 2 - 2 * L.sc, c);
      draw.circle(cx, cy, r.width / 2 - 4 * L.sc, "#00000000");
      draw.circle(cx, cy, 4 * L.sc, c);
    });
  }
  // bottom: tool tray and context actions
  const left = platform.options.leftHanded;
  const toolW = L.land ? 52 : L.phone ? 56 : 64;
  const showNames = !L.land;
  const tray = (): void => {
    ui.row("tool-tray", () => {
      let keyIdx = 0;
      for (const tool of TOOL_ORDER) {
        const count = level.tools[tool] ?? 0;
        const n = st.stock[tool] ?? 0;
        const k = count ? keyText(`tool${++keyIdx}`) : "";
        const name = n > 0 ? T("toolAvailable", { tool: toolName(tool), n }) : T("toolOut", { tool: toolName(tool) });
        button({
          id: `tool-${tool}`, text: toolShort(tool), name, style: n > 0 ? "tool" : "tool-out", selected: app.selectedTool === tool, width: toolW,
          act: () => selectTool(tool),
          content: () => ui.widget("", {
            role: "none", size: { width: toolW - 14, height: showNames ? 42 : 30 },
            draw: (r, ws) => {
              const z = ws.scale, a = n > 0 ? 1 : 0.35;
              draw.text(TOOL_ICONS[tool], r.x + r.width / 2, r.y + (showNames ? 2 : 4) * z, { size: 22 * z, align: "center", color: `#ffffff${a < 1 ? "5a" : "ff"}` });
              if (showNames) draw.text(toolShort(tool), r.x + r.width / 2, r.y + 28 * z, { size: 10.4 * z, align: "center", color: n > 0 ? token("ink-dim") : "#c8bba05a" });
              // stock badge (top end) and key hint (bottom start)
              const bw = 22 * z, bh = 16 * z, bx = r.x + r.width - bw + 8 * z, by = r.y - 12 * z;
              draw.roundRect(bx, by, bw, bh, 8, token("accent"));
              draw.text(String(n), bx + bw / 2, by + 1.5 * z, { size: 11 * z, align: "center", color: "#241703", weight: "bold" });
              if (k) {
                const kw = 14 * z, kh = 14 * z, kx = r.x - 8 * z, ky = r.y + r.height - 4 * z;
                draw.roundRect(kx, ky, kw, kh, 4, "#000000a0");
                draw.text(k, kx + kw / 2, ky + 1.5 * z, { size: 9.6 * z, align: "center", color: token("ink") });
              }
            },
          }),
        });
      }
    }, { style: "card-tight", spacing: L.phone ? 6 : 8, align: "center" });
  };
  const armed = legal?.triggers.length ?? 0;
  const acts: Btn[] = [];
  const kb = (a: string): string => { const k = keyText(a); return k && !L.phone ? `  ${k}` : ""; };
  if (armed > 0) acts.push({ id: "btn-trigger", text: (armed > 1 ? T("triggerArmed", { n: armed }) : T("trigger")) + kb("trigger"), style: "btn-primary", act: triggerFirst });
  if (legal?.skip) acts.push({ id: "btn-skip", text: T("settle") + kb("skip"), act: doSkip });
  if (legal?.undo) acts.push({ id: "btn-undo", text: T("undo") + kb("undo"), act: doUndo });
  acts.push({ id: "btn-hint", text: T("hint") + kb("hint"), act: showHint });
  acts.push({ id: "btn-restart", text: T("restart") + kb("restart"), act: restartRound });
  const off = app.state !== "active";
  for (const a of acts) a.disabled = off;
  if (L.phone) {
    ui.place("hud-bottom", { anchor: "bottom", y: pad }, () => {
      ui.column("hud-bottom-col", () => {
        flow("context-actions", acts, L.lw - 2 * pad, 6, "center");
        tray();
      }, { spacing: 8, align: "center", width: L.lw - 2 * pad });
    });
  } else if (L.land || compact) {
    ui.place("hud-tray", { anchor: left ? "bottom-end" : "bottom-start", x: pad, y: pad }, tray);
    const tw = (toolW + 8) * 5 + 16;
    const aw = Math.max(120, L.lw - tw - 3 * pad);
    ui.place("hud-actions", { anchor: left ? "bottom-start" : "bottom-end", x: pad, y: pad }, () => flow("context-actions", acts, aw, 6, left ? "start" : "end"));
  } else {
    ui.place("hud-tray", { anchor: "bottom", y: pad }, tray);
    ui.place("hud-actions", { anchor: left ? "bottom-start" : "bottom-end", x: pad, y: pad }, () => {
      ui.column("context-actions", () => { for (const a of acts) button({ ...a, width: Math.max(130, ...acts.map((b) => buttonWidth(b.text, b.style ?? "btn"))) }); }, { spacing: 6, align: left ? "start" : "end" });
    });
  }
  // captions (above the bottom HUD)
  if (app.captions.length) {
    ui.place("captions", { anchor: "bottom", y: L.phone ? 190 : 96 }, () => ui.column("caption-col", () => {
      app.captions.forEach((c, i) => ui.column(`cap-${i}`, () => ui.style("caption-text").label(c.text), { style: "caption" }));
    }, { spacing: 4, align: "center" }));
  }
  // countdown
  if (app.countdown !== null) {
    ui.place("countdown", { anchor: "center" }, () => ui.style("countdown").id("countdown").label(app.countdown! > 0 ? String(app.countdown) : T("go")));
  }
}

// ------------------------------------------------------------------ toasts
function toasts(L: Layout): void {
  if (!app.toasts.length) return;
  const w = Math.min(L.lw * 0.8, 480);
  ui.place("toast-stack", { anchor: "bottom", y: L.phone ? 210 : app.screen ? 24 : 110 }, () => {
    ui.column("toast-col", () => {
      app.toasts.forEach((t, i) => ui.column(`toast-${i}`, () => para(t.text, w - 34, t.kind === "bad" ? "toast-text" : "info-text", `toast-${i}-text`), { style: t.kind === "bad" ? "toast" : "toast-info" }));
    }, { spacing: 6, align: "center" });
  });
}

// ------------------------------------------------------------------ overlays
function pausePanel(L: Layout): void {
  const w = Math.min(34 * 16, L.lw - 24), inner = w - 40;
  const open = ui.dialog(T("paused"), "", true, () => {
    ui.column("pause-panel", () => {
      para(T("paused"), inner, "h1", "pause-h");
      button({ id: "btn-resume", text: T("resume"), style: "mega", width: inner, act: resumeGame });
      button({ id: "btn-pause-restart", text: T("restartRound"), width: inner, act: restartRound });
      button({ id: "btn-pause-settings", text: T("settingsBtn"), width: inner, act: () => route("settings") });
      button({ id: "btn-pause-help", text: T("helpBtn"), width: inner, act: () => route("help") });
      button({ id: "btn-leave", text: T("leaveRound"), style: "btn-danger", width: inner, act: leaveRound });
    }, { style: "overlay", width: w, spacing: 8 });
  });
  if (!open && fresh()) later(resumeGame);
}
function resultsPanel(L: Layout): void {
  const ctx = app.results;
  if (!ctx) return;
  const r = ctx.results, c = r.score.components, won = r.score.primaryComplete;
  const twoCol = L.land;
  const w = twoCol ? Math.min(46 * 16, L.lw - 16) : Math.min(34 * 16, L.lw - 24);
  const maxH = L.lh - 16;
  ui.dialog(T("resultsAria"), "", true, () => {
    ui.column("results-panel", () => {
      const left = (iw: number): void => {
        ui.row("results-h-row", () => para(won ? T("goalCompleteTitle") : `🔧 ${reasonText(r.reason)}`, iw, "h1", "results-h"), { width: iw, justify: "center" });
        ui.row("results-stars-row", () => ui.style("results-stars").id("results-stars").label(stars(r.stars)), { width: iw, justify: "center" });
        ui.row("results-total-row", () => {
          ui.style("results-total").id("results-total").label(String(r.score.total));
          ui.style("muted").label(` ${T("points")}`);
        }, { width: iw, justify: "center", align: "end" });
        const rows: [string, number][] = [["row_goal", c.goal ?? 0], ["row_objectives", c.objectives ?? 0], ["row_efficiency", c.efficiency ?? 0],
          ["row_swiftness", c.swiftness ?? 0], ["row_style", c.style ?? 0], ["row_penalty", c.penalty ?? 0]];
        const tw = Math.min(iw, Math.max(iw * 0.7, 260));
        ui.row("breakdown-wrap", () => ui.column("breakdown", () => {
          for (const [k, v] of rows) {
            if (v === 0) continue;
            ui.row(`bd-${k}`, () => { para(T(k), tw - 90, "td"); ui.spacer(); ui.style("td-num").label(`${v > 0 ? "+" : ""}${v}`); }, { style: "row-line", width: tw, align: "center" });
          }
        }, { width: tw, spacing: 0 }), { width: iw, justify: "center" });
        if (r.newAchievements?.length) flow("ach-unlocks", [], iw);
        for (const [i, a] of (r.newAchievements ?? []).entries()) {
          ui.row(`ach-un-${i}`, () => ui.column(`ach-un-${i}-c`, () => ui.style("small").label(`🏅 ${achName(a.key)}`), { style: "ach-unlock" }), { width: iw, justify: "center" });
        }
        if (ctx.cmp) para(T(ctx.cmp.key, ctx.cmp.vars), iw, ctx.cmp.muted ? "muted" : "compare", "results-compare");
        const lb = resultsLine(ctx);
        if (lb) para(lb, iw, "muted", "results-lb");
      };
      const actions = (iw: number): void => {
        button({ id: "btn-next", text: won ? nextLabel(r) : T("retry"), style: "mega", width: iw, act: () => { app.overlay = null; if (won) nextStage(r); else retryStage(); } });
        button({ id: "btn-retry", text: T("retry"), width: iw, act: () => { app.overlay = null; retryStage(); } });
        button({ id: "btn-map", text: T("stagesBtn"), width: iw, act: () => route(r.mode === "challenge" ? "challenge" : "journey") });
        button({ id: "btn-title", text: T("titleBtn"), width: iw, act: () => route("title") });
      };
      const inner = w - 40;
      if (twoCol) {
        const aw = Math.max(190, inner * 0.38), lw = inner - aw - 18;
        const prev = lastSize.get("results-left");
        const body = (): void => { lastSize.set("results-left", ui.column("results-left", () => left(lw), { spacing: 6, width: lw })); };
        ui.row("results-cols", () => {
          if (prev && prev.height / L.sc > maxH - 40) ui.scrollArea("results-scroll", { width: lw + 14, height: maxH - 40 }, body);
          else body();
          ui.column("results-actions", () => actions(aw), { spacing: 8, width: aw });
        }, { spacing: 18, align: "center" });
      } else {
        const prev = lastSize.get("results-one");
        const body = (): void => { lastSize.set("results-one", ui.column("results-one", () => left(inner), { spacing: 8, width: inner })); };
        if (prev && prev.height / L.sc > maxH - 260) ui.scrollArea("results-scroll", { width: inner, height: Math.max(120, maxH - 260) }, body, { scrollTo: { top: 0 } });
        else body();
        actions(inner);
      }
    }, { style: "overlay", width: w, spacing: 8 });
  });
}

// ------------------------------------------------------------------ full-page screens
function fullScreen(L: Layout): void {
  const cw = Math.min(app.screen === "title" ? 30 * 16 : wideScreens.has(app.screen!) ? 72 * 16 : narrowScreens.has(app.screen!) ? 34 * 16 : 62 * 16, L.lw - (L.phone ? 24 : 40));
  const key = `screen-${app.screen}`;
  const prev = lastSize.get(key);
  const bodyH = L.lh;
  const scroll = !!prev && prev.height / L.sc > bodyH + 1;
  const opening = frame().frame - app.openedFrame <= 6;
  ui.place("screen", { anchor: "top-start", x: 0, y: 0 }, () => {
    const body = (): void => {
      const r = ui.column(`${key}-body`, () => {
        ui.column(`${key}-inner`, () => buildScreen(cw - (scroll ? 14 : 0), L), { width: cw - (scroll ? 14 : 0), spacing: 12 });
      }, { width: L.lw - (scroll ? 14 : 0), align: "center", padding: { top: L.phone ? 12 : 20, bottom: 24 }, ...(app.screen === "title" && !scroll ? { height: L.lh, justify: "center" } : {}) });
      lastSize.set(key, r);
    };
    if (scroll) ui.scrollArea(`${key}-scroll`, { width: L.lw, height: bodyH }, body, opening ? { scrollTo: { top: 0 } } : undefined);
    else body();
  });
}
const wideScreens = new Set<ScreenName>(["journey", "boards", "cosmetics", "help", "settings"]);
const narrowScreens = new Set<ScreenName>(["profile", "practice", "daily"]);
function buildScreen(w: number, L: Layout): void {
  switch (app.screen) {
    case "title": titleScreen(w, L); break;
    case "modes": modesScreen(w, L); break;
    case "journey": journeyScreen(w); break;
    case "learn": learnScreen(w, L); break;
    case "practice": practiceScreen(w); break;
    case "challenge": challengeScreen(w, L); break;
    case "daily": dailyScreen(w); break;
    case "boards": boardsScreen(w); break;
    case "achievements": achievementsScreen(w); break;
    case "cosmetics": cosmeticsScreen(w); break;
    case "help": helpScreen(w); break;
    case "settings": settingsScreen(w); break;
    case "profile": profileScreen(w); break;
  }
}
const backRow = (): void => { ui.row("back-row", () => button({ id: "btn-back", text: T("back"), act: back }), { padding: { top: 16 } }); };
const heading = (text: string, w: number, id: string): void => { para(text, w, "h1", id); };

function titleScreen(w: number, L: Layout): void {
  const p = progression();
  const logo = `⚙ Workshop Mayhem`;
  para(logo, w, textWidth(logo, "logo") > w ? "logo-small" : "logo", "title-logo");
  para(T("tagline"), w, "tagline", "tagline");
  button({ id: "btn-play", text: T("play"), style: "mega", width: w, act: () => route("modes") });
  const day = new Date(platform.nowMs()).toISOString().slice(5, 10);
  const chips: [string, string, string, () => void][] = [
    ["chip-daily", T("dailyChallenge"), T("dailyDay", { label: day }), () => route("daily")],
    ["chip-journey", T("journey"), T("journeyChip", { stars: p.totalStars, stage: (p.journey?.furthest ?? "j01").toUpperCase() }), () => route("journey")],
    ["chip-profile", shownName(), platform.signedIn() ? T("profile") : T("guestChip"), () => route("profile")],
  ];
  const cols = L.phone ? 1 : 3;
  const cw = (w - (cols - 1) * 8) / cols;
  ui.column("title-chips", () => {
    for (let r = 0; r * cols < chips.length; r++) ui.row(`chips-r${r}`, () => {
      for (const [id, a, b, act] of chips.slice(r * cols, (r + 1) * cols)) {
        button({ id, text: a, name: `${a}. ${b}`, style: "chip", width: cw, act, content: () => ui.column(`${id}-c`, () => {
          para(a, cw - 24, "chip-title"); para(b, cw - 24, "chip-text");
        }, { spacing: 2, align: "center", width: cw - 22 }) });
      }
    }, { spacing: 8, align: "stretch" });
  }, { spacing: 8, width: w });
  const links: Btn[] = [
    { id: "lnk-learn", text: T("learn"), style: "link", act: () => route("learn") },
    { id: "lnk-practice", text: T("practice"), style: "link", act: () => route("practice") },
    { id: "lnk-challenge", text: T("challenge"), style: "link", act: () => route("challenge") },
    { id: "lnk-boards", text: T("leaderboards"), style: "link", act: () => route("boards") },
    { id: "lnk-achievements", text: T("achievements"), style: "link", act: () => route("achievements") },
    { id: "lnk-cosmetics", text: T("workshopStyle"), style: "link", act: () => route("cosmetics") },
    { id: "lnk-help", text: T("help"), style: "link", act: () => route("help") },
    { id: "lnk-settings", text: T("settings"), style: "link", act: () => route("settings") },
  ];
  if (!platform.signedIn()) links.push({ id: "lnk-signin", text: S("signIn"), style: "link", act: signIn });
  if (platform.inviteLink()) links.push({ id: "lnk-invite", text: S("invite"), style: "link", act: copyInvite });
  flow("title-links", links, Math.min(L.lw - 24, Math.max(w, 600)), 6, "center");
}
function modesScreen(w: number, L: Layout): void {
  heading(T("chooseMode"), w, "modes-h");
  const cards: [string, string, string, string, ScreenName][] = [
    ["journey", "🗺️", T("journey"), T("modeJourney", { n: Stages.JOURNEY.length }), "journey"],
    ["daily", "📅", T("dailyChallenge"), T("modeDaily"), "daily"],
    ["learn", "🎓", T("learn"), T("modeLearn"), "learn"],
    ["practice", "🧪", T("practice"), T("modePractice"), "practice"],
    ["challenge", "⏱️", T("challenge"), T("modeChallenge"), "challenge"],
    ["boards", "🏆", T("scoreChase"), T("modeBoards"), "boards"],
  ];
  cardGrid("mode-grid", cards.length, w, L.phone ? 150 : 220, L.phone ? 10 : 12, (i, cw) => {
    const [id, icon, name, desc, to] = cards[i]!;
    cardButton(`mode-${id}`, icon, name, [[desc, "card-text"]], cw, () => route(to));
  });
  backRow();
}
function journeyScreen(w: number): void {
  const p = progression();
  heading(T("journey"), w, "journey-h");
  para(T("journeyStats", { stars: p.totalStars, done: Object.values(p.stars).filter((s) => s > 0).length, total: Stages.JOURNEY.length }), w, "muted", "journey-stats");
  const chapters = new Map<number, Level[]>();
  for (const lv of Stages.JOURNEY) { if (!chapters.has(lv.chapter)) chapters.set(lv.chapter, []); chapters.get(lv.chapter)!.push(lv); }
  let unlocked = true;
  for (const [ch, levels] of chapters) {
    para(T("chapterTitle", { n: ch, name: chapterName(ch) }), w, "h2", `chapter-${ch}`);
    const list: Btn[] = levels.map((lv) => {
      const n = p.stars[lv.id] || 0;
      const open = unlocked;
      if (n === 0) unlocked = false;
      const name = `${/mastery/i.test(lv.name) ? "👑 " : ""}${levelName(lv)}`;
      const bw = Math.max(96, textWidth(name, "stage-name") + 22);
      return {
        id: `stage-${lv.id}`, text: name, name: T(open ? "stageAria" : "stageAriaLocked", { name: levelName(lv), stars: n }), style: n ? "stage-done" : "stage",
        disabled: !open, width: bw, act: () => startStage(lv.id, "journey"),
        content: () => ui.column(`stage-${lv.id}-c`, () => {
          ui.style("stage-id").label(lv.id.replace("j", ""));
          ui.style("stage-stars").label(stars(n));
          ui.style("stage-name").label(name);
        }, { spacing: 2, align: "center", width: bw - 18 }),
      };
    });
    flow(`chapter-row-${ch}`, list, w, 8);
  }
  backRow();
}
function learnScreen(w: number, L: Layout): void {
  heading(T("learnTitle"), w, "learn-h");
  para(T("learnIntro"), w, "muted", "learn-intro");
  const icons = ["🥊", "🚀", "🌀", "🏋️", "🧲"];
  cardGrid("learn-grid", Tutorials.TUTORIALS.length, w, L.phone ? 150 : 220, 12, (i, cw) => {
    const lv = Tutorials.TUTORIALS[i]!;
    const lines: [string, string][] = [[levelIntro(lv), "card-text"]];
    if (platform.options.tutorialDone.includes(lv.id)) lines.push([T("lessonDone"), "card-em"]);
    cardButton(`lesson-${lv.id}`, icons[i] ?? "", lessonTitle(lv), lines, cw, () => startStage(lv.id, "learn"));
  });
  backRow();
}
function practiceScreen(w: number): void {
  heading(T("practice"), w, "practice-h");
  const pr = app.practice;
  ui.column("setup-card", () => {
    const iw = w - 34;
    para(T("stage"), iw, "h3");
    const idx = Math.max(0, Stages.JOURNEY.findIndex((l) => l.id === pr.levelId));
    const pick = ui.id("practice-level").select(T("stage"), idx, Stages.JOURNEY.map((l) => `${l.id} — ${levelName(l)}`), { width: Math.min(iw, 420) } as ui.WidgetOptions);
    if (pick !== idx) later(() => { pr.levelId = Stages.JOURNEY[pick]!.id; pr.touched = true; });
    para(T("difficulty"), iw, "h3");
    for (const d of ["easy", "normal", "hard"] as const) toggleRow(`diff-${d}`, T(`diff_${d}`), pr.difficulty === d, iw, () => { pr.difficulty = d; pr.touched = true; }, "radio");
    toggleRow("practice-undo", T("allowUndo"), pr.undo, iw, (v) => { pr.undo = v; pr.touched = true; });
    para(T("practiceNote"), iw, "muted", "practice-note");
    button({ id: "btn-start-practice", text: T("startPractice"), style: "mega", width: iw, act: startPractice });
  }, { style: "card", width: w, spacing: 8 });
  backRow();
}
function challengeScreen(w: number, L: Layout): void {
  heading(T("challenge"), w, "challenge-h");
  const p = progression();
  const constraint = (lv: Level): string => {
    const c = lv.challenge ?? {};
    const bits: string[] = [];
    if (c.moveLimit) bits.push(c.moveLimit > 1 ? T("movesMax", { n: c.moveLimit }) : T("movesMax1"));
    if (c.timeLimitTicks) bits.push(T("timeLimit", { n: (c.timeLimitTicks / 120).toFixed(0) }));
    return bits.join(" · ") || T("standardRules");
  };
  cardGrid("challenge-grid", Stages.CHALLENGES.length, w, L.phone ? 150 : 220, 12, (i, cw) => {
    const lv = Stages.CHALLENGES[i]!;
    cardButton(`challenge-${lv.id}`, "", levelName(lv), [[levelIntro(lv), "card-text"], [constraint(lv), "card-em"], [stars(p.stars[lv.id] || 0), "stage-stars"]], cw, () => startStage(lv.id, "challenge"));
  });
  backRow();
}
function dailyScreen(w: number): void {
  const lv = dailyLevel();
  heading(T("dailyChallenge"), w, "daily-h");
  const { main, bonus } = objectiveText(lv);
  const tools = (Object.entries(lv.tools) as [ToolKey, number][]).filter(([, v]) => v > 0).map(([k, v]) => T("toolCount", { n: v, tool: toolName(k) })).join(", ");
  ui.column("daily-card", () => {
    const iw = w - 34;
    para(levelName(lv), iw, "h2", "daily-name");
    para(`🎯 ${main}`, iw, "text", "daily-goal");
    for (const [i, b] of bonus.entries()) para(`✦ ${b}`, iw, "text", `daily-bonus-${i}`);
    const facts: [string, string][] = [
      [T("ruleset"), lv.daily?.excluded ? T("rulesetExcluded", { v: lv.daily.ruleset }) : `v${lv.daily?.ruleset ?? 1}`],
      [T("seed"), String(lv.seed)], [T("toolsLabel"), tools], [T("expected"), T("expectedTime")],
      [T("ranked"), platform.signedIn() ? T("dailyBoard") : T("dailyBoardCasual")],
    ];
    const half = (iw - 14) / 2;
    for (let i = 0; i < facts.length; i += 2) {
      ui.row(`facts-${i}`, () => {
        for (const [k, v] of facts.slice(i, i + 2)) ui.column(`fact-${k}`, () => { para(k, half, "muted-small"); para(v, half, "text"); }, { width: half, spacing: 0 });
      }, { spacing: 14, width: iw });
    }
    button({ id: "btn-daily-start", text: T("takeShot"), style: "mega", width: iw, act: startDaily });
    button({ id: "btn-daily-board", text: T("viewDailyBoard"), width: iw, act: () => { app.boardsTab = "today"; app.boardsKey++; app.screen = "boards"; app.openedFrame = frame().frame; } });
  }, { style: "card", width: w, spacing: 8 });
  backRow();
}

// --- leaderboards
let hosted: platform.HostedRow[] | null | undefined;
let hostedFor = "";
function table(id: string, w: number, heads: string[], rows: string[][], numeric: boolean[]): void {
  const n = heads.length;
  const base = heads.map((h, i) => Math.max(textWidth(h, "th") + 20, i === 0 ? 40 : 0));
  const rest = Math.max(0, w - base.reduce((a, b) => a + b, 0));
  const cw = base.map((x, i) => x + (i === 1 ? rest * 0.6 : rest * 0.4 / Math.max(1, n - 1)));
  const row = (rid: string, cells: string[], head: boolean): void => {
    ui.row(rid, () => cells.forEach((c, i) => ui.column(`${rid}-${i}`, () => para(c, cw[i]! - 12, head ? "th" : numeric[i] ? "td-num" : "td"),
      { width: cw[i]!, align: numeric[i] && !head ? "end" : "start" })), { style: "row-line", width: w, spacing: 0 });
  };
  ui.column(id, () => { row(`${id}-h`, heads, true); rows.forEach((r, i) => row(`${id}-${i}`, r, false)); }, { width: w, spacing: 0 });
}
function boardsScreen(w: number): void {
  heading(T("leaderboards"), w, "boards-h");
  const today = `daily-${platform.utcDay()}`;
  const tabs: [string, string][] = [["global", T("tab_global")], ["friends", T("tab_friends")], ["today", T("tab_today")]];
  ui.row("board-tabs", () => {
    for (const [id, text] of tabs) button({ id: `tab-${id}`, text, style: "tab", selected: app.boardsTab === id, act: () => { app.boardsTab = id; sfxTab(); } });
  }, { spacing: 6 });
  const tab = app.boardsTab;
  const wantHosted = tab !== "today" && platform.signedIn();
  const key = `${app.boardsKey}:${tab}`;
  if (wantHosted && hostedFor !== key) { hostedFor = key; hosted = undefined; void platform.hostedBoard(tab === "friends").then((r) => { if (hostedFor === key) hosted = r; }); }
  let rows: string[][] = [];
  let casual = true;
  if (wantHosted && hosted === undefined) { para(T("loadingText"), w, "muted", "board-loading"); backRow(); return; }
  if (wantHosted && hosted) {
    casual = false;
    rows = hosted.slice(0, 25).map((e, i) => [String(i + 1), e.me ? T("you") : e.name || T("player"), "—", String(e.score), "—"]);
  } else {
    const local = platform.localBoard(tab === "today" ? today : "global");
    rows = local.slice(0, 25).map((e, i) => [String(i + 1), e.name === "You" ? T("you") : e.name, e.levelId ?? "—", String(e.score), T("seconds", { n: Math.floor((e.ticks ?? 0) / 120) })]);
  }
  if (!rows.length) para(T(casual ? "noScoresDevice" : "noScores"), w, "muted", "board-empty");
  else {
    if (casual) para(T("casualBoard"), w, "muted", "board-casual");
    table("board-table", w, ["#", T("th_player"), T("th_level"), T("th_score"), T("th_time")], rows, [false, false, false, true, true]);
  }
  backRow();
}
function sfxTab(): void { sfx("ui-tab-switch"); }
function achievementsScreen(w: number): void {
  const doc = achievementsDoc();
  heading(T("achievements"), w, "ach-h");
  ui.column("ach-list", () => {
    for (const a of Achievements.ACHIEVEMENTS) {
      const on = doc.unlocked[a.key];
      ui.row(`ach-${a.key}`, () => {
        ui.style("ach-icon").label(on ? "🏅" : "🔒");
        ui.column(`ach-${a.key}-t`, () => {
          para(achName(a.key), w - 90, "card-title");
          para(achDesc(a.key), w - 90, "card-text");
          if (on) para(T("unlockedOn", { date: String(on).slice(0, 10) }), w - 90, "card-em");
        }, { spacing: 4, width: w - 90 });
      }, { style: on ? "ach-card-on" : "ach-card", width: w, spacing: 12 });
    }
  }, { spacing: 10, width: w });
  backRow();
}
function cosmeticsScreen(w: number): void {
  const p = progression();
  heading(T("workshopStyle"), w, "style-h");
  ui.column("mastery-card", () => {
    const iw = w - 34;
    para(T("masteryTrack"), iw, "h2");
    const frac = Math.min(1, (p.xp % 500) / 500);
    ui.widget("", { role: "none", size: { width: iw, height: 10 }, draw: (r) => {
      draw.roundRect(r.x, r.y, r.width, r.height, 6, "#ffffff1f");
      if (frac > 0) draw.roundRect(r.x, r.y, Math.max(r.height, r.width * frac), r.height, 6, token("accent-2"));
    } });
    para(T("xpLine", { xp: p.xp, next: Math.ceil((p.xp + 1) / 500) * 500 }), iw, "text", "xp-line");
    para(T("cosmeticsNote"), iw, "muted", "cosmetics-note");
  }, { style: "card", width: w, spacing: 8 });
  para(T("themes"), w, "h2", "themes-h");
  cardGrid("theme-grid", Themes.THEME_ORDER.length, w, 200, 12, (i, cw) => {
    const tid = Themes.THEME_ORDER[i]!, th = Themes.THEMES[tid]!;
    const un = Themes.themeUnlocked(th, p);
    const active = platform.options.lastTheme === tid;
    const [kind, n] = th.unlock.split("-");
    const lines: [string, string][] = [[themeBlurb(tid), "card-text"]];
    if (!un) lines.push([kind === "stars" ? T("unlock_stars", { n: n ?? "" }) : T("unlock_chapter", { n: n ?? "" }), "card-em"]);
    const inner = cw - 34;
    button({
      id: `theme-${tid}`, text: themeName(tid), name: [themeName(tid), ...lines.map((l) => l[0])].join(". "), style: "mode-card", width: cw, selected: active, disabled: !un,
      act: () => setTheme(tid),
      content: () => ui.column(`theme-${tid}-c`, () => {
        ui.widget("", { role: "none", size: { width: inner, height: 48 }, draw: (r) => {
          draw.box(r.x, r.y, r.width, r.height, { radius: 8, background: { type: "linear", angle: 135, stops: [`#${th.floor.toString(16).padStart(6, "0")}`, `#${th.accent.toString(16).padStart(6, "0")}`] } });
        } });
        para(themeName(tid), inner, "card-title");
        for (const [l, cls] of lines) para(l, inner, cls);
      }, { spacing: 6, width: inner }),
    });
  });
  backRow();
}
// --- help
const OLD_ACTION: Record<string, string> = {
  confirm: "confirm", trigger: "trigger", cancel: "cancel", pause: "pause", undo: "undo", hint: "hint", restart: "restart", skip: "skip",
  camera: "camera", mute: "mute", tool1: "tool1", tool2: "tool2", tool3: "tool3", tool4: "tool4", tool5: "tool5", tool_prev: "toolPrev", tool_next: "toolNext",
  cursor_up: "cursorUp", cursor_down: "cursorDown", cursor_left: "cursorLeft", cursor_right: "cursorRight",
};
function keysFor(action: string): string {
  try { return [...new Set(bindings(action).filter((b) => b.device === "keyboard").map((b) => b.label))].join(" / "); } catch { return ""; }
}
function helpScreen(w: number): void {
  heading(T("howToPlay"), w, "help-h");
  ui.column("loop-card", () => {
    para(T("theLoop"), w - 34, "h3"); para(T("loopBody"), w - 34, "text", "loop-body"); para(T("scoreBody"), w - 34, "text", "score-body");
  }, { style: "card", width: w, spacing: 6 });
  const tools = Object.keys(Engine.TOOLS) as ToolKey[];
  cardGrid("rule-grid", tools.length, w, 220, 10, (i, cw) => {
    const t = tools[i]!;
    ui.column(`rule-${t}`, () => {
      para(toolName(t), cw - 34, "h3"); para(toolBlurb(t), cw - 34, "text"); para(T("placement", { where: T(`place_${Engine.TOOLS[t].placement}`) }), cw - 34, "muted");
    }, { style: "card", width: cw, spacing: 6 });
  });
  ui.column("controls-card", () => {
    const iw = w - 34;
    para(T("controlsCurrent"), iw, "h3");
    const cols = iw > 600 ? 2 : 1, colW = (iw - (cols - 1) * 16) / cols;
    const items = Object.keys(OLD_ACTION).map((a) => `${bindingLabel(OLD_ACTION[a]!)}: ${keysFor(a) || "—"}`);
    items.push(`${T("gamepad")}: ${T("gamepadHelp")}`);
    for (let r = 0; r < items.length; r += cols) {
      ui.row(`ctl-${r}`, () => { for (const it of items.slice(r, r + cols)) ui.column(`ctl-${r}-${it.length}`, () => para(it, colW, "text"), { width: colW }); }, { spacing: 16, width: iw });
    }
    para(T("touchHelp"), iw, "muted", "touch-help");
  }, { style: "card", width: w, spacing: 6 });
  backRow();
}
// --- settings
function toggleRow(id: string, label: string, on: boolean, w: number, set: (v: boolean) => void, role: "checkbox" | "radio" = "checkbox"): void {
  ui.row(`${id}-row`, () => {
    const res = ui.id(id).widget(label, {
      role, checked: on, size: { width: 44, height: 44 },
      draw: (r, st) => {
        const s = st.scale, box = 20 * s, bx = r.x + (r.width - box) / 2, by = r.y + (r.height - box) / 2;
        if (role === "radio") {
          draw.circle(bx + box / 2, by + box / 2, box / 2, token("ink-dim"));
          draw.circle(bx + box / 2, by + box / 2, box / 2 - 2 * s, on ? token("accent") : "#241d12");
        } else {
          draw.roundRect(bx, by, box, box, 4, on ? token("accent") : "#00000066");
          draw.strokeRoundRect(bx, by, box, box, 4, token("ink-dim"), 2);
          if (on) draw.text("✓", bx + box / 2, by + 1 * s, { size: 16 * s, color: "#241703", align: "center", weight: "bold" });
        }
      },
    });
    para(label, w - 56, "text", `${id}-label`);
    if (res.activated && fresh()) later(() => set(!on));
  }, { width: w, align: "center", spacing: 8 });
}
function settingsScreen(w: number): void {
  const o = platform.options;
  heading(T("settings"), w, "settings-h");
  const cols = w >= 560 ? 2 : 1, cw = (w - (cols - 1) * 12) / cols;
  const sections: (() => void)[] = [
    () => ui.column("set-runtime", () => {
      const iw = cw - 34;
      para(T("audioGraphics"), iw, "h2");
      para(T("optionsNote"), iw, "muted", "options-note");
      flow("runtime-btns", [
        { id: "btn-options", text: T("openOptions"), act: () => openMenu() },
        { id: "btn-rebind", text: T("keyBindings"), act: () => requestRebind() },
      ], iw);
      toggleRow("set-mute", T("muteGame"), o.muted, iw, (v) => platform.setOption("muted", v));
    }, { style: "card", width: cw, spacing: 8 }),
    () => ui.column("set-access", () => {
      const iw = cw - 34;
      para(T("accessibility"), iw, "h2");
      toggleRow("set-captions", T("acc_captions"), o.captions, iw, (v) => platform.setOption("captions", v));
      toggleRow("set-left", T("acc_leftHanded"), o.leftHanded, iw, (v) => platform.setOption("leftHanded", v));
      para(T("colorPalette"), iw, "text");
      const pals = ["default", "deuteranopia", "tritanopia", "highContrast"] as const;
      const idx = Math.max(0, pals.indexOf(o.palette));
      const pick = ui.id("set-palette").select(T("colorPalette"), idx, pals.map((p) => T(`pal_${p}`)), { width: Math.min(iw, 260) } as ui.WidgetOptions);
      if (pick !== idx) later(() => platform.setOption("palette", pals[pick]!));
    }, { style: "card", width: cw, spacing: 8 }),
    () => ui.column("set-controls", () => {
      const iw = cw - 34;
      para(T("controls"), iw, "h2");
      toggleRow("set-undo", T("undoInPractice"), o.undoInPractice, iw, (v) => platform.setOption("undoInPractice", v));
      button({ id: "btn-replay-tutorials", text: T("replayTutorials"), act: replayTutorials });
      button({ id: "btn-camera", text: bindingLabel("camera"), act: cameraReset, disabled: !app.session });
    }, { style: "card", width: cw, spacing: 8 }),
  ];
  for (let r = 0; r < sections.length; r += cols) ui.row(`set-r${r}`, () => { for (const s of sections.slice(r, r + cols)) s(); }, { spacing: 12, align: "start" });
  backRow();
}
// --- profile
function profileScreen(w: number): void {
  const p = profile();
  const signed = platform.signedIn();
  heading(T("profile"), w, "profile-h");
  ui.row("profile-card", () => {
    ui.style("ach-icon").label(signed ? "🧑‍🔧" : "🧰");
    ui.column("profile-t", () => { para(shownName(), w - 100, "h2", "profile-name"); para(signed ? T("profileSignedIn") : T("profileGuest"), w - 100, "text"); }, { spacing: 4, width: w - 100 });
  }, { style: "card", width: w, spacing: 14, align: "center" });
  if (!signed) {
    para(T("displayName"), w, "text");
    ui.row("name-row", () => {
      const def = p.displayName === "Guest Inventor" ? T("guestName") : p.displayName;
      if (!app.profileName) app.profileName = def;
      app.profileName = ui.style("field").textField("display-name", app.profileName, { maxChars: 24, width: Math.min(w - 110, 320) });
      const save = button({ id: "btn-save-name", text: T("save"), act: () => setDisplayName(app.profileName) });
      if (ui.submitted("display-name") && !save) later(() => setDisplayName(app.profileName));
    }, { spacing: 8, align: "center" });
    button({ id: "btn-profile-signin", text: S("signIn"), act: signIn });
    para(T("guestNote"), w, "muted", "guest-note");
  } else {
    para(T("signedInAs", { name: platform.displayName() }), w, "muted", "signed-as");
    const st = platform.syncState();
    para(T(`sync_${st === "offline" ? "offline" : st}`), w, "muted", "sync-line");
    if (platform.inviteLink()) button({ id: "btn-invite", text: S("invite"), act: copyInvite });
  }
  backRow();
}
void num;
