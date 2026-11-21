# Context — start here

Everything a new session (any Claudia, Lexie, or a fresh agent) needs to get up to speed on LoreEngine. Read in this order; stop when you have enough.

## 1. Where things stand (read first)

| File | What it tells you |
|---|---|
| `PROGRESS.md` | Status of every chunk, gate results, bench numbers, known issues, and the next steps. The single best snapshot. |
| `DECISIONS_LOG.md` | Every implementation decision (D1–D200) with its reason, plus **Needs E** (N1–N10) and E's rulings on each. Check here before changing anything that looks odd: it is usually deliberate. |
| `QA_CHECKLIST.md` | The 75 human QA checks for v0.1. The live, tickable version (where E's results are saved) is https://claude.ai/artifact/5myArj1Ln5ycQgjKDVPbgz. |

## 2. What was asked for

| File | What it is |
|---|---|
| `FOUNDATION_DESIGN.md` | **The spec** for Phases 1–5 (v0.1): data model, runtime, world and elevation, simulation, editor, budgets, build order. Where code and spec differ, `DECISIONS_LOG.md` says why (notably N6: the terrain now follows Catlike Coding's Hex Map, D193–D199). |
| `FABLE_KICKOFF.md` | The build brief the foundation was built under: rules of engagement, chunk order, what counts as green. |

## 3. What comes next

| File | What it is |
|---|---|
| `PHASE6_DESIGN.md` … `PHASE15_DESIGN.md` | Later phases (stats, items, loadouts, enemies, abilities, saves and title screen, and on). Context only until a phase is started; each has a §R Reconciliation section that supersedes older text. |

## 4. History (why things are the way they are)

| File | What it is |
|---|---|
| `ROADMAP_v0.md`, `ARCHITECTURE.md`, `FEATURES.md`, `PHASE5.5_DESIGN.md` | Earlier plans and architecture notes. Superseded where the spec or a §R section says so; kept for rationale. |

## Not in this folder

- `../README.md`: set-up and run commands (install, dev servers, gates, benches).
- `../docs/spike/README.md` and `../docs/editor/README.md`: guides to the review screenshots; they stay beside their images.

## Conventions for whoever writes here next

- Keep `PROGRESS.md` current after each piece of work; log every non-obvious choice in `DECISIONS_LOG.md` with the next D-number; questions only E can answer go under **Needs E**.
- `packages/schema/src/project.ts` is a hot file: no change without E's approval.
- Never weaken, skip or delete a test to get green; log every test edit.
