# Render spike — review scenes

These are for E's review gate after chunk 4 (spec §10): do row strips give an acceptable depth order on cliffs and slopes, and does a click land on the hex you meant?

Art is placeholder, but it goes through the real pipeline: the fixtures' generated SVGs (`fixtures/src/art.ts`: textured hex tops, a layered cliff face, posed figures) are baked into atlases in the browser at startup and drawn as atlas textures (chunk 7). **Camera, after E's review (18 Nov):** the screenshots now use a camera pitched 55° above the horizon, closer to Civilization VI and Beyond Earth than the spike's first camera (about 27°, a squash of 0.5 with heights unscaled). Ground depth shrinks by sin(pitch) and height by cos(pitch), so hexes are rounder and cliffs shorter (D192, N10). `camera-pitch-emberfall.png` and `camera-pitch-terraces.png` compare the spike camera, 45°, 55° and 65° on the same scenes (they predate the new terrain below, so they still show ramps).

**Terrain, after E's N6 ruling (20 Nov):** heights follow Catlike Coding's Hex Map. Each hex has a flat inner hex (75% of its size) at its level. Between two hexes one level apart is a walkable slope, drawn as two terraces (the darker bands are the rises). Two or more levels apart is a cliff, with a face on the sides the camera sees. Ramps are gone (D194).

Scenes 01–05 are the elevation fixture (`fixtures/src/elevation.ts`); 06–08 are Emberfall. All are drawn by the real renderer in headless Chromium at device pixel ratio 2.

| File | What to look at |
|---|---|
| `01-unit-behind-cliff.png` | The dummy at the top stands on low ground north of the plateau, drawn before the plateau's strips. At 55° the camera sees over a level-2 cliff, so only its feet meet the plateau's edge; at the spike's 27° the plateau covered its lower half. A taller cliff still covers it (the occlusion test raises the plateau to level 6 for this). |
| `02-unit-on-plateau-edge.png` | The dummy stands on the plateau's southern edge, above the cliff face. It draws over its own strip (top and face) and before the ground below. |
| `03-unit-on-step.png` | The dummy stands on the terrace's one-level step (dirt, level 1) at z 0.5. The step meets the ground (level 0) and the plateau (level 2) with terraced slopes on every side, so it is the way up from both. |
| `04-pick-on-raised-hex.png` | A click at the yellow ring. The readout says `pick (9, 4) level 2 stone z 1.00` and the plateau cell is outlined. A flat pick at that screen point would have hit a ground cell further north. |
| `05-terraces-overview.png` | The whole fixture: plateau (level 2, cliffs to the ground), terrace (level 1, slopes to both), the step, pond, rock pillar, level-3 spire. |
| `06-emberfall-plateau.png`, `07-emberfall-overview.png` | Emberfall with the same renderer. |
| `camera-pitch-*.png` | The same two scenes at the spike camera, 45°, 55° (the new default) and 65°, for choosing the angle. `?pitch=50` on the player page tries any angle; `?pitch=spike` shows the first one. |
| `08-boss-telegraph.png` | The player starts beside the boss, which winds up its slam. The red area on the ground is the slam's hitbox, drawn for the whole windup (the telegraph, D150), with the HUD's health bars. |

## See it live

```bash
npm install
```

```bash
npm run dev -w @loreengine/player
```

Then open the URL Vite prints, with `?fixture=elevation` for this map. Mouse wheel zooms (0.5 to 2), a click picks, the readout shows the hovered and picked cell. `?focus=8,6&zoom=1.7` centers a cell; `?pick=9,4` clicks one.

## Regenerate the screenshots

```bash
npm run build -w @loreengine/player
```

```bash
node tools/spike-screenshots.mjs
```

## What the spike found

- **The row-strip rule holds on every scene tried.** Cliffs cover what is behind them, and units on raised ground draw over what is below.
- **One refinement was needed.** Hex rows interlock, so a unit standing in the lower part of its hex overlaps the tops of the next row, which the plain rule draws *after* it and over its feet. The draw list therefore sorts an entity by the front edge of its footprint (its collider circle), not by its center point. It never sorts into a row it could not be standing on, so a unit just behind a cliff stays behind it. This is tested (`[P3B.depth.order]`) and logged as D81.
- **Known limit: sprites much wider than their collider.** The footprint is the collider radius. Art that extends well past it at ground level (a wide shadow, a dragging cloak) can still be clipped by the next row's tops. Art convention for now: keep feet inside the collider's circle.
- **Occlusion silhouette (chunk 7):** a covered player-controlled or persistent unit gets a tinted, translucent copy drawn on top. It is not masked to the covered part yet, so it also lightly tints the visible part (D151).
- **Slopes have no seams.** The wide-ramp question (DECISIONS_LOG N6) is gone with the ramps: a slope is a property of an edge, so a row of one-level steps is one continuous terraced bank. The renderer builds the same heights the simulation uses (`World.surfaceHeightIn`); tests check every mesh vertex against it.
- **Render budget (§9.1):** measured by `tools/browser-checks.mjs` on a 128 × 128 map; the numbers and what they do and do not cover are in `docs/PROGRESS.md`, Bench numbers.
