# Phase 14 — World Clock, Calendar & Rest · Technical Design (v2)

**Status:** **v2 — reconciled with the Foundation Rewrite (§R).** Design (no code yet)
**Depends on:** Foundation Phases 1–5 (F: tick clock, stepped mode, bus, tint seam, `Duration`), Phase 11 v2 (save, menu), Phase 13 v4 (dialogue pause rules)
**Blocks:** Phase 15 (fast travel consumes time)
**Stage:** Stage 1 · **Effort:** High · **Chunks:** two (14A calendar / 14B rest)

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

**v2 revision:** reconciled with the Foundation Rewrite. One elapsed clock, game time derived and never stored, the calendar rules, seasons all-or-nothing, catch-up emission, per-hour rest hooks, and `until` as an anchor are unchanged. Two mechanics need restating against F's fixed-tick loop.

### R.1 The one clock is F's tick

F's runtime advances in fixed 1/60 s ticks and saves `tick` (F §5.10). That is the elapsed clock:

```
elapsedMs = tick × 1000 / 60 + skippedMs
gameTime  = projectGameTime(elapsedMs, calendar)     // unchanged, pure
```

`WorldClock.tick(realDtMs, paused)` is superseded: the client decides whether ticks run (R.3), and the clock is a pure read of runtime state. The save gains `clock: { skippedMs }` beside F's `tick`.

### R.2 Waiting, sleeping, and fast travel skip time; they do not simulate it

Fast-forwarding eight hours by simulating would mean running tens of thousands of ticks. Instead Phase 14 adds `runtime.skipTime(ms)`:

- It bulk-advances everything measured in time: active effects, cooldowns, timers, respawn, restock. All are stored as ticks remaining, so the advance is a subtraction, not a simulation.
- It does not move entities or run combat.
- It adds `ms` to `skippedMs` and walks the boundary events in order, capped as §6.1 specifies, firing the per-hour rest hooks.
- `advance-time` (rest, Phase 15 travel) calls it.

### R.3 Pause rules decide whether the client ticks

`TimeRules` are read by the client: with `advanceDuringMenus: false`, the client stops calling `tick` while a menu is open, so nothing advances, including elapsed time. `turnBasedCombat: 'per-turn'` uses F's stepped mode, advancing `msPerTurn` per completed round.

### R.4 Day and night use F's tint seam

The tint is applied through F's `setWorldTint(rgb)` (F §6.6), not a tile-engine parameter. The renderer stays time-agnostic.

### R.5 Durations

`game-minutes` and `until` join F's `Duration` union as a minor schema revision; `ms` and `turns` are F's. Skill cooldowns and status durations are `Duration`s already (Phase 10 §R.1).

### R.6 Vocabulary

The time events, time conditions, `elapsed-time-reached`, `advance-time`, and `interrupt-rest` are added by this phase, the owner of the clock. They use the `type` discriminant (§6.1 and §6.2 wrote `kind`). `chance` is F's, not Phase 12's (§6.3).

### R.7 §9's amendments, where they stand

| Amendment | Status |
|---|---|
| A1, A2 (Phase 10 durations, game-time cooldowns) | Applied: F's `Duration`, extended here |
| A3 (Phase 12 events and conditions) | Superseded: this phase adds them itself (Phase 12 §R.3) |
| A4 (Phase 11 clock) | Applied as F's `tick` plus `skippedMs` (Phase 11 §R.3) |
| A5 (Phases 8 and 13 elapsed time) | Applied: simulation time, including skipped time |
| A6 (Phase 13.5 game-time stamps) | Stands |
| A7 (Phase 15 fast travel) | Stands, through `skipTime` |

### R.8 Testing additions

- `skipTime(8 hours)` expires an effect with 2 hours left, ticks a cooldown to zero, and moves no entity.
- `elapsedMs` round-trips as `tick` plus `skippedMs`; game time re-derives from it.
- With menus paused, a minute with the menu open advances zero ticks.

---

> ⚠ **Superseded — the elapsed clock is F's tick plus skipped time (§R.1).**

## 0. Two clocks, not three — E's Q5 answer removed one

I was about to specify three: Phase 11's `playtimeMs`, a new simulation clock for mechanics, and the game clock. E's definition collapsed the first two:

> *Elapsed play time = time where simulation is not paused.*

So there is **one elapsed clock**, and the pause rules (§3) decide what counts toward it. Phase 11's `playtimeMs` **is** that clock — the save screen's "4h 22m" is simulation time, which is also more honest, since twenty minutes spent reorganizing your inventory is not twenty minutes of playing.

| clock | definition | drives |
|---|---|---|
| **Elapsed time** `elapsedMs` | advances whenever simulation is unpaused (§3) | effect durations, cooldowns, respawn, restock, projectiles, the save screen |
| **Game time** | `elapsedMs` × ratio, projected onto a calendar | dates, day/night, season, date-gated content |

**Game time is derived, never stored independently.** One authoritative number plus a pure projection function. Two mutable clocks would drift, and drift in a save file is unfixable.

**★ Cross-document flag.** Phase 8 §7.4 (shop restock), Phase 13 §7.4 (doodad respawn), and Phase 10's durations all say "elapsed play time" while meaning something that did not yet have a definition. They now mean `elapsedMs` precisely. §9 lists the amendments.

## 1. Goal

An authored calendar, a derived game clock, day/night, the events and conditions that read them, and wait/sleep.

## 2. Non-goals

- **NPC daily schedules.** A real behavior extension — work by day, sleep by night — and this clock is its prerequisite, not its delivery. Still unowned.
- **Weather and seasonal terrain.** Seasons are queryable here; what a creator does with them is theirs.
- **Timezones, leap years, moon phases.** Not requested; all authorable on top of the primitives below.
- **In-world dates on Stage 2 server data.** Local only.

---

> ⚠ **Superseded — the client applies these by pausing ticks (§R.3).**

## 3. Pause rules — per E's Q2, a toggle rather than a law

```ts
interface TimeRules {
  advanceDuringDialogue: boolean;        // default TRUE
  advanceDuringMenus: boolean;           // default FALSE
  advanceDuringPausedPlaytest: boolean;  // default FALSE
  turnBasedCombat: 'paused' | 'per-turn';// default 'per-turn'
}
```

**`per-turn` spends `msPerTurn`** — Phase 10 §5.8's constant, already author-editable in `gameplayRules`, per E. So each completed round advances the world by one turn's worth rather than by however long the player deliberated. A fight is then a fixed cost in game time regardless of how slowly it is played, which is the only version that does not let a thoughtful player burn a day per battle.

The defaults match what most players expect from the genre: conversations happen in the world, menus are outside it.

## 4. The calendar

```ts
interface CalendarDef {
  enabled: boolean;                 // false = no game clock at all; elapsedMs still runs

  msPerGameDay: number;             // 480_000 = 480 real seconds per game day
  hoursPerDay: number;              // default 24
  minutesPerHour: number;           // default 60

  dayNames: string[];               // ★ week length IS the array length (§4.1)
  months: MonthDef[];               // per-month lengths (§4.2)
  seasons: SeasonDef[];             // empty, or complete (§4.3)

  start: {                          // Time Zero — when "New Game" is pressed
    year: number;
    monthIndex: number;
    day: number;                    // 1-based
    dayNameIndex: number;           // anchors the weekday cycle
    hour: number;
    minute: number;
  };

  dayNight: DayNightDef;            // §4.4
}

interface MonthDef { name: string; days: number; }
interface SeasonDef { name: string; startMonthIndex: number; endMonthIndex: number; }
```

### 4.1 Week length is free

E flagged 7-day weeks as possibly deferrable. It costs nothing: `dayNames: string[]`, and the week **is** the array's length. A 5-day week, a 10-day week, or a single-entry array (every day is "Day") all work with no branching. There is no reason to hardcode 7 and no reason to defer.

**Weekday is anchored, not computed from the date.** `start.dayNameIndex` fixes it, and every later day is `(startIndex + daysElapsed) % dayNames.length`. This is what E meant by *"name of day and date is locked with this definition"* — a creator declares that year 201, Sun's Height 17 is a Middas, and the cycle follows from there rather than from an arbitrary epoch.

### 4.2 Per-month lengths, with the uniform toggle

Per E: per-month lengths, with a UI toggle to make them uniform and a conflict check.

**The conflict check is cheap, so it ships.** Shortening months can orphan authored dates — a trigger set for the 31st when months become 30 days. Applying uniform length:

1. Scan every authored date reference: `game-time-reached` events, date conditions, quest triggers, scheduled events.
2. **No conflicts** → apply silently.
3. **Conflicts** → list them, each with a jump-to link, and offer:
   - **Cancel** (default, recommended) — nothing changes.
   - **Force** (not recommended, and labeled so) — applies and **clamps** each orphaned date to the new last day. Clamping rather than deleting, because a trigger that silently vanishes is worse than one that fires a day early.

Same shape as Phase 11 §12.5's destructive dialogs: real counts, an explicit list, and the safe option as the default.

### 4.3 Seasons — empty or complete, per E

```ts
seasons: [
  { name: 'Spring', startMonthIndex: 0,  endMonthIndex: 2 },
  { name: 'Summer', startMonthIndex: 3,  endMonthIndex: 5 },
  …
]
```

**Every month belongs to exactly one season, or there are no seasons at all.** No partial coverage, no unnamed gaps. Validation enforces it: total coverage, no overlaps, and wrap-around permitted so a winter spanning the year boundary (`start: 10, end: 1`) is legal.

The all-or-nothing rule is what lets `season-is` always answer, rather than returning "none" for a third of the year and forcing every consumer to handle it.

> ⚠ **Superseded — applied through F's `setWorldTint` (§R.4).**

### 4.4 Day and night

```ts
interface DayNightDef {
  enabled: boolean;
  dawnHour: number;    // default 6
  duskHour: number;    // default 20
  tintDay: string;     // '#00000000'
  tintNight: string;   // e.g. '#0a1a3a55'
  transitionMinutes: number;  // default 60 — interpolated, not a hard cut
}
```

A single composited overlay on the tile engine, applied after all layers and before UI. **`tile-engine.ts` gains one optional tint parameter** and nothing else; the interpolation lives in the caller. Keeping the engine stat-agnostic and now time-agnostic has held for thirteen phases and is worth protecting.

> ⚠ **Superseded — `WorldClock` reads F's tick; time jumps use `skipTime` (§R.1, §R.2).**

## 5. The runtime

```ts
interface GameTime {
  totalMinutes: number;     // game minutes since Time Zero — the canonical scalar
  year: number;
  monthIndex: number; monthName: string;
  day: number;              // 1-based
  dayNameIndex: number; dayName: string;
  seasonIndex: number; seasonName: string;
  hour: number; minute: number;
  isNight: boolean;
}

class WorldClock {
  constructor(def: CalendarDef, rules: TimeRules, bus: EventBus);
  tick(realDtMs: number, paused: boolean): void;
  advanceGameMinutes(n: number): void;    // wait, sleep, fast travel
  now(): GameTime;
  elapsedMs(): number;
  format(t: GameTime, pattern: string): string;   // "17th of Sun's Height, 4E 201"
}

// pure, and therefore exhaustively testable
projectGameTime(elapsedMs: number, def: CalendarDef): GameTime;
```

**`totalMinutes` is the canonical scalar.** Every comparison, every recurrence, every duration boundary reduces to integer arithmetic on it. Comparing calendar structs field by field is where off-by-one bugs live, especially across month and year boundaries with non-uniform lengths.

**Save state:** `SaveState.clock = { elapsedMs }`. That is all — game time is derived, so a creator who changes `msPerGameDay` mid-development sees existing saves re-derive rather than corrupt.

## 6. Events and conditions

Both are additive to Phase 12's vocabularies. **E's two examples need one of each**, which is why both are required: *"only on Mondays"* is a condition, *"every 21st"* is an event.

### 6.1 New `GameEvent` variants

```ts
| { kind: 'game-hour-changed' }
| { kind: 'game-day-changed' }
| { kind: 'game-month-changed' }
| { kind: 'game-season-changed' }
| { kind: 'game-year-changed' }
| { kind: 'dawn' }
| { kind: 'dusk' }
| { kind: 'game-time-reached'; year?: number; monthIndex?: number;
    day?: number; hour?: number; minute?: number }   // omitted fields are wildcards
| { kind: 'game-day-of-month'; day: number }          // "every 21st"
| { kind: 'game-day-of-week'; dayNameIndex: number }  // "every Middas"
| { kind: 'elapsed-time-reached'; ms: number }        // absolute, fires once
```

Wildcards are what make one variant cover both a one-off and a recurrence: `{ day: 21 }` alone fires every 21st; adding `year` and `monthIndex` pins it to a single date.

**Catch-up on a large jump.** Sleeping eight hours must not skip eight `game-hour-changed` events. `advanceGameMinutes` walks boundaries in order and emits each, capped (default 512 emissions) with a log — so sleeping through a year does not lock the tab. Phase 12's bus is already queued and depth-capped; this reuses that machinery.

### 6.2 New `Condition` variants

```ts
| { kind: 'game-time-between'; fromHour: number; toHour: number }   // wraps past midnight
| { kind: 'game-day-name-is'; dayNameIndex: number }
| { kind: 'game-month-is'; monthIndex: number }
| { kind: 'game-season-is'; seasonIndex: number }
| { kind: 'game-date-is'; day: number; monthIndex?: number; year?: number }
| { kind: 'is-night' }
```

> ⚠ **Superseded — `chance` lives in F (§R.6).**

### 6.3 ★ `chance` — a gap E's rest example exposed

*"Waiting in a hostile area has a 10% chance of a random encounter every hour."* Nothing in the condition vocabulary is probabilistic. Phase 4's formula evaluator has an RNG; conditions do not.

```ts
| { kind: 'chance'; probability: number }   // 0..1, evaluated once per check
```

**This belongs in Phase 12, not here** — it is a general condition with nothing to do with time, and gating a random ambush on a zone entry is the same need. §9 carries the amendment. Flagged as a Phase 12 gap that only surfaced because of a Phase 14 example.

Seeded from the save so a reload does not reroll the same check to a different answer.

## 7. Wait and sleep — 14B, per E's Q1

Built after the calendar, because it is a fast-forward of the thing the calendar projects.

```ts
interface RestRules {
  waitEnabled: boolean;
  sleepEnabled: boolean;

  waitConditions?: Condition[];     // e.g. not in combat
  sleepConditions?: Condition[];    // e.g. must be near a bed prop

  maxWaitHours: number;             // default 24
  maxSleepHours: number;            // default 24

  onWaitHour?: TriggerAction[];     // ★ fires per game hour elapsed
  onSleepHour?: TriggerAction[];
  onWaitComplete?: TriggerAction[];
  onSleepComplete?: TriggerAction[];
  onInterrupted?: TriggerAction[];  // §7.2
}
```

**Per-hour hooks are what make E's examples work**, and neither needs anything new beyond §6.3:

```
Sleeping heals the party completely
  onSleepComplete: [ restore-pools-full ]

Waiting in a hostile area: 10% random encounter per hour
  onWaitHour:
    when   (implicit, per hour)
    given  [ variable area_is_hostile == true, chance 0.10 ]
    then   [ spawn-enemy …, interrupt-rest ]
```

The second is an ordinary trigger. It also reveals why per-hour rather than per-rest: a 10% chance evaluated once for an eight-hour wait is a different game than eight independent rolls.

### 7.1 Never in combat

`waitConditions` and `sleepConditions` are author-editable, but **combat is a hard block regardless** — fast-forwarding past a fight is not a design choice. Uses Phase 13 §13's interim combat definition until Phase 16 replaces it.

### 7.2 Interruption

Any action during a per-hour hook may fire `interrupt-rest`, which stops the advance **at that hour boundary** — not at the requested end — and fires `onInterrupted`. Stopping mid-hour would leave the world in a half-simulated state; the boundary is the only clean stopping point.

```ts
// TriggerAction
| { type: 'interrupt-rest' }
| { type: 'advance-time'; gameMinutes: number }   // also used by Phase 15 fast travel
```

### 7.3 UI

Wait is a menu entry beside Save; sleep is a prop interaction (`onInteract` firing `open-rest`). Both open one dialog: an hour slider, the resulting date and time shown live, and a confirm. The projection makes "you will wake on Middas at 6am" free to display, which is what turns a number of hours into a decision.

## 8. Editor

A **Calendar panel** in the rules tab, thirteenth sibling of the database pattern:

- Ratio, with a live readout: *"480 real seconds = 1 game day · 20 real seconds = 1 game hour."* A bare millisecond field is unusable here.
- Day names — an editable list, length free.
- Months — name and length per row, plus the uniform toggle of §4.2 with its conflict pass.
- Seasons — spans, validated all-or-nothing.
- Start date, with a preview of the projected date.
- Day/night hours and tints, with a scrub control to preview any hour.
- Rest rules and their four action hooks.

**A scrub-to-time control in playtest**, alongside Phase 12's variable watch panel: jump to any hour or date to test time-gated content without waiting. An author testing a 21st-of-the-month event should not play nineteen game days to reach it.

> ⚠ **Superseded — see §R.7 for where each stands.**

## 9. Amendments this phase requires elsewhere

Paste-ready, cross-document, in dependency order.

**A1 — Phase 10 v5: durations become a union.** `StatusEffectDef` and skill cooldowns currently carry `durationMs` plus an optional `durationTurns`. Neither can express *"for the rest of the day"*, which both of E's examples need.

```ts
type Duration =
  | { kind: 'ms'; value: number }
  | { kind: 'turns'; value: number }
  | { kind: 'game-minutes'; value: number }
  | { kind: 'until'; boundary: 'dawn' | 'dusk' | 'midnight'
                             | 'end-of-day' | 'end-of-week'
                             | 'end-of-month' | 'end-of-year' };
```

`until` is an **anchor, not a duration**: Monday Madness cast at 11pm lasts one hour, not a full day. That is correct and must be deliberate. `ms` remains canonical and the existing conversion via `msPerTurn` is unchanged, so no authored data migrates.

**A2 — Phase 10 v5: game-time cooldowns close a deferral.** §10.5 parked Elder-Scrolls-style once-per-day Greater Powers *"until Phase 14 provides a clock."* It does. `ActiveSkillDef.cooldown` takes the same `Duration` union, so `{ kind: 'until', boundary: 'end-of-day' }` **is** a Greater Power. No new field; the parked feature arrives as a consequence.

**A3 — Phase 12 v7: new events and conditions.** §6.1's eleven event variants, §6.2's six condition variants, and — separately owned — **§6.3's `chance` condition**, which is a general probabilistic gate that belongs in Phase 12 regardless of time. Plus the `advance-time` and `interrupt-rest` actions.

**A4 — Phase 11: `playtimeMs` is simulation time.** Per E's Q5 definition, the save screen's elapsed figure excludes paused menus. `SaveState.clock = { elapsedMs }` is added; nothing else changes, because it is the same number Phase 11 already stores under a now-precise definition.

**A5 — Phases 8 and 13: "elapsed play time" now has a definition.** Shop restock (Phase 8 §7.4) and doodad respawn (Phase 13 §7.4) both say it. They now mean `elapsedMs`, and both gain an optional game-time alternative — a shop that restocks at dawn, a herb that regrows in spring — additive, no migration, exactly as both documents predicted.

**A6 — Phase 13.5: quest timestamps gain a date.** `QuestProgress` records `startedAtMs`. Capturing `GameTime` alongside it makes *"begun on the 17th of Sun's Height, 4E 201"* free in the journal — but only if captured at the time, since a later `msPerGameDay` change would re-derive it wrongly. One field, added now.

**A7 — Phase 15: fast travel consumes game time** via `advance-time`, and inherits §3's pause rules and §7.2's interruption model rather than inventing its own.

## 10. Testing

- **★ Projection is pure and exhaustive:** `projectGameTime` returns correct year, month, day, weekday, season, hour, and minute across month boundaries, year boundaries, non-uniform month lengths, a 5-day week, a 10-day week, and a single-day week. Property-tested: projecting *N* and *N+1* minutes never skips or repeats a day.
- **★ One clock:** game time is never stored; changing `msPerGameDay` re-derives existing saves rather than corrupting them.
- **Pause rules:** with `advanceDuringMenus: false`, elapsed time does not move while the menu is open; with dialogue true, it does; `per-turn` advances exactly `msPerTurn` per completed round regardless of real deliberation time.
- **★ Catch-up:** sleeping eight hours emits eight `game-hour-changed` events in order, plus `dawn` if crossed; sleeping a full year hits the emission cap and logs rather than hanging.
- **Weekday anchoring:** a start of `dayNameIndex: 2` puts day 0 on the third day name, and the cycle holds across a year boundary with non-uniform months.
- **Seasons:** validation rejects partial coverage and overlaps; a wrap-around winter resolves correctly on both sides of the year boundary.
- **Uniform toggle:** with no orphaned dates it applies silently; with orphans it lists them and cancels by default; forcing clamps to the new last day and never deletes a trigger.
- **★ Rest:** `onWaitHour` fires once per game hour, not once per rest; a `chance 0.10` gate over eight hours produces roughly eight independent rolls; `interrupt-rest` stops at the hour boundary and fires `onInterrupted`; rest is refused in combat regardless of authored conditions.
- **`chance` is seeded:** reloading a save and re-triggering the same check produces the same result.
- **Durations (A1):** an `until end-of-day` effect cast at 11pm expires in one game hour; `game-minutes` converts correctly; `ms` and `turns` behave exactly as before.
- **Cooldowns (A2):** a skill with `until end-of-day` is castable once per game day and survives save and reload.
- **Day/night:** the tint interpolates across `transitionMinutes` and reaches full night at `duskHour + transition`; `enabled: false` renders no overlay.
- **Non-regression:** every Phase 5.5–13.5 test passes with `CalendarDef.enabled: false` — a project that wants no clock behaves exactly as it did.

## 11. Decisions locked

- **One elapsed clock**, advancing whenever simulation is unpaused; **game time is derived**, never stored.
- **Pause behavior is authored** — dialogue advances by default, menus do not, turn-based combat spends `msPerTurn` per round.
- **Week length is the `dayNames` array length**; weekday is anchored at the start date, not computed from an epoch.
- **Per-month lengths**, with a uniform toggle whose conflict pass defaults to cancel and clamps on force.
- **Seasons are all-or-nothing** — complete coverage, no unnamed gaps, wrap-around permitted.
- **`totalMinutes` is the canonical scalar** for every comparison and recurrence.
- **Boundary events catch up on jumps**, in order, capped.
- **Rest fires per-hour hooks**, is hard-blocked in combat, and interrupts at hour boundaries.
- **`until` is an anchor, not a duration** — and it is what finally delivers Greater Powers.
- **`tile-engine.ts` gains one tint parameter** and nothing else.

---

*LoreBrix, ELMSCORP. Phase 14 design — for review.*
