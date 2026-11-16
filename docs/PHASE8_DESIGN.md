# Phase 8 — Items, Currency & Inventory · Technical Design (v7)

**Status:** **v7 — reconciled with the Foundation Rewrite (§R).** Design (no code yet) · supersedes v5 · **shop stocking modes added (§7.4)**

### Changes in v3 (roadmap renumber + Phase 10 alignment)

Waterfall discipline: these are fixed here so Phase 10 adds behavior rather than renaming code that already shipped.

| Change | Why |
|---|---|
| **v6: `ShopDef` gains `stockMode` (`infinite \| finite \| restocking`)** (§7.4) | Phase 13 builds the shop UI and Phase 11 stores the state, but the authored fields belong to the phase that owns shops. Surfaced by a Phase 11 review: without it, buying the last sword and reloading silently restores it. |
| **v5: loot is a `PickupEntity`, with `LootTable.autoCollect` as the direct-to-wallet path** (§7.5) | The last open question in this doc, and Phase 9's loot spawner had already assumed the answer. The pickup entity is the more general model — direct-to-wallet is a pickup that resolves instantly — so building it first makes the simple behavior a flag rather than a rewrite. |
| **v4: the inventory panel is dual-source parameterized** (`InventoryPanelSource` + `PanelMode`) | Phase 11 §11 reuses it as the player's Inventory screen. Same panel authors an enemy's loot in `author` mode and drives the player's bag in `play` mode. Enforced by an import-list test. |
| Shop UI, money-changers, and the `has-item` condition now point at **Phase 13** | The roadmap inserted Constants/Variables and World Clock; the old "Phase 12" references landed in the wrong document. |
| The effect union is named **`Effect`**, not `ItemEffect` | Phase 10 §5.2 widens this exact type into a shared one used by items *and* skills. Naming it `Effect` now means Phase 10 adds a magnitude variant instead of renaming a type across the whole codebase mid-arc. Phase 10's prose says it "widens Phase 8's `ItemEffect`" — it means this type. |
| Effect tags stay **`restore`** / **`restore-percent`**, not `heal` / `heal-percent` | Phase 10 v2 drafted them as `heal`, which is wrong for mana and stamina — you do not "heal" stamina. `restore` is the accurate tag for all three pools. **Phase 10 §5.2 is corrected to match**; the resolution function keeps the name `resolveHeal` since it only ever touches HP. |
| Magnitudes stay plain `number` here | Phase 10 widens them to `EffectMagnitude` (`fixed \| formula`). A potion's flat `50` remains valid as `{ kind: 'fixed', value: 50 }`, so the widening is additive and no Phase 8 data migrates. |

**Depends on:** Foundation Phases 1–5 (F: container, `ActionExecutor`, `ActiveEffects`), Phase 6 v5 (stats, `StatContribution`, `StatRules`), Phase 7 v5 (equipment, `resolveDamage`, `deal-damage`, damage types)
**Schema:** extends v2
**Recommended effort:** High

### Changes in v2 (reconciliation with Phase 6 v2 / Phase 7 v3)

| Change | Why |
|---|---|
| §4.3: the `buff` effect carries a full `StatContribution`, not a bare `bonuses` map | Phase 6 v2 routes buffs through `DerivationInputs.buffs` — the same merge path as gear. A bare `bonuses` map couldn't express a Potion of Giant Strength (+STR) or a Fire Ward (+fire resistance), and Phase 10's buff spells need both. |
| §4.3: the `damage` effect notes that the caller applies `resolveDamage`'s result | `resolveDamage` is pure as of Phase 7 v3. |
| Protagonist placeholder replaced with the real hero name (Elms) | The genre-reference name was standing in for a character we haven't named. Left in, it lands in test fixtures and identifiers. Naming is now §11 Q4. |

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

**v7 revision:** reconciled with the Foundation Rewrite. The single `ItemDef`, plural currencies, contextual value, no-arbitrage rule, categories, stocking modes, and pickup decision are unchanged.

### R.1 Inventory and wallet are components

`inventory` (stacks, plus per-item cooldown state) and `wallet` are components, so NPCs carry loot by having them, exactly as §4.1 intended. Item cooldowns are runtime state on the `inventory` component and travel in the save. `project.items`, `project.currencies`, `project.categories`, and `project.shops` are minor schema revisions.

### R.2 Using and dropping are commands

The player uses and drops items through the runtime commands `use-item` and `drop-item` (F §5.3). `canUseItem` stays a pure query, and `canAfford` keeps its agreement with `pay`.

### R.3 Phase 8 owns the inventory and wallet vocabulary

Under F, each condition and action is added by the phase that owns its state. Phase 8 owns inventory and wallet, so it adds:

```ts
// Condition
| { type: 'has-item'; itemDefId: Id<'item'>; quantity: number }          // moved here from Phase 12 §6.2b
| { type: 'has-currency'; currencyId: Id<'currency'>; amount: number }   // the bribe check in Phase 13 §6.2c

// Action
| { type: 'give-item' | 'take-item'; target: EntityMatch; itemDefId: Id<'item'>; quantity: number }
| { type: 'give-currency' | 'take-currency'; target: EntityMatch; currencyId: Id<'currency'>; amount: number }
```

Phase 13's bribe and Phase 13.5's rewards both need these, and neither phase owns inventory. `has-item` was earlier pointed at Phase 13 and then Phase 12; it lives here now.

Events owned here: `item-acquired`, `item-lost`, `item-used`, `currency-changed`.

### R.4 Effects reuse F's machinery

- `script` runs an `Action[]` on F's executor (F §5.6).
- `damage` resolves through Phase 7's `deal-damage`, so a thrown flask meets resistances.
- `apply-status` and `cure-status` name a `StatusEffectDef` (F §4.5).
- `buff` applies an anonymous status effect with a `contribution` payload (Phase 6 §R.7); its `durationMs` becomes a `Duration`.

### R.5 Pickups are archetypes

`PickupEntity` is not a new entity kind. A pickup is an archetype with a **`pickup` component** `{ payload, autoCollect, despawnAfterMs?, sourceKind }`, collected when the player's collider overlaps it (or on interact when `autoCollect` is false).

- A taken authored pile joins the map's `removed` list; a taken dropped pile simply leaves `spawned` (F §5.10). No new save shape.
- **Unreachable loot** on cliffs: a drop snaps to the nearest walk-passable cell reachable from the drop point (F `connects`), searched outward up to 2 hexes; with none, it auto-collects.

### R.6 Panels and the hotbar

The inventory panel lives in the shared `panels` package (Phase 7 §R.8); the package boundary replaces the import-list assertion. `assignToHotbar` lands with Phase 11.

### R.7 Testing additions

- `has-item` and `has-currency` evaluate through F's evaluator; `give-item` respects `maxStack` and reports overflow.
- A pickup dropped at a cliff edge lands on a cell reachable from the drop point, never on a ledge above it.
- `use-item` replayed from a recorded command stream produces the same inventory state.

---

## 0. Decisions carried in from E

1. **Items are usable or unusable.** Usable items are further **perishable** (a potion, consumed) or **non-perishable** (a spellbook, kept). Unusable items are inert cargo (ores, ingots, quest items, a blacksmith's hammer) — they exist to be carried, sold, or required.
2. **Usable items have a cooldown**, which may be **zero** (spam-usable).
3. **Usable items can trigger custom scripts** — reusing the *existing* `TriggerAction[]` system from Phase 1, not a new one.
4. **Currency is customizable and plural**, with a hierarchy (100 copper Pesertas = 1 silver Sterling; 100 Sterlings = 1 gold Ducat). Shops may **accept or reject** specific currencies. A hidden universal base value underpins pricing (§5.1), and shops may **contextually override** what a currency is worth *to them* (§5.3) — this is what lets an elven trader shrug at an Empire banknote.
5. **No auto-conversion** at checkout. You pay in what you hold. Exchange is a diegetic service (a money-changer NPC) deferred to the shop phase — this is what keeps a merchant's principled refusal *meaningful* rather than silently laundered away at the till.
6. **No banking, no arbitrage, no trading skill.** Deferred entirely to a future Economy phase, if ever. Nothing in this design forecloses it; nothing in this design invites it.
7. **Inventory is categorized** — Weapons, Armor, Consumables, Books, Others, Quest Items are **built-in and undeletable**; creators may add their own.
8. **Stacking:** items declare `stackable` + `maxStack`. **No weight or carry limit** (genre-appropriate; deliberately omitted).

## 1. Goal

Establish the item system that everything else hangs off: a taxonomy that cleanly contains equipment (Phase 7) *and* consumables *and* inert cargo; an editable Item Database; a working inventory with categories, stacking and cooldowns; and a multi-currency model expressive enough for cultural economics without becoming a trading sim.

## 2. Non-goals

- **Shop UI, buying/selling flow, money-changers** → **Phase 13** (was numbered 12 before the roadmap revision). Phase 8 defines the *data* a shop needs (prices, accept-lists, value overrides) and the wallet API; the storefront is later.
- **Spell learning from spellbooks** → Phase 10. A spellbook here is a non-perishable usable that fires a `learn-skill` action; the Skill system that *receives* it lands in Phase 10 (§4.5).
- **Loot drops** → Phase 9 (enemies).
- **Crafting** — ores and ingots exist as *cargo* and can be required by scripts or quests. Actual crafting recipes are not requested and are not built.
- **Economy, trading skill, price manipulation** → out of scope, per §0.6.

## 3. The central design decision: one `ItemDef`, with equipment as a *reference*

The obvious mistake here would be two parallel systems — `EquipmentDef` (Phase 7) living in one database and `ItemDef` in another, with a sword existing twice and drifting out of sync.

Instead: **`ItemDef` is the single inventory-facing record. Equipment is one `kind` of item, and it *points at* its `EquipmentDef` by id.**

```ts
type ItemKind = 'equipment' | 'usable' | 'cargo';

interface ItemDefBase {
  id: UUID;
  name: string;
  description: string;
  icon?: AssetRef;
  categoryId: UUID;          // → InventoryCategory (§6)
  stackable: boolean;
  maxStack: number;          // 1 when !stackable
  value: number;             // base price, in universal units (§5.1)
  sellable: boolean;         // quest items are typically false
  tags: string[];
}

interface EquipmentItem extends ItemDefBase {
  kind: 'equipment';
  equipmentId: UUID;         // → EquipmentDef from Phase 7. ONE source of truth.
  stackable: false;          // gear never stacks
}

interface UsableItem extends ItemDefBase {
  kind: 'usable';
  consumedOnUse: boolean;    // TRUE = perishable (potion) · FALSE = reusable (spellbook)
  cooldownMs: number;        // 0 = spam-usable
  charges?: number;          // optional finite uses on a non-perishable (a wand of 10 charges)
  useTarget: 'self' | 'ally' | 'enemy' | 'none';
  effects: Effect[];         // §4.3 — what it actually does
  usableInMenu: boolean;     // a potion: yes. a lockpick: only in the world.
  usableInWorld: boolean;
}

interface CargoItem extends ItemDefBase {
  kind: 'cargo';             // ores, ingots, quest items, a blacksmith's hammer
  questItem: boolean;        // quest items are undroppable & unsellable by default
}

type ItemDef = EquipmentItem | UsableItem | CargoItem;
```

**Why this shape wins:** a sword's *stats* live once, in `EquipmentDef` (Phase 7). Its *inventory identity* — icon, category, price, description — lives once, in `EquipmentItem`. Edit the sword's damage and every copy in every inventory updates, with no resync. Selling, dropping, and stacking work uniformly across all three kinds because they share `ItemDefBase`.

**Project-level:** `project.items: ItemDef[]` — the editable Item Database.

## 4. Using items

> ⚠ **Superseded — `inventory` and `wallet` are components (§R.1).**

### 4.1 The inventory itself

```ts
interface InventoryStack {
  itemId: UUID;              // → ItemDef
  qty: number;
  chargesLeft?: number;      // for finite-charge usables
}

// on CombatantBase (so NPCs can carry loot — Phase 9 gets it free)
interface CombatantBase {
  inventory: InventoryStack[];
  wallet: Wallet;            // §5.2
  loadout: Loadout;          // Phase 7
}
```

Stacking rules: merging on pickup up to `maxStack`, overflow spills into a new stack. Equipment never stacks. Quest items are undroppable and unsellable unless explicitly overridden.

### 4.2 Cooldowns

Cooldowns are **runtime state, never persisted in the item definition** (the same discipline as Phase 6/7: definitions are data, state is runtime):

```ts
// CombatantEntity
private itemCooldowns = new Map<UUID, number>();   // itemId → ready-at timestamp

canUseItem(itemId): UseResult      // dry-run for graying-out UI, with a reason
useItem(itemId, target?): UseResult
```

```ts
type UseResult =
  | { ok: true; consumed: boolean; effectsApplied: string[] }
  | { ok: false; reason: 'on-cooldown' | 'not-usable-here' | 'no-charges'
                        | 'invalid-target' | 'not-in-inventory';
      readyInMs?: number };
```

A `cooldownMs` of **0** means genuinely spam-usable — no throttle, by design.

### 4.3 Effects

Effects reuse Phase 6/7 machinery rather than inventing a parallel damage/healing model:

```ts
type Effect =    // named `Effect`, not `ItemEffect`, from the start — see the v3 note
  | { type: 'restore'; pool: 'hp' | 'mana' | 'stamina'; amount: number }
  | { type: 'restore-percent'; pool: 'hp' | 'mana' | 'stamina'; percent: number }
  | { type: 'damage'; damage: DamageInstance }          // Phase 7 — a throwable flask
                                                        // resolveDamage is pure; the
                                                        // use-item caller applies the result
  | { type: 'apply-status'; statusId: UUID; }           // Phase 4 StatusEffectDef
  | { type: 'cure-status'; statusId: UUID }
  | { type: 'buff'; contribution: StatContribution; durationMs: number }
    // StatContribution (Phase 6 §6) = { attributeBonuses?, bonuses?, resistBonuses? }
    // — the SAME shape equipment uses, fed to DerivationInputs.buffs. So a Potion
    // of Giant Strength (+2 STR) correctly raises maxHp, physDamage AND physDef
    // through the same two-pass derivation a Ring of Strength does.
  | { type: 'learn-skill'; skillId: UUID }              // the spellbook (Phase 10 consumes this)
  | { type: 'script'; actions: TriggerAction[] };       // §4.4 — the custom-script hook
```

An **Elixir of Life** is `restore hp`. An **Elixir of Mana** is `restore mana`. A **potion of iron skin** is a timed `buff`. A **thrown flask** is a `damage` effect that routes through Phase 7's *single* `resolveDamage` pipeline — so a fire flask correctly meets fire resistance, and a physically-immune knight is *not* immune to it. That composition is free, and it's exactly why one pipeline was worth insisting on.

> ⚠ **Superseded — scripts are F `Action[]` on F's executor (§R.4).**

### 4.4 Item-triggered scripts — reuse, don't reinvent

E asked for items that fire custom scripts "similar to scripts triggered when talking to an NPC or wandering into an area." That system **already exists** — Phase 1's `TriggerAction[]`, driving map triggers and dialogue choices today.

So `{ type: 'script'; actions: TriggerAction[] }` hands the item's actions to **the same executor**. A magic horn that spawns an ally, a key that opens a specific door, a scroll that teleports you home — all of them are `TriggerAction`s, already implemented, now reachable from the inventory. Zero new machinery, and any action added later (set-flag, open-shop, start-cutscene) is *immediately* available to items too.

### 4.5 The spellbook, concretely

A spellbook is: `kind: 'usable'`, `consumedOnUse: false` (non-perishable — you keep it), `cooldownMs: 0`, and an effect of `{ type: 'learn-skill', skillId }`. Phase 8 defines and stores this; **Phase 10 implements the receiver** (the known-skills list). Until then it validates and no-ops gracefully rather than crashing — a deliberate, documented seam.

## 5. Currency

### 5.1 The hidden universal value

Every currency declares a `baseValue` in a **universal, invisible unit** (E's "hidden dollar"). This is bookkeeping the engine needs to compare a peserta to a ducat at all — the player *never sees it*.

```ts
interface CurrencyDef {
  id: UUID;
  name: string;              // "Peserta", "Sterling", "Ducat", "Obligation Bill"
  shortName: string;         // "p", "S", "D"
  icon?: AssetRef;
  baseValue: number;         // Peserta 0.01 · Sterling 1 · Ducat 100 · Bill 100
  description: string;       // flavor: who mints it, who trusts it
}
```

**Prices are always denominated in a named currency, never in base units.** Annwen's cloak costs "3 Sterlings." The player does no arithmetic, ever.

### 5.2 The wallet

```ts
type Wallet = Record<UUID, number>;   // currencyId → amount held
```

Plural by construction. Elms can hold 450 Pesertas, 2 Sterlings, and an Obligation Bill simultaneously, and they are *different things*.

### 5.3 Contextual value — the mechanic worth building

This is the good part, and it costs almost nothing.

A shop declares which currencies it accepts, and may **override what a currency is worth to it**:

```ts
interface ShopDef {
  id: UUID;
  name: string;
  merchantId?: UUID;                        // the NPC who runs it
  accepts: UUID[];                          // currencies taken at all
  valueOverrides?: Record<UUID, number>;    // "to me, this is worth…"
  stock: { itemId: UUID; qty: number; priceCurrency: UUID; price: number }[];
  buysCategories?: UUID[];                  // what she'll purchase from you
  buyRateMultiplier: number;                // she buys at a discount; default 0.5
}
```

Annwen, elven trader in Eire:
```
accepts:        [peserta, sterling, ducat]        // metal — copper only grudgingly
valueOverrides: { obligationBill: 0.01 }          // "it is paper."
```

Two distinct, authorable stances now exist, and a creator picks per-merchant:
- **Rejection** — the currency isn't in `accepts`. *"We do not trade in tree-pulp."* She won't take it at any price.
- **Devaluation** — it's accepted, but `valueOverrides` prices it as pulp. A desperate border trader might take the Bill at a humiliating rate.

That difference is **characterization delivered through a transaction**, and it's exactly the worldbuilding E was reaching for. It requires: one optional map. That's the entire cost.

### 5.4 Why this cannot become a trading sim

The engine deliberately provides **no profitable path for moving money**:
- No auto-conversion at checkout — you pay in what you hold.
- No selling a currency *as an item* to exploit an override.
- Money-changers (Phase 23, Economy & Trade) will charge a spread, so exchange always *costs*.

**Rule, stated so it survives future phases: the player must never gain value by relocating currency.** Contextual value shapes *who will trade with you*, never *how to profit*. Arbitrage is therefore not merely discouraged — it is unrepresentable.

## 6. Inventory categories

```ts
interface InventoryCategory {
  id: UUID;
  name: string;
  icon?: AssetRef;
  builtin: boolean;    // true → cannot be deleted or renamed
  order: number;       // tab display order
}
```

Six built-ins ship undeletable, exactly as specified: **Weapons · Armor · Consumables · Books · Others · Quest Items**. Creators can add more (Ores, Reagents, Trophies…) and reorder freely.

`project.categories: InventoryCategory[]` — the editable Category Database. Deleting a *custom* category reassigns its items to **Others** rather than orphaning them (a small thing that prevents a very annoying data loss).

> ⚠ **Superseded — entity methods become systems plus `use-item`/`drop-item` commands; the new conditions and actions are in §R.3.**

## 7. Runtime API

```ts
// CombatantEntity
addItem(itemId, qty = 1): { added: number; overflow: number }
removeItem(itemId, qty = 1): boolean
hasItem(itemId, qty = 1): boolean
countItem(itemId): number
getInventory(category?: UUID): InventoryStack[]
canUseItem(itemId): UseResult
useItem(itemId, target?): UseResult
tickCooldowns(dt): void          // called from EntityManager.update

// Wallet
getBalance(currencyId): number
addCurrency(currencyId, amount): void
canAfford(price, currencyId, shop?): boolean   // shop-aware: honors accepts + overrides
pay(price, currencyId, shop?): boolean         // no auto-conversion; exact currency only
```

> ⚠ **Superseded — `has-item` is added by this phase, not Phase 13 or Phase 12 (§R.3).**

`hasItem`/`countItem` are quietly important: they are what a future **`has-item` condition** (a locked door needing a key) will call. Phase 8 exposes them; the condition type lands with the door/dialogue work in **Phase 13**.


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
interface InventoryPanelSource {
  mode: PanelMode;
  stacks: InventoryStack[];        // author: an authored starting inventory
                                   // play: SaveState.character.inventory
  wallet: Wallet;
  categories: InventoryCategory[];
  canUse(itemId): CanUseResult;    // play only; 'author' always returns unavailable
  use(itemId): void;               // play only
  drop(itemId, qty): void;         // play only
  add(itemId, qty): void;          // author only
  assignToHotbar?(itemId, slotIndex): void;   // play only (Phase 11 §10)
}
```

The same panel authors an enemy's loot and a character preset's starting kit in `author` mode, and drives the player's bag in `play` mode. The category tabs, stacking, and wallet display are identical in both.


## 7.4 Shop stocking modes

A shop's stocking behavior is authored per shop, so a village smith can run out while a city bazaar never does. Phase 8 owns the fields; **Phase 13** builds the UI that spends them and **Phase 11 §6.2** owns the save state.

```ts
// on ShopDef
stockMode: 'infinite' | 'finite' | 'restocking';
restockIntervalMs?: number;      // 'restocking' only
restockToInitial?: boolean;      // true = refill to full; false = +1 per interval
```

| mode | behavior | save cost |
|---|---|---|
| **infinite** | Buy the last sword, there is another. The classic JRPG shop. | **nothing written** |
| **finite** | Stock depletes and stays depleted. Scarcity is real. | one entry |
| **restocking** | Depletes, then refills on a timer of elapsed play time. | one entry |

Infinite shops write no save state at all, which matters because most shops in most games are infinite — a save should not carry a stock table for every merchant just to record "unchanged." Selling into a `finite` or `restocking` shop adds to its stock; selling into an `infinite` one is accepted and stores nothing, since tracking stock for a shop with infinite stock is a contradiction.

`restockIntervalMs` is **elapsed play time** — which Phase 14 §0 now defines precisely as `elapsedMs`, time during which simulation is not paused. Browsing a menu does not restock a shop.

**Phase 14 §9 A5 adds the alternative it predicted:** `restockAt?: { hour: number }` for a shop that restocks at dawn rather than on an interval. Additive; existing interval shops are untouched.

> ⚠ **Superseded — a pickup is an archetype with a `pickup` component, not a new entity kind (§R.5).**

## 7.5 Pickups — money and items as things in the world

**Decision: loot is a pickup entity, with an `autoCollect` escape hatch.** The pickup entity is the *more general* model, and direct-to-wallet is a special case of it — a pickup that resolves the instant it drops. Building the entity first makes the simple behavior a flag; building direct-to-wallet first would make the entity a rewrite.

```ts
// A new EntityKind, joining player | npc | prop | doodad
interface PickupEntity extends SpriteBase {
  kind: 'pickup';
  payload:
    | { type: 'currency'; currencyId: UUID; amount: number }
    | { type: 'item'; itemDefId: UUID; quantity: number };
  autoCollect: boolean;       // walk over it, no prompt
  despawnAfterMs?: number;    // combat drops only — never set on authored piles
  sourceKind: 'authored' | 'dropped';
}
```

**Why the entity rather than a number going up.** Money becomes a thing that obeys the world's rules, and a great deal falls out for free: a chest *contains* coins because a container holds things; a merchant's purse drops where he stood; a creator can author "there are 40 coins on that table" as a placed object rather than a script; and a future pickpocket or theft mechanic has something to steal. It also composes with machinery that already exists — Phase 11's `world.takenPickupIds` delta tracks pickups already, so a save knows you took *that* pile with no new save shape at all.

**Auto-pickup is the default in action mode.** Skyrim makes you press a key because it has a full carry-weight economy where picking something up is a real decision. LoreBrix has no weight system (Phase 8 §2, by decision), so a confirm prompt is pure friction. Walk over it, take it.

**`autoCollect` on the loot table is what serves turn-based mode.** In a turn-based fight there is no walking over things, so a pile on the floor is unreachable by construction. `LootTable.autoCollect: true` resolves drops straight into the wallet and inventory at the moment of death — the direct-to-wallet behavior, as a per-table creator choice rather than an engine-wide law. Phase 9 owns that field (§5.4 there).

**Two failure modes worth designing against, because both are the kind found in playtest:**

- **Unreachable loot.** A pile knocked off a ledge or into a wall is money the player can see and never collect. On spawn, a pickup snaps to the nearest walkable cell within a small radius; if none exists, it auto-collects instead of dropping. Losing the tactile moment beats taunting the player.
- **Entity accumulation.** Twelve bandits leaving twelve piles, in every room, all persisted. Combat drops carry `despawnAfterMs` (default 120s) and auto-collect on despawn rather than vanishing — the player never silently loses money for walking too slowly. **Authored piles never despawn**; those are level design, not litter.

## 8. UI

- **Item Database editor** — a Rules tab, cloned from Phase 7's Equipment editor (this is the third use of that pattern; Phases 9–10 make it five). List + form + duplicate. Kind-aware: choosing `usable` reveals the effects builder; `equipment` reveals a picker linking to an `EquipmentDef`.
- **Currency editor** — a small table: name, short name, base value, icon. Plus a live "worth" preview so a designer can sanity-check that 100 Pesertas really does equal 1 Sterling.
- **Category editor** — reorderable list; built-ins locked with a visible padlock rather than mysteriously refusing to delete.
- **Inventory panel** — tabbed by category, stacks with quantity badges, cooldown sweeps on usables, invalid uses grayed *with the reason* ("on cooldown — 3s"). Built here for the *creator* to test with; **reused verbatim as the player-facing Inventory screen in Phase 11**, same as Phase 7's paper-doll becomes the Character screen.

## 9. Testing plan

Strict `tsc`, production build, and runtime tests per the standing discipline:

- **★ Pickups:** a currency pickup adds to the wallet and despawns; an item pickup respects `maxStack` and spills overflow; walking over an `autoCollect` pickup collects it with no prompt.
- **★ Unreachable loot cannot happen:** a pickup spawned onto a blocked cell snaps to the nearest walkable cell; with no walkable cell in radius it auto-collects instead of dropping.
- **Despawn:** a combat drop past `despawnAfterMs` auto-collects rather than vanishing — the player never silently loses money; an authored pile with no `despawnAfterMs` persists indefinitely.
- **★ Panel isolation (Phase 11 prerequisite):** the panel module's import list contains nothing from `App.tsx` or any editor-state module, and the panel renders and functions correctly against a synthetic `play`-mode source with no editor present.
- **Taxonomy:** equipment items resolve to their `EquipmentDef`; deleting the `EquipmentDef` degrades gracefully (item grays out, no crash).
- **Stacking:** merge to `maxStack`, overflow spills to a new stack; equipment never stacks; `addItem` reports overflow honestly.
- **Perishable vs non-perishable:** a potion is consumed on use; a spellbook is not; a finite-charge wand decrements and reports `no-charges` at zero.
- **Cooldowns:** a use during cooldown returns `on-cooldown` with `readyInMs`; `cooldownMs: 0` is genuinely spammable; cooldowns tick with the update loop.
- **Effects:** restore clamps at max pool; a thrown fire flask routes through Phase 7's `resolveDamage` and correctly meets fire resistance — **and damages a physically-immune knight** (proving the single-pipeline design pays off).
- **Item scripts:** an item's `TriggerAction[]` executes through the shared `ActionExecutor` (F §5.6) — same code path as an NPC's script, and a test can run one with no editor present.
- **Currency — the priority set:**
  - a shop **rejects** a currency not in `accepts` (Annwen refuses the Bill);
  - a shop **devalues** via `valueOverrides` (the Bill is accepted at 0.01, not 100);
  - `pay()` performs **no auto-conversion** — 450 Pesertas cannot silently buy a 3-Sterling cloak;
  - `canAfford` agrees with `pay` in every case (no "you can afford it" → payment fails).
- **Categories:** built-ins cannot be deleted or renamed; deleting a custom category reassigns its items to Others.
- **Quest items:** undroppable, unsellable by default.

## 10. Decisions locked (handoff summary)

- **One `ItemDef`** discriminated by kind (`equipment` | `usable` | `cargo`). Equipment items **reference** their Phase 7 `EquipmentDef` by id — one source of truth, no drift.
- **Usable = perishable (`consumedOnUse`) or not.** Optional finite `charges`. `cooldownMs` may be 0 (spammable).
- **Item scripts reuse the `ActionExecutor` (F §5.6)** — no new machinery, and every future action type is free to items.
- **Item damage effects route through Phase 7's single `resolveDamage`** — a fire flask meets fire resistance and bypasses physical immunity, for free.
- **Currencies are plural, hierarchical, with a hidden `baseValue`** the player never sees. Prices are always denominated in a named currency.
- **Shops both `accept`/reject and contextually re-value** currencies (`valueOverrides`) — rejection and devaluation are two distinct authorable stances. This is worldbuilding through transactions, at the cost of one optional map.
- **No auto-conversion. No arbitrage. No banking.** *Rule to carry forward: the player must never gain value by relocating currency.*
- **Six built-in, undeletable inventory categories** + creator-added extras; deleting a custom category reassigns to Others.
- **Stacking yes** (`stackable` + `maxStack`); **no weight/carry limit.**
- The Inventory panel built here is **reused verbatim as the player-facing Inventory screen in Phase 11.**

## 11. Open questions for E

1. ~~**Money as loot/pickup**~~ — **ANSWERED: a pickup entity**, with `LootTable.autoCollect` as the direct-to-wallet escape hatch for turn-based projects. §7.5. This also settles Phase 9's dependency, which had already assumed the pickup answer.
2. **Starting wallet & starting inventory:** set per-project in the character-creation flow (Phase 11), or authored on the player entity now? My lean: **author it on the player now**, let Phase 11's creation flow override it.
3. **Item icons:** the same procedural-placeholder approach as Emberfall's sprites (so the database is testable immediately), or hold for real art? My lean: **procedural placeholders now** — the database is useless to test without *something* to look at, and real art swaps in cleanly later.
4. ~~**What is the hero actually called?**~~ **ANSWERED.** The hero is **named by the player at character creation**, defaulting to **Elms** for a male character and **Chels** for a female one. Structurally: `PlayerSprite.name`, seeded from a `characterCreation.defaultNames` pair that **Phase 11 owns** alongside the gender → sprite → portrait flow. Every doc in the arc can now use the real names in examples.
