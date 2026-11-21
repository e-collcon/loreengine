# Phase 9 — Enemy Database, Resistance & Loot · Technical Design (v5)

**Status:** **v5 — reconciled with the Foundation Rewrite (§R).** Design (no code yet) · supersedes v3 · **the Phase 8 loot dependency is resolved**

### Changes in v3 (roadmap renumber + the monster stat-mapping gap)

| Change | Why |
|---|---|
| **v4: `LootTable.autoCollect` added; §7.1 spawns `PickupEntity`** | This doc always said drops spawn "per Phase 8's decision" while that decision was open. It is now made (Phase 8 §7.5): pickup entities by default, `autoCollect` for turn-based. The forward reference is closed. |
| **★ `MonsterDirectStats` gains `spellResist`, `spellPower`, and `concentration`, and §5.1 states the full `EffectiveStats` mapping exhaustively** | The short-circuit said monsters read "essentially as-is" into `EffectiveStats`, but `EffectiveStats` carries fields `MonsterDirectStats` did not. `spellResist` is the one that bites: Phase 7 step 2 falls back to it for any damage type with no `resistances` entry, so its absence meant **every monster took full damage from every unlisted magic type, permanently** — an accident wearing the costume of a decision. |
| Incite-to-fight and the `provokable` flag now point at **Phase 13** | Roadmap renumber. |
| Kill credit resolved | Phase 10 locked it: only the player earns EXP, always. |
| TEA has a real number: **Phase 17** | It was left as "Phase X" pending the roadmap revision. §12 Q3 is answered. |
**Depends on:** Foundation Phases 1–5 (F), Phase 6 v5 (attributes, `stats`, `deriveStats`), Phase 7 v5 (equipment, typed damage, `resolveDamage`, `deal-damage`), Phase 8 v7 (items, currency, pickups)
**Schema:** extends v2
**Recommended effort:** High — **Extra High for §5–§6** (the Monster/Human split and the resistance-pipeline extension; both are the kind of ordering-sensitive decisions Phase 7's immunity math already taught us to be careful with)

### Changes in v2 (reconciliation with Phase 6 v2 / Phase 7 v3)

| Change | Why |
|---|---|
| §5.2: `HumanEnemyDef` carries a full `stats: StatBlock` instead of a bare `attributes` + a duplicate `resistPercent` | Phase 6 v2 put `resistPercent` on `StatBlock`, so the duplicate was two sources of truth for one concept. The bigger win: v1 had no way to author *any* per-enemy adjustment — a bandit captain with +15 maxHp had to have his attributes warped. `StatBlock.flat` fixes that, and the EnemyDef → runtime mapping stops being implicit. |
| §5.1: `MonsterDirectStats` gains explicit `maxMana` and `maxStamina` (default 0) | Phase 6's regen/block/sprint loop assumes every combatant has pools; "monsters just don't" was never written down. Setting them to 0 makes `canBlock()`/`canSprint()` return a defined answer, and it means Phase 10 can let a monster cast a real spell without a schema change. |
| §4: `resistPercent` on `EffectiveStats` is *reserved by Phase 6 v2*, not added here | Phase 9 is its first consumer, not its author. |
| §6: pipeline step 7 uses `rules.combat.minDamage`; the short-circuit return matches Phase 7 v3's `DamageResult` shape | Canonical paths and the pure-function return contract. |

**One thing I did *not* change, flagging it for your call:** the original phase plan listed a `provokable` flag on enemies (for **Phase 13**'s "incite NPCs to fight"). The written design never included it. Reserving one optional boolean now would follow this arc's standing pattern — but it's a scope addition you didn't ask for, so it stays out until you say otherwise.

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

**v5 revision:** reconciled with the Foundation Rewrite. The monster/human split, the exhaustive monster stat mapping, RPD/IPRD as a pipeline stage before armor, loot, and general progression are unchanged. Under composition, the split stops being a database union and becomes a choice of components.

### R.1 No `EnemyDef` database: enemies are archetypes

F builds entities by composition (F §7.3), so a separate enemy database would be a second place to author the same thing. An enemy is an **archetype**, and "monster" versus "human" is which stat component it carries:

| v4 shape | Now |
|---|---|
| `MonsterDef.directStats` | a **`directStats` component** (`MonsterDirectStats`, unchanged) |
| `HumanEnemyDef.stats` | the Phase 6 **`stats` component** |
| `HumanEnemyDef.loadout` | the Phase 7 **`loadout` component**, which requires `stats` |
| `attacks` | F's **`attacker` component** (R.2) |
| `behaviorMachineId` | F's **`brain` component** |
| `spritesheetId` | F's **`sprite` component** |
| `lootTable` | a **`loot` component** (`LootTable`, unchanged) |
| `tags` | archetype `tags` |

The validator enforces **exactly one** of `directStats` or `stats` on any entity with `health` that can be damaged through `resolveDamage`. A monster's `canEquip` rejects because it has no `stats`, not because of a `kind` field. "Human is a mechanical category" still holds: it is the entity that has `stats`.

### R.2 Monster attacks are `AttackDef`s

`MonsterAttackDef` is deleted. A monster attack is an F `AttackDef` (timing, hitbox, telegraph) whose `onHit` deals explicit instances through Phase 7's action. Phase 9 adds one optional field to it:

```ts
| { type: 'deal-damage'; target: EntityMatch; damage: DamageInstance[];
    lifestealPercent?: number }   // NEW here — heals the subject by % of total final damage
```

The Banshee bite is one `AttackDef` whose `onHit` is `[deal-damage { damage: [physical 5, arcane 5], lifestealPercent: 0.3 }]`. Status on hit is an `apply-effect` beside it.

### R.3 Attack selection is already in F

§6.3's "random among off-cooldown attacks" is F's brain `attack` behavior with `pick: 'random'`, seeded (F §7.11). Phase 10 widens the candidates to skills.

### R.4 Kill credit needs a source

"Only the player earns EXP" requires knowing who landed the killing hit. Phase 9 adds `lastHitBy` to F's runtime `HealthState` (written by `deal-damage`). On `entity-died`, EXP is awarded only when `lastHitBy` is the player.

### R.5 Progression is a component

`level`, `exp`, and `unspentPoints` form a **`progression` component** on the player, saved in its persistent entity. `allocatePoint` is a runtime command. Event owned here: `level-up`.

### R.6 Loot spawns pickups

On death, each rolled drop spawns a pickup archetype at the corpse, with the cliff-safe snap from Phase 8 §R.5, or resolves straight to the wallet and inventory when `autoCollect` is true.

### R.7 Authoring

There is no Enemy Database panel. F's Archetypes editor gains a **Monster / Human preset** that adds the matching components; the loot table editor is the `loot` component's section. The Combat Sanity Check extension is unchanged. `EntityMatch { by: 'enemyDef' }` is F's `{ by: 'archetype' }`.

### R.8 Testing additions

- An archetype with both `directStats` and `stats`, or neither while damageable, fails validation.
- A monster archetype given a `loadout` fails validation (it has no `stats`).
- A monster killed by another monster's attack awards no EXP; the same kill by the player does.
- The Banshee bite heals the subject by 30% of the combined final damage.

### R.9 Authored attributes (later on 16 Nov)

Attributes are project content (Phase 6 v6 §R.11). Monsters still have none: the §5.1 mapping's `str`, `agi`, `int` rows become "every authored attribute reads 0." `allocatePoint` takes an attribute id.

---

## 0. Decisions carried in from E

1. **Monsters:** basic authored stats only, **cannot equip anything**, but get authored **attacks** with per-attack damage type, armor penetration, and effects (lifesteal, status).
2. **Human enemies:** equip gear exactly like the player (Phase 7's `loadout`). **Skeletons and zombies are humans with a different sprite** — confirming "human" is a *mechanical* category (gear-equipping combatant), not a biological one.
3. **Ghost Warriors are humans** with an intrinsic **Resist Physical Damage (RPD)** of 100%. Weapons may carry **Ignore Physical [resistance] (IPRD)**, and `Damage × (1 − RPD + IPRD)` — with IPRD able to exceed 100% for amplification.
4. **On death:** enemies grant EXP, currency, and items, all creator-configured per enemy (amount/which/how likely).
5. **EXP has two modes:** general (level up, allocate stat points) or **Tie EXP to Action (TEA)**. E asked directly whether TEA is too much and flagged it might need a "stat stretch." **Confirmed with E this round: TEA is out of scope for Phase 9.** §7 carries the reasoning and the deferral plan.

## 1. Goal

An editable Enemy Database supporting two authoring shapes — Monster (fixed stats, authored attacks, no gear) and Human (attributes + equipment, exactly like the player) — sharing one runtime combatant model. Extend Phase 7's damage pipeline with a percentage-based intrinsic-resistance stage (RPD/IPRD) that composes with, but is distinct from, armor-based mitigation. Ship loot tables and the "general" EXP/leveling mode.

## 2. Non-goals

- **TEA** — out of scope this phase, confirmed with E. Full reasoning and a path forward in §7.
- **Real Spell/Ability references on monster attacks** — Phase 10 doesn't exist yet, so Monster attacks are Phase 9's own self-contained schema (§5.1). Once Phase 10 ships, monsters can *additionally* reference real spells — the same deliberate seam Phase 8 left for spellbooks.
- **Kill-credit systems** (which of several attackers gets the EXP) — not needed yet; only the player is user-controlled. EXP is always awarded to the player. **Resolved by Phase 10:** only the player earns EXP, always — a monster killing another monster awards nothing to anyone. **Phase 13**'s incite-to-fight does not change this.
- **Dodge/evade as a mechanic** — doesn't exist yet; relevant to §7's TEA analysis but not built here.
- **Damage-type-vs-armor-class matchup matrix** — as noted in Phase 7 §13, still skipped; `armorPen` + typed resistance already covers the design space.

> ⚠ **Superseded — the two shapes are now two stat components on an archetype (§R.1).**

## 3. Central design decision #1 — one `EnemyDef` union, two authoring shapes, one runtime model

The trap here would be two parallel entity hierarchies — a `Monster` class tree and a `Human` class tree — that duplicate combat logic and drift apart. Instead:

```ts
type EnemyDef = MonsterDef | HumanEnemyDef;   // discriminated by `kind`
```

Both compile down to the **same** `NPCEntity`/`CombatantEntity` runtime from Phase 3 — the only difference is *how* `effectiveStats()` gets computed:

- **Human** → Phase 6/7's full pipeline: `attributes` + `loadout` → `deriveStats(base, equipment)`. Skeletons, zombies, bandits, Ghost Warriors — all the same path.
- **Monster** → a short-circuit: no attributes, no equipment pass. `directStats` (authored flat numbers) are read essentially as-is into `EffectiveStats`.

One function, one early branch. This is exactly the same discipline as Phase 7's two-pass derivation — a single pipeline that behaves correctly for every input, not two pipelines that might quietly disagree.

**The payoff, called out explicitly:** because `loadout` has lived on `CombatantBase` since Phase 7, "human enemies equip gear like the player" isn't new work — it's the same field, the same `equip()`/`unequip()` API, the same two-pass derivation, on an NPC instead of the player. That's the bill Phase 7 promised would come due, and it's nearly free.

## 4. Central design decision #2 — RPD/IPRD is a new pipeline *stage*, not a replacement

Phase 7 already has a resistance-like concept — flat `physDef`/`resistances`, run through armor penetration, a ratio-based immunity check, and a diminishing-returns curve. That model represents **worn defense**: how hard your armor is to punch through.

E's RPD is a different thing: an **intrinsic, percentage-based** trait — a ghost's body doesn't stop steel *better*, it doesn't interact with steel *at all*, regardless of how strong the swing is. That's not a ratio problem; it's a "this damage type doesn't apply to this creature" problem. So it gets its own stage, applied **before** armor mitigation:

```
DamageInstance gains one new optional field:
  ignoreResistPercent?: number     // the "IPRD" for this hit's own type

EffectiveStats.resistPercent is ALREADY RESERVED by Phase 6 §4.3:
  resistPercent: Partial<Record<DamageType, number>>   // the "RPD" — intrinsic, not gear
  — stored on StatBlock, passed straight through by deriveStats.
  Phase 9 is its first consumer, not its author.
```

Both are additive to the *existing* shapes from Phase 7 — no field is removed or repurposed. When `resistPercent` and `ignoreResistPercent` are both absent or zero, the new stage multiplies by exactly 1 and every Phase 7 test still passes unchanged. **This is a strict extension, not a rewrite.**

## 5. Data model

### 5.1 `MonsterDef`

```ts
interface MonsterDirectStats {
  maxHp: number;
  maxMana: number;      // default 0 — a monster with 0 simply cannot cast (Phase 10)
  maxStamina: number;   // default 0 — a monster with 0 cannot block or sprint
  physDef: number;
  spellResist: number;  // ★ generic magical mitigation. Phase 7 step 2 falls back to
                        // this for any damage type with no `resistances` entry. Omit it
                        // and every monster takes FULL damage from every unlisted magic
                        // type, forever — an accident, not a design.
  spellPower: number;   // default 0 — scales real spells once Phase 10 lets monsters cast
  concentration: number;// default 0 — resistance to cast interruption (Phase 10 §10.3)
  resistances: Partial<Record<DamageType, number>>;    // elemental armor, Phase 7-style
  resistPercent: Partial<Record<DamageType, number>>;  // intrinsic RPD, Phase 9
  moveSpeed: number;
  attackSpeed: number;
}
```

**The short-circuit mapping, stated exhaustively.** "Read essentially as-is into `EffectiveStats`" was underspecified — `EffectiveStats` has fields `MonsterDirectStats` does not, and leaving them implicit means whatever a compiler happens to produce. The complete rule:

| `EffectiveStats` field | Monster value |
|---|---|
| `maxHp` / `maxMana` / `maxStamina` | from `directStats` |
| `hp` / `mana` / `stamina` | seeded to their maxima on spawn |
| `physDef`, `spellResist`, `spellPower`, `concentration`, `moveSpeed`, `attackSpeed` | from `directStats` |
| `resistances`, `resistPercent` | from `directStats` |
| **`physDamage`** | **0** — a monster's damage comes from `MonsterAttackDef.damageInstances`, never from a derived stat. Authored per attack, so the derived value is genuinely unused. |
| **`str` / `agi` / `int`** | **0** — monsters have no attributes by design. Nothing may read these for a monster; a formula graph that does resolves to 0 rather than throwing. |
| **`blockReduction`** | **0** — consistent with `maxStamina: 0`; a monster that cannot block needs no block value. |
| **`custom`** | **`{}`** |

Every one of these is a decision, not a default that fell out of the implementation.

> ⚠ **Superseded — monster attacks are F `AttackDef`s with `deal-damage` in `onHit` (§R.2).**

interface MonsterAttackDef {
  id: UUID;
  name: string;                        // "Headbutt", "Bite"
  animationClip?: string;
  cooldownMs: number;
  reachTiles: number;
  damageInstances: DamageInstance[];    // reuses Phase 7's shape — 1 for most, 2+ for a Banshee
  lifestealPercent?: number;            // 0..1 — heals the attacker for this % of total final damage
  appliedStatusEffects?: UUID[];        // Phase 4 StatusEffectDef ids
}

interface MonsterDef {
  id: UUID;
  kind: 'monster';
  name: string;
  spritesheetId: UUID;
  directStats: MonsterDirectStats;      // "basic stats" — authored flat, no attributes
  attacks: MonsterAttackDef[];          // a monster can have several named attacks
  behaviorMachineId?: UUID;             // Phase 4 — which one it uses is an AI decision (§6.3)
  lootTable: LootTable;                 // §5.4
  tags: string[];
}
```

**Worked examples, straight from the brief:**

| Monster | Attack | `damageInstances` | Notes |
|---|---|---|---|
| Ghost | Touch | `[{type:'arcane', amount:6, armorPen:0}]` | Physical is never the type — it just doesn't attack that way |
| Minotaur | Headbutt | `[{type:'physical', amount:14, armorPen:0.7}]` | High penetration — punches through armor, not through RPD |
| Banshee | Bite | `[{type:'physical', amount:5, armorPen:0}, {type:'arcane', amount:5, armorPen:0}]` | Two independent hits; `lifestealPercent: 0.3` heals off the *total* |

> ⚠ **Superseded — a human enemy is an archetype with `stats` and `loadout` components (§R.1).**

### 5.2 `HumanEnemyDef`

```ts
interface HumanEnemyDef {
  id: UUID;
  kind: 'human';                        // mechanical category: "equips gear," not "biologically human"
  name: string;
  spritesheetId: UUID;
  stats: StatBlock;                     // Phase 6 v2 — attributes, flat adjustments,
                                        // resistances, resistPercent, custom. Authored
                                        // directly; enemies don't level.
  loadout: Loadout;                     // Phase 7, unchanged — dress it exactly like the player
  behaviorMachineId?: UUID;
  lootTable: LootTable;
  tags: string[];                       // ['undead', 'skeleton'], ['bandit'], etc. — flavor & filtering
}
```

**Why a whole `StatBlock` rather than bare attributes.** Three things fall out of it. `resistPercent` stops existing in two places (it was on both `StatBlock` and here). `flat` gives creators a way to say "this bandit captain has +15 maxHp" without warping his STR into something that also inflates his damage and defense. And the spawn path becomes explicit and shared with the player: **on spawn, `hp`/`mana`/`stamina` are seeded to the derived maxima from `deriveStats(stats, { equipment })`** — the same line of code for a hero, a guard, and a Ghost Warrior.

A **Skeleton** and a **Zombie** are `HumanEnemyDef` entries with a different `spritesheetId` (and, if desired, their own `resistPercent`/`tags` — a zombie resisting poison, say). No new code path; just data.

A **Ghost Warrior** is a `HumanEnemyDef` whose `stats.resistPercent` is `{ physical: 1.0 }`. It may still wear armor — that armor simply matters for *other* incoming damage types (a mage's fireball, say), which is a real, intentional design affordance, not a wasted field.

### 5.3 Extensions to already-locked Phase 7 types (additive only)

```ts
// EquipmentDef — ONE new optional field
interface EquipmentDef {
  // …unchanged
  ignoreResistPercent?: number;   // this weapon's IPRD, applied to whatever type it deals
}

// DamageInstance — ONE new optional field
interface DamageInstance {
  amount: number;
  type: DamageType;
  armorPen: number;
  ignoreResistPercent?: number;   // NEW — copied from the weapon/attack that produced this hit
}
```

Both are optional and additive; nothing about Phase 7's locked schema changes shape or meaning.

### 5.4 Loot

```ts
interface LootDrop {
  refId: UUID;      // a currencyId or itemId
  min: number;
  max: number;
  chance: number;    // 0..1
}

interface LootTable {
  expReward: number;
  currencyDrops: LootDrop[];
  itemDrops: LootDrop[];

  /**
   * FALSE (default) → drops spawn as PickupEntity on the ground (Phase 8 §7.5).
   * TRUE            → drops resolve straight into the wallet and inventory on death.
   *
   * This is the turn-based answer, and it is a per-table creator choice rather than
   * an engine-wide law: in a turn-based fight there is no walking over things, so a
   * pile on the floor is unreachable by construction.
   */
  autoCollect: boolean;
}
```

Directly reuses Phase 8's Currency and Item databases by id — no new taxonomy.

## 6. The extended damage pipeline

Phase 7's `resolveDamage` gains **one new stage**, inserted first, before armor is ever consulted:

```
0. TYPE RESISTANCE (NEW)
   resistPct  = defender.resistPercent[hit.type] ?? 0
   ignorePct  = hit.ignoreResistPercent ?? 0
   typeMult   = max(0, 1 − resistPct + ignorePct)     // E's exact formula; floored at 0
   scaled     = hit.amount × typeMult
   if (scaled <= 0) → return { final: 0, immune: true, blocked: false,
                               staminaCost: 0, guardBroken: false,
                               type: hit.type, reason: 'type-resistant' }
                        ← Phase 7 v3's DamageResult shape; `reason` is an added
                          optional field so the GLANCE! feedback can distinguish
                          "shrugged off by armor" from "doesn't apply to me"
                        ★ short-circuits — armor is never even consulted

1. RAW           raw = scaled                          (Phase 7's pipeline continues unchanged from here)
2. DEFENSE       def = physDef, or resistances[type]
3. PENETRATION   effectiveDef = def × (1 − armorPen)
4. IMMUNITY      (Phase 7's ratio check, on `raw` = scaled)
5. MITIGATION    (Phase 7's diminishing-returns curve)
6. BLOCK
7. FLOOR         (rules.combat.minDamage — still cannot resurrect a type-immune
                  OR armor-immune hit)
```

**Why this order, precisely:**

- **Before armor**, so a 100% RPD ghost is untouched by physical damage regardless of a weapon's raw power *or* its `armorPen` — those only matter once damage has actually gotten past the intrinsic-resistance gate.
- **The floor still cannot smuggle damage through**, exactly as Phase 7 established for armor immunity — the same rule now covers both immunity sources. One consistent guarantee, not two similar-but-subtly-different ones.
- **No upper clamp on `typeMult`.** IPRD above 100% is deliberately allowed to amplify, per E's spec — a "silver bullet" weapon can make an ordinarily-untouchable ghost take *extra* damage. The only clamp is the floor at 0, which prevents a badly-tuned RPD (say, 150% with no IPRD) from producing negative damage — which under today's `takeDamage` clamping would just be silently treated as zero anyway, so flooring here keeps behavior honest rather than accidentally-almost-a-heal. (An intentional damage-*absorption*/heal-on-hit mechanic is a natural future extension this design doesn't preclude, but it isn't built now, since it wasn't asked for.)

**Worked example — the IPRD weapon vs. the Ghost Warrior:**

Ghost Warrior: `resistPercent.physical = 1.0`. A plain sword swings for 20 physical, `ignoreResistPercent` unset (0): `typeMult = max(0, 1 − 1.0 + 0) = 0` → **immune, glances entirely**, armor never even checked. Equip a blessed warhammer with `ignoreResistPercent: 0.6`: `typeMult = max(0, 1 − 1.0 + 0.6) = 0.6` → 12 damage gets through, *then* proceeds through whatever armor the Ghost Warrior happens to be wearing. Equip a legendary silvered blade with `ignoreResistPercent: 1.5`: `typeMult = 1 − 1.0 + 1.5 = 1.5` → **30 damage, amplified** — the silver-bullet moment, exactly as specified.

> ⚠ **Superseded — already F's brain `attack` behavior (§R.3).**

### 6.3 AI attack selection (small addition)

Monsters can have several named attacks. The Phase 4/5 behavior-machine "attack" state is extended minimally: on entering `attack` with a target in range, pick **at random among currently off-cooldown attacks**; if none are ready, wait. This is intentionally simple — smarter attack-priority AI (favor the highest-damage option, save a big attack for low HP, etc.) is a natural future refinement, not required now.

## 7. EXP & Progression

> ⚠ **Superseded — level, EXP, and points live in a `progression` component (§R.5).**

### 7.1 General mode — built now

```ts
interface ProgressionRules {
  mode: 'general' | 'tea';            // project-wide toggle — reserved now so no future migration is needed
  expCurveBase: number;                // EXP required for level 2
  expCurveGrowth: number;              // multiplicative growth per level
  attributePointsPerLevel: number;     // default 1
}

// on PlayerSprite (not on enemies — enemies are static, authored encounters)
level: number;
exp: number;
unspentPoints: number;
```

On an enemy's death: roll `LootTable`, then **spawn a `PickupEntity` per drop at the corpse's position — or resolve straight to the wallet and inventory when `autoCollect` is true** (Phase 8 §7.5). Combat drops carry `despawnAfterMs` and `sourceKind: 'dropped'`, and auto-collect on despawn rather than vanishing, so the player never silently loses money. Then award `expReward` to the player, check the curve for a level-up, and on level-up grant `attributePointsPerLevel` to `unspentPoints`. The **backend** method `allocatePoint(attribute)` — decrement `unspentPoints`, increment the attribute, invalidate the effective-stats cache — is built now, matching the pattern already used for Phase 7's paper-doll and Phase 8's inventory panel: **backend now, UI in Phase 11's Character screen.**

### 7.2 TEA — confirmed out of scope, and exactly why

Each of the six triggers E described maps to something that either doesn't exist yet or is explicitly blocked on a later phase:

| TEA trigger | What's missing |
|---|---|
| Weapon-type EXP on connect | No `weaponType` taxonomy exists (Phase 7 only has `grip`: one/two-handed) |
| Armor-type EXP on being hit | No `armorType` taxonomy exists; worse, with **ten** equip slots, "which armor piece trains" needs a real combination rule that hasn't been designed |
| Speed EXP from running/jumping | Running exists; **jumping does not** — contextual gap-hop was explicitly reserved and deferred back in Phase 6, never wired |
| Agility EXP from dodging | **Dodge/evade doesn't exist at all.** We have Block (a held state); dodge would be a new, distinct mechanic needing its own design |
| Spell-damage EXP by spell type | Fully blocked on **Phase 10** — no spells, no "spell type"/school taxonomy exists yet |
| Spell-resistance EXP from being hit | Same — blocked on Phase 10, plus a "did the defender fail to avoid this" event that doesn't exist yet |

Two of six triggers need mechanics invented from scratch (dodge, weapon/armor taxonomies + a combination rule); two are blocked on jump, already deferred once; two are hard-blocked on Phase 10 not existing. This is a **second, alternative progression system** with real design questions of its own (how does gaining Sword-skill levels actually change combat? does wearing three different armor types train three skills at once, or just one?), and it deserves the same care Phases 6–8 got, not a rushed bolt-on here.

**Path forward:** the `mode` toggle is reserved now (§7.1) so no future schema migration is needed. `'general'` ships fully. TEA gets its own future phase — after Phase 10 (so spell types exist) and reasonably positioned near Phase 11 (since skill levels want a Character/Menu screen to actually show up in — the same "backend now, UI later" pattern this whole arc has used). It is now **Phase 17 — TEA (Tie EXP to Action)** on the revised roadmap, placed after Phase 10 (spell schools exist) and after Phase 11 (a Character screen exists to display skill levels).

> ⚠ **Superseded — see §R.4–§R.6 for kill credit, progression, and loot spawning.**

## 8. Runtime API additions

```ts
// EntityManager / playtest
rollLoot(enemy: NPCEntity): { exp: number; currencySpawns: {...}[]; itemSpawns: {...}[] }
awardExp(player: PlayerEntity, amount: number): { leveledUp: boolean; newLevel?: number }

// PlayerEntity
allocatePoint(attribute: 'str' | 'agi' | 'int'): boolean   // false if unspentPoints === 0

// resolveDamage — signature unchanged; reads the new optional fields when present
```

> ⚠ **Superseded — no Enemy Database panel; enemies are authored in the Archetypes editor (§R.7).**

## 9. UI

- **Enemy Database editor** — a Rules tab, the fourth sibling of the database-editor pattern (Phase 7 Equipment, Phase 8 Items/Currency/Categories). A top-level Monster/Human toggle switches the form: Monster shows `directStats` + an attack-list sub-editor (name, damage instances, armor pen, lifesteal, cooldown); Human shows the same paper-doll equip panel from Phase 7, reused verbatim, plus a `resistPercent` row for intrinsic traits.
- **Loot table editor** — per-enemy: EXP field, plus add-row pickers into Phase 8's Currency/Item databases with min/max/chance.
- **Combat Sanity Check, extended** — Phase 7's per-map reachability checker now *also* flags enemies whose `resistPercent` makes them immune to every damage type the player can currently deal (e.g., a Ghost Warrior encountered before any IPRD weapon or magic damage source exists). This is arguably an *easier* trap to fall into than an armor ratio, since typing "1.0" for RPD is one keystroke — so extending the same safety net here matters.

## 10. Testing plan

Strict `tsc`, production build, runtime tests:

- **Non-regression (the important one):** with `resistPercent`/`ignoreResistPercent` absent on both sides, every existing Phase 7 test still passes byte-for-byte — the new stage multiplies by exactly 1 and is invisible when unused.
- **RPD blocks entirely:** 100% RPD, no IPRD → `final: 0, immune: true`, and armor is never consulted (verify via a spy/counter that the armor stage didn't run).
- **IPRD defeats RPD partially:** 100% RPD + 60% IPRD → 60% of raw gets through, *then* still passes through the defender's armor stage normally.
- **IPRD amplifies:** 100% RPD + 150% IPRD → 150% of raw, more than an undefended target would take.
- **The floor cannot resurrect a type-immune hit:** RPD 100%, no IPRD → exactly 0, never `minDamage`.
- **Monster multi-instance attacks:** a Banshee bite produces two independently-resolved hits; lifesteal heals off their *combined* final total.
- **Monster vs Human runtime parity:** both compile to `effectiveStats()` successfully; a Monster's `canEquip()` always rejects (`reason: 'not-equippable'`).
- **Spawn parity:** a `HumanEnemyDef` spawns with `hp`/`mana`/`stamina` equal to its derived maxima *including* its loadout's contribution — a skeleton in heavy plate spawns at the higher HP, not the naked one.
- **★ Loot spawning:** a killed enemy with `autoCollect: false` leaves one `PickupEntity` per rolled drop at its position; the same table with `autoCollect: true` leaves zero entities and credits the wallet and inventory directly.
- **Loot on blocked terrain:** an enemy killed against a wall still yields collectible loot — the pickup snaps to a walkable cell, or auto-collects when none is available.
- **Monster pools:** a monster with `maxStamina: 0` returns false from `setBlocking(true)` and `setSprinting(true)` and never regenerates into a positive stamina value.
  - **★ Monster stat mapping is complete:** a monster's `effectiveStats()` returns a defined value for **every** `EffectiveStats` field — no `undefined`, no `NaN`. Specifically, an arcane hit against a monster with no `resistances.arcane` entry resolves against its authored `spellResist`, not 0.
  - **Monster unused fields are deliberate zeros:** `physDamage`, `str`, `agi`, `int`, and `blockReduction` read 0, and a formula graph referencing any of them evaluates rather than throwing.
- **Authored flat on an enemy:** a bandit captain with `stats.flat.maxHp = 15` reports exactly 15 more HP than an otherwise identical bandit, with unchanged damage and defense.
- **Loot:** EXP/currency/items roll correctly against min/max/chance; a 0%-chance drop never fires across many trials; a 100%-chance drop always does.
- **General progression:** EXP accumulates against the curve; level-up grants exactly `attributePointsPerLevel`; `allocatePoint` fails cleanly at zero unspent points and invalidates the stat cache on success.
- **Sanity check extension:** an enemy that is RPD-immune to every damage type currently reachable by the player is flagged; one that isn't, isn't.

## 11. Decisions locked (handoff summary)

- **One `EnemyDef` union** (`monster` | `human`), one runtime `CombatantEntity` — no parallel class hierarchies. "Human" is a mechanical category (equips gear), not a lore category; skeletons, zombies, and Ghost Warriors are all `HumanEnemyDef`.
- **Human enemies carry a full Phase 6 `StatBlock`** — attributes, `flat` tuning, resistances, `resistPercent`. One source of truth, and the spawn path (seed current pools from derived maxima) is identical to the player's.
- **Monsters get authored `directStats` and a list of `MonsterAttackDef`s** (reusing Phase 7's `DamageInstance` directly — a Banshee bite is just two instances plus `lifestealPercent`). No attributes, no equipment; `canEquip()` always rejects. `maxMana`/`maxStamina` default to 0, which is what makes "monsters can't block, sprint, or cast" a defined behavior rather than an undefined one.
- **RPD/IPRD is one new pipeline stage**, inserted *before* Phase 7's armor stage, using the exact formula `max(0, 1 − RPD + IPRD)`, floored at 0, uncapped above — amplification is intentional and unclamped. The floor rule from Phase 7 (immunity always beats `minDamage`) now covers this stage too.
- **Two additive-only field extensions** to already-locked Phase 7 types (`EquipmentDef.ignoreResistPercent`, `DamageInstance.ignoreResistPercent`) — nothing removed, nothing repurposed, full backward compatibility proven by a non-regression test.
- **Loot tables** reuse Phase 8's Currency/Item databases directly.
- **General EXP/leveling ships now** (backend); **TEA is confirmed out of scope** for Phase 9, with a concrete, trigger-by-trigger dependency table (§7.2) and a reserved `mode` toggle so nothing has to migrate later.
- **Combat Sanity Check (Phase 7) extended** to catch RPD-based unkillable enemies, not just armor-ratio ones.

## 12. Open questions for E

1. **Monster `resistances` vs `resistPercent`** — should a monster be able to have *both* a flat elemental resistance (Phase 7-style, subject to armor-pen/immunity-ratio) *and* an intrinsic percentage resistance (Phase 9-style) on the *same* damage type simultaneously (e.g., a fire elemental with flat fire resistance from thick hide *and* 50% intrinsic fire RPD)? The schema permits it; I'd default to **yes, allow both, they compose in the order in §6** — flag if you want it restricted to one or the other.
2. **Attack selection AI (§6.3)** — random-among-ready is the Phase 9 default. Fine for now, with smarter prioritization (favor high damage, save specials for low HP) explicitly deferred rather than designed today?
3. ~~**TEA's future phase placement**~~ — **ANSWERED.** It is **Phase 17** on the revised roadmap: after Phase 10 so spell schools exist, after Phase 11 so there is a Character screen to display skill levels in.
