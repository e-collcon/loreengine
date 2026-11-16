# Render spike — review scenes

These are for E's review gate after chunk 4 (spec §10): do row strips give an acceptable depth order on cliffs and ramps, and does a click land on the hex you meant?

Art is placeholder: flat-colored hex tops, two-tone cliff faces, capsule figures with a white dot showing facing. The map is the elevation fixture (`fixtures/src/elevation.ts`), drawn by the real renderer in headless Chromium at device pixel ratio 2.

| File | What to look at |
|---|---|
| `01-unit-behind-cliff.png` | The dummy at the top stands on low ground north of the plateau. The plateau's lifted top covers its lower half: it is drawn before the plateau's strips. |
| `02-unit-on-plateau-edge.png` | The dummy stands on the plateau's southern edge, above the cliff face. It draws over its own strip (top and face) and before the ground below. |
| `03-unit-on-ramp.png` | The dummy stands on the upper of two stacked ramps (level 1 → 2), at the ramp's height. The ramps are the same top art, tilted; their sides show as half-level faces. |
| `04-pick-on-raised-hex.png` | A click at the yellow ring. The readout says `pick (9, 4) level 2 stone z 1.00` and the plateau cell is outlined. A flat pick at that screen point would have hit a ground cell two rows further north. |
| `05-terraces-overview.png` | The whole fixture: plateau (level 2), terrace (level 1) with its ramp, pond, rock pillar, level-3 spire. |
| `06-emberfall-plateau.png`, `07-emberfall-overview.png` | Emberfall with the same renderer. |

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
- **Known limit: no occlusion silhouette yet.** A unit fully behind a tall cliff is simply hidden. The tinted silhouette of §6.6 comes with the rest of Phase 3B (chunk 7).
- **Ramp sides are drawn as half-level faces.** That is the wide-ramp question (DECISIONS_LOG N6) made visible: two same-direction ramps side by side would show a seam like these sides.
- **Not measured yet:** the 8 ms render budget on a 128 × 128 map (§9.1). The bench is a browser bench and has not been written.
