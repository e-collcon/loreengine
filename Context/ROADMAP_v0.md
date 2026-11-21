# LoreBrix — Development Roadmap v0 (FROZEN)

> **Frozen snapshot — do not edit.** This is the roadmap as it stood immediately before the foundation rewrite, preserved verbatim below this notice.
>
> **Superseded by the Roadmap** (`ROADMAP.md`), which redesigns Phases 1–5 from scratch under three decisions made after this snapshot:
> 1. **Turn-based stays in the engine.** E's first game is real-time action and will not use it; the engine still supports it.
> 2. **Entities use composition**, not the `BaseEntity → CombatantEntity → PlayerEntity / NPCEntity` class hierarchy.
> 3. **The codebase is rebuilt greenfield**, porting only verified pure modules (hex math, A\*, spatial hash) with their tests.
>
> **Numbering note:** this version uses decimal phases (5.5, 13.5, 20.5). The Roadmap uses integers only, and carries a v0-to-current mapping table so every old reference stays traceable.

---

**Supersedes:** the 8-phase plan from the original Zelda-arc planning session
**Revised because:** the Phase 6–10 design pass, the reconciliation pass, the data architecture proposal, and the Phase 10 gap analysis surfaced four systems with no owner — a faction model, a world clock, combat staging, and a variables/constants registry — plus a set of container-level schema changes that shouldn't be smuggled into a stat phase.
**Implementation model:** Opus 5 Max throughout. Effort level noted per phase.

### The three stages

**Every phase on this roadmap is Stage 1.**

| Stage | What it is |
|---|---|
| **Stage 1** | **Phases 1–20.5.** The core local engine. No server, no accounts. IndexedDB plus file export/import. |
| **Stage 2** | **Phases 21–23.** Engine expansion — traversal, weather, economy. Still local. **This is where LoreBrix becomes a finished game engine.** |
| **Stage 3** | **Phases 24–30.** The platform for *other* developers — localization, accounts, hosting, publishing, discovery, moderation, mobile. |

**Why this order (E's restructure).** Engine before platform means LoreBrix is complete as an engine for E's own game before any platform work begins — so the platform becomes optional rather than a prerequisite. If the engine ships a game and the platform never gets built, nothing in Stages 1–2 was wasted.

This matters because several designs specify Stage 3 shapes so that Stage 1's local structures are the ones a server can adopt without restructuring. Where a document describes a server table or a version-pinning rule, it is **specifying, not scheduling**. The appendix marks which unowned items belong to which stage.
**Standing law:** design doc → E approves → implement in verified chunks → strict `tsc --noEmit` + production build + targeted runtime tests → next phase.

---

## 0. Shape of the thing

```
SHIPPED ──────────────────────────────────────────────
  1  Architecture & Data Models          ✅ built
  2  Tile Engine                          ✅ built
  3  Entity System                        ✅ built
  4  Gameplay Rules Editor                ✅ built
  5  Integration & Play Test              ✅ built   ← v0.6.0 live today

FOUNDATION ───────────────────────────────────────────
  5.5 Schema v2 Consolidation             📐 designed (v2) ← START HERE

COMBAT & CONTENT ─────────────────────────────────────
  6  Core Stat System                     📐 designed (v4)
  7  Equipment, Damage & Immunity         📐 designed (v4)
  8  Items, Currency & Inventory          📐 designed (v6)
  9  Enemy Database, Resistance & Loot    📐 designed (v4)
  10 Spells, Abilities & Delivery         📐 designed (v5)
       10A instant delivery · 10B projectiles

RUNTIME ──────────────────────────────────────────────
  11 Runtime Shell & Save State           📐 designed
  12 Events, Constants, Variables & Flags 📐 designed (v7) ← NEW
  13 Dialogue, Shops & World Interaction  📐 designed
  13.5 Quests & Journal                   📐 designed    ← NEW
  14 World Clock, Calendar & Rest         📐 designed    ← NEW
  15 World Map & Fast Travel              📐 needs doc

EXPANSION ────────────────────────────────────────────
  16 Combat Staging + non-lethal defeat   📐 needs doc
  17 TEA — Skill-Based Progression        📐 needs doc   (unblocked by 10)
  18 Faction Relations, Standing & Fire   📐 needs doc   ← matrix + friendly fire
  19 Audio Playback                       📐 needs doc
  20 NPC Schedules & Crowds               📐 needs doc
  20.5 Companions & Followers             📐 needs doc

STAGE 2 — ENGINE EXPANSION ───────────────────────────
  21 Traversal, Mounts & Vehicles         📐 needs doc   ← NEW
  22 Weather & Seasonal Terrain           📐 needs doc   ← moved in
  23 Economy & Trade                      📐 needs doc   ← moved in

STAGE 3 — PLATFORM FOR OTHER DEVELOPERS ──────────────
  24 Localization                         📐 needs doc   ← earliest, per E
  25 Accounts & Identity                  📐 needs doc
  26 Cloud Storage & Sync                 📐 needs doc
  27 Publishing & Versioning              📐 needs doc
  28 Discovery & Library                  📐 needs doc
  29 Moderation & Safety                  📐 needs doc
  30 Mobile & Touch                       📐 needs doc
```

**Dependency spine.** 5.5 → 6 → 7 → 8 → 9 → 10 is strictly sequential; each phase consumes the one before. 11 needs all of 6–10. 12 must precede 13 (dialogue flags need the variable registry) and 13.5 (quest objectives are conditions). 13 must precede 13.5 (quest turn-in is a dialogue interaction). 14 must precede 15 (travel consumes time). 16 needs 11. 17 needs 10 and 11. **15A (cross-map) gates 15B, 13.5's escort objectives, and 20.5.** 18 needs 12, 13, and 13.5. 20A needs 14's clock. **25 (Accounts) gates every later Stage 3 phase.**

**Three deferrals finally close in Stage 3**, which is why they were deferred rather than dropped: Phase 12's reserved `global` variable scope lands in **25** (a cross-save global belongs to an account), Phase 5.5's Option C blob store lands in **26**, and Phase 11's written-but-unread `projectVersionId` starts being read in **27**. **If the platform is never built, all three stay reserved and cost nothing** — which is exactly why they were reserved rather than built.

**Stage 2 dependencies:** 21 needs 15A (cross-map) and 20.5 (mounts share follow-and-ride logic with companions). 22 needs 14's seasons and 19's audio. 23 needs 18's standing.

**Renumbering note.** Phases 12 and 13 in the old plan were "Dialogue/Shops/Doodads" and "World Map." They are now 13 and 15. Nothing was written under the old numbers, so no document is invalidated — but any conversation memory of "Phase 12 = dialogue" is now stale.


**Cross-reference sweep — done.** Phases 12 and 13 were renumbered when Constants/Variables and World Clock were inserted; the stale "Phase 12" references in `PHASE8_DESIGN.md` (Shop UI, `has-item`) and `PHASE9_DESIGN.md` (incite-to-fight, TEA) were corrected in Phase 8 v4 and Phase 9 v3.

---

# SHIPPED

## Phases 1–5 — the standalone editor

Built, tested, and live at v0.6.0. Schema v1. Not restated here; see `ARCHITECTURE.md`, `FEATURES.md`, and `CHANGELOG.md` in the repo. What matters for everything below: the tile engine (square + hex-iso), the entity system with A\* and a spatial hash, the node-based formula editor and its evaluator, the trigger-action executor, and Play Test with snapshot-restore all exist and work. Every phase after this reuses them rather than replacing them.

---

# FOUNDATION

## Phase 5.5 — Schema v2 Consolidation

**Status:** design doc needed · **Depends on:** nothing — can start immediately
**Effort:** High · **Chunks:** one

**Why it exists.** The data architecture pass found six container-level problems in `types.ts` that have nothing to do with stats, equipment, or spells. Landing them inside Phase 6 would muddy that phase's story and hide real risk. They are mechanical, low-behavior changes that should happen once, first, while the codebase is small.

**Scope — what ships**

*(v2 absorbed three items from Phase 12's gap list: deleting the inert `flag-set` condition, extracting the `ActionExecutor` — which Phases 8 and 10 call four and two phases before Phase 12 would have built it — and stating one undo policy for all twelve database editors.)*

1. **`AssetRef` becomes a struct.** Today it is a bare `string` holding a data URL. It becomes `{ blobId, sha256, mime, width?, height?, durationMs? }` behind a storage adapter whose only implementation for now is local/inline. No backend required. This is the change that stops every day of new authored content from becoming migration debt later.
2. **`AssetManifest` gains `portraits` and `icons`** — both needed by character creation and the skill/item databases.
3. **Promote three inline types to top-level databases:** `dialogueTrees` (currently trapped inside `NPCSprite.dialogue`, therefore unshareable), `statusEffects`, and `lootTables`. NPCs and enemies reference them by id.
4. **`activeMapId` → `startMapId`.** The field currently means both "where the game begins" (authored) and "which map the creator has open" (editor UI state). Split them; the second moves to `EditorState`.
5. **`variables: ProjectVariable[]` registry added** to the `Project` container, empty. Phase 12 builds its editor and semantics; the field exists now so nothing migrates later.
6. **`SCHEMA_VERSION = 2`**, with v1 files **rejected on load with an explicit message**, never silently half-parsed. Emberfall is re-authored against the new container.

**Explicitly out of scope**

- **Physically removing `Project.player`.** The project/save boundary is *declared as law* here and Phases 6–10 are written to respect it, but the actual split lands in Phase 11 where character creation and save state exist to receive it. Removing it now would leave the app unable to spawn a player between 5.5 and 11.
- Any real blob store. That's platform-tier work, months out. The adapter shape is what matters now.

**Amendment this forces:** Phase 6's doc currently owns the `schemaVersion` 1 → 2 bump and the v1 rejection gate. Both move here. Phase 6 extends v2 rather than creating it.

**Verification gate:** strict `tsc`, production build, and **all 88 existing Phase 2–5 runtime tests still green byte-for-byte** — this phase must change zero behavior.

---

# COMBAT & CONTENT

## Phase 6 — Core Stat System

**Status:** designed — `PHASE6_DESIGN.md` v2 · **Depends on:** 5.5
**Effort:** Extra High · **Chunks:** one

**Goal.** Replace the flat v1 `StatBlock` with an attribute-driven model. STR / AGI / INT are stored; every pool maximum and combat stat is derived by one pure function.

**Scope:** `deriveStats(base, contrib?)` and the two-pass contribution rule · HP/Mana/Stamina pools · physDamage, physDef, spellPower, spellResist, moveSpeed, attackSpeed, blockReduction, concentration · the diminishing-returns mitigation curve · the stamina economy · **two new runtime actions, block and sprint** · the full editable `StatRules` panel · ATB charging off `attackSpeed` · Emberfall re-authored attributes-first.

**Out of scope:** equipment, buffs, spells, leveling, jump input (cost reserved only).

**Why Extra High:** every field name, coefficient, and signature here is inherited verbatim by Phases 7–10. It is the only phase where a naming mistake is free to fix.

**Signature test:** the two-pass ordering proof — a synthetic `+3 STR` contribution must raise maxHp *and* physDamage *and* physDef by exactly the documented coefficients. Written here even though no gear exists yet, so Phase 7 inherits a passing guard.

---

## Phase 7 — Equipment, Damage Types & Immunity

**Status:** designed — `PHASE7_DESIGN.md` v3 · **Depends on:** 6
**Effort:** High, **Extra High for the damage pipeline** · **Chunks:** one

**Goal.** Ten equipment slots, typed damage, and the single `resolveDamage` pipeline every hit in the game runs through.

**Scope:** the slot model (mainHand/offHand two-handed rule, two rings, seven armor slots) · equipment as a `StatContribution`, never a mutation · `DamageInstance` and the damage-type union · **`resolveDamage`, pure**, returning `staminaCost` and `guardBroken` for the caller to apply · **true immunity** at `effectiveDef ≥ 1.25 × raw`, positioned after armor penetration and before the damage floor · the five immunity guardrails including the **Combat Sanity Check** editor panel · dual-wield on the Attack button with an off-hand stamina surcharge · magic weapons as three orthogonal fields (`spellPower`, `convertDamage`, `bonusDamage`) · the Equipment Database editor.

**Locked decisions worth restating:** true immunity is on by default — E chose it over armor-penetration-plus-floor with full awareness of the softlock risk, and the Sanity Check panel is what makes it shippable. Ordering in the pipeline is load-bearing; the damage floor can never resurrect a zeroed hit.

**Signature test:** immunity fires at the exact ratio, armor penetration defeats it, and the floor does not leak damage past it.

---

## Phase 8 — Items, Currency & Inventory

**Status:** designed — `PHASE8_DESIGN.md` v2 · **Depends on:** 7
**Effort:** High · **Chunks:** one

**Goal.** One item database, plural hierarchical currencies, and a categorized inventory.

**Scope:** `ItemDef` discriminated as equipment / usable / cargo, with equipment items *referencing* their Phase 7 definition by id rather than duplicating it · perishable vs non-perishable · cooldowns, which may be zero · item scripts reusing the **existing** `TriggerAction[]` executor — zero new machinery · currencies with a hidden universal `baseValue` and **per-shop contextual overrides** (reject outright, or accept at a humiliating rate) · **no auto-conversion, no arbitrage, no banking** · six built-in undeletable inventory categories plus creator-added extras · the Item / Currency / Category editors.

**Standing rule from this phase, binding on all later phases:** *the player must never gain value by relocating currency.* Not discouraged — unrepresentable.

**Settled:** money and item drops are `PickupEntity` objects in the world, with `LootTable.autoCollect` resolving them straight to the wallet for turn-based projects (Phase 8 v5 §7.5). Phase 9's loot spawner no longer forward-references an open decision.

---

## Phase 9 — Enemy Database, Resistance & Loot

**Status:** designed — `PHASE9_DESIGN.md` v2 · **Depends on:** 6, 7, 8
**Effort:** High, **Extra High for the monster/human split and the pipeline extension**
**Chunks:** one

**Goal.** One enemy database with two authoring shapes, an intrinsic-resistance pipeline stage, loot, and general leveling.

**Scope:** `EnemyDef` union — `MonsterDef` (authored flat `directStats`, a list of `MonsterAttackDef`s reusing `DamageInstance`, cannot equip, `maxMana`/`maxStamina` defaulting to 0) and `HumanEnemyDef` (a full Phase 6 `StatBlock` plus a Phase 7 `loadout`) · **"human" is a mechanical category, not a biological one** — skeletons, zombies, and Ghost Warriors are all `HumanEnemyDef` · **RPD/IPRD as a new pipeline stage** running *before* armor mitigation, `Damage × (1 − RPD + IPRD)`, with IPRD allowed to exceed 100% for intentional amplification · loot tables · general EXP and leveling backend, with the Character screen deferred to Phase 11 · the Enemy Database editor.

**Signature test:** a non-regression proof that with both new optional fields absent, every Phase 7 test passes unchanged.

---

## Phase 10 — Spells, Abilities & Delivery

**Status:** designed — `PHASE10_DESIGN.md`, **five gaps to fold before implementation**
**Depends on:** 4, 6, 7, 8, 9 · **Effort:** Extra High · **Chunks:** two (10A / 10B)

**Goal.** An editable Active Skill Database reusing Phase 4's formula graph, generalized from damage into heal / buff / status — plus the delivery layer that gets a skill to its victims.

**The organizing idea:** *effect* and *delivery* are orthogonal. Any effect rides any delivery. A healing beam is a database row, not a feature.

### 10A — Skills, effects, and instant delivery
`ActiveSkillDef` (one schema, `resource: 'mana' | 'stamina'`, two filtered UI views) · the widened `Effect` type with `fixed | formula` magnitudes · `resolveHeal` as its own pure path with no resistances, armor, immunity, or floor · `knownSkills` on `CombatantBase` · cast / cooldown / cast-time / the **three-model interruption system** (chance, free hits, condition — all off by default, composed as requirements not filters) · `resolveTargets` for self / single-target / area / cone / beam · spread-of-beams · the Skill Database editor and the delivery preview · enemy casting.

**Plus the folded gaps:**
- **`castRay()`** — the world-space tile-traversal primitive. LOS today is faked as `distTiles <= 6`; this replaces it and serves three consumers: acquisition, skill targeting, and projectile/beam travel. Terrain gains `blocksSight?` and `blocksProjectiles?`, each defaulting to whatever blocks movement.
- **Acquisition range** — Warcraft-III-style: distance **and** line of sight, replacing the current see-through-walls behavior.
- **A faction model** — `faction` on `CombatantBase`. Required by both acquisition ("hostile to whom?") and `affects: 'enemies' | 'allies' | 'all'`. Small, but currently owned by nobody.
- **`StatusEffectDef` v2** — the shipped type is v1-shaped and broken: it uses the deleted `atk`/`def`/`spd` keys, its duration is turn-only, and its `tickDamage` is an untyped number that bypasses `resolveDamage`. Rewritten with `durationMs` + optional `durationTurns`, a `StatContribution`, and a typed `DamageInstance` tick.
- **The `ActiveEffectSet`** — the runtime owner nothing currently has. Ticked from the update loop, invalidating the stats cache on change. Four payload kinds: contribution, periodic, script, and **restriction** (`'move' | 'attack' | 'cast' | 'block' | 'sprint'`) — which is how a stun works and what interruption Model C keys off. `isPermanent` makes duration meaningless. Stacking is a property of the effect: `'refresh' | 'stack' | 'ignore' | 'independent'` with `maxStacks` and `stackScope: 'per-source' | 'global'`. **Equipment must never become an ActiveEffect** — gear is already a `loadout` contribution, and routing it here would resurrect the stateful-unequip bug Phase 7 exists to prevent.
- **`cooldownGroup?: string`** — shared timers across skills. The existing MMO-style global cooldown flag is deprecated (nothing shipped, so it's free to drop). Once-per-day Greater Powers are parked until Phase 14 provides a clock.
- **Dual-model durations** — every duration and cooldown carries a canonical value plus an optional override, with a project-level `msPerTurn` (default 3000) deriving the missing one. Skills gain an action-point cost for turn-based mode.

### 10B — Projectiles
`ProjectileEntity` as a runtime-only, never-serialized entity kind · homing with optional `turnRateDegPerSec` · non-homing requiring a real hitbox intersection · `pierce` (default 0 = despawns on first hit) with a `hitIds` set so one victim isn't hit on three consecutive frames · **explosive `onImpact` detonating on entity *and* terrain impact** · spread-of-projectiles · the analytic turn-based equivalents.

**10A leaves turn-based mode complete and is shippable alone.** If work stops between chunks, LoreBrix is coherent rather than half-built.

---

# RUNTIME

## Phase 11 — Runtime Shell, Save State & Input

**Status:** design doc needed · **Depends on:** 6, 7, 8, 9, 10
**Effort:** Extra High · **Chunks:** two

**Why it's the riskiest unwritten phase.** It owns the **project/save boundary** — the line between what the creator authored and what a player did to it. Five phases currently store player-mutable data (current pools, inventory, wallet, loadout, knownSkills, level, exp) inside authored definitions. This phase resolves that, and every phase after it inherits the resolution.

### 11A — Save State & the boundary
`SaveState` as a document: character block (name, gender, `presetId`, `StatBlock`, level/exp, loadout, inventory, wallet, knownSkills) · location · **world deltas as id lists only** (defeated entities, looted containers, taken pickups, destroyed doodads with respawn timers, unlocked doors, fired once-triggers) · save-scoped variables · discovery · active buffs with remaining duration · cooldowns · **`projectVersionId` pinning** so a creator's balance patch never breaks a save in flight · `Project.player` physically removed · save slots · Phase 5's playtest snapshot-restore rewritten to spawn an ephemeral `SaveState`, so the save system is exercised on every playtest instead of only at ship.

### 11B — The shell
Title Screen (New Game / Load Game / Exit) · **Character Creation** — gender → sprite → matching portrait, name entry defaulting to **Elms** / **Chels**, driven by `characterPresets` + `characterCreation` rules · the in-game Menu (Character / Inventory / Spells / Map / Save / Exit) · **the Character screen is Phase 7's paper-doll panel reused verbatim**; the Inventory screen is Phase 8's panel; the Spells screen is Phase 10's list — all three were built creator-facing on purpose and are collected here · **input actions and key bindings**: the creator authors a named action list (Attack, Block, Cast Slot 1…), the *player* rebinds them, and bindings persist as **Tier 0 user preferences, not project data** — a creator does not own your keyboard · the skill hotbar / quick-slot binding, which currently falls in the seam between Phases 10 and 11 and would otherwise be orphaned.

**Stage split inside this phase.** Stage 1 builds `ProjectStore` and `SaveStore` over **IndexedDB** — two object stores, saves keyed by `projectId`, never nested inside the project document — plus save export as a file. `SaveState.projectVersionId` is written from the start (adding it later would migrate every save) but **the reconciliation logic is Stage 3**; nothing is published locally, so there is nothing to reconcile. Phase 11 must not grow a version system with no versions.

**The Launcher UX.** LoreBrix stops opening straight into the editor. It opens on two doors: **PLAY** → game library → save slots (three plus autosave) → Continue or New Game; and **CREATE** → project library → the three-panel editor. Pick the cartridge, then the memory card. A game and a project are **the same record seen through two doors**, not two copies — so "edit the game you're playing" is one button, and importing a `.lorebrix` file adds a cartridge to the shelf. Playtest from inside the editor keeps bypassing both libraries with an ephemeral save.

**Signature test:** save → quit → load returns a byte-identical world state.

---

## Phase 12 — Events, Gameplay Constants, Variables & Flags

**Status:** designed — `PHASE12_DESIGN.md` · **Depends on:** 5.5 (registry field), 11 (save scoping)
**Effort:** High · **Chunks:** one

**Why it exists.** It doesn't exist today in any form, and three already-planned features silently assume it. Phase 13's replayable-vs-irreversible dialogue needs flags. Puzzle switches need them. Formula graphs want named constants instead of magic numbers.

**Scope:** **the event bus and `Trigger.given`** — completing Event/Condition/Action, which LoreBrix was two-thirds of: `MapTrigger` has no conditions field at all, and its three events are all spatial, so "when the Vampire Lord dies" was not expressible. `EntityMatch` by tag is what makes counting objectives authorable once rather than per-entity · the `ProjectVariable` type — `key`, `type: 'bool' | 'number' | 'string'`, `initial`, `scope: 'save' | 'session'`, `readonly` (a `readonly` variable *is* a constant), `description`, `category` · **`set-variable` and `check-variable` join the `TriggerAction` and `Condition` vocabularies**, which makes dialogue gating, quest state, and puzzle switches all the same mechanism reusing the Phase 1 executor · named constants usable in formula graphs · the Variables editor with a **usage view** showing where each flag is read and written · save-scoped variables persisting into `SaveState`, session-scoped resetting on load.

**Out of scope:** quests as a first-class subsystem. They are the obvious thing built on top of this and remain unowned; flagging rather than silently absorbing.

---

## Phase 13 — Dialogue, Shops & World Interaction

**Status:** design doc needed · **Depends on:** 8, 9, 11, 12
**Effort:** High · **Chunks:** one

*(Was Phase 12 in the old plan.)*

**Scope:** dialogue upgrades — flag-gated branches, **replayable vs. irreversible** conversations, choices that persist their consequence · a real **Shop UI**, rendering Phase 8's currency accept-lists, contextual value overrides (the elven merchant who won't take paper), and the three stocking modes from Phase 8 §7.4 · **incite-to-fight**, including the `provokable` flag that the original plan listed and the written Phase 9 doc omitted, writing `SaveState.world.factionOverrides` · **destructible and stateful doodads and props** — a chopped tree, a smashed pot — with authored respawn conditions.

**★ Extract the dialogue runtime explicitly.** The state machine that advances nodes and presents choices currently lives in `App.tsx`'s `setDialogue()` closure — the same class of problem as the action executor Phase 12 extracts and the panels Phase 11 §11 depends on. Phase 13 must lift it into a `DialogueRunner` with an injected context and the same import-list assertion (no `App.tsx`, no React), rather than inheriting the closure by accident and discovering it when Phase 13.5 needs to drive a quest turn-in through it.

**Note:** doodad respawn can run on elapsed milliseconds and does *not* require Phase 14's calendar. Time-of-day-gated respawn does, and is deferred to 14.

---

## Phase 13.5 — Quests & Journal

**Status:** design doc needed · **Depends on:** 11 (menu, save), 12 (`ConditionEvaluator`, variables), 13 (dialogue and its extracted runner)
**Effort:** High · **Chunks:** one

**Why its own phase, and why here.** Phase 12 completes every ingredient a quest system needs, which makes quests the obvious next request the moment it ships. But they are not a field on something else — they are a database, a runtime tracker, a player-facing screen, and save state. Folding them into Phase 13 would make that phase five subsystems.

Placed after 13 because **turn-in is a dialogue interaction**, so flag-gated dialogue must exist first, and quest objectives are written as Phase 12 conditions. Placed before 14 because basic quests need no clock; time-limited quests then become a small additive feature when one arrives.

**Numbered 13.5 deliberately.** Renumbering has already produced stale cross-references twice in this project. A decimal costs nothing and invalidates no existing reference.

**Scope:** a `QuestDef` database — the **twelfth sibling** of the editor pattern — with stages, per-stage objectives expressed as Phase 12 `Condition`s, and rewards reusing Phase 9's `LootTable` shape · a runtime tracker that watches for objective completion via the `ConditionEvaluator` and advances stages · quest state in `SaveState` (active, stage index, per-objective progress, completed, failed) · **the Journal screen**, which is the eighth entry in Phase 11's in-game menu · quest-giving and turn-in through Phase 13's dialogue, gated on quest state · objective markers on the map.

**Out of scope:** branching quest trees with mutually exclusive outcomes (a stage list covers the common case; branching is Phase 12 variables plus two quests), and reputation systems.

**Amendment this forces on Phase 11:** the in-game menu gains a **Journal** entry. Like Map, it ships in Phase 11 **disabled with a tooltip** and is enabled here — so the menu's shape is settled once rather than twice.

## Phase 14 — World Clock, Calendar & Rest

**Status:** designed — `PHASE14_DESIGN.md` · **Depends on:** 11 (save persistence), 12 (event bus, conditions), 13 (pause rules)
**Effort:** High · **Chunks:** one

**Why it exists.** Four separate features want it and none can proceed without it: once-per-day Greater Powers (parked from Phase 10), shop opening hours, time-gated doodad respawn, and travel that consumes time (Phase 15).

**Scope:** a game clock and calendar with a configurable day length and an authored start date · day/night as a render tint on the tile engine, plus a `timeOfDay` value readable by conditions · **time-based `Condition` types** joining Phase 12's vocabulary · scheduled events · clock state persisted in `SaveState` · the time constants panel.

**Also delivers wait and sleep** (14B), with per-game-hour action hooks — which is what makes date-gated content playable rather than a waiting game.

**Out of scope:** full NPC daily schedules (go to work, sleep at night). A genuinely large behavior-system extension deserving its own phase; the clock this phase provides is its prerequisite. Still unowned.

---

## Phase 15 — World Map & Fast Travel

**Status:** design doc needed · **Depends on:** 11, 12, 14 · **Effort:** Extra High
**Chunks:** one

*(Was Phase 13 in the old plan. Still the integration capstone.)*

**Ships as two chunks, because 15A is a prerequisite rather than a feature.**

### 15A — Map lifecycle and cross-map teleport

Not an appendix item and not its own phase: **fast travel is cross-map teleport with a UI and a time cost**, so this is Phase 15's foundation. It is also cheaper than it looks. `teleport-player` already carries a `mapId`, and `App.tsx:1047` logs *"Cross-map teleport is a post-MVP feature — noted!"* — so the schema and the call site exist and only the runtime switch is missing. Entity ids are UUIDs, so Phase 11's flat world-delta lists already work across maps with no scoping work, and Phase 11 already builds map loading to restore a save's `location.mapId`.

What remains: teardown and rebuild of `TileEngine` and `EntityManager`, and carrying non-map-scoped runtime state across the switch — the player, active effects, cooldowns, quest subscriptions, and later companions. Roughly half a chunk.

It also unblocks two things that were quietly waiting: Phase 13.5's escort objectives (*"send Alva to Volkihar"*) and Phase 13's dungeon entrances.

### 15B — World map and fast travel

**Scope — and it is two things, per E's original clarification, both of them:** (A) a true zoomed-out **world map** as a node graph of discovered locations, opened from the in-game Menu, with fast travel between them — pay a cart driver, consume game time; and (B) **overworld-vs-interior tagging** on `TileMap`, so walking out of a house behaves differently from walking into a dungeon. Discovery state lives in the save; the node graph is authored.

**Inherits from Phase 14 (§9 A7):** fast travel consumes game time via the `advance-time` action, and takes §3's pause rules and §7.2's hour-boundary interruption model rather than inventing its own. "Pay the cart driver, arrive two days later" is an `advance-time` call with an interruption hook for an ambush on the road.

**Why Extra High:** it introduces a new map concept and touches `Project.maps`, the most foundational authored data in the schema.

---

# EXPANSION

## Phase 16 — Combat Staging

**Status:** design doc needed · **Depends on:** 6–10, 11 · **Effort:** Extra High
**Chunks:** two

**The two-axis model, resolved.** E's five reference styles are a 2×2, not five systems:

| | **in-place** | **separate arena** |
|---|---|---|
| **turn-based** | Avernum | Betrayal · Pokémon |
| **action** | Diablo | Kingdom Hearts |

**Axis A — Combat Resolution Model** (`action` \| `turn-based`) forks the *math*. It is handled entirely by Phases 6–10's dual-unit durations, action-point costs, and mode-aware delivery. **No work remains here.**

**Axis B — Combat Staging** (`in-place` \| `separate-arena`) forks the *scene*, and is what this phase builds: snapshot the combatants → load an arena map → run the identical resolution → return with results applied. **The damage math never learns which map it is on**, which is why the two axes multiply into four styles at the cost of one.

**Also owns non-lethal defeat.** Combat currently has exactly one outcome at zero HP. *"Subdue Alva without killing her"* — from E's simulated quest — needs a second: an entity flag converting death into an incapacitated state, with its own event so quests and dialogue can react. It belongs here because it is a combat outcome, and Phase 13.5 §2 flagged it as unowned.

**Scope:** `combatModel` and `staging` as per-map fields with a project-wide lock · arena map authoring, including auto-selection by terrain type · the encounter transition in and out · result reconciliation back to the overworld (deaths, loot, EXP, consumed items) · fleeing.

**★ Also owns the combat state machine.** There is currently no notion of being "in combat" — action mode has no encounter concept and turn-based has an ATB bar with no start or end. Phase 13 §7.3b runs on an interim rule (turn-based selected **and** at least one hostile has acquired the player) with a known edge: a single distant archer keeps combat active indefinitely. This phase replaces it with a real encounter object that **ends when every enemy that had acquired the player has left its combat state**, and Phase 13's interim rule is deleted rather than maintained.

**Why it's placed last rather than with the combat phases:** in-place action combat — the Zelda arc's actual requirement — works completely without it. This is a presentation expansion that unlocks four more genres, not a prerequisite for a playable game. It is also the single strongest differentiator on the roadmap, so "last" is a sequencing call, not a judgment of value.

---

## Phase 17 — TEA (Tie EXP to Action)

**Status:** design doc needed · **Depends on:** 10, 11 · **Effort:** High · **Chunks:** one

Skill-based progression: EXP accrues to the *thing you did* rather than a general pool. Deferred from Phase 9 with a specific blocker per trigger, and Phase 10 clears the two hard ones by introducing skill `school` types.

**Still requires, and this phase must build:** a dodge/evade mechanic (doesn't exist), weapon-type and armor-type taxonomies (don't exist), and the jump input deferred back in Phase 6. The `mode: 'general' | 'tea'` toggle was reserved in Phase 9's `ProgressionRules` specifically so this needs no migration.

---

## Phase 18 — Faction Relations, Standing & Friendly Fire

**Status:** design doc needed · **Depends on:** 5.5 v2 (the relation matrix *shape*), 7 (weapons), 10 (targeting, skills), 12 (variables, events), 13 (provocation), 13.5 (quest rewards)
**Effort:** Extra High · **Chunks:** two (18A relations & fire / 18B standing)

Per E, the faction matrix lives here — with one structural caveat that is already handled.

**★ Cross-document flag.** This project's own law (Phase 5.5 §3) forbids restructuring the `Project` container after 5.5. The original faction model was `hostileTo: FactionId[]`; a three-state matrix is a different shape. So **Phase 5.5 v2 now lands the matrix *shape*** — `relations: Record<FactionId, 'hostile' | 'neutral' | 'ally'>` — and Phase 10 reads it for targeting. **This phase owns everything that makes the matrix *behave*.** E gets the feature here as wanted; the law holds.

### 18A — Relations and friendly fire (Warcraft III as the benchmark)

**Three states:**

| relation | behavior |
|---|---|
| **hostile** | Attacks on sight, via Phase 10's acquisition. |
| **neutral** | Docile, never auto-targeted — but attackable. **When attacked, becomes hostile.** |
| **ally** | Never auto-targeted. Whether a hit lands is governed by **friendly fire**. |

**Asymmetric by design**, as in Warcraft III: faction A's view of B is stored on A, so A may ally B while B is hostile to A. The matrix editor defaults to symmetric editing (set both cells at once), with an explicit toggle for one-way relations.

**Neutral-to-hostile needs no new mechanism.** Attacking a neutral *is* an automatic provocation, so it reuses Phase 13's provoke path exactly: it writes `factionOverrides` and survives a reload. Whether only the struck entity turns, or its whole faction, is Phase 13 §6.3's `propagateToFaction` — already specified, default off. One mechanism, two triggers.

**Friendly fire — four levels, most specific wins:**

```ts
// Project           friendlyFire: boolean                          // the global default
// FactionDef        friendlyFire?: 'on' | 'off' | 'inherit'        // default 'inherit'
// EquipmentDef      friendlyFire?: 'on' | 'off' | 'inherit'        // weapons
// ActiveSkillDef    friendlyFire?: 'on' | 'off' | 'inherit'        // spells and abilities

resolve(hit) = source.friendlyFire      // the weapon OR skill that dealt it
            ?? attacker.faction.friendlyFire
            ?? project.friendlyFire
```

Tri-state below the global, so each level can *override* rather than only restrict — a project with friendly fire off globally can still author a fireball that burns your allies, and a project with it on can author a healer's staff that never does. A hit comes from a weapon **or** a skill, never both, so the chain is always three steps.

All four fields are **optional additions** on types Phases 7 and 10 already define, so they are additive under Phase 5.5 §3 and migrate nothing.

**Healing is not friendly fire.** Friendly fire governs *damage* to allies. Whether a heal reaches an enemy is Phase 10's `affects`, a different question — and conflating the two is how an engine ends up with "heal is blocked because friendly fire is off."

**A matrix editor** — an N×N grid of factions, each cell cycling hostile / neutral / ally, with the diagonal fixed at ally (a faction is always allied with itself). Warcraft III's alliance screen is the reference.

### 18B — Standing and reputation

The player's standing *with* each faction — distinct from how factions regard each other.

**What already works without it.** Phase 12 §6.6 made favor a number variable, `favor_<factionId>`, auto-created per faction. `favor(Dawnguard) += 30` and `favor(Dawnguard) >= 25` work the day Phase 12 ships.

**What 18B adds is the automatic wiring:** named standing bands on `FactionDef` (hostile / unfriendly / neutral / friendly / allied) so a creator authors "friendly" rather than `>= 60` in forty places · standing crossing a band **rewrites the player's cell in the relation matrix**, so a faction turns hostile on its own · provocation propagation becoming a standing *hit* rather than a boolean flip, which is strictly better because it decays and recovers · shop prices scaled by standing · yield and bribe odds on the curve E sketched (Phase 13 §6.2c) · decay, and rival penalties — helping one faction costing standing with its enemy · a standing screen and change notifications.

**18A and 18B meet at one point:** the player's row in the matrix. 18A makes it behave; 18B makes it move.

## Phase 19 — Audio Playback

**Status:** design doc needed · **Depends on:** 5.5 (the asset manifest), 12 (events)
**Effort:** High · **Chunks:** one

**The honest starting position:** audio assets have been modeled since Phase 1 and **nothing has ever played them.** `change-bgm` is a `TriggerAction` that logs a line. Phase 11 ships three volume sliders wired to a no-op mixer. This is a documented v1 limit in the README, and it is the oldest unpaid debt on the roadmap.

**Scope:** an `AudioMixer` with master / music / effects buses reading Phase 11's `UserPreferences.volumes` · BGM with crossfade, per-map and per-trigger · one-shot SFX with a voice cap and distance attenuation · hooks on the events that already exist — attack, hit, death, level-up, dialogue advance, shop purchase, UI — via Phase 12's bus rather than hard-coded call sites · looping ambience per map · `change-bgm` and a new `play-sfx` action doing real work · audio import in the asset panel.

**Two things worth deciding in the doc rather than in code:** browsers block autoplay until a user gesture, so the mixer must start suspended and resume on first input; and web audio decoding is async, so a trigger firing a not-yet-decoded clip needs a defined behavior (preload per map, and skip rather than stall).

## Phase 20 — NPC Schedules & Crowds

**Status:** design doc needed · **Depends on:** 3 (behavior machines), 14 (the clock), 12 (events)
**Effort:** Extra High · **Chunks:** two

### 20A — Daily schedules

The behavior extension Phase 14 was the prerequisite for. An NPC gets a schedule of time-blocked activities — *work the forge 8–18, tavern 18–22, sleep 22–6* — each naming a destination and a behavior state, with Phase 3's A\* pathfinding doing the walking and Phase 4's behavior machines still owning reactions. Schedules yield to combat and dialogue and resume afterward. Authored per NPC, overridable by quest state, and it makes *"talk to the blacksmith"* a question of *when* as well as *where*.

### 20B — Crowds — cheap by construction

Per E: cheap ambient crowds that do not cost much memory, convertible into proper NPCs later.

**The answer is that a crowd agent is not an entity.** A `CombatantEntity` carries a stat block, a loadout, an inventory, a wallet, known skills, active effects, a spatial-hash entry, and an AI update tick. A crowd agent carries a position, an animation phase, and a template id:

```ts
interface CrowdAgent {                 // ~32 bytes, in a flat typed array
  x: number; y: number;
  phase: number;                       // animation + wander seed
  templateIndex: number;
}

interface CrowdSpawner {
  id: UUID;
  zone: TriggerZone;
  templates: { spritesheetId: UUID; npcTemplateId?: UUID; weight: number }[];
  density: number;
  activeHours?: [number, number];       // Phase 14 — a market that empties at night
  maxAgents: number;                    // hard cap, per spawner
}
```

Agents wander inside their zone on a shared noise function, are **not** in the spatial hash, have no AI tick, no combat, no save deltas, and despawn when the player leaves the zone. Rendering is a single batched pass through the existing entity render hook.

**★ Promotion is the interesting part.** Interacting with a crowd agent — or a quest targeting one — promotes it into a real `NPCEntity` from `npcTemplateId`. For that to be save-safe the promoted NPC needs a stable identity, so an agent's id is **derived deterministically** from `(spawnerId, agentIndex)` rather than generated. Promotion is then idempotent: the same agent promotes to the same NPC across a reload, and only promoted agents cost anything in the save.

A spawner with no `npcTemplateId` produces pure scenery that can never be promoted, which is the right default for a distant market square.

## Phase 20.5 — Companions & Followers

**Status:** design doc needed · **Depends on:** 3, 13 (dialogue), 15A (cross-map)
**Effort:** Extra High · **Chunks:** one

**Flagged rather than requested, because it is genuinely unowned and E's own simulated quest depends on it.** *A Vampire Problem* has Serana follow you across the continent and requires escorting Alva to Volkihar. Phase 13.5 §9 marks those objectives **authorable but not playable** until this exists, per E's decision to ship solo-play quests first.

**Scope:** follow behavior with spacing and catch-up teleporting · combat participation using the existing faction model · surviving a map change (15A) · dialogue while traveling, and a companion speaking up inside another NPC's conversation, which the simulation also needed · a `join` / `leave` action pair · companion state in the save · and a party inventory decision — shared or individual, which is the one real design fork in the phase.

**Numbered 20.5 rather than renumbering everything after it**, following the 5.5 and 13.5 precedent. Renumbering has twice produced stale cross-references in this project.

---

# STAGE 1.5 — DECIDED: LoreBrix becomes a game engine

**Resolved by E.** LoreBrix is built as a proper game engine first, and E's own game — **real-time action, not turn-based** — is its first title. The platform for other developers moves to Stage 3 and becomes optional rather than a prerequisite.

This is Path A from the earlier analysis: engine, then one shipped game, then platform — the order Unreal and Unity actually followed. A finished game validates the engine in a way design review cannot, and gives the platform content on day one if it is ever built.

**One consequence worth stating plainly, and it needs E's ruling (see the note at the end of this document):** a real-time action target changes the *priority* of everything turn-based in Phases 10, 13, 14, and 16 — without necessarily changing whether it is built.

---

# STAGE 2 — ENGINE EXPANSION

Three phases that complete LoreBrix as an engine. All local — no server. At the end of Stage 2, E's game can be built on it.

## Phase 21 — Traversal, Mounts & Vehicles

**Status:** design doc needed · **Depends on:** 3 (terrain, A\*), 6 (stamina), 15A (cross-map), 20.5 (a mount shares follow-and-ride logic with companions)
**Effort:** Extra High · **Chunks:** two (21A movement modes / 21B mounts and vehicles)

**★ Half of this is already authored and inert.** Phase 3 shipped `swimmable` and `flyable` on `TerrainProperties` (`types.ts:138–139`) exactly as its prompt asked — and nothing reads them. `TerrainService.isWalkable` (`entity-system.ts:333`) checks `walkable` only. The same pattern as `flag-set`: a field a creator can set that the engine ignores. This phase finishes what Phase 3 started.

### 21A — Movement modes

An entity has a set of movement modes and a current one:

```ts
type MovementMode = 'walk' | 'swim' | 'fly';

// CombatantBase
movementModes: MovementMode[];      // what this entity CAN do
currentMode: MovementMode;          // what it IS doing
```

Terrain passability becomes mode-aware: a cell is traversable if its flag for the current mode is true. **A\* pathfinds per mode**, so a swimmer routes across a lake and a walker routes around it — the Phase 3 pathfinder gains a mode parameter rather than a second implementation.

- **Swimming** — enters automatically on a `swimmable`-only cell, drains stamina (Phase 6), slows movement, forbids blocking and most attacks; stamina reaching zero starts **drowning damage** rather than instant death, which gives the player a window to reach shore.
- **Flying** — ignores ground obstacles and `walkable`; on hex-iso maps it needs a rendering answer for altitude, which is the one genuinely hard question in the phase. Flight may be a creature trait, a spell (a Phase 10 buff), or a mount.
- **Transitions** fire Phase 12 events (`movement-mode-changed`), so a quest can react to the player first taking flight.

### 21B — Mounts and vehicles

**A mount is an entity another entity rides.** The rider's movement is replaced by the mount's — speed, modes, and passability — while the rider keeps control and, where authored, can still attack. A horse gives `walk` at 2× speed; a griffin gives `fly`; a boat gives `swim` without the stamina drain.

```ts
interface MountDef {
  movementModes: MovementMode[];
  speedMultiplier: number;
  seats: number;                    // 1 = a horse; 4 = a cart; many = a ship
  riderCanAttack: boolean;
  staminaDrainPerSec?: number;      // the mount's, not the rider's
  dismountOnHit?: boolean;
}
```

**Vehicles are mounts with more seats and no will of their own.** Serana's boat to Morthal is a vehicle with two seats; Phase 15's cart driver is a vehicle NPC whose fast travel resolves through `advance-time`. One model, not two.

Mount, dismount, and mounted/unmounted become events and conditions. Mount state persists in the save.

**The real design fork, flagged for the doc:** whether mounts are *owned* (you have a horse, it follows you, it can die) or *summoned* (a spell or item calls one). Owned mounts share nearly all their logic with Phase 20.5's companions, which is why 20.5 comes first.

## Phase 22 — Weather & Seasonal Terrain

**Status:** design doc needed · **Depends on:** 14 (clock, seasons), 19 (audio, for rain and wind), 12 (events, conditions)
**Effort:** High · **Chunks:** one

Moved in from the unowned list. Phase 14 made seasons queryable but deliberately left what they *do* to the creator; this phase gives creators the tools.

**Scope:** weather states (clear, rain, storm, snow, fog) as a Markov chain per region, with season-weighted transition odds · rendering as an overlay composited with Phase 14's day/night tint, using the same single-parameter pattern so `tile-engine.ts` stays time-agnostic *and* weather-agnostic · **seasonal tile variants** — a grass tile authors a winter sprite, and the renderer swaps by season, no second map · weather as conditions and events (`is-raining`, `weather-changed`), so a quest can require a storm and a spell can call one · gameplay effects left **authored rather than built-in**: rain *can* reduce visibility or extinguish fire effects, but only because a creator wired it through Phase 12, never because the engine assumed it.

## Phase 23 — Economy & Trade

**Status:** design doc needed · **Depends on:** 8 (currency, shops), 13 (shop UI), 18 (standing)
**Effort:** Extra High · **Chunks:** two

**E's position:** this pillar comes before a proper release of either LoreBrix or a game built on it. It was Stage 3 notes a revision ago; it is now engine scope.

It is the arc from the original planning session — **trading as a third pillar beside combat and magic** — with the standing agreement that any antagonist faction is **an institution, not a race.**

**Scope:** money-changers and currency exchange (deferred from Phase 8, and required to keep Phase 8's *never gain value by relocating currency* rule honest once exchange exists — a changer always takes a spread) · supply and demand, with prices moving on stock and a slow drift back to baseline · faction pricing via Phase 18's standing · trade skills, which is where a Banker-style class earns its keep · merchant inventories that restock from a simulated regional economy rather than from nothing.

**★ The phase's central risk, named now:** the moment trading is a skill, the arbitrage Phase 8 made unrepresentable becomes *intentional*. The design must gate profitable arbitrage behind the trade skill specifically, so a fighter cannot stumble into a money printer. That rule deserves its own validation pass, the way Phase 7's immunity got the Combat Sanity Check.

---

# STAGE 3 — PLATFORM FOR OTHER DEVELOPERS

Seven phases, and **all of them are optional if E's game is the goal.** They turn the engine into a platform other developers can build on. Strictly sequential from 25 to 27; 28 and 29 can overlap.

## Phase 24 — Localization

**Earliest in Stage 3, per E — and it sits at the boundary for a reason.** A shipped game needs localization regardless of whether the platform is ever built, so this is the one Stage 3 phase E's own game will likely want too.

Most of the work is already done by accident: every authored string in LoreBrix already lives in a database — dialogue nodes, item names, quest text, skill descriptions, UI labels. What is missing is a **locale dimension** on those strings and a translation workflow.

**Scope:** a `LocalizedString` type (`Record<LocaleId, string>` with a fallback locale) replacing bare strings across the authored databases · a string-extraction pass producing a translatable table · import and export in a standard format for professional translators · locale switching at runtime · right-to-left layout support in the UI · and **font coverage**, since the editorial serif may not carry every script.

**One honest caveat:** replacing `string` with `LocalizedString` across twelve databases is broad, and it is the one change in the whole roadmap that touches nearly every authored type. It is additive in data (a string becomes a one-locale map) but wide in code, which is why it needs its own phase rather than riding on another.

## Phase 25 — Accounts & Identity

Auth (provider choice is Kate's call), the `users` table, profiles and handles, session handling, and the account-settings surface. **Every later Stage 3 phase depends on it**, because a hosted project needs an owner and a synced save needs a player.

Also the natural home for **Phase 12's reserved `global` variable scope**, which was deferred precisely because a cross-save global belongs to an account rather than to a device.

## Phase 26 — Cloud Storage & Sync

Where Phase 5.5's `BlobStore` gets its **Option C** implementation and Phase 11's `ProjectStore` and `SaveStore` get remote ones. The discipline those phases imposed — content-addressed `blobId`, opaque URLs from `get()`, adapters behind interfaces — exists for exactly this phase, and if it held, one file changes per store.

**Scope:** a content-addressed blob store with CDN delivery and cross-project dedup · project sync with conflict handling · save sync, including the offline-first case where Stage 1 saves already exist locally · quota and storage management.

## Phase 27 — Publishing & Versioning

The `project_versions` table and the publish flow: a creator promotes a draft to an immutable version. **This is where Phase 11's `projectVersionId` stops being a written-but-unread field** and version reconciliation — continue on the pinned version, offer an opt-in upgrade, never auto-upgrade — finally runs.

## Phase 28 — Discovery & Library

The storefront: browse, search, tags, covers, ratings, play counts, a personal library, and follows. The first phase whose consumer is a *player* rather than a creator.

## Phase 29 — Moderation & Safety

Reports, a moderation queue, takedowns, and age or content labeling. **Not optional and not deferrable** — a UGC platform without moderation is a liability the moment the first stranger publishes something, and retrofitting it after launch is worse than shipping late.

## Phase 30 — Mobile & Touch

The vision document's commitment to tablets and phones, and the phase that pays down the debt Phase 10 §12 flagged: the node canvas — now used in five places — and directional aiming for cones, beams, and projectiles both assume a mouse.

**Honestly trimmable to Stage 3.** Playing on mobile is far cheaper than authoring on mobile, and shipping "play anywhere, create on desktop" is a defensible MVP.

---

## Appendix — what is still owned by nobody

**Nothing.** Every item that was on this list now has a phase:

| was unowned | now |
|---|---|
| Quests | **Phase 13.5** |
| Branching quests, mutually exclusive outcomes | **Phase 13.5 §4.4** — reuses Phase 13's entry-point rule |
| Faction standing | **Phase 18B** |
| Hostility between factions, as an authored matrix | **Phase 18A** — shape reserved in Phase 5.5 v2 |
| Friendly fire | **Phase 18A** |
| Audio playback | **Phase 19** |
| Cross-map teleport | **Phase 15A** — a prerequisite of fast travel, not a phase |
| NPC daily schedules | **Phase 20A** |
| Cheap crowd NPCs | **Phase 20B** |
| Companions | **Phase 20.5** |
| Non-lethal defeat | **Phase 16** — a combat outcome |
| Swimming, flying, mounts, vehicles | **Phase 21** |
| Weather and seasonal terrain | **Phase 22** |
| Economy and trade | **Phase 23** |
| Localization | **Phase 24** |
| Platform tier | **Phases 25–29** |
| Mobile and touch | **Phase 30** |

---

## ★ One decision needed from E — turn-based, now that the target is real-time action

E has set the engine's first title as **real-time action, not turn-based.** That is unambiguous for the game. It is ambiguous for the *engine*, and the two readings lead to different work:

**Reading 1 — turn-based stays, deprioritized.** The engine keeps both models; the game uses one. Nothing is deleted. Turn-based work is still built, just after real-time work in each phase. LoreBrix-the-platform (Stage 3) keeps a genre — and turn-based RPGs are a large share of what RPG Maker users build.

**Reading 2 — turn-based is removed from the engine.** Real simplification across five documents: Phase 10's dual-unit durations and `msPerTurn`, Phase 13 §7.3b's destructible turn cost, Phase 14 §3's per-turn combat time, and roughly half of Phase 16's reason to exist — its 2×2 grid is two-thirds turn-based. Cheaper, faster, and it forecloses that genre for the platform.

**My lean is Reading 1**, for one reason: the dual-model work is already *designed*, and the expensive part of turn-based support was the design, not the code. Keeping it costs mostly deferred build time. Removing it saves that time but spends it on re-opening five finished documents, and it is hard to reverse if the platform later wants the genre back.

**What changes either way:** Phase 16 drops sharply in priority, since in-place real-time combat — the Diablo cell of its grid — needs none of its staging machinery. Everything else keeps its order.

---

*LoreBrix, ELMSCORP. Roadmap — Stage 1 phases 1–20.5, Stage 2 engine phases 21–23, Stage 3 platform phases 24–30.*
