# LoreEngine — Build Progress

Session of 17 Nov 2026 (GMT+7), started 00:47. Hard stop 14:59; no new chunk after 13:30. **Extended by E after the hard stop** ("I intend to use all of them"): chunk 8 was built from about 20:20.

| Chunk | Status | Tag | Elapsed | Notes |
|---|---|---|---|---|
| 1 Schema | **Green** | `chunk-1-green` (287d965) | 0h22 | Workspace, 10 packages, schema source, validators, reader manifest (310 fields), ported hex math / A\* / spatial hash with new suites, Emberfall |
| 2 Runtime core | **Green** | `chunk-2-green` (b312aef) | 0h18 | Tick scheduler, events and cascade cap, evaluator, executor, variables, RNG, input frames, save boundary and exact resume, storage package |
| 3 World (3A) | **Green** | `chunk-3-green` (8a83937) | 0h10 | Elevation queries, link table, connection-table and continuity tests, lint, map lifecycle, cross-map teleport, spawn / despawn / teleport, leak gate. **See N6: wide ramps.** |
| 4 Render spike (3B) | **Green** | `chunk-4-green` (3e47d7f) | 0h13 | Projection, strip geometry with cliff faces, draw-list depth order, height-aware picking, PixiJS renderer, player client and input mapper, seven screenshots in `docs/spike/`. **E review gate pending.** |
| 5 Movement, sight, click orders (4A) | **Green** | `chunk-5-green` (cf8c476) | 0h21 | Movement, collision, separation, pathing with budgets, `castSegment`, high ground, acquisition, brains, region events, interact, click orders, zero-alloc gate, first tick bench |
| 6 Combat (4B) | **Green** | `chunk-6-green` (62d807c) | 0h30 (see note) | Attacks and telegraphs, contact, knockback, hitstop, dodge with i-frames as an effect, active effects, health and death, terrain contact, scripted jumps, animator. Emberfall's boss fight plays headless. |
| 7 Presentation | **Green** | `chunk-7-green` (08dacb7) | 0h40 (see note) | SVG bake, atlas textures on terrain and sprites, animation playback, feedback (flash, shake, particles, telegraph), occlusion silhouette, audio mixer, HUD. Three items are simplified: see Known issues. |
| 8 Editor shell (5A) | **Green** | `chunk-8-green` (ad23289) | 1h50 | Editor document and 200-command undo, map preview over the headless `World`, terrain / raise / lower / flatten / ramp / region / place / select tools, overlays (levels, blocked edges, lint with click-to-focus, regions, sight), inspector, autosave to IndexedDB, playtest overlay with debug overlays, pause and step, repro files. Four screenshots in `docs/editor/`. |
| 9 Database editors | Not started | — | — | |

## Gate results (latest)

Run with `npm run gates` (typecheck, builds, nondeterminism lint, tests, browser checks).

| Gate (spec 9.6) | Result |
|---|---|
| 1. `tsc --noEmit`, strict, every package | Pass: 10 packages, sources and tests |
| 2. Production builds of `editor` and `player` | Pass: both are real apps now |
| 3. Package boundary test | Pass (`editor` imports only `runtime`'s public entries, `@loreengine/runtime` and `/view`) |
| 4. Chunk 8 signature and behavior tests | Pass: ★ undo integrity (200 commands undone to a byte-identical project; 500 commands undone to exactly 200 back, D168), ★ playtest isolation (5,000 ticks with kills and variable changes: document byte-identical, revision unchanged, nothing autosaved), lint finds the broken ramp with a place to focus, preview, overlays, strokes, autosave timing, repro round trips with pause and step |
| 5. Earlier chunks' tests | Pass, unchanged in chunk 8 (D178); earlier logged edits D76, D116, D141, D155 |
| 6. Replay determinism | Pass: 10,000 ticks, three runs, checkpoints every 1,000 ticks; save-resume at 5,000; mid-chase save-resume; and now through repro files |
| 7. Leak gates, budget benches | Pass. Map leak gate and zero-allocation gate pass. **Playtest leak gate passes:** 50 Play/Stop cycles in the editor, textures, audio nodes and canvases back to baseline after every Stop, heap +2.2% between cycle 10 and 50 (limit 5%; D161, D162, D163). Tick and render benches measured (below). |

Totals: 478 tests in 28 files, plus the browser checks. `npm run gates` exits 0.

## Bench numbers (measured)

Measured in this session's cloud container, not on E's machine. Re-run the tick bench and the browser checks with:

```bash
npm run bench
```

```bash
npm run build && npm run check:browser
```

| Budget (spec 9.1) | Target | Measured | Notes |
|---|---|---|---|
| Simulation tick, large bench | ≤ 4 ms | **mean 0.30 ms, p50 0.28 ms, p99 0.63 ms, max 1.3 ms** | 301 entities on a 64 × 64 map with cliffs and ramps; 60 hunters with a target, 44 of them in their fight state swinging, 123 walking paths. |
| Allocation in hot paths | 0 bytes per tick | **28,072 bytes of heap growth over 10,000 ticks** (gate: < 65,536) | 300 bodies moving, colliding, separating and swinging (1,129 hits landed); 1.32 million `castSegment` / `canSee` calls. A control run that retains one small object per tick fails the gate, as it should. |
| Render frame | ≤ 8 ms, 128 × 128 map | **zoom 1 (21 rows on screen): mean 0.5–0.6 ms to build and submit a frame, 0.8–1.7 ms including rasterization. Zoom 0.5 (39 rows): mean 1.8–2.9 ms to build and submit, 2.1–6.1 ms including rasterization.** p99 6–30 ms across runs | Production build, 1,280 × 800 viewport, baked atlas art, camera panning; ranges over five runs during the session. Rasterization here is SwiftShader on the CPU, so it moves with the shared container's load (the later runs were slower; no change in chunk 8 touches that scene's draw path). The page's clock is coarse (0.1 ms), so the means come from whole-run time; the p99 spikes are garbage collection and CPU contention. **Not E's machine with a GPU:** run it there before calling the budget met (D158). |

## Needs E

See `docs/DECISIONS_LOG.md`, section **Needs E** (N1–N9). **N6 is the one to read first:** the spec's wide-ramp clause and its continuity promise cannot both hold on a hex grid, and I chose continuity. **N9 next:** I implemented my recommendation (the editor owns the baked art and one playtest renderer), which moves those two things from the Playtest scope of §9.3 to the Editor scope; please confirm.

## Known issues

- **The session lost about 9.5 hours to two usage-limit pauses** (roughly 02:15 to 06:42 and 07:10 to 12:15 GMT+7). Elapsed times in the table count working time only. Chunk 8 was built after the hard stop, at E's request.
- Git pushes were refused (HTTP 403) for the first ~12 minutes of the session, until GitHub access was granted. Branch pushes work since; **tag pushes are still refused**, so `chunk-N-green` tags are local to the session and each green commit is listed by SHA in the table above (N5).
- **The spike review gate is open.** `docs/spike/README.md` lists the scenes and what the spike found. The screenshots now show the baked placeholder art.
- **Chunk 7 simplifications** (each logged): the occlusion silhouette is not masked to the covered part (D151); flashing-as-outline is stored but drawn as a tint (D152); a telegraph also tints units standing in front rows of its area (D150).
- **The standalone player page still grows about 15 KB of heap per start/stop** (PixiJS keeps a little per renderer and per new texture; N9). It is reported by `check:browser`, not gated: the spec's gate is the editor's playtest, which passes. A shipped game starts its client once.
- **Fixed in chunk 8, found by the leak gate (D163):** destroyed terrain strips and sprites kept their GPU buffers and graphics contexts. Short-lived renderers hid it; the editor's canvas would have grown with every edit.
- **Fixed after chunk 7, found by the leak gate (D157):** a second client started on the same host saw a 150 px tall viewport, which the editor's playtest would have hit on its second start.
- **Session timeline:** the worker was down again from about 12:31 to 18:09 GMT+7, past the 14:59 hard stop. After E's "Try again", the finish work in progress was completed (playtest leak gate, render bench, the D157 fix, docs). E then asked to keep going, and chunk 8 was built.
- **Chunk 8 scope notes:** no map creation or resizing, no project import/export buttons (storage has the functions), overrides are edited as JSON until chunk 9's generated forms (D171, D175). The editor's bundle is one 900 KB chunk (Vite warns; no code splitting yet).
- Sprites much wider than their collider can be clipped at the feet by the next row's hex tops (see the spike README).
- The player page bakes its art at startup, which takes a second or two in software-rendered headless Chromium; until then it draws the engine's placeholder shapes.

## Next step

**Resume at chunk 9, the database editors (spec §8.6).** Chunk 8's shell is in place: the left panel already lists every database with its count (`packages/editor/src/ui/App.tsx`, section "Databases"), and the inspector's JSON overrides box is the stopgap to replace.

What chunk 9 needs, in a workable order:

1. **Generated forms from the schema's unions** (`packages/schema/src/project.ts`; `listLeafFields` in `walk.ts` already walks every leaf). One form per condition, action, behavior and payload variant, and the test: enumerate every union variant and fail if one has no form (§8.10 "Every variant authorable").
2. **The list-and-form pattern** for every database: list on the left, form on the right, edits staged until Save, discarded by Cancel, validated inline with the schema and `checkProject` (§8.6). Database edits use Save and Cancel, not the undo stack (§8.7): on Save, replace the database array and call `doc.changed()` so the canvas, preview and autosave follow.
3. **Extras per §8.6:** terrains' passability matrix and frame pickers; archetype components as add/remove sections (then retire the JSON overrides box); attack hitbox preview (reuse `hitboxOutline` from `@loreengine/render`) and the windup/active/recovery bar; brain states and transitions; effect, feedback and particle previews on a sample entity; animation set clip mapping; the factions N × N grid; plain forms for variables, input actions and settings.
4. **Asset panel:** import an SVG folder or zip, raster images and audio (store blobs with `Storage.putBlob`), bake with `bakeProjectArt` and write the `AtlasDef`s back into the project, then `session.bakeArt()` so the canvas and playtests pick it up.
5. **Trigger editor:** per map, a list of triggers, each a `when` / `given` / `then` built from the same generated forms.

The editor runs with `npm run dev -w @loreengine/editor`. `tools/browser-checks.mjs` drives its UI by button text; keep it green when the toolbar changes.
