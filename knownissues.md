# Known Issues — Workshop Mayhem

QA pass 2026-08-20. Static review driven by Qwen3.8 27B on vision182 (HauhauCS Q2_K_P, 8192-token
context), alongside the game's own test suite, its offline content validator, and a headless-Chrome
run written for this pass. Every defect below was reproduced against the running server or the real
modules — none is a model claim taken on trust.

## Test results

| Check | Result |
| --- | --- |
| `npm test` | 32 passed, 0 failed (re-verified 2026-09-05) |
| `node tests/run.mjs` (the suite the README documents) | 32 passed, 0 failed |
| `node tools/validate-content.mjs` | 98 levels checked, 0 failed |
| `node --check` on all modules (`src/**/*.js`, `server.js`, `tests/*.mjs`, `tools/*.mjs`) | clean, no failures |
| `tests/e2e.mjs` (`npm run test:e2e`) | E2E PASS — desktop + mobile, no page errors (re-verified 2026-09-05) |
| Headless Chrome (written for this pass, ports 39704-39707) | PASS — boot, title → Journey → stage j01, HUD, accessible board mirror, keyboard-only play to a terminal phase, three viewport changes; zero console errors, zero uncaught page errors |

`npm test` fails with `ENOENT: … package.json`. The README documents `node tests/run.mjs` instead,
and that is what was run. Worth noting as a packaging gap rather than a game defect.

## Confirmed defects

### 1. A single malformed request body kills the whole server process — FIXED 2026-08-26

**Fix:** the request handler now answers 400 `malformed-json` on a parse failure instead of passing
`null` through, the submit and save endpoints 400 on a non-object body (`malformed-body`), and
`levelForBoard` guards `entry?.levelId`. Verified by replaying the original curl triggers: both
return 400 and the process survives.

- **File:** `server.js:150-160` (request handler), `server.js:66-72` (`levelForBoard`),
  `server.js:132` (save handler)
- **Trigger:** `POST /api/v1/leaderboard/submit` with a body that is not valid JSON. Also
  `PUT /api/v1/save/<key>` with the same.
- **Behaviour:** The handler swallows the parse error and sets `body = null`, then passes that
  straight on. `levelForBoard(null)` evaluates `entry.levelId?.startsWith('d')` — optional chaining
  guards `levelId`, not `entry` — and throws. The throw happens inside the `async` `createServer`
  callback with no `.catch`, so Node's default unhandled-rejection policy terminates the process.
  The client gets no response at all, and the server is gone for everyone else.
- **Expected:** spec.md §5 — "Validate all network input for identity, session membership,
  turn/tick, bounds, rate, payload size, and legal action"; §6 — errors should be "recoverable UI
  states". A malformed body must produce a 400, not a process exit.
- **Evidence:**

  ```
  $ curl -X POST -H 'content-type: application/json' --data 'not json' \
      http://localhost:39704/api/v1/leaderboard/submit
  http=000                      # connection dropped, no response
  $ curl http://localhost:39704/api/v1/time
                                # nothing — process is dead

  server log:
  TypeError: Cannot read properties of null (reading 'levelId')
      at levelForBoard (file:///…/workshop-mayhem/server.js:67:13)
      at handleApi   (file:///…/workshop-mayhem/server.js:108:19)
      at Server.<anonymous> (file:///…/workshop-mayhem/server.js:166:14)
  Node.js v22.22.1
  ```

  The save endpoint dies the same way on `PUT /api/v1/save/test` with body `oops`:

  ```
  TypeError: Cannot read properties of null (reading 'doc')
      at handleApi (file:///…/workshop-mayhem/server.js:132:73)
  ```

### 2. A replay-validated entry can lie about its tick count and win the tie-break — FIXED 2026-08-26

**Fix:** `validateScoreClaim` now returns the replay-authoritative `tie` block
(`v.score.tie`) and the stored row uses `verdict.tie.ticks` — the client's top-level `ticks`
is discarded for replay-validated entries. Casual (non-replay) rows derive a `tie` block from
the claimed components.

- **File:** `server.js:47-64` (`validateScoreClaim`), `server.js:113-118` (row construction and sort)
- **Trigger:** Submit a genuine, replay-verified envelope but set the top-level `ticks` field to any
  value inside the accepted 10-12000 range.
- **Behaviour:** `validateScoreClaim` cross-checks exactly one field against the replay
  (`v.score.total !== claim.score`). The replay result also carries the authoritative duration in
  `v.score.tie.ticks`, but that value is discarded; the stored row uses the client's `body.ticks`,
  and the board sorts on `b.score - a.score || a.ticks - b.ticks`. The forged entry is still
  labelled `validated: "replay"`.
- **Expected:** spec.md §5 — "Treat client clocks, scores, inventories, roles, physics outcomes, and
  completion claims as untrusted in competitive contexts"; §2 — the tie-break must use "lower
  authoritative elapsed time".
- **Evidence:** the *same* verified envelope for `j01` submitted twice:

  ```
  honest run: terminal = goal-complete  score = 1060  true ticks = 187
  verifyReplay -> {"valid":true,"reason":"ok", …}
  honest (ticks=187) -> {"ok":true,"validated":"replay","rank":1}
  liar   (ticks=10)  -> {"ok":true,"validated":"replay","rank":2}
  board: 1. liar (score 1060, ticks 10, replay) | 2. honest (score 1060, ticks 187, replay)
  ```

### 3. The rank reported to a submitter is always the bottom of the board — FIXED 2026-08-26

**Fix:** the pushed row object is kept in a `row` variable and the response reports
`rows.indexOf(row) + 1` after the sort. Verified: four submissions (5000/3000/1000/9000) now
report ranks 1, 2, 3, 1.

- **File:** `server.js:122`
- **Trigger:** Submit any score to a board that already has entries.
- **Behaviour:**

  ```js
  rank: rows.findIndex(r => r.when === rows.at(-1)?.when) + 1
  ```

  `rows` has already been sorted on the line above, so `rows.at(-1)` is the *worst* row, not the row
  just pushed. With distinct `when` timestamps the expression always evaluates to `rows.length`, so
  every submitter is told they finished last — including the new leader.
- **Expected:** The response should report the inserted row's position in the sorted board.
- **Evidence:** four submissions to a fresh board, the last one the highest score:

  ```
  top  score 5000 -> rank 1
  mid  score 3000 -> rank 2
  low  score 1000 -> rank 3
  best score 9000 -> rank 4        <-- actually first
  actual board order: 1.best(9000) 2.top(5000) 3.mid(3000) 4.low(1000)
  ```

### 4. The leaderboard sort ignores the spec tie-break order; `compareResults` is never used outside tests — FIXED 2026-08-26

**Fix:** the board now sorts with `compareResults` from `src/rules/scoring.js` (completion,
score, fewer invalids, lower ticks, then stable session id). Rows store the `tie` block and
`sessionId` (the client now submits `sessionId`); legacy rows without `tie` get a synthesized
fallback in the comparator call.

- **File:** `server.js:118`; `src/rules/scoring.js:67-73` (`compareResults`)
- **Trigger:** Any board with entries that differ in completion or invalid-action count.
- **Behaviour:** The board sorts with `(a, b) => b.score - a.score || a.ticks - b.ticks`.
  Completion and invalid-action count — the first and third keys the spec names — are never
  consulted, and the row does not even store them. `compareResults`, which implements the ordering
  correctly, is imported only by `tests/rules.test.mjs`; `grep -rn compareResults src/ server.js`
  finds no production caller.
- **Expected:** spec.md §2 — "Ties use, in order: primary objective completion, fewer invalid
  actions, lower authoritative elapsed time, then stable session identifier."
- **Evidence:** the source lines above, plus the grep result showing `compareResults` appears only
  in `src/rules/scoring.js` (its definition) and `tests/rules.test.mjs`.

### 5. The shipping server serves the design document and the unbundled sources — FIXED 2026-08-26

**Fix:** requests for `.md` files now get 403 alongside the existing traversal/dot-file guard
(`spec.md` and `knownissues.md` verified 403). `src/` remains served — it is the runtime
ES-module tree. Also added the missing `.opus` → `audio/ogg` MIME entry so the sfx files are
served with a proper content type.

- **File:** `server.js:169-180`
- **Trigger:** `GET /spec.md`, `GET /src/rules/engine.js`
- **Behaviour:** Both return 200. The traversal guard blocks `../` and dot-files but nothing
  excludes design documents; `.md` is absent from the `MIME` table so `spec.md` is simply served as
  `application/octet-stream`.
- **Expected:** spec.md §6 — "Keep source files, secrets, design documents, and source maps outside
  the uploaded distribution." (`src/` is the runtime ES-module tree and must be served; `spec.md`
  must not be.)
- **Evidence:**

  ```
  GET /spec.md            -> 200 application/octet-stream
  GET /src/rules/engine.js -> 200
  ```

### 6. `npm test` does not work — the distribution has no `package.json` — FIXED 2026-08-26

**Fix:** added `package.json` (`"type": "module"`) with `test` → `node tests/run.mjs`,
`validate` → `node tools/validate-content.mjs`, and `start` → `node server.js`.
`npm test` now runs the suite (32 passed, 0 failed).

- **File:** repository root (absent `package.json`)
- **Trigger:** `npm test` in `~/games/workshop-mayhem`
- **Behaviour:** `npm error enoent Could not read package.json`. Every sibling game in this fleet
  ships one with a `test` script.
- **Expected:** A runnable `npm test`; the suite itself exists and passes via `node tests/run.mjs`.
- **Evidence:** `ls` shows no `package.json`; the README documents `node tests/run.mjs`.

## Suspected — not confirmed

### 1. Skip may return before the world settles

- **File:** `src/rules/engine.js:441-452` (`doSkip`), `src/rules/engine.js:19-20`
- **Concern:** `SKIP_CAP` is 3600 ticks while `DEFAULT_MAX_TICKS` is 7200, so a world that stays in
  motion past 3600 ticks leaves `doSkip` with `state.settled === false` and no terminal state.
  spec.md §2 requires that "skip/fast-forward must settle every object into the exact deterministic
  end state."
- **Why unconfirmed:** no shipped stage was found whose motion persists past the cap — the content
  validator settles all 98 levels well inside it — so the branch may be unreachable with authored
  content. It would need a fuzzed or hostile world to trigger.

### 2. `/api/v1/save/*` has no authentication

- **File:** `server.js:129-140`
- **Concern:** Any client can `PUT` or `GET` any save key. The key is sanitised against traversal
  (`replace(/[^\w-]/g, '')`) but not scoped to a caller, so one player's cloud save can be read or
  overwritten by another.
- **Why unconfirmed:** this file is documented as a local dev server, and the hosted StarHermit
  shell may terminate authentication before the request arrives. Cannot be settled from the
  distribution alone.

### 3. Leaderboard tie-break puts completion ahead of score

- **File:** `src/rules/scoring.js:67-73`
- **Concern:** As in the sibling games, the spec sentence "Ties use, in order: primary objective
  completion, …" is naturally read as the tie-break applied *after* the primary metric, but
  `compareResults` compares `tie.complete` before `total`. Vanishing Cubes orders score first.
- **Why unconfirmed:** the spec wording is ambiguous and `tests/rules.test.mjs:198` explicitly
  asserts "completion beats score". Needs a human ruling. (Note this is a separate question from
  defect 4 above, which is that the server does not use this comparator at all.)

## Checked, no defects found

- **Rules engine** (`src/rules/engine.js`): legal-action enumeration, placement legality with
  specific invalid reasons (mount occupancy, ground snap, clearance), trigger arming, goal
  evaluation, and the five terminal reasons — all covered by the 32-suite run and re-read against
  spec.md §2. Completion is latched via `winSettle` before the limit checks, so satisfying the goal
  on the final tick correctly terminates as `goal-complete` rather than `time-limit`.
- **Determinism** (`src/session/replay.js`, `src/rules/serialize.js`): fixed 1/120 step, integer
  lattice construction, seeded streams, stable hashing; the suite property-tests 10 sessions for
  identical hashes, verifies 8 envelopes against fresh rules, and rejects tampered envelopes.
- **`verifyReplay`** (`src/session/replay.js:62-119`): re-executes commands at their recorded ticks,
  rejects duplicate command ids, requires recorded rejections to reject identically, checks every
  periodic hash, and compares the terminal reason and score. This function is sound — the defects
  above are all in the *server code around it* that ignores the values it returns.
- **Content** (`src/content/*`): 40 journey stages, 8 challenges, 5 lessons and 45 generated dailies
  each replay their constructive reference solution to completion — 98 levels, 0 failures — proving
  reachability, legality, bounded duration and absence of soft locks.
- **Scoring** (`src/rules/scoring.js:16-55`): integer components, style capped at `styleCap`, total
  floored at zero, efficiency and swiftness gated on primary completion, and a per-component
  breakdown rather than a single total.
- **Fuzzing:** the shipped suite already covers malformed commands without state corruption, 150
  daily seeds producing bounded worlds, and extreme tool spam — all pass.
- **Static path handling** (`server.js:169-175`): `normalize` + `join` + `startsWith(ROOT)` plus a
  `/.`-prefix rejection correctly blocks traversal and dot-files.
- **Client runtime:** headless Chrome reached stage `j01` through Play → Journey, rendered the HUD
  and a live accessible board mirror ("Dummy at -3.0 metres right, 0.5 up, moving, airborne. Tools
  left: 1 piston. Main goal (bell): not hit. Score: 3."), advanced the simulation to tick 539 and a
  `terminal` phase under keyboard-only input, and survived portrait/landscape/desktop viewport
  changes with zero console errors.

## Not tested

- **Gamepad input** — no gamepad available in headless Chrome.
- **WebGL context-loss recovery** — the software renderer here does not reproduce a real context
  loss.
- **Real hosted StarHermit integration** (launch tokens, sign-in, presence, cloud-save conflict
  resolution, activity start/end accounting) — only the bundled local `/api/v1` surface exists.
- **Rate limiting** — `server.js` implements none, so there was nothing to exercise. spec.md §5
  lists "rate" among the properties network input must be validated for.
- **Performance budgets** (≤150 draw calls, ≤350 k triangles, 90 s stability, memory flatness) —
  rendering ran under SwiftShader software rasterization, so the numbers would be meaningless.
- **Screen-reader behaviour** — the live regions and board mirror were verified structurally and do
  emit useful text, but no assistive technology was driven.
- **Audio** — headless Chrome has no audio output; the WebAudio graph was not exercised.
