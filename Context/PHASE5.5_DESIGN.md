# Phase 5.5 — Schema v2 Consolidation · Technical Design (v3 — dissolved)

**Status:** **v3 — DISSOLVED into Foundation Phases 1–2; kept as rationale only — reconciled with the Foundation Rewrite (§R).** Design (no code yet) · **v2 — absorbs three items from Phase 12's gap list: `flag-set` deletion, the `ActionExecutor` extraction, and the undo policy (§3.7–3.9)**
**Depends on:** nothing. Phases 1–5 are shipped; this is the next thing that can start.
**Blocks:** Phase 6 and everything after it.
**Schema:** creates v2 · **Recommended effort:** Extra High
**Chunks:** one

---

## R. Reconciliation with the Foundation Rewrite

### R.0 How to read this document now

**This section is authoritative.** The *LoreEngine Foundation — Phases 1–5* (formerly the LoreBrix Foundation Rewrite) (cited as **F**, with its section numbers) replaced the shipped v0 Phases 1–5 and dissolved Phase 5.5. Where anything below this section conflicts with it, this section wins, and each superseded block carries a ⚠ marker pointing back here. Findings that cite `App.tsx`, `playtest.ts`, `types.ts`, or other v0.6.0 files describe code the greenfield rewrite discards; they stay as the reason the design looks the way it does.

| Where this document says | Read it as |
|---|---|
| `TriggerAction`, `TriggerAction[]` | `Action`, `Action[]` (F §4.5) |
| a field on `CombatantBase`, `CombatantEntity`, `PlayerSprite`, `NPCSprite` | a component on the entity (F §7.3); the player's live values travel in its persistent entity in the save |
| `CombatantEntity` methods (`equip()`, `useItem()`, `cast()`…) | a runtime system plus a **runtime command** the UI enqueues (F §5.3) |
| `EntityManager.update(dt)`, a per-frame step | a slot in the fixed 60 Hz tick order (F §5.4) |
| `App.tsx`, `src/*.ts` integration points | the packages `schema`, `runtime`, `render`, `audio`, `panels`, `editor`, `player` (F §4.3) |
| "imports nothing from `App.tsx` or React" | the package boundary (F law L1), enforced at compile time |
| tiles, `px` | hexes and world units: one hex step = √3 × `hexSize` world units |
| `TerrainService`, `castRay` | the world queries `connects` and `surfaceHeight` (F §6.3) and `castSegment` (F §7.6) |
| entity `UUID`s of placed things | a placement `key` (F §4.5) |
| elapsed play time, `elapsedMs` | simulation time: ticks × 1000/60 ms, plus Phase 14's skipped time |
| Phase 5.5 | F Phase 1 and Phase 2 |
| durations as `durationMs` / `durationTurns` | the `Duration` union (F §4.5), extended by Phase 14 |
| square and hex-iso maps | hex-iso only in this branch (F Q16) |

**v3 revision: this phase is dissolved.** Every item it designed is now native to the Foundation Rewrite's Phase 1 or Phase 2, built greenfield rather than as a refactor of v0.6.0. The document is kept, unedited below, as the reasoning behind those foundation decisions. Nothing in it should be implemented from this file.

### R.1 Where each item landed

| v2 item | Now | Difference from this document |
|---|---|---|
| §4 `AssetRef` struct, content addressing | F §4.5 | Adopted as designed: `blobId` **is** the SHA-256 of the decoded bytes; no separate `sha256` field |
| §4.2 `BlobStore` | F §5.11 | Bytes live in an IndexedDB `blobs` store, not inline in `project.blobs`; a `.lorebrix` export zips the project with its blobs |
| §4.2 pure-JS SHA-256 fallback, §4.4 `prune` on save | F §5.11 | Adopted as designed |
| §4.3 `resolveAsset` callback | F §6.6 | The renderer receives an injected asset resolver; it never imports storage |
| §5 dialogue trees promoted | Phase 13 v4 | Added by the phase that reads them, as a minor schema revision |
| §6 factions | F §4.5 | Three-state relation matrix instead of `hostileTo`; the three seeded defaults are adopted; `isPlayerFaction` dropped, since the player's faction is its `faction` component |
| §7 variable registry | F §4.5, §5.7 | Phase 12's full shape (`id`, `key`, `name`), not this type-only version |
| §8 `startMapId` / `openMapId` | F §4.5, §8.3 | As designed |
| §9 v2 gate, v1 rejection | F §4.6 | As designed |
| §10 the save boundary | F §5.10 | Enforced from day one: there is no `Project.player`. The player spawns from `playerArchetypeId` at `MapDef.playerStart` |
| v2 additions: `flag-set` deletion | — | Moot: greenfield, never built |
| v2 additions: `ActionExecutor` extraction | F §5.6 | Built headless, not extracted |
| v2 additions: undo policy | F §8.7 | As designed: canvas command undo, Save and Cancel for databases |
| `AssetManifest.portraits`, `.icons` | Phases 11 and 13 | Added by their first readers |
| §13 the 88-unmodified-tests gate | F §9.6 | Moot. The analogous gate is the ported hex math, A\*, and spatial hash suites passing unchanged |

---

## 0. Why this phase exists

The data architecture pass found six container-level problems in `types.ts`. None of them are about stats, equipment, or spells — they are about the shape of the `Project` object itself. Three arguments for doing them first, alone:

**They would corrupt Phase 6's story.** Phase 6 is the foundational stat phase and it already carries an Extra High risk profile. Landing an asset-storage refactor and three database promotions inside it means a failure in one is indistinguishable from a failure in the other.

**They are the only changes that *restructure* rather than *extend*.** Everything in Phases 6–17 appends: a new array, a new field, a new panel. These six move things that already exist. Restructures are cheap now and expensive at every later point, because the cost scales with the amount of authored content in the world — and right now that amount is one starter project we generate procedurally.

**This phase must change zero behavior**, which makes it uniquely verifiable. Every one of the 88 existing runtime tests from Phases 2–5 must still pass, untouched. That is a far stronger gate than any phase that adds features can offer, and it is why doing the risky structural work here is *safer* than distributing it.

---

## 1. Goal

Land the v2 `Project` container: content-addressed asset storage behind a swappable adapter, dialogue trees promoted to a shareable database, a faction registry, a variable registry type, one rename, and the v2 version gate. Re-author Emberfall against it. Change nothing a player or creator can observe.

## 2. Non-goals

- **A real blob store.** Option A is explicitly chosen (§4.1): bytes stay inside the document, behind an interface that a remote store can implement later without touching a caller. Option C ships after MVP.
- **Physically removing `Project.player`.** The project/save boundary is declared as law here and marked in the source, but enforced in Phase 11 where character creation and `SaveState` exist to receive it (§10).
- **Promoting `statusEffects`.** Deferred to Phase 10A by decision, because the Phase 4 panel that edits them is v1-shaped and gets rewritten there anyway. Promoting them now would leave a broken editor live for five phases.
- **Any editor for the new registries.** Factions and variables get types and seeded data, no panels. Phases 10 and 12 own their UI.
- **Stubbing arrays for future phases.** See §3 — this is a deliberate refusal, not an oversight.

---

## 3. The organizing law: additive-only from here

From this phase onward, **`Project` may gain fields but never restructure.** Every later phase's container diff is one of exactly two shapes: a new optional field, or a new array that starts empty.

**Why this doc does not stub the future arrays.** The tempting move is to declare `equipment: EquipmentDef[]`, `items: ItemDef[]`, `enemies: EnemyDef[]` and so on right now, so the container is "finished." That would require defining `EquipmentDef`, `ItemDef`, and `EnemyDef` here — prejudging five phases of design in order to satisfy a compiler. The stubs would be wrong, and being wrong in `types.ts` is worse than being absent, because every downstream file inherits the wrongness.

Adding an array field later is purely additive and breaks nothing. So the honest position is: **the container's *rules* are finalized here; its *contents* accumulate.** Only fields whose types can be defined correctly today are added today.

By that test, four things qualify and are in scope: `dialogueTrees` (the type exists), `factions` (fully specified in Phase 10 v2), `variables` (fully specified in the data architecture proposal, and needed before Phase 11 — see §7), and `blobs`.

---

## 4. Asset storage

### 4.1 The shape

Today, `AssetRef = string` and holds a data URL. Every tileset, spritesheet, and audio clip inlines its bytes at the point of use. Emberfall's art arrives as `canvas.toDataURL('image/png')` in four places.

v2 splits identity from bytes:

```ts
/** Lowercase hex SHA-256 of the DECODED bytes. Content-addressed. */
type BlobId = string;

interface AssetRef {
  blobId: BlobId;
  mime: string;
  byteSize: number;
  width?: number;        // images
  height?: number;
  durationMs?: number;   // audio
}
```

and the project gains one side table:

```ts
// Project
blobs: Record<BlobId, string>;    // blobId → data URL. Option A: still inline.
```

**Content addressing is what makes this worth doing now rather than later.** Because the id *is* the hash, importing the same tileset twice produces one entry and two references. That is real dedup today, inside a single project, with no server. And when Option C arrives, `blobId` is already the exact primary key a remote content-addressed store wants — the field does not change, only who answers for it.

### 4.2 The adapter

```ts
interface BlobStore {
  put(bytes: ArrayBuffer, mime: string): Promise<AssetRef>;
  get(ref: AssetRef): Promise<string>;     // an opaque URL, usable as Image.src
  has(id: BlobId): boolean;
  prune(reachable: Set<BlobId>): number;   // drops orphans, returns count
}

class InlineBlobStore implements BlobStore { /* reads and writes project.blobs */ }
```

**`get()` returns an opaque URL and callers must treat it as opaque.** Today it is a data URL read out of `project.blobs`. Under Option C it will be a signed CDN URL or an object URL from a fetched blob. Any caller that inspects the string, slices it, or assumes a `data:` prefix breaks the swap — so no caller does. Hand it to `Image.src` or an `<audio>` element and nothing else.

That single discipline is the entire point of this section. When Option C lands, one file is replaced and no other file changes.

**Hash the decoded bytes, not the data URL string.** Two encoders can emit different base64 for identical pixels, and a project could carry the same image twice with different string forms. Hashing the decoded `ArrayBuffer` makes dedup actually work.

**`put()` is async** because `crypto.subtle.digest('SHA-256', …)` is async. This fits the existing shape rather than fighting it: `TileEngine.registerTileset` and `registerAssets` have been async since Phase 2.

**One environment constraint worth knowing before it bites:** `crypto.subtle` is only available in a secure context — HTTPS or `localhost`. Vite dev serves `localhost`, so development is fine, and any real deployment will be HTTPS. But a plain-HTTP preview host would silently break asset import. Ship a ~40-line pure-JS SHA-256 fallback used when `crypto.subtle` is undefined, so the failure mode is "slightly slower" rather than "import does nothing."

### 4.3 Keeping the engine ignorant

`TileEngine` currently receives `asset.src` as a string. It must not learn about `BlobStore` — the engine's whole design is that it knows nothing about entities, storage, or React, and that is why it has survived four phases unchanged.

So `TileEngineOptions` gains one optional callback:

```ts
resolveAsset?: (ref: AssetRef) => Promise<string>;
```

The app passes `store.get`. The engine asks for a URL and gets one. Exactly the seam `setEntityRenderHook` already established for a different concern.

### 4.4 Garbage collection

Deleting a tileset leaves its blob in the table forever, and the document grows monotonically. `prune()` walks the manifest, collects every reachable `blobId`, and drops the rest. **Wired to the save path**, so pruning happens where the cost is already being paid and never mid-edit (where an undo could resurrect a reference to a blob just collected).

### 4.5 What Option A does not buy — stated plainly

The document does **not** get smaller. Bytes are still inline; a project with real art is still a large JSON. What is bought is dedup within a project, a single point of indirection, and a document where a one-word text edit no longer sits adjacent to a megabyte of base64 in a diff.

No CDN, no cross-project dedup, no lazy loading, no streaming. Those need a server and are Option C's job, after MVP. Large projects will still parse slowly. That is accepted, knowingly, and it is the right trade for shipping.

---

## 5. Dialogue trees promoted

`DialogueTree` is currently `{ rootId, nodes }` living at `NPCSprite.dialogue?`. It has **no id and no name**, which is the tell: it was never designed to be referred to. A tree therefore belongs to exactly one NPC and cannot be reused, listed, or edited anywhere but inside that NPC.

Every other content type in the project is a top-level database. This one becomes one:

```ts
interface DialogueTree {
  id: UUID;            // NEW
  name: string;        // NEW — what shows in the picker
  rootId: string;
  nodes: Record<string, DialogueNode>;
}

// Project
dialogueTrees: DialogueTree[];

// NPCSprite
dialogueTreeId?: UUID;    // replaces `dialogue?: DialogueTree`
```

**No migration code.** Confirmed with E: nothing exists beyond Emberfall, so its one villager tree is re-authored by hand into the database (§11). Writing a migration for a population of one project we generate ourselves would be pure ceremony.

**Minimum UI, deliberately.** The NPC inspector gets a tree picker and a "new tree" action, and the existing inline node editor is re-pointed at whichever tree is selected. A proper Dialogue Database panel — with the branching, flag-gated, replayable-versus-irreversible authoring from the roadmap — is **Phase 13's**. This phase moves the data and nothing more.

The payoff is immediate and testable: two NPCs pointed at one tree, edit it once, both change.

---

## 6. Factions

Assigned here by Phase 10 v2 §16. One small type, defined now so Phase 10 adds behavior rather than restructuring the container:

```ts
interface FactionDef {
  id: FactionId;              // string
  name: string;
  hostileTo: FactionId[];     // explicit. Absence of an entry means neutral.
  isPlayerFaction: boolean;
}

// Project
factions: FactionDef[];

// CombatantBase
faction: FactionId;
```

**Seeded with three defaults** so no project starts in an invalid state: `player` (hostile to `hostile`), `hostile` (hostile to `player`), and `neutral` (hostile to nobody).

**Nothing reads `faction` until Phase 10.** It is authored data with no consumer for four phases, which is exactly why it belongs in the container phase rather than being bolted on later.

---

## 7. The variable registry — type only

```ts
interface ProjectVariable {
  id: UUID;
  key: string;                                // 'met_annwen', 'gate_solved'
  type: 'bool' | 'number' | 'string';
  initial: boolean | number | string;
  scope: 'save' | 'session';                  // 'save' persists; 'session' resets on load
  readonly: boolean;                          // true = a CONSTANT
  description?: string;
  category?: string;
}

// Project
variables: ProjectVariable[];    // empty
```

**Why here and not in Phase 12, which owns this feature.** Phase 11 (Save State) comes *before* Phase 12 in the roadmap, and `SaveState` must serialize variable values — which means Phase 11 needs to know what to initialize them from. Defining the type in Phase 12 would create a backward dependency from 11 to 12.

Defining it here costs one interface and one empty array, and dissolves the ordering problem entirely. Phase 12 still owns everything that matters: the editor, the `set-variable` and `check-variable` trigger and condition vocabularies, the usage view, and the runtime.

---

## 8. `activeMapId` → `startMapId`

The field currently means two different things at once: *where the game begins* (authored data, belongs to the creator) and *which map the creator has open* (editor UI state, belongs to nobody but the session).

```ts
// Project
startMapId: UUID;          // was activeMapId — authored

// EditorUIState
openMapId: UUID;           // NEW — session only, initialized from startMapId on load
```

Small, but it is a genuine correctness bug waiting to happen: today, opening a different map in the editor silently changes where playtest starts. That gets a dedicated test (§14).

---

## 9. The v2 gate

```ts
export const SCHEMA_VERSION = 2;
```

On load, a project whose `schemaVersion` is not 2 is **rejected with a specific message** and the current project is left untouched:

> *"This project was made with LoreBrix v0.6 and uses the old data format. It can't be opened in v0.7 or later."*

No migration, no partial parse, no silent coercion. "We never shipped, so we don't need migration" is true; "we never shipped, so a v1 file can't exist on anyone's disk" is not — E has been running v0.6.0 locally. Half-parsing one into a v2 container would produce a project that looks fine and is quietly broken.

**This moves off Phase 6.** `PHASE6_DESIGN.md` §7 currently owns the version bump and the rejection gate; both belong here. Phase 6 extends v2 rather than creating it.

---

## 10. The project/save boundary — declared, not enforced

The law, from the data architecture proposal:

> **1. A project never contains player state.** **2. A save never contains authored data.**

`Project.player: PlayerSprite` violates the first, and Phases 6–10 will add `inventory`, `wallet`, `loadout`, and `knownSkills` to `CombatantBase`. **This phase does not fix that**, because removing `Project.player` before `characterPresets` and `SaveState` exist would leave the app unable to spawn a player for five phases.

What this phase does instead is put the law where an implementer will actually encounter it — in the source, on the offending field:

```ts
/**
 * @deprecated Phase 11 replaces this with `characterPresets` (authored) plus
 * `SaveState.character` (played). Until then this is the single authored
 * player definition. DO NOT write runtime player state back into it.
 */
player: PlayerSprite;
```

A comment is not enforcement. It is, however, the difference between an implementer four phases from now making a considered choice and making an accidental one.

---

## 11. Emberfall, re-authored

Not migrated — regenerated, because `starter-assets.ts` builds it procedurally anyway.

- Its four `toDataURL` sites go through `store.put()`, producing `AssetRef`s and populating `project.blobs`.
- The villager's dialogue is extracted into `project.dialogueTrees` with a real name; the villager gets a `dialogueTreeId`.
- Factions assigned: the player entity is `player`, the guard is `hostile`, the villager is `neutral`.
- `activeMapId` becomes `startMapId`.
- `schemaVersion: 2`.

**Behavior must be identical.** Same meadow, same hex cavern, same patrol, same dialogue text, same guard chase, same lava burn, same pond trigger. That is the signature test.

---

## 12. Files touched

| File | Change |
|---|---|
| `src/core/types.ts` | `AssetRef` struct · `BlobId` · `Project.blobs` · `DialogueTree` gains id/name · `NPCSprite.dialogueTreeId` · `FactionDef` + `Project.factions` + `CombatantBase.faction` · `ProjectVariable` + `Project.variables` · `startMapId` · `EditorUIState.openMapId` · `AssetManifest.portraits` and `.icons` · `SCHEMA_VERSION = 2` · the `@deprecated` note on `player` |
| `src/core/blob-store.ts` | **NEW** — `BlobStore`, `InlineBlobStore`, hashing with the pure-JS fallback |
| `src/core/action-executor.ts` | **NEW** — `ActionExecutor` + `ActionContext`, extracted verbatim from `App.tsx:1010` |
| `src/tile-engine.ts` | one addition: `TileEngineOptions.resolveAsset?`. No other change. |
| `src/starter-assets.ts` | Emberfall re-authored (§11) |
| `src/App.tsx` | tileset/spritesheet importers route through `store.put()` · load/save gate and prune · NPC inspector tree picker · `openMapId` wiring |
| `src/entity-system.ts` | asset registration resolves refs through the callback |

**Not touched:** `GameplayRulesEditor.tsx`, `playtest.ts`. Neither reads assets or dialogue structure. If either needs changing, something has gone wrong and it should be raised before proceeding.

---

## 13. Verification gate

Stricter than usual, because this phase's entire claim is that nothing changed:

**★ All 88 existing Phase 2–5 runtime tests pass unmodified.** Not "updated to match" — unmodified. Any test that needs editing to pass is a behavior change and must be justified out loud before it is accepted.

Plus strict `tsc --noEmit` and a clean production build.

## 14. New tests

- **★ Executor parity:** all six existing action variants behave identically to today's `runActions` — this is an extraction, and any behavior change is a regression.
- **★ Executor isolation:** the module's import list contains nothing from `App.tsx` or React; every action runs against a synthetic context with only `log` provided, and one needing a missing callback reports `unavailable` rather than throwing.
- **`flag-set` is gone:** the variant is absent from the `Condition` union and from the rules editor; no project fails to load because of its removal.
- **Hash stability:** identical bytes yield an identical `blobId` across separate `put()` calls; a single flipped byte yields a different one.
- **★ Dedup:** importing the same image twice produces **one** entry in `project.blobs` and two `AssetRef`s pointing at it.
- **Decoded-bytes hashing:** the same image supplied as two differently-encoded data URLs dedupes to one blob.
- **Resolution:** `get()` returns a URL that successfully loads as an `Image`.
- **Prune:** deleting a tileset and saving drops its blob; a blob still referenced by a spritesheet survives.
- **Fallback hashing:** with `crypto.subtle` stubbed undefined, `put()` still returns the same hash the native path produces.
- **★ v1 rejection:** a `schemaVersion: 1` file is refused with the §9 message and the currently open project is byte-identical afterward.
- **Dialogue sharing:** two NPCs referencing one `dialogueTreeId` both reflect a single edit; an NPC with a dangling id degrades to no dialogue rather than throwing.
- **★ `startMapId` independence:** opening map B in the editor, saving, and reloading still starts playtest on map A.
- **Faction seeding:** a new project has the three defaults; every Emberfall combatant has a valid `faction`.
- **★ Emberfall parity:** the re-authored starter project renders identically, the villager's dialogue tree resolves to the same text, the guard still chases and still burns in lava, and the pond trigger still fires.

---

## 15. Decisions locked

- **Option A for asset storage**, per E: content-addressed `AssetRef`, bytes still inline in `project.blobs`, behind a `BlobStore` interface. Option C ships after MVP by replacing one file.
- **`get()` returns an opaque URL.** No caller inspects it. This is what makes the Option C swap free.
- **Hash the decoded bytes**, not the data URL string.
- **`dialogueTrees` promoted with no migration code**, per E. Emberfall re-authored by hand. Minimum picker UI only; authoring is Phase 13's.
- **`statusEffects` stay inline**, per E, until Phase 10A rewrites both the type and its editor together.
- **`factions` and `ProjectVariable` defined here**, consumed later — because both would otherwise force a container restructure or a backward phase dependency.
- **`SCHEMA_VERSION = 2` with explicit rejection of v1.** Moves off Phase 6.
- **The save boundary is declared in source and enforced in Phase 11.**
- **Additive-only from here.** No future array is stubbed; each owning phase adds its own.
- **`flag-set` is deleted, not migrated.** It never worked; removing it is zero behavior change and spares seven phases of a broken affordance.
- **`ActionExecutor` is extracted here**, as a pure refactor, so Phases 8 and 10 call something that exists when they run.
- **Undo covers the canvas; databases use Save and Cancel.** One policy for all twelve database editors.
- **Zero observable behavior change**, verified by 88 unmodified tests.

## 16. Risks

1. **Async creep.** `put()` is async, so the import path becomes async. Contained to the importers, and the engine's registration path was already async.
2. **Blob orphans** if `prune()` is not wired to save. The file then grows forever and nobody notices for months. Covered by a test.
3. **`crypto.subtle` needs a secure context.** Fine on `localhost` and HTTPS; the fallback covers the rest (§4.2).
4. **Expectation management on file size.** Option A does not shrink the document, and it should not be described as though it does (§4.5).
5. **The `@deprecated` comment is not enforcement.** If Phases 6–10 write player state into `Project.player` anyway, Phase 11 inherits the mess this phase was supposed to prevent. Worth re-checking at each phase's review.

## 17. Amendments this doc requires elsewhere

1. **Phase 6 §7** — the `schemaVersion` 1 → 2 bump and the v1 rejection gate move to this phase. Phase 6 extends v2.
2. **Phase 6 §10** — "Emberfall re-authored attributes-first" still holds, but the container re-authoring happens here first; Phase 6 only changes stats.
3. **Phase 10 §16.7** — satisfied: `project.factions` lands here as specified.
4. **Phase 13** — inherits the Dialogue Database panel, now that trees are addressable.

---

*LoreBrix, ELMSCORP. Phase 5.5 design — for review.*
