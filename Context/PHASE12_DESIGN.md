# Phase 12 — Gameplay Constants, Variables & Flags · Technical Design (v8)

**Status:** **v8 — reconciled with the Foundation Rewrite (§R).** Design (no code yet) · **v7 — time events and conditions, plus the general `chance` condition, added from Phase 14 §9 A3 (§6.4b). v6 — all four gaps closed; three of them moved to Phase 5.5 v2 where they belong. v5 — the EVENT BUS and `Trigger.given` added (§6.4–6.6), completing Event/Condition/Action; v4 — `conversation` scope; v3 — the `ConditionEvaluator` (§8.3) and `has-item` (§6.2b) folded in; all five open questions answered (§11)**
**Depends on:** Foundation Phases 1–5 (F: variables, bus, triggers, evaluator, executor), Phase 10 v6 (the formula graph), Phase 11 v2 (save scoping)
**Blocks:** Phase 13 (dialogue gating, shop conditions), Phase 14 (time conditions), Phase 15 (discovery gating)
**Stage:** Stage 1 · **Effort:** High · **Chunks:** one

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

**v8 revision:** reconciled with the Foundation Rewrite. Most of this phase's machinery moved into F Phase 2, because the foundation's rule is that anything a later phase would otherwise restructure belongs there. Phase 12 becomes the **authoring and inspection layer** over a state model that already runs.

### R.1 What now ships in F

| v7 section | Now in F |
|---|---|
| §4 `ProjectVariable` (with `id`, `key`, `name`, `type`, `initial`, `scope`, `readonly`, `description`, `category`) | F `VariableDef`, adopted from this design field for field (F §4.5) |
| §4.2 scopes `save`, `session`, `global` (reserved, treated as `save` with a one-time log) | F §5.7. `conversation` is added by Phase 13. |
| §5 `VariableStore` | F §5.7, including readonly and type-mismatch rejection |
| §6.1 `set-variable` with `VariableOp` (`set`, `add`, `toggle`, `set-from`) | F's action vocabulary |
| §6.2 `variable` condition (`variableId`, `comparator`, `value`) | F's condition vocabulary |
| §6.4 the event bus, queued and reentrancy-safe | F §5.5 |
| §6.4b `chance` | F, seeded from the save's RNG |
| §6.5 `Trigger` with `when` / `given` / `then`, `once`, `enabled`; global `project.triggers` beside map triggers | F §4.5 |
| §8 `ActionExecutor` and `ConditionEvaluator` | F §5.6 |

**Reentrancy:** F's cap (8 dispatch rounds per tick, the remainder carried to the next tick with a diagnostic) supersedes §6.4's depth cap of 32. A loop slows down rather than stopping.

### R.2 What Phase 12 still owns

- The full **Variables editor** beyond F's basic list: categories, the searchable picker everywhere a variable is chosen.
- The **usage view**, scanning the whole project including dialogue trees, cached and invalidated on edit.
- **Delete protection** naming counts, and the **runaway-counter warning**.
- The playtest **watch panel**.
- **`explain()`**, added to F's evaluator: an additive method that Phase 13 uses for locked dialogue choices.
- **Constants in formula graphs**: the `variable` node, on Phase 10's graph.
- **Faction favor sugar**: creating a faction auto-creates `favor_<factionId>`.
- The **`fire-event`** action and the **`custom`** event.

### R.3 Vocabulary belongs to the phase that owns the state

v7 listed every event and several conditions here. Under F, each entry is added by the phase that owns the state it reads or the system that emits it, so nothing is authorable before something can make it true:

| Entries from §6.2b, §6.4, §6.4b | Owner |
|---|---|
| `has-item` condition | Phase 8 (with `has-currency`) |
| `item-acquired`, `item-lost`, `item-used`, `currency-changed` | Phase 8 |
| `equipped`, `entity-damaged` | Phase 7 |
| `skill-learned`, `skill-cast` | Phase 10 |
| `level-up` | Phase 9 |
| `game-started`, `save-loaded` | Phase 11 |
| `dialogue-*`, `shop-transaction`, `faction-changed` | Phase 13 |
| time events and time conditions, `elapsed-time-reached` | Phase 14 |
| `map-loaded`, `map-unloaded`, `region-entered`, `region-exited`, `interacted`, `entity-died`, `entity-spawned`, `variable-changed`, `timer-fired` | F |
| `custom` | Phase 12 |

### R.4 Naming, aligned with F

- The discriminant is **`type`** everywhere, never `kind` (§6.4 and §6.4b used `kind`).
- `zone-enter` / `zone-exit` → `region-entered` / `region-exited`; `zone-interact` and `entity-interacted` → `interacted`; `map-entered` → `map-loaded`; `map-exited` → `map-unloaded`.
- `play-time-elapsed` and `elapsed-time-reached` were the same event; only `elapsed-time-reached` remains.
- `EntityMatch` is F's: `{ by: 'id' }` → `{ by: 'placement' }`; `{ by: 'enemyDef' }` → `{ by: 'archetype' }`; `{ by: 'tag' }`, `{ by: 'faction' }`, `{ by: 'any' }` unchanged.
- `chance { probability }` keeps this document's field name.

### R.5 Moot in a greenfield build

There is no `flag-set` to delete, no `MapTrigger` to migrate, and no `run-script`: F's `show-message` is the honest debug line. §1's findings remain as the reason F's state model looks the way it does.

### R.6 Testing, trimmed

Tests for the store, scopes, ops, readonly, the bus, reentrancy, `Trigger.given`, and `chance` move to F. This phase keeps: usage view completeness, delete protection, runaway warning, watch panel, `explain()` for every condition variant, formula constants, faction favor, and `fire-event`.

---

## 0. What this phase actually is

Three things wearing one name. Worth separating up front, because they have different lifetimes and different owners:

| | What it is | Lives in | Example |
|---|---|---|---|
| **Constant** | An authored named number. Never changes at runtime. | Project | `BOSS_DOOR_KEY_COUNT = 3` |
| **Variable** | Per-player state the game reads and writes. | Save | `gold_earned_total = 4820` |
| **Flag** | A variable whose type is `bool`. Not a separate concept. | Save | `met_annwen = true` |

"Flag" is the word everyone uses for the boolean case, and pretending it is a distinct mechanism would double the schema for nothing. **One `ProjectVariable` type covers all three**, discriminated by `type` and `readonly`.

---

> ⚠ **Superseded — historical: these findings describe v0.6.0 and shaped F Phase 2 (§R.5).**

## 1. Three findings from source that change the shape of this phase

I checked the shipped code rather than the docs. All three are load-bearing.

### 1.1 ★ Flags are already authorable — and completely inert

`Condition` in `types.ts` has shipped since Phase 1 with:

```ts
| { type: 'flag-set'; flag: string; value: boolean }
```

and `GameplayRulesEditor.tsx` renders a full editor for it — a dropdown entry ("Flag is set") and a free-text input for the flag name. **A creator can author a flag condition today.**

What does not exist: any `set-flag` action, any storage for a flag value, and any evaluator that reads one.

**And it is worse than "never becomes true."** Win and lose conditions are evaluated in `playtest.ts` like this:

```js
rules.loseConditions.some((c) => c.type === 'player-defeated')
```

That checks whether a condition of that *type is present*. It never evaluates anything. So a `flag-set` win condition does not merely fail to fire — **there is no code path that would ever look at it.** The same is true of `entity-defeated`, `reach-zone`, and `turn-limit`, all of which the editor happily authors.

This is worse than a missing feature, because it looks present. It is the strongest argument for this phase existing, and it means Phase 12 is partly **finishing** something rather than starting it.

**Consequence, and it is now upstream:** **Phase 5.5 v2 deletes `flag-set` outright** — variant and editor entry both. Removing something that does nothing is zero behavior change, which is that phase's charter, and doing it there spares seven phases of an editor offering a feature that cannot work. Phase 12 supersedes it with a typed `variable` condition backed by a registry (§6.2), so nothing is lost and no migration is needed.

### 1.2 ★ There was no trigger executor — only a closure

Earlier drafts of Phase 8 and Phase 10 said item and status-effect scripts "reuse Phase 1's `TriggerAction[]` executor." **No such executor existed.**

What existed was `runActions()` at `App.tsx:1010` — a closure inside the React component, reaching for `managerRef.current`, `play.current`, `plog()`, and `setDialogue()`. It could not be called from an item, a status effect, a dialogue node, or a test.

**The extraction moved to Phase 5.5 v2 §3.8**, and the reason is a sequencing bug this document created: **Phase 8 ships item scripts and Phase 10 ships status-effect scripts that call this executor — four and two phases before Phase 12 would have built it.** Pointing those documents at Phase 12 would have documented the problem rather than fixed it.

The extraction is a pure refactor, which makes Phase 5.5 the right home and its 88-unmodified-tests gate the strongest available verification. **Phase 12 inherits a working `ActionExecutor`** and does two things to it: injects `variables` into its context, and adds the new action variants in §6.1. No surgery on live playtest code.

### 1.3 ★ There is no condition evaluator either

Condition evaluation is scattered inline. `playtest.ts:153–159` handles behavior-machine transitions (`distance`, `hp-threshold`, `line-of-sight`) with an if-chain; `playtest.ts:255–258` does the presence-check above for win/lose. Nothing shared, nothing reusable, and no single place that knows how to answer "is this condition true right now?"

This matters more than it looks, because **Phase 12 adds a `variable` condition variant** (§6.2). Ship that against the current code and it is exactly as inert as `flag-set` is today — a new authorable condition that nothing evaluates. That would be an embarrassing repeat of the bug this phase exists to fix.

So Phase 12 builds a **`ConditionEvaluator`, symmetric to the `ActionExecutor`** (§8.5). Same shape, same discipline, same import-list assertion.

### 1.5 ★ `MapTrigger` has no conditions, and only three events — all spatial

The shipped type, verbatim:

```ts
interface MapTrigger {
  id: UUID;
  name: string;
  zone: TriggerZone;                                 // MANDATORY. always spatial.
  event: 'on-enter' | 'on-exit' | 'on-interact';     // three events, all spatial
  actions: TriggerAction[];
  once: boolean;
}
```

Two problems, and they are the same problem.

**There is no `conditions` field.** A trigger cannot be gated. Earlier versions of this document added condition *variants* and an evaluator without noticing that the most important consumer has nowhere to put one. That is a gap in my own design, and it is closed in §6.4.

**`zone` is mandatory, so every trigger is spatial.** "When the Vampire Lord dies" is not expressible. Nor is "when the player takes this dialogue choice," "when 25 wolves have died," or "when the player learns this spell."

Benchmarked against the Warcraft III trigger editor — Event, Condition, Action — LoreBrix has a crippled **E** (three events, all spatial), a **C** that is not wired to triggers at all, and a serviceable **A**. This phase's whole thesis is that LoreBrix has no state model; it built the read half and the write half and left out the *when*. **§6.4 and §6.5 complete the triad.**

### 1.6 `run-script` is a `console.log`

`{ type: 'run-script'; script: string }` executes as `plog(a.script)` — it prints its own text. There is no interpreter, and starter content uses it as flavor text (*"You found 50 gold! (script hook fired)"*).

Phase 12 does **not** build a scripting language. It makes the honest thing possible instead: with `set-variable` and `check-variable` in the vocabulary, most of what creators would reach for a script to do becomes authored data. `run-script` stays as a debug-log action and is renamed in the UI to say so (§8.3).

---

## 2. Goal

Give LoreBrix a complete **Event / Condition / Action** model: authored constants, per-save variables, an event bus, the conditions that gate and the actions that write, a reusable executor and evaluator, and the editor to manage it all.

## 3. Non-goals

- **A scripting language.** §1.3. Named constants in formula graphs plus variable actions and conditions are the sanctioned power.
- **Quests.** Built on top of this, and now owned: **Phase 13.5**. It needs a quest database, a runtime tracker, a journal screen, and save state — a phase, not a field. Phase 12 supplies the conditions its objectives are written in.
- **Dialogue gating UI.** Phase 13. Phase 12 supplies the condition type; Phase 13 puts it on dialogue branches.
- **Time-based conditions.** Phase 14 adds them to the same vocabulary once a clock exists.
- **Global/cross-save variables** (a "you have beaten this game before" flag surviving a new playthrough). Deliberately omitted — see §11 Q3.

---

> ⚠ **Superseded — adopted into F as `VariableDef` (§R.1).**

## 4. The data model

```ts
type VariableValue = boolean | number | string;

interface ProjectVariable {
  id: UUID;
  key: string;                    // 'met_annwen' — unique, the stable reference
  name: string;                   // "Met Annwen" — human label in pickers
  type: 'bool' | 'number' | 'string';
  initial: VariableValue;

  scope: 'save' | 'session' | 'conversation' | 'global';   // §4.2. Default: 'save'.
  readonly: boolean;              // true = CONSTANT (§4.3)

  description?: string;           // shows in the condition picker — worth its weight
  category?: string;              // grouping in the editor
}

// project.variables: ProjectVariable[]   ← the array Phase 5.5 already reserved
```

### 4.1 `key` versus `id`

Both, deliberately. `id` is what actions and conditions store, so **renaming a key never breaks a reference**. `key` is what a creator types and reads, and what a formula graph names. Storing the key in references instead would make rename a find-and-replace across every trigger in the project, which is how creators end up never renaming anything.

Keys are `[a-z0-9_]+`, unique per project, validated on entry.

### 4.2 Scope

- **`save`** — persists into `SaveState.variables` (Phase 11 §6). Story flags, counters, quest state.
- **`session`** — resets to `initial` on load. Puzzle state within a room, a temporary "the guard is alerted" flag. Keeps the save file free of state nobody needs preserved.
- **`conversation`** — resets when a conversation ends by any route: a choice with `next: null`, a node chain running out, the player closing the window, or an interruption. *"Has he already mentioned the war in this conversation?"* — state that should vanish when you walk away. Owned by Phase 13's `DialogueRunner`, which fires the reset from its single `end()` exit point. **Never serialized**, since a save taken mid-conversation is not a supported state.
- **`global`** — **RESERVED, Stage 2.** Survives across every playthrough of a project: *"you have beaten this before,"* *"you unlocked the third class."* A global properly belongs to a player **account**, not a save, so implementing it against local storage now means implementing it twice. The enum value exists from day one because adding it later would migrate every save — the same trick as Phase 9's `mode: 'general' | 'tea'` toggle and Phase 11's `projectVersionId`.

  **In Stage 1 the editor does not offer `global`**, and a project that somehow contains one treats it as `save`-scoped with a one-time log. Nothing silently misbehaves.

  Worth naming why the value is reserved rather than skipped: **Phase 11 added permadeath**, and the classic roguelike loop is *die, unlock something permanent, try again*. Without globals, every permadeath run starts identical forever. Pure ironman is a legitimate design, but foreclosing Rogue Legacy or Hades-style meta-progression entirely is a large genre to close off in a product whose pitch is letting creators build what they want.

**Default scope for a new variable is `save`, and the asymmetry is the reason.** Defaulting to `session` costs a creator a story flag that silently resets on load — a confusing bug that is genuinely hard to trace. Defaulting to `save` costs an occasional unnecessary boolean in a save file. One of those is a bug report; the other is a rounding error.

### 4.3 Constants are `readonly` variables

A constant is a variable that `set-variable` refuses to write. Same type, same editor, same picker. `BOSS_DOOR_KEY_COUNT = 3` is authored once and referenced from a trigger condition and a dialogue line, so changing the dungeon's difficulty is one edit rather than a hunt.

**`readonly` is enforced at three layers, and it needs all three:** the editor won't offer a constant as a `set-variable` target; the executor refuses at runtime and logs; and constants aren't written into `SaveState.variables` at all, because their value lives in the project. That last one matters — a constant that got into a save would freeze at its old value the moment the creator changed it.

---

> ⚠ **Superseded — the store is F's (§R.1).**

## 5. The runtime store

```ts
class VariableStore {
  constructor(defs: ProjectVariable[], saved?: Record<string, VariableValue>);

  get(key: string): VariableValue;          // saved → initial → type zero-value
  getNumber(key): number;                   // typed accessors; wrong type logs and
  getBool(key): boolean;                    // returns the zero-value rather than throwing
  set(key: string, value: VariableValue): SetResult;
  apply(op: VariableOp): SetResult;         // §6.1
  serialize(): Record<string, VariableValue>;   // save-scoped ONLY
  resetSession(): void;
  onChange(fn: (key, oldV, newV) => void): Unsubscribe;
}

type SetResult =
  | { ok: true; previous: VariableValue }
  | { ok: false; reason: 'unknown-key' | 'readonly' | 'type-mismatch' };
```

**Unknown keys never throw.** A dangling reference to a deleted variable returns the type's zero value and logs once. A game that crashes because a creator deleted a flag is worse than one where a door quietly stays shut — and §9's usage view makes the dangling reference findable.

`onChange` exists because Phase 13's dialogue and Phase 15's discovery both need to react to a variable changing without polling.

---

## 6. Extending the vocabularies

> ⚠ **Superseded — these actions are F's (§R.1).**

### 6.1 New `TriggerAction` variants

```ts
| { type: 'set-variable'; variableId: UUID; op: VariableOp }

type VariableOp =
  | { kind: 'set'; value: VariableValue }
  | { kind: 'add'; value: number }          // number only — counters
  | { kind: 'toggle' }                      // bool only
  | { kind: 'set-from'; sourceVariableId: UUID };
```

`add` is what makes counters work without a script (`enemies_slain += 1`), and it is atomic — read-modify-write in the executor, never in authored data.

**`add` on a string is rejected** with `type-mismatch`, and it is a boundary decision rather than a feature one. Allow concatenation and creators build sentences out of triggers, then want substrings, then formatting, then conditionals inside strings — a scripting language arriving through the back door, which §3 declares a non-goal. Rejecting costs one branch and keeps that non-goal honest. The editor does not offer `add` for string variables at all.

### 6.2 New `Condition` variant

```ts
| { type: 'variable'; variableId: UUID;
    comparator: '==' | '!=' | '<' | '<=' | '>' | '>=';
    value: VariableValue }
```

One variant covers every case. `met_annwen == true` is a flag check; `keys_held >= 3` is a gate; `chosen_faction == 'elves'` is a branch. The editor renders comparators appropriate to the variable's type, so a bool shows only `==` and `!=`.

**This supersedes `flag-set`** (§7).

> ⚠ **Superseded — `has-item` is owned by Phase 8 (§R.3).**

### 6.2b `has-item` lands here too

Phase 8 noted that a "player has item X" condition would arrive "with Phase 13's door and dialogue work." It belongs **here** instead, for the same reason `variable` does: Phase 12 owns the `Condition` vocabulary and the evaluator that reads it. Phase 13 is a *consumer* of conditions, not their author.

```ts
| { type: 'has-item'; itemDefId: UUID; quantity: number }   // quantity defaults to 1
```

Evaluated against `SaveState.character.inventory` (Phase 11). It is what makes a locked door work — *"the iron key opens this"* — without a script, and Phase 13's dialogue gating gets it for free rather than inventing a parallel check.

> ⚠ **Superseded — the bus is F's; each event is owned by its emitter, and names follow §R.4.**

### 6.4 The event bus — the missing third of E/C/A

```ts
type GameEvent =
  // ── SPATIAL (the three that exist today) ────────────────
  | { kind: 'zone-enter';  zoneId: UUID }
  | { kind: 'zone-exit';   zoneId: UUID }
  | { kind: 'zone-interact'; zoneId: UUID }

  // ── WORLD ───────────────────────────────────────────────
  | { kind: 'map-entered'; mapId: UUID }
  | { kind: 'map-exited';  mapId: UUID }

  // ── ENTITIES ────────────────────────────────────────────
  | { kind: 'entity-died';        match: EntityMatch }
  | { kind: 'entity-damaged';     match: EntityMatch }
  | { kind: 'entity-interacted';  match: EntityMatch }
  | { kind: 'entity-spawned';     match: EntityMatch }
  | { kind: 'faction-changed';    match: EntityMatch }

  // ── DIALOGUE (Phase 13) ─────────────────────────────────
  | { kind: 'dialogue-choice-taken'; treeId: UUID; nodeId: string; choiceId: string }
  | { kind: 'dialogue-node-reached'; treeId: UUID; nodeId: string }
  | { kind: 'dialogue-ended';        treeId: UUID }

  // ── PLAYER ──────────────────────────────────────────────
  | { kind: 'item-acquired'; itemDefId: UUID }
  | { kind: 'item-lost';     itemDefId: UUID }
  | { kind: 'item-used';     itemDefId: UUID }
  | { kind: 'equipped';      slot: EquipSlot }
  | { kind: 'skill-learned'; skillId: UUID }
  | { kind: 'skill-cast';    skillId: UUID }
  | { kind: 'level-up' }
  | { kind: 'currency-changed'; currencyId: UUID }

  // ── STATE ───────────────────────────────────────────────
  | { kind: 'variable-changed'; variableId: UUID }
  | { kind: 'shop-transaction'; shopId: UUID }

  // ── LIFECYCLE ───────────────────────────────────────────
  | { kind: 'game-started' }
  | { kind: 'save-loaded' }
  | { kind: 'play-time-elapsed'; ms: number }   // fires once, at N ms of elapsed play

  // ── TIME (Phase 14) ─────────────────────────────────────
  | { kind: 'game-hour-changed' }
  | { kind: 'game-day-changed' }
  | { kind: 'game-month-changed' }
  | { kind: 'game-season-changed' }
  | { kind: 'game-year-changed' }
  | { kind: 'dawn' }
  | { kind: 'dusk' }
  | { kind: 'game-time-reached'; year?: number; monthIndex?: number;
      day?: number; hour?: number; minute?: number }   // omitted = wildcard
  | { kind: 'game-day-of-month'; day: number }          // "every 21st"
  | { kind: 'game-day-of-week'; dayNameIndex: number }  // "every Middas"
  | { kind: 'elapsed-time-reached'; ms: number }        // absolute, fires once

  // ── EXTENSION ───────────────────────────────────────────
  | { kind: 'custom'; name: string };           // fired by a `fire-event` action
```

**★ `EntityMatch` is the piece that makes counting quests possible.**

```ts
type EntityMatch =
  | { by: 'id';      entityId: UUID }
  | { by: 'tag';     tag: string }        // "any entity tagged 'morthal-vampire'"
  | { by: 'faction'; factionId: FactionId }
  | { by: 'enemyDef'; enemyDefId: UUID }
  | { by: 'any' };
```

Without matching by tag, *"kill 25 Morthal vampires"* needs 25 hand-placed hooks against 25 specific entity ids — and breaks the moment a creator adds a 26th vampire. Matching by tag makes it one trigger. This is the difference between a usable event system and a demo.

**`custom` + a `fire-event` action** is the extension seam. A creator who needs an event we did not think of fires one from any action list and listens for it anywhere else. It keeps the union closed and honest rather than inviting a new variant per request.

```ts
// TriggerAction — additional variants
| { type: 'fire-event'; name: string }
| { type: 'advance-time'; gameMinutes: number }   // Phase 14 rest and Phase 15 travel
| { type: 'interrupt-rest' }                      // Phase 14 §7.2
```

**The bus itself:**

```ts
class EventBus {
  emit(event: GameEvent): void;
  subscribe(pattern: EventPattern, fn: (e: GameEvent) => void): Unsubscribe;
}
```

**Emission is synchronous and reentrant-safe.** An action that fires an event whose trigger fires another action must not recurse forever. The bus queues events raised *during* dispatch and drains them after the current dispatch completes, with a depth cap (default 32) that logs and stops rather than freezing the tab. A creator can build an infinite loop; it should cost them a warning, not the browser.

> ⚠ **Superseded — time entries are Phase 14's; `chance` is F's (§R.3).**

### 6.4b Time conditions, and the general `chance` gate

Phase 14 amendment A3. Its two motivating examples need one of each kind, which is why both exist: *"only on Mondays"* is a condition; *"every 21st"* is an event.

```ts
// Condition — time variants (Phase 14)
| { kind: 'game-time-between'; fromHour: number; toHour: number }   // wraps past midnight
| { kind: 'game-day-name-is'; dayNameIndex: number }
| { kind: 'game-month-is'; monthIndex: number }
| { kind: 'game-season-is'; seasonIndex: number }
| { kind: 'game-date-is'; day: number; monthIndex?: number; year?: number }
| { kind: 'is-night' }

// Condition — the general probabilistic gate. NOT time-specific.
| { kind: 'chance'; probability: number }    // 0..1, evaluated once per check
```

**★ `chance` is a Phase 12 gap that only surfaced through a Phase 14 example.** *"Waiting in a hostile area has a 10% chance of a random encounter every hour"* has no probabilistic condition to hang on — Phase 4's formula evaluator has an RNG, but the condition vocabulary has none. It belongs here rather than in Phase 14 because gating a random ambush on a zone entry is the same need with no clock involved.

**Seeded from the save**, so reloading and re-triggering the same check yields the same answer rather than letting a player reroll a failed gate.

When `CalendarDef.enabled` is false, the six time conditions are hidden from pickers; `chance` is always available.

> ⚠ **Superseded — F's `TriggerDef`; no migration exists (§R.1, §R.5).**

### 6.5 `Trigger` — `MapTrigger` generalized

```ts
interface Trigger {
  id: UUID;
  name: string;                  // "Alva_at_Volkihar" — authored, shown in the editor
  when: GameEvent;               // ★ the EVENT — was a spatial enum
  given: Condition[];            // ★ NEW — the CONDITIONS. Empty = always passes.
  then: TriggerAction[];         // the ACTIONS (was `actions`)
  once: boolean;
  enabled: boolean;              // NEW — triggers can be switched off by other triggers
}
```

**`when` / `given` / `then` are deliberate names.** Event, condition, action — and the distinction between *what fires* and *what must be true when it fires* is load-bearing. Collapse them into one bucket and every trigger has to re-check its own event, and the same event with different conditions stops being expressible as two triggers.

**Where triggers live.** `zone-*` events are inherently per-map and stay on `TileMap.triggers`. Everything else is global and moves to `project.triggers: Trigger[]` — because *"when the Vampire Lord dies"* must fire regardless of which map the player is standing on. A quest given in Solitude, executed in Morthal, and resolved at Castle Dawnguard cannot have its triggers attached to a map.

**Migration:** every existing `MapTrigger` becomes `{ when: { kind: 'zone-enter', zoneId }, given: [], then: actions, once, enabled: true }`. Mechanical, and Emberfall has two triggers.

### 6.6 Faction favor is a variable — no new system needed

A standing model like *"killing the Vampire Lord grants +30 favor with the Dawnguard; Isran admits you at 25"* is, mechanically, a number an action writes and a condition reads:

```
action:     set-variable  favor_dawnguard  op: { kind: 'add', value: 30 }
condition:  variable      favor_dawnguard  >=  25
```

That is a `number`-typed, `save`-scoped variable and the machinery already in this phase. **It works the day Phase 12 ships.**

One piece of sugar, because discoverability matters: **creating a `FactionDef` auto-creates a `favor_<factionId>` variable** (number, save-scoped, initial 0, category `Faction Favor`). It then appears in every picker alongside everything else, and a creator never has to know they invented a convention.

What a dedicated standing *phase* would add is the automatic wiring — favor driving acquisition so a faction turns hostile on its own, favor scaling shop prices, a standing UI. None of that is needed for gated dialogue, gated shops, or gated quests, which is what the scenario actually requires. It stays an unnumbered roadmap candidate, now with a smaller job than it had.

### 6.7 Constants in formula graphs

Phase 4's `FormulaGraph` gains one node kind:

```ts
| { kind: 'variable'; variableId: UUID }    // resolved at evaluation time
```

`evaluateFormulaGraph` takes the `VariableStore` as an optional parameter. **Only `number`-typed variables are offered** in the node picker — a formula referencing a string is a category error the UI should prevent rather than the evaluator handle.

This is the payoff for constants: a damage formula reading `BOSS_DAMAGE_MULT` instead of a magic `2.5` buried in a node.

---

> ⚠ **Superseded — moot in a greenfield build (§R.5).**

## 7. `flag-set` — deleted upstream

Phase 5.5 v2 removes the variant and its editor entry. No migration code, no auto-creation of orphan variables, nothing for this phase to do. §6.2's `variable` condition is its typed replacement.

> ⚠ **Superseded — both are F's; Phase 12 adds `explain()` (§R.2).**

## 8. The `ActionExecutor` (inherited) and the `ConditionEvaluator` (new)

### 8.1 The shape it arrives with

```ts
interface ActionContext {
  project: Project;
  variables: VariableStore;
  entities: EntityManager;
  player: CombatantEntity | null;
  log(message: string): void;
  openShop?(merchantId: UUID): void;
  openDialogue?(treeId: UUID): void;
  teleport?(mapId: UUID, to: GridPos): void;
  playAudio?(audioId: UUID, fadeMs?: number): void;
}

class ActionExecutor {
  constructor(ctx: ActionContext);
  run(actions: TriggerAction[]): ActionResult[];
  canRun(action: TriggerAction): boolean;    // dry-run, for editor validation
}
```

**Phase 5.5 built this.** Phase 12's only change is the first line of the context — `variables: VariableStore` — plus the new variants in §6.1. The context was designed in 5.5 to grow exactly this way.

Every UI concern is an **optional callback**. The executor never imports React, never touches component state. In a test, you pass a context with `log` collecting into an array and everything else absent; actions that need a missing callback report `unavailable` rather than crashing.

**Enforced the same way as Phase 11's panels, because advice does not survive implementation:** *the executor module imports nothing from `App.tsx` or any React module.* A one-line assertion over its import list, in the test plan below.

### 8.2 Who calls it

| Caller | Since | Status today |
|---|---|---|
| Map triggers | Phase 1 | works, via the closure |
| Prop `onInteract` | Phase 1 | works, via the closure |
| Dialogue node actions | Phase 1 | works, via the closure |
| **Item scripts** | Phase 8 | works — Phase 5.5 extracted the executor first |
| **Status effect scripts** (`onApply`/`onTick`/`onExpire`) | Phase 10 | works — same |
| Dialogue gating | Phase 13 | will assume it |
| Quest objectives and turn-in | Phase 13.5 | will assume the executor, the evaluator, **and the event bus** |

Moving the extraction to Phase 5.5 is what makes the first two rows true rather than aspirational.

### 8.3 The `ConditionEvaluator` — the executor's twin

An action **writes**; a condition **reads**. They are the two halves of the same state model and they get the same treatment.

```ts
interface ConditionContext {
  project: Project;
  variables: VariableStore;
  entities: EntityManager;
  player: CombatantEntity | null;
  terrain: TerrainService;        // for line-of-sight, via Phase 10's castRay
  turnNumber?: number;            // turn-based only
  log(message: string): void;
}

class ConditionEvaluator {
  constructor(ctx: ConditionContext);
  evaluate(condition: Condition): boolean;
  evaluateAll(conditions: Condition[], mode: 'all' | 'any'): boolean;
  explain(condition: Condition): string;   // "keys_held (2) >= 3 → false"
}
```

**It must handle every existing variant, not just the new ones.** `distance`, `hp-threshold`, `line-of-sight`, `entity-defeated`, `reach-zone`, `turn-limit`, `player-defeated`, `all-enemies-defeated` — several of which are authorable today and evaluated nowhere (§1.1). Phase 12 is where they start working.

**`explain()` earns its place.** A creator whose door will not open needs to know *which* condition failed and with what values. It also drives the playtest watch panel (§9) and turns "my quest is broken" into a self-service answer.

Same enforcement as the executor: **the module imports nothing from `App.tsx` or React**, asserted over its import list.

**Consumers, and the two that are currently broken:** behavior-machine transitions (works today, moves here), win/lose conditions (**broken today** — presence-checked, never evaluated), **trigger gating via `Trigger.given` (§6.5 — has nowhere to attach today)**, dialogue gating (Phase 13), and quest objectives (Phase 13.5).

> ⚠ **Superseded — there is no `run-script`; use F's `show-message` (§R.5).**

### 8.4 `run-script` is renamed, not removed

Its editor label becomes **"Debug Log"** with helper text saying it prints a message to the play log and does not execute code. Same behavior, honest name. Emberfall's two uses are flavor text and keep working.

---

## 9. The editor

A Variables tab, sibling of the five database panels — but with one addition none of them have, and it is the reason this panel earns its keep.

**The list:** grouped by `category`, showing key, name, type, initial value, scope, and a constant badge. Create, edit, duplicate, delete.

**★ The usage view.** Select a variable and see every place it is read and written, with a jump-to link: which triggers set it, which conditions test it, which dialogue nodes gate on it (Phase 13), which formula graphs reference it. It converts the single worst failure mode of any flag system ("what breaks if I delete this?") into an answerable question.

**The scan covers the entire project — every map, not just the open one — and is cached, invalidated on edit.** A partial scan is worse than none here: a creator deletes a variable that *looks* unreferenced, and a door on map 7 silently never opens, with the failure surfacing hours of playtime later and disconnected from its cause. That is precisely the failure this panel exists to prevent, so a half-answer defeats the panel.

The scan must cover **dialogue trees as well**, since Phase 5.5 promoted them to their own top-level database and Phase 13 will gate branches on variables. Deciding "everything" now means the scan is built once with the right shape rather than widened twice.

Cost is a cache invalidated on edit. Stage 1 projects are small; this is cheap now and structurally correct later.

**★ Runaway-counter warning.** The usage view flags any `set-variable` with `op.kind === 'add'` sitting inside a trigger whose `once` is false: *"`enemies_slain` is incremented by a repeatable trigger — it may grow without bound."* No clamp, no refusal — a warning, in the same spirit as Phase 7's Combat Sanity Check. The real scenario is a creator putting `add: 1` in a trigger they believed fired once and later wondering why a counter reads 4,000.

**Delete protection.** Deleting a referenced variable warns with the count and the list, in the pattern Phase 11 §12.5 established: *"`met_annwen` is used by 2 conditions and 1 trigger. Delete anyway?"* Constants get the same treatment against formula graphs.

**The picker.** Everywhere a variable is chosen, it is a searchable dropdown showing name, key, and description — never a free-text field. Free text is how `flag-set` produced flags that nothing could ever set.

**A live watch panel during playtest**, showing current values updating in real time. Debugging a puzzle gate by reading a table beats adding log statements.

---

## 10. Testing

- **★ Executor isolation:** the executor module's import list contains nothing from `App.tsx` or React, and every action runs correctly against a synthetic context with only `log` provided.
- **★ Evaluator isolation:** the same assertion for `ConditionEvaluator`, evaluated against a synthetic context with no editor and no React present.
- **★ `chance` is seeded and stable:** reloading a save and re-triggering the same check returns the same result; across many trials the observed rate matches `probability`.
- **Time conditions and events** evaluate against a `GameTime` context and are hidden from pickers when no calendar is enabled.
- **★ Event bus fires and matches:** each event kind emits and reaches its subscriber; `EntityMatch` by tag catches every tagged entity while `by: 'id'` catches exactly one; a `custom` event fired by `fire-event` reaches a listener.
- **★ Counting by tag:** killing 25 entities tagged `morthal-vampire` fires 25 `entity-died` events matching one trigger — no per-entity wiring, and adding a 26th entity needs no authoring change.
- **★ Reentrancy:** an action that fires an event whose trigger fires another action drains cleanly; a deliberate infinite loop stops at the depth cap with a log rather than freezing.
- **★ `Trigger.given` gates:** a trigger whose event fires but whose conditions fail does not run its actions, and `once` is **not** consumed by a gated miss.
- **Global vs map triggers:** a non-spatial trigger fires while the player is on a different map; a `zone-*` trigger fires only on its own map.
- **Trigger migration:** every existing `MapTrigger` converts to `{ when: zone-enter, given: [], then, once, enabled: true }` with identical behavior.
- **Faction favor:** creating a `FactionDef` auto-creates `favor_<factionId>`; adding 30 and testing `>= 25` behaves as any other number variable; it serializes as save-scoped.
- **★ Every condition variant evaluates.** Each of the eight existing variants plus `variable` and `has-item` returns a correct boolean against a constructed context. Specifically: **a `flag-set`-derived `variable` win condition actually fires when the variable becomes true** — the bug in §1.1, closed and guarded.
- **`has-item`:** true when the inventory holds the required quantity, false below it, and false rather than throwing when the item definition has been deleted.
- **`explain()`:** returns the operand values and the outcome for every variant, and never throws on a dangling reference.
- **Executor parity:** every action type behaves identically to today's `runActions` for the six existing variants — this is an extraction, and a behavior change here would be a regression.
- **Store basics:** `get` falls back initial → zero-value; typed accessors on a wrong type log and return the zero-value rather than throwing; unknown keys never throw.
- **`readonly` at all three layers:** `set-variable` on a constant returns `{ ok: false, reason: 'readonly' }`, the editor never offers it as a target, and constants never appear in `serialize()`.
- **Ops:** `add` accumulates atomically across rapid fires; `toggle` flips; `set-from` copies; **`add` on a bool or a string returns `type-mismatch`**, and the editor never offers `add` for those types.
- **★ Reserved `global` scope:** the editor does not offer it; a project containing one treats it as `save`-scoped and logs once; no save serialization path writes it separately.
- **★ Scope:** `save`-scoped variables round-trip through save → quit → load; `session`-scoped reset to `initial` on load; only save-scoped values appear in the serialized payload.
- **Conditions:** each comparator evaluates correctly per type; a condition on a deleted variable evaluates false and logs rather than throwing.
- **★ Legacy migration:** a `flag-set` condition matching an existing key rewrites to the variable form; one with no match auto-creates the variable and rewrites; a project with zero flag conditions is untouched.
- **Formula constants:** a graph referencing a number variable evaluates with its current value and re-evaluates after a change; the node picker offers no string variables.
- **★ Usage view scans everything:** a variable referenced only from a map that is *not* currently open is still reported, as is one referenced only from a dialogue tree; the cache invalidates on edit and never returns a stale count.
- **Usage view:** a variable referenced from a trigger, a condition, and a formula reports all three; an unreferenced one reports zero and deletes without warning.
- **Runaway warning:** an `add` inside a `once: false` trigger is flagged; the same `add` inside a `once: true` trigger is not.
- **Non-regression:** all Phase 5.5–11 tests still pass. Emberfall's two `run-script` actions still log their text.

---

## 11. Gaps and open questions

Answering your ask directly — gaps first, since two of them are things this phase inherited rather than created.

### Gaps found — all closed

| | Gap | Resolution |
|---|---|---|
| **G1** | `flag-set` shipped inert — authorable since Phase 1, settable by nothing, readable by nothing, and win/lose conditions only *presence-check* their type so it could never have fired. | **Deleted in Phase 5.5 v2 §3.7.** Removing something that does nothing is zero behavior change, and doing it there spares seven phases of a broken affordance. §6.2's `variable` condition replaces it. |
| **G2** | The executor Phases 8 and 10 assume did not exist — only a React closure. Worse, Phase 8 ships item scripts **four phases before** Phase 12 would have built it. | **Extracted in Phase 5.5 v2 §3.8**, as a pure refactor verified by that phase's 88-unmodified-tests gate. Phase 12 inherits it working and only injects `variables` and adds variants. |
| **G3** | Nothing owned quests. | **Phase 13.5 owns them**, derived from a simulated playthrough. Phase 12 supplies the events, conditions, and actions its objectives are written in. |
| **G4** | Variables and undo — and underneath it, no stated undo story for *any* of the twelve database editors. | **Phase 5.5 v2 §3.9 states one policy for all of them:** undo covers canvas edits; database edits use explicit Save and Cancel, with destructive deletions protected by count-naming confirmations. A shared stack would make Ctrl-Z unpredictable across canvas and data. |

**What this phase actually owns after the move:** the variable registry and store, the four scopes, the new action and condition variants, the **event bus** (§6.4), `Trigger.given` (§6.5), the `ConditionEvaluator` (§8.3), faction favor sugar (§6.6), and the editor with its usage view.

### Open questions — all answered

| | Question | Decision |
|---|---|---|
| 1 | Usage view scan scope | **Scan everything, cache, invalidate on edit** — including dialogue trees (§9). |
| 2 | `add` on a string | **Reject** with `type-mismatch`; not offered in the editor (§6.1). |
| 3 | Cross-save globals | **Reserved in the enum, implemented in Stage 2** (§4.2). |
| 4 | Runaway counters | **Warn, do not clamp** — flagged in the usage view (§9). |
| 5 | Default scope | **`save`** (§4.2). |

**Nothing outstanding for E in this document.**

---

*LoreBrix, ELMSCORP. Phase 12 design — for review.*
