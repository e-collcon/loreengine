# LoreEngine — Build Progress

Session of 17 Nov 2026 (GMT+7), started 00:47. Hard stop 14:59; no new chunk after 13:30. **Extended by E after the hard stop** ("I intend to use all of them"): chunks 8 and 9 were built that evening (chunk 8's first commit 21:12, green 22:17; chunk 9 green 22:48).

| Chunk | Status | Tag | Elapsed | Notes |
|---|---|---|---|---|
| 1 Schema | **Green** | `chunk-1-green` (287d965) | 0h22 | Workspace, 10 packages, schema source, validators, reader manifest (310 fields), ported hex math / A\* / spatial hash with new suites, Emberfall |
| 2 Runtime core | **Green** | `chunk-2-green` (b312aef) | 0h18 | Tick scheduler, events and cascade cap, evaluator, executor, variables, RNG, input frames, save boundary and exact resume, storage package |
| 3 World (3A) | **Green** | `chunk-3-green` (8a83937) | 0h10 | Elevation queries, link table, connection-table and continuity tests, lint, map lifecycle, cross-map teleport, spawn / despawn / teleport, leak gate. **See N6: wide ramps.** |
| 4 Render spike (3B) | **Green** | `chunk-4-green` (3e47d7f) | 0h13 | Projection, strip geometry with cliff faces, draw-list depth order, height-aware picking, PixiJS renderer, player client and input mapper, seven screenshots in `docs/spike/`. **E review gate pending.** |
| 5 Movement, sight, click orders (4A) | **Green** | `chunk-5-green` (cf8c476) | 0h21 | Movement, collision, separation, pathing with budgets, `castSegment`, high ground, acquisition, brains, region events, interact, click orders, zero-alloc gate, first tick bench |
| 6 Combat (4B) | **Green** | `chunk-6-green` (62d807c) | 0h30 (see note) | Attacks and telegraphs, contact, knockback, hitstop, dodge with i-frames as an effect, active effects, health and death, terrain contact, scripted jumps, animator. Emberfall's boss fight plays headless. |
| 7 Presentation | **Green** | `chunk-7-green` (08dacb7) | 0h40 (see note) | SVG bake, atlas textures on terrain and sprites, animation playback, feedback (flash, shake, particles, telegraph), occlusion silhouette, audio mixer, HUD. Three items are simplified: see Known issues. |
| 8 Editor shell (5A) | **Green** | `chunk-8-green` (ad23289) | about 2h (green 22:17) | Editor document and 200-command undo, map preview over the headless `World`, terrain / raise / lower / flatten / ramp / region / place / select tools, overlays (levels, blocked edges, lint with click-to-focus, regions, sight), inspector, autosave to IndexedDB, playtest overlay with debug overlays, pause and step, repro files. Four screenshots in `docs/editor/`. |
| 9 Database editors (5B) | **Green** | `chunk-9-green` (06d3e4a) | 0h31 | Forms generated from the schema for every database, settings and trigger part (★ every variant authorable), staged Save / Cancel with inline and project validation, terrain passability matrix, faction grid, attack hitbox preview and timeline, animation preview, previews on the player for effects, feedback and particles, trigger editor, asset panel (import files, folders, zips; bake written back), component-section overrides in the inspector. Six more screenshots in `docs/editor/`. |
| Elevation rework (N6) | **Green** | — (90594b4) | 20 Nov 2026 | E's N6 ruling: heights follow Catlike Coding's Hex Map. Flat inner hexes; one level apart is a walkable terraced slope, two or more a cliff; ramps removed (schema 3, schema-2 files migrate on load); fixtures re-authored (Emberfall's step and ledge); renderer draws bridges, corners and cliff faces from the runtime's surface; Ramp tool removed from the editor. D194–D199. |
| LoreEngine UI (v0.2, W2) | **Green** | — (branch `claude/loreengine-ui`) | 21 Nov 2026 | The editor restyled with the LoreEngine Design System v2: glass panes over a full-window canvas, Plus Jakarta Sans and Departure Mono, the Tosca-to-purple action gradient, a matching HUD skin. Markup and class names unchanged; no test edits. D201–D204. |
| Civ-style terrain (v0.2, W8) | **Specified** | — (branch `claude/civ-terrain-spec`) | 24 Nov 2026 | E's call: terrain looks like Civilization V and VI. Spec v6 section 6.6a (world-tiled ground textures blended across borders, cliff textures, decoration, grid overlay; schema 3.1), `ART_CONTRACT.md` for Lexie, checked against the code the same evening, D205–D207. Not built yet: E implements the patch, about two chunks. |

## Gate results (latest)

Run with `npm run gates` (typecheck, builds, nondeterminism lint, tests, browser checks).

| Gate (spec 9.6) | Result |
|---|---|
| 1. `tsc --noEmit`, strict, every package | Pass: 10 packages, sources and tests |
| 2. Production builds of `editor` and `player` | Pass: both are real apps now |
| 3. Package boundary test | Pass (`editor` imports only `runtime`'s public entries, `@loreengine/runtime` and `/view`) |
| 4. Chunk 9 signature and behavior tests | Pass: ★ every variant authorable (every union variant reachable from the project schema has a form, and its starting value parses), every id field names its database, staged Save and Cancel (valid edit saves; invalid field, still-referenced delete, region event on a global trigger and a too-small max level are refused, the project untouched), assets (import, re-import by name, zip, removal refused while used, atlas assignment, bake write-back), and a database smoke test in the browser checks. Chunk 8's: ★ undo integrity (200 commands undone to a byte-identical project; 500 commands undone to exactly 200 back, D168), ★ playtest isolation (5,000 ticks with kills and variable changes: document byte-identical, revision unchanged, nothing autosaved), lint finds the broken ramp with a place to focus, preview, overlays, strokes, autosave timing, repro round trips with pause and step |
| 5. Earlier chunks' tests | Pass. The elevation rework (N6) changed the world, movement, path, brain, lifecycle, schema, fixture and render tests that were about ramps; every edit is listed in D199. Unchanged in chunks 8 and 9 (D178); the boundary test's allowed-imports table for `editor` gained `zod` and `fflate` (D179); earlier logged edits D76, D116, D141, D155 |
| 6. Replay determinism | Pass: 10,000 ticks, three runs, checkpoints every 1,000 ticks; save-resume at 5,000; mid-chase save-resume; and now through repro files |
| 7. Leak gates, budget benches | Pass. Map leak gate and zero-allocation gate pass. **Playtest leak gate passes:** 50 Play/Stop cycles in the editor, textures, audio nodes and canvases back to baseline after every Stop, heap +2.2% to +4.8% between cycle 10 and 50 over the last runs (limit 5%; D161, D162, D163; the margin is discussed under Known issues). Tick and render benches measured (below). |

Totals: 486 tests in 31 files, plus the browser checks (489 before the elevation rework: the ramp-only tests went, slope and terrace tests came in; D199). `npm run gates` exits 0.

## Bench numbers (measured)

Measured in this session's cloud container, not on E's machine. Re-run the tick bench, the browser checks, and the render bench on a GPU (D191) with:

```bash
npm run bench
```

```bash
npm run build && npm run check:browser
```

```bash
npm run bench:render
```

| Budget (spec 9.1) | Target | Measured | Notes |
|---|---|---|---|
| Simulation tick, large bench | ≤ 4 ms | **mean 0.51–0.56 ms, p50 0.48–0.50 ms, p99 0.86–1.2 ms, max 1.4–11 ms** (three runs after the elevation rework; before it, mean 0.30 ms) | 301 entities on a 64 × 64 map with cliffs and slopes; 60 hunters with a target, 36 of them in their fight state, 129 walking paths. The mean rose with the elevation rework; the likely cause is the new height query (a corner blends three cells), not profiled. Still about an eighth of the budget. |
| Allocation in hot paths | 0 bytes per tick | **24,432 bytes of heap growth over 10,000 ticks** (gate: < 65,536) | 300 bodies moving, colliding, separating and swinging (1,077 hits landed); 1.32 million `castSegment` / `canSee` calls. A control run that retains one small object per tick fails the gate, as it should. |
| Render frame | ≤ 8 ms, 128 × 128 map | **On E's machine (Apple M1 Pro, ANGLE on Metal, visible Chromium, 20 Nov 2026): zoom 1 (14 rows): mean 0.41 ms to build and submit, 0.53 ms including rasterization; zoom 0.5 (24 rows): mean 0.86 ms and 0.27 ms. p99 including rasterization 0.9 ms and 1.9 ms. Met.** | The build-and-submit pass, the first after each zoom change, has p99 8.5–8.7 ms (6 of 600 frames over 8 ms) while the pass with rasterization right after it has p99 0.9–1.9 ms, so the slow frames are most likely the first ones at a new zoom (textures going to the GPU, shaders warming up), not steady state; not separated yet. Single-frame maxima of 33–65 ms in the rasterization pass are one-off stalls. In this container (SwiftShader, after the elevation rework): mean 0.1–0.8 ms in every pass. Production build, 1,280 × 800 viewport, baked atlas art, camera panning (D158, D191, D200). |

## Needs E

All ten are answered (E, 20 Nov 2026; each ruling is recorded under its entry in `Context/DECISIONS_LOG.md`). N1, N2, N4, N7: accepted. N3: the squash stays unauthored (it is the camera pitch now). N5: E pushes the tags (commands in chat). N8: keep for now. N9: approved. N10: the 55° camera is confirmed. **N6: the height model changed** to Catlike Coding's Hex Map (pure rule, terraced slopes), built the same day: D193–D199 and the "Elevation rework" row above.

## Known issues

- **The session lost about 9.5 hours to two usage-limit pauses** (roughly 02:15 to 06:42 and 07:10 to 12:15 GMT+7). Elapsed times in the table count working time only. Chunk 8 was built after the hard stop, at E's request.
- Git pushes were refused (HTTP 403) for the first ~12 minutes of the session, until GitHub access was granted. Branch pushes work since; tag pushes were refused all session, so E pushed the `chunk-N-green` tags from E's clone on 20 Nov (N5).
- **The spike review gate:** E asked for a higher camera angle (Civ VI / Beyond Earth); the camera is pitched 55°, and E confirmed the angle (N10). After N6 the terrain is terraced slopes and cliffs; the spike and editor screenshots show the new terrain, ready for E's look. `docs/spike/camera-pitch-*.png` predate it and still show ramps. `docs/spike/README.md` lists the scenes, what the spike found, and the angle comparison.
- **Chunk 7 simplifications** (each logged): the occlusion silhouette is not masked to the covered part (D151); flashing-as-outline is stored but drawn as a tint (D152); a telegraph also tints units standing in front rows of its area (D150).
- **The standalone player page still grows about 15 KB of heap per start/stop** (PixiJS keeps a little per renderer and per new texture; N9). It is reported by `check:browser`, not gated: the spec's gate is the editor's playtest, which passes. A shipped game starts its client once.
- **Fixed in chunk 8, found by the leak gate (D163):** destroyed terrain strips and sprites kept their GPU buffers and graphics contexts. Short-lived renderers hid it; the editor's canvas would have grown with every edit.
- **Fixed after chunk 7, found by the leak gate (D157):** a second client started on the same host saw a 150 px tall viewport, which the editor's playtest would have hit on its second start.
- **Session timeline:** the worker was down again from about 12:31 to 18:09 GMT+7, past the 14:59 hard stop. After E's "Try again", the finish work in progress was completed (playtest leak gate, render bench, the D157 fix, docs). E then asked to keep going, and chunk 8 was built.
- **The playtest heap gate's margin is thin** (+4.6% and +4.8% in the two chunk 9 runs, against 5%; chunk 8's runs were +2.2% to +2.8%). Over 100 Play/Stop cycles the heap after GC climbs about 6 KB per cycle. Heap-snapshot diffs over 20 cycles find none of our objects, closures or listeners retained: what grows is V8's own bookkeeping (inline-cache handlers, feedback vectors, allocation sites, about 1.5 KB per cycle) and the browser's performance-timeline entries (bounded buffers). The larger editor bundle of chunk 9 gives V8 more of that to keep. If the gate starts failing, re-run the snapshot diff (the method is in D160 and D161) before suspecting a leak, and consider measuring retained objects by snapshot instead of total heap: that would be a change to the gate, for E to approve.
- **Chunk 8 scope notes:** no map creation or resizing, no project import/export buttons (storage has the functions), placement overrides were JSON in chunk 8 and are generated component sections since chunk 9 (D188). The editor's bundle is one 900 KB chunk (Vite warns; no code splitting yet).
- Sprites much wider than their collider can be clipped at the feet by the next row's hex tops (see the spike README).
- The player page bakes its art at startup, which takes a second or two in software-rendered headless Chromium; until then it draws the engine's placeholder shapes.

## Next step

**v0.2 is planned in `V0.2_PLAN.md`** (21 Nov 2026): QA fixes, the LoreEngine UI (first part done, D201–D204), the editor gaps a whole game needs, Civ-style terrain (W8, D205, added 24 Nov), an art contract for Lexie's demo-game art (`ART_CONTRACT.md`), CI and the release. What follows below is the v0.1 build's own closing note.

**All nine chunks of the kickoff are built and green.** Phase 6 and later are out of scope for this build (kickoff), so the next steps are E's:

1. **The review gates.** *Render spike:* the 55° camera is confirmed (N10). **New for E: the terraced terrain (N6, D194–D197)** in `docs/spike/` (01–08) and live with `npm run dev -w @loreengine/player` and `?fixture=elevation`. *Editor review:* still open (`docs/editor/README.md`, screenshots retaken with the new terrain; there is no Ramp tool now: one Raise makes a slope, two make a cliff).
2. **One small open choice from N6:** Catlike charges a slope twice a flat edge, so paths prefer flat ground; ours do not yet (A\* costs cells, D199). Say if slopes should slow paths.
3. **The budgets on E's machine.** Render bench: done on E's M1 Pro, met (Bench numbers, D200). The tick bench (`npm run bench`) has only been run in this container.
4. **Tags.** Done: E pushed `chunk-1-green` to `chunk-9-green` (20 Nov 2026), and all nine are on the remote at the SHAs in the table above (N5).

If work continues before Phase 6, the smallest useful items are in Known issues: the unmasked occlusion silhouette (D151), outline flashing (D152), map creation and resizing in the editor (D175), and code splitting for the editor bundle.
