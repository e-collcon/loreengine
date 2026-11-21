# LoreEngine

A hex-iso action RPG engine and editor: a headless runtime, a PixiJS renderer, a player client, and an editor that playtests clones of the project. Version 0.1.0 is the foundation build (spec `Context/FOUNDATION_DESIGN.md`, chunks 1–9). Where it stands: `Context/PROGRESS.md`; why it is the way it is: `Context/DECISIONS_LOG.md`.

**New here? Start with `Context/README.md`**: progress, decisions, the spec and the QA checklist in one folder.

## Set up (once)

Needs Node 22 or newer and git.

```bash
npm install
```

```bash
npx playwright install chromium
```

## Run

The editor (Emberfall opens on first start; the project autosaves to the browser's IndexedDB):

```bash
npm run dev -w @loreengine/editor
```

The player on its own (`?fixture=elevation` for the render spike's map):

```bash
npm run dev -w @loreengine/player
```

## Check

All gates: typecheck, production builds, the nondeterminism lint, the tests, and the browser checks (about 8 minutes):

```bash
npm run gates
```

The simulation tick bench:

```bash
npm run bench
```

The render bench on this machine's GPU (a Chromium window opens for about half a minute; build first):

```bash
npm run build
```

```bash
npm run bench:render
```
