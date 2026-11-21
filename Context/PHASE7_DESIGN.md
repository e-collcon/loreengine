# Phase 7 — Equipment, Damage Types & Immunity · Technical Design (v5)

**Status:** **v5 — reconciled with the Foundation Rewrite (§R).** Design (no code yet) · supersedes v3
**Depends on:** Foundation Phases 1–5 (F) · Phase 6 v5 (attributes, `deriveStats`, `EffectiveStats`, `StatContribution`, `StatRules`)
**Schema:** extends v2
**Recommended effort:** High — **Extra High for §5**, the damage-resolution pipeline. It is the most consequential math in the project.

### Changes in v3 (reconciliation with Phase 6 v2)

Mechanical only — no design decision is reversed, no scope moves.

| Change | Why |
|---|---|
| **v4: the paper-doll panel is dual-source parameterized** (`EquipmentPanelSource` + `PanelMode`) | Phase 11 §11 reuses this panel verbatim as the player's Character screen. Built against editor state, "reuse" silently becomes "rewrite" — in the largest phase of the arc. Enforced by an import-list test, because the advice version does not survive implementation. |
| §5 step 2: `defender.magicResist` → `defender.spellResist` | `magicResist` never existed. Phase 6 names the generic magical mitigation stat `spellResist`; left as written, every non-physical hit would resolve against `undefined → 0` and ignore resistance entirely. |
| §5: `resolveDamage` is **pure** — it *reports* `staminaCost` and `guardBroken` instead of applying them | It takes `EffectiveStats`, not entities, so it never had the ability to charge stamina or break a guard. Purity is also what makes the immunity test suite possible. |
| §3, §8: signature is `deriveStats(base, contrib?: DerivationInputs)` | Phase 6 v2 generalized the hook: Phase 8's timed buffs are contributions too, and they aren't equipment. |
| §4.3: gear's `attributeBonuses`/`bonuses`/`resistBonuses` triple **is** Phase 6's `StatContribution` | One shape, three consumers (gear, buffs, future effects). `DerivedKey` and `DamageType` are defined in Phase 6 §4.2. |
| Canonical `StatRules` paths applied throughout (`combat.minDamage`, `combat.blockCap`, `combat.offhandStaminaMult`, `combat.blockReduction`) | Phase 6 v2 §9 fixes the layout; these were previously written as bare or guessed paths. |

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

**v5 revision:** reconciled with the Foundation Rewrite. True immunity, the guardrails, the three magic-weapon knobs, ten slots, and the pipeline order are unchanged. What changes is how a swing reaches `resolveDamage`.

### R.1 Loadout is a component; equipping is a command

`loadout` is a component and requires the `stats` component (Phase 6 §R.1), which is what makes a monster's `canEquip` reject. The player equips through the runtime commands `equip` and `unequip` (F §5.3), so a menu action is recorded and replayed like any input. `canEquip` stays a pure query. `project.equipment` is a minor schema revision.

### R.2 A weapon carries its attack

F's `AttackDef` owns timing, hitbox, knockback, hitstop, and feedback for every swing. Weapons now point at one:

```ts
interface EquipmentDef {
  // …unchanged, plus:
  attackId?: Id<'attack'>;   // weapons: the swing this weapon makes
  // reachTiles is REMOVED — reach is the AttackDef hitbox. One name, one place.
}
```

- The equipped `mainHand` weapon's attack replaces the archetype's first attack for the `attack-primary` role. With no weapon, the archetype's own attack is the unarmed swing (pen 0, per §8).
- `attackSpeedMod` and Phase 6's `attackSpeed` divide `AttackDef.cooldownMs`.

### R.3 `deal-damage` is how hits enter the pipeline

F ships `modify-health` for authored, non-combat changes. Phase 7 adds the one combat action:

```ts
| { type: 'deal-damage'; target: EntityMatch; hits: 'weapon' }              // from the subject's loadout
| { type: 'deal-damage'; target: EntityMatch; damage: DamageInstance[] }    // authored instances
```

Its handler takes the action's `subject` as attacker, builds hits (`buildAttackHits()` for `'weapon'`), resolves each through `resolveDamage`, applies `final` to `HealthState`, applies the returned `staminaCost` and `guardBroken` to the defender, and raises the event **`entity-damaged`** (owned here) plus a presentation event for glance and block feedback.

- Emberfall's attacks switch their `onHit` from `modify-health` to `deal-damage`.
- **Terrain damage routes through it too.** Lava is authored as `deal-damage` with a fire instance, so it meets fire resistance like any other hit (F law L6).
- Invulnerability is already applied upstream: F's contact system never reports a hit on an entity with the invulnerable flag.

### R.4 Contact comes first

F's attack contact decides *whether* a swing connects (hitbox, height, cliffs, i-frames, friendly fire). Phase 7 decides *how much* it hurts. Neither knows the other's rules.

### R.5 Dual-wield, mapped onto one activation

One press runs the main-hand weapon's attack once. On contact, `buildAttackHits()` adds the off-hand weapon's instance, resolved independently through §5. The off-hand stamina surcharge is charged when the windup starts. The off-hand has no separate hitbox or timing.

### R.6 Blocking

Phase 6's held block state is passed into `resolveDamage` as `blocking`.

### R.7 Glance and block feedback

`ProjectSettings` gains `combatFeedback: { glance?: Id<'feedback'>; blocked?: Id<'feedback'> }` (minor schema revision). The G1 **GLANCE!** effect is that feedback, played by F's feedback system on the presentation event from R.3.

### R.8 Panels live in a shared package

The paper-doll lives in a new **`panels`** package (React, Lovable's design system), importable by `editor` and `player` and forbidden from importing `editor`. That package boundary replaces the import-list assertion. In `play` mode, its `equip` and `unequip` issue runtime commands.

### R.9 Testing additions

- An equipped weapon's attack replaces the archetype's attack; unequipping restores it.
- A weapon's reach is its hitbox; there is no `reachTiles` field to disagree with it.
- `deal-damage` applies `staminaCost` and `guardBroken` to the defender exactly once per hit.
- Lava authored as fire `deal-damage` is reduced by fire resistance and zeroed by fire immunity.
- `panels` compiles without access to `editor`.

### R.10 Authored attributes (later on 16 Nov)

Attributes are project content (Phase 6 v6 §R.11). `attributeBonuses` and `requirements` become `Record<attributeId, number>` instead of `Partial<Attributes>`; a Ring of Strength names the project's `str` attribute by id. Nothing else in this phase changes.

---

## 0. Decisions carried in from E

Locked this round, and shaping everything below:

1. **True immunity is IN.** If a defender's effective defense ≥ `immunityRatio` (default **1.25**) × the incoming damage, damage is **zero**. A veteran knight in quarter-inch Damascus plate genuinely glances a knife. §5 designs it; §6 is the guardrail package that keeps it from becoming a softlock generator.
2. **Dual-wield = extra attack on the Attack button.** One click, two swings, each resolved independently. *Not* bound to Block — Block is a held state in Phase 6, and overloading it would force a tap-vs-hold disambiguation and make blocking impossible while dual-wielding (which is also the correct fiction).
3. **Two ring slots** — `ringLeft`, `ringRight`. Safe: Phase 6's diminishing-returns curve means stacked defensive rings self-balance. Attribute rings stay potent → that's a *tuning* problem (rare, modest, expensive), not an architecture problem.
4. **Magic weapons resolve to three orthogonal fields, not three subsystems** (§4.4).

Also carried from Phase 6: no v1 migration (clean v2), contextual gap-hop jump, `StatRules` editor ships in Phase 6.

## 1. Goal

Give every combatant — player *and* NPC — equipment slots, an editable gear database, a typed damage model with per-type resistances, and a single damage-resolution pipeline supporting armor penetration, damage conversion, bonus damage, dual-wield, and true immunity — without ever mutating a stored stat.

## 2. Non-goals

- Item taxonomy, currency, consumables, general inventory → **Phase 8**.
- The Enemy Database and actually dressing human enemies → **Phase 9** (the *capability* is built here).
- Spells consuming `spellPower` → **Phase 10** (the stat is produced here; nothing spends it yet).
- Durability, repair, enchanting, set bonuses — not requested, deliberately omitted.

## 3. Core principle (load-bearing)

Equipment is a **contribution**, never a stat mutation. Worn gear is reduced to a `StatContribution` (Phase 6 §6) and fed to Phase 6's reserved hook:

```
deriveStats(base: StatBlock, contrib?: DerivationInputs) → EffectiveStats

  DerivationInputs = { equipment?: StatContribution; buffs?: StatContribution[] }
```

Phase 7 fills the `equipment` slot; Phase 8's timed buffs fill `buffs`. Same merge, same two-pass ordering, one code path.

Unequip is a *recompute*, never an "undo the buff." Stat drift is structurally impossible — not merely tested against.

## 4. Data model

### 4.1 Slots (ten)

```ts
type EquipSlot =
  | 'head' | 'torso' | 'hands' | 'feet'          // armor
  | 'neck' | 'cape' | 'ringLeft' | 'ringRight'   // accessories
  | 'mainHand' | 'offHand';                      // weapons & shield

type Loadout = Partial<Record<EquipSlot, UUID>>; // ids only — one source of truth
```

> ⚠ **Superseded — `loadout` is a component requiring `stats`; equipping is a runtime command (§R.1).**

`loadout` lives on **`CombatantBase`**, not on the player — which is what makes Phase 9's armed human enemies nearly free.

**Hand rules:** one-handed → `mainHand`, `offHand` free. Two-handed → occupies `mainHand` and **auto-clears `offHand`** (reported via `EquipResult.displaced`). `offHand` accepts a shield *or* a one-handed weapon (→ dual-wield, §7).

### 4.2 Damage types & resistances

```ts
type DamageType = 'physical' | 'fire' | 'ice' | 'lightning'
                | 'poison' | 'holy' | 'arcane' | (string & {});

interface DamageInstance {
  amount: number;
  type: DamageType;
  armorPen: number;        // 0..1 — fraction of defense ignored
}
```

Phase 6's single `spellResist` generalizes into a map. Physical damage is resisted by `physDef`; every other type by its own resistance (falling back to a generic magic resistance when unspecified):

```ts
// on EffectiveStats
physDef: number;
resistances: Partial<Record<DamageType, number>>;   // { fire: 12, ice: 0, … }
```

This is what lets a fire-immune boss — or an ice-resistant player — exist later with **no new machinery**.

### 4.3 `EquipmentDef` — the database record

```ts
type EquipKind = 'armor' | 'accessory' | 'weapon' | 'shield';
type WeaponGrip = 'one-handed' | 'two-handed';

interface EquipmentDef {
  id: UUID;
  name: string;
  kind: EquipKind;
  slot: EquipSlot;
  icon?: AssetRef;
  description: string;

  // ── Weapons ──────────────────────────────────────────────
  grip?: WeaponGrip;
  baseDamage?: number;             // added to physDamage
  armorPen?: number;               // 0..1, default 0  (§5, §6)
  reachTiles?: number;             // ⚠ REMOVED — reach is the weapon's AttackDef hitbox (§R.2)
  attackSpeedMod?: number;         // multiplicative, default 1.0

  // The three orthogonal magic knobs (§4.4)
  convertDamage?: DamageType;                          // swing damage BECOMES this type
  bonusDamage?: { type: DamageType; amount: number };  // extra hit, ON TOP

  // ── Shields ──────────────────────────────────────────────
  blockBonus?: number;             // added to StatRules.combat.blockReduction,
                                   // capped at StatRules.combat.blockCap

  // ── Any gear ─────────────────────────────────────────────
  // These three fields ARE Phase 6's `StatContribution` — same shape, reused
  // verbatim rather than restated, so gear and buffs merge through one path.
  // `DerivedKey` and `DamageType` are defined in Phase 6 §4.2.
  bonuses: Partial<Record<DerivedKey, number>>;        // physDef, spellPower, moveSpeed, maxHp…
  resistBonuses?: Partial<Record<DamageType, number>>;
  attributeBonuses?: Partial<Attributes>;              // Ring of Strength
  requirements?: Partial<Attributes>;                  // enforced on equip

  value: number;                   // shop price (currency: Phase 8)
  tags: string[];
}
```

**Project-level:** `project.equipment: EquipmentDef[]` — the editable Equipment Database.

### 4.4 Three knobs express every magic weapon E described

| Item | spellPower | baseDamage | convertDamage | bonusDamage |
|---|---|---|---|---|
| Staff of Wisdom (2H) | ✔ | small | — | — |
| Wand (1H) | ✔ | small | — | — |
| Sword of Embers | — | ✔ | — | fire +5 |
| Flamethrower (2H) | — | ✔ | **fire** | — |
| Ring of Flaming Fists | — | *(accessory)* | **fire** | — |
| Battle Scepter of Ramses (2H) | ✔ | ✔ | — | — |
| Flaming Scepter of Amun-Ra (2H) | ✔ | ✔ | — | fire +N |

Three fields. Every item. No new subsystems.

`convertDamage` on an **accessory** (Ring of Flaming Fists) is legal and applies to whatever the character swings. If multiple sources convert, precedence is **mainHand → offHand → accessories in slot order** — deterministic and documented, so it never surprises anyone.

## 5. Damage resolution pipeline — the heart of this phase

Every hit — melee, dual-wield off-hand, bonus damage, and later spells — resolves through **one** function. One pipeline means immunity, penetration, blocking, and conversion can never drift apart across code paths.

```ts
resolveDamage(
  attacker: EffectiveStats,
  defender: EffectiveStats,
  hit: DamageInstance,
  blocking: boolean,
  rules: StatRules,
): DamageResult

interface DamageResult {
  final: number;
  immune: boolean;
  blocked: boolean;
  type: DamageType;
  staminaCost: number;    // what the DEFENDER owes for blocking this hit — 0 if not blocking
  guardBroken: boolean;   // true if paying staminaCost would empty the defender's stamina
}
```

**`resolveDamage` is pure.** It receives `EffectiveStats`, not entities, so it cannot — and must not — mutate anyone. It *computes* the block cost and *reports* whether that cost breaks the guard; the caller (`CombatantEntity`) applies both. Two reasons this matters beyond tidiness: the entire immunity test suite in §11 depends on being able to call this function with plain records and assert on the return value, and Phase 10's spells will call the same function from a completely different code path where there may be no blocking defender at all.

**Order of operations:**

```
1. RAW          raw = hit.amount
                  (already includes weapon base + attribute contribution)

2. DEFENSE      def = (hit.type === 'physical')
                        ? defender.physDef
                        : defender.resistances[hit.type] ?? defender.spellResist ?? 0
                  ← spellResist is Phase 6's generic magical mitigation; a
                    specific entry in `resistances` always wins over it

3. PENETRATION  effectiveDef = def × (1 − clamp01(hit.armorPen))
                  ← a warhammer or pick ignores a fraction of plate

4. IMMUNITY     if (rules.combat.allowImmunity &&
                    effectiveDef >= rules.combat.immunityRatio × raw)   // default 1.25
                      → return { final: 0, immune: true, staminaCost: 0,
                                 guardBroken: false, … }
                  ★ TRUE IMMUNITY. The knife glances off the Damascus plate.

5. MITIGATION   mitigated = raw × (100 / (100 + effectiveDef))       // Phase 6 curve

6. BLOCK        if (blocking) {
                    mitigated  ×= (1 − defender.blockReduction);      // derived stat,
                                                                      // shield-boosted & capped
                    staminaCost = rules.stamina.blockHit;             // REPORTED, not charged
                    guardBroken = defender.stamina <= staminaCost;    // REPORTED, not applied
                }

7. FLOOR        final = max(rules.combat.minDamage, round(mitigated))  // default 1
```

**Why immunity sits at step 4** — after penetration, before the floor:

- **After penetration**, so an armor-piercing weapon can *defeat* immunity. This is exactly how history solved plate armor, and it is the mechanic that gives players an answer.
- **Before the floor**, so `minDamage` can never smuggle 1 damage past an immunity that already fired. If the floor ran first, immunity would be silently meaningless.

This ordering is the most delicate thing in the phase and gets a dedicated test whose only job is to prove it.

**Bonus damage is a separate `DamageInstance`.** A Sword of Embers produces *two* hits — physical, then fire — each resolved independently through the same pipeline. This is precisely the behavior we want, and it emerges for free:

- vs. a **fire-resistant plated knight** → steel glances, flame shrugged. Nothing.
- vs. a **plated but fire-vulnerable troll** → steel glances, **flame lands in full.** The player *discovers* the answer.

## 6. Guardrails — making true immunity survivable

Immunity is a strong mechanic. Unguarded, it produces exactly one bug report: *"my attacks do nothing and I don't know why."* These five guardrails are **not optional** — they are the cost of shipping the feature responsibly.

> ⚠ **Superseded — still required; delivered as `combatFeedback.glance` (§R.7).**

**G1 — Immunity must be LEGIBLE.** When a hit returns `immune: true`, playtest shows a distinct **"GLANCE!"** effect — metallic ring, sparks, a deflected-blade flash — visually and audibly different from a miss or a 0-damage hit. The player must instantly understand *"my weapon cannot hurt this armor"*, not *"the game is broken."* **This is the entire difference between a design statement and a defect.**

**G2 — Armor penetration is the intended counter.** `armorPen` is how a player *solves* an immune enemy: warhammers, picks and maces carry high pen (historically the anti-plate answer); daggers carry near none. Immunity gets a diegetic, discoverable solution — *go find the right weapon* — which is exactly the Zelda-genre loop.

**G3 — Damage-type conversion is the second counter.** Plate that shrugs steel does not shrug fire. `convertDamage` and `bonusDamage` route around physical immunity entirely by resolving against a *different* resistance.

**G4 — Softlock prevention is a creator-facing tool, not a hope.** The editor ships a **Combat Sanity Check** panel: for every enemy on a map, it computes whether the player — using gear obtainable *by that point in the game* — can damage it at all. Unkillable enemies are flagged loudly:

> ⚠ *"Plated Knight (Dungeon 2) is immune to every weapon the player can obtain before this map."*

Creators are told **before** their players are. This is the feature that makes true immunity safe to ship, and it is **in scope for Phase 7**.

**G5 — Tunable and toggleable.** `StatRules.combat.immunityRatio` (default 1.25) and `StatRules.combat.allowImmunity` (default **true**, per E). A creator who dislikes the mechanic disables it project-wide and falls back to pure diminishing returns + damage floor. The engine supports both philosophies; E's is the default.

> ⚠ **Superseded — dual-wield is one activation of the main-hand attack with an extra hit instance (§R.5).**

## 7. Dual-wield

Bound to the **Attack** button:

```
onAttack():
  hits = []
  hits.push( swing(mainHand) )                        // full stamina cost
  if (offHand holds a weapon) {
      hits.push( swing(offHand) )                     // independent DamageInstance
      stamina += rules.stamina.attack × rules.combat.offhandStaminaMult  // default 0.6
  }
  each hit → resolveDamage() independently
```

Each swing resolves **independently** through §5. So a dagger in one hand can glance off a knight while the warhammer in the other lands — immunity is evaluated *per weapon*, which is both correct and delightful.

The extra stamina cost is **load-bearing, not decoration**: without it, dual-wield strictly dominates shields and no one ever equips one. The intended choice is legible — **shield = survivability, second weapon = damage, at a stamina price.**

Off-hand swings use the off-hand weapon's own `baseDamage`, `armorPen`, `reachTiles`, `convertDamage` and `bonusDamage`.

## 8. Derivation — the two-pass rule

```
PASS 1 — resolve equipment
  ids → EquipmentDefs   (missing id → skip + warn, never crash)
  accumulate: attributeBonuses, bonuses, resistBonuses,
              weapon profile (damage, pen, reach, atkSpeedMod, convert, bonusDamage),
              shield blockBonus

PASS 2 — derive with AUGMENTED attributes
  effectiveAttrs = base.attributes + attrAdd
  run every Phase 6 formula against effectiveAttrs
        ← a +3 STR ring MUST raise maxHp, physDamage AND physDef
  add flat bonuses to their corresponding derived stats
  resistances    = base + resistBonuses
  physDamage    += mainHand.baseDamage
  attackSpeed   *= mainHand.attackSpeedMod
  blockReduction = min(rules.combat.blockCap,
                       rules.combat.blockReduction + shield.blockBonus)
```

The two-pass rule itself is specified and tested in **Phase 6 §6** — this section is how Phase 7 *fills* pass 1, not a second definition of it. The ordering is the whole point. In Phase 6, STR derives HP *and* damage *and* defense — so gear attribute bonuses must fold in **before** the formulas run. Reversing it produces silently wrong numbers forever. Dedicated test.

**Fallbacks:** no `mainHand` → `physDamage` uses `StatRules.unarmedDmg`, reach 1.0, speed ×1.0, **pen 0** — so bare fists genuinely *cannot* hurt plate. Which is exactly right. No shield → base `blockReduction` (blocking bare-handed still works, just weaker).

**Caching:** `effectiveStats()` memoizes; invalidated by attribute change, loadout change, or an equipment-database revision bump.

> ⚠ **Superseded — entity methods become systems plus `equip`/`unequip` commands; hits arrive through `deal-damage` (§R.1, §R.3).**

## 9. Runtime API

```ts
// CombatantEntity
equip(equipmentId: UUID): EquipResult
unequip(slot: EquipSlot): boolean
canEquip(equipmentId: UUID): EquipResult   // dry-run → UI grays invalid gear WITH the reason
getLoadout(): Loadout
effectiveStats(): EffectiveStats           // equipment-aware
buildAttackHits(): DamageInstance[]        // 1 hit, or 2 (dual-wield), plus bonusDamage hits

type EquipResult =
  | { ok: true; displaced: EquipSlot[] }   // e.g. ['offHand'] after equipping a 2H
  | { ok: false; reason: 'wrong-slot' | 'requirements-not-met' | 'not-found';
      detail?: Partial<Attributes> };
```

`displaced` is returned rather than silently swallowed, so the UI can honestly say *"equipping the greatsword removed your shield."*

**Playtest integration:** the attack path calls `buildAttackHits()` and runs each through `resolveDamage()`. Cooldown becomes `baseCooldown / attackSpeed`; reach comes from the weapon; `immune` and `blocked` drive the G1 feedback effects. Because `resolveDamage` is pure, the caller is responsible for applying the returned `staminaCost` to the defender and firing Phase 6's guard-break window when `guardBroken` comes back true — one place, right after the hit resolves, for every kind of hit.


### Dual-source parameterization — a **Phase 11 prerequisite**, not a nice-to-have

This panel is promised to Phase 11 as a player-facing screen, "reused verbatim." That promise has a condition, and it has to be met **here**, while the panel is being written — retrofitting it later means rewriting it, which is three panels' worth of rework landing in the single largest phase in the arc.

**The condition:** the panel must never reach for editor state. It takes a *source* object and a *mode*, and both the editor and the running game supply one.

```ts
type PanelMode = 'author' | 'play';
```

- **`author`** — the editor. The subject is an authored definition; the candidate pool is the whole database.
- **`play`** — the running game. The subject is a live `CombatantEntity` reading through `effectiveStats()`; the candidate pool is what the player actually has; definitions are **read-only** — a player may equip, use, and rearrange, but never edit the item behind it.

> ⚠ **Superseded — enforced by the `panels` package boundary (§R.8).**

**The enforceable version of this rule**, because "don't reach for editor state" is advice and advice does not survive implementation: *the panel module imports nothing from `App.tsx` or any editor-state module.* That is a one-line assertion over the module's import list, and it is in this phase's test plan below.

```ts
interface EquipmentPanelSource {
  mode: PanelMode;
  loadout: Loadout;
  stats: EffectiveStats;
  candidates(slot: EquipSlot): EquipmentCandidate[];   // author: the whole DB
                                                       // play: matching items in inventory
  canEquip(slot, equipmentDefId): CanEquipResult;      // §7's dry-run, unchanged
  equip(slot, equipmentDefId): void;
  unequip(slot): void;
}
```

`candidates()` is the whole trick. The paper-doll is identical in both modes; only the answer to "what could go in this slot" differs — the equipment database when authoring, your inventory when playing.

## 10. UI

- **Equipment Database editor** — new Rules tab; sibling of Phase 6's `StatRules` panel, establishing the reusable **database-editor pattern** that Phases 8–10 clone. List + edit form + **duplicate** (authoring a sword tier list is 90% duplication).
- **Paper-doll character panel** — ten slots, click-to-filter valid gear, invalid entries grayed *with the reason*, live `EffectiveStats` readout that updates on every change so a designer *sees* the greataxe trade speed for damage. Reused verbatim as the player-facing **Character** screen in Phase 11.
- **Combat Sanity Check panel (G4)** — per-map reachability analysis flagging unkillable enemies. The safety net that makes immunity shippable.
- **Entity inspector** — compact loadout editor so creators can dress a human guard directly on the map.

## 11. Testing plan

Strict `tsc` + production build + runtime tests, per the standing discipline. **The immunity tests are the priority set:**

- **★ Panel isolation (Phase 11 prerequisite):** the panel module's import list contains nothing from `App.tsx` or any editor-state module, and the panel renders and functions correctly against a synthetic `play`-mode source with no editor present.
- **★ `resolveDamage` is pure:** called twice with identical inputs it returns identical results, and neither `EffectiveStats` argument is mutated. Blocking returns a non-zero `staminaCost` without any stamina actually changing.
- **Resistance fallback:** a fire hit against a defender with no `resistances.fire` entry resolves against `spellResist`, not 0; a defender *with* an entry uses it and ignores `spellResist`.
- **Immunity fires:** effectiveDef ≥ 1.25 × raw → `{ final: 0, immune: true }`.
- **Immunity does NOT fire just below threshold:** 1.24 × raw → damage > 0. The cliff is exact and intentional.
- **★ The floor cannot smuggle damage past immunity:** an immune hit returns **0**, not `minDamage`. *(Step-ordering proof — the single most important test in the phase.)*
- **★ Armor penetration defeats immunity:** a high-pen warhammer damages a knight who is immune to a zero-pen dagger. E's core fantasy, mechanized.
- **Bare fists cannot hurt plate:** unarmed (pen 0) vs. heavy armor → immune.
- **Conversion routes around physical immunity:** a Flamethrower (`convertDamage: fire`) damages a physically-immune knight with no fire resistance.
- **Bonus damage resolves independently:** Sword of Embers vs. fire-*resistant* plated knight → both components stopped; vs. plated but fire-*vulnerable* troll → steel glances, fire lands.
- **Dual-wield:** two hits per click; resolved separately (dagger glances, warhammer lands); extra stamina charged; equipping an off-hand weapon blocks shield equip and vice-versa.
- **Two-pass derivation:** a +3 STR ring raises maxHp, physDamage *and* physDef by exactly the Phase 6 coefficients.
- **Removal symmetry:** equip → unequip returns `effectiveStats()` to the exact bare baseline (no drift).
- **Two rings:** both slots contribute; defensive stacking demonstrably shows diminishing returns (documents that they are *not* overpowered).
- **Two-handed rule:** clears `offHand`, reports it in `displaced`.
- **Requirements gating** (STR-12 plate rejects a STR-8 character, reporting the shortfall), **negative bonuses** (heavy plate lowers moveSpeed), **block cap**, **dangling reference** (deleting equipped gear empties the slot, warns, never crashes), **cache invalidation** (editing gear updates the wearer live).
- **Sanity check (G4):** a deliberately unkillable enemy is flagged; a killable-with-reachable-gear enemy is not.

## 12. Decisions locked (handoff summary)

- **True immunity is IN**, at `effectiveDef ≥ immunityRatio(1.25) × raw`, checked **after** armor penetration and **before** the damage floor. Guarded by: a legible **GLANCE!** effect (G1), `armorPen` as the intended counter (G2), damage-type conversion as the second counter (G3), a creator-facing **Combat Sanity Check** that flags unkillable enemies before players find them (G4), and a tunable/disableable `StatRules` toggle, default on (G5).
- **One damage pipeline** (`resolveDamage`) for every hit — melee, off-hand, bonus, and later spells. No divergent code paths, ever.
- **`resolveDamage` is pure.** It reports `staminaCost` and `guardBroken`; the calling entity applies them. Damage math never mutates a combatant.
- **Damage is typed**; `spellResist` generalizes to a `resistances` map. Bonus damage is a separate `DamageInstance` resolved independently.
- **Magic weapons = three orthogonal fields** (`spellPower` bonus, `convertDamage`, `bonusDamage`) — every item E described, zero new subsystems. Conversion precedence: mainHand → offHand → accessories.
- **Dual-wield on the Attack button**: two independent swings; off-hand costs +60% stamina. Shield = survivability, second weapon = damage.
- **Ten slots**, including `ringLeft`/`ringRight`. Diminishing returns keeps stacked rings honest.
- Equipment remains a **contribution**; **two-pass derivation** applies gear attribute bonuses *before* Phase 6's formulas.
- `loadout` lives on `CombatantBase` → Phase 9's armed humans need **no parallel system**.

## 13. Open question for E

**Weapon-vs-armor-class matchups** (optional, deferrable): historically some weapons counter specific armor *classes* — a mace beats plate, a blade beats cloth. `armorPen` already captures most of this expressiveness. A full damage-type × armor-type matrix would be richer, but adds a real dimension of authoring complexity (every weapon × every armor class).

**My lean: skip it.** `armorPen` + typed damage already delivers your Damascus-knight fantasy completely. If playtesting proves it thin, the matrix drops in cleanly later — nothing in this design forecloses it.
