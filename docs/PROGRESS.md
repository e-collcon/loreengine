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
| 4. Chunk 6 signature and behavior tests | Pass: ★ i-frames, telegraph timing, one hit per activation, no hits through cliffs, friendly fire, exact hitstop, every stacking mode and restriction reader, the 32 cap, the boss's 50% trigger, the five scripted-jump tests |
| 5. Earlier chunks' tests | Pass; logged edits D76, D116, D141 |
| 6. Replay determinism | Pass: 10,000 ticks, three runs, checkpoints every 1,000 ticks; save-resume at 5,000; plus a mid-chase save-resume |
| 7. Leak gates, budget benches | Map leak gate passes. Zero-allocation gate passes. Tick bench measured (below). |

Totals: 428 tests in 22 files.

## Bench numbers (measured)

Measured in this session's cloud container (Node 22, Vitest worker), not on E's machine. Re-run with:

```bash
npx vitest run packages/runtime/test/budget.test.ts --disableConsoleIntercept
```

| Budget (spec 9.1) | Target | Measured | Notes |
|---|---|---|---|
| Simulation tick, large bench | ≤ 4 ms | **mean 0.30 ms, p50 0.28 ms, p99 0.63 ms, max 1.3 ms** | 301 entities on a 64 × 64 map with cliffs and ramps; 60 hunters with a target, 44 of them in their fight state swinging, 123 walking paths. |
| Allocation in hot paths | 0 bytes per tick | **28,072 bytes of heap growth over 10,000 ticks** (gate: < 65,536) | 300 bodies moving, colliding, separating and swinging (1,129 hits landed); 1.32 million `castSegment` / `canSee` calls. A control run that retains one small object per tick fails the gate, as it should. |
| Render frame | ≤ 8 ms, 128 × 128 map | not measured | The browser bench is not written. |

## Needs E

See `docs/DECISIONS_LOG.md`, section **Needs E** (N1–N7). **N6 is the one to read first:** the spec's wide-ramp clause and its continuity promise cannot both hold on a hex grid, and I chose continuity.

## Known issues

- **The session lost about 4.5 hours to a usage-limit pause** during chunk 6 (roughly 02:15 to 06:42 GMT+7). The chunk's elapsed time above counts working time only.
- Git pushes were refused (HTTP 403) for the first ~12 minutes of the session, until GitHub access was granted. Branch pushes work since; **tag pushes are still refused**, so `chunk-N-green` tags are local to the session and each green commit is listed by SHA in the table above (N5).
- **The spike review gate is open.** `docs/spike/README.md` lists the scenes and what the spike found.
- The browser render bench (8 ms on a 128 × 128 map, §9.1) is not written yet.
- Sprites much wider than their collider can be clipped at the feet by the next row's hex tops (see the spike README).
- The renderer does not yet show combat: no telegraph, flash, particles, or health bars. The player page plays the whole fight (attack with J or a click on an enemy, dodge with Space), but you only see figures move and vanish. That is chunk 7.

## Next step

Chunk 7, the rest of Phase 3B (spec §6.6–6.10): the SVG bake to atlases, atlas textures on the terrain and sprites with the tier pick, animation playback from the animator's clip and frame, the feedback system (flash, shake, particles, ground indicator), the occlusion silhouette, the audio mixer, the HUD, and the playtest leak gate's renderer half.
