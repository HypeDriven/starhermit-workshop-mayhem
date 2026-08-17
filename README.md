# Workshop Mayhem

A physics toy for the browser: use whimsical tools — the Wallop Piston, Boing
Pad, Gust Fan, Snatch Magnet and Thumper Weight — on a resilient plush
training dummy to solve physics challenges across a playful inventor's
workshop. Three.js-first presentation with a fully usable semantic HTML
interface layer, a deterministic rules engine, and seeded, replayable,
server-validatable runs.

## Run it

Everything is dependency-free and vendored. Any static file server works:

```bash
node server.js          # http://localhost:8080  (also provides /api/v1 dev APIs)
# or: python3 -m http.server 8080
```

Open the URL in a modern desktop or mobile browser. Progress, settings,
boards, and cosmetics persist locally; practice works fully offline after
first load.

## Play it

- **Loop:** choose a tool, place or trigger it, watch the physics, satisfy the goal.
- **Pointer/touch:** tap a tool in the tray, then drag on the playfield to
  place-and-aim (pistons snap to wall mounts; pads snap to floors). Tap an
  armed tool (or its ⚡ chip) to trigger it.
- **Keyboard:** `1–5` select tool, arrows move the cursor, `Enter` place,
  `Space` trigger, `U` undo, `H` hint, `S` fast-forward, `R` restart,
  `P`/`Esc` pause, `C` camera reset, `M` mute. Bindings are remappable in Settings.
- **Gamepad:** stick moves the cursor, A places, X triggers, B cancels,
  bumpers cycle tools, Start pauses.

**Modes:** Learn (5 hands-on lessons), Journey (40 authored stages in 6
chapters with mastery stages), Daily (one shared seed per UTC day), Practice
(undo + difficulty presets, unranked), Challenge (8 constrained stages: move
limits, speed targets, time caps), Score chase (validated leaderboards).

## Architecture (`src/`)

| Module | Role |
| --- | --- |
| `rules/` | Pure deterministic engine: verlet soft-body physics (fixed 1/120 step, integer-lattice construction, no transcendentals in the sim path), commands, legality with explicit invalid reasons, goals, integer scoring, serialization + stable hashing, seeded RNG streams. |
| `content/` | Versioned content: schema + authoring helpers, 40 journey stages + 8 challenges + 5 lessons as parameterized archetypes with **constructive reference solutions**, deterministic daily generator, 6 cosmetic themes, static achievements. |
| `session/` | Session controller (fixed-step accumulator + interpolation alpha, undo snapshots, tutorial tracking), replay envelopes (schema/build/seed/commands/periodic hashes/terminal) with `verifyReplay`, versioned checksummed persistence with migrations and cloud-conflict resolution. |
| `render/` | Three.js scene: authored camera rig (critically damped springs, tiered shake), procedural PBR materials, soft-body dummy mesh rebuilt from particles, instanced workshop, pooled VFX, quality tiers (shadows/env detail/particles/post/AA/render-scale — never rules), WebGL context-loss recovery, dynamic render scale. |
| `ui/` | Semantic HTML shell: screens (title/modes/journey/learn/practice/challenge/daily/boards/achievements/cosmetics/help/settings/profile), HUD with projected trigger chips, unified pointer/keyboard/gamepad input with ghost + trajectory previews and invalid-action explanations, live regions + navigable board mirror + captions. |
| `audio/` | Fully synthesized WebAudio: music/effects/ambience/voice buses, event-mapped transients with seeded pitch variants, adaptive music, quiet ambience, background ducking. |
| `platform/` | Launch-token scope detection, same-origin `/api` client with retries + 429 backoff, round-trip server-time sync, presence/activity lifecycle, leaderboards + cloud save with local fallback, consent-gated anonymous telemetry. |

`server.js` is the declared authoritative script (`starhermit.txt`):
importable validation functions (replay verification, plausibility checks,
daily session descriptors, achievement definitions) plus a zero-dependency
local static + `/api/v1` server.

## Determinism and validation

- Same version + seed + commands ⇒ identical state hashes. Verified by
  property tests and by **cross-environment replay**: browser-recorded
  envelopes verify bit-exact under Node (`server.js`/`verifyReplay`).
- Every stage ships a constructive reference solution; the offline validator
  replays all of them through the real engine, proving reachability, legality,
  bounded duration, and no soft locks (48 stages + 5 lessons + 8 challenges +
  45 generated dailies).
- Leaderboards submit `{score, components, ruleset, contentVersion, seed,
  assists, duration, envelope}`; hosted boards re-run the replay, otherwise
  boards are labeled casual with plausibility/rate checks.

## Verification toolbox

```bash
node tests/run.mjs               # 32 suites: rules, replay, fuzz, golden, content
node tools/validate-content.mjs  # replay every solution; --calibrate suggests pars
node tools/trace-level.mjs j16   # step-by-step solution trace for one stage
node tools/calibrate.mjs         # physics envelope measurements
```

Headless-browser end-to-end coverage (title → journey → full round → results,
learn flow, practice undo/skip, daily, keyboard-only, boards, responsive
portrait/landscape, zoom 200%, 90 s stability run) was run with puppeteer-core
during development; budgets observed: ≤150 draw calls and ≤350 k triangles in
play, flat memory, zero console errors.

## Notes

- Cosmetic themes alter materials, lighting and ambience only — never
  hitboxes, timing windows, information, or power.
- The experience, names, geometry, textures, and sounds are original and
  procedurally generated in code; Three.js is vendored under `vendor/`.
- `starhermit.txt` declares `name=Workshop Mayhem`, `launch=index.html`,
  `server=server.js`.
