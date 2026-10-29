# Workshop Mayhem

A physics toy on the StarHermit engine: use whimsical tools — the Wallop Piston, Boing Pad, Gust Fan, Snatch
Magnet and Thumper Weight — on a resilient plush training dummy to solve physics challenges across a playful
inventor's workshop. Learn (5 lessons), Journey (40 stages in 6 chapters), Daily, Practice, Challenge (8 stages)
and Score Chase (the StarHermit high-score board).

It is an engine script game (`starhermit.txt`, entry `native/main.ts`, engine 1.23.0, minor 24): played natively
by the StarHermit client and in browsers through the web loader (`index.html`, written by `npm run package`).

- `src/rules`, `src/content`, `src/session` — the deterministic rules, content and session (shared with the tests).
- `native/` — the engine client: flow and input (`main.ts`), the 3D workshop (`render.ts`), UI (`screens.ts`,
  `style.ts`), sound (`audio.ts`), save and platform (`platform.ts`), graphics levels (`quality.ts`), strings (`i18n.ts`).
- `score-script.js` — the platform script (`server=`) that range-checks posted high scores.
- `server.js` — a local dev static server with `/api/v1` stand-ins (not part of the package).

```bash
npm test               # unit tests + native checks (tsc, starhermit check, render-check play scripts)
npm run test:browser   # the packaged loader in GPU Chrome (desktop, phone, landscape)
npm run css            # tools/ui-style.css -> assets/ui-style.json
npm run package        # rewrite index.html + starhermit-files.json (after every change)
```

See `spec.md` for controls, screens, settings and platform integration.
