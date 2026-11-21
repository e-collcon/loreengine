# Phase 13 — Dialogue, Shops & World Interaction · Technical Design (v4)

**Status:** **v4 — reconciled with the Foundation Rewrite (§R).** Design (no code yet) · **v3 — all six questions and all five gaps resolved. Nothing outstanding.**
**Depends on:** Foundation Phases 1–5 (F: executor, evaluator, factions, commands), 6 v5 (block), 7 v5 (`deal-damage`, weapon tags), 8 v7 (currency, shops, `has-currency`), 9 v5 (`directStats`, loot), 10 v6 (node canvas, `pacify` effect), 11 v2 (save, menu), 12 v8 (`explain()`)
**Blocks:** Phase 13.5 (quest turn-in runs through the dialogue runner)
**Stage:** Stage 1 · **Effort:** Extra High · **Chunks:** two (13A / 13B)

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

**v4 revision:** reconciled with the Foundation Rewrite. Entry points, the two replay axes, spent-choice text, two trees per NPC, parley, provoke and pacify, shop outcomes, destructible states, and respawn rules are unchanged. What changes is where they live: there is no `App.tsx` closure to extract, and NPC fields become components.

### R.1 The runner lives in the runtime

`DialogueRunner` is built in the `runtime` package on F's executor and evaluator. `DialogueView` is exposed through F's read-only view, and the player drives it with runtime commands `dialogue-choose`, `dialogue-advance`, and `dialogue-close` (F §5.3), so a conversation is recorded and replayed like any input. The package boundary replaces the import-list assertion. `onEvent` becomes presentation events (`open-shop`, `dialogue-ended`).

### R.2 NPC fields become components

| v3 field | Now |
|---|---|
| `NPCSprite.dialogueTreeId`, `hostileDialogueTreeId` | A **`dialogue` component** `{ treeId?, hostileTreeId? }` |
| `provokable`, `provokedFaction`, `propagateToFaction`, `onProvoked` | A **`provocation` component** |
| `Destructible` on props and doodads | A **`destructible` component** on any archetype |

Interacting with an entity that has a `dialogue` component opens its tree; F's `interacted` event still fires for triggers.

### R.3 Faction changes are component patches

`provoke` and `pacify` change the entity's `faction` component. The save records it as a `changed` patch on that placement (F §5.10), which is what Phase 11's `factionOverrides` becomes (Phase 11 §R.3). Propagation writes one patch per affected entity, on whichever maps they are. "Hostile to the player" means the entity's faction regards the player's faction as `hostile` in F's relation matrix.

Actions added here: `open-shop`, `provoke`, `pacify`. Events added here: `dialogue-choice-taken`, `dialogue-node-reached`, `dialogue-ended`, `shop-transaction`, `faction-changed`.

### R.4 Schema additions

`dialogueTrees` and `assets.portraits` join the project as minor schema revisions (F deferred both to the phase that reads them). `VariableDef.scope` gains **`conversation`** here, reset by the runner's `end()` (§3.8 now amends F, not Phase 12).

### R.5 Destructibles on F's world

- Damage arrives through Phase 7's `deal-damage`. A destructible's defenses come from a Phase 9 `directStats` component, so a stone pillar with `resistPercent: { physical: 1.0 }` works as §7.2 describes.
- Each state names a clip in the entity's animation set rather than a sprite, and sets whether the entity's F collider is `solid`. A destroyed tree stops blocking because its collider stops being solid.
- `requiredTags` reads the attacker's main-hand `EquipmentDef.tags` (Phase 7).
- Respawn by elapsed time uses simulation time (ticks), plus Phase 14's skipped time.

### R.6 Combat and parley

The interim "in combat" rule reads F's acquisition targets. Parley is Phase 6's held block plus F's interact.

### R.7 Locked choices explain themselves

The reason string for a visible-but-locked choice comes from `explain()`, which Phase 12 adds to F's evaluator.

### R.8 The graph editor

There is no v0 Phase 4 canvas in the greenfield repo. The dialogue graph editor reuses the node canvas Phase 10 builds for formula graphs.

---

> ⚠ **Superseded — historical: these describe v0.6.0; the runner is built fresh on F (§R.1).**

## 0. Four findings from source

Checked against the shipped code, not the docs. The last one is a scope surprise.

### 0.1 A dialogue choice can fire exactly one action

```ts
choices?: { text: string; next: string | null; action?: TriggerAction }[];
```

Singular. Every other action site in the codebase is plural — `Trigger.actions: TriggerAction[]`, `PropSprite.onInteract?: TriggerAction[]`. So a choice can set a flag **or** give an item, never both. "Accept the quest" — which needs to set a flag, give a map, and advance a variable — is not expressible.

Widening to `TriggerAction[]` is a one-word change to the type and the only thing in this phase that touches shipped data shape.

### 0.2 Dialogue has no conditions at all

`DialogueNode` has `id`, `speaker`, `text`, `next`, `choices`. No gating anywhere — not on nodes, not on choices. Every conversation always plays identically, and every choice is always offered. Flag-gated dialogue is the headline feature of this phase and it starts from zero.

### 0.3 The dialogue runtime is a React closure

`App.tsx:1053–1069`: `openDialogueWith(npc)` sets component state, `advanceDialogue(next, action)` mutates it. `DialogueUi` is a `useState`. Same class of problem as the `runActions` closure Phase 12 extracts and the panels Phase 11 §11 depends on.

Phase 13.5 has to drive quest turn-in through this. Discovering it is a React closure at that point is exactly how the panel problem would have gone, so §4 extracts it here, explicitly.

### 0.4 ★ There is no dialogue editor. At all.

`App.tsx:1960`, in the NPC inspector:

```
{npc.data.dialogue ? 'Has dialogue tree ✓' : 'No dialogue (edit in saved JSON for now)'}
```

The inspector *reports whether a tree exists*. Authoring one means hand-editing `.lorebrix.json`.

**This corrects Phase 5.5.** That document said its tree picker would re-point "the existing inline node editor." I wrote that; it was an assumption, and it was wrong. There is no node editor. Phase 5.5 still stands — promoting trees to a database is right and its picker is still the right minimum — but **the actual authoring surface is Phase 13's to build**, and it is a real branching-graph editor, not a form.

The good news is that LoreBrix has built one before. Phase 4's node canvas — drag nodes, click-port to wire, click-edge to delete — is the same interaction, and dialogue is a friendlier graph than a formula because the nodes carry readable text.

---

## 1. Goal

Make conversation, commerce, and the destructible world real: dialogue that remembers, shops that trade in plural currencies, NPCs that can be provoked, and props and doodads that can be broken and come back.

## 2. Non-goals

- **Quests** — Phase 13.5. This phase supplies the dialogue that gives and turns them in.
- **Money-changer NPCs and currency exchange** — deferred by decision back in Phase 8. The standing rule holds: *the player never gains value by relocating currency.*
- **Time-of-day gating** — Phase 14. Respawn and restock run on elapsed play time here (§7.4), and the clock adds a second trigger additively.
- **Voice, localization, text speed, or a dialogue history log** — none requested; all additive later.
- **Reputation / faction standing** — how the player stands *with* a faction, as opposed to how factions stand toward each other. §6 changes an NPC's faction, not the player's standing. Recommended as its own phase in §6.5, because it touches six systems.

---

## 3. Dialogue

### 3.1 The schema

```ts
interface DialogueTree {
  id: UUID;                      // Phase 5.5
  name: string;                  // Phase 5.5
  entryPoints: DialogueEntry[];  // §3.2 — replaces a bare rootId
  nodes: Record<string, DialogueNode>;
}

interface DialogueEntry {
  nodeId: string;
  conditions: Condition[];       // Phase 12. Empty = always eligible.
  label?: string;                // author-facing: "First meeting", "After the quest"
}

interface DialogueNode {
  id: string;
  speaker: string;
  portraitId?: UUID;             // → assets.portraits (Phase 5.5)
  text: string;
  conditions?: Condition[];      // §3.3 — node-level gate
  onEnter?: TriggerAction[];     // fires when the node is shown
  next?: string | null;
  choices?: DialogueChoice[];
}

interface DialogueChoice {
  id: string;                    // NEW — needed to record "already taken"
  text: string;
  next: string | null;
  conditions?: Condition[];      // hide or disable when unmet (§3.4)
  hideWhenUnmet: boolean;        // false = show it grayed with a reason
  actions: TriggerAction[];      // ★ WIDENED from a single optional action (§0.1)
  once: boolean;                 // §3.5 — taking it consumes it, forever
  replacedByText?: string;       // §3.5b — `once` only. Shown grayed in place of the
                                 // original after it has been taken. Omit to remove it.
}
```

### 3.2 Entry points — the mechanism that makes dialogue *remember*

A single `rootId` means every conversation starts the same way forever. The usual workaround is a root node that immediately branches on flags, which buries the interesting structure inside a node nobody wants to read.

Instead: **an ordered list of entry points, each with conditions. The first eligible one wins.**

```
Annwen's tree:
  1. "After you helped her"     → node greet_grateful   [met_annwen && helped_annwen]
  2. "After you've met"         → node greet_familiar   [met_annwen]
  3. "First meeting"            → node greet_stranger   []          ← fallback
```

Order is authored, top to bottom, and the last entry with no conditions is the fallback. This is how a conversation acquires memory without a single branch node, and it makes the *shape* of an NPC's states visible in the editor — which is the difference between authoring this and dreading it.

**A tree with no eligible entry point is silently skipped** — interacting does nothing. That is authorable on purpose (an NPC with nothing more to say) but the editor warns when *no* entry is unconditional, since that is usually a mistake.

### 3.3 Node conditions

A node whose conditions fail is skipped: linear `next` walks forward to the first eligible node; if the chain runs out, the conversation ends. This gives "insert this line only if X" without restructuring the graph.

### 3.4 Choice conditions — hidden or visible-but-locked

`hideWhenUnmet` is authored per choice, and both readings are legitimate:

- **Hidden** (`true`) — the player never learns the option existed. Right for options that would be nonsense: *"[Show her the amulet]"* when you have no amulet.
- **Visible but locked** (`false`) — grayed out with a reason: *"[Persuade — requires 12 Intelligence]"*. Right when the *existence* of the option is information you want the player to have. This is what makes a stat build feel consequential.

The reason string comes from Phase 12's `ConditionEvaluator.explain()`. That method was written for the editor's debugging; it turns out to be player-facing here, which is a pleasant argument that it was the right thing to build.

### 3.5 Replayable versus irreversible — two independent axes

E's original spec: *"sometimes this is replayable, sometimes this is unreplayable/irreversible."* Those are two different things, and conflating them is how a dialogue system ends up unable to express the common cases.

**Axis 1 — is the conversation repeatable?** A tree-level policy:

```ts
replay: 'always' | 'once' | 'entry-controlled'
```

`always` — talk as often as you like (a shopkeeper, a guard with a hint).
`once` — the whole tree plays a single time; afterward the NPC is silent.
`entry-controlled` — **the default and the interesting one.** Repeatable, but *what* they say is decided by §3.2's entry conditions. Talk again and you get the "we've met" greeting rather than the introduction.

**Axis 2 — is a specific choice permanent?** Per choice: `once: true`. Taken once, it never appears again, in this conversation or any later one. Choice ids are recorded in the save (§3.7).

Keeping them separate means all four combinations are authorable, and each is a real scene: a repeatable conversation with one permanent decision inside it (*"I'll take the sword"* — you only get one), a one-shot conversation where every choice is inherently final, and so on.

### 3.5b Spent choices — removed, or remembered

A `once` choice that has been taken can do one of two things, and both are authored per choice:

- **Removed** (`replacedByText` omitted) — it is simply gone. Right when its absence is unremarkable.
- **Remembered** (`replacedByText` set) — it is replaced by grayed, unselectable text: *"[You already told her about the amulet.]"*

The second is usually better storytelling, because it preserves the memory of what the player did. A conversation that silently drops an option reads as though the game forgot; one that shows a spent option reads as though it remembers. One optional string buys that.

### 3.6 Interaction ordering — the ambiguity nobody has resolved

An NPC can be a merchant, a quest-giver, and provokable **at the same time**. What happens when the player presses interact?

**Dialogue is always the front door.** Shops and combat open *from* a dialogue choice, never instead of it. `open-shop` is already a `TriggerAction` (`types.ts:239`), so a merchant's tree simply has a choice that fires it:

```
"What are you selling?"    → actions: [open-shop]           → returns to this node
"You'll regret that."      → actions: [provoke]             → ends dialogue, combat starts
"Never mind."              → next: null
```

This resolves the ordering with no new mechanism, and it makes the interesting thing authorable: **a merchant can refuse to trade with you.** A `type: 'merchant'` NPC that auto-opened a shop window would foreclose that.

**Cost:** every merchant needs a tree, even a trivial one. Mitigated by a "Merchant" template in the tree picker that generates the three-choice shape above.

> ⚠ **Superseded — the two slots live in a `dialogue` component (§R.2).**

### 3.6b Two trees, because a hostile NPC is a different conversation

**Provocation is only meaningful against an NPC who is not already hostile** — offering *"You'll regret that"* to something already swinging at you is nonsense. So an NPC has two dialogue slots:

```ts
// NPCSprite
dialogueTreeId?: UUID;          // used when NOT hostile to the player
hostileDialogueTreeId?: UUID;   // used when hostile — yield, bribe, surrender (§6.2)
```

Which one opens is decided by the runner from the NPC's *current* faction, including any `factionOverrides` from the save. If the relevant slot is empty, interacting does nothing — so a monster with no `hostileDialogueTreeId` simply cannot be talked to mid-fight, which is the correct default.

This is what makes E's answer to §12 Q4 buildable. Yielding and bribing are not new mechanisms; they are choices in the hostile tree, which the player reaches by interacting with an enemy instead of attacking it. And it means the `provoke` choice never needs a "is he already hostile" guard — it lives in the friendly tree, which a hostile NPC never opens.

### 3.7 What the save records

```ts
// SaveState — one new block
dialogue: {
  takenChoiceIds: string[];        // `${treeId}:${nodeId}:${choiceId}` — for `once` choices
  completedTreeIds: UUID[];        // for replay: 'once'
};
```

Deltas keyed by authored id, consistent with every other save field. **Everything else lives in variables** (Phase 12) — "met Annwen" is a flag a choice sets, not dialogue-system state. That boundary is worth holding: it keeps dialogue from growing a private state model that nothing else can read, and it means a quest, a door, and a shop can all check the same fact.

> ⚠ **Superseded — this now amends F's `VariableDef.scope` (§R.4).**

### 3.8 Conversation scope — a Phase 12 amendment

A conversation frequently wants state that should vanish when you walk away: *"has he already mentioned the war in this conversation?"* Today that needs a `session` variable the author remembers to reset, and forgetting is silent.

**Phase 12's scope enum gains a fourth value:**

```ts
scope: 'save' | 'session' | 'conversation' | 'global';
```

`conversation` variables reset to `initial` when a conversation **ends by any route** — a choice with `next: null`, a node chain running out, the player closing the window, or the conversation being interrupted by combat. The `DialogueRunner` owns the reset and fires it from `end()`, which is the single exit point every one of those routes passes through (§4).

Never serialized. A save taken mid-conversation is not a state this engine supports (§13 G3), so there is nothing to persist.

I originally leaned against a new scope in favor of an explicit `reset-variables` action. E overruled it, and on reflection correctly: the action puts the burden on the author to remember, every time, and the failure is invisible until a second playthrough behaves strangely. A scope makes the lifetime a property of the variable, which is where it belongs.

> ⚠ **Superseded — built in `runtime`, driven by commands (§R.1).**

## 4. The `DialogueRunner`

```ts
interface DialogueContext {
  trees: DialogueTree[];
  variables: VariableStore;        // Phase 12
  evaluator: ConditionEvaluator;   // Phase 12
  executor: ActionExecutor;        // Phase 12
  save: { takenChoiceIds: Set<string>; completedTreeIds: Set<UUID> };
}

class DialogueRunner {
  constructor(ctx: DialogueContext);
  canStart(treeId: UUID): boolean;              // is any entry point eligible?
  start(treeId: UUID): DialogueView | null;
  choose(choiceId: string): DialogueView | null;
  advance(): DialogueView | null;               // linear `next`
  end(): void;
  onEvent(fn: (e: DialogueEvent) => void): Unsubscribe;   // 'open-shop' | 'provoke' | 'ended'
}

interface DialogueView {                        // pure data — the UI renders this
  speaker: string;
  portraitId?: UUID;
  text: string;
  choices: { id: string; text: string; enabled: boolean; reason?: string }[];
  canAdvance: boolean;
}
```

Pure, injected, **imports nothing from `App.tsx` or React** — asserted over its import list, the third instance of that rule after Phase 11's panels and Phase 12's executor.

`DialogueView` is the seam that matters: the runner decides *what to show*, the UI decides *how*. Which is what lets Phase 13.5 drive a quest turn-in through the same runner, and lets a test walk a whole conversation with no DOM.

`onEvent` rather than direct calls, because the runner must not know what a shop window is.

## 5. Shops

### 5.1 The window

Two columns — the merchant's stock and the player's inventory — with the wallet visible throughout, because the currency rules from Phase 8 only make sense if the player can see what they are holding.

Per-row: icon, name, price **in the shop's chosen currency**, and stock count when the shop is `finite` or `restocking`. Never a hidden universal value; the player never does math across currencies (Phase 8's standing rule).

### 5.1b A shop can refuse to open

Per E, `ShopDef` carries its own conditions rather than relying solely on a gated dialogue choice:

```ts
// ShopDef
openConditions?: Condition[];   // Phase 12. Empty = always open.
closedText?: string;            // the merchant's own words when refused
```

I originally leaned against this as a second mechanism doing one job. E was right and my reasoning was too narrow: **a shop is not only opened from dialogue.** `open-shop` is a `TriggerAction`, so it can fire from a map trigger, a prop's `onInteract`, or an item script — and none of those routes passes through a gated dialogue choice. Without shop-level conditions, "the market is closed to you" is only enforceable on one of four paths.

When conditions fail, the window does not open and `closedText` is shown — *"The guild does not deal with oathbreakers."* Authored, not a generic error, for the same reason the currency refusals are.

### 5.2 The three payment outcomes

Phase 8 gave shops `accepts` and `valueOverrides`. Rendering them honestly is most of the design:

| | What the player sees |
|---|---|
| **Accepted** | Priced normally. Buy. |
| **Rejected** | The currency is grayed with the merchant's own words — *"We do not trade in tree-pulp."* Authored per shop, not a generic error. |
| **Devalued** | Accepted at a punishing rate, shown plainly: *"3 Sterlings — or 300 Obligation Bills."* |

That third row is where the mechanic earns itself. The player sees the elves' opinion of paper money expressed as a number, without a line of exposition. **Rejection and devaluation are two different authored stances**, per Phase 8 — a proud elf refuses, a desperate border trader gouges.

### 5.3 Selling

```ts
// ShopDef
sellRateMultiplier: number;   // default 0.5 — what the merchant pays, as a fraction of value
buysCategories: UUID[];       // empty = buys anything; otherwise inventory categories
sellCurrencyId: UUID;         // what the merchant pays IN
```

The margin is the merchant's living, and it is also the thing that keeps §2's no-arbitrage rule intact: buying at 1.0 and selling at 0.5 means moving goods between shops loses value, so there is no trade loop to optimize. A creator who sets `sellRateMultiplier: 1.0` has created an infinite-money machine, and **the editor warns**, same spirit as Phase 12's runaway-counter warning.

`buysCategories` is what makes a blacksmith a blacksmith.

### 5.4 Stock

Phase 8 §7.4 authored the three modes; Phase 11 §6.2 stores the state. Phase 13 renders them: `infinite` shows no count, `finite` shows "3 left" and disables at zero, `restocking` shows the count and, when empty, *"Restocks after a while"* — deliberately vague, because a precise countdown against elapsed play time invites the player to stand still and wait.

## 6. Provocation and pacification

> ⚠ **Superseded — provocation is a component; overrides are `faction` patches (§R.2, §R.3).**

### 6.1 Provoking

```ts
// NPCSprite
provokable: boolean;                 // default FALSE
provokedFaction?: FactionId;         // default 'hostile'
propagateToFaction: boolean;         // default FALSE — §6.3
onProvoked?: TriggerAction[];        // a parting line, a variable, an alarm

// TriggerAction — new variant
| { type: 'provoke'; entityId?: UUID }   // omitted = the NPC being spoken to
```

Provoking writes `SaveState.world.factionOverrides[entityId]` (Phase 11 §6.1), so it survives a reload. The NPC's Phase 10 acquisition does the rest — no combat-specific code, because hostility is already a faction question.

**`provokable` defaults to false**, so starting a fight is authored rather than universal. A shopkeeper you can annoy into attacking is a design choice; one you can kill by mashing a dialogue option is a bug.

The `provoke` choice lives in the **friendly** tree (§3.6b), so it is structurally unreachable against an NPC who is already hostile. No guard needed.

### 6.2 Pacifying — three routes, one action

Per E, provocation is reversible. Three routes, all landing on one action:

```ts
| { type: 'pacify'; entityId?: UUID }    // removes the factionOverride
```

**Yield or bribe** — choices in the NPC's `hostileDialogueTreeId` (§3.6b). Interacting with a hostile NPC instead of attacking opens that tree:

```
"I yield."                → conditions: [player_hp < 25%]     → actions: [pacify]
"Take my purse — 50 gold" → conditions: [has 50 gold]         → actions: [pay, pacify]
"Never."                  → next: null                        → the fight continues
```

Both are ordinary dialogue with conditions and actions. Nothing new was built; §3.6b's second tree slot is what makes it work.

**A spell or ability** — a `pacify` effect on a Phase 10 skill:

```ts
// Phase 10 Effect union — one new variant (§13 amendment)
| { type: 'pacify'; durationMs?: number }
```

`durationMs` is the distinction between *Calm* and *Charm*: omit it and the pacification is permanent, like the dialogue routes; set it and the NPC reverts to hostile when it expires. A temporary calm is a genuinely different tactical tool from a permanent one — it buys escape rather than resolution — and it costs one optional field.

**Symmetry that falls out for free:** `pacify` on an NPC who was never provoked simply removes nothing, so a Calm spell cast on a monster that is authored hostile does nothing rather than misbehaving. If a creator wants monsters to be calmable, they set the monster's authored faction and let `pacify` write an override like any other. One rule, no special cases.

**One asymmetry worth naming:** pacifying does not un-fire `onProvoked`. If provoking rang an alarm and set a flag, pacifying does not unring it. That is correct — the town heard the alarm — and a creator who wants it undone puts a `set-variable` in the pacify choice's actions.

### 6.3 Bystanders — `propagateToFaction`

Per E: build the flag, default false, creator picks per NPC.

With it **false**, provoking swaps only that NPC's faction — a duel. With it **true**, every entity currently sharing that NPC's authored faction is switched too, each getting its own `factionOverrides` entry — a town turning on you. Both are legitimate, and the difference is large enough that it should never be an engine default.

`pacify` mirrors it: pacifying an NPC who was provoked *with* propagation calms the group. Recorded on the override that caused it, so the reversal knows what it is reversing.

### 6.4 On NPCs belonging to several factions

E raised this and called it possible overspec. I think it is, and there is a cleaner answer already in the codebase.

**Factions answer one question: who is hostile to whom.** Multi-membership breaks that, because it creates undecidable cases — if A is hostile to one of B's factions and allied to another, what is B? Every system that resolves this grows a precedence rule, and precedence rules are exactly the kind of thing that is invisible until it produces a bug nobody can reproduce.

The use case underneath — *"this NPC is both a town guard and a human"* — is **grouping**, not hostility, and `SpriteBase.tags` already handles it. A skill that hits all `human` entities, a quest that counts `guard` kills, a condition testing membership: all of that works on tags today.

**Recommendation: one faction, many tags.** Factions for hostility, tags for grouping. If a real case appears later that tags cannot express, multi-faction is additive — `faction` becomes `factions[0]` and nothing migrates.

### 6.2b Parley — block, then interact

E's answer to "how do you talk to something that is attacking you," and it is better than either option I proposed. **Hold block, then press interact.**

Everything that makes this fair is already built. Blocking (Phase 6 §8) is a held state that drains stamina per second, cuts movement to 0.4x, and guard-breaks at zero — and you cannot attack while holding it. So parleying is *inherently* the vulnerable-but-defended posture: you have committed to not fighting, you are paying for it every second, and if your stamina runs out mid-negotiation you are wide open.

No new cost mechanism, no timer, no special "parley mode." The gesture is legible on its own: *lower your weapon, raise your guard, talk.*

```
While blocking, interact with a hostile NPC
  → NPC has a hostileDialogueTreeId  → open it
  → NPC has none                     → nothing happens (a monster will not parley)
```

**In turn-based combat it costs a turn**, consistent with §7.3b — opening a parley is an action, and the enemy gets to respond to it.

### 6.2c Yield and bribe — authored conditions now, a curve later

E sketched a fuller model: faction standing on a 0–100 scale, with yield chance on a curve against the player-versus-enemy level gap, and bribe as that curve converted to currency. Then asked whether it is overspec.

**It is more than Phase 13 needs, and it is a good idea that deserves its own phase.** §6.5 makes the case. What Phase 13 builds instead is the version that needs nothing new:

```
Hostile tree, authored per NPC:

  "I yield."                    conditions: [player_hp_percent < 25]
                                actions:    [pacify]

  "Take my purse — 50 gold."    conditions: [wallet.gold >= 50]
                                actions:    [spend 50 gold, pacify]

  "Never."                      next: null
```

Ordinary dialogue with Phase 12 conditions. It is **authorable, visible, and debuggable** — a creator can see exactly why a yield succeeded, and `explain()` can tell a player why it was unavailable. A hidden probability curve can do none of those things.

The trade is real and worth naming: a creator authors the terms per NPC rather than getting them from a system. That is more work for a game with two hundred enemies, and it is the right cost to pay before a standing system exists to make it automatic.

**When standing lands (§6.5), the curve becomes a natural addition** — a `yield` action that consults standing and the level gap, sitting alongside the authored conditions rather than replacing them.

### 6.5 Faction standing — a candidate phase, not a field

E's 0–100 model is genuinely good, and it is a **reputation system**: how the player stands with each faction, not how factions stand toward each other. That is a different axis from everything in §6, and once it exists it touches most of the game:

- **Dialogue** — greetings, options, and whole trees gated on standing.
- **Shops** — prices scaled by standing; a faction that will not trade below a threshold.
- **Combat** — acquisition itself becomes standing-driven, so a faction turns hostile gradually.
- **Yield and bribe** — the curve above.
- **Quests** (13.5) — standing as a reward, and as a prerequisite.
- **Propagation** (§6.3) — provoking one guard costs standing with the whole faction, rather than flipping a boolean.

Six systems. That is a phase, not a field, and building 10% of it inside Phase 13 to serve one dialogue choice would produce exactly the kind of half-system this project has been careful to avoid.

**Recommendation: a `FactionStanding` phase, placed after 13.5.** It needs dialogue (13) and reads naturally alongside quests (13.5). Its data shape is small — `Record<FactionId, number>` in the save, plus per-faction thresholds authored on `FactionDef` — and its cost is entirely in the six integration points above.

Not numbered here, because renumbering has twice produced stale references in this project. It is listed in the roadmap appendix as a Stage 1 candidate for E to slot in.

## 7. Destructible and stateful world objects

> ⚠ **Superseded — a `destructible` component on any archetype (§R.2, §R.5).**

### 7.1 Shared, not doodad-only

E's brief said doodads — a chopped tree, a cut bush. But the shipped types put `collider: null` on `DoodadSprite` with the comment *"Promote to Prop if you need one to."* A tree that blocks movement is therefore already a Prop, and a scattered bush is a Doodad. **Destructibility is a trait on both**, or the feature is unavailable to exactly the objects most likely to want it.

```ts
interface Destructible {
  states: WorldObjectState[];     // ordered: intact → … → destroyed
  hp: number;                     // per state, see below
  requiredTags?: string[];        // §7.3 — the weapon must carry one
  loot?: LootTable;               // Phase 9 — chopping a tree yields wood
  respawn?: RespawnRule;          // §7.4
}

interface WorldObjectState {
  id: string;                     // 'intact' | 'stump' | 'destroyed'
  spriteId?: UUID;
  ambientAnim?: AnimationClip;
  hp: number;                     // damage needed to leave THIS state
  collider?: BoundingBox | null;  // props only; ignored on doodads
  onEnter?: TriggerAction[];
  passable?: boolean;
}
```

A list of states rather than a boolean, because *tree → stump → gone* is the natural shape and a boolean forecloses it for nothing. Two states is the common case and costs no extra authoring.

### 7.2 Damage, reusing the pipeline

Damage lands through Phase 7's `resolveDamage` — same function, same code path, with a stat block whose `physDef` is authored and whose `resistPercent` does real work. A stone pillar with `resistPercent: { physical: 1.0 }` cannot be chopped but shatters to a hammer's `ignoreResistPercent`. Nothing new was built for that; it falls out of insisting on one damage pipeline back in Phase 7.

### 7.3 `requiredTags` — the tool gate

*You need an axe to chop a tree.* One optional array: the attacking weapon must carry one of these tags or the hit does nothing, with a distinct feedback (the GLANCE! effect from Phase 7 §6, reused).

This is the same discoverable-progression loop as armor penetration versus plate, applied to the world instead of to enemies, and it is the load-bearing mechanic behind Zelda-style tool gating. Cheap: one array, one check.

### 7.3b Damaging the world in and out of combat

Per E, two behaviors rather than one rule:

| situation | behavior |
|---|---|
| **Outside combat** | Free. Chopping a tree is world interaction, not a combat action. No turn cost in either combat model. |
| **Inside combat, action model** | Free — action mode has no turn economy to spend. Stamina still applies, since a swing is a swing. |
| **Inside combat, turn-based model** | **Costs a turn**, priced like any attack: `actionPointCost`, stamina, and the ATB bar. A barrier in the middle of a fight is a tactical choice with a price. |

This is the right split. Outside combat, charging a turn for chopping firewood would be absurd; inside a turn-based fight, *not* charging one makes a destructible barrier a free action and breaks the turn economy — a player would clear every obstacle for nothing while the enemy waits.

**It depends on a notion of "in combat" that does not currently exist** (§13 G1). The interim definition, which Phase 16 replaces: *combat is active when the turn-based model is selected and at least one hostile entity has acquired the player.* In action mode the question never arises, since both rows are "free."

### 7.4 Respawn

```ts
type RespawnRule =
  | { kind: 'never' }
  | { kind: 'elapsed'; afterMs: number }          // elapsedMs — Phase 14 §0 defines it:
                                                  // simulation time, menus excluded
  | { kind: 'condition'; condition: Condition }   // Phase 12
  | { kind: 'game-time'; boundary: 'dawn' | 'end-of-day' | 'season-change' }  // Phase 14 A5
  | { kind: 'on-map-reload' };
```

`SaveState.world.destroyedDoodads` already carries `{ id, respawnAtMs? }` from Phase 11 — this fits with no save change. Elapsed play time, not wall-clock, for the same reason as shop restocking; Phase 14's clock adds a time-of-day rule additively.

> ⚠ **Superseded — the graph editor reuses Phase 10's canvas (§R.8).**

## 8. UI

**The dialogue graph editor (§0.4)** is the largest new surface, and it reuses Phase 4's node canvas: nodes as cards showing speaker and truncated text, edges from choices and from `next`, click-port to wire, click-edge to delete. Entry points render as a distinct ordered rail on the left, because their order is semantic. Selecting a node opens an inspector for text, portrait, conditions, and actions. Node positions are **ephemeral UI state, auto-laid-out** — the same call Phase 4 made, and for the same reason: the graph's meaning serializes, its prettiness recomputes.

A **playtest-from-node** action is worth the small cost: start a conversation at any node with the current variable state, so an author testing a branch six flags deep does not replay the whole game to reach it.

**The dialogue player view** is the frosted-glass overlay with portrait, speaker, text, and choices — locked choices grayed with their reason. It already blocks input correctly (`App.tsx:1464–1468`).

**The shop window** is the two-column trade view of §5.

**Inspectors** gain a Destructible section on props and doodads, and `provokable` on NPCs.

## 9. Build order

**13A — Dialogue.** The schema, `DialogueRunner`, entry points, node and choice conditions, `once` choices, the widened actions array, the save block, the graph editor, and the player view. **This is the chunk Phase 13.5 depends on**, and it is coherent alone.

**13B — Commerce and the world.** Shop window, buy/sell, the three currency outcomes, stocking modes, incite-to-fight, destructibles and respawn.

Split there because 13A is one deep system with a hard editor, and 13B is three shallower ones that share only the trigger vocabulary. They fail differently and should not share a gate.

## 10. Testing

- **★ Runner isolation:** imports nothing from `App.tsx` or React; a full conversation walks end to end against a synthetic context with no DOM.
- **★ Entry points:** the first eligible wins; adding a higher-priority entry changes the greeting; a tree with no eligible entry returns `null` from `canStart` and interacting does nothing.
- **Node conditions:** a failing node is skipped and `next` walks forward; a chain that runs out ends the conversation cleanly.
- **Choice conditions:** `hideWhenUnmet: true` omits it entirely; `false` returns it disabled **with a reason string from `explain()`**.
- **★ `once` choices:** taken once, absent forever — across conversations, across map changes, and across save → load. With `replacedByText` set, the slot shows the replacement text, grayed and unselectable, rather than disappearing.
- **★ Replay policies:** `always` reopens; `once` refuses after completion; `entry-controlled` reopens at a different entry as flags change.
- **★ Widened actions:** a single choice sets a variable, grants an item, and advances a counter — all three land, in order.
- **Shops:** an accepted currency prices normally; a rejected one is disabled with the authored refusal text; a devalued one prices at its override. `finite` depletes and disables at zero; `restocking` refills after elapsed play; `infinite` writes no save state. Selling pays `sellRateMultiplier`; a shop with `buysCategories` refuses out-of-category items; `sellRateMultiplier >= 1.0` warns in the editor.
- **★ Provoke:** flips the entity's faction, writes `factionOverrides`, survives reload, and triggers acquisition with no combat-specific code path. A non-`provokable` NPC cannot be provoked by any route.
- **★ Pacify, three routes:** a yield choice, a bribe choice, and a skill effect each remove the override and survive reload. A timed `pacify` reverts to hostile when `durationMs` expires. Pacifying an unprovoked NPC is a no-op rather than an error.
- **Propagation:** with `propagateToFaction: true`, provoking one guard writes an override for every entity of that faction; pacifying the same NPC reverses the whole group. With it false, exactly one entry is written.
- **★ Two trees:** a friendly NPC opens `dialogueTreeId`; the same NPC once provoked opens `hostileDialogueTreeId`; an NPC with no hostile tree cannot be talked to while hostile.
- **★ Parley requires block:** interacting with a hostile NPC while *not* blocking does nothing; while blocking it opens the hostile tree; stamina continues to drain throughout, and a guard break during parley ends it.
- **★ Save mid-conversation:** saving during dialogue, reloading, and re-interacting routes to the correct entry point given the flags already set; a `replay: 'once'` tree saved mid-conversation is still completable after reload.
- **★ Conversation scope:** a `conversation`-scoped variable resets on a normal end, on the player closing the window, and on an interruption; it never appears in a serialized save.
- **Shop conditions:** failing `openConditions` shows `closedText` and does not open, via a dialogue choice, a map trigger, and an item script alike.
- **Destructible turn cost:** outside combat, chopping costs no turn in either model; inside turn-based combat it spends `actionPointCost` and the ATB; in action mode it never costs a turn.
- **Destructibles:** damage advances state at each threshold; `requiredTags` rejects the wrong tool with the glance feedback; loot drops as `PickupEntity` (Phase 8 §7.5); a prop's collider changes with state while a doodad's stays null; each respawn rule fires correctly and survives a reload.
- **Non-regression:** Phase 5.5–12 tests pass. Emberfall's villager still talks, with its tree re-authored onto entry points.

## 11. Decisions locked

- **Dialogue is the front door.** Shops and combat open from a dialogue choice, never instead of one — which makes "this merchant refuses to trade with you" authorable.
- **Entry points replace `rootId`.** First eligible wins; the last unconditional one is the fallback. This is how conversations remember.
- **Replayability and irreversibility are separate axes** — tree-level `replay`, choice-level `once`.
- **`DialogueChoice.actions` is an array.** The one shipped-shape change in the phase.
- **Dialogue state in the save is two id lists.** Everything else is a Phase 12 variable, so a quest, a door, and a shop can all read the same fact.
- **The `DialogueRunner` is pure and event-emitting**, with `DialogueView` as the render seam.
- **Destructibility is a shared trait** on props and doodads, with a state list rather than a boolean, damage through `resolveDamage`, and `requiredTags` as the tool gate.
- **`provokable` defaults to false.** Provocation writes `factionOverrides`; **`pacify` reverses it** via yield, bribe, or a Phase 10 skill effect. `propagateToFaction` (default false) decides duel versus town.
- **Two dialogue slots per NPC** — a friendly tree and a hostile tree. Which opens is decided by current faction, which is what makes yield and bribe ordinary dialogue rather than new mechanisms.
- **Parley is block-then-interact** (§6.2b). Blocking already costs stamina, cuts movement, and forbids attacking, so the vulnerability is paid for by a mechanic that already exists. Costs a turn in turn-based combat.
- **Yield and bribe are authored conditions, not a hidden curve.** Visible, debuggable, and explainable to the player. The curve arrives with faction standing (§6.5).
- **Saving mid-conversation is allowed.** Dialogue position is not serialized; entry points make resumption graceful. `replay: 'once'` trees are marked complete on `end()`, never on `start()` — which is what makes it safe.
- **One faction, many tags.** Factions answer hostility; `tags` answer grouping. Multi-faction membership is additive later if tags prove insufficient.
- **Destructibles are free outside combat and in action mode; inside turn-based combat they cost a turn.**
- **`conversation` joins Phase 12's scope enum**, reset by the runner on `end()`.
- **Shops carry their own `openConditions`**, because `open-shop` fires from four routes and only one of them passes through dialogue.
- **Ships as 13A (dialogue) and 13B (commerce and world).** 13A is what Phase 13.5 needs.

## 12. Open questions — all answered

| | Question | Decision |
|---|---|---|
| 1 | Spent `once` choices — removed or replaced? | **Both**, via optional `replacedByText` (§3.5b). |
| 2 | Can a shop refuse to open on conditions? | **Yes** — `ShopDef.openConditions` + `closedText` (§5.1b). E overruled my lean, correctly: `open-shop` fires from four routes and only one is dialogue. |
| 3 | Destructibles in turn-based combat? | **Two behaviors** — free outside combat and in action mode; costs a turn inside turn-based combat (§7.3b). |
| 4 | Is provocation reversible? | **Yes** — `pacify` via yield, bribe, or skill effect (§6.2). |
| 5 | Does provoking anger the faction? | **A flag, default false**, per NPC (§6.3). |
| 6 | Conversation-scoped variables? | **Yes** — a fourth Phase 12 scope (§3.8). E overruled my `reset-variables` lean, correctly. |

Two of my six leans were overruled, and both for the same reason: I had optimized for fewer mechanisms, and in each case the extra mechanism was covering a path the single one could not reach.

## 13. Gaps raised in v2 — now resolved

**G1 — "In combat" is undefined. → Interim call accepted, flagged for Phase 16.**

Combat is active when the turn-based model is selected **and** at least one hostile entity has acquired the player. Good enough to implement §7.3b, and it uses Phase 10's acquisition rather than inventing state.

E's note for later, recorded so it does not get lost: **combat should have a real start and end**, where the encounter ends once every enemy that had acquired the player has exited its combat state. That is a proper encounter object, it belongs to **Phase 16 (Combat Staging)**, and it replaces this interim rule wholesale. The known edge until then: one distant archer who has acquired you keeps "combat" active, so every tree-chop costs a turn until you break line of sight.

**G2 — Talking to a hostile NPC. → Block and interact. §6.2b.**

Resolved by E's own suggestion, and it is better than either option I offered. See §6.2b.

**G3 — Saving mid-conversation. → Allowed. It turned out to be supportable.**

My v2 call was to disable the menu's Save entry during dialogue. E's rule was "if the code supports it, allow it," so I checked what it would actually take, and the answer is nothing:

- Dialogue position is **not serialized**, so a reload puts the player next to the NPC with no window open. They talk again.
- Any choice already taken has *already* written its flags, items, and counters — those live in variables and inventory, which persist normally.
- **Entry points (§3.2) make the resumption graceful.** Talking again routes to whichever entry now matches, so a conversation resumed after a save picks up in the right emotional place rather than restarting from "who are you?"
- `conversation`-scoped variables reset, which is exactly what they are for.

One rule this depends on: **`replay: 'once'` trees are marked complete on `end()`, never on `start()`.** Mark on start and a mid-conversation save would permanently lose the rest of that conversation. Marking on end costs nothing and makes the whole case safe.

So the menu stays fully available, and this is one fewer restriction to explain to a player. **Phase 11's §11 menu no longer needs to disable Save during dialogue.**

**G4 — `pacify` needs a Phase 10 effect. → Done.** Folded into `PHASE10_DESIGN.md` v4 §5.2, with `durationMs` distinguishing permanent Calm from timed Charm.

**G5 — Faction standing is a real system, and it is not this phase.** §6.5.

---

*LoreBrix, ELMSCORP. Phase 13 design v3 — all questions and gaps resolved.*
