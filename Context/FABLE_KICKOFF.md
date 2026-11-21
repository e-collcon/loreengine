# LoreEngine — Foundation Build Brief for Fable

You are building the foundation of **LoreEngine**, a browser-based 2D hex-isometric action RPG engine that Elmscorp will use to build its own games. You are working unattended: E (the owner) may be asleep for most of your session. This brief tells you what to build, in what order, how to decide things on your own, and what to leave behind for whoever continues after you.

**Your session ends at 14:59 on 17 Nov 2026, GMT+7 (07:59 UTC).** Plan against that clock.

---

## 1. The specification

| File | Role |
|---|---|
| `Context/FOUNDATION_DESIGN.md` | **The spec you implement.** Phases 1–5 of LoreEngine. Every requirement, type, budget, and test is in it. |
| `Context/PHASE6_DESIGN.md` … `Context/PHASE15_DESIGN.md` | **Context only.** Later phases. Do not implement them. Read their §R sections only to understand which seams the foundation must leave open. |
| `Context/PHASE5.5_DESIGN.md`, `Context/ROADMAP_v0.md`, `Context/ARCHITECTURE.md`, `Context/FEATURES.md` | **History.** They explain why the spec looks the way it does. Never implement from them. |

**Read first:** sections 1–4 (scope, laws, map of the work, Phase 1), then 9 (budgets and gates) and 10 (build order). Read each later section when you reach its chunk.

**If anything conflicts, `FOUNDATION_DESIGN.md` wins.**

## 2. Build order and the cut line

Follow section 10 of the spec. Each chunk ends green and tagged, so stopping anywhere leaves a coherent engine.

| Priority | Chunks | What it gives us |
|---|---|---|
| **Must ship** | 1 Schema · 2 Runtime core · 3 World (3A) · 4 Render spike (3B) | A tested headless engine, cliffs and ramps proven, the riskiest visual question answered |
| **Target** | 5 Movement, sight, click orders (4A) | Units walk the spike map, spot each other, and obey clicks |
| **Stretch** | 6 Combat, including scripted jumps (4B) | Headless combat |
| **If time remains** | 7 Presentation · 8 Editor shell · 9 Database editors | Look, sound, and authoring |

**Clock rules:**

- After each chunk, record its elapsed time in `Context/PROGRESS.md` and use your measured pace to judge the next one.
- Do not start a chunk you cannot finish green before **13:30 GMT+7**.
- From 13:30, only finish, fix, and write the handoff (section 7 below).

## 3. Deciding things without E

1. **The spec wins.** Where it is silent, choose the smallest design consistent with its laws (section 2 of the spec) and record the choice in `Context/DECISIONS_LOG.md`: what, why, and which section it touches.
2. **The schema is a hot file (law L4).** Implement it exactly as specified. If you must deviate, make the smallest change, and log it under a **Needs E** heading with the reason.
3. **Never weaken, skip, or delete a test to get green.** If a signature test cannot pass, log it under **Needs E**, leave the chunk untagged, and move only to work the build order says does not depend on it.
4. **The spike gate (after chunk 4) is asynchronous.** Save screenshots of the four fixture scenes to `docs/spike/`: a unit behind a cliff, a unit on a plateau edge, a unit on a ramp, and a pick on a raised hex. Then continue to chunk 5, which is headless and does not depend on the renderer. E reviews later.
5. **Do not build Phase 6 or later.** No stats, items, skills, dialogue, or quests. Leave the seams the spec describes.
6. **Art is placeholder vector shapes** you generate. Nothing waits on real art.
7. **Do not invent fields.** Every authored field needs a reader-manifest entry (spec section 4.4).

## 4. Inputs from the v0.6.0 codebase

Three modules carry over: hex math, A\*, and the spatial hash. In v0.6.0 they live in `src/tile-engine.ts` (hex math) and `src/entity-system.ts` (A\* and spatial hash).

**What E actually provided:** `legacy/` holds `tile-engine.ts`, `entity-system.ts`, and `core/types.ts` from v0.5.0. v0.5.0 is byte-identical to v0.6.0 in these files, because v0.6.0 changed only styling. **The test suites were not recovered.** So:

- **Port only the pure parts:**
  - From `tile-engine.ts`: `AXIAL_DIRS`, `offsetToAxial`, `axialToOffset`, `cubeRound`, `hexToPixel`, `pixelToHex`, `hexCorners` (about lines 55–140).
  - From `entity-system.ts`: `createAStarPathfinder`, and the spatial hash, which lives inside `EntityManager` (around line 1053 and its "SPATIAL HASH & QUERIES" block). Extract it into a standalone module.
  - Leave the `TileEngine` class, the entity class hierarchy, and every other part behind. The spec replaces them.
- **Keep the logic verbatim and adapt at the edges.** Write thin adapters to the spec's API. Change the algorithm only where the spec requires it, for example the elevation-aware `connects` for A\*, and log each such change.
- **Write the tests yourself,** exhaustively. Cover round-trips over the whole 256 × 256 range, all six neighbors at odd and even rows, `cubeRound` at hex boundaries, `pixelToHex ∘ hexToPixel` identity, and A\* optimality against a brute-force reference on small random maps. Log under **Needs E** that the original suites were not available.
- **If `legacy/` is absent** when you start, implement fresh against the spec and `Context/ARCHITECTURE.md` (pointy-top hexes, odd-r offset storage, cube-coordinate math), with the same tests, and log it.

The Lovable design system (`src/index.css`, `tailwind.config.js`, and the shared UI atoms) is needed only from chunk 8. If it is absent when you get there, use plain styling and log it.

## 5. Repository and tooling

- Repository: `loreengine`, separate from every other Elmscorp repository.
- npm workspaces, TypeScript strict, Vite for `editor` and `player`, Vitest, runtime tests in Node with no browser (spec section 4.3).
- `main` is always green. Commit per task. When a chunk passes every gate in spec section 9.6, tag it `chunk-N-green`.

## 6. Definition of done for each chunk

All of spec section 9.6, in order: strict `tsc --noEmit` on every package; production builds of `editor` and `player` (once they exist); the package boundary test; the chunk's signature and behavior tests; every earlier chunk's tests unchanged; from chunk 2 the replay determinism test; from chunk 3 the leak gates; from chunk 5 the budget benches.

The first budget bench run establishes real numbers. If a time budget in spec section 9.1 is missed, record the measured value and continue; do not tune to hit it.

## 7. What you leave behind

Keep `Context/PROGRESS.md` current after every chunk. It is what the next implementer starts from.

```markdown
# LoreEngine — Build Progress

| Chunk | Status | Tag | Elapsed | Notes |
|---|---|---|---|---|

## Gate results (latest)
## Bench numbers (measured)
## Needs E
## Known issues
## Next step
```

At the end of your session, the last section must say exactly where the next implementer should resume, including any chunk left part-done and what remains of it.

## 8. Start

1. Read the spec sections listed in §1.
2. Create the repository skeleton and the ten packages from spec section 4.3.
3. Begin chunk 1.
