# LoreEngine — Build Progress

Session of 17 Nov 2026 (GMT+7), started 00:47. Hard stop 14:59; no new chunk after 13:30.

| Chunk | Status | Tag | Elapsed | Notes |
|---|---|---|---|---|
| 1 Schema | **Green** | `chunk-1-green` (287d965) | 0h22 | Workspace, 10 packages, schema source, validators, reader manifest (310 fields), ported hex math / A\* / spatial hash with new suites, Emberfall |
| 2 Runtime core | **Green** | `chunk-2-green` (b312aef) | 0h18 | Tick scheduler, events and cascade cap, evaluator, executor, variables, RNG, input frames, save boundary and exact resume, storage package |
| 3 World (3A) | **Green** | `chunk-3-green` (8a83937) | 0h10 | Elevation queries, link table, connection-table and continuity tests, lint, map lifecycle, cross-map teleport, spawn / despawn / teleport, leak gate. **See N6: wide ramps.** |
| 4 Render spike (3B) | **Green** | `chunk-4-green` (3e47d7f) | 0h13 | Projection, strip geometry with cliff faces, draw-list depth order, height-aware picking, PixiJS renderer, player client and input mapper, seven screenshots in `docs/spike/`. **E review gate pending.** |
| 5 Movement, sight, click orders (4A) | **Green** | `chunk-5-green` (cf8c476) | 0h21 | Movement, collision, separation, pathing with budgets, `castSegment`, high ground, acquisition, brains, region events, interact, click orders, zero-alloc gate, first tick bench |
| 6 Combat (4B) | **Green** | `chunk-6-green` (62d807c) | 0h30 (see note) | Attacks and telegraphs, contact, knockback, hitstop, dodge with i-frames as an effect, active effects, health and death, terrain contact, scripted jumps, animator. Emberfall's boss fight plays headless. |
| 7 Presentation | **Green** | `chunk-7-green` (08dacb7) | 0h40 (see note) | SVG bake, atlas textures on terrain and sprites, animation playback, feedback (flash, shake, particles, telegraph), occlusion silhouette, audio mixer, HUD. Three items are simplified: see Known issues. |
| 8 Editor shell | Not started | — | — | |
| 9 Database editors | Not started | — | — | |

## Gate results (latest)

Run with `npm run gates` (typecheck, build, nondeterminism lint, tests).

| Gate (spec 9.6) | Result |
|---|---|
| 1. `tsc --noEmit`, strict, every package | Pass: 10 packages, sources and tests |
| 2. Production builds of `editor` and `player` | Pass (`player` is the real client; `editor` is still a placeholder page) |
| 3. Package boundary test | Pass |
| 4. Chunk 7 signature and behavior tests | Pass: the bake (every named frame with its authored anchor), the mixer (suspended until a gesture, skips undecoded sounds, never over 24 voices), read-only renderer, feedback and particles |
| 5. Earlier chunks' tests | Pass; logged edits D76, D116, D141, D155 |
| 6. Replay determinism | Pass: 10,000 ticks, three runs, checkpoints every 1,000 ticks; save-resume at 5,000; plus a mid-chase save-resume |
| 7. Leak gates, budget benches | Map leak gate passes. Zero-allocation gate passes. Tick and render benches measured (below). **Playtest leak gate (`npm run check:browser`, written after chunk 7): FAILS on heap.** After each of 50 start/stop cycles of the player's client, textures, audio nodes and canvases are back to 0, but the heap after GC grows 7.3% between cycle 10 and cycle 50 (limit 5%): about 12 KB per start stays inside PixiJS's own caches (Needs E **N9**). |

Totals: 460 tests in 25 files, plus the browser checks. **`npm run gates` now ends at `check:browser` and exits non-zero** because of the playtest heap gate (N9); every step before it passes.

## Bench numbers (measured)

Measured in this session's cloud container, not on E's machine. Re-run the tick bench and the browser checks with:

```bash
npm run bench
```

```bash
npm run build -w @loreengine/player && npm run check:browser
```

| Budget (spec 9.1) | Target | Measured | Notes |
|---|---|---|---|
| Simulation tick, large bench | ≤ 4 ms | **mean 0.30 ms, p50 0.28 ms, p99 0.63 ms, max 1.3 ms** | 301 entities on a 64 × 64 map with cliffs and ramps; 60 hunters with a target, 44 of them in their fight state swinging, 123 walking paths. |
| Allocation in hot paths | 0 bytes per tick | **28,072 bytes of heap growth over 10,000 ticks** (gate: < 65,536) | 300 bodies moving, colliding, separating and swinging (1,129 hits landed); 1.32 million `castSegment` / `canSee` calls. A control run that retains one small object per tick fails the gate, as it should. |
| Render frame | ≤ 8 ms, 128 × 128 map | **zoom 1 (21 rows on screen): mean 0.5 ms to build and submit a frame, 1.1–1.4 ms including rasterization. Zoom 0.5 (39 rows): mean 2.3–2.8 ms to build and submit, 2.1–2.3 ms including rasterization.** p99 8–27 ms across runs | Production build, 1,280 × 800 viewport, baked atlas art, camera panning, two runs. Rasterization here is SwiftShader on the CPU, and the page's clock is coarse (0.1 ms), so the means come from whole-run time. The p99 spikes are garbage collection and the container's shared CPU. **Not E's machine with a GPU:** run it there before calling the budget met (D158). |

## Needs E

See `docs/DECISIONS_LOG.md`, section **Needs E** (N1–N9). **N6 is the one to read first:** the spec's wide-ramp clause and its continuity promise cannot both hold on a hex grid, and I chose continuity.

## Known issues

- **The session lost about 9.5 hours to two usage-limit pauses** (roughly 02:15 to 06:42 and 07:10 to 12:15 GMT+7). Elapsed times in the table count working time only. Chunks 8 and 9 were not started: after the second pause there was not enough time to finish the editor shell green before 13:30.
- Git pushes were refused (HTTP 403) for the first ~12 minutes of the session, until GitHub access was granted. Branch pushes work since; **tag pushes are still refused**, so `chunk-N-green` tags are local to the session and each green commit is listed by SHA in the table above (N5).
- **The spike review gate is open.** `docs/spike/README.md` lists the scenes and what the spike found. The screenshots now show the baked placeholder art.
- **Chunk 7 simplifications** (each logged): the occlusion silhouette is not masked to the covered part (D151); flashing-as-outline is stored but drawn as a tint (D152); a telegraph also tints units standing in front rows of its area (D150).
- **The playtest heap gate fails (N9):** about 12 KB per playtest start stays inside PixiJS (a module-level bind-group cache keyed by texture ids, and generated shader code). The gate was not loosened; E decides between the options in N9.
- **Fixed after chunk 7, found by the leak gate (D157):** a second client started on the same host saw a 150 px tall viewport, which the editor's playtest would have hit on its second start.
- **Session timeline:** the worker was down again from about 12:31 to 18:09 GMT+7, past the 14:59 hard stop. After E's "Try again", only the finish work already in progress was completed (playtest leak gate, render bench, the D157 fix, docs). No new chunk was started.
- Sprites much wider than their collider can be clipped at the feet by the next row's hex tops (see the spike README).
- The player page bakes its art at startup, which takes a second or two in software-rendered headless Chromium; until then it draws the engine's placeholder shapes.

## Next step

**Resume at chunk 8, the editor shell (spec §8.3–8.5, 8.7, 8.8).** Nothing of it exists: `packages/editor` is a placeholder page that builds.

What chunk 8 needs, in a workable order:

1. `EditorState` and the project document, with a command stack (200 commands, §8.7) and the ★ undo-integrity test: 500 random canvas commands, undo all, layers byte-identical; redo all reproduces the end state.
2. The map canvas on `PixiRenderer`: call `invalidateTerrain()` after each edit. Tools from §8.5: paint terrain, raise, lower, ramp, place, regions. `lintMap` (from `@loreengine/runtime/view`) feeds the warnings panel; Emberfall's broken ramp is the lint test's fixture.
3. Playtest: embed `startClient` from `@loreengine/player` with a deep copy or the same project object, a `playtest` save kept in memory, pause and step through stepped mode, repro capture from `runtime.recording()`. ★ Playtest isolation: after 5,000 ticks with kills and variable changes the project document is byte-identical (`serializeProject`) and `contentRevision` is unchanged. Chunk 2's test `the project is untouched by play` already proves the runtime half.
4. The playtest leak gate already exists as a browser check (`tools/browser-checks.mjs` driving `packages/player/bench.html`). Point it at the editor's real playtest, or add an editor page it can drive, and settle N9 first: with option (a) the editor owns the baked atlas textures and playtests reuse them.
5. Persistence through `@loreengine/storage` (`putProject`, autosave), and debug overlays (sight rays through `view.castSegment`, paths through `view.entities.path`).

Then chunk 9: generated forms from `listLeafFields` / the Zod source for every database, the asset panel (where `bakeAtlas` writes an `AtlasDef` back into the project), and the trigger editor.

The Lovable design system (`src/index.css`, `tailwind.config.js`, shared UI atoms) was not in the repository; chunk 8 should use plain styling unless E adds it (kickoff §4).
