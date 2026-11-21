# Phase 13.5 — Quests & Journal · Technical Design (v2)

**Status:** **v2 — reconciled with the Foundation Rewrite (§R).** Design (no code yet)
**Depends on:** Foundation Phases 1–5 (F: **event bus**, variables, executor, evaluator), Phase 8 v7 (`give-item`, `give-currency`), Phase 11 v2 (menu, save), Phase 12 v8 (`explain()`), Phase 13 v4 (dialogue runner)
**Stage:** Stage 1 · **Effort:** High · **Chunks:** one

**Design method, worth recording:** this schema was derived by simulating a full Skyrim-style quest — *A Vampire Problem Needs A Vampire Solution* — across four rounds of review. Every field below exists because that scenario broke an earlier version. Nothing here is speculative, and several things I proposed early were **deleted** when the scenario showed they were unnecessary.

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

**v2 revision:** reconciled with the Foundation Rewrite. Everything the simulated quest proved stands: sequential stages with parallel objectives, four-valued status, `achieve` and `maintain`, counters by tag, alternative groups, nesting, rewards as actions, and authored order.

### R.1 The tracker runs on F

`QuestTracker` lives in the `runtime` package and uses F's bus, evaluator, and executor (F §5.5–§5.6). It holds **scoped subscriptions** (F §5.5), only for objectives in `available` status, and drops them on completion. `JournalView` is exposed through F's read-only view; tracking and journal actions are runtime commands. The package boundary replaces the import-list assertion.

### R.2 Triggers are F's `TriggerDef`

`completeOn`, `failOn`, and `counter.incrementOn` hold F `TriggerDef`s (`when`, `given`, `then`). Counting by tag uses F's `EntityMatch { by: 'tag' }`. The time-limit pattern uses **`elapsed-time-reached`** (Phase 14), the single surviving name for what v1 called `play-time-elapsed`; this document has been updated to match.

### R.3 Rewards use Phase 8's actions

`give-item` and `give-currency` are owned by Phase 8 (Phase 8 §R.3). The quest actions in §5.2 (`start-quest`, `fail-quest`, `set-quest-objective`, `advance-quest-stage`, `track-quest`) are added here.

### R.4 Ids, time, and schema

- `questGiverId` and `markerEntityId` are placement keys (F §4.5).
- `startedAtMs` and `completedAtMs` are simulation time (ticks × 1000/60, plus Phase 14's skipped time).
- `quests` joins the project as a minor schema revision; `quests` and `trackedQuestId` join the save.

### R.5 Ownership updates

Non-lethal defeat is owned by Phase 16 (Combat Staging), per Roadmap v0. Companions remain Phase 20.5.

---

## 0. What the simulation removed

More useful than what it added, so it goes first. Three concepts from earlier drafts turned out to be unnecessary:

| Proposed | Why it's gone |
|---|---|
| **A reward schema** (exp, currency, items) | Two of the scenario's five rewards were neither — one set a boolean (`isDateAble`), one unlocked a later stage. **Rewards are `TriggerAction[]`.** No schema, no reward type, and "reward" becomes a label on an action list. Smaller *and* strictly more expressive. |
| **Cross-quest addressing** (`questId::stageId`) | The one apparent cross-quest reference turned out to be the quest referring to its own stage. Quests coordinate through **variables**, which are already the shared bus. A second one would make quests untestable in isolation. |
| **A special "umbrella objective"** | The Isran objective sits unchecked at the top for the whole quest, which looked like a new concept. It is an ordinary objective whose completion trigger is "talk to Isran once the Lord is dead." **Turn-in is just the last objective.** |

The scenario also killed one of my conventions: **ids are opaque.** The simulation used `stage5_4_1`, encoding hierarchy in the identifier. That works until someone reorders or renames, which is exactly the hazard Phase 12 removed by separating `id` from `key`. Nesting lives in the structure; ids stay meaningless.

## 1. Goal

A quest database, a runtime tracker driven by Phase 12's event bus, quest state in the save, and the Journal screen Phase 11 shipped disabled.

## 2. Non-goals

- **Companions.** Per E: solo-play quests now, companions later, quests updated after. §9 marks exactly which objective types are *authorable but not playable* until companions exist. That gap is named, not hidden.
- **Non-lethal defeat.** *"Subdue Alva without killing her"* needs a combat outcome that is not death. Owned by Phase 16 (Combat Staging), per Roadmap v0.
- **Faction standing as a system.** Favor is a number variable as of Phase 12 §6.6, which is all the scenario needs.
- **Branching quest outcomes as a first-class structure.** A stage list plus variables covers it; branching trees are a different product.

---

## 3. Definition versus instance

The boundary that every other phase holds, applied here:

```
QuestDef       (project)  authored — name, description, stages, objectives, giver, faction
QuestProgress  (save)     played   — status, stage index, per-objective status, counters, timestamps
```

E's original schema put Start Time and End Time on the definition. They are per-player facts recorded at runtime, so they live in `QuestProgress`. Timestamps are **elapsed play milliseconds**, not wall-clock, because there is no game clock until Phase 14 — which then makes in-world dates additive.

## 4. `QuestDef`

```ts
interface QuestDef {
  id: UUID;
  name: string;                    // "A Vampire Problem Needs A Vampire Solution"
  description: string;             // the journal's framing paragraph
  category?: string;               // "Main" | "Dawnguard" | "Side" — journal grouping

  questGiverId?: UUID;             // the NPC, for the journal and for map markers
  questFactionId?: FactionId;      // grouping now; standing later

  availability: Condition[];       // §4.3 — eligibility, distinct from the start trigger
  stages: QuestStage[];

  onStart?: TriggerAction[];
  onComplete?: TriggerAction[];    // quest-level rewards
  onFail?: TriggerAction[];

  repeatable: boolean;             // default false
  trackByDefault: boolean;         // default true
}
```

Not `State` — that name already belongs to `StatusEffectDef`, `EditorState`, `SaveState`, and Phase 13's `WorldObjectState`.

### 4.1 Two levels, because the scenario needs both

The scenario's spine is strictly sequential (talk to Serana → reach Morthal → talk to Idgrod), and its payload is emphatically parallel (kill the Lord, count 25 vampires, spare Alva, in any order). One flat list with an `order` flag cannot express both.

**Stages are sequential. Objectives within a stage are parallel.**

```
Stage 1   Talk to Serana
Stage 2   Go to Morthal
Stage 3   Talk to Idgrod Ravencrone
Stage 4   ├─ Go to Wolfskull Cave
          ├─ Kill the Vampire Lord
          ├─ (opt) Kill 25 Morthal Vampires          0/25
          ├─ (opt, maintain) Do not kill Alva
          └─ (opt, alt-group) Send Alva to Valerica │ to Janus
Stage 5   Return to Isran
```

**The journal still renders one flat checklist.** The grouping is structural, not visual — which is what lets the display match E's mockups exactly while the engine knows what may run concurrently.

```ts
interface QuestStage {
  id: UUID;
  objectives: QuestObjective[];
  completeWhen: 'all-required' | 'any';   // default 'all-required' — optionals never block
  onEnter?: TriggerAction[];
  onComplete?: TriggerAction[];
}
```

### 4.2 `QuestObjective`

```ts
interface QuestObjective {
  id: UUID;                        // opaque. Never encodes hierarchy.
  text: string;                    // "Kill 25 Morthal Vampires"
  optional: boolean;

  startHidden: boolean;            // §5.2 — not in the journal until revealed

  completionMode: 'achieve' | 'maintain';   // §4.2b

  completeOn: Trigger[];           // Phase 12 v5 — when/given/then
  failOn?: Trigger[];

  counter?: {                      // §4.2c
    target: number;
    incrementOn: Trigger[];
    countdown?: boolean;           // "protect 3 caravans" style
  };

  alternativeGroupId?: string;     // §4.2d — OR-ed with its group siblings
  requiresObjectiveIds?: UUID[];   // §4.2e — parent/child

  onComplete?: TriggerAction[];    // ★ per-objective rewards (§4.2f)
  onFail?: TriggerAction[];

  markerEntityId?: UUID;           // journal and map pointer
  markerMapId?: UUID;
}
```

#### 4.2b `achieve` versus `maintain` — the finding I had no concept for

Every objective in my first model began incomplete and completed on a trigger. *"Do NOT kill Alva"* begins **satisfied** and can be permanently lost. It is not "achieve X," it is "maintain X."

- **`achieve`** — starts incomplete, `completeOn` finishes it, `failOn` fails it.
- **`maintain`** — starts *satisfied*, `failOn` breaks it irrecoverably, and `completeOn` is optional: with none, it locks in when its stage completes.

Time limits fall out of the same mechanism — a `maintain` objective whose `failOn` is `elapsed-time-reached`. That is the mark of the right abstraction: it covers a case nobody designed it for.

#### 4.2c Counters

`Kill 25 Morthal Vampires. (0/25)` needs the fraction in the journal, not just done/not-done. `incrementOn` is a `Trigger[]`, so it inherits Phase 12's `EntityMatch`: **one trigger matching `{ by: 'tag', tag: 'morthal-vampire' }` counts all 25**, and a creator adding a 26th vampire changes nothing. Without tag matching this objective needs 25 hand-wired hooks.

Progress lives in `QuestProgress.counters` and completes the objective when it reaches `target`.

#### 4.2d Alternative groups

*"Send Alva to Valerica **OR** to Janus."* Objectives sharing an `alternativeGroupId` are OR-ed: completing any one marks the whole group complete, and the journal shows them as one entry with the chosen branch resolved. The rest become unreachable rather than failed — you did not fail to send her to Skingrad, you sent her to Volkihar.

#### 4.2e Parent and child

*"Do not kill Alva"* actually resolves as *maintain Alva alive **and** complete one of the delivery alternatives*. `requiresObjectiveIds` expresses it: the objective cannot complete until its listed children have, even if its own trigger fires. Hierarchy in structure, not in the id.

> ⚠ **Superseded — `give-item` and `give-currency` are Phase 8's actions (§R.3).**

#### 4.2f Rewards are actions

Idgrod's three offers are a boolean, a pile of septims, and an item; the Vampire Lord's completion also unlocks a later stage. Making `onComplete` a `TriggerAction[]` covers every one, needs no reward schema, and inherits every action the engine ever gains.

```
Kill the Vampire Lord      → [ set-variable isDateAble_Idgrod = true,
                               set-quest-objective <isran> → available ]
Kill 25 Morthal Vampires   → [ give-currency septims 10000 ]
Spare and deliver Alva     → [ give-item seers_stone ]
Send Alva to Valerica      → [ give-item valericas_sword ]
Send Alva to Janus         → [ give-item janus_ring ]
```

### 4.3 Availability versus the start trigger

Two different questions, kept apart: `availability` decides *whether the player may receive it* (level, prior quests, faction favor); the `start-quest` action decides *when they do*. Separating them is what lets a journal list quests you are eligible for but have not begun — and it means a quest-giver's dialogue choice can be gated on availability without duplicating the logic.

## 5. Runtime

### 5.1 Four-valued status — the scenario's clearest finding

`stage6 = AVAILABLE` is not "revealed," it is **actionable**. Reading the three journal snapshots together:

| status | journal |
|---|---|
| `hidden` | absent entirely |
| `available` | listed, actionable — ☑️ |
| `complete` | ✅ |
| `failed` | ❌ |

A `hidden` boolean plus done/not-done cannot express the difference between *"you have not discovered this"* and *"you have discovered it and cannot act on it yet."* The Isran objective is visible from minute one and not actionable until the Lord is dead.

```ts
// QuestProgress — in SaveState
interface QuestProgress {
  questId: UUID;
  status: 'available' | 'active' | 'complete' | 'failed';
  currentStageIndex: number;
  objectives: Record<UUID, {
    status: 'hidden' | 'available' | 'complete' | 'failed';
    startedAtMs?: number;
    completedAtMs?: number;
  }>;
  counters: Record<UUID, number>;
  startedAtMs: number;
  completedAtMs?: number;

  /**
   * Phase 14 §9 A6. Captured AT THE TIME, not derived later — a creator who changes
   * msPerGameDay afterward would otherwise re-derive a wrong in-world date.
   * Makes "begun on the 17th of Sun's Height, 4E 201" free in the journal.
   */
  startedAtGameTime?: GameTime;
  completedAtGameTime?: GameTime;
}

// SaveState
quests: Record<UUID, QuestProgress>;
trackedQuestId?: UUID;
```

### 5.2 Dynamic reveal is core, not a nicety

The scenario reveals objectives in **three separate batches from three different NPCs across the continent** — Isran gives one, Serana adds two, Idgrod adds five. The full list exists from authoring; what changes is visibility.

```ts
// TriggerAction — new variants
| { type: 'start-quest';  questId: UUID }
| { type: 'fail-quest';   questId: UUID }
| { type: 'set-quest-objective'; questId: UUID; objectiveId: UUID;
    to: 'available' | 'complete' | 'failed' }
| { type: 'advance-quest-stage'; questId: UUID }
| { type: 'track-quest'; questId: UUID }
```

`set-quest-objective` is the reveal action, and it doubles as the manual completion path for objectives whose logic is easier to express in a dialogue tree than in a trigger.

> ⚠ **Superseded — runs in `runtime` on F, with scoped subscriptions (§R.1).**

### 5.3 The `QuestTracker`

```ts
class QuestTracker {
  constructor(ctx: { defs: QuestDef[]; bus: EventBus; evaluator: ConditionEvaluator;
                     executor: ActionExecutor; progress: Map<UUID, QuestProgress> });
  start(questId): boolean;
  isAvailable(questId): boolean;
  journal(): JournalView;        // pure data — the UI renders this
  track(questId): void;
}
```

It subscribes to the event bus once per active objective trigger, unsubscribes on completion, and **never polls**. `JournalView` is the render seam, matching `DialogueView` in Phase 13 and for the same reason: the tracker decides what to show, the UI decides how, and a test can walk an entire quest with no DOM.

**Same isolation assertion as its three predecessors** — the module imports nothing from `App.tsx` or React. Fourth instance of that rule, after Phase 11's panels, Phase 12's executor and evaluator, and Phase 13's runner.

### 5.4 Ordering

Objectives render in **authored order with per-objective status**, never sorted by completion. The Isran objective sits first and unchecked through the entire quest, above completed ones. That is correct, and sorting by status would destroy the authored narrative reading.

## 6. The Journal

Phase 11 shipped the menu entry disabled with a tooltip. This enables it.

Two panes: a quest list on the left, grouped by `category` and filtered Active / Completed / Failed; the selected quest on the right with its name, description, giver, faction, and the flat objective checklist. A **Track** action pins one quest's objectives to the HUD — with forty quests, the journal is otherwise the only way to know what you are doing.

`markerEntityId` and `markerMapId` drive a pointer that Phase 15's world map consumes. Until then it is journal text ("Morthal") rather than a dead control.

## 7. Editor

The twelfth sibling of the database pattern: list, form, duplicate. The quest form has the stage and objective outline as its centerpiece — reorderable stages, objectives nested under them, each row showing text, optional, hidden, mode, and counter at a glance.

Objective triggers reuse **Phase 12's trigger editor** rather than a quest-specific one, which matters more than it sounds: a creator who has authored one trigger has authored all of them.

**A validation pass, in the spirit of Phase 7's Combat Sanity Check:** flags objectives with no `completeOn` and no counter (unreachable), `startHidden` objectives no action ever reveals (permanently invisible), alternative groups with one member, `requiresObjectiveIds` cycles, and quests with no reachable completion.

## 8. Testing

- **★ The full scenario, end to end.** *A Vampire Problem* is authored as a fixture and driven by emitted events: Isran's dialogue starts it with one visible objective; Serana's reveals two more; Idgrod's reveals five; killing the tagged Lord fires per-objective rewards; 25 tagged deaths complete the counter; Alva survives and reaches Volkihar; returning to Isran completes it. **If this passes, the schema is proven against its source.**
- **Definition/instance:** playing a quest leaves `QuestDef` byte-identical; all mutation lands in `QuestProgress`.
- **★ Four-valued status:** each of the four renders correctly; a `hidden` objective is absent from `journal()` entirely, not merely styled differently.
- **★ `maintain`:** starts satisfied, survives its stage, fails permanently when `failOn` fires, and cannot be recovered. A `maintain` objective with `elapsed-time-reached` as `failOn` behaves as a time limit.
- **★ Counters by tag:** 25 tagged deaths complete a 25-target counter with one authored trigger; adding a 26th tagged entity requires no authoring change; a countdown counter decrements.
- **Alternative groups:** completing one member completes the group; siblings become unreachable rather than failed; a one-member group is flagged by validation.
- **Parent/child:** a parent with `requiresObjectiveIds` does not complete while a child is incomplete, even when its own trigger fires; a cycle is caught by validation.
- **Rewards as actions:** an objective whose `onComplete` sets a variable, grants currency, and reveals another objective lands all three in order.
- **Ordering:** an incomplete objective authored first renders above completed ones.
- **Tracking:** one tracked quest at a time; tracking another replaces it; a completed quest untracks.
- **Save round-trip:** status, stage index, per-objective status, counters, timestamps, and the tracked quest all survive save → quit → load mid-quest.
- **Failure:** `fail-quest` moves it to failed, fires `onFail`, and stops all its event subscriptions.
- **★ Tracker isolation:** imports nothing from `App.tsx` or React; a whole quest runs against a synthetic context with no DOM.
- **No polling:** the tracker holds subscriptions only for objectives in `available` status, and drops them on completion.

## 9. What is authorable but not yet playable

Named rather than hidden, per E's decision to ship solo-play quests first:

- **Escort and delivery objectives** (*"Send Alva to Valerica"*) author fine and their triggers fire correctly, but the player cannot make Alva accompany them until **companions** exist. The schema needs no change when they arrive.
- **Non-lethal objectives** (*"subdue without killing"*) have no combat outcome to hang on. Currently expressible only as a `maintain` objective on the target's survival — which is what the scenario does, and it works.
- **Faction favor rewards** work as variables (Phase 12 §6.6). What does not exist is favor *automatically* driving hostility or prices.

## 10. Decisions locked

- **`QuestDef` is authored; `QuestProgress` lives in the save.** Timestamps are elapsed play milliseconds.
- **Stages are sequential; objectives within a stage are parallel.** The journal renders one flat list regardless.
- **Objective status is four-valued** — hidden, available, complete, failed.
- **`achieve` and `maintain` are both first-class.** Time limits are a `maintain` objective with an elapsed-time failure.
- **Counters use Phase 12 `EntityMatch`**, so counting by tag is authored once.
- **Alternative groups OR; `requiresObjectiveIds` nests.** Ids stay opaque.
- **Rewards are `TriggerAction[]`** at objective, stage, and quest level. No reward schema.
- **Quests coordinate through variables**, not cross-quest addressing.
- **Turn-in is an ordinary objective.** No umbrella concept.
- **Objectives render in authored order**, never sorted by status.
- **The tracker is event-driven and never polls**, with `JournalView` as the render seam.

---

*LoreBrix, ELMSCORP. Phase 13.5 design — derived from a simulated playthrough.*
