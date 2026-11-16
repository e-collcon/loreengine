# LoreEngine — Decisions Log

Choices made while implementing `FOUNDATION_DESIGN.md` where the spec was silent or needed interpreting. Each entry says what, why, and which section it touches. Newest chunk last.

## Needs E

Items that need E's ruling. Nothing here blocks the build order; each was resolved the smallest way and can be changed.

- **N1 — The v0.6.0 test suites were not recovered.** `legacy/` held the three source files only. The hex math, A\*, and spatial hash suites were written from scratch (kickoff §4): round trips over the whole 256 × 256 range, all six neighbors at odd and even rows, `cubeRound` at hex boundaries, `pixelToHex ∘ hexToPixel` identity, A\* optimality against brute-force Dijkstra on 400 random maps, the spatial hash against a brute-force reference over 20,000 random operations. Spec §4.7 says the ported suites "pass unchanged"; that line cannot be met literally. *(§4.7, kickoff §4)*
- **N2 — "made with a newer LoreBrix" reads "LoreEngine".** Spec §4.6 gives the rejection text as "made with a newer LoreBrix", written before the v4 rename. The validator says "made with a newer LoreEngine". The schema-1 message still names LoreBrix v0.6.0, because that is what made those files. *(§4.6)*
- **N3 — The ISO squash ratio is not an authored field.** v0.6.0 stored `isoRatio` per map. `ProjectSettings` in §4.5 has no such field and the kickoff forbids inventing one, so the squash is an engine constant in `render` (see D-render entries when chunk 4 lands). If games need different camera pitches, this wants a `ProjectSettings` field (a minor schema revision). *(§4.5, §6.6)*
- **N4 — `SaveState` has two fields the spec's listing does not.** `entityGenerations` (the entity allocator's generation per slot) and `carriedEvents` (events still queued after the 8-round cascade cap). The ★ save-resume test cannot pass without them: recorded click orders name entities by id, so a resumed session must hand out the same ids as the uninterrupted one; and §5.5 says overflow events "carry to the next tick", which a save between those ticks must keep. Both are in `schema/src/save.ts`. *(§5.10, §5.12)*
- **N5 — `chunk-N-green` tags exist only in this session's clone.** The session's git proxy accepts branch pushes and refuses tag pushes (HTTP 403). The green commit of each chunk is recorded by SHA in `PROGRESS.md`; to publish the tags run `git tag chunk-1-green <sha> && git push origin --tags` for each row. *(kickoff §5)*
- **N6 — Wide ramps do not connect sideways. This departs from one clause of §6.3.** The connection rule in §6.3 has two halves: edges connect when both are flat at the same height, "or both are sloped edges of ramps with the same level and direction (a wide ramp)". The same section then promises that surface height "is continuous across every connecting edge: no steps, no seams", and §6.11 tests exactly that. On a pointy-top hex grid the two cannot both hold. Take ramp *a* rising east and its north-east neighbor *b*, also rising east at the same level. Their shared edge runs from *a*'s top vertex to *a*'s upper-right corner. Seen from *a*, those points are at L + ½ and L + 1. Seen from *b*, the same two points are its low-edge corner and its bottom vertex: L and L + ½. So the two surfaces differ by half a level along the whole shared edge, for any pair of side-adjacent same-direction ramps (the neighbor is always offset half a hex along the rise). No height function fixes this, because the end points are pinned by the flat cells beyond each ramp's low and high edges. `world.test.ts` has a test that measures the half-level gap.
  **What I did:** the first half of the rule only. A ramp's four side edges never connect, so the model stays self-consistent: the half-level step between two parallel ramp lanes is a small cliff for walking, for sight, and for the renderer alike, which is the point of §6.3's "one elevation model, three consumers". Parallel ramps still work as lanes: each is entered at its low edge and left at its high edge. The ★ connection-table test covers wide ramps and expects `false`; the continuity test passes over every connecting edge.
  **If E prefers the spec's literal rule** (units may cross between lanes, with a 0.25-unit pop in `z` and a cliff face drawn on an edge that walking ignores), it is one line in `edgesConnect` (`runtime/src/world.ts`) and one expectation in the table test; the continuity test would then need an exemption for wide-ramp edges. A true wide ramp on hexes needs a schema change instead: ramp directions through corners, or half-level ramp cells. *(§6.3, §6.11)*

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

## Chunk 2 — Runtime Core

### Shape of the runtime

- **D32 — `Sim` is internal; clients hold a `Runtime` and read a `RuntimeView`.** `runtime/src/sim.ts` owns every subsystem and the tick. `createRuntime` wraps it in the five calls of §5.3. `@loreengine/runtime/view` exports types and constants only; the view object is built from getters and value-returning functions, so no mutating call is reachable from it (tested). *(§4.3, §5.3)*
- **D33 — The tick is twelve named slots plus housekeeping.** `TICK_SLOTS` is §5.4 verbatim. Systems register into a slot; timers run in slot 11 and dispatch in slot 12. After slot 12 come the deferred despawns and (from chunk 3) any deferred map change. A test registers a probe in every slot and checks the order. *(§5.4)*
- **D34 — `end-session` stops the clock.** Once an outcome is set, `tick` is a no-op; the first outcome stands. The spec does not say what follows `end-session`; a session that keeps simulating after victory could still kill the player. *(§4.5, §5.3)*
- **D35 — The runtime has no wall clock.** `snapshot()` takes `savedAt` from the caller (default: the epoch); `storage` stamps the real time when it stores a save. `Date` is banned in headless packages by the lint. *(§5.10, L5)*
- **D36 — A resumed session keeps the save's clock mode and RNG.** `opts.seed` and `opts.clockMode` apply to new sessions only. *(§5.3, §5.10)*
- **D37 — Recording is opt-in and capped.** `opts.record` keeps quantized frames and applied commands (tagged with their frame index) up to 216,000 frames (one hour); past that it stops with a diagnostic. §5.3 says the runtime records commands "beside the input frames"; an always-on unbounded recording would break L8. *(§5.3, L8)*
- **D38 — The foundation's one command is `test-actions`,** which runs an action list with no subject. It is the "test-only command" of §5.3 and is what the determinism stream uses for menu-style changes. *(§5.3)*
- **D39 — Caps the spec does not list:** 256 running timers, 256 queued commands per tick, 256 retained diagnostic messages (counters are exact), 1,024 retained presentation events. L8 requires every collection to be capped. *(L8)*

### Events and triggers

- **D40 — An event is five scalars** (`type, a, b, s, n`) in a preallocated ring of 4,096, so raising one allocates nothing. `a` is always the subject and `b` the other; the table is at the top of `runtime/src/events.ts`. *(§5.5, L8)*
- **D41 — `interacted`: the interactor is `subject`, the thing used is `other`.** §7.9c's ledge example runs `scripted-jump` on the player as `subject`, which fixes the roles. *(§7.9c)*
- **D42 — Presentation events are a separate channel.** `message`, `sfx`, `bgm`, `session-ended`, `attack-windup`, and the rest never reach triggers and are never read by the simulation. They sit in a ring with sequence numbers; each subscriber keeps its own cursor, so the view stays read-only and a client that renders less often than it ticks misses nothing. *(§5.6, §6.9)*
- **D43 — Trigger order is global triggers, then the current map's,** each in authored order. It falls out of subscription order (session scope first) and is now part of determinism. *(§5.5)*
- **D44 — An event pattern cannot match by `subject` or `other`.** Those are what the event defines for the trigger's conditions and actions, so such a pattern could never match. `checkProject` rejects it (`match-without-context`). This adds one validation rule to chunk 1's validator, with a new test; no chunk 1 test changed. *(§4.5, §4.6)*
- **D45 — `once` means fired, not matched.** A `once` trigger whose conditions fail has not fired and may fire later. *(§4.5)*
- **D46 — `health-crossed` thresholds come from the bound triggers.** The trigger system exposes the `belowFraction` of every loaded `health-crossed` trigger; the health system (chunk 6) raises one event per threshold crossed, as §7.10 describes. *(§7.10)*
- **D47 — Map changes are deferred to the end of the tick,** so subscriptions never change while events dispatch. *(§5.5, §6.5)*

### Conditions, actions, variables

- **D48 — Where an `EntityMatch` names several entities, a condition holds when any of them satisfies it.** `alive { by: 'tag', tag: 'enemy' }` is true while one enemy lives; `count-alive` counts them. "Alive" means present and not dead (a dying entity is present until `despawnAfterMs`). *(§4.5, §5.6)*
- **D49 — A brain-local condition evaluated outside a brain is false, with a diagnostic.** The validator already rejects it at load. *(§4.5)*
- **D50 — An action type with no handler is reported, not skipped silently.** Entity actions are registered by the chunks that own their state (spawn, despawn, teleport in chunk 3; the rest in chunks 5 and 6), as §5.6 describes. *(§5.6)*
- **D51 — Non-finite numbers are rejected by the VariableStore** like any type mismatch, so `add` can never store `Infinity`. *(§5.7)*
- **D52 — Milliseconds round to the nearest tick, and anything above zero lasts at least one tick.** 80 ms is 5 ticks; 1 ms is 1. *(§2)*

### Entities and saves

- **D53 — The entity store's core lands in chunk 2,** because conditions and `EntityMatch` need entities: generational ids, deferred despawn, the 8,192 cap, transform and health arrays. Chunks 5 and 6 add the remaining runtime-only state of §7.3. *(§7.3)*
- **D54 — A new entity takes the lowest free index; the generation is bumped when a slot is freed.** Lowest-free makes ids a function of the live set, and bumping on free makes an id stale the moment its entity is gone. *(§7.3, L5)*
- **D55 — The player is entity 0.** It spawns before the start map's placements. `entity-spawned` fires for the player's first spawn and for runtime spawns, not for placements at map load (a large map would flood the 4,096-event queue). *(§6.5)*
- **D56 — Authored components are shared, not copied.** Each entity points at its archetype's `ComponentData`; a placement with overrides gets one merged object at spawn. Overrides replace whole components. *(§4.5, §7.3)*
- **D57 — `ComponentPatch` and `SerializedEntity` are designed here** (the spec names them without a shape). A patch is a strict object of optional blocks (`id`, `transform`, `health` so far; chunks 5 and 6 add theirs). The current map saves full patches including entity ids; other maps keep only what lasts. *(§5.10)*
- **D58 — Restoring a save raises no events.** `map-loaded` fires when a map is entered, never on resume; otherwise a resumed session would restart every `map-loaded` timer and diverge from the uninterrupted run. *(§5.10, §5.12)*
- **D59 — The state hash is a hash of the snapshot** (plus the session outcome). So it covers exactly what a save holds: anything missing from the save is caught by the save-resume test instead of hiding inside the hash. Session-scope variables are outside it, as they are outside the save. *(§5.12)*
- **D60 — Content changed since the save:** a different `contentRevision` loads with a `save-content-changed` diagnostic; placements, variables, triggers, and archetypes that no longer exist are dropped and reported; a placement added since the save spawns into a free slot after every saved entity is back in its own. If the save's current map is gone, the session starts from the project's start map. A save from another project is refused. *(§5.10)*

### Storage

- **D61 — Projects are stored as their validated JSON text** and re-validated on every load, so the validator really does run "on every load and import". *(§4.6, §5.11)*
- **D62 — Blob pruning looks at every stored project.** Blobs are content-addressed and shared, so a blob is deleted only when no stored project references it. If any stored project fails to validate, nothing is pruned. *(§5.11)*
- **D63 — Storage refuses playtest saves and stamps `savedAt`.** Autosaves roll per project. *(§5.10, §5.11)*
- **D64 — `.loreengine` files are stored (not deflated) zips with a fixed timestamp,** so the same project exports to the same bytes. A referenced blob that is not in the store is left out and reported in `missing`; on import a blob whose bytes do not hash to its name is rejected. *(§5.11)*
- **D65 — `PlayerPrefs` is defined in `schema`,** because `storage`, `render`, and `audio` all need the type and may share nothing else. Malformed stored prefs fall back to defaults. *(§5.11, §6.9)*

## Chunk 3 — World (3A)

- **D66 — `World` is built per map load and precomputes a link table.** For each cell and direction it stores the neighbor index and a bitmask of the movement modes that may cross that edge. `connects(a, b, mode)` is a lookup; pathing, collision, and sight will all read the same table. The authored layers are referenced, never copied or written. *(§6.3)*
- **D67 — `edgeHeight` returns levels,** as the table in §6.3 states them (`L`, `L + 1`, `'sloped'`). `surfaceHeight` returns world units. *(§6.3)*
- **D68 — Ramps facing each other connect when their edges agree:** two high edges at the same height form a ridge, two low edges a valley. This follows from the rule and is in the table test. *(§6.3)*
- **D69 — `surfaceHeight` off the map is 0,** and `cellAt` is -1. *(§6.3)*
- **D70 — Lint lives in `runtime`** (`lint.ts`, exported through `runtime/view`), because it reuses the world queries; the editor only displays it. Unreachable areas are reported one warning per connected area with its size, at most 16 per map, the rest summarized. "Collider overlapping a cliff edge" means the collider circle crosses an edge of its own cell that its start mode cannot pass. *(§6.4)*
- **D71 — Leaving a map keeps health only where play changed it.** A placed entity at full health leaves no row in `changed`; a spawned survivor keeps its position and health. Entities already marked for despawn are not kept. *(§5.10, §6.5)*
- **D72 — A cross-map teleport needs a persistent target and moves every persistent entity,** as §6.5 says ("move every persistent entity across"). A cross-map teleport that matches only map entities is refused with a diagnostic: map entities cannot leave their map. It happens at the end of the tick, after events have dispatched (D47). *(§6.5)*
- **D73 — `teleport` within a map sets `prev*` to the new position** and raises a `teleported` presentation event, so the renderer skips interpolation (§6.6). It does not check that the destination is passable; the lint is the place for that. *(§6.5, §6.6)*
- **D74 — `spawn` at a region picks random cells of the region from the simulation RNG** (§5.8 names spawns as a consumer), trying up to 8 draws for a cell the archetype's start mode can stand on, and spawns at the cell's center. `spawn` at `subject` spawns at the subject's position. A region on another map, an empty region, or a missing subject spawns nothing and reports it. *(§4.5, §5.8)*
- **D75 — A map's `bgm` is requested when the map opens,** on entry and on resume, as a `bgm` presentation event with a 1 s fade. A map with no `bgm` leaves the music alone; silence is `change-bgm` with `null`. *(§6.10)*
- **D76 — The view-surface test's key list gained `world`.** `runtime.test.ts` (chunk 2) asserts the exact set of members on `RuntimeView`, so adding a read-only member means adding its name there. That is the one edit to an earlier chunk's test; the assertion it protects (nothing mutating is reachable) is unchanged. *(§9.6)*
- **D77 — The leak gate runs inside Vitest with `--expose-gc`** (`pool: 'forks'`, `execArgv`), and fails outright if `gc` is missing rather than skipping the heap check. *(§9.5)*
- **D78 — A second fixture, `buildElevation()`,** carries the two-map lifecycle tests and the render spike's scenes. Its spire is rock, so the fixture is lint-clean. *(§6.11, kickoff §3.4)*
