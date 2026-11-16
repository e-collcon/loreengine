# LoreEngine — Build Progress

Session of 17 Nov 2026 (GMT+7), started 00:47. Hard stop 14:59; no new chunk after 13:30.

| Chunk | Status | Tag | Elapsed | Notes |
|---|---|---|---|---|
| 1 Schema | **Green** | `chunk-1-green` (287d965) | 0h22 | Workspace, 10 packages, schema source, validators, reader manifest (310 fields), ported hex math / A\* / spatial hash with new suites, Emberfall |
| 2 Runtime core | **Green** | `chunk-2-green` (b312aef) | 0h18 | Tick scheduler, events and cascade cap, evaluator, executor, variables, RNG, input frames, save boundary and exact resume, storage package |
| 3 World (3A) | **Green** | `chunk-3-green` (8a83937) | 0h10 | Elevation queries, link table, connection-table and continuity tests, lint, map lifecycle, cross-map teleport, spawn / despawn / teleport, leak gate. **See N6: wide ramps.** |
| 4 Render spike (3B) | **Green** | `chunk-4-green` (3e47d7f) | 0h13 | Projection, strip geometry with cliff faces, draw-list depth order, height-aware picking, PixiJS renderer, player client and input mapper, seven screenshots in `docs/spike/`. **E review gate pending.** |
| 5 Movement, sight, click orders (4A) | **Green** | `chunk-5-green` (cf8c476) | 0h21 | Movement, collision, separation, pathing with budgets, `castSegment`, high ground, acquisition, brains, region events, interact, click orders, zero-alloc gate, first tick bench |
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
| 4. Chunk 5 signature and behavior tests | Pass: ★ ramps route, ★ cliffs hold (10,000 knockbacks, 0 crossings), ★ high ground, leash, click-order rows |
| 5. Earlier chunks' tests | Pass; two logged edits (D76, D116) |
| 6. Replay determinism | Pass: 10,000 ticks, three runs, checkpoints every 1,000 ticks; save-resume at 5,000; plus a mid-chase save-resume |
| 7. Leak gates, budget benches | Map leak gate passes. Zero-allocation gate passes. Tick bench measured (below). |

Totals: 367 tests in 20 files.

## Bench numbers (measured)

Measured in this session's cloud container (Node 22, Vitest worker), not on E's machine. Re-run with:

```bash
npx vitest run packages/runtime/test/budget.test.ts --disableConsoleIntercept
```

| Budget (spec 9.1) | Target | Measured | Notes |
|---|---|---|---|
| Simulation tick, large bench | ≤ 4 ms | **mean 0.32 ms, p50 0.30 ms, p99 0.72 ms, max 1.6 ms** | 301 entities on a 64 × 64 map with cliffs and ramps; 60 hunters with a target, 179 walking paths. Combat is not in this number yet (chunk 6). |
| Allocation in hot paths | 0 bytes per tick | **8,448 bytes of heap growth over 10,000 ticks** (gate: < 65,536) | 300 bodies moving, colliding, separating; 1.32 million `castSegment` / `canSee` calls. A control run that retains one small object per tick fails the gate, as it should. |
| Render frame | ≤ 8 ms, 128 × 128 map | not measured | The browser bench is not written. |

## Needs E

See `docs/DECISIONS_LOG.md`, section **Needs E** (N1–N7). **N6 is the one to read first:** the spec's wide-ramp clause and its continuity promise cannot both hold on a hex grid, and I chose continuity.

## Known issues

- Git pushes were refused (HTTP 403) for the first ~12 minutes of the session, until GitHub access was granted. Branch pushes work since; **tag pushes are still refused**, so `chunk-N-green` tags are local to the session and each green commit is listed by SHA in the table above (N5).
- **The spike review gate is open.** `docs/spike/README.md` lists the scenes and what the spike found. Work continues on chunk 5, which is headless and does not depend on the renderer (kickoff §3.4).
- The browser render bench (8 ms on a 128 × 128 map, §9.1) is not written yet.
- Sprites much wider than their collider can be clipped at the feet by the next row's hex tops (see the spike README).

## Next step

Chunk 6, Combat (spec §7.8–7.10, 7.9c, 7.12): the attack state machine and telegraphs, contact with the six hit rules, knockback and hitstop, dodge with i-frames as an effect, `ActiveEffects` with the four stacking modes and the 32 cap, health, death and `onDeath`, `health-crossed`, terrain contact, scripted jumps, the animator, and the remaining entity actions (`modify-health`, `apply-effect`, `remove-effect`, `apply-impulse`, `play-feedback`, `scripted-jump`).
