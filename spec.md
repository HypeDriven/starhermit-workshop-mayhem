# Workshop Mayhem — running specification

**Genre:** physics toy · **Players:** 1 (asynchronous score comparison) · **Runs on:** the StarHermit engine 1.23.0
(host API 1.24, `engine.minor=24`), natively in the StarHermit client and in browsers through the engine's web
runtime (`index.html` is the loader `npm run package` writes).

## 1. The game

Players use whimsical tools — the Wallop Piston, Boing Pad, Gust Fan, Snatch Magnet and Thumper Weight — on a
resilient plush training dummy to satisfy each stage's goal: ring a bell fast enough, hold the dummy in a chalk
circle, topple crates, send it far, keep it airborne, reach a speed. The loop is **choose a tool, place or trigger it,
watch the physics, satisfy the goal**.

- **Rules** (`src/rules/`): a deterministic verlet soft-body simulation at a fixed 1/120 s step, commands with
  explicit invalid reasons, goals, integer scoring with a component breakdown, serialization and stable hashing,
  seeded RNG streams. Unchanged from the browser build; the node tests and golden hashes cover it.
- **Content** (`src/content/`): 40 Journey stages in six chapters (mastery stages each chapter), 8 Challenges
  (move limits, time caps, speed targets), 5 Learn lessons, a Daily per UTC day, six cosmetic themes, five
  achievements. Every stage carries a reference solution (hints, `tools/validate-content.mjs`).
- **Session** (`src/session/session.js`): validated commands, undo snapshots (Practice and Learn), the replay
  envelope, results, stars, personal bests, XP, Journey frontier and achievements.

### Modes and screens

Title (Play, Daily / Journey / profile chips, links to Learn, Practice, Challenge, Leaderboards, Achievements,
Workshop & Style, Help, Settings, Sign in / Invite) → **Modes** (Journey, Daily, Learn, Practice, Challenge, Score
Chase → Leaderboards) → the round: a 3-2-1 countdown, play, ⇄ **Pause** (Resume, Restart round, Settings, Help,
Leave round) → **Results** (title, stars, total, breakdown, new achievements, comparison with the board, the
leaderboard post line; Next stage / lesson, Retry, Stages, Title). Every screen the old client had is linked:
Journey map (stages unlock in order), Learn, Practice (stage, easy/normal/hard tool stock, undo), Challenges, Daily
(facts: ruleset, seed, tools), Leaderboards (Global / Friends / Today tabs), Achievements, Workshop & Style (XP bar,
theme cards unlocked by stars and chapters), Help (the loop, tool cards, the current key bindings, touch and pad),
Settings, Profile (guest display name, sign-in, sync line, invite).

## 2. Controls

Actions are rebindable in the runtime's Options (keys and pads).

| Action | Keys | Pad |
| --- | --- | --- |
| Tool slots 1–5 / previous / next | 1–5, [ / ] | LB / RB |
| Move cursor (Shift: fine) | arrows (held keys repeat) | D-pad, left stick (analog) |
| Confirm / place | Enter | A |
| Trigger (first armed tool) | Space | X |
| Cancel (deselect, else pause) | Escape | B |
| Pause / Undo / Hint / Restart / Fast-forward | P / U / H / R / S | Start / Select / Y / LT / RT |
| Camera reset / game mute | C / M | right stick press |

Pointer and touch: tap a tool in the tray, then tap or drag on the workshop to place and aim it (pistons snap to
the nearest free mount, pads to floors); tap an armed tool or its ⚡ chip to trigger it. Presses the UI captures
(`ui.pointerCaptured()`) never reach the workshop. With the keyboard, a mounted piston aims at the dummy.

## 3. Presentation

- `native/render.ts` ports the browser build's three.js r170 scene (`src/render/*.js`) to `starhermit:scene`: the
  workshop room, shelves, pegboard, swaying lamp, window light shaft, dust motes, the soft-body dummy rebuilt from
  its particles each frame, statics, bells, zones, mounts, crates/balls/weights, tool meshes and their animations,
  pooled particles, the spring camera rig with shake. At minor 24 the page's own light intensities (r155+
  physical), shadow values (bias −0.0004, normalBias 0.02, the key light's camera fitted to the arena) and
  reflections (`new RoomEnvironment(renderer)` per the r163+ rule, PMREM σ 0.04, environmentIntensity 0.16) are used.
- Post effects: GTAO (High/Ultra), bloom (threshold 1.05, before tone mapping), the grade in display space, the
  preset's antialiasing; ACES tone mapping with each theme's exposure; fog scaled with camera distance.
- Graphics levels: `native/quality.ts` maps the runtime's quality tier and level to the old presets and budgets
  (shadow map size, material model, texture size, segment budget, dust and particle caps). Render scale, DPR cap,
  adaptive resolution and the frame limit belong to the runtime.
- Differences from the browser build: no plush sheen (the engine has no sheen); the dashed trajectory line is drawn
  as line segments; the metal speckle texture is seeded; the ambience's slow LFO swell is left out (steady bed).
- UI: `native/screens.ts` (starhermit:ui) from `tools/ui-style.css` (`npm run css` → `assets/ui-style.json`).
  Layouts: wide (≥ 1024 px: tray centred, actions in a right column), compact, phone portrait (≤ 700 px wide: actions
  above the tray), short landscape (≤ 500 px tall: status card stacked, tool names hidden). Left-handed swaps sides.
- Audio (`native/audio.ts`): the 37 recorded one-shots per event; the adaptive music (warm/cool scale, three
  intensities) and the per-theme ambience rendered into looping clips on the music bus; UI sounds on the interface
  bus. Fast-forward shows "Fast-forwarding…" for the frame before it runs (up to ~0.4 s natively).

## 4. Settings, accessibility, language

The runtime's Options own volumes, mute, graphics, frame rate, language, larger text, high contrast (the game
switches to its high-contrast token set), reduced motion (no shake or particle bursts, still lamp) and key bindings.
The game's Settings keep: open Options, key bindings, game-sound mute (M), captions for meaningful audio,
left-handed HUD, colour palette for state colours (default, deuteranopia, tritanopia, high contrast), undo in
practice, replay tutorials, camera reset. Dropped as stored-but-dead: hold-to-aim, timing assistance, haptics,
profile privacy, and the anonymous-telemetry consent (its queue was never sent anywhere).
All strings come from `src/ui/strings/*.js` (+ `port.js` for strings added or reworded for this build) in the nine
locales (en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT), in the runtime's interface language.

## 5. Platform integration

- **Save** (`native/platform.ts`, `src/session/cloud.js`): `{ v: 1, progression, achievements }` (the wrapped,
  checksummed documents of persistence.js) through engine `saves` — device and cloud; conflicts merge entry by entry
  (best stars/scores/XP, furthest stage, every achievement). The browser build's cloud slot (`game:<slug>`,
  `{ kind: 'progression', doc }`) is read as a foreign save, merged in and replaced once. Achievements now travel
  with the save (the browser build kept them on the device). The guest profile name and local score records stay on
  the device. Guests' old browser localStorage cannot migrate.
- **Settings**: the game's options are engine `settings` (synced); the browser build's KV values (accessibility
  palette/captions/left-handed, rules.undoInPractice, lastTheme) are adopted once, then its keys removed.
- **Leaderboard**: a completed Journey, Daily or Challenge round, signed in, posts its total to `high-score` through
  `score-script.js` (unchanged: a practice session, `{ type: 'result', scores }`, range-checked 0–1,000,000), then
  shows the rank. Leaderboards shows the StarHermit board (global and friends) signed in, else this device's records;
  Today shows this device's records for the day (there is no platform daily board).
- **Daily**: the day comes from the platform's clock (`serverNow`), else the device's UTC date.
- No hosted multiplayer: the game is single-player.

## 6. Checks

- `npm run test:unit` — rules, replay, fuzz, golden hashes, content validity, dev server, i18n (every key in nine
  locales, every `T()` key the engine client draws).
- `npm run test:native` — tsc, `starhermit check` with no warnings, web index up to date, and the render-check play
  scripts in `tests/native/`: menus (every screen), Journey stage 1 by keys to results then pause/settings/hint,
  Lesson 1 on a DPR-3 phone by touch, Practice (easy, undo, retrigger) on a DPR-3 landscape phone.
- `npm run test:browser` — the packaged loader in GPU Chrome: desktop Journey by keys, phone lesson by touch,
  landscape Help/Settings and a Challenge paused and left (leaving shows the "Round left" results, as before).

## 7. Known limitations

- Pre-existing behaviour kept: the hint names a tool and position but places nothing; the Daily is ranked on the
  shared high-score board like any completed round.
- Fixed in the port: the lesson's aim step was reported before the placement and never advanced (it now does).
- Signed-in paths (foreign save, legacy settings, score posting) are covered by unit tests, not live-tested here.
