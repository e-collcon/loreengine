# LoreEngine — Build Progress

Session of 17 Nov 2026 (GMT+7), started 00:47. Hard stop 14:59; no new chunk after 13:30.

| Chunk | Status | Tag | Elapsed | Notes |
|---|---|---|---|---|
| 1 Schema | **Green** | `chunk-1-green` (287d965) | 0h22 | Workspace, 10 packages, schema source, validators, reader manifest (310 fields), ported hex math / A\* / spatial hash with new suites, Emberfall |
| 2 Runtime core | **Green** | `chunk-2-green` (b312aef) | 0h18 | Tick scheduler, events and cascade cap, evaluator, executor, variables, RNG, input frames, save boundary and exact resume, storage package |
| 3 World (3A) | **Green** | `chunk-3-green` (8a83937) | 0h10 | Elevation queries, link table, connection-table and continuity tests, lint, map lifecycle, cross-map teleport, spawn / despawn / teleport, leak gate. **See N6: wide ramps.** |
| 4 Render spike (3B) | **Green** | `chunk-4-green` (3e47d7f) | 0h13 | Projection, strip geometry with cliff faces, draw-list depth order, height-aware picking, PixiJS renderer, player client and input mapper, seven screenshots in `docs/spike/`. **E review gate pending.** |
| 5 Movement, sight, click orders (4A) | Not started | — | — | |
| 6 Combat (4B) | Not started | — | — | |
| 7 Presentation | Not started | — | — | |
| 8 Editor shell | Not started | — | — | |
| 9 Database editors | Not started | — | — | |

## Gate results (latest)

Run with `npm run gates` (typecheck, build, nondeterminism lint, tests).

| Gate (spec 9.6) | Result |
|---|---|
| 1. `tsc --noEmit`, strict, every package | Pass: 10 packages, sources and tests |
| 2. Production builds of `editor` and `player` | Pass (`player` is the real client; `editor` is still a placeholder) |
| 3. Package boundary test | Pass |
| 4. Chunk 4 signature and behavior tests | Pass: ★ depth order and ★ height-aware picking on the draw list, no GPU needed |
| 5. Earlier chunks' tests | Pass; one key added to the view-surface list (D76) |
| 6. Replay determinism | Pass: 10,000 ticks, three runs, checkpoints every 1,000 ticks; save-resume at 5,000 |
| 7. Leak gates, budget benches | Map leak gate passes: 100 load/unload cycles back to baseline, heap within 5% after GC. Benches from chunk 5. |

Totals: 290 tests in 16 files.

## Bench numbers (measured)

None yet. The first bench run comes with chunk 5.

## Needs E

See `docs/DECISIONS_LOG.md`, section **Needs E** (N1–N6). **N6 is the one to read first:** the spec's wide-ramp clause and its continuity promise cannot both hold on a hex grid, and I chose continuity.

## Known issues

- Git pushes were refused (HTTP 403) for the first ~12 minutes of the session, until GitHub access was granted. Branch pushes work since; **tag pushes are still refused**, so `chunk-N-green` tags are local to the session and each green commit is listed by SHA in the table above (N5).
- **The spike review gate is open.** `docs/spike/README.md` lists the scenes and what the spike found. Work continues on chunk 5, which is headless and does not depend on the renderer (kickoff §3.4).
- The browser render bench (8 ms on a 128 × 128 map, §9.1) is not written yet.
- Sprites much wider than their collider can be clipped at the feet by the next row's hex tops (see the spike README).

## Next step

Chunk 5, Movement, sight, and click orders (spec §7.4–7.7, 7.9b, 7.11): movement and collision against blocked edges, separation, pathfinding with string-pulling and budgets, `castSegment`, the high-ground rule, factions and acquisition, brains (all behaviors except `attack`), region events, interact, click orders, and the first budget bench.
