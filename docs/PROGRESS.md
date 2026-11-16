# LoreEngine — Build Progress

Session of 17 Nov 2026 (GMT+7), started 00:47. Hard stop 14:59; no new chunk after 13:30.

| Chunk | Status | Tag | Elapsed | Notes |
|---|---|---|---|---|
| 1 Schema | **Green** | `chunk-1-green` (287d965) | 0h22 | Workspace, 10 packages, schema source, validators, reader manifest (310 fields), ported hex math / A\* / spatial hash with new suites, Emberfall |
| 2 Runtime core | **Green** | `chunk-2-green` (b312aef) | 0h18 | Tick scheduler, events and cascade cap, evaluator, executor, variables, RNG, input frames, save boundary and exact resume, storage package |
| 3 World (3A) | Not started | — | — | |
| 4 Render spike (3B) | Not started | — | — | |
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
| 2. Production builds of `editor` and `player` | Pass (placeholder apps) |
| 3. Package boundary test | Pass |
| 4. Chunk 2 signature and behavior tests | Pass |
| 5. Earlier chunks' tests | Pass, unchanged (one validation test added) |
| 6. Replay determinism | Pass: 10,000 ticks, three runs, checkpoints every 1,000 ticks; save-resume at 5,000 |
| 7. Leak gates, budget benches | From chunks 3 and 5 |

Totals: 203 tests in 12 files.

## Bench numbers (measured)

None yet. The first bench run comes with chunk 5.

## Needs E

See `docs/DECISIONS_LOG.md`, section **Needs E** (N1–N5).

## Known issues

- Git pushes were refused (HTTP 403) for the first ~12 minutes of the session, until GitHub access was granted. Branch pushes work since; **tag pushes are still refused**, so `chunk-N-green` tags are local to the session and each green commit is listed by SHA in the table above (N5).

## Next step

Chunk 3, World (spec §6.3–6.5): `cellAt`, `surfaceHeight`, `edgeHeight`, `connects` with the connection table, map lint, map lifecycle (unload, cross-map teleport, persistent entities), the `spawn` / `despawn` / `teleport` actions, and the map leak gate.
