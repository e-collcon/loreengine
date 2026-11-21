# Phase 11 — Runtime Shell, Save State & Input · Technical Design (v2)

**Status:** **v2 — reconciled with the Foundation Rewrite (§R).** Design (no code yet)
**Depends on:** Foundation Phases 1–5 (F), and Phases 6 v5, 7 v5, 8 v7, 9 v5, 10 v6 — **all of them.** This is the phase that collects.
**Stage:** Stage 1. Cloud sync and version reconciliation are Stage 2 (§4.4).
**Recommended effort:** Extra High · **Chunks:** two (11A / 11B)

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

**v2 revision:** reconciled with the Foundation Rewrite. The two doors, one record per game, unlimited manual saves, playthroughs, permadeath, destructive-dialog rules, character creation, the hotbar, and the menu are unchanged. F already built the save boundary, the stores, input frames, and ephemeral playtest, so 11A shrinks to what F left for it.

### R.1 There is no `Project.player` to delete

F never had one. The player is spawned at session start from `ProjectSettings.playerArchetypeId` at the start map's `MapDef.playerStart` (F §4.5, §6.5). Phase 11 changes only *which* archetype:

- `CharacterPresetDef` gains `archetypeId` (replacing `spritesheetId`); the chosen preset's archetype is spawned instead of the default.
- The "spawn marker" of §3 is `MapDef.playerStart`.
- `characterPresets` and `characterCreation` are minor schema revisions; `assets.portraits` arrives here as one too.

### R.2 Storage: F built the stores, Phase 11 adds playthroughs

F ships `projects`, `saveMeta`, `saveData` (the split this phase argued for), `blobs`, and `prefs` (F §5.11, amended to match). Phase 11 adds the **`playthroughs`** store, the `Playthrough` row, permadeath, thumbnails, and `usage()`. The `ProjectStore` and `SaveStore` interfaces in §4.2 extend F's.

### R.3 `SaveState` maps onto F's save body

F's `SaveState` (F §5.10) is the body; `SaveMeta` stays as §6 specifies. Field by field:

| §6 field | Now |
|---|---|
| `character.stats`, `loadout`, `inventory`, `wallet`, `knownSkills`, level and EXP | Components of the player's **persistent entity** (`stats`, resources, `loadout`, `inventory`, `wallet`, `skills`, `progression`) |
| `character.name`, `gender`, `presetId` | A new **`character` component** on the player |
| `character.hotbar` | A `hotbar` block on the save (owned here) |
| `location` | The player's `Transform` plus F's `currentMapId` |
| `world.defeatedEntityIds`, `takenPickupIds`, `lootedContainerIds` | F's per-map `removed` lists |
| `world.destroyedDoodads` | Per-map `changed` patches on the `destructible` component |
| `world.unlockedDoorIds` | Variables or component patches; no dedicated list |
| `world.firedOnceTriggerIds` | F's `triggers.fired` |
| `world.factionOverrides` | Per-map `changed` patches on the `faction` component |
| `world.shopStates` | Unchanged; shops are not entities |
| `clock.elapsedMs` | F's `tick` (elapsed = tick × 1000/60), plus Phase 14's `skippedMs` |
| `activeEffects`, `cooldowns` | Component state inside the serialized entities |
| `variables`, `discovered` | Unchanged (variables keyed by id, F §5.7) |

`SaveMeta.kind` is `manual | auto | quick`. A playtest save is built in memory and never stored.

### R.4 Input actions

F ships `InputActionDef` with `role` and `defaultBindings` (F §4.5) and the device-agnostic `InputFrame`. Phase 11 adds `context` and `builtin`. §9's `suggestedKeys` is F's `defaultBindings`: one name. `hexMovementScheme` is dropped, because movement is continuous. Roles `hotbar1` … `hotbar8` join the role union. User preferences merge into F's `prefs` store (shake, flashing, volumes), with `bindings` and `reducedMotion` added here.

### R.5 Audio is not a non-goal

F Phase 3 ships the mixer. The Options volume sliders are live, not wired to a no-op.

### R.6 Playtest

F already runs playtest on an ephemeral save and never had snapshot-and-restore; §12 has nothing left to delete. Its test, that a playtest writes zero records, stands.

### R.7 Thumbnails

Captured through the renderer's `captureFrame(width, height)`, not v0's `exportPNG`.

### R.8 Menu screens

Character, Inventory, and Spells come from the `panels` package (Phase 7 §R.8). Their actions issue runtime commands (F §5.3). Events owned here: `game-started`, `save-loaded`.

### R.9 Lovable brief corrections

In §17, a preset's data is `{ name, gender, archetypeId, portraitAssetId, baseAttributes }` (not `spritesheetId`), and the menu gains Journal (disabled until Phase 13.5) beside Map.

### R.10 Authored attributes (later on 16 Nov)

Attributes are project content (Phase 6 v6 §R.11). Character creation allocates `startingPoints` across `project.attributes`, whatever they are; presets' `baseAttributes` are keyed by attribute id; the Character screen lists the project's attributes. In the §17 Lovable brief, the attribute step renders the project's list rather than STR, AGI, INT.

---

## 0. What E locked

1. **Two doors.** LoreBrix stops opening into the editor. It opens on a Launcher: **PLAY** → game library → save browser → Continue or New Game. **CREATE** → project library → the three-panel editor.
2. **A game and a project are the same record seen through two doors.** Not two copies. The distinction is intent, not data — so "edit the game you're playing" is one button.
3. **Importing a `.lorebrix` file adds a cartridge to the shelf.** That is the sharing story until Stage 2.
4. **Saves are not limited.** No three-slot memory card. §5 is the structural consequence of this, and it is the most consequential design decision in the phase.
5. **Playtest keeps bypassing both libraries** with an ephemeral save.

## 1. Goal

Enforce the project/save boundary that Phases 6–10 have deferred to this phase; build the local storage layer; build playthroughs and unlimited saves; build the Launcher, the libraries, character creation, the in-game menu, and input binding.

## 2. Non-goals

- **Accounts, publishing, discovery, cloud sync, version reconciliation** — Stage 2. `projectVersionId` is written from day one (§4.4) but nothing reconciles it.
- **The World Map screen** — Phase 15. The menu ships the entry, disabled, with a tooltip rather than a lie.
- ~~**Audio playback**~~ — *superseded: F Phase 3 ships the mixer, and the volume sliders are live (§R.5).*
- **Quests, achievements, statistics screens** — unowned, and not silently absorbed here. *(Permadeath was previously listed as a flagged non-request; it is now in scope — §5.1.)*
- **Controller and touch input** — the binding model is device-agnostic on purpose (§9), but only keyboard and mouse ship.

---

> ⚠ **Superseded — F enforces the boundary; there is no `Project.player` (§R.1).**

## 3. The boundary — why this phase is Extra High

Two laws from the data architecture:

> **1. A project never contains player state. 2. A save never contains authored data.**

Both are violated today. `Project.player: PlayerSprite` holds a live `StatBlock`, and Phases 6–10 added `inventory`, `wallet`, `loadout`, and `knownSkills` to `CombatantBase`. Phase 5.5 put an `@deprecated` note on the field and declared the law; **this phase enforces it.**

```
DELETED       Project.player: PlayerSprite

AUTHORED      project.characterPresets: CharacterPresetDef[]     // the roster
              project.characterCreation: CharacterCreationRules  // the flow's config

PLAYED        SaveState.character                                // one player's run
```

**Enemy definitions are unaffected.** A `HumanEnemyDef` keeps authoring `stats`, `loadout`, and inventory, because an enemy's gear *is* authored content — it is the loot you get for killing him. The asymmetry is deliberate and worth stating: **authored combatants own their state; the player's state is owned by the save.**

**Consequence for the editor.** Placing "the player" on a map no longer means placing a fully-statted entity. It places a **spawn marker** — a position, a facing, and nothing else. Which map's marker is used is `project.startMapId` (Phase 5.5). Character creation supplies everything else at runtime.

---

> ⚠ **Superseded — F ships the stores; Phase 11 adds `playthroughs` (§R.2).**

## 4. Storage — the IndexedDB layer

### 4.1 Stores

```
lorebrix (IndexedDB)
  projects       key: projectId          → the Tier 1 document (blobs inline, Phase 5.5)
  playthroughs   key: playthroughId      → index: projectId
  saveMeta       key: saveId             → indexes: [playthroughId, updatedAt], projectId
  saveData       key: saveId             → the heavy SaveState body
  prefs          key: 'user'             → UserPreferences (§9)
```

**Why `saveMeta` and `saveData` are separate stores.** This falls directly out of unlimited saves. A save body carries inventory, world deltas, variables, and active effects — tens of kilobytes each. With three slots, one store is fine. With four hundred saves, rendering the browser screen would deserialize tens of megabytes to display names and timestamps. Splitting them means the list reads a few hundred bytes per row and the body is fetched only on load. **This is the difference between a save screen that opens instantly and one that hangs.**

### 4.2 Adapters

Siblings of Phase 5.5's `BlobStore`, same discipline — an interface Stage 2 reimplements without touching a caller:

```ts
interface ProjectStore {
  list(): Promise<ProjectSummary[]>;      // id, title, cover, updatedAt, mapCount
  get(id): Promise<Project>;
  put(p: Project): Promise<void>;
  delete(id): Promise<void>;
  import(file: File): Promise<ProjectSummary>;   // .lorebrix → a cartridge on the shelf
  export(id): Promise<Blob>;
}

interface SaveStore {
  listPlaythroughs(projectId): Promise<Playthrough[]>;
  listSaves(playthroughId): Promise<SaveMeta[]>;
  load(saveId): Promise<SaveState>;
  create(meta: SaveMeta, state: SaveState): Promise<SaveId>;
  overwrite(saveId, state: SaveState): Promise<void>;
  rename(saveId, name): Promise<void>;
  delete(saveId): Promise<void>;
  deletePlaythrough(playthroughId): Promise<void>;
  usage(): Promise<{ bytes: number; quota: number }>;
}
```

`usage()` exists because unlimited saves are unlimited until the browser says otherwise. Options surfaces it (§13.6) rather than letting a quota error surprise someone forty hours in.

### 4.3 Ownership note

This layer lands **here, not in Phase 5.5.** Phase 5.5's strongest asset is its claim of zero behavior change verified by 88 unmodified tests; swapping the persistence layer would have destroyed it.

### 4.4 Version pinning — written, not reconciled

`SaveMeta.projectVersionId` is populated from day one. In Stage 1 it is always the project's current id and nothing reads it. **Adding the field later would migrate every save**, which is why it exists now; **building reconciliation now would be a system with nothing to reconcile**, which is why it doesn't.

---

## 5. Playthroughs — the structural answer to unlimited saves

Console memory cards had three slots because the card held 128KB. Removing the limit removes the reason for the grid, but it does not remove the problem the grid was solving: **a player with 300 saves needs to find one.** A flat reverse-chronological list is a log file, not a UI.

The hierarchy people actually play in is:

```
GAME  (cartridge)
 └── PLAYTHROUGH  (a character — "my mage run", "the ironman attempt")
      └── SAVES   (a timeline)
```

Every **New Game** creates a Playthrough. Every save belongs to exactly one. That single middle tier turns "300 saves" into "four runs, each with a timeline," and it is how players already think — nobody hunts for save #147, they think *"my mage run, just before the boss."*

```ts
interface Playthrough {
  id: UUID;
  projectId: UUID;
  characterName: string;          // immutable — the run's identity
  gender: 'male' | 'female';
  presetId: UUID;
  startedAt: string;
  lastPlayedAt: string;
  totalPlaytimeMs: number;
  latestSaveId: UUID;             // what Continue loads
  completed?: boolean;            // set when a win condition fires — a nice shelf badge

  // ── PERMADEATH (§5.1) ────────────────────────────────────
  permadeath: boolean;            // frozen at creation. Never editable afterward —
                                  // a toggleable ironman run is not an ironman run.
  dead?: boolean;                 // set when death fires under permadeath
  diedAt?: string;
  causeOfDeath?: string;          // "slain by a Plated Knight in Emberfall Cavern"
}
```

Level, location, and progress are **derived from the latest save**, never stored here — the same discipline as Phase 6's derived stats, for the same reason: a duplicated number goes stale.

**Continue** is the top-level action: newest `lastPlayedAt` across all playthroughs, one tap, no navigation. Most sessions never see the browser at all.

### 5.1 Permadeath — one boolean, three careful details

Roguelike support, and cheap **only if it is built now**: permadeath changes what death *means*, so retrofitting it means revisiting the death path, the save path, the browser, and the character-creation flow all at once.

**Authored, then frozen.** The project declares what it allows; the player chooses at character creation if allowed; the choice is frozen for the run's lifetime.

```ts
// project.characterCreation
permadeath: 'disabled' | 'optional' | 'forced';   // default 'disabled'
```

`'disabled'` never mentions it. `'optional'` offers a toggle at creation. `'forced'` is a roguelike — every run is ironman, and creation states that rather than hiding it.

**`permadeath` is frozen at creation and never editable.** A run you can switch off ironman halfway through is not an ironman run, and offering the toggle later would quietly destroy the only thing the feature is for.

**On death under permadeath — the run is retired, not erased:**

1. All of the playthrough's saves are deleted.
2. The `Playthrough` row **survives**, with `dead: true`, `diedAt`, and `causeOfDeath`.
3. It renders in the browser as a tombstone: name, level reached, playtime, cause. Read-only, no Continue.
4. Deleting the tombstone is a separate, explicit player action.

Keeping the record is the whole point. A roguelike death is a *result*, and a run that vanishes without trace feels like data loss rather than a loss. It also costs almost nothing — the saves, which were the bulk, are gone; a few hundred bytes of epitaph remain.

**Three guards worth naming, because each is a way this feature betrays a player if missed:**

- **Quicksave and autosave are disabled** under permadeath. Otherwise the entire mechanic is defeated by one keystroke, which is precisely the save-scumming it exists to prevent. `autosaveKeep` is ignored for these runs.
- **Manual save still works** — it is a *stopping point*, not a checkpoint. Under permadeath a manual save is **consumed on load**: loading it deletes it, so it can suspend a session but never rewind one. This is the standard ironman contract and it is what lets someone play a forty-hour permadeath run across several days without cheating.
- **Death is irreversible and gets a real confirmation on entry, not on death.** The creation screen states the terms plainly. A confirmation dialog *at the moment of death* would be absurd.

---

> ⚠ **Superseded — the body is F's `SaveState`; see the field map in §R.3.**

## 6. `SaveState`

```ts
interface SaveMeta {                 // small, listed, indexed
  id: UUID;
  projectId: UUID;
  playthroughId: UUID;
  projectVersionId: UUID;            // §4.4
  saveSchemaVersion: 1;
  kind: 'manual' | 'auto' | 'quick';
  name: string;                      // auto-generated, user-renamable (§7.2)
  createdAt: string;
  updatedAt: string;
  playtimeMs: number;          // Phase 14 A4: this is SIMULATION time — paused menus
                               // do not count. Same number as SaveState.clock.elapsedMs.
  characterName: string;
  level: number;
  locationName: string;              // the map's display name
  thumbnail?: string;                // 160×90 JPEG data URL, ~8KB (§7.3)
}

interface SaveState {                // the heavy body
  character: {
    name: string;
    gender: 'male' | 'female';
    presetId: UUID;
    stats: StatBlock;                // attributes + CURRENT hp/mana/stamina + flat
    level: number;
    exp: number;
    unspentPoints: number;
    loadout: Loadout;                // slot → equipmentDefId. IDs only.
    inventory: InventoryStack[];
    wallet: Wallet;
    knownSkills: UUID[];
    hotbar: HotbarSlot[];            // §10
  };

  location: { mapId: UUID; pos: Vec2; facing: Direction };

  world: {                           // DELTAS ONLY. Never copies of authored data.
    defeatedEntityIds: UUID[];
    lootedContainerIds: UUID[];
    takenPickupIds: UUID[];
    destroyedDoodads: { id: UUID; respawnAtMs?: number }[];
    unlockedDoorIds: UUID[];
    firedOnceTriggerIds: UUID[];

    /** §6.1 — an NPC provoked into hostility stays provoked across a reload. */
    factionOverrides: Record<UUID, FactionId>;

    /** §6.2 — per-shop stock, only for shops that track it. */
    shopStates: Record<UUID, ShopState>;
  };

  variables: Record<string, boolean | number | string>;   // save-scoped only (Phase 12)

  /** Phase 14 §9 A4. The ONE elapsed clock — game time is derived from it. */
  clock: { elapsedMs: number };
  discovered: { mapIds: UUID[]; worldMapNodeIds: UUID[]; fastTravelNodeIds: UUID[] };

  activeEffects: SerializedActiveEffect[];   // Phase 10 §7 — with remaining durations
  cooldowns: Record<UUID, number>;           // skillId/itemId → remaining ms
}
```

**Everything in `world` is a delta, not a copy.** That is what lets a creator rebalance a game without breaking a save in flight: nothing here says *what* an enemy is, only *that this player killed it*. `factionOverrides` and `shopStates` follow the same rule — they record what *changed*, keyed by authored id, never the authored thing itself.

### 6.1 Faction overrides

Phase 10 §5.6 made `faction` authored data on `CombatantBase`, and Phase 13 adds incite-to-fight. Without this field, provoking an NPC, saving, and reloading gives you a friendly NPC again — a bug a player would read as the game forgetting what they did.

```ts
factionOverrides: Record<UUID, FactionId>;   // entityId → the faction it is NOW
```

One entry per entity whose faction has changed from its authored value. Absent means unchanged, so a save carries nothing for the overwhelming majority of NPCs. Phase 13 writes it; Phase 11 stores and restores it. On load, any override whose entity no longer exists is dropped silently — same reconciliation rule as every other delta.

### 6.2 Shop stock — three modes, per E

A shop's stocking behavior is **authored per shop**, so a creator can mix a village smith who runs out with a city bazaar that never does.

```ts
// ShopDef (authored, Phase 8's shop record gains this)
stockMode: 'infinite' | 'finite' | 'restocking';
restockIntervalMs?: number;        // 'restocking' only
restockToInitial?: boolean;        // true = back to full; false = +1 per interval

// SaveState.world.shopStates[shopId] — written ONLY for finite and restocking shops
interface ShopState {
  quantities: Record<UUID, number>;   // itemDefId → units remaining
  lastRestockAtMs: number;
}
```

| mode | behavior | save cost |
|---|---|---|
| **infinite** | Buy the last sword, there is another. The classic JRPG shop. | **nothing** — no `ShopState` is ever written |
| **finite** | Stock depletes and stays depleted. Scarcity is real. | one entry |
| **restocking** | Depletes, then refills on a timer. | one entry |

**Infinite writes nothing at all**, which matters: most shops in most games are infinite, and a save should not carry a stock table for every merchant in the world just to say "unchanged."

**Selling to a shop adds to its stock** under `finite` and `restocking` — you can sell a sword and buy it back. Under `infinite` the sale is accepted and the item vanishes, because tracking stock for a shop that has infinite stock is a contradiction.

**`restockIntervalMs` is elapsed play time, not wall-clock**, for the same reason Phase 13's doodad respawn is: LoreBrix has no clock until Phase 14. When Phase 14 lands, a shop can additionally restock at a time of day — additive, no migration, because `lastRestockAtMs` is already the anchor.

**Discarded on save, deliberately:** projectiles in flight and an in-progress cast windup. Both are sub-second state; persisting them means a save can restore mid-swing into a world that no longer has the target.

---

## 7. Save kinds and policy

### 7.1 Three kinds, one unlimited

| kind | policy |
|---|---|
| **manual** | **Unlimited, per E.** Never auto-pruned. The player owns these. |
| **auto** | Rolling window per playthrough, default **3**, oldest evicted. Written on map transition and on level-up. |
| **quick** | Exactly one per playthrough, overwritten. Bound to an input action. |

**Under permadeath (§5.1) this table changes:** auto and quick are disabled entirely, and a manual save is **consumed on load** — it suspends a session, it never rewinds one.

**The one nuance worth flagging rather than burying:** "do not limit the saves" is implemented for **manual** saves. Autosaves roll, because an autosave every map transition across a forty-hour run is four hundred rows the player never asked for, drowning the saves they did ask for. The rolling window is a `StatRules`-style tunable (`autosaveKeep`, default 3, `0` disables autosaving entirely). **If you want autosaves unlimited too, it is one number — say so and it changes.**

### 7.2 Naming

Auto-generated on creation, always renamable: `"Lv 12 · Emberfall Meadow · 4h 22m"`. Autosaves prefix `[Auto]`, quicksaves `[Quick]`. The generated name carries the three things a player scans for, so most saves never need renaming — and the ones that matter ("before the point of no return") can be.

> ⚠ **Superseded — captured via the renderer, §R.7.**

### 7.3 Thumbnails

A 160×90 JPEG grabbed from the canvas at save time via the existing `exportPNG` path, downscaled. Roughly 8KB. Not optional — with unlimited saves, a picture is what makes a list scannable. When capture fails, the row falls back to the map's tile palette as a color block rather than an empty box.

---

## 8. Character creation

Driven entirely by `project.characterCreation` (Phase 5.5 reserved it; this phase gives it behavior):

```
gender  →  preset (sprite + matching portrait)  →  name  →  [attributes]  →  begin
```

- **Gender** filters the preset roster. Both `CharacterPresetDef.gender` and the portrait come from the project, so a creator who wants one gender ships one set.
- **Preset** is the "sprite and a matching face" from the original brief. The picker shows the sprite animating in idle and the portrait beside it.
- **Name** defaults to **Elms** (male) or **Chels** (female), overridable by `characterCreation.defaultNames`, and editable unless `allowNameEntry: false`.
- **Permadeath** appears as a toggle only when `characterCreation.permadeath` is `'optional'`, and as a stated condition when it is `'forced'` (§5.1). The terms are shown here, at the one moment consent is meaningful.
- **Attributes** appear only when `allowAttributeAllocation` is true, spending `startingPoints` across STR/AGI/INT with a live derived-stats readout — the same readout Phase 6's StatRules panel already renders.
- **Begin** creates the Playthrough, seeds `SaveState.character` from the preset's `startingLoadout` / `startingInventory` / `startingWallet` / `startingSkills`, seeds current pools to derived maxima, places the player at `startMapId`'s spawn marker, and writes save #1.

When `characterCreation.enabled` is false the whole screen is skipped and preset `offeredPresetIds[0]` is used silently — a creator with one fixed protagonist gets no ceremony.

---

> ⚠ **Superseded — F ships `InputActionDef` and `InputFrame`; Phase 11 adds context, rebinding, and hotbar roles (§R.4).**

## 9. Input actions and key bindings

**Two halves in two tiers**, which is the whole design:

```ts
// AUTHORED (project) — what actions exist
interface InputActionDef {
  id: string;                 // 'attack' | 'block' | 'interact' | 'hotbar1' | custom
  name: string;
  builtin: boolean;           // engine actions cannot be deleted
  context: 'world' | 'menu' | 'both';
  suggestedKeys: string[];
}

// USER PREFERENCES (Tier 0, local in Stage 1) — what keys fire them
interface UserPreferences {
  bindings: Record<string, string[]>;     // actionId → KeyboardEvent.code[]
  hexMovementScheme: 'qweadz' | 'numpad';
  volumes: { master: number; music: number; sfx: number };   // reserved, no-op mixer
  reducedMotion: boolean;
}
```

**A creator does not own your keyboard.** Bindings persist across every project on that machine, which is why they are prefs and not project data.

**`KeyboardEvent.code`, never `.key`.** `code` is physical-position based, so WASD stays under the same fingers on AZERTY and Dvorak. Using `.key` would silently break every non-QWERTY layout — a bug that never reproduces on the developer's machine.

The binding screen detects conflicts and shows them inline rather than refusing the input; two actions in different `context`s may legitimately share a key.

---

## 10. The hotbar — the orphaned seam, closed

Phase 10 provides `cast(skillId, aim)`. Nothing decided which key fires it. Assigned here, explicitly, so it does not fall between the two phases:

```ts
type HotbarSlot = { kind: 'skill' | 'item'; id: UUID } | null;
// SaveState.character.hotbar: HotbarSlot[]   — 8 slots
```

Eight slots, bound to actions `hotbar1`…`hotbar8`. Skills and items share the bar because both are "things you trigger in combat," and forcing a player to remember which bar a health potion lives on is friction with no upside. Assignment happens by drag from the Spells or Inventory screen.

---

## 11. The in-game menu — and an honest reuse audit

Tabs: **Character · Inventory · Spells · Map · Journal · Save · Options · Exit.**

Phases 7, 8, and 10 each promised their creator-facing panel would be "reused verbatim" as the player-facing screen. **That promise has a condition none of those documents stated**, and it comes due here:

> Those panels were built against **editor state and authored definitions**. To be reused they must accept a live `CombatantEntity` and a read-only mode — the player can equip and use, but not edit the definition behind the item.

If that parameterization was not built in during Phases 7–10, Phase 11 inherits three rewrites instead of three reuses. **This is the single largest schedule risk in the phase**, and it is cheap to prevent: each of those phases should take an entity-or-def source rather than reaching for editor state directly. Worth a specific check at each implementation review rather than discovering it here.

- **Character** — Phase 7's paper-doll, plus level/EXP/unspent points and `allocatePoint` (Phase 9 built the backend, this is its UI).
- **Inventory** — Phase 8's tabbed panel, plus use/drop and hotbar assignment.
- **Spells** — Phase 10's list, filtered into Spells and Abilities, plus hotbar assignment.
- **Map** — **disabled with a tooltip until Phase 15.** A disabled control that explains itself is honest; a control that opens an empty screen is not.
- **Journal** — **disabled with a tooltip until Phase 13.5**, for the same reason. Shipping the entry now means the menu's shape is settled once rather than twice.
- **Save** — creates a manual save into the current playthrough. **Available during dialogue too** (Phase 13 §13 G3): dialogue position is not serialized, and Phase 13's entry points make resumption graceful, so there is no reason to restrict it.
- **Options** — bindings, volumes, storage usage.
- **Exit** — returns to the Launcher, warning if progress is unsaved.

---

> ⚠ **Superseded — nothing to delete; F playtest is already ephemeral (§R.6).**

## 12. Playtest — a deletion, not an addition

Phase 5's playtest snapshots the whole project and restores it on exit, so testing cannot corrupt authored work. **Once the boundary lands (§3), that machinery is unnecessary** — play cannot write to the project, because the player's state lives in a save.

So playtest becomes: create an **ephemeral Playthrough and `SaveState` in memory**, run, discard on exit. Nothing touches IndexedDB, nothing touches the project.

Two things fall out. The snapshot/restore code is **deleted**, not maintained. And the save system is exercised on every single playtest during development rather than first meeting real use at ship — which is exactly where save bugs like to hide.

---

## 12.5 Destructive actions — name the number

Deleting a game deletes its saves. Orphaned saves pointing at a missing cartridge are worse than a clear destructive confirmation, so the cascade is deliberate — and the dialog **states the count**, because "are you sure?" carries no information and people click through it by reflex:

> **Delete "Emberfall"?**
> This will also delete **3 playthroughs** and **47 saves**, including **2 completed runs**. This cannot be undone.
> *[Cancel] [Delete game and 47 saves]*

Rules that make the warning trustworthy:

- **Counts are real**, read from `saveMeta` at dialog open — never estimated, never cached.
- **The confirm button repeats the number.** A button reading "Delete game and 47 saves" is materially harder to misread than one reading "Delete."
- **Zero-state honesty:** with nothing to lose the dialog says so — *"This game has no saves."* — rather than performing gravity it hasn't earned.
- **Completed and permadeath runs are called out by name**, because those are the ones a player would actually mourn.
- **Same pattern, smaller scope, for deleting a playthrough:** *"Delete 'Chels the Bold'? This will delete 12 saves."*
- **Export first.** The dialog offers exporting the project before deleting. It is one button and it turns an irreversible action into a recoverable one.

## 13. Screens and routing

```
/                       Launcher — two doors
/play                   Game Library      (cartridge shelf)
/play/:projectId        Save Browser      (playthroughs → saves)
/play/:projectId/new    Character Creation
/play/:projectId/run    The running game  (menu overlays here)
/create                 Project Library
/create/:projectId      The editor        (existing three-panel app)
/options                Bindings, volumes, storage
```

Deep-linkable, and the editor's existing route is unchanged — it gains a shelf in front of it, it does not move.

---

## 14. Build order

**11A — Data, storage, and the boundary.** No new screens.
`Project.player` deleted · `characterPresets` + `characterCreation` given behavior · spawn markers · the five IndexedDB stores and their adapters · `Playthrough` · `SaveMeta` / `SaveState` · save create/load/overwrite/rename/delete · autosave rolling window · thumbnails · `UserPreferences` and the binding resolver · hotbar data · playtest rewritten onto the ephemeral save and snapshot/restore deleted.

**Verifiable without any UI**, via runtime tests. That is the point of the split: the risky half is provable before a single pixel exists.

**11B — The shell.** Launcher · Game Library · Save Browser · Character Creation · in-game Menu · Options. This is the half that goes to Lovable (§17).

If work stops between chunks, the engine is coherent and the editor still runs; only the front door is missing.

---

## 15. Testing

- **★ The boundary holds:** playing a game — moving, fighting, looting, leveling, equipping — leaves the project document **byte-identical**. This is the phase's central claim and its central test.
- **★ Round-trip fidelity:** save → quit → load restores a byte-identical world state: position, pools, inventory, wallet, loadout, known skills, hotbar, variables, deltas, active effects with correct remaining durations, and cooldowns.
- **★ One clock:** `SaveState.clock.elapsedMs` round-trips; game time re-derives from it rather than being stored; changing `msPerGameDay` after a save re-derives instead of corrupting.
- **Cooldowns survive:** saving and reloading does not reset a cooldown. (Save-scumming out of cooldowns is found within an hour otherwise.)
- **Deltas, not copies:** a save references a defeated enemy by id; editing that enemy's stats afterward and reloading does not resurrect or alter it.
- **★ Faction overrides persist:** an NPC whose faction is changed at runtime is still changed after save → quit → load; an override pointing at a deleted entity is dropped on load without error; an unprovoked world writes an empty map.
- **★ Shop stock, all three modes:** an `infinite` shop writes **no** `ShopState` and never runs out; a `finite` shop's depletion survives a reload; a `restocking` shop refills after `restockIntervalMs` of elapsed play and not before. Selling into a finite shop increases its stock; selling into an infinite shop is accepted and stores nothing.
- **Playthrough grouping:** three New Games on one project produce three playthroughs; saves land in the right one; deleting a playthrough deletes only its saves.
- **★ Permadeath contract:** with `permadeath: true`, quicksave and autosave are refused; death deletes every save in that playthrough; the `Playthrough` row survives with `dead`, `diedAt`, and `causeOfDeath`; Continue is unavailable for it; other playthroughs on the same project are untouched.
- **Permadeath manual save is consumed on load:** saving, quitting, and loading leaves zero saves in that playthrough — the run continues but cannot be rewound.
- **Permadeath is frozen:** no API path sets `permadeath` on an existing playthrough; `'forced'` projects create only permadeath runs; `'disabled'` projects never offer it.
- **Deletion counts are accurate:** the confirmation reports the exact number of playthroughs and saves that `saveMeta` holds, and after confirming, that many records are gone and no orphan `saveData` row remains.
- **★ Unlimited manual saves:** 500 manual saves in one playthrough all persist and list correctly, and the browser renders from `saveMeta` **without reading a single `saveData` record** (assert via a spy on the data store).
- **Autosave window:** with `autosaveKeep: 3`, a fourth autosave evicts the oldest and **never evicts a manual save**; `autosaveKeep: 0` disables autosaving.
- **Quicksave:** always exactly one per playthrough; the second overwrites the first.
- **Character creation:** the created character matches its preset's starting loadout, inventory, wallet, and skills; pools seed to derived maxima *including* gear; `enabled: false` skips the screen entirely.
- **Bindings:** rebinding persists across a project switch; `code`-based bindings put WASD in the same physical position on a simulated AZERTY layout; conflicts are reported, not silently swallowed.
- **Playtest isolation:** a playtest session writes **zero** records to IndexedDB and leaves the project untouched.
- **Storage:** `usage()` reports growth as saves are added; deleting a playthrough reclaims it.
- **Two doors, one record:** editing a project from the CREATE door and then opening it from the PLAY door reflects the edit — there is one row, not two.
- **Import:** a `.lorebrix` file lands on the shelf and is immediately playable.

---

## 16. Decisions locked

- **The boundary is enforced.** `Project.player` is deleted; authored presets and rules replace it; player state lives in the save. Enemy defs keep authoring their own state — authored combatants own their state, the player's is owned by the save.
- **IndexedDB, five stores**, with `saveMeta` split from `saveData` so an unlimited save list renders instantly.
- **Playthrough is the middle tier.** Game → Playthrough → Saves. This is what makes unlimited saves navigable.
- **Manual saves are unlimited. Autosaves roll (default 3, tunable, 0 disables) — unbounded autosaves are a memory-growth problem, not merely a UI one. Quicksave is one, overwritten.**
- **Permadeath is authored (`disabled | optional | forced`), chosen at creation, and frozen for the run.** Death retires the run to a tombstone rather than erasing it; auto and quick saves are disabled; a manual save is consumed on load.
- **Destructive dialogs state real counts** and repeat the number on the confirm button, and offer export first.
- **A game and a project are one record, two doors.**
- **Bindings are Tier 0 user preferences keyed on `KeyboardEvent.code`**, not project data.
- **The hotbar is eight mixed skill/item slots**, stored on the save.
- **Map and Journal are disabled with tooltips** until Phases 15 and 13.5 respectively — the menu's shape is settled once.
- **Playtest runs on an ephemeral save; snapshot/restore is deleted.**
- **`projectVersionId` is written, not reconciled** — Stage 2 owns reconciliation.
- **`factionOverrides` and `shopStates` are part of `world`.** Both are deltas keyed by authored id. Shops are authored `infinite | finite | restocking`; infinite shops write nothing to the save.
- **Ships as 11A (data, provable without UI) and 11B (the shell).**

---

> ⚠ **Superseded — two data corrections in §R.9.**

## 17. Lovable brief — 11B

**Budget: 27 credits.** Six screens. Suggested split: 4 credits each on the first three, 3 each on the rest, ~6 held in reserve for iteration. If credits run short, the first three are the ones that matter — they are the entire first impression of the product.

**The single rule: do not invent fields.** Every screen below lists exactly what data exists. If a design needs something not on that list, it needs a schema change, which means it needs a conversation first. The Phase 6–10 round went the other way and produced screens for systems that did not exist.

**Design language is already established** — the v0.5 studio mockup is the reference, not a starting point to redo. Reuse its vocabulary: parchment/cream ground, ink-green editorial serif for display, Inter for UI, frosted glass panels, gold gradient for the single primary action per screen, dark "stage" panels for anything cinematic, the thin status bar. The launcher and libraries should feel like **the same product as that editor**, seen before you enter it.

### Priority 1 — Launcher (`/`)
The front door, and the first thing anyone ever sees. Two large choices: **PLAY** and **CREATE**. Below them, a **Continue** affordance when a most-recent playthrough exists: character name, game title, level, location, playtime, thumbnail — one tap back into the run.
*Data:* `{ title, coverImage?, characterName, level, locationName, playtimeMs, thumbnail }`.
*States:* first run (no games, no continue), returning player, many games.
*Reference:* the two doors want the weight of the editor's dark stage panels; Continue is a wide glass chip.

### Priority 2 — Game Library (`/play`)
The cartridge shelf. A grid of games with cover, title, tagline, last-played, and a completion badge where a playthrough finished. Per-card secondary action: **Edit this game** — the two-doors point made visible. A prominent **Import `.lorebrix`** affordance.
*Data per card:* `{ id, title, tagline?, coverImage?, updatedAt, playthroughCount, lastPlayedAt?, completed? }`.
*States:* empty shelf (this is the screen that has to sell importing or creating), 1 game, 40 games, missing cover art, **and the delete-confirmation dialog** — it names real counts (§12.5), so design it to carry a number legibly rather than as a generic "are you sure?" box.

### Priority 3 — Save Browser (`/play/:projectId`)
**The hardest screen, and the one worth the most care.** Unlimited saves, grouped by playthrough. Playthroughs as expandable sections — portrait, character name, level, playtime, last played, a Continue action, an overflow for rename/delete. Inside each, a save timeline: thumbnail, name, level, location, playtime, timestamp, and a kind marker distinguishing manual from `[Auto]` and `[Quick]`.
*Data:* `Playthrough[]` and `SaveMeta[]` exactly as specified in §5 and §6.
*States:* one playthrough / several, a playthrough with 3 saves and one with 300 (it must stay scannable — think about scroll, sticky headers, and density), a missing thumbnail, a brand-new game with no saves at all, and **a dead permadeath run rendered as a tombstone** (read-only, no Continue, showing level reached, playtime, and cause of death — it should feel like a memorial, not an error state).
*Reference:* the save row is close to the editor's numbered patrol-route rows; the playthrough header echoes the Inspector's portrait-plus-badge header.

### Priority 4 — Character Creation (`/play/:projectId/new`)
Four steps, ideally one screen rather than a wizard: gender → preset → name → optional attributes. The preset picker shows the animated sprite and its matching portrait together. Attributes only appear when the project enables them, with a live derived-stats readout.
*Data:* `CharacterPresetDef[]` (`name, gender, spritesheetId, portraitAssetId, baseAttributes`), `CharacterCreationRules` (`allowNameEntry, defaultNames, allowAttributeAllocation, startingPoints`).
*States:* many presets vs. two, attributes on vs. off, name entry locked, **permadeath optional (a toggle whose terms are stated plainly) vs. forced (a condition, not a choice)**.

### Priority 5 — In-Game Menu (overlay on `/play/:projectId/run`)
An overlay, not a page — the world stays visible behind glass. Seven entries: Character, Inventory, Spells, Map *(disabled, with a tooltip)*, Save, Options, Exit. **Design the chrome — the frame, tabs, transitions, and the disabled state — not the panel contents**, which are Phases 7, 8, and 10's panels dropped in.
*States:* Map disabled, unsaved-progress warning on Exit.

### Priority 6 — Options (`/options`)
Key bindings as the main event: a table of actions with their bound keys, a click-to-rebind interaction, visible conflict warnings, reset-to-defaults. Plus volume sliders (currently inert) and a storage-usage readout with a way to reclaim space.
*Data:* `InputActionDef[]`, `UserPreferences`, `{ bytes, quota }`.
*States:* a conflict, a rebind in progress ("press a key…"), storage near quota.

**Cross-cutting:** every screen needs an empty state and a loading state, and both deserve as much care as the populated one — a new user sees the empty state first. Keyboard navigation matters more than usual here, because this is a game launcher and a controller-shaped mental model is the right instinct even though only keyboard ships.

---

## 18. Amendments elsewhere

1. **Phase 5.5** — the `@deprecated` note on `Project.player` is discharged here; the field is deleted.
2. **Phases 7, 8, 10** — the "reused verbatim in Phase 11" promise needs the parameterization in §11. Check at each implementation review, not here.
3. **Phase 9** — `allocatePoint` gets its UI on the Character screen, as that phase anticipated.
3b. **Phase 8** — `ShopDef` gains `stockMode`, `restockIntervalMs`, and `restockToInitial` (§6.2). Authored fields; Phase 13 builds the shop UI that spends them.
3c. **Phase 13** — writes `factionOverrides` when an NPC is provoked, and `shopStates` on purchase and sale. Phase 11 owns storing and restoring both.
4. **Phase 12** — save-scoped variables are serialized by this phase; Phase 12 owns the registry, editor, and trigger vocabulary. The ordering works because Phase 5.5 defined the type.
5. **Phase 15** — the Map menu entry is built here, disabled; Phase 15 enables it.
5b. **Phase 13.5** — the Journal menu entry is built here, disabled; Phase 13.5 enables it.
6. **ROADMAP** — Phase 11's status moves to designed.

## 19. Open questions

1. ~~**Autosave window**~~ — **ANSWERED: rolls at 3.** E's reasoning, recorded because it is the right reason: unbounded autosaves are a memory-growth problem, not just a UI one. Manual saves stay unlimited.
2. ~~**Does deleting a game delete its saves?**~~ — **ANSWERED: yes, cascading, with the count named.** §12.5.
3. ~~**Permadeath support?**~~ — **ANSWERED: yes, build it.** §5.1. Confirmed early, which is the only time it is cheap.

**Nothing outstanding for E in this document.**

---

*LoreBrix, ELMSCORP. Phase 11 design — for review.*
