# Phase 6 — Core Stat System · Technical Design (v6)

**Status:** **v6 — attributes are authored (§R.11); v5 reconciled with the Foundation Rewrite (§R).** Design (no code yet) · **supersedes v3** (v2 folded in Phase 10's `concentration` + `interrupt` block; v3 handed the schema-v2 gate to Phase 5.5 and closed §13; v4 is this line and the `Effect` rename)
**Depends on:** Foundation Phases 1–5 (F): `Health`, `ActiveEffects`, the attack and movement systems, the database-editor pattern
**Assumes:** the Foundation Rewrite has landed the v2 container (F Phase 1). **Phase 6 extends v2; it does not create it.**
**Recommended effort:** Extra High. Not because of migration (that's gone) but because every field name, coefficient, and function signature written here is inherited verbatim by Phases 7, 8, and 9. This is the only phase where a naming mistake is free to fix.

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

**v5 revision:** reconciled with the Foundation Rewrite. The stat model, formulas, coefficients, contributions, and the two-pass rule are unchanged. What changes is where they attach and who owns current health.

### R.1 Stats are a component

`StatBlock` is the authored **`stats` component** on archetypes and placements. An entity has stats only if it carries the component, which is what lets Phase 9's monsters use `directStats` instead. The player's `stats` travel in its persistent entity in the save (F §5.10). `statRules: StatRules` joins the `Project` as a minor schema revision under F law L3; Phase 6 no longer touches the version gate.

### R.2 One owner for current health (F law L9)

F Phase 4 ships `Health` (authored `max`) and `HealthState` (runtime `current`) before stats exist. Two writable copies of HP would violate L9, so:

- `StatBlock` **drops `hp`**. Current HP is owned by `HealthState`, always.
- For an entity with `stats`, `Health.max` is **derived** (`maxHp` from §5.1); an authored `health.max` on the same entity is a validator warning and is ignored.
- Current **mana and stamina** move to a new runtime state, `ResourcesState { mana, stamina, regenBlockedUntilTick }`, saved like any component. They are play state, not authored data.

```ts
interface StatBlock {                 // v3 — the `stats` component (authored)
  attributes: Attributes;
  flat: Partial<Record<DerivedKey, number>>;
  resistances?: Partial<Record<DamageType, number>>;
  resistPercent?: Partial<Record<DamageType, number>>;
  custom: Record<string, number>;
}                                     // no hp, mana, stamina: those are runtime state
```

### R.3 Speed and attack speed

- For an entity with `stats`, derived `moveSpeed` replaces the authored `movement.speed`. `moveSpeed` stays in **hexes per second** (default 3.5), converted to world units at derivation.
- `attackSpeed` divides `AttackDef.cooldownMs` (F §4.5). Phase 7 confirms this for weapons.

### R.4 Block and sprint

- Two input roles join `InputActionDef.role`: `block` (held) and `sprint` (held). Minor schema revision.
- **Block** is a held state read by F's movement (speed × `blockMoveMult`) and attack start (an attack cannot start while blocking). `resolveDamage` (Phase 7) receives it.
- **Sprint** multiplies speed while moving and draining stamina.
- **Guard break** applies an engine-owned status effect carrying the restrictions `attack` and `block` for `guardBreakMs`, the same mechanism F uses for i-frames. No special-case flag.
- The restriction values `block` and `sprint` join `StatusEffectDef` restrictions (F §4.5).

### R.5 Stamina costs, including dodge

The §8 cost table gains one row, because F Phase 4 shipped a dodge with no cost:

| Action | Cost | Default |
|---|---|---|
| Dodge | per dodge | 12 (tunable, `stamina.dodge`) |

Attacks charge `stamina.attack` when the windup starts; an attack or dodge with insufficient stamina is refused, as §11 already tests for attacks.

### R.6 Regeneration has a tick slot

Phase 6 adds one slot to F's fixed tick order (F §5.4), right after "active effects tick": **resources regenerate**. Adding a slot is a design change F reserves to the phase that needs it, so it is recorded here and in F.

### R.7 Buffs are status effects

Phase 6 adds the `contribution` payload to F's `StatusEffectDef`. F's `ActiveEffects` supplies the active contributions to `deriveStats` as `DerivationInputs.buffs`, and its change notification is what invalidates the derived-stats cache.

### R.8 No formula editor here

The node-based formula graph, its evaluator, and its canvas are **built in Phase 10**, their first consumer (`EffectMagnitude`). The v0 lines about rewriting `STAT_OPTIONS` and `defaultFormulaGraph()` are superseded. In both combat modes, every hit resolves through Phase 7's `resolveDamage`; there is no separate turn-based damage formula.

### R.9 ATB

`attackSpeed` remains the ATB driver (§5.3). The ATB itself belongs to the turn-based combat mode, which Phase 16 schedules; Phase 6 provides only the driver.

### R.10 Jump

The stamina cost stays reserved. Where jump's input and movement land is open as F Q7 (lean: Phase 6, beside sprint and block). It is not designed here until E answers.

### R.11 Attributes are authored (decided by E, F Q15)

**v6 revision.** E decided that attributes are content, not engine code. There are two tiers, and they must never share a name:

| Tier | E's term | Defined by | Examples | Read by |
|---|---|---|---|---|
| **Core stats** | basic attributes | The engine. Every game has them. | `maxHp`, `physDamage` (Attack), `physDef` (Defense), `maxMana`, `maxStamina`, `spellPower`, `spellResist`, `moveSpeed`, `attackSpeed`, `blockReduction`, `concentration` | Engine systems: the damage pipeline, movement, regeneration |
| **Attributes** | authored attributes | Each game, in its project | Strength, Agility, Intelligence | Only the derivation table |

In every document, "attribute" now means only the authored tier; the engine tier is "core stats" (v4's `DerivedKey`). One word, one meaning.

```ts
interface AttributeDef {           // Project.attributes — minor schema revision
  id: Id<'attribute'>; key: string; name: string; abbr: string;   // 'str', 'Strength', 'STR'
  description?: string; min?: number; max?: number;
}

interface DerivationRule {         // one per core stat
  base: number;
  per: Record<string, number>;     // attribute id -> coefficient
  cap?: number;                    // blockReduction uses it
}

// StatRules.derivation: Record<CoreStatKey, DerivationRule>
//   replaces pools.* and the combat.*Per* coefficients
// StatBlock.attributes: Record<string, number>   (attribute id -> value)
//   replaces { str, agi, int }
```

**The rule:** `coreStat = min(cap, base + Σ attribute × per[attribute]) + flat`. Every formula in §5 already has this shape. The two-pass rule is unchanged: attribute contributions fold in before the table runs.

**Where the content comes from (E, 17 Nov).** Our first real attribute set is Planet Reset's — Strength, Dexterity, Agility, Endurance, Intelligence, Leadership — adjusted to what applies in this engine. Its coefficients come from the Planet Reset design, not from this document. Leadership's natural consumer, the party, arrives with companions (Phase 20.5), so whether it ships in the first set is E's call. v4's STR, AGI, INT with §5's defaults survive only as a **regression fixture** for the derivation code; Emberfall no longer defines attributes.

**Pool names are labels.** The three pools stay engine-fixed, but `statRules.poolNames` lets a game display them its own way, so Planet Reset's mana reads as **Mojo**.

**Non-linear derivations** (diminishing returns per attribute, say) can come later as an optional formula-graph override per core stat, once Phase 10 builds the graph. That is additive.

**What stays engine-fixed:** the core stat list and the three pools (HP, mana, stamina), because engine systems read them by name.

**Downstream, already noted in each document:** Phase 7's `attributeBonuses` and `requirements` are keyed by attribute id; Phase 9's monsters still have no attributes; Phase 10's skill `requirements` are keyed by id; Phase 11's character creation allocates across `project.attributes`, and `allocatePoint` takes an attribute id.

**Tests added:** a project authoring four attributes derives every core stat from its table; the STR, AGI, INT regression fixture reproduces v4's §5 values at low, mid, and high attribute levels; an attribute missing from a rule contributes nothing; deleting an attribute that a rule or a requirement references is refused with the count of references.

### R.12 Where the work lands (replaces §10)

| Package | Phase 6 work |
|---|---|
| `schema` | `Attributes`, `StatBlock` v3, `DamageType`, `DerivedKey`, `EffectiveStats`, `StatContribution`, `DerivationInputs`, `StatRules`; the `contribution` payload; `block`, `sprint` roles and restrictions |
| `runtime` | `deriveStats`, a per-entity derived-stats cache, the resources system and its tick slot, block and sprint in movement and attack start, guard break |
| `editor` | The `StatRules` panel on F's database-editor pattern, with the live sample-character readout |
| `player` | A stamina bar in the HUD |

### R.13 Testing additions

- An entity with `stats` reports `Health.max` equal to derived `maxHp`; one without uses its authored max.
- Mana and stamina round-trip through save and load as runtime state; the authored `stats` component is never written to.
- An attack cannot start while blocking; a dodge with insufficient stamina is refused.
- Guard break applies a status effect that blocks attacking and blocking for exactly `guardBreakMs`.
- Regeneration runs in its tick slot, after effects and before health.

---

## 0. What changed from v1 of this document, and why

v1 was written before E answered its own §12 open questions, and before Phases 7–9 existed. Four things are now known that weren't then.

| Change | Cause |
|---|---|
| **Migration deleted entirely** (old §7, the compatibility-bridge paragraph in §3, the legacy mapping table in §6, migration tests in §11, the migration module in §10) | E confirmed LoreBrix has never shipped to production. No v1 project exists that needs preserving. |
| **Legacy `atk`/`def`/`spd` aliases deleted too** | They were only ever there to protect *authored* formula graphs. There are none — the only formula graph in existence is `defaultFormulaGraph()` in our own Phase 4 source, which we simply rewrite. Keeping the aliases would mean two names for one number forever, and a formula-node dropdown showing both `atk` and `physDamage` with no way to tell a creator which is correct. |
| **Jump = contextual gap-hop. Locked.** | E's answer. Stamina cost reserved; input wiring lands in a later movement phase. |
| **The full `StatRules` editor ships in Phase 6**, not a read-only view | "Defer" without a date is how features die. It's one panel of number inputs against a schema that already exists, it makes the phase self-demonstrating (tune HP-per-STR, watch the hero's health change), and it establishes the database-editor pattern that Phases 7–10 clone four more times. |

And five things Phases 7–9 later assumed but v1 never reserved — each one would have forced a schema edit mid-implementation:

| Gap found by reading Phases 7–9 backwards | Fix in this doc |
|---|---|
| `DerivedKey` is used by v1 §4 (`flat`) **and** Phase 7 (`EquipmentDef.bonuses`) but **never defined anywhere** | Defined in §4.2 |
| `StatRules.minDamage` — Phase 7's damage pipeline step 7 reads it; v1 StatRules has no such field | Added in §9 |
| Phase 7 needs `immunityRatio`, `allowImmunity`, `blockCap`, `offhandStaminaMult`; Phase 9 needs `resistPercent` on the stats record | All reserved in §4.3 / §9 |
| `spellResist` (Phase 6) vs `magicResist` (Phase 7 §5 step 2) — two names, one concept, one of them a typo | One canonical name: `spellResist`. §13 lists the Phase 7 correction |
| `deriveStats(base, equipment?)` reserves exactly one contribution slot — but Phase 8 adds timed buffs, which are *not* equipment | Generalized to `deriveStats(base, contrib?)` in §6 |

---

## 1. Goal

Replace the flat v1 `StatBlock` (hp/mp/atk/def/spd) with an attribute-driven model: three primary attributes (Strength, Agility, Intelligence) derive three resource pools (HP, Mana, Stamina) and every combat stat. Introduce the stamina economy and two new runtime actions (block, sprint). Ship the editable `StatRules` panel. Re-author Emberfall attributes-first.

## 2. Non-goals

- **Equipment** — Phase 7. Phase 6 builds the derivation hook gear plugs into, and adds no gear.
- **Items, consumables, buffs** — Phase 8. Phase 6 reserves the contribution shape buffs will use.
- **Spells/abilities** — Phase 10. Phase 6 only establishes the Mana and Stamina pools they spend. *(This is now documented in Phase 10 §4: spells and abilities are one "Active Skill" schema discriminated by `resource: 'mana' | 'stamina'`, surfaced as two filtered views in the UI.)*
- **Enemy authoring, RPD/IPRD, loot, EXP** — Phase 9. The `resistPercent` field is reserved here; nothing reads it yet.
- **Leveling** — Phase 9 owns `ProgressionRules` and `allocatePoint`. Phase 6 adds no `level` field.
- **Jump** — input deferred. Only its stamina cost constant exists. *(Home pending F Q7, §R.10.)*

## 3. The central design decision: stored attributes, derived everything else

**Primary attributes and current resource values are stored. Every other number is computed at runtime and never persisted.** Storing a derived value means it goes stale the instant an attribute changes or a ring comes off. One pure function turns stored data into a flat effective-stats record:

```
deriveStats(base: StatBlock, contrib?: DerivationInputs) → EffectiveStats
```

This is the single most load-bearing signature in the whole Zelda arc. Phase 7 feeds it equipment, Phase 8 feeds it buffs, Phase 9 short-circuits it for monsters. It is pure, cheap, and memoized at the entity.

> ⚠ **Superseded — the formula editor is built in Phase 10, not here (§R.8).**

**No legacy bridge.** v1's `atk`/`def`/`spd` are gone, not aliased. Their successors are `physDamage`, `physDef`, and — for the turn-based ATB specifically — `attackSpeed` (§5.3). The Phase 4 formula editor's `STAT_OPTIONS` and `defaultFormulaGraph()` are rewritten in this phase to match; that's roughly twenty lines of code we own, paid once, versus permanent conceptual debt.

## 4. Data model

> ⚠ **Superseded — current HP is owned by `HealthState`; mana and stamina are runtime state. The corrected `StatBlock` is in §R.2.**

### 4.1 `StatBlock` v2 (stored)

```ts
interface Attributes {
  str: number; // Strength
  agi: number; // Agility
  int: number; // Intelligence
}

interface StatBlock {                 // v2
  attributes: Attributes;

  // CURRENT pool values only. Maxima are derived, never stored.
  hp: number;
  mana: number;
  stamina: number;

  /**
   * Authored per-entity adjustments — "this guard is a mini-boss, give him +10 maxHp"
   * without warping his attributes. NOT where equipment or buffs live; those are
   * contributions (§6) and never touch stored data.
   */
  flat: Partial<Record<DerivedKey, number>>;

  /** Intrinsic resistances. Reserved here; Phase 7 (flat) and Phase 9 (percent) consume them. */
  resistances?: Partial<Record<DamageType, number>>;
  resistPercent?: Partial<Record<DamageType, number>>;

  custom: Record<string, number>;
}
```

- `mp` is renamed `mana`; `stamina` is new.
- `maxHp` / `maxMana` / `maxStamina` are **gone from storage**. Current values persist so a wounded enemy stays wounded across a save.
- `moveSpeed` is removed from `CombatantBase` and becomes derived.
- **Note for Phase 9:** because `resistPercent` lives on `StatBlock`, `HumanEnemyDef` does not need its own copy of the field. Phase 9 §5.2 can drop it and read it from the stat block instead — one less place for the same concept to live.

### 4.2 `DamageType` and `DerivedKey`

Both are defined **here**, in Phase 6, because `EffectiveStats` references them. Phase 7 extends the `DamageType` union rather than introducing it.

```ts
type DamageType =
  | 'physical' | 'fire' | 'ice' | 'lightning'
  | 'poison' | 'holy' | 'arcane'
  | (string & {});                 // creator-defined types stay valid

type DerivedKey =
  | 'maxHp' | 'maxMana' | 'maxStamina'
  | 'physDamage' | 'physDef'
  | 'spellPower' | 'spellResist'
  | 'moveSpeed' | 'attackSpeed'
  | 'blockReduction'
  | 'concentration';    // added by Phase 10 §16 — resistance to cast interruption.
                        // Its own stat rather than an overload of spellResist,
                        // for the same reason atk/def/spd were deleted.
```

`DerivedKey` is the exact set of things `StatBlock.flat`, `EquipmentDef.bonuses` (Phase 7), and `Effect.buff.contribution` (Phase 8 v3) are allowed to modify. One union, three consumers, no drift.

### 4.3 `EffectiveStats` (computed, never stored)

```ts
interface EffectiveStats {
  // pools
  hp: number; maxHp: number;
  mana: number; maxMana: number;
  stamina: number; maxStamina: number;

  // primary (post-contribution — a +3 STR ring shows up here)
  str: number; agi: number; int: number;

  // derived combat
  physDamage: number;      // added to weapon base (weapon arrives Phase 7)
  physDef: number;         // flat physical mitigation
  spellPower: number;      // added to spell base (Phase 10)
  spellResist: number;     // generic magical mitigation — the fallback when a
                           // specific type has no entry in `resistances`
  moveSpeed: number;       // tiles / second
  attackSpeed: number;     // scalar; effectiveCooldown = base / attackSpeed
  blockReduction: number;  // 0..blockCap — shields raise it in Phase 7
  concentration: number;   // resistance to cast interruption (Phase 10 §10.3)

  // typed defense
  resistances: Partial<Record<DamageType, number>>;    // flat, armor-like (Phase 7)
  resistPercent: Partial<Record<DamageType, number>>;  // intrinsic %, RPD (Phase 9)

  // creator-defined stats, resolvable by the formula evaluator
  custom: Record<string, number>;
}
```

**No index signature.** v1 used `[k: string]: number` for custom passthrough; that's incompatible with the object-valued `resistances` maps and would silently defeat type-checking on every field. Custom stats get their own nested record, and the formula evaluator resolves a `StatKey` as: named field first, then `custom`, then 0. Same expressiveness, actual type safety.

## 5. Derivation formulas

Every coefficient lives in the editable `StatRules` block (§9). Defaults below are starting values, tuned later against the real Zelda-style build.

> ⚠ **Superseded — the coefficients now live in an authored derivation table keyed by attribute id (§R.11). The formulas below are Emberfall's defaults.**

### 5.1 Resource pools — `derived = base + attribute·coef + flat`

| Pool | Formula | Driver | Default |
|---|---|---|---|
| maxHp | `HP_BASE + str·HP_PER_STR + flat.maxHp` | STR | base 20, +8/STR |
| maxMana | `MANA_BASE + int·MANA_PER_INT + flat.maxMana` | INT | base 10, +6/INT |
| maxStamina | `STAM_BASE + agi·STAM_PER_AGI + flat.maxStamina` | AGI | base 50, +5/AGI |

### 5.2 Combat stats

| Stat | Formula | Driver | Default |
|---|---|---|---|
| physDamage | `str·DMG_PER_STR + flat.physDamage` | STR | +1.5/STR |
| physDef | `str·PDEF_PER_STR + flat.physDef` | STR | +0.5/STR |
| spellPower | `int·SPWR_PER_INT + flat.spellPower` | INT | +1.5/INT |
| spellResist | `int·SRES_PER_INT + flat.spellResist` | INT | +0.5/INT |
| moveSpeed | `MOVE_BASE + agi·MOVE_PER_AGI + flat.moveSpeed` | AGI | base 3.5, +0.15/AGI (tiles/s) |
| attackSpeed | `ATKSPD_BASE + agi·ATKSPD_PER_AGI + flat.attackSpeed` | AGI | base 1.0, +0.05/AGI |
| blockReduction | `min(BLOCK_CAP, BLOCK_REDUCTION + flat.blockReduction)` | — | 0.60, cap 0.85 |
| concentration | `CONC_BASE + int·CONC_PER_INT + flat.concentration` | INT | base 0, +1.0/INT |

Matches the brief exactly: STR → health, weapon damage, physical defense · AGI → stamina, movement speed, attack speed · INT → mana, spell damage, spell resistance.

### 5.3 Turn-based ATB — `spd` is gone, `attackSpeed` replaces it

v1's playtest charged the ATB bar as `spd · dt / 12`. With `spd` deleted, ATB charges off `attackSpeed`:

```
atbProgress += attackSpeed · dt · ATB_CHARGE_RATE      // default 0.7
```

This is the semantically correct driver — `attackSpeed` already means "how often this combatant acts" — and it buys a genuinely nice property for free: Phase 7's `attackSpeedMod` on weapons will affect **turn order**, so a greataxe makes you act less often in turn-based mode as well as swing slower in action mode. One stat, both modes, no special-casing.

### 5.4 Damage mitigation

Diminishing-returns curve rather than flat subtraction, so defense never trivially zeroes damage on its own:

```
mitigated = incoming · (100 / (100 + effectiveDef))
```

20 physDef → ×0.83 (17% reduction); 100 physDef → ×0.5. Tunable via `DEF_CONSTANT` (default 100).

**Where the rest of the pipeline goes:** Phase 7 wraps this curve in the full `resolveDamage` — armor penetration, the true-immunity ratio check, block, and the `minDamage` floor — and Phase 9 inserts the RPD/IPRD stage ahead of it. Phase 6 ships only the curve plus the `minDamage` floor, so nothing here contradicts what lands later.

## 6. Contributions — the one hook Phases 7, 8, and 9 all plug into

Equipment (Phase 7) and timed buffs (Phase 8) are **contributions**, never stat mutations. They are gathered into one input bag and handed to `deriveStats`. Unequipping is a recompute, never an "undo the buff" — which is why the classic RPG bug where equipping and unequipping a ring twenty times inflates your stats is *structurally impossible here*, not merely tested against.

```ts
interface StatContribution {
  attributeBonuses?: Partial<Attributes>;
  bonuses?: Partial<Record<DerivedKey, number>>;
  resistBonuses?: Partial<Record<DamageType, number>>;
}

interface DerivationInputs {
  equipment?: StatContribution;    // Phase 7 — the merged loadout, plus its weapon profile
  buffs?: StatContribution[];      // Phase 8 — active timed effects
}
```

**The two-pass rule, stated here rather than in Phase 7, because Phase 6 owns the function:**

```
PASS 1 — merge every contribution
         effectiveAttrs = base.attributes + Σ attributeBonuses

PASS 2 — run §5's formulas against effectiveAttrs, THEN add flat bonuses
```

Attribute bonuses must fold in **before** the formulas run. In §5, STR derives HP *and* damage *and* defense — so a +3 STR ring has to raise all three. Reverse the order and every gear bonus is silently, permanently wrong. This gets a dedicated test whose only job is to prove the ordering (§11).

In Phase 6 `contrib` is always `undefined`. The parameter exists now so Phases 7 and 8 add gear and buffs without reshaping anything — the same forward-compatibility trick Phase 1 used for `ProjectMeta.publishing`.

> ⚠ **Superseded — the container and version gate come from F Phase 1; `statRules` is a minor schema revision (§R.1).**

## 7. Clean v2 — no migration

LoreBrix has not shipped. There is no v1 project in the wild worth a compatibility layer, so v2 is built clean: attributes-first, no residual fields, no scar tissue.

**The version bump and the v1 rejection gate belong to Phase 5.5, not here.** `SCHEMA_VERSION = 2` and the explicit refusal of v1 files land with the container consolidation; by the time Phase 6 starts, a project is already v2. Phase 6 adds one field to it (§9) and rewrites the stat model inside it. If both documents implemented the gate, it would be built twice.

**Emberfall is re-authored twice, for different reasons, and the order matters.** Phase 5.5 re-authors its *container* — assets through the blob store, dialogue into the database, factions assigned. Phase 6 then re-authors its *stats* — the hero and guard get hand-picked STR/AGI/INT values that feel right, which is cheaper than back-solving them and produces a better demo.

**Project-level addition in this phase:** `statRules: StatRules` (§9). That is the only container change Phase 6 makes.

## 8. Stamina economy & new runtime actions

**Costs & regen** (all in `StatRules`, tunable):

| Action | Cost | Default |
|---|---|---|
| Attack (basic) | per swing | 8 |
| Block (hold) | per second held | 5 |
| Block (absorb a hit) | per hit blocked | 10 |
| Sprint | per second | 12 |
| Jump | per hop (reserved, input deferred) | 10 |
| Stamina regen | per second, after `REGEN_DELAY` (0.6s) since last drain | 15 |
| Mana regen | per second | 3 |
| HP regen | per second | 0 (off by default) |

**Block (new).** While held: incoming *physical* damage ×`(1 − blockReduction)`, movement ×`BLOCK_MOVE_MULT` (default 0.4), stamina drains. Stamina hitting 0 while blocking → **guard break**: block cancels and a `GUARD_BREAK_MS` vulnerability window opens.

Blocking works bare-handed from Phase 6 onward and continues to in Phase 7 — a shield doesn't *enable* blocking, it raises `blockReduction` via `blockBonus` up to `BLOCK_CAP`. (v1 said blocking "requires an off-hand shield later"; Phase 7 contradicted that. Phase 7 is right; corrected here.)

**Sprint (new).** While the sprint modifier is held *and* moving: `moveSpeed × SPRINT_MULT` (default 1.6), stamina drains per second. At 0 stamina → auto-revert to walk until stamina recovers past `SPRINT_MIN` (default 10).

> ⚠ **Superseded — these are runtime systems on components, with regen in its own tick slot (§R.4, §R.6).**

**Runtime home.** Both live on `CombatantEntity` (Phase 3):

```ts
// CombatantEntity
effectiveStats(): EffectiveStats      // memoized; invalidated by attribute /
                                      // flat / loadout / buff / StatRules change
spendStamina(n): boolean
spendMana(n): boolean
regen(dt): void                       // called from EntityManager.update(dt)
setBlocking(b: boolean): void
setSprinting(b: boolean): void
isGuardBroken(): boolean
```

> ⚠ **Superseded — `pools.*` and the `combat.*Per*` coefficients are replaced by `derivation` (§R.11); every other field stands.**

## 9. `StatRules` — the full editable config, and its editor

One project-level object holding every coefficient above, so a designer tunes the entire system without touching code. **Canonical paths matter** — Phases 7–9 reference these by name, so they are fixed here:

```ts
interface StatRules {
  pools: {
    hpBase; hpPerStr;
    manaBase; manaPerInt;
    stamBase; stamPerAgi;
  };
  combat: {
    // derivation coefficients
    dmgPerStr; pdefPerStr; spwrPerInt; sresPerInt;
    moveBase; movePerAgi; atkSpdBase; atkSpdPerAgi;
    unarmedDmg;            // damage with empty hands — default 2
    defConstant;           // diminishing-returns constant — default 100
    atbChargeRate;         // §5.3 — default 0.7

    // damage-pipeline constants (Phase 7 reads all of these)
    minDamage;             // damage floor — default 1
    immunityRatio;         // true immunity threshold — default 1.25
    allowImmunity;         // project-wide toggle — default TRUE, per E
    blockCap;              // ceiling on blockReduction — default 0.85
    offhandStaminaMult;    // dual-wield off-hand surcharge — default 0.6

    // block tuning
    blockReduction;        // base, pre-shield — default 0.60
    blockMoveMult;         // default 0.4
    guardBreakMs;          // default 800

    // concentration (Phase 10 §10.3 reads it; nothing in Phase 6 does)
    concBase;              // default 0
    concPerInt;            // default 1.0
  };

  /** Cast interruption — Phase 10 §10.3. All three models default OFF. */
  interrupt: {
    byChance; baseChance; chancePerConc; minChance;
    byFreeHits; baseFreeHits; concPerFreeHit;
    byCondition; interruptStatusIds; interruptDamageTypes;
  };
  stamina: {
    // costs
    attack; blockHold; blockHit; sprint; jump;
    // regen
    regen; regenDelayMs; manaRegen; hpRegen;
    // sprint tuning
    sprintMult; sprintMin;
  };
}
```

Note `allowImmunity: true` and `immunityRatio: 1.25` are seeded here even though nothing reads them until Phase 7 — so the Phase 7 implementation adds behavior, not schema.

**The editor ships in this phase.** A new Rules tab: grouped number inputs, a live "sample character" readout beside them (set STR 10, watch maxHp and physDamage update as you drag a coefficient), and a Reset-to-defaults button. This panel is the **prototype for the database-editor pattern** — Phase 7's Equipment DB, Phase 8's Item/Currency/Category DBs, Phase 9's Enemy DB, and Phase 10's Spell DB are all siblings of it (list + edit form + duplicate). Building it now means designing that pattern once.

> ⚠ **Superseded — v0 file paths; see §R.12 for the package breakdown.**

## 10. Integration touch-points

- **`src/core/types.ts`** — `Attributes`, `StatBlock` v2, `DamageType`, `DerivedKey`, `EffectiveStats`, `StatContribution`, `DerivationInputs`, `StatRules`. Delete v1 `StatBlock`. Remove `moveSpeed` from `CombatantBase`. Narrow `StatKey` to the new derived keys plus `(string & {})`. *(`SCHEMA_VERSION = 2`, `AssetRef`, `factions`, `startMapId` and the database promotions are already present — Phase 5.5 landed them.)*
- **`src/entity-system.ts`** — `CombatantEntity` gains pools, block/sprint state, `deriveStats`/`effectiveStats`, spend/regen methods; `EntityManager.update(dt)` calls `regen(dt)`; `takeDamage` routes through the §5.4 curve and the `minDamage` floor.
- **`src/playtest.ts`** — `statsToRecord` sources from `effectiveStats()`; ATB charges off `attackSpeed` (§5.3); block reduces incoming damage; sprint modifies the movement step; attacks are gated on stamina.
- **`src/GameplayRulesEditor.tsx`** — `STAT_OPTIONS` replaced with str/agi/int + the `DerivedKey` set; `defaultFormulaGraph()` becomes `physDamage − physDef` instead of `ATK − DEF`; new `StatRules` panel.
- **`src/starter-assets.ts`** — Emberfall's hero and guard re-authored attributes-first.
- **`src/App.tsx`** — entity inspector shows attributes + a live derived-stats readout instead of editable flat stats; playtest HUD gains a stamina bar.

**Not touched:** `tile-engine.ts` — geometry is stat-agnostic.

**Deliberately left for Phase 8:** `CombatantBase.inventory` is still v1's `InventoryItem[]`. Phase 8 replaces it with `InventoryStack[]` + `wallet`. Flagged so nobody mistakes it for an oversight.

## 11. Testing plan

Strict `tsc --noEmit`, a production Vite build, plus targeted runtime tests — the standing discipline:

- **Derivation:** every formula in §5 returns hand-computed values at low / mid / high attribute levels.
- **Mitigation curve:** matches hand-computed points at 0 / 20 / 100 physDef; never returns below `minDamage` for a non-zero hit.
- **★ Two-pass ordering (the most important test in the phase):** a synthetic contribution of `+3 STR` raises `maxHp`, `physDamage` *and* `physDef` by exactly the §5 coefficients — proving attributes fold in *before* the formulas run. Written now, in Phase 6, even though no real equipment exists yet, so Phase 7 inherits a passing guard rather than writing its own.
- **Contribution symmetry:** derive-with-contribution then derive-without returns the exact bare baseline. No drift.
- **Stamina economy:** attacks are refused at 0 stamina; sprint auto-reverts at 0 and resumes past `SPRINT_MIN`; block applies `blockReduction` and guard-breaks at 0; regen respects `regenDelayMs`.
- **ATB parity:** a combatant with default attributes fills the ATB bar in a comparable time to v0.6.0's `spd`-driven bar — pacing preserved, not accidentally doubled.
- **Formula evaluator:** `physDamage − physDef` on a v2 stat block returns the expected number; a custom stat key resolves through `custom`; an unknown key resolves to 0 rather than throwing.
- **Cache invalidation:** editing `StatRules` in the new panel updates every live entity's `effectiveStats()` without a reload.
- **Version gate:** owned and tested by F Phase 1. Phase 6 adds no version-handling test; it inherits a passing one.

## 12. Decisions locked this phase

- Attributes STR/AGI/INT stored; current pool values stored; **all** maxima and combat stats derived by the pure `deriveStats(base, contrib?)`.
- **No migration, no legacy `atk`/`def`/`spd` aliases.** v2 is clean. v1 files are rejected, not converted. Emberfall is re-authored.
- ATB charges off `attackSpeed` — which makes weapon speed affect turn order for free in Phase 7.
- Damage mitigation is a diminishing-returns curve, floored at `minDamage`, never flat subtraction.
- **Contributions, not mutations** — gear and buffs feed `DerivationInputs`; stored stats are never written by them. Two-pass ordering is specified and tested here.
- `DamageType` and `DerivedKey` are defined in Phase 6 and consumed unchanged by 7, 8, and 9.
- `EffectiveStats` reserves `resistances` (Phase 7) and `resistPercent` (Phase 9) from the start.
- All coefficients live in the project-level `StatRules`; **the full editor ships this phase** and defines the database-editor pattern for Phases 7–10.
- Block and sprint are new `CombatantEntity` actions with stamina cost; blocking works bare-handed and is *improved* by a shield, never gated on one. Jump is contextual gap-hop — cost reserved, input deferred.
- `tile-engine.ts` untouched. The `schemaVersion` bump and the v1 rejection gate belong to Phase 5.5; Phase 6 extends the v2 container rather than creating it.

## 13. Corrections this doc implied for Phases 7–9 — ALL APPLIED

**Status: closed. Do not re-apply.** Every item below was folded into `PHASE7_DESIGN.md` v3, `PHASE8_DESIGN.md` v2, and `PHASE9_DESIGN.md` v2. The list is retained as provenance — so a reader can see *why* those documents say what they say — not as outstanding work.

1. **Phase 7 §5, step 2** — `defender.magicResist` does not exist. Read `defender.resistances[hit.type] ?? defender.spellResist ?? 0`.
2. **Phase 7 §5, step 6** — `resolveDamage` takes `EffectiveStats`, not entities, so it cannot charge stamina or trigger a guard break as written. Keep it pure: return `{ final, immune, blocked, type, staminaCost, guardBroken }` and let the caller apply the state change. Pure damage math is also what makes the whole immunity test suite possible.
3. **Phase 7 §4.3** — `EquipmentDef.bonuses` should be typed `Partial<Record<DerivedKey, number>>` against §4.2's union, and its `attributeBonuses`/`bonuses`/`resistBonuses` triple is exactly `StatContribution`; reuse the type rather than restating it.
4. **Phase 9 §5.2** — `HumanEnemyDef.resistPercent` is redundant now that `StatBlock` carries it. Drop the duplicate.
5. **Phase 9 §5.1** — `MonsterDirectStats` had no mana or stamina, but §8's block/regen loop assumes every combatant has pools. *Applied as:* explicit `maxMana` and `maxStamina`, both defaulting to 0, so "monsters cannot block, sprint, or cast" is a defined behavior rather than an undefined one — and Phase 10 can let a monster cast without a schema change.
6. **Phase 8 §5.2 and §11 Q4** — the protagonist was referred to by a placeholder lifted from the genre reference. *Resolved:* the hero is named by the player at character creation, defaulting to **Elms** (male) or **Chels** (female). Phase 11 owns the flow.

---

*LoreBrix, ELMSCORP. Phase 6 design v4.*
