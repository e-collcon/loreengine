# LoreEngine — Decisions Log

Choices made while implementing `FOUNDATION_DESIGN.md` where the spec was silent or needed interpreting. Each entry says what, why, and which section it touches. Newest chunk last.

## Needs E

Items that need E's ruling. Nothing here blocks the build order; each was resolved the smallest way and can be changed.

- **N1 — The v0.6.0 test suites were not recovered.** `legacy/` held the three source files only. The hex math, A\*, and spatial hash suites were written from scratch (kickoff §4): round trips over the whole 256 × 256 range, all six neighbors at odd and even rows, `cubeRound` at hex boundaries, `pixelToHex ∘ hexToPixel` identity, A\* optimality against brute-force Dijkstra on 400 random maps, the spatial hash against a brute-force reference over 20,000 random operations. Spec §4.7 says the ported suites "pass unchanged"; that line cannot be met literally. *(§4.7, kickoff §4)*
- **N2 — "made with a newer LoreBrix" reads "LoreEngine".** Spec §4.6 gives the rejection text as "made with a newer LoreBrix", written before the v4 rename. The validator says "made with a newer LoreEngine". The schema-1 message still names LoreBrix v0.6.0, because that is what made those files. *(§4.6)*
- **N3 — The ISO squash ratio is not an authored field.** v0.6.0 stored `isoRatio` per map. `ProjectSettings` in §4.5 has no such field and the kickoff forbids inventing one, so the squash is an engine constant in `render` (see D-render entries when chunk 4 lands). If games need different camera pitches, this wants a `ProjectSettings` field (a minor schema revision). *(§4.5, §6.6)*

## Chunk 1 — Architecture & Schema

### Tooling

- **D1 — TypeScript 7.0 (native `tsc`), Vite 8, Vitest 5, Zod 4.6, React 19, PixiJS 8.** The current `latest` of each on 17 Nov 2026. TS 7 has no in-process compiler API, so the boundary test spawns `tsc` rather than calling it. *(§4.3)*
- **D2 — No build step for library packages.** Each package's `exports` points at `./src/index.ts`; Vite and Vitest consume TypeScript directly, and `tsc --noEmit` is the type gate. Fewer moving parts, and nothing to go stale. `allowImportingTsExtensions` is on, so imports carry `.ts`. *(§4.3)*
- **D3 — Two tsconfigs per headless package.** `tsconfig.json` covers `src` with `lib: ["ES2022"]` and `types: []` — no DOM, no Node, not even `console`. `tsconfig.test.json` adds Node types for the tests. So L1 is enforced on exactly the code that ships. `schema`, `hexmath`, `algorithms`, and `fixtures` get the same treatment as `runtime`, because the runtime is built from them. *(§4.3, L1)*
- **D4 — `strict: true` without `noUncheckedIndexedAccess`.** "TypeScript strict" is read as the `strict` flag family. Indexed-access checking would put `!` on every typed-array read in the hot paths for no safety gain there. *(§4.3)*
- **D5 — The boundary test has two halves.** (a) A scanner reads every import specifier in each package's `src` and compares it with the table in §4.3; a relative import that climbs out of its package also fails. (b) A probe file using `window`, `document`, `console`, and `HTMLElement` is dropped into `runtime/src` and `tsc` must fail on all four. `render` and `audio` may import `@loreengine/runtime/view` only, never the root entry. *(§4.3, §4.7)*
- **D6 — Nondeterminism lint is a script, not ESLint.** `tools/ban-math-random.mjs` fails on `Math.random`, `Date.now`, `new Date(`, and `performance.now` in `runtime`, `algorithms`, `hexmath`, and `schema`. One rule did not justify an ESLint install. The wall-clock bans go beyond §5.8's letter but follow from L5. *(§5.8)*

### Schema

- **D7 — No schema-level defaults.** §4.6 says the validator rejects rather than repairs, so a file states every required field; a missing `hexSize` is an error, not 1. The defaults named in §4.5's comments are applied when content is created (`schema/src/defaults.ts`). This is also what makes the round trip byte-identical. *(§4.5, §4.6)*
- **D8 — Every object is strict.** Unknown keys are rejected, not dropped. A v0-style `player` block or an `isoRatio` in settings fails the load. *(§4.6, L7)*
- **D9 — Packed layers use Zod codecs.** In memory they are `Uint16Array` / `Uint8Array` / `Int16Array`; in files, canonical base64, little-endian. `parseProject` decodes, `serializeProject` encodes. `schema` has no DOM or Node, so base64 is a small pure-JS module. *(§4.5)*
- **D10 — `Id<K>` is a UUID v4 string cast to the spec's brand.** `z.uuidv4()` validates; the cast gives exactly `string & { readonly __kind: K }`. *(§4.5)*
- **D11 — `EntityPlacement.overrides` uses `ComponentData` itself.** Every component is already optional, so `Partial<ComponentData>` is the same type. Reusing the schema keeps one set of component fields in the reader manifest. *(§4.5)*
- **D12 — `serializeProject` writes 2-space-indented JSON in schema key order, with a trailing newline.** Diffable in git; layers are single base64 lines either way. *(§4.7)*
- **D13 — Semantic validation is a separate pass (`checkProject`).** Zod checks shape and single-field ranges. `checkProject` checks everything that needs two fields: references, layer lengths, `level <= maxLevel`, palette indices, ramp values 0..6, brain-local conditions only in brain transitions, region events only on map triggers and only for that map's regions, `startMode ∈ modes`, state and clip names. It returns every issue with a path and a stable code, so the editor can call it live. *(§4.6)*
- **D14 — Ids are unique per collection; placement keys, region ids, and trigger ids are unique project-wide.** `EntityMatch { by: 'placement' }`, `in-region`, and `set-trigger-enabled` carry no map id, so their targets must be unambiguous across maps. *(§4.5, §4.6)*
- **D15 — Variable operations are type-checked at validation as well as at runtime.** `add` needs a number variable, `toggle` a bool, `set` a value of the variable's type, `set-from` a source of the same type; ordering comparators apply to numbers only. §5.7 already rejects mismatches at runtime; catching them at load costs nothing and stops an author shipping an action that can never apply. *(§4.6, §5.7)*
- **D16 — `maxStacks` on a non-`stack` effect is rejected.** §4.5 marks it "'stack' only". *(§4.5)*
- **D17 — Every tier of an atlas must hold the same frame names.** Otherwise a `FrameRef` could resolve at one zoom and not another. *(§4.5)*
- **D18 — A clip may have fewer direction rows than `directions`** (but at least one, all the same length). How `mirror` reduces the row count is settled with animation playback in chunk 7. *(§4.5, §6.8)*
- **D19 — A ramp on a `maxLevel` cell is not a validation error.** §4.6 leaves ramp correctness to the Phase 3 lint. *(§4.6, §6.4)*

### Reader manifest

- **D20 — Field paths come from walking the Zod source.** `schema/src/walk.ts` lists every leaf: `Type.field`, `[]` for array elements, `{}` for record values, `<variant>` for a discriminated-union option. Named types (`.meta({ id })`) are walked once under their own name. There are 310 leaves. An empty marker component (`playerControlled`) is a leaf, because its presence is the datum. *(§4.4)*
- **D21 — Discriminators are leaves.** `Action<flag-set>.type` having a reader is precisely the guard against v0's inert actions: a variant cannot be added without naming the handler and its test. *(§4.4, §1)*
- **D22 — Test ids are checked per built chunk.** A manifest entry is `{ reader, test }`. Tests carry their id in the title, `[P2.cond.chance]`. `tests/readers.test.ts` requires the id to exist for every prefix in its `BUILT_PREFIXES` list, which grows as chunks are tagged. So the manifest states the plan for the whole foundation now, and each chunk must make its part true. *(§4.4, §4.7)*

### Ported modules

- **D23 — `hexmath/src/ported.ts` is v0.6.0 verbatim; `index.ts` holds adapters.** The scalar adapters (`cellCenterX`, `worldToCellIndex`, `neighborIndex`, …) restate the ported formulas without allocating, because L8 requires 0 bytes per tick in movement and collision and the ported functions return fresh objects. Each is tested for exact (`===`) equality with its original over the whole range. *(§1, L8, kickoff §4)*
- **D24 — `HexDir` 1..6 is the ported `AXIAL_DIRS` order:** 1 E, 2 NE, 3 NW, 4 W, 5 SW, 6 SE. *(§4.5)*
- **D25 — The world plane is the un-squashed hex plane.** The runtime calls the ported projection with `isoRatio` 1 and `size = hexSize`; the iso squash is applied only by `render`. Movement speeds and attack ranges are therefore isotropic in world units. *(§6.6)*
- **D26 — A\* changes from v0.6.0,** each required by the spec: square-grid branches removed (Q16); cells are dense indices rather than `GridPos` objects; `terrain.isWalkable(neighbor)` became `grid.connects(current, neighbor)` so cliffs and ramps decide passage (§6.3, §7.5); `maxExplored` defaults to 4,096 (§9.2); and the result reports why it stopped plus a path to the explored cell nearest the goal, which is what "truncated to the nearest reachable cell" (§9.2) needs. The heap, the lazy-deletion closed set, the cost model (entering a cell costs that cell's `moveCost`), and the cube-distance heuristic are unchanged.
- **D27 — The spatial hash keeps v0.6.0's five operations on a new layout.** `indexEntity` / `unindexEntity` / `reindexEntity` / `entitiesAt` / the cell-range scan become `insert` / `remove` / `update` / `queryCell` / `queryRange`. Buckets are intrusive linked lists over preallocated `Int32Array`s keyed by cell index, because v0.6.0's `Map<"col,row", Set<uuid>>` builds a string per move (L8). Pixel-rect filtering stays with the caller, which knows positions. *(L8, kickoff §4)*

### Fixtures

- **D28 — Emberfall is authored in code** (`fixtures/src/emberfall.ts`) with ids derived from readable names, and committed as `fixtures/emberfall.project.json`. A test keeps the two identical (`UPDATE_FIXTURES=1` rewrites the file). *(§8.9)*
- **D29 — Placeholder atlas pages are empty blobs until the bake exists.** The atlas lists every frame with its rectangle, but its page `AssetRef` is the SHA-256 of zero bytes with `byteSize` 0. The renderer draws engine placeholder shapes for a frame whose page cannot be resolved. Chunk 7's bake replaces the pages. *(§6.7, kickoff §3.6)*
- **D30 — `fixtures` restates two hex formulas** (cell center, offset → axial), because §4.3 lets it import only `schema`. A test checks them against `hexmath`. *(§4.3)*
- **D31 — Emberfall has no audio assets yet,** so no `FeedbackDef.sfx` or `MapDef.bgm`. They arrive with chunk 7's generated tones. *(§8.9)*
