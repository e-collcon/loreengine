# Phase 10 — Spells, Abilities & Delivery · Technical Design (v6)

**Status:** **v6 — reconciled with the Foundation Rewrite (§R).** Design (no code yet) · supersedes v4 · **durations become a `Duration` union including game time and `until` boundaries (§5.8b), which also delivers the Greater Powers parked in §10.5 — from Phase 14 §9 A1/A2**
**Depends on:** Foundation Phases 1–5 (F: `castSegment`, factions, acquisition, `StatusEffectDef`, `ActiveEffects`, `Duration`, executor), Phase 6 v5 (pools, `StatContribution`, `StatRules`), Phase 7 v5 (`resolveDamage`, `deal-damage`), Phase 8 v7 (effects, the `learn-skill` seam), Phase 9 v5 (monster stats, attack selection)
**Schema:** extends v2
**Recommended effort:** Extra High throughout. This is the largest phase in the arc.

### Changes in v2 — five gaps closed

A gap analysis run against source (not against the docs) found five things this phase assumed existed and which do not. All are folded in below.

| Gap | Found | Fix |
|---|---|---|
| **v3: the skill list was not dual-source parameterized** | Phase 11 | §12 — `SkillPanelSource` + `PanelMode`. In `play` mode `edit` is simply absent, which makes read-only structural rather than a disabled button somebody re-enables. |
| **Line of sight does not exist.** v1 described `requiresLineOfSight` and `stopsAtTerrain` as "reuse Phase 3's `TerrainService`." False. `visible` is a boolean handed in by the caller, computed in `App.tsx` as `distTiles <= 6`, and `playtest.ts` says so in its own header. There is no occlusion geometry anywhere. | source | §6.1 — `castRay()`, one primitive serving three consumers. Plus acquisition range (§10.1) and a **faction model** (§5.6), which nothing owned. |
| **`StatusEffectDef` is v1-shaped and contradicts Phase 6 v2.** It uses the deleted `atk`/`def`/`spd` keys, its duration is turn-only, and `tickDamage` is an untyped number that bypasses `resolveDamage` — breaking the one-pipeline law. | source | §5.7 — rewritten. |
| **Nothing owns buff lifetime.** Phase 8 introduced timed buffs, Phase 6 accepts them as contributions, Phase 10 makes them common — but no component holds the list, ticks it, expires it, or invalidates the stats cache. Stacking was a bare `stackable: boolean` with undefined semantics. | design | §7 — the `ActiveEffectSet`. |
| **Turn-based mode underspecified.** `actionPointsPerTurn` exists in `TurnBasedConfig` but skills have no AP cost, so a spell is free relative to attacking. `castTimeMs` had no turn-based meaning, which made the entire interruption system action-mode-only. | source | §5.8 — dual-unit durations and `msPerTurn`. |
| **Global cooldown unreconciled.** `ActionRPGConfig.cooldown` is `{ type: 'global' \| 'per-skill' }` — an MMO-style GCD, not what was wanted. | source | §10.5 — `cooldownGroup`, GCD deprecated, Greater Powers parked to Phase 14. |

Three smaller ambiguities are also resolved: a projectile whose homing target dies mid-flight (§8), whether an explosion hits its own caster (§5.3), and whether cooldowns survive a save (§10.6).

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

**v6 revision:** reconciled with the Foundation Rewrite. Effect and delivery stay orthogonal; one skill schema with two views, `resolveHeal`, the interruption models, spread, pierce, and the dual-source panel are unchanged. Five of v2's "folded gaps" now arrive built, so this phase shrinks to skills, delivery, projectiles, casting, and the formula graph.

### R.1 Already built by F — use these, do not rebuild them

| v5 section | Now provided by | What Phase 10 still adds |
|---|---|---|
| §6.1 `castRay()` | `castSegment` (F §7.6): 3D, height-aware, blocks by `blocksSight` or `blocksProjectiles` | Nothing |
| §5.6 faction model (`hostileTo`) | F's three-state relation matrix (F §4.5, §7.7) | `affects` resolves through it: `enemies` = factions the caster's faction regards as hostile |
| §11.1 acquisition | F §7.7, with line of sight and high ground | `fieldOfViewDegrees?` on the `acquisition` component (additive) |
| §5.7 `StatusEffectDef` v2 | F's `StatusEffectDef` with `restricts`, `flags`, `periodic`, stacking, `stackScope` | The `script` payload (`onApply`, `onTick`, `onExpire`), the `cast` restriction, and the fields `icon`, `dispellable`, `vfxClip` |
| §7 `ActiveEffectSet` | F's `ActiveEffects` (ticking, expiry, restriction gating, change notification) | Nothing; Phase 6 adds contributions |
| §5.8 dual-unit durations, §5.8b `Duration` | F's `Duration` union (`ms`, `turns`); Phase 14 adds `game-minutes` and `until` | `cooldown` and `castTime` on skills are `Duration`s |

**Periodic damage stays in one pipeline.** v5's `periodic: { damage, restore }` is superseded by F's `periodic: { interval, actions }`. Poison is `periodic` with a `deal-damage` action (Phase 7 §R.3), so it meets resistances, RPD, and immunity like every hit.

### R.2 The formula graph is built here

Phase 10 is the first consumer of formula magnitudes, so it builds them: the `FormulaGraph` type, `evaluateFormulaGraph` (pure, in `runtime`), and the node-canvas editor (in `editor`). v0's Phase 4 canvas does not exist in the greenfield repo. Phase 12 later adds the `variable` node; Phase 13 reuses the canvas for dialogue.

### R.3 Geometry in the hex world

- All delivery geometry stays world-space, now on hex-iso only (F Q16). The "square *and* hex" test variants become hex-only.
- Shapes are tested in the world plane plus a **vertical band**: an area, cone, or beam affects an entity whose height range overlaps the caster's feet ± the shape's `verticalReach` (default: the attack rule's, F §7.8). Beams travel in 3D through `castSegment`.
- Units: `rangeTiles`, `radiusTiles`, `widthTiles`, `speedTilesPerSec` are in hexes; `radiusPx` becomes `radius` in world units.
- `type Faction = 'enemies' | 'allies' | 'all' | 'self'` is renamed **`Affects`**, so it is not confused with `FactionDef`.

### R.4 Projectiles in a world with height

A projectile is a runtime-only entity (`Transform` with `z`, `Motion`, a `ProjectileState`), never serialized. It launches from the caster's chest height and travels straight. Each tick its step is tested with `castSegment` in `projectile` mode, so cliffs and walls stop it; entity hits test collider cylinders. Explosions detonate on terrain impact as v5 specifies.

### R.5 Known skills and casting

- `knownSkills` is a **`skills` component**. Learning is the `learn-skill` effect (Phase 8 seam closes).
- The player casts through a runtime command (bound to the hotbar in Phase 11). Enemies cast through F's brain `attack` behavior, whose candidates widen to `attackIds ∪ skillIds`, with the three filters in §11.2.
- A cast windup raises a `cast-windup` presentation event, so F's feedback system can telegraph spells the way it telegraphs attacks.
- Events owned here: `skill-learned`, `skill-cast`.

### R.6 Editors

The Skill Database is the next sibling of F's database-editor pattern. The status-effect editor is F's, extended with the new payloads; there is no v0 Phase 4 panel to rewrite. The skill panel lives in the `panels` package (Phase 7 §R.8).

### R.7 Build order

10A loses its four "foundation" items (`castRay`, factions, acquisition, `ActiveEffectSet`) and gains the formula graph. The suggested split point "after the `ActiveEffectSet`" no longer applies; 10A is skills, effects, instant delivery, and the formula graph, and 10B is projectiles.

### R.8 §16's amendments

Items 4–7 are resolved by F (no v0 panels or `aggroRadiusPx` exist to amend; factions shipped in F Phase 1). Items 1–3 were already applied. Item 8 stands: Phase 11 owns serializing effects and cooldowns (now component state) and the hotbar.

### R.9 Authored attributes (later on 16 Nov)

Attributes are project content (Phase 6 v6 §R.11). Skill `requirements` are keyed by attribute id. `concentration` is just a row in the derivation table, so "concentration from INT" is Emberfall's authoring, not engine code.

---

## 0. Decisions carried in from E

1. **Healing gets its own resolution path.** No resistances, no armor, no immunity, no damage floor. A heal is not negative damage.
2. **Monsters can cast real spells.** Phase 9 v2's `MonsterDirectStats.maxMana` was reserved for exactly this; it now has a consumer.
3. **All delivery shapes are in scope**, and E specified them precisely:
   - **Projectiles**, homing or non-homing. A non-homing projectile must actually intersect an enemy hitbox to deal damage; on hit it disappears.
   - **Beams**, which damage everything along their path.
   - **Explosive projectiles** — homing or non-homing — which detonate into an AoE at the point of impact.
   - **Multi-spawn**: firing several projectiles or beams spread over an angle.
4. Carried from the planning session and recorded in a design doc for the first time here: **spells and abilities are one schema**, discriminated by `resource: 'mana' | 'stamina'`, surfaced as two filtered views in the UI. Two lists, one system.
5. **Cast interruption has three independent models** — probability, free hits, and conditional — each separately enabled and tuned by the creator. All three off means casting is never interrupted. §10.3.
6. **`pierce` stays.**
7. **Only the player earns EXP.** Phase 9's kill-credit non-goal stands unchanged; a monster killing another monster with a fireball awards nothing to anyone.
8. **The hero's name is customizable**, defaulting to **Elms** for a male character and **Chels** for a female one. This closes the placeholder question left open since Phase 8.

## 1. Goal

An editable Active Skill Database that reuses Phase 4's node-based formula editor — generalized from pure damage math into something that also heals, buffs, and applies status — plus the delivery layer that gets a skill from the caster to its victims: targeted, area, cone, beam, and traveling projectiles, in both turn-based and action mode, on both square and hex maps.

## 2. Non-goals

- **Passive skills / talent trees** — not requested. `ActiveSkillDef` is named for the distinction; a passive system would be a sibling database, not a field here.
- **Channeled skills** (hold to sustain, drain per second) — deliberately omitted. Cast time is a fixed windup, not a channel.
- **Summons / pets** — a skill that spawns an ally is expressible today via the `script` effect and Phase 1's `SpawnEnemy` trigger action, so nothing forecloses it, but no summon-ownership or pet-AI system is built.
- **TEA** — still its own future phase. Phase 10 reserves `school` (§5.1), which was one of its two hard blockers.
- **Reworking the shop, menu, or character screens** — Phase 11 owns the player-facing Spells screen, per the standing "backend now, UI later" pattern. Phase 10 builds the creator-facing database editor and the runtime.

## 3. Central design decision #1 — effect and delivery are orthogonal

This is the decision the whole phase hangs on, so it comes first.

A skill is two independent questions that have nothing to do with each other:

- **What does it do?** — damage, heal, buff, status, script. The *effect*.
- **How does it reach the victim?** — self, targeted, area, cone, beam, projectile. The *delivery*.

Bolting these together produces a combinatorial nightmare: `Fireball`, `FireballBeam`, `FireballHoming`, `HealBurst`, `HealBeam`… every effect re-implemented per shape. Keeping them separate means an author picks one of each from two short lists and gets the whole matrix for free:

| Skill | Delivery | Effect |
|---|---|---|
| Fireball | explosive non-homing projectile | fire damage |
| Magic Missile | homing projectile | arcane damage |
| Lightning Lance | beam | lightning damage |
| Dragon's Breath | cone | fire damage + apply burn |
| Mend | single-target | restore hp |
| Circle of Renewal | area (caster origin, affects allies) | restore hp |
| Iron Skin | self | buff `physDef` |
| Volley | non-homing projectile, spread 5 over 40° | physical damage |

Eight authored skills, zero bespoke code per skill. **A healing beam is not a feature anyone has to build — it's a row in a database.**

The consequence worth stating plainly: `resolveDamage` (Phase 7) and `resolveHeal` (§8) never learn what shape delivered them. Delivery decides *who is affected*; effects decide *what happens to them*. Neither knows about the other.

## 4. Central design decision #2 — one skill schema, two views

Spells and abilities are structurally identical — a targeted effect with a cost, a cooldown, and an animation. The only difference is which pool they drain. Building two databases duplicates 90% of the same logic and guarantees they drift.

So: one `ActiveSkillDef` with `resource: 'mana' | 'stamina'`. The editor shows two tabs — **Spells** (mana) and **Abilities** (stamina) — which are filtered views over one array. The player-facing menu in Phase 11 does the same. Underneath, one schema, one evaluator, one cast path.

This also means a Power Attack and a Fireball go through the *identical* code, which is the point: the day someone wants a stamina-costing whirlwind that fires beams in eight directions, it already works.

## 5. Data model

### 5.1 `ActiveSkillDef`

```ts
type SkillResource = 'mana' | 'stamina';

interface ActiveSkillDef {
  id: UUID;
  name: string;
  description: string;
  icon?: AssetRef;

  resource: SkillResource;        // 'mana' → Spells tab · 'stamina' → Abilities tab
  cost: number;
  cooldownMs: number;             // may be 0
  cooldownTurns?: number;         // override; otherwise derived via msPerTurn (§5.8)
  cooldownGroup?: string;         // shared timer across skills (§10.5)
  castTimeMs: number;             // 0 = instant; a windup otherwise (§9)
  castTimeTurns?: number;         // override; otherwise derived (§5.8)
  actionPointCost: number;        // TURN-BASED only. Default 1. Without this a spell
                                  // is free relative to attacking.
  interruptible?: boolean;        // default true. false = this cast completes no matter
                                  // what lands on the caster — boss ultimates, rituals.
                                  // Overrides all three §10.3 models for this skill alone.

  requirements?: Partial<Attributes>;   // INT 12 to learn Fireball
  school?: string;                      // 'fire' | 'restoration' | … creator-defined.
                                        // RESERVED: this is one of the two things
                                        // Phase 9 §7.2 listed as blocking TEA.

  delivery: DeliveryDef;          // §5.3 — how it reaches
  effects: SkillEffect[];         // §5.2 — what it does, applied in order to every target

  animationClip?: string;         // caster animation
  impactClip?: string;            // played on each victim
  tags: string[];
}
```

**Project-level:** `project.skills: ActiveSkillDef[]` — the editable Skill Database, fifth sibling of the pattern established in Phase 6.

### 5.2 `SkillEffect` — reuse Phase 8, widen its magnitudes

Phase 8 already defined exactly the effect vocabulary a spell needs. Rather than invent a parallel one, **Phase 10 widens Phase 8's `Effect` type**, and both items and skills use it:

```ts
type EffectMagnitude =
  | { kind: 'fixed'; value: number }
  | { kind: 'formula'; graph: FormulaGraph };    // Phase 4, evaluated at cast time

type Effect =
  | { type: 'damage'; damageType: DamageType; amount: EffectMagnitude;
      armorPen?: number; ignoreResistPercent?: number }
  | { type: 'restore'; pool: 'hp' | 'mana' | 'stamina'; amount: EffectMagnitude }
  | { type: 'restore-percent'; pool: 'hp' | 'mana' | 'stamina'; percent: number }
    // 'restore', not 'heal' — you do not "heal" stamina. Matches Phase 8 v3 exactly.
    // The resolution FUNCTION keeps the name resolveHeal (§9); it only touches HP.
  | { type: 'apply-status'; statusId: UUID }        // Phase 4 StatusEffectDef
  | { type: 'cure-status'; statusId: UUID }
  | { type: 'buff'; contribution: StatContribution; durationMs: number }   // Phase 8 v2
  | { type: 'learn-skill'; skillId: UUID }          // the spellbook's receiver, §10.4
  | { type: 'pacify'; durationMs?: number }        // Phase 13 §6.2 — removes a faction
                                                    // override. Omit durationMs for a
                                                    // permanent Calm; set it for a timed
                                                    // Charm that reverts on expiry.
  | { type: 'script'; actions: TriggerAction[] };   // runs on the ActionExecutor
                                                    // (Phase 5.5 v2 §3.8)
```

Phase 8's items keep working untouched — a potion's flat `50` is simply `{ kind: 'fixed', value: 50 }`. The widening is additive, and it hands items formula-scaled magnitudes for free as a side effect.

**Why formulas matter here.** A Fireball that always deals 30 is a bad spell; one that deals `spellPower × 1.5 + 10` scales with the character. That expression is exactly what Phase 4's node canvas already builds — this is the reuse the whole phase was predicated on.

### 5.3 `DeliveryDef`

```ts
type Faction = 'enemies' | 'allies' | 'all' | 'self';

interface DeliveryBase {
  affects: Faction;               // §5.6 — a fireball hits enemies; a group heal hits allies
  includeCaster?: boolean;        // default FALSE. Resolves "does my own fireball
                                  // explode on me?" — no, unless the creator says so.
  spread?: SpreadDef;             // §5.5 — projectile and beam only
}

type DeliveryDef = DeliveryBase & (
  | { shape: 'self' }

  | { shape: 'single-target'; rangeTiles: number; requiresLineOfSight: boolean }

  | { shape: 'area';                       // instant AoE, no travel
      origin: 'caster' | 'aimed-point';
      rangeTiles: number;                  // how far the aimed point may be placed
      radiusTiles: number }

  | { shape: 'cone'; rangeTiles: number; arcDegrees: number }

  | { shape: 'beam';
      rangeTiles: number;
      widthTiles: number;
      stopsAtTerrain: boolean;             // default true — walls block it
      maxTargets?: number }                // undefined = everything on the line

  | { shape: 'projectile'; projectile: ProjectileDef }
);
```

`affects` is thin today — LoreBrix has one player character and hostile NPCs — but it costs one field now and becomes load-bearing the moment **Phase 13**'s incite-to-fight makes a third party possible.

### 5.4 `ProjectileDef`

```ts
interface ProjectileDef {
  homing: boolean;
  speedTilesPerSec: number;
  rangeTiles: number;             // despawn distance from origin
  radiusPx: number;               // collision radius against entity hitboxes
  stopsAtTerrain: boolean;        // default true
  turnRateDegPerSec?: number;     // homing only. undefined = perfect tracking;
                                  // a finite value means a fast target can outrun it
  onImpact?: { radiusTiles: number };   // EXPLOSIVE — detonates into an AoE at the
                                        // impact point, hitting everything in radius
  pierce?: number;                // default 0 = disappears on first hit, per E's spec.
                                  // N > 0 passes through N victims first.
  spriteId?: AssetRef;
  trailClip?: string;
}
```

**`pierce` was one field beyond spec and E kept it.** The default of `0` is exactly E's stated behavior — "on hit, the projectile disappears." Any higher value buys a piercing arrow, a railgun bolt, and a spear that skewers a line of goblins, all authored, no code.

**Explosive + non-homing is the Fireball.** Explosive + homing is the seeking missile. Both fall out of two independent booleans rather than being two skill types.

### 5.5 `SpreadDef` — multi-spawn over an angle

```ts
interface SpreadDef {
  count: number;                  // 1 = a single projectile/beam
  arcDegrees: number;             // total fan width, centered on the aim vector.
                                  // 0 = every instance along the same vector (a burst)
  jitterDegrees?: number;         // random per-instance wobble — a shotgun, not a fan
}
```

Spread lives on `DeliveryBase`, not inside `ProjectileDef`, because E asked for it on **both** projectiles and beams. `count: 5, arcDegrees: 40` fires a five-way fan; each instance is independent, so a five-way explosive volley produces five separate detonations, and a target caught by two of them takes two hits. That's correct and it emerges for free.

> ⚠ **Superseded — F ships the relation matrix; `hostileTo` is superseded (§R.1).**

### 5.6 The faction model — nothing owned this

`affects: 'enemies'` is unanswerable today, because **no entity carries a faction.** Acquisition (§10.1) needs the same answer to "hostile to whom?" One small addition serves both:

```ts
type FactionId = string;          // 'player' | 'hostile' | 'neutral' | creator-defined

interface FactionDef {
  id: FactionId;
  name: string;
  hostileTo: FactionId[];         // explicit. Absence of an entry means neutral.
  isPlayerFaction: boolean;
}
```

`project.factions: FactionDef[]` — the seventh sibling database, though a small one that needs only a list-and-edit panel. `CombatantBase` gains `faction: FactionId`.

Resolution is then mechanical: **`enemies`** = every combatant whose faction appears in the caster's `hostileTo` (or whose faction lists the caster's) · **`allies`** = same faction · **`all`** = everyone in the delivery shape · **`self`** = the caster only. The caster is excluded from `enemies` and `all` unless `includeCaster` is set.

This also makes Phase 13's incite-to-fight buildable — provoking an NPC is a faction change, not a bespoke mechanic.

> ⚠ **Superseded — F ships `StatusEffectDef`; Phase 10 adds only `script`, `cast`, `icon`, `dispellable`, `vfxClip` (§R.1).**

### 5.7 `StatusEffectDef` v2 — the shipped type is broken

What is in `types.ts` today:

```ts
durationTurns: number;
statModifiers?: Partial<Record<'atk' | 'def' | 'spd', number>>;   // ← deleted keys
tickDamage?: number;                                              // ← untyped
stackable: boolean;                                               // ← undefined semantics
```

Three failures at once: it references stat keys Phase 6 v2 deleted, it cannot express anything in action mode, and its tick damage bypasses `resolveDamage` — so poison would ignore resistances, RPD, and immunity, breaking the one-pipeline law that Phase 7 was built around. Rewritten:

```ts
interface StatusEffectDef {
  id: UUID;
  name: string;
  icon?: AssetRef;
  description?: string;

  // ── LIFETIME ─────────────────────────────────────────────
  isPermanent: boolean;           // when true, both durations are ignored entirely
  durationMs: number;
  durationTurns?: number;         // override; otherwise derived via msPerTurn (§5.8)

  // ── STACKING — a property of the effect, per E ───────────
  stackMode: 'refresh' | 'stack' | 'ignore' | 'independent';
  maxStacks?: number;             // 'stack' only
  stackScope: 'per-source' | 'global';

  // ── PAYLOAD — any combination of the four ────────────────
  contribution?: StatContribution;    // stat bonuses, merged through the SAME path as gear
  periodic?: {                        // DoT and HoT
    intervalMs: number;
    intervalTurns?: number;
    damage?: DamageInstance;          // TYPED → routes through resolveDamage properly
    restore?: { pool: 'hp' | 'mana' | 'stamina'; amount: EffectMagnitude };
  };
  restricts?: ('move' | 'attack' | 'cast' | 'block' | 'sprint')[];
  script?: {
    onApply?: TriggerAction[];
    onTick?: TriggerAction[];
    onExpire?: TriggerAction[];
  };

  dispellable: boolean;
  vfxClip?: string;
}
```

**`restricts` is how a stun actually works**, and it is what interruption Model C keys off — `interruptStatusIds` names effects from this list. Nothing about "being stunned" is special-cased; it is a status whose payload happens to forbid acting.

**Stack modes, exactly:**

| mode | applying to an already-affected target |
|---|---|
| `refresh` | resets the timer, no intensity change. Poison. |
| `stack` | adds an instance up to `maxStacks`; contributions and ticks multiply. Bleed. |
| `ignore` | the new application does nothing. A one-shot mark. |
| `independent` | a separate instance with its own timer, always. |

`stackScope: 'per-source'` is the nuance that matters: two different casters' poisons coexist, but one caster cannot double-dip. `'global'` treats all sources as one.

**Amendment this forces on Phase 4:** its Status Effects manager panel edits the v1 shape and must be rewritten against this. That is inside Phase 10's scope.

> ⚠ **Superseded — the union lives in F; Phase 14 adds its game-time kinds (§R.1).**

### 5.8b The `Duration` union — three units and an anchor

Phase 14 amendment A1. `durationMs` plus an optional `durationTurns` cannot express *"for the rest of the day"*, which is what a day-gated spell needs:

```ts
type Duration =
  | { kind: 'ms'; value: number }
  | { kind: 'turns'; value: number }
  | { kind: 'game-minutes'; value: number }        // Phase 14 game time
  | { kind: 'until'; boundary: 'dawn' | 'dusk' | 'midnight'
                             | 'end-of-day' | 'end-of-week'
                             | 'end-of-month' | 'end-of-year' };
```

Applies to `StatusEffectDef.duration`, `Effect.buff` duration, and `ActiveSkillDef.cooldown`.

**`until` is an anchor, not a duration.** *Monday Madness* cast at 11pm lasts one game hour, not a full day. That is the correct behavior and it has to be deliberate, because an author reading "until end of day" will otherwise assume a fixed length.

**`ms` remains canonical** and §5.8's `msPerTurn` conversion is unchanged, so nothing authored migrates. A project with `CalendarDef.enabled: false` simply never sees the two game-time kinds in its pickers.

**This closes the Greater Powers deferral in §10.5.** A cooldown of `{ kind: 'until', boundary: 'end-of-day' }` **is** a once-per-day power. No new field — the parked feature arrives as a consequence of the union, exactly as that section predicted it would once a clock existed.

> ⚠ **Superseded — durations are F's `Duration` union (§R.1).**

### 5.8 Dual-unit durations — one authored value, both combat models

LoreBrix ships turn-based *and* action mode, and every duration in this phase needs meaning in both. Forcing creators to fill in two units for every field is a tax nobody will pay accurately.

**The rule:** milliseconds are canonical. A turn value is **derived** as `ceil(ms / msPerTurn)` unless an explicit `*Turns` override exists.

```ts
// project.gameplayRules
msPerTurn: number;              // default 3000
```

Applies uniformly to skill `cooldown`, skill `castTime`, status `duration`, and periodic `interval`. Overrides exist because a 3-turn poison should sometimes be exactly 3 turns rather than whatever 9 seconds rounds to.

**Cast time in turn-based mode** is the piece that was undefined. `castTimeTurns > 0` means the skill is **committed now and resolves N turns later**; the caster is locked in for that window. Which means interruption (§10.3) works identically in both modes — any qualifying hit landing during the committed turns runs the same three checks. No second mechanic, no special case.

**Action points:** `actionPointCost` (default 1) is spent from `TurnBasedConfig.actionPointsPerTurn`. Without it a spell costs nothing relative to a basic attack, which is the kind of imbalance that only shows up in playtest.

## 6. Delivery geometry — one pure resolver, two combat modes

LoreBrix ships **turn-based and action mode**, and a traveling projectile is meaningless in a turn-based ATB fight. This is the sharpest integration question in the phase, and the answer is a clean split:

```ts
// Pure geometry. No entities are mutated; no time passes.
resolveTargets(
  origin: Vec2,                   // world space
  aim: AimVector,
  delivery: DeliveryDef,
  candidates: CombatantEntity[],
  terrain: TerrainService,
): CombatantEntity[]
```

- **Instant shapes** — `self`, `single-target`, `area`, `cone`, `beam` — call `resolveTargets` and apply effects immediately. **Identical in both modes.** Action mode plays a visual; turn-based skips it.
- **Projectiles** — in **action mode** they are real entities with real travel and real collision (§7). In **turn-based** mode they resolve analytically the instant they're cast: a homing projectile hits its chosen target; a non-homing one hits the first candidate along the aim vector, or nothing. Same outcome the simulation would produce, computed without simulating it.

> ⚠ **Superseded — hex-only, with a vertical band; see §R.3.**

**All delivery geometry is world-space, not tile-space.** Phase 3's entities already live at world pixel coordinates with `cellToWorld`/`worldToCell` converters, so a beam is a line segment and an explosion is a circle — and both work unchanged on square grids *and* hex-iso maps. Doing this in tile coordinates would have meant two implementations of every shape, one of them involving hex ring math. This is the single biggest reason to put geometry in world space, and it's worth stating explicitly so nobody "simplifies" it later.

Terrain occlusion (`stopsAtTerrain`, `requiresLineOfSight`) reuses **Phase 3's `TerrainService`** — the collision layer that already blocks movement blocks beams and projectiles too. No new terrain concept.

Candidate lookup reuses **Phase 3's spatial hash** — `entitiesInRadius` for areas and explosions, `entitiesInRect` on the beam's bounding box before the precise line test. The engine work for "who's near this point" was done in Phase 3 and is being collected now.

> ⚠ **Superseded — use F's `castSegment` (§R.1).**

### 6.1 `castRay()` — the primitive that does not exist yet

v1 of this document claimed `requiresLineOfSight` and `stopsAtTerrain` would "reuse Phase 3's `TerrainService`." **That was wrong.** In source, `visible` is a boolean handed *in* by the caller, `App.tsx` computes it as `distTiles <= 6`, and `playtest.ts` documents the approximation in its own header. There is no occlusion geometry in the engine. An enemy currently acquires you through a solid wall.

```ts
interface RayResult {
  blocked: boolean;
  hitPoint: Vec2;                 // where it stopped — equals `to` when unblocked
  distance: number;
  cells: GridPos[];               // traversed, in order
}

castRay(
  from: Vec2,
  to: Vec2,
  terrain: TerrainService,
  opts: { test: 'sight' | 'projectile' | 'movement'; stepPx?: number },
): RayResult
```

**Implementation: march in world space** at a fixed sub-tile step (a quarter tile is ample), convert each sample with `worldToCell`, test the blocking layer. Roughly forty lines, and it works **identically on square and hex** because `worldToCell` already handles both geometries. A proper DDA would be more exact and would need two implementations — one of them involving hex traversal math — and gameplay cannot tell the difference.

**Terrain gains two optional flags**, each defaulting to whatever blocks movement, so nothing changes unless a creator authors it:

```ts
blocksSight?: boolean;
blocksProjectiles?: boolean;
```

Because "blocks movement" is not "blocks sight." A chest-high wall stops walking but not arrows. A window stops neither sight nor arrows but stops you.

**Three consumers, one primitive:** acquisition (§10.1), skill targeting (`requiresLineOfSight`), and projectile/beam travel (`stopsAtTerrain`, tested per movement step). It also retroactively upgrades Phase 4's behavior machines — the `line-of-sight` transition condition stops being a distance lie and becomes real.

> ⚠ **Superseded — F's `ActiveEffects` owns lifetime (§R.1).**

## 7. Buff and status lifetime — the `ActiveEffectSet`

Phase 8 introduced timed buffs, Phase 6 accepts them as `DerivationInputs.buffs`, and this phase makes them common — but **no component owns the list.** Nothing ticks it down, expires entries, or invalidates the memoized stats cache. That owner is defined here.

```ts
interface ActiveEffect {
  instanceId: UUID;
  statusId: UUID;                 // → StatusEffectDef
  sourceSkillId?: UUID;           // ★ the binding E asked for — which skill applied this
  sourceEntityId?: UUID;          // enables "dispel everything that caster put on me"
  stacks: number;
  remainingMs: number;            // ignored when isPermanent
  nextTickInMs: number;
}

// on CombatantEntity
class ActiveEffectSet {
  apply(statusId, source): ActiveEffect | null;   // honors stackMode / stackScope
  remove(instanceId): void;
  removeByStatus(statusId): void;
  dispelFrom(sourceEntityId): void;               // dispel by caster
  contributions(): StatContribution[];            // → DerivationInputs.buffs
  restrictions(): Set<Restriction>;               // → canMove/canAttack/canCast/…
  tick(dtMs: number): void;                       // action mode
  tickTurn(): void;                               // turn-based mode
}
```

`tick` fires periodic damage and healing through `resolveDamage` / `resolveHeal`, runs `onTick` scripts, expires finished instances, fires `onExpire`, and **invalidates `effectiveStats()` on any change** — that last part is the bug this section exists to prevent.

**Restrictions gate the runtime API.** `canCast` returns `restricted` when a `'cast'` restriction is active; the same for move, attack, block, and sprint. One list, five consumers, no special-cased stun logic anywhere.

**★ Equipment must never become an ActiveEffect.** Gear is already a contribution derived from `loadout` on every `deriveStats` call. Routing it through this set would make unequip stateful again — restoring precisely the classic RPG bug (equip and unequip a ring twenty times, gain phantom stats) that Phase 7 was architected to make structurally impossible. Gear is contributed; effects are held. Different lifetimes, different owners.

> ⚠ **Superseded — projectiles move in 3D and stop on `castSegment` (§R.4).**

## 8. The projectile runtime (action mode)

A new entity kind, `projectile`, joining player/npc/prop/doodad. It is **runtime-only and never serialized** — projectiles in flight are not part of an authored map, and a playtest snapshot restore simply clears them.

```ts
class ProjectileEntity extends BaseEntity {
  ownerId: UUID;                  // for faction filtering and EXP credit
  skillId: UUID;                  // effects to apply on hit
  def: ProjectileDef;
  velocity: Vec2;                 // world units/sec
  traveled: number;
  hitsRemaining: number;          // pierce + 1
  hitIds: Set<UUID>;              // never hit the same victim twice
}
```

**Per-frame step, inside `EntityManager.update(dt)`:**

```
1. HOME       if (homing && target alive)
                 steer velocity toward target, clamped by turnRateDegPerSec
              if (homing && target DEAD)
                 → stop steering, continue on last velocity as a non-homing shot.
                   It expires at range or hits something else. It does NOT vanish
                   mid-air, which reads as a bug to a player watching it.

2. MOVE       pos += velocity · dt ;  traveled += |velocity| · dt

3. TERRAIN    if (stopsAtTerrain && !terrain.isWalkable(cellAt(pos))) → IMPACT

4. COLLIDE    for each candidate in spatialHash.entitiesInRadius(pos, radiusPx)
                 skip if in hitIds, skip if faction mismatch
                 → IMPACT on the first match

5. RANGE      if (traveled >= rangeTiles · tileSize) → EXPIRE (no impact)

IMPACT:       if (def.onImpact)  → resolveTargets(pos, area of onImpact.radiusTiles)
                                    and apply effects to everyone caught
              else               → apply effects to the single victim
              hitsRemaining-- ;  despawn at zero
```

Two details that are easy to get wrong and are therefore specified:

- **`hitIds` exists because of `pierce`.** Without it, a piercing projectile whose collision radius overlaps a victim for three consecutive frames hits them three times.
- **Explosion on terrain impact still detonates.** A fireball that hits a wall should explode against the wall, damaging anyone standing next to it. Only a non-explosive projectile vanishes silently.

**Turn-based mode never instantiates this class.** §6's analytic path covers it.

## 9. Healing — its own path, per E

```ts
resolveHeal(
  caster: EffectiveStats,
  target: EffectiveStats,
  pool: 'hp' | 'mana' | 'stamina',
  amount: number,
): { healed: number; overheal: number }
```

Pure, like `resolveDamage`. **It touches nothing from the damage pipeline** — no `resistances`, no `resistPercent`, no armor, no immunity ratio, no `minDamage` floor. The only rule is clamping at the derived maximum, with the excess reported as `overheal` so the UI can show a distinct "already at full health" response instead of a silent no-op.

This is the right call and worth defending: routing healing through `resolveDamage` as negative damage would mean heavy armor reduces how much you can be healed, and a `minDamage` floor of 1 would make every heal-immune case leak a point of healing. Those are absurdities you'd then spend the phase writing exceptions for. Two small pure functions beat one clever one.

**Deliberately not built:** healing that harms undead. It's a real genre staple, but it would require the heal path to consult a resistance table, which is precisely the coupling this decision avoids. If it's wanted later, the honest implementation is a *damage* effect on a skill that also happens to heal the living — authored, not engineered.

## 10. Casting, cost, and learning

> ⚠ **Superseded — a `skills` component; casting is a command or a brain behavior (§R.5).**

### 10.1 Known skills live on `CombatantBase`

```ts
// CombatantBase — the same trick Phase 7 used for `loadout`
knownSkills: UUID[];
```

On the shared base, not the player. Which means §10's casting enemies need **no parallel system** — the third time this arc has collected on that pattern.

### 10.2 Runtime API

```ts
// CombatantEntity
knowsSkill(skillId): boolean
learnSkill(skillId): boolean            // false if already known
canCast(skillId, aim?): CastResult      // dry-run → grays the button WITH the reason
cast(skillId, aim: AimInput): CastResult
tickCasting(dt): void                   // windup, from EntityManager.update

type AimInput =
  | { kind: 'none' }                    // self
  | { kind: 'entity'; id: UUID }        // single-target, homing
  | { kind: 'point'; world: Vec2 }      // aimed-point area
  | { kind: 'direction'; radians: number };  // cone, beam, non-homing projectile

type CastResult =
  | { ok: true; targets: UUID[]; spent: number }
  | { ok: false; reason: 'unknown-skill' | 'insufficient-resource' | 'on-cooldown'
                       | 'out-of-range' | 'no-line-of-sight' | 'already-casting'
                       | 'requirements-not-met'; readyInMs?: number };
```

`canCast` mirroring `cast` exactly is the same discipline as Phase 7's `canEquip` and Phase 8's `canUseItem`: the UI can always explain *why* something is grayed out, and there is never a "you can cast this" that then fails.

**Cost is charged on cast completion, not on windup start** — otherwise an interrupted cast silently eats mana and players report it as a bug.

### 10.3 Cast interruption — three independent models

Per E: three separately-toggleable models, freely combined, **and all three off means casting is never interrupted.** That last clause is what determines the architecture, so it comes first.

The naive reading of "three filters" would be a gate sequence where each stage can only *prevent* interruption — but then disabling all three would let everything interrupt, which is backwards. So the models are **requirements, not filters**:

```
canInterrupt(hit, cast):

  if (skill.interruptible === false)          → NO
  if (no model enabled)                       → NO      ← E's "all off = never"

  C · CONDITION   if (rules.interrupt.byCondition):
                     hit must carry a listed status OR a listed damage type
                     not qualifying → NO, and NO free hit is consumed

  B · ABSORB      if (rules.interrupt.byFreeHits):
                     freeHitsUsed++
                     if (freeHitsUsed <= freeHitsAllowed) → NO

  A · CHANCE      if (rules.interrupt.byChance):
                     roll( max(minChance, baseChance − concentration × chancePerConc) )
                     roll fails → NO

  → INTERRUPT
```

Every enabled model must pass. Zero enabled models means the sequence never reaches the bottom. One consequence worth specifying, because it's the kind of ordering detail this project has been bitten by before: **a hit that fails the Condition gate does not consume a free hit.** It was never an interrupting hit at all; charging the absorb buffer for it would silently drain poise against irrelevant damage.

**Resistance is a new derived stat: `concentration`, driven by INT.** Models A and B both need "how hard is this caster to disrupt," and they can share one number. Overloading `spellResist` — which already means magical damage mitigation — is exactly the two-names-for-one-thing mistake Phase 6 v2 removed from the codebase, so this is its own stat instead. **This is an amendment to Phase 6:** `concentration` joins the `DerivedKey` union and gets `concBase` / `concPerInt` coefficients in `StatRules.combat`.

```ts
// StatRules.interrupt — new block
interface InterruptRules {
  byChance: boolean;              // Model A — default false
  baseChance: number;             // 0..1, default 0.5
  chancePerConc: number;          // reduction per concentration point, default 0.02
  minChance: number;              // floor, default 0 — a high-INT caster CAN become
                                  // chance-immune. Raise it if you'd rather they couldn't.

  byFreeHits: boolean;            // Model B — default false
  baseFreeHits: number;           // default 1
  concPerFreeHit: number;         // +1 free hit per N concentration, default 10

  byCondition: boolean;           // Model C — default false
  interruptStatusIds: UUID[];     // e.g. [stun, silence] — the DotA-style rule
  interruptDamageTypes: DamageType[];  // empty = any damage type qualifies
}
```

All three default to **off**, which means a project that never opens this panel has uninterruptible casting and nothing surprises anybody. Free-hit counters are per-cast and reset on cast start or cancel.

**On interruption:** the cast is canceled, **no resource is spent** (cost is charged on completion, §10.2), and **no cooldown starts** — nothing was cast. A post-interrupt lockout is deliberately not built; if casters turn out to be too spammy under interruption, that's a tuning conversation, not a schema one.

### 10.4 The spellbook seam closes

Phase 8 defined a spellbook as a non-perishable usable whose effect is `{ type: 'learn-skill', skillId }`, and noted it would "validate and no-op gracefully" until Phase 10 built the receiver. `learnSkill()` is that receiver. Nothing in Phase 8 changes; the seam simply starts working.
### 10.5 Cooldown groups — and what the existing GCD flag actually is

`ActionRPGConfig.cooldown` in source is `{ type: 'global' | 'per-skill'; globalMs? }`. Checked: that is an **MMO-style global cooldown** — use anything, everything locks for N ms. It is a Phase 4 spec item, and it is not what anyone wants here.

What is wanted splits into two features:

**Shared cooldown groups — built now.** One optional field, `cooldownGroup?: string`. Casting any member of a group starts the timer for every member, using the *cast skill's* own `cooldownMs`. That covers "these three fire spells share a timer," it is a single lookup, and it is the honest version of what "global" was reaching for.

**Once-per-day powers — ~~parked~~ DELIVERED.** Elder-Scrolls-style Greater Powers needed a game clock, and Phase 14 provides one. They require no new field: `cooldown: { kind: 'until', boundary: 'end-of-day' }` via the `Duration` union in §5.8b. The deferral is closed.

**The MMO GCD is deprecated.** Nothing has shipped, so removing `cooldown.type: 'global'` costs nothing and avoids two competing cooldown systems in one engine. Per-skill plus groups covers every case discussed.

### 10.6 What survives a save

Both `ActiveEffectSet` instances and the cooldown map **persist into `SaveState`** — Phase 11 owns serializing them, Phase 10 owns their runtime shape. Stated explicitly because the alternative is silent: if cooldowns reset on load, saving and reloading becomes a free cooldown reset, and players find that within an hour.

Permanent effects (`isPermanent`) persist with no timer. Session-scoped state — projectiles in flight, an in-progress cast windup — is discarded, matching the same rule Phase 5's playtest snapshot already follows.

## 11. Enemy casting and acquisition

> ⚠ **Superseded — F ships acquisition; Phase 10 adds only `fieldOfViewDegrees` (§R.1).**

### 11.1 Acquisition range — enemies currently see through walls

Phase 3 gave `NPCEntity` an `aggroRadiusPx`, and Phase 4's behavior machines transition idle → chase on a `distance` condition. Both work. What is broken is that acquisition is **pure distance**, so a hostile acquires the player through solid stone. With `castRay()` (§6.1) existing, the fix is small:

```ts
// NPCEntity — replaces the bare aggroRadiusPx
acquisition: {
  radiusPx: number;
  requiresLineOfSight: boolean;   // default TRUE — the behavior change
  fieldOfViewDegrees?: number;    // undefined = 360°, i.e. eyes in the back of the head
  loseTargetAfterMs?: number;     // memory: keeps chasing briefly after losing sight
}
```

Warcraft-III-shaped, as E described it: a hostile acquires a target of a **hostile faction** (§5.6) that is inside `radiusPx`, within the field of view, and reachable by an unblocked sight ray. `loseTargetAfterMs` is what stops an enemy from instantly forgetting you the moment you step behind a pillar, which otherwise reads as broken AI rather than as stealth.

### 11.2 Skill selection

Phase 9 v2 gave monsters `maxMana`/`maxStamina` and human enemies a full `StatBlock` (mana derived from INT). Both now get `knownSkills` from `CombatantBase`. So enemy casting is data, not code.

Phase 9 §6.3's attack-selection AI — *random among currently off-cooldown attacks* — extends minimally. The candidate pool becomes `attacks ∪ knownSkills`, filtered by:

1. off cooldown, **and**
2. affordable from the caster's current pool, **and**
3. **the target is actually within the skill's delivery range** — new, and the one that matters. Without it a monster burns its turn casting a 3-tile cone at something 8 tiles away, which reads to a player as a broken enemy rather than a missing check.

Smarter prioritization (open with the big spell, heal at low HP, save the escape ability) remains explicitly deferred, exactly as Phase 9 deferred it.

**EXP credit is a non-question.** Only the player earns EXP — Phase 9's non-goal stands. A projectile carries `ownerId` purely for faction filtering and for not hitting its own caster; if a monster's fireball kills another monster, nothing is awarded to anyone. This is a classic RPG, not a lane game with last-hits.


### Dual-source parameterization — a **Phase 11 prerequisite**, not a nice-to-have

This panel is promised to Phase 11 as a player-facing screen, "reused verbatim." That promise has a condition, and it has to be met **here**, while the panel is being written — retrofitting it later means rewriting it, which is three panels' worth of rework landing in the single largest phase in the arc.

**The condition:** the panel must never reach for editor state. It takes a *source* object and a *mode*, and both the editor and the running game supply one.

```ts
type PanelMode = 'author' | 'play';
```

- **`author`** — the editor. The subject is an authored definition; the candidate pool is the whole database.
- **`play`** — the running game. The subject is a live `CombatantEntity` reading through `effectiveStats()`; the candidate pool is what the player actually has; definitions are **read-only** — a player may equip, use, and rearrange, but never edit the item behind it.

> ⚠ **Superseded — enforced by the `panels` package boundary (§R.6).**

**The enforceable version of this rule**, because "don't reach for editor state" is advice and advice does not survive implementation: *the panel module imports nothing from `App.tsx` or any editor-state module.* That is a one-line assertion over the module's import list, and it is in this phase's test plan below.

```ts
interface SkillPanelSource {
  mode: PanelMode;
  skills: ActiveSkillDef[];              // author: the whole DB
                                         // play: only knownSkills, resolved
  resource: SkillResource | 'all';       // the Spells / Abilities filter
  canCast?(skillId): CastResult;         // play only — grays the row WITH the reason
  cooldownRemainingMs?(skillId): number; // play only
  assignToHotbar?(skillId, slotIndex): void;  // play only (Phase 11 §10)
  edit?(skillId): void;                  // author only
}
```

The Spells/Abilities split is a filter over one list in both modes, exactly as §4 specifies. In `play` mode `edit` is absent, which is what makes read-only structural rather than a disabled button somebody can re-enable.

## 12. UI

- **Skill Database editor** — a Rules tab, the **fifth sibling** of the pattern (Phase 6 StatRules → Phase 7 Equipment → Phase 8 Items/Currency/Categories → Phase 9 Enemies → here). List + form + duplicate. Two filter tabs, Spells and Abilities, over one array.
- **The effect builder** hosts Phase 4's node canvas per formula-magnitude effect, with a live preview against a sample caster and a sample target — the same "what the creator sees is what the player gets" guarantee `evaluateFormulaGraph` already provides for damage formulas.
- **A delivery preview** — a small top-down diagram that draws the cone arc, the beam length and width, the explosion radius, and the spread fan to scale against a tile grid. Authoring a 40° five-way volley blind is miserable; this is the phase's signature moment and it's cheap, because it's the same geometry functions from §6 drawn instead of evaluated.
- **Combat Sanity Check, extended again** — Phases 7 and 9 taught it to flag enemies the player can't damage. It now counts reachable *spells* as damage sources, which will un-flag enemies that were only flagged because the checker didn't know about magic yet.
- **Entity inspector** — a compact known-skills editor, so a creator can hand a bandit shaman two spells directly on the map.

**One honest UX flag, unsolved.** The vision doc commits LoreBrix to tablets and phones. Two things in this phase are the worst offenders in the entire codebase for touch: the node canvas (inherited from Phase 4, which Phase 10 now uses in five more places) and directional aiming for cones, beams, and non-homing projectiles, which currently assumes a mouse position. I'm not proposing to solve mobile here — that deserves its own phase — but Phase 10 is where the debt compounds, and it should be on the record now rather than discovered during a mobile pass.

> ⚠ **Superseded — see §R.7.**

## 13. Build order — this ships in two chunks

Honest scope note: this phase is larger than Phase 7, and the v2 fold made 10A materially bigger. §5 and §6 are a database and pure geometry; §8 is a **new entity type inside the frame loop**. Those are different kinds of risk and they should not share a verification gate.

**Phase 10A — Foundations, skills, effects, and instant delivery.**
`castRay()` and the terrain sight/projectile flags (§6.1) · the faction model (§5.6) · acquisition range (§11.1) · `StatusEffectDef` v2 plus the Phase 4 status panel rewrite (§5.7) · the `ActiveEffectSet` (§7) · dual-unit durations and `msPerTurn` (§5.8) · `ActiveSkillDef`, the widened `Effect` type, `resolveHeal`, `knownSkills` + cast/learn API, cooldown groups · `resolveTargets` for self/single-target/area/cone/beam, spread-of-beams · the Database editor and the delivery preview · enemy casting for instant shapes. Turn-based mode is *complete* at the end of 10A. Action mode gets everything except traveling projectiles.

**Honest note on 10A's size after the fold.** A raycast primitive, a faction model, a status-effect rewrite, and a new runtime subsystem are four things that were not in v1's estimate. If 10A needs splitting during implementation, the clean seam is **immediately after the `ActiveEffectSet`**: everything up to that point is engine foundation that Phases 11–17 also consume, and everything after it is skill authoring that only this phase needs.

**Phase 10B — The projectile runtime.**
`ProjectileEntity`, homing steering, collision against the spatial hash, terrain impact, explosions, pierce, spread-of-projectiles, and the analytic turn-based equivalents.

10A is a working, shippable spell system on its own. If tokens run out mid-arc, stopping after 10A leaves LoreBrix in a coherent state rather than a half-built one — which is the same reason Phases 1–5 were chunked in the first place.

## 14. Testing plan

Strict `tsc`, production build, runtime tests. The geometry set is the priority, because it is pure and therefore cheap to test exhaustively:

- **Orthogonality (the thesis test):** the same `heal` effect authored onto `self`, `single-target`, `area`, and `beam` delivery produces correct results in all four, with no shape-specific code touched.
- **Geometry — square *and* hex:** every shape is tested on both map types with identical world-space inputs and identical expected victims. A beam across a hex map hits the same entities it would at the same world coordinates on a square map.
- **Cone arc:** an entity at 19° is hit by a 40° cone; one at 21° is not. The boundary is exact.
- **Beam:** hits *everything* on the line, in distance order; respects `maxTargets`; stops at a collision-layer wall when `stopsAtTerrain`.
- **Spread:** `count: 5, arcDegrees: 40` produces five instances at exactly −20°, −10°, 0°, +10°, +20°; `count: 1` ignores `arcDegrees` entirely.
- **★ Non-homing projectile requires a hit:** a projectile fired past an enemy travels its full range and expires dealing zero damage. E's spec, mechanized.
- **★ Projectile despawns on hit:** default `pierce: 0` produces exactly one victim; `pierce: 2` produces three, and never the same victim twice even across consecutive frames.
- **Explosive impact:** an explosive projectile hitting entity A also damages B standing 1 tile away; hitting a *wall* still detonates and damages anyone adjacent.
- **Homing:** reaches a stationary target; with a finite `turnRateDegPerSec`, a faster-moving target escapes.
- **Turn-based parity:** a homing projectile cast in turn-based mode damages the same target the action-mode simulation reaches. Casting in turn-based instantiates zero `ProjectileEntity`s.
- **Damage routes through the one pipeline:** a fire spell meets fire resistance, is stopped by a 100% RPD ghost (Phase 9), and can be amplified by `ignoreResistPercent`. No spell-specific damage math exists anywhere.
- **Healing:** clamps at derived max and reports `overheal`; a fully-armored target is healed exactly as much as a naked one (proving no coupling to the damage path); healing at full HP returns `healed: 0` rather than `minDamage`.
- **Formula magnitudes:** an effect scaling on `spellPower` returns different numbers for a 5-INT and a 20-INT caster; a `fixed` magnitude ignores stats entirely.
- **★ Panel isolation (Phase 11 prerequisite):** the panel module's import list contains nothing from `App.tsx` or any editor-state module, and the panel renders and functions correctly against a synthetic `play`-mode source with no editor present.
- **★ `castRay` — square *and* hex:** a wall between two points blocks sight; removing it unblocks; a tile flagged `blocksSight: false` but impassable lets sight through and movement not. Identical world-space inputs give identical results on both geometries.
- **★ Acquisition:** a hostile does **not** acquire a target behind a wall at 3 tiles, but does acquire the same target at 8 tiles in the open; a target outside `fieldOfViewDegrees` is not acquired; `loseTargetAfterMs` keeps a chase alive briefly after sight breaks.
- **Faction resolution:** `affects: 'enemies'` hits only hostile factions; `'allies'` only same-faction; the caster is excluded from `'all'` unless `includeCaster` is set; an explosion at the caster's feet does not damage the caster by default.
- **★ Status stacking, all four modes:** `refresh` resets the timer without adding intensity; `stack` caps at `maxStacks`; `ignore` is a no-op on a second application; `independent` produces two timers. `stackScope: 'per-source'` lets two casters' poisons coexist while one caster cannot double-dip.
- **Status payloads:** a periodic tick routes through `resolveDamage` and is therefore reduced by matching resistance and zeroed by 100% RPD — proving poison obeys the one-pipeline law; `restricts: ['cast']` makes `canCast` return `restricted`; `isPermanent` never expires; `onExpire` scripts fire exactly once.
- **★ Stats cache invalidation:** applying, stacking, and expiring a contribution effect each change `effectiveStats()` immediately, with no reload.
- **Equipment is not an effect:** equipping and unequipping a ring twenty times leaves stats byte-identical, with the `ActiveEffectSet` empty throughout.
- **Dual-unit durations:** a 9000 ms status with `msPerTurn: 3000` reports 3 turns; an explicit `durationTurns: 5` override wins over the derivation.
- **Turn-based casting:** `castTimeTurns: 2` resolves on the correct turn, spends `actionPointCost` from the turn's budget, and a qualifying hit during the committed window runs the identical §10.3 interruption checks.
- **Cooldown groups:** casting one member of a group puts every member on cooldown; a skill with no group is unaffected.
- **Save round-trip:** cooldowns and active effects survive save → load with correct remaining durations; a permanent effect survives with no timer; an in-flight projectile and an in-progress windup are discarded.
- **Cost & cooldown:** casting at insufficient resource returns `insufficient-resource` and spends nothing; an interrupted windup spends nothing *and starts no cooldown*; `canCast` agrees with `cast` in every case.
- **★ Interruption — all three models off:** a caster taking twenty hits mid-windup completes the cast. E's stated default, and the one that would be easiest to get backwards.
- **Interruption — each model alone:** chance-only respects `baseChance` and `minChance` across many trials; free-hits-only absorbs exactly `freeHitsAllowed` and breaks on the next; condition-only ignores a plain sword hit and breaks on a listed stun.
- **★ Condition gate does not consume a free hit:** with C and B both enabled, ten non-qualifying hits leave the free-hit counter untouched.
- **Concentration:** a 20-INT caster has a measurably lower interrupt chance and more free hits than a 5-INT one; `interruptible: false` survives every model enabled at maximum severity.
- **Free-hit reset:** the counter resets on cast start, so a caster interrupted once isn't permanently fragile.
- **Spellbook:** Phase 8's `learn-skill` item adds to `knownSkills` and returns false on a second use.
- **Enemy casting:** a monster with `maxMana: 0` never selects a mana skill; a caster never selects a skill whose delivery range can't reach its current target.
- **Non-regression:** every Phase 7, 8, and 9 test still passes. Phase 8's fixed-magnitude items behave identically after the `Effect` widening.

## 15. Decisions locked

- **Effect and delivery are orthogonal.** Any effect rides any delivery. No skill-specific code, ever.
- **One `ActiveSkillDef`**, discriminated by `resource: 'mana' | 'stamina'`; Spells and Abilities are filtered views, not separate databases.
- **Phase 8's effect vocabulary is widened, not duplicated** — magnitudes become `fixed | formula`, and items inherit formula scaling for free.
- **Damage runs through Phase 7's single `resolveDamage`.** Healing runs through a separate pure `resolveHeal` with no resistances, no armor, no immunity, no floor.
- **All delivery geometry is world-space**, so every shape works unchanged on square and hex-iso maps.
- **Instant shapes resolve identically in both combat modes; projectiles are simulated in action mode and resolved analytically in turn-based.**
- **`knownSkills` lives on `CombatantBase`** → enemy casting is data, not a parallel system. Monsters use Phase 9 v2's `maxMana`.
- **Non-homing projectiles must intersect a hitbox and despawn on hit** (`pierce: 0` default). Explosives detonate on entity *and* terrain impact.
- **`spread` applies to projectiles and beams alike**; each instance resolves independently.
- **`school` is reserved**, unblocking one of TEA's two hard dependencies.
- **Cast interruption is three independent, separately-toggleable models** (chance / free hits / condition), composed as requirements rather than filters, all defaulting to off. Per-skill `interruptible: false` overrides all of them. Interruption spends no resource and starts no cooldown.
- **`pierce` is in**, defaulting to 0.
- **Only the player earns EXP.** `ownerId` on a projectile is for faction filtering, never kill credit.
- **`castRay()` is the single occlusion primitive**, marching in world space so one implementation serves square and hex. Terrain distinguishes blocking movement, sight, and projectiles. Acquisition requires line of sight by default.
- **Factions are explicit data** (`hostileTo` lists), owned here because both spell targeting and acquisition need them.
- **`StatusEffectDef` v2**: `isPermanent`, dual-unit durations, `StatContribution` payloads, typed periodic damage through `resolveDamage`, and `restricts` as the mechanism behind stun. Stacking is a property of the effect (`refresh | stack | ignore | independent`) with `stackScope`.
- **The `ActiveEffectSet` owns buff and status lifetime** — ticking, expiry, restriction gating, and stats-cache invalidation. **Equipment never enters it.**
- **Milliseconds are canonical; turns are derived** via `msPerTurn` unless explicitly overridden. Skills carry an `actionPointCost`. Cast time in turn-based means committed-now-resolves-in-N-turns, so interruption works identically in both models.
- **Per-skill cooldowns plus `cooldownGroup`.** The MMO-style global cooldown flag is deprecated; once-per-day powers wait for Phase 14's clock.
- **Cooldowns and active effects persist into the save.** In-flight projectiles and in-progress windups do not.
- **Ships in two verified chunks, 10A and 10B.** 10A is coherent and shippable alone.

> ⚠ **Superseded — see §R.8 for which items stand.**

## 16. Amendments this doc requires elsewhere

All four of Phase 10's original open questions are answered, and the v2 fold reaches further back than v1 did:

1. **Phase 6 — one new derived stat.** `concentration` joins the `DerivedKey` union, with `concBase` (default 0) and `concPerInt` (default 1.0) in `StatRules.combat`. It is the resistance both interruption Models A and B read. *(Already applied to `PHASE6_DESIGN.md`.)*
2. **Phase 6 — one new `StatRules` block.** `StatRules.interrupt` (§10.3), all three toggles defaulting to false, plus its panel in the Phase 6 StatRules editor. *(Already applied.)*
3. **Phase 8 §11 Q4 — answered.** The hero is named at character creation, defaulting to **Elms** (male) or **Chels** (female). Structurally `PlayerSprite.name` plus a `characterCreation.defaultNames` pair that **Phase 11 owns**. *(Already applied.)*
4. **Phase 4 — the Status Effects manager panel is rewritten** against `StatusEffectDef` v2 (§5.7). The v1 shape edits deleted stat keys and turn-only durations. This work is inside Phase 10A's scope, not a separate task.
5. **Phase 4 — `ActionRPGConfig.cooldown.type: 'global'` is removed** (§10.5). Nothing has shipped, so there is no migration.
6. **Phase 3 — `NPCEntity.aggroRadiusPx` becomes the `acquisition` block** (§11.1). Behavior change: hostiles stop acquiring through walls.
7. **Phase 5.5 — `project.factions: FactionDef[]`** joins the container, alongside the other database promotions.
8. **Phase 11 — two things are explicitly assigned there, not orphaned:** serializing `ActiveEffectSet` and the cooldown map into `SaveState` (§10.6), and the **skill hotbar / quick-slot binding** — Phase 10 provides `cast(skillId, aim)`, Phase 11 decides which key fires it. This seam is named here so it does not fall between the two phases unnoticed.

Nothing outstanding for E in this document.

---

*LoreBrix, ELMSCORP. Phase 10 design — Spells, Abilities & Delivery.*
