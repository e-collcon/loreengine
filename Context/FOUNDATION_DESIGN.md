# LoreEngine Foundation — Phases 1–5 (2D Hex-Iso Action RPG)

Nov 16, 2026 · @E

## Status

This document replaces v0 Phases 1–5 with a layered engine foundation, and folds every action-RPG gap from the 16 Nov gap analysis into the phase that owns it. Phase 5.5 dissolves into it.

**Status:** Design (no code yet) · supersedes v0 Phases 1–5 and Phase 5.5 **Stage:** 1 · **Implementer:** Fable 5.2 · **Design:** Claudia · **Owner and approver:** E **Standing law:** design doc → E approves → implement in verified chunks → strict `tsc --noEmit` + production build + targeted runtime tests → next phase.

### Revision history

| Rev | Change | Why |
| --- | --- | --- |
| v5 | Q11 and Q12 decided; jump links in pathfinding put on the backlog; Emberfall clarified as a test map only; first attribute set to come from Planet Reset | E's answers, 17 Nov; this is the version handed to Fable |
| v4 | Renamed **LoreEngine**; scripted jumps specified (section 7.9c); every open question decided except Q11 and Q12; authored attributes applied in Phase 6 v6 and noted in Phases 7, 9, 10, 11 | E's answers, later on 16 Nov |
| v3 | Q1, Q5, Q9, Q16 decided; click-to-act orders specified (section 7.9b); `InputFrame.moveTo` replaced by `order`; 16 cliff levels; Q15's lean changed to authored attributes | E's answers on 16 Nov, and the engine is now explicitly for our own repeated use |
| v2 | `AssetRef` id is the hash; `Duration` is a union; `EffectDef` renamed `StatusEffectDef` with Phase 10's field names; variables referenced by id (Phase 12's shape); global triggers; player spawns from `playerArchetypeId`; a runtime command channel; save list and body stores split; Q15 and Q16 added; section 11 now records the applied amendments | Reading Phases 5.5–14 in full exposed conflicts between those documents and v1 of this one |
| v1 | Phases 1–5 rewritten by layer, with elevation, hex-iso altitude rendering, height-aware sight, action feel, enemy behavior, vector animation, and audio folded in | E is spending the Fable 5.2 window on a 2D hex-iso action RPG scoped to the pre-Planet Reset v0 roadmap |

### How to read it

Sections 1–3 apply to all five phases. Each phase section then follows the same order: goal, non-goals, data model or behavior, signature tests. Budgets, gates, build order, amendments, and open questions close the document.

Every open question carries a lean. **Fable proceeds on the lean unless E overrides it**, so no question blocks the first chunk.

## 1. Findings and scope

The foundation is rebuilt greenfield because about twenty verified defects in shipped v0 Phases 1–5 trace to one root: the game ran inside the editor. This rewrite makes the runtime headless and the editor one of its clients.

### What this is based on

- **Roadmap v0** (`ROADMAP_v0.md`, frozen), read in full this session.
- **The pre-pivot rewrite plan** (the "new 1–5: split by layer" proposal), read in full this session.
- **Refinements from the later Roadmap rewrite** in the October planning chat: `VariableStore` in Phase 2, map lifecycle and cross-map teleport in Phase 3, `Health` and `ActiveEffects` in Phase 4. Each fixed a sequencing bug, so they carry over.
- **The 16 Nov gap analysis**: elevation, altitude rendering, height-aware sight, action feel, enemy behavior, vector animation, audio.

### What was not verified this session

I have not read the shipped v0.6.0 source in this session. Three consequences for Fable:

1. **Ported module APIs are unknown here.** The hex math, A\*, and spatial hash are ported verbatim with their tests. Function names in this document are the new API; Fable writes thin adapters over the ported code rather than renaming it.
2. **Hex orientation is pointy-top with odd-r offset storage,** per v0's ARCHITECTURE.md. The ported projection defines it, and nothing here depends on it.
3. **The defect list is from earlier verification rounds**, not re-checked now. It explains the design; it is not a test target.

### The scope assumption

This is LoreEngine, a permanently separate engine that began as **the 2D branch of LoreBrix**: a hex-iso action RPG with vector art, scoped to v0's feature set. In the later Roadmap's terms, the hex world plays the role of the host: it owns position, collision, navigation, line of sight, and animation, all inside LoreEngine. Planet Reset's Unreal path is out of scope. E decided it is a separate repository, permanently (Q1).

### Defects the foundation must make impossible

| Defect class | v0 example | Prevented by |
| --- | --- | --- |
| Authorable but inert | `flag-set`, `swimmable`, `flyable`, `run-script` | P1 reader manifest test |
| Logic trapped in the UI | `runActions` and the dialogue runtime as React closures | P1 package boundaries |
| Presence check instead of evaluation | win conditions | P2 single `ConditionEvaluator` |
| Fake line of sight | `distTiles <= 6` | P4 `castSegment` with height |
| Two meanings in one field | `activeMapId` | P1 `startMapId` vs editor state |
| Live state in authored data | `Project.player` | P2 save boundary |
| Restructuring after the foundation | 2D transform later needing altitude | P1 `Transform` has `z` from day one |

## 2. Laws and locked decisions

Eight laws govern every phase. Each exists because v0 broke it at least once, and each has a test that fails when it is broken.

### Laws

| Law | Rule | Enforced by |
| --- | --- | --- |
| L1 Runtime first | The runtime runs headless. Editor, player, renderer, and audio are clients. The runtime imports no UI, DOM, renderer, or React. | Package boundary test (P1) |
| L2 Composition | Entities are generational ids with components. No class hierarchy. | P4 entity store |
| L3 Controlled evolution | No unversioned breaking change. Adding an optional field or a new top-level collection is a minor schema revision; changing an existing shape is a major one with explicit rejection or migration. | Schema version tests (P1) |
| L4 Hot files are human-gated | The schema source is the one file agents never edit without E's approval. Types and validators are generated from it. | Codegen check in CI (P1) |
| L5 Determinism | Same content revision, save, RNG state, and input stream produce the same state, tick for tick, on the same build and browser engine. | Replay hash test (P2) |
| L6 One pipeline per concern | One evaluator, one executor, one raycast, one attack timing source. | Review against this document |
| L7 Authored vs played | Projects hold authored data. Saves hold sparse changes. Nothing a player does is written into the project. | Playtest leaves project byte-identical (P5) |
| L8 Budgets are requirements | Every collection is capped, every lifetime has an owning scope, hot paths allocate nothing per tick. | Leak and budget gates (section 9) |

### Locked decisions

Carried from E's earlier rulings:

- **Turn-based stays in the engine.** The clock supports a stepped mode; the action game never enables it.
- **Composition**, not `BaseEntity → CombatantEntity → PlayerEntity / NPCEntity`.
- **Greenfield**, porting only hex math, A\*, and the spatial hash, with their tests.
- **Coins and drops are pickup entities.** The foundation does not build pickups (Phase 8 does) but nothing here may assume direct-to-wallet loot.
- **Unlimited manual saves, rolling autosaves (default 3).** `SaveStore` must not cap manual slots.
- **Permadeath is first-class.** Phase 11 owns it on the `Playthrough` row (tombstones, consumed manual saves); F's stores leave room for it.

Locked by this document:

- **Hexagonal isometric terrain** with Warcraft III-style **discrete cliff levels and ramp tiles**.
- **Continuous movement over the hex grid.** Terrain, pathing, and elevation are per hex; entity positions are continuous.
- **`Transform` carries `z` from day one**, so altitude never restructures the entity model.
- **Fixed 60 Hz simulation**, rendering interpolated between ticks. Authored durations are milliseconds, converted to ticks once at load.
- **The simulation owns animation time.** The renderer only draws the frame the runtime says is current.
- **Attack timing is owned by `AttackDef`** (windup, active, recovery), not by animation frames. This replaces my earlier note that combat timing depends on animation events: animation now follows the attack, so combat works with placeholder art.
- **I-frames are an active effect**, not a special case.
- **Renderer and audio are subscribers.** They read runtime state and events; they never write either.

Decided by E on 16 Nov 2026:

- **The engine is LoreEngine, in its own repository, permanently** (Q1, Q10). It has its own roadmap; phases are renumbered once, after the foundation lands.
- **Hex-iso only** (Q16). Square maps are gone.
- **16 cliff levels, 0 to 15**, as Warcraft III stores them (Q9).
- **Diablo-style click-to-act plus WASD** (Q5), specified in section 7.9b.
- **No jump input; scripted jumps only** (Q7), specified in section 7.9c.
- **Attributes are authored** (Q15). Engine-fixed core stats (HP, Attack, Defense and the rest) are derived from each game's own attributes through an authored table; specified in Phase 6 v6 §R.11.
- **Zod, PixiJS, baked frames, in-house entity store, fflate** (Q2, Q3, Q4, Q13, Q14), as leaned.

Decided by E on 17 Nov 2026: no content hot reload in playtest (Q11); the simulation runs on the main thread, measured by the budget benches (Q12); jump links in pathfinding go on the LoreEngine backlog (section 7.9c).

## 3. Where everything lands

All seven action-RPG gaps land inside Phases 1–5, and each is split by layer: its data in Phase 1, its rules in Phase 2 or 4, its look and sound in Phase 3, its authoring in Phase 5.

### The five phases

| Phase | Layer | Effort |
| --- | --- | --- |
| 1 Architecture & Schema | Packages, the boundary law, the one schema source, every shared type | Extra High |
| 2 Runtime Core | Headless loop, events, actions, conditions, variables, RNG, input, saves, storage | Extra High |
| 3 World, Elevation & Presentation | Hex map with cliffs and ramps, map lifecycle, renderer, assets, animation playback, game feel, audio | Extra High |
| 4 Entities & Simulation | Entity store, movement and collision, pathing, sight, factions, attacks, dodge, health, effects, brains | Extra High |
| 5 Editor Shell & Playtest | Editor as a client, elevation tools, database editors, undo, playtest, debug overlays | High |

### Action-RPG gaps, by owner

| Gap | Data (P1) | Rules | Presentation (P3) | Authoring (P5) |
| --- | --- | --- | --- | --- |
| Elevation: cliff levels and ramps | `MapDef` level and ramp layers | P3 world queries, P4 passability | Cliff faces | Raise, lower, ramp, validate |
| Hex-iso altitude rendering | `ProjectSettings` geometry | — | Depth sort, height-aware picking, occlusion silhouette | Live preview |
| Height-aware sight and projectiles | `SightSettings`, `Collider.height` | P4 `castSegment` in 3D, high-ground rule | Debug ray overlay | Sight overlay |
| Action feel, simulation | `AttackDef`, `Dodge`, knockback, hitstop | P4 contact, impulse, hitstop, i-frames | — | Attack editor |
| Action feel, presentation | `FeedbackDef`, `ParticlePresetDef` | — | Flash, shake, particles | Feedback editor |
| Enemy behavior | `BrainDef` | P4 brains, telegraphs, leash; P2 triggers for boss phases | Telegraph feedback | Brain editor |
| Vector animation | `AnimationSetDef` | P4 animator clock | SVG bake to atlases, frame playback | Import and preview |
| Audio | `AssetRef` audio, feedback `sfx` | P2 `change-bgm`, `play-sfx` actions | `AudioMixer` | Asset panel |

### v0 phases absorbed

| v0 item | Lands in | What remains in the v0 phase |
| --- | --- | --- |
| 5.5 Schema v2 (all six items) | P1, P2 | Nothing. 5.5 dissolves. |
| 5.5 `ActionExecutor` extraction | P2 | — |
| 10 `castRay`, acquisition, faction field | P4 | Skills, delivery, effect payloads beyond the foundation four |
| 10 `ActiveEffectSet` | P4 `ActiveEffects` | Stat-contribution payload, authored status effects |
| 11A storage, save boundary | P2 | Character block, slots UI, `projectVersionId` reconciliation |
| 11B input actions | P2 (`InputFrame`, defaults) | Player rebinding UI, hotbar |
| 12 event bus, `Trigger.given`, variables | P2 | Variables editor, usage view, named constants in formulas |
| 14 elapsed clock, tint seam | P2, P3 | Calendar, day and night, wait and sleep |
| 15A map lifecycle, cross-map teleport | P3 | World map, fast travel |
| 17 dodge | P4 | Jump moves to Phase 6 (Q7); TEA keeps its taxonomies |
| 19 mixer, BGM, SFX | P3 | Ambience, distance attenuation, audio authoring polish |
| 21A movement-mode primitive, altitude | P3, P4 | Swim stamina, drowning, flight behaviors, mounts |

v0 Phase 4's node formula editor is rebuilt in Phase 10, its first consumer, rather than here.

## 4. Phase 1 — Architecture & Schema

Phase 1 ships no gameplay. It ships the package layout that makes logic-in-the-UI impossible, and one schema source from which every type and validator is derived.

**Depends on:** nothing · **Blocks:** all · **Effort:** Extra High · **Chunks:** one

### 4.1 Goal

At the end of Phase 1, a repository exists in which the runtime cannot import the DOM, and in which the full authored container, including elevation, attacks, brains, feedback, and animation, validates Emberfall and rejects v0.6.0 files.

### 4.2 Non-goals

| Deferred | Owner |
| --- | --- |
| Stats and attributes | Phase 6 |
| Equipment, damage types, the damage pipeline | Phase 7 |
| Items, currencies, pickups, inventory | Phase 8 |
| Enemy database split, loot tables | Phase 9 |
| Skills, projectiles, the formula graph and its node editor, status-effect payloads beyond the foundation three | Phase 10 |
| Dialogue trees, portraits, icons | Phases 11 and 13, as minor schema revisions |
| Quests, calendar, factions' standing | Phases 13.5, 14, 18 |

None of these get empty placeholder collections now. Under L3, a later phase adds its collection as a minor revision; an empty array nothing reads is exactly the `flag-set` defect.

### 4.3 The central decision: packages enforce L1

The runtime is a separate package compiled **without the DOM library**. Any use of `window`, `document`, or React fails `tsc`, not a review.

| Package | Contents | May import |
| --- | --- | --- |
| `schema` | The Zod source, inferred types, validators, reader manifest | nothing |
| `hexmath` | Ported verbatim, with its tests | nothing |
| `algorithms` | Ported A\* and spatial hash, with tests | `hexmath` |
| `runtime` | Headless engine (Phases 2 and 4, world queries of Phase 3) | `schema`, `hexmath`, `algorithms` |
| `storage` | IndexedDB stores, `BlobStore`, file import and export | `schema` |
| `render` | PixiJS renderer, feedback, particles | `schema`, `runtime/view` |
| `audio` | Web Audio mixer | `schema`, `runtime/view` |
| `player` | Game client; hosts playtest now, the shipped game later | all except `editor` |
| `editor` | React app on Lovable's design system | all |
| `fixtures` | Emberfall project, golden saves | `schema` |

`runtime/view` is a read-only entry point. Renderer and audio see state and events through it; they cannot reach a mutating call.

Tooling: npm workspaces, TypeScript strict, Vite for `editor` and `player`, Vitest, and runtime tests that run in Node with no browser.

### 4.4 The schema source (L4)

`schema/src/project.ts` is the hot file. Types come from Zod by inference; nothing re-declares them by hand. It changes only with E's approval.

**Reader manifest.** `schema/src/readers.ts` maps every authored leaf field to the system that reads it and the test that proves it. CI walks the schema and fails on any field with no entry. This is the permanent guard against authorable-but-inert fields.

### 4.5 Data model

Everything below is **authored** (project). Played state lives in the save (Phase 2).

```ts
type Id<K extends string> = string & { readonly __kind: K }; // UUID v4
const SCHEMA_VERSION = 2; // v0.6.0 files are schema 1 and are rejected

interface Project {
  schemaVersion: 2;
  schemaMinor: number;            // additive revisions only (L3)
  id: Id<'project'>;
  name: string;
  contentRevision: number;        // +1 per saved edit; an input to determinism (L5)
  startMapId: Id<'map'>;          // authored start; the editor's open map lives in EditorState
  settings: ProjectSettings;
  assets: AssetManifest;
  terrains: TerrainDef[];
  maps: MapDef[];
  archetypes: ArchetypeDef[];
  animationSets: AnimationSetDef[];
  attacks: AttackDef[];
  brains: BrainDef[];
  statusEffects: StatusEffectDef[];
  feedback: FeedbackDef[];
  particlePresets: ParticlePresetDef[];
  factions: FactionDef[];         // a new project seeds player, hostile, neutral
  variables: VariableDef[];
  inputActions: InputActionDef[];
  triggers: TriggerDef[];         // global triggers; region events are allowed only on map triggers
}

interface ProjectSettings {
  playerArchetypeId: Id<'archetype'>; // spawned at the start map's playerStart; Phase 11 presets replace it
  msPerTurn: number;              // default 3000; read only in stepped mode
  hexSize: number;                // world units, center to corner; default 1
  levelHeight: number;            // world units per cliff level; default 0.5
  maxLevel: number;               // 1..15; default 15: Warcraft III's 16 levels (Q9)
  pixelsPerUnit: number;          // screen pixels per world unit at zoom 1; default 64
  sight: { uphillBlocked: boolean;      // default true (WC3 high ground)
           uphillRevealRange: number }; // world units; default 1.5
  friendlyFire: boolean;          // global default; Phase 18 adds per-source overrides
}
```

**Assets.** `AssetRef` is a struct from day one. Vector art is kept as SVG source and baked to atlases (Phase 3); the bake is derived and can always be rebuilt.

```ts
interface AssetRef {
  blobId: string;                 // lowercase hex SHA-256 of the DECODED bytes: the id is the hash
  mime: string;
  byteSize: number;
  width?: number; height?: number; durationMs?: number;
}
interface NamedAsset { id: Id<'asset'>; name: string; ref: AssetRef }
interface AssetManifest {
  vectorSources: NamedAsset[];    // SVG originals
  images: NamedAsset[];           // raster art used as-is
  atlases: AtlasDef[];            // baked output (Phase 3)
  audio: NamedAsset[];
}
interface AtlasDef {
  id: Id<'atlas'>; sourceIds: Id<'asset'>[];
  tiers: { scale: 1 | 2; image: AssetRef;
           frames: Record<string, { x: number; y: number; w: number; h: number;
                                    anchorX: number; anchorY: number }> }[];
}
interface FrameRef { atlasId: Id<'atlas'>; frame: string }
```

**Terrain and maps, with elevation.** Each hex has a terrain, a cliff level, and an optional ramp. Layers are packed typed arrays, stored as base64 in files.

```ts
interface TerrainDef {
  id: Id<'terrain'>; name: string;
  top: FrameRef;                  // the hex top
  cliff?: FrameRef;               // side-face art; default is a neutral engine face
  passable: { walk: boolean; swim: boolean; fly: boolean }; // read by P4 passability
  moveCost: number;               // A* multiplier, >= 1
  blocksSight: boolean;           // default: !walk && !swim
  blocksProjectiles: boolean;     // default: blocksSight
  contact?: { everyMs: number; actions: Action[] }; // lava; read by P4 terrain contact
}

type HexDir = 1 | 2 | 3 | 4 | 5 | 6; // the six neighbors, in the ported module's order

interface MapDef {
  id: Id<'map'>; name: string;
  width: number; height: number;  // offset-coordinate rectangle; each <= 256
  terrainPalette: Id<'terrain'>[]; // the terrain layer stores palette indices
  layers: {
    terrain: Uint16Array;         // length width*height
    level: Uint8Array;            // 0..maxLevel
    ramp: Uint8Array;             // 0 = none; 1..6 = the HexDir the ramp rises toward
  };
  playerStart?: { x: number; y: number; facing: number }; // required on the start map
  placements: EntityPlacement[];  // never the player: it spawns from playerArchetypeId
  regions: RegionDef[];
  triggers: TriggerDef[];         // map-scoped; the only place region events are allowed
  bgm?: Id<'asset'>;
}

interface EntityPlacement {
  key: Id<'placement'>;           // stable identity; saves refer to it
  archetypeId: Id<'archetype'>;
  x: number; y: number;           // world plane; z is derived from the surface
  facing: number;                 // radians
  overrides?: Partial<ComponentData>;
}
interface RegionDef { id: Id<'region'>; name: string; cells: Int16Array } // packed (q, r) pairs
```

**Entities by composition.** An archetype is a reusable bundle of components. A component's presence is what gives an entity the behavior.

```ts
type MovementMode = 'walk' | 'swim' | 'fly';

interface ArchetypeDef { id: Id<'archetype'>; name: string; tags: string[]; components: ComponentData }

interface ComponentData {
  collider?:   { radius: number; height: number; solid: boolean }; // an upright cylinder
  movement?:   { speed: number; turnRate: number; modes: MovementMode[]; startMode: MovementMode };
  motion?:     { mass: number; friction: number };   // knockback response
  health?:     { max: number };
  faction?:    { factionId: Id<'faction'> };
  sight?:      { range: number; eyeHeight: number };
  acquisition?:{ range: number; forgetMs: number };
  attacker?:   { attackIds: Id<'attack'>[] };
  dodge?:      { distance: number; durationMs: number; iframeMs: number; cooldownMs: number };
  brain?:      { brainId: Id<'brain'> };      // leashing is a brain transition (P4)
  sprite?:     { animationSetId: Id<'animset'>; scale?: number };
  feedback?:   { onHurt?: Id<'feedback'>; onDeath?: Id<'feedback'> };
  interactable?: { radius: number; prompt: string };
  playerControlled?: {};          // receives the InputFrame
  persistent?: {};                // survives map changes (the player; later, companions)
  onDeath?:    { actions: Action[]; despawnAfterMs: number };
}
```

**Animation.** The simulation decides which clip is playing and how far in; the renderer draws that frame.

```ts
interface AnimationSetDef {
  id: Id<'animset'>; name: string; atlasId: Id<'atlas'>;
  directions: 1 | 4 | 6 | 8;      // renderer picks the nearest to facing
  mirror: boolean;                // left-facing directions drawn by flipping
  clips: Record<string, ClipDef>;
  stateClips: { idle: string; move: string; dodge: string; hurt: string; death: string };
}
interface ClipDef {
  frames: string[][];             // [direction][frame] -> atlas frame name
  frameMs: number; loop: boolean;
  cues?: { frame: number; feedbackId: Id<'feedback'> }[]; // footsteps, swooshes; presentation only
}
```

**Attacks.** One definition serves the player and enemies. Windup is the telegraph.

```ts
interface AttackDef {
  id: Id<'attack'>; name: string;
  windupMs: number; activeMs: number; recoveryMs: number; cooldownMs: number;
  hitbox:
    | { shape: 'arc';    range: number; arcDeg: number }
    | { shape: 'circle'; radius: number; offset: number }
    | { shape: 'line';   length: number; width: number };
  verticalReach: number;          // world units above and below the attacker's feet
  knockback: number;              // impulse along the attacker's facing
  hitstopMs: number;              // freezes attacker and victim on contact
  onHit: Action[];                // e.g. modify-health on the victim; Phase 7 swaps in deal-damage
  moveDuring: 'free' | 'slowed' | 'rooted';
  clips: { windup: string; active: string; recovery: string };
  feedback: { windup?: Id<'feedback'>; hit?: Id<'feedback'> };
  aiRange?: number;               // brains swing inside this; default = the hitbox's reach
}
```

**Effects, feedback, factions, variables, input.**

```ts
type Duration =
  | { kind: 'ms'; value: number }
  | { kind: 'turns'; value: number };   // via msPerTurn; Phase 14 adds 'game-minutes' and 'until'

interface StatusEffectDef {
  id: Id<'status'>; name: string;
  duration: Duration | null;            // null = permanent
  stackMode: 'refresh' | 'stack' | 'ignore' | 'independent';
  maxStacks?: number;                   // 'stack' only
  stackScope: 'per-source' | 'global';
  restricts?: ('move' | 'attack' | 'dodge' | 'act')[];  // a stun; Phase 6 adds block, sprint; Phase 10 adds cast
  flags?: ('invulnerable' | 'untargetable')[];           // i-frames
  periodic?: { interval: Duration; actions: Action[] };   // poison; Phase 7 makes it deal-damage
}   // Phase 6 adds `contribution`; Phase 10 adds `script`, `icon`, `dispellable`, `vfxClip`

interface FeedbackDef {
  id: Id<'feedback'>; name: string;
  flash?: { color: string; ms: number };          // sprite tint
  shake?: { amplitude: number; ms: number };      // camera; scaled by the player's preference
  particles?: { presetId: Id<'particles'>; count: number };
  sfx?: { assetId: Id<'asset'>; volume: number };
  groundIndicator?: { ms: number };               // draws the triggering attack's hitbox on the ground
}
interface ParticlePresetDef {
  id: Id<'particles'>; frame: FrameRef; lifetimeMs: number;
  speed: [number, number]; spreadDeg: number; gravity: number;
  scale: [number, number]; fadeOut: boolean;
}

interface FactionDef {
  id: Id<'faction'>; name: string;
  relations: Record<string, 'hostile' | 'neutral' | 'ally'>; // missing = neutral; self = ally
}

type VariableValue = boolean | number | string;
interface VariableDef {                 // Phase 12's design, adopted whole
  id: Id<'variable'>;                   // what conditions and actions store: renaming a key breaks nothing
  key: string;                          // [a-z0-9_]+, unique; what authors read
  name: string;
  type: 'bool' | 'number' | 'string'; initial: VariableValue;
  scope: 'save' | 'session' | 'global'; // global is reserved: treated as save, with a one-time log
  readonly: boolean;                    // a readonly variable is a constant
  description?: string; category?: string;
}   // Phase 13 adds scope 'conversation'

interface InputActionDef {
  id: Id<'input'>; name: string;
  kind: 'button' | 'axis2' | 'pointer';
  role?: 'move' | 'aim' | 'click' | 'attack-primary' | 'attack-secondary' | 'dodge' | 'interact';
  defaultBindings: string[];      // KeyboardEvent.code values, e.g. 'KeyW', 'Space'; 'Mouse0'
}
```

**Brains, triggers, conditions, actions.** These are the full foundation vocabularies. Phase 12 later adds an editor and usage view, not new machinery.

```ts
type EntityMatch =
  | { by: 'player' } | { by: 'subject' } | { by: 'other' } | { by: 'any' }
  | { by: 'placement'; key: Id<'placement'> } | { by: 'tag'; tag: string }
  | { by: 'archetype'; archetypeId: Id<'archetype'> }
  | { by: 'faction'; factionId: Id<'faction'> };

interface BrainDef {
  id: Id<'brain'>; name: string; initial: string;
  states: { id: string;
            behavior:
              | { kind: 'idle' } | { kind: 'wander'; radius: number }
              | { kind: 'patrol'; regionId: Id<'region'> }
              | { kind: 'chase' } | { kind: 'return-home' }
              | { kind: 'attack'; attackIds: Id<'attack'>[]; pick: 'sequence' | 'random' }
              | { kind: 'flee'; distance: number };
            onEnter?: Action[];
            transitions: { to: string; when: Condition[]; afterMs?: number }[] }[];
}

interface TriggerDef { id: Id<'trigger'>; when: EventPattern; given: Condition[];
                       then: Action[]; once: boolean; enabled: boolean }

type EventPattern =                     // later phases add the events their systems emit
  | { type: 'map-loaded' } | { type: 'map-unloaded' }
  | { type: 'region-entered' | 'region-exited'; regionId: Id<'region'>; who: EntityMatch }
  | { type: 'interacted'; target: EntityMatch }
  | { type: 'attack-hit'; attacker: EntityMatch; victim: EntityMatch }
  | { type: 'health-crossed'; who: EntityMatch; belowFraction: number }   // boss phases
  | { type: 'entity-died'; who: EntityMatch }
  | { type: 'entity-spawned'; who: EntityMatch }
  | { type: 'brain-state-entered'; who: EntityMatch; state: string }
  | { type: 'variable-changed'; variableId: Id<'variable'> }
  | { type: 'timer-fired'; timerId: string }
  | { type: 'jump-landed'; who: EntityMatch };

type Comparator = '<' | '<=' | '==' | '!=' | '>=' | '>';
type Condition =                        // later phases add conditions over the state they own
  | { type: 'all' | 'any'; of: Condition[] } | { type: 'not'; of: Condition }
  | { type: 'variable'; variableId: Id<'variable'>; comparator: Comparator; value: VariableValue }
  | { type: 'chance'; probability: number }                          // seeded RNG
  | { type: 'alive'; who: EntityMatch }
  | { type: 'count-alive'; who: EntityMatch; comparator: Comparator; value: number }
  | { type: 'in-region'; who: EntityMatch; regionId: Id<'region'> }
  | { type: 'health-fraction'; who: EntityMatch; comparator: Comparator; value: number }
  | { type: 'has-target' } | { type: 'target-within'; distance: number } // brain-local
  | { type: 'away-from-home'; distance: number }                           // brain-local leash
  | { type: 'relation'; a: Id<'faction'>; b: Id<'faction'>; is: 'hostile' | 'neutral' | 'ally' };

type VariableOp =
  | { kind: 'set'; value: VariableValue }
  | { kind: 'add'; value: number }      // numbers only; strings never concatenate
  | { kind: 'toggle' }                  // bools only
  | { kind: 'set-from'; sourceVariableId: Id<'variable'> };

type Action =                           // later phases add actions over the state they own
  | { type: 'set-variable'; variableId: Id<'variable'>; op: VariableOp }
  | { type: 'modify-health'; target: EntityMatch; delta: number }   // authored, non-combat
  | { type: 'apply-effect' | 'remove-effect'; target: EntityMatch; statusId: Id<'status'> }
  | { type: 'apply-impulse'; target: EntityMatch; strength: number; away: 'other' | 'facing' }
  | { type: 'spawn'; archetypeId: Id<'archetype'>; at: Id<'region'> | 'subject'; count: number }
  | { type: 'despawn'; target: EntityMatch }
  | { type: 'teleport'; target: EntityMatch; mapId: Id<'map'>; x: number; y: number }
  | { type: 'set-brain-state'; target: EntityMatch; state: string }
  | { type: 'set-trigger-enabled'; triggerId: Id<'trigger'>; enabled: boolean }
  | { type: 'start-timer'; timerId: string; ms: number; repeat: boolean }
  | { type: 'play-feedback'; target: EntityMatch; feedbackId: Id<'feedback'> }
  | { type: 'play-sfx'; assetId: Id<'asset'> }
  | { type: 'change-bgm'; assetId: Id<'asset'> | null; fadeMs: number }
  | { type: 'show-message'; text: string; ms: number }
  | { type: 'scripted-jump'; target: EntityMatch; to: { x: number; y: number };
      durationMs: number; apex: number; clip?: string }   // Q7: the only way anything jumps
  | { type: 'end-session'; outcome: 'victory' | 'defeat' };
```

Brain-local conditions are rejected by the validator outside a brain transition, so they cannot be authored where nothing evaluates them.

### 4.6 Validation

The validator runs on every load and import, and rejects rather than repairs:

- **Version:** schema 1 is rejected with a message naming v0.6.0; an unknown major or a newer minor is rejected with "made with a newer LoreBrix".
- **References:** every id resolves; palette indices are in range; layer lengths equal `width × height`.
- **Ranges:** levels at most `maxLevel`; durations non-negative; `probability` in 0..1; fractions in 0..1.
- **Placement:** brain-local conditions only inside brains; `teleport` only to existing maps.

**Seeds and spawn.** A new project seeds three factions, `player`, `hostile`, and `neutral`, so no project starts in an invalid state. `playerArchetypeId` must resolve, and the start map must have a `playerStart`.

**Vocabulary ownership.** Each later phase adds the events, conditions, and actions over the state it owns (Phase 8 adds `has-item`, Phase 14 the time events). Nothing is authorable before something can make it true.

Ramp *correctness* (does it lead anywhere) is a map lint in Phase 3, reported as warnings, because an unfinished map is still a valid file.

### 4.7 Signature tests

- ★ **Reader coverage.** Every authored leaf field has a reader manifest entry with a test id. Adding a field without one fails CI.
- ★ **Boundary.** `runtime` compiles with no DOM library, and its import graph contains only `schema`, `hexmath`, and `algorithms`.
- **Version gate.** A v0.6.0 file is rejected with the named message; nothing is half-parsed.
- **Round trip.** Emberfall validates, serializes, and re-validates byte-identical.
- **Ported modules.** The hex math suite (about 12,000 numerical cases) and the A\* and spatial hash suites pass unchanged.

## 5. Phase 2 — Runtime Core

Phase 2 is the engine with nothing to look at: a headless, deterministic loop that runs triggers, conditions, actions, variables, and saves, tested entirely in Node.

**Depends on:** P1 (schema, types) · **Blocks:** P3, P4, P5 · **Effort:** Extra High · **Chunks:** one

### 5.1 Goal

At the end of Phase 2, the same project, save, and recorded input stream produce the same state hash on every run, and a save taken mid-run resumes to the identical result.

### 5.2 Non-goals

| Deferred | Owner |
| --- | --- |
| Calendar, time of day, wait and sleep | Phase 14 |
| Variables editor and usage view | Phase 5 (basic), Phase 12 (usage view) |
| Save slot UI, character creation, title screen | Phase 11 |
| Player key rebinding UI | Phase 11 |
| `projectVersionId` and version reconciliation | Phase 11 writes it, Stage 3 reads it |
| Cloud storage | Phase 26 |

### 5.3 The central decision: the client drives ticks, the runtime owns time

The runtime exposes one way to move time: `tick(input)`, which advances exactly one 1/60 s step. The client keeps the accumulator, calls `tick` as many times as real time requires (at most 5 per frame, so a stall never spirals), and renders with the leftover fraction as interpolation.

This keeps every source of nondeterminism outside the runtime: wall clock, frame rate, and device input all arrive as one quantized `InputFrame` per tick.

```ts
interface Runtime {
  tick(input: InputFrame): void;            // exactly one step; no-op in stepped mode without pending steps
  enqueue(cmd: RuntimeCommand): void;       // UI-driven changes; applied at the start of the next tick
  requestSteps(n: number): void;            // stepped (turn-based) mode only
  snapshot(): SaveState;                    // only between ticks
  readonly view: RuntimeView;               // read-only; what render and audio import
  dispose(): void;
}
createRuntime(project: Project, save: SaveState | null, opts: { seed: number; clockMode: 'continuous' | 'stepped' }): Runtime;
```

**Stepped mode** is the turn-based seam. In it, `tick` advances only while steps are pending. The action game never enables it; a test proves the mode works so turn-based is not foreclosed.

**Commands.** Anything the UI changes in the game (equip a sword, use a potion, pick a dialogue line) never calls into the runtime directly. The client enqueues a `RuntimeCommand`; the runtime applies queued commands at step 1 of the next tick, in enqueue order, and records them beside the input frames, so replays and repro files reproduce menu actions too. F ships the channel and a test-only command; each later phase adds its own (Phase 7 `equip`, Phase 8 `use-item`, Phase 13 `dialogue-choose`).

### 5.4 Tick order

One fixed order, documented and tested. Changing it is a design change, not a refactor.

1. Apply queued runtime commands
2. Apply input to player-controlled entities
3. Brains choose intents (P4)
4. Attack and dodge state machines advance (P4)
5. Movement, collision, and knockback resolve (P4)
6. Attack contact is detected (P4)
7. Active effects tick (P4)
8. Health changes apply; deaths are raised (P4)
9. Terrain contact fires (P4)
10. Animators advance (P4)
11. Timers fire
12. Queued events dispatch to triggers

Steps 3–10 belong to Phase 4, and Phase 6 adds one slot after step 7 for resource regeneration. Phase 2 ships the scheduler with those slots empty and tested in order.

### 5.5 Events

Events raised during a tick are queued, then dispatched in step 12 in raise order. Actions run by a trigger may raise more events; those dispatch in a further round, **at most 8 rounds per tick**. Anything still queued after round 8 carries to the next tick and records a diagnostic, so a trigger loop slows down instead of hanging the game.

- **Queue cap:** 4,096 events per tick. Overflow drops the newest and increments a diagnostic counter.
- **Scoped subscriptions:** every subscription belongs to a scope (session or map). Disposing a scope removes its subscriptions; nothing can subscribe without one.
- **Matching order:** triggers are evaluated in authored order; `EntityMatch` resolves entities in ascending entity index. Both are part of determinism.

### 5.6 Conditions and actions

**One `ConditionEvaluator`** evaluates every condition everywhere: triggers, brain transitions, and later dialogue and quests. It short-circuits `all` and `any`, and `chance` draws from the RNG only when actually evaluated.

**One `ActionExecutor`** runs every action list. Handlers are registered by type; Phase 2 registers the variable, timer, trigger, message, session, and audio-request actions, and Phase 4 registers the entity actions. Each action receives a context of `subject` (the event's entity), `other` (the second entity, when there is one), and the current map.

Audio actions (`play-sfx`, `change-bgm`) do not touch audio. They raise presentation events that the mixer subscribes to, so the runtime stays headless.

### 5.7 Variables

The `VariableStore` is built from `VariableDef`s at session start.

- Writing a `readonly` variable is rejected with a diagnostic; the value does not change.
- `variable-changed` fires only when the value actually changes.
- `save` scope persists into the save; `session` scope resets on load.
- Type mismatches (a string into a number) are rejected, never coerced.

Conditions and actions reference a variable by `id`; `key` is only what authors read, so renaming a variable never breaks a reference. Scope `global` is reserved for a future account-level store; until then it behaves as `save` and logs once.

### 5.8 Randomness and numbers

- **RNG:** xoshiro128\*\*, seeded through SplitMix32 from a 32-bit seed. Its four-word state is saved.
- **One simulation stream** serves brains, `chance`, and spawns. Presentation (particles, shake) uses its own generator that never touches the simulation.
- **`Math.random` is banned in `runtime`** by lint rule.
- **Numbers are JavaScript doubles.** Determinism is guaranteed on the same build and browser engine, which is all a single-player game needs. Cross-engine bit-identity is not a goal.

### 5.9 Input frames

The client turns devices into one `InputFrame` per tick using the project's `InputActionDef` bindings. The runtime never sees a key code.

```ts
interface InputFrame {
  move: { x: number; y: number };       // -1..1, quantized to 1/127 (WASD); cancels a click order
  aim: { x: number; y: number } | null; // the cursor on the world plane, quantized to 1/64 unit
  order: ClickOrder | null;             // a click this tick (section 7.9b)
  pressed: number;                      // bitmask of roles pressed this tick
  held: number;                         // bitmask of roles held
}
type ClickOrder =
  | { kind: 'ground'; x: number; y: number }   // height-aware terrain pick, quantized
  | { kind: 'entity'; entity: EntityId };      // front-most entity under the cursor
```

Quantizing makes a frame stream recordable and replayable, which is how the determinism tests work and how bugs get reproduced.

### 5.10 The save boundary

A save is a sparse record of what play changed. It never contains authored data, and the project never contains play state.

```ts
interface SaveState {
  header: { schemaVersion: 2; projectId: string; contentRevision: number; savedAt: string;
            kind: 'manual' | 'auto' | 'playtest' };   // playtest saves live in memory only
  rng: [number, number, number, number];
  tick: number;                       // the one elapsed clock; Phase 14 adds skippedMs
  clockMode: 'continuous' | 'stepped';
  currentMapId: string;
  variables: Record<string, VariableValue>;   // variable id -> value; save scope only
  timers: { id: string; ticksLeft: number; repeatTicks: number | null }[];
  triggers: { fired: string[]; enabled: Record<string, boolean> }; // once-fired and toggled
  persistent: SerializedEntity[];     // entities with the persistent component (the player)
  maps: Record<string, {
    removed: string[];                // placement keys gone (killed, despawned, taken)
    changed: Record<string, ComponentPatch>; // placement key -> changed component fields
    spawned: SerializedEntity[];      // runtime-spawned entities still alive
  }>;
}   // later phases add blocks: Phase 8 shop states, Phase 11 hotbar, Phase 13.5 quests
```

- **The current map** saves full mutable state for its entities: positions, motion, attack phase, cooldowns, effects with time left.
- **Other maps** keep only what lasts: who is gone, health, and spawned survivors. Their entities return to their placed positions on re-entry. This is the common ARPG behavior and keeps old maps cheap.
- **Runtime-only entities** (particles, future projectiles) are never saved.
- **Content changed since the save:** in Stage 1, the save loads with a warning, and deltas for placements that no longer exist are dropped and reported.

### 5.11 Storage

The `storage` package persists projects, saves, and blobs in IndexedDB. The runtime never imports it.

| Store | Key | Rule |
| --- | --- | --- |
| `projects` | project id | One document per project |
| `saveMeta` | save id, indexed by project id | Small rows the save list reads: name, kind, time, location. An unlimited list never touches save bodies. |
| `saveData` | save id | The `SaveState` body, read only on load. Manual saves uncapped; autosaves roll, default 3. |
| `blobs` | SHA-256 of the decoded bytes | Content-addressed and deduplicated; `BlobStore.put` returns an `AssetRef` |
| `prefs` | `'user'` | Player preferences: shake, flashing, volumes. Phase 11 adds bindings and `playthroughs` as a sixth store. |

A project exports as one `.loreengine` file: `project.json` plus its blobs, zipped. A save exports as JSON. Hashing falls back to a pure-JS SHA-256 where \`crypto.subtle\` is unavailable (a non-secure origin), and blobs nothing references are pruned when the project saves.

### 5.12 Signature tests

- ★ **Replay determinism.** Emberfall with a recorded 10,000-tick input stream produces the same state hash on three runs.
- ★ **Save resume.** Saving at tick 5,000, loading, and finishing the stream yields the same final hash as the uninterrupted run.
- **Stepped mode.** No tick advances without a requested step; `requestSteps(3)` advances exactly three.
- **Evaluator and executor.** One test per condition variant and per Phase 2 action.
- **Cascade cap.** A trigger that re-raises its own event stops at 8 rounds and resumes next tick.
- **Variables.** Readonly writes and type mismatches are rejected; unchanged writes raise no event.
- **Storage.** Manual saves are never capped; the fourth autosave evicts the oldest; a schema 1 save is rejected.

## 6. Phase 3 — World, Elevation & Presentation

Phase 3 gives the world its shape and the game its look and sound. One elevation model answers three questions, can I walk there, can I see there, and what is drawn in front, so the three can never disagree.

**Depends on:** P1 (map and asset types), P2 (scopes, events, view) · **Blocks:** P4, P5 · **Effort:** Extra High · **Chunks:** two (3A world, 3B presentation)

### 6.1 Goal

At the end of Phase 3, Emberfall's terrain renders in hex-iso with cliffs and ramps, clicking a raised hex selects that hex, maps load and unload without leaking, vector art bakes to atlases, and the feedback and audio systems respond to events.

### 6.2 Non-goals

| Deferred | Owner |
| --- | --- |
| Day and night (the tint seam ships here, unused) | Phase 14 |
| Weather, seasonal tile variants | Phase 22 |
| Ambience, distance attenuation | Phase 19 |
| World map, fast travel | Phase 15 |
| Authored flight altitude, swimming behavior | Phase 21 |
| Skeletal animation rigs | Q4 |

### 6.3 The central decision: one elevation model, three consumers

Every hex is a column. Its height comes from its cliff level; a ramp tilts its top so it rises one level toward one neighbor. Passability, sight, and rendering all read the same two runtime queries, so a cliff that blocks walking always blocks sight and is always drawn.

**Edge heights.** Each of a cell's six edges has a height, in levels:

| Cell | Edge toward the rise | Opposite edge | The four side edges |
| --- | --- | --- | --- |
| Flat, level L | L | L | L |
| Ramp, level L, rising toward d | L + 1 | L | sloped |

**Connection rule.** Two neighboring cells connect across their shared edge when both edges are flat and at the same height, or both are sloped edges of ramps with the same level and direction (a wide ramp). Everything else is a cliff.

That single rule covers flat ground, walking up and down a ramp, wide ramps, ramps stacked to climb two levels, and stepping off a ramp's side (blocked). It is table-tested.

**Surface height.** On a flat cell, `level × levelHeight`. On a ramp, height rises linearly along the ramp's direction from its low edge to its high edge, so it is continuous across every connecting edge: no steps, no seams.

```ts
// runtime/world — headless, used by P4 and the renderer
cellAt(x: number, y: number): number;                 // cell index, or -1 off map
surfaceHeight(x: number, y: number): number;          // world units
edgeHeight(cell: number, dir: HexDir): number | 'sloped';
connects(a: number, b: number, mode: MovementMode): boolean;
```

**Movement modes.** `walk` uses the connection rule on cells passable for walking. `swim` uses the same rule on swimmable cells; water surface is the cell's level. `fly` ignores edge heights and is blocked only by terrain with `passable.fly` false; flyers hold two levels above the surface beneath them. Phase 21 makes that clearance authored and adds flight behavior.

### 6.4 Map lint

Warnings, shown in the editor (Phase 5), never load failures:

- A ramp whose high edge meets no cell at the next level up
- Walkable areas unreachable from the player's start
- A placement on impassable terrain, or with its collider overlapping a cliff edge
- A region with no cells

### 6.5 Map lifecycle and cross-map teleport (3A)

This was v0 Phase 15A. It lands here because saves, dungeon entrances, and the persistent player all need it.

- **Load:** build the cell arrays, spawn placements minus the save's `removed`, apply `changed`, add `spawned`, open a map scope, raise `map-loaded`.
- **Unload:** write the map's lasting delta into the save, then dispose the map scope, which releases its entities, subscriptions, and timers.
- **Teleport across maps:** unload, load, and move every `persistent` entity across with its effects and cooldowns intact. Within a map, `teleport` just moves.

**Spawning the player.** A new session spawns `playerArchetypeId` at the start map's `playerStart`. The player is never a placement, so reloading the start map cannot create a second one; it is `persistent` and travels in the save. Unload raises `map-unloaded` before disposing the scope, so global triggers can react.

### 6.6 Rendering (3B)

The renderer is PixiJS on WebGL (Q3). It reads the runtime view and never writes it.

**Projection.** The ported hex-iso projection places `(x, y)`; height lifts the point by `z × pixelsPerUnit × zoom` screen pixels.

**Terrain as meshes.** Each hex top is drawn as a seven-vertex mesh (center plus six corners), each vertex lifted by the surface height there. Ramps therefore render correctly from the same top texture, with no per-direction ramp art. Cliff faces are quads between a cell's edge height and its neighbor's, tiled with the terrain's `cliff` frame, drawn only on the camera-facing edges. Geometry is built per row strip and rebuilt only when the map is edited.

**Depth order.** The draw list is row strips, back to front. Each entity is inserted after the strip containing its feet; within a strip, terrain first, then entities by foot screen position. So a unit behind a cliff is covered by the cliff's face, and a unit on the plateau draws over the ground below it. This is the riskiest piece in the foundation; it is prototyped first (section 10).

**Occlusion silhouette.** When terrain in front covers the player, a tinted silhouette of the player is drawn through it, masked to the covered part. Capped at 4 entities with a silhouette (the player now; companions later).

**Height-aware picking.** The view ray from the cursor is marched down from the top level to level 0 in quarter-level steps; the first column the ray enters is the pick. Clicking a plateau selects the plateau, not the low hex under its flat footprint; clicking a cliff face selects the column it belongs to, and click-to-move then routes there by the ramp.

**Interpolation and culling.** Positions are interpolated between the previous and current tick by the client's leftover fraction; a teleport skips it. Only strips and entities on screen are drawn.

**Camera.** Follows the player with a deadzone; zoom 0.5 to 2.0; the atlas tier used is the smallest at or above the zoom.

**Tint seam.** `setWorldTint(rgb)` multiplies the scene. Nothing calls it until Phase 14.

**Assets.** The renderer resolves `AssetRef`s through a resolver the client injects. It never imports `storage`, so swapping the storage backend later changes no renderer code.

### 6.7 Vector art pipeline

Vector art is baked, not drawn live, because thousands of SVG paths per frame would cost far more than one batched atlas.

1. Import a folder or zip of SVGs. A frame's name is its path, e.g. `knight/attack-swing/dir2/03.svg`.
2. Rasterize each at 1× and 2× of `pixelsPerUnit`, in the browser.
3. Read the anchor from an element with `id="anchor"`; default is bottom center.
4. Pack into atlas pages of at most 4096 × 4096, store pages through `BlobStore`, and write the `AtlasDef`.

Sources stay in the project, so changing `pixelsPerUnit` or adding a tier is a re-bake, never re-drawing.

### 6.8 Animation playback

The runtime's animator (Phase 4) says which clip, which frame, and which facing. The renderer maps facing to the nearest of the set's `directions`, flips when `mirror` is on, and draws the atlas frame. Clip `cues` raise presentation events at their frame.

### 6.9 Game feel, presentation side

The feedback system subscribes to presentation events and plays `FeedbackDef`s:

| Event | Feedback played |
| --- | --- |
| Attack windup starts | `attack.feedback.windup`; its `groundIndicator` draws the attack's hitbox on the ground (the telegraph) |
| Attack hits | `attack.feedback.hit` on the victim, then the victim's `onHurt` |
| Entity dies | its `onDeath` |
| Clip cue, `play-feedback` | the named feedback |

- **Flash** tints the sprite for its duration.
- **Shake** sums active shakes with decay, capped at 0.5 world units of offset.
- **Particles** come from a preallocated pool of 1,024; when it is full, new bursts are skipped, never allocated.
- **Hitstop** needs nothing here: the runtime freezes the animator, so the pose holds.

**Player preferences** (the player's, never the project's): screen shake off, half, or full; flashing replaced by an outline; three volumes. Stored in the prefs store (section 5.11), separate from projects and saves.

**HUD.** A DOM overlay in the `player` package: player health, health bars over damaged entities, the interact prompt, and `show-message` toasts.

### 6.10 Audio

The `audio` package is a Web Audio mixer with master, music, and effects buses.

- Starts suspended; resumes on the first user gesture, because browsers block autoplay.
- On map load, preloads the map's music and every sound its archetypes' attacks and feedback reference.
- A sound not yet decoded is skipped, never awaited, so audio can never stall a frame.
- At most 24 voices; the oldest is stolen.
- `change-bgm` crossfades over its `fadeMs`.

### 6.11 Signature tests

- ★ **Connection table.** Every pairing in the edge-height table, plus wide ramps, stacked ramps, and ramp sides, returns the expected `connects` result for each movement mode.
- ★ **Height-aware picking.** On the elevation fixture, points over a plateau's top return the plateau cell; points over its cliff face return the plateau's column; points over low ground return low ground.
- ★ **Depth order.** For fixture scenes (unit behind a cliff, unit on a plateau edge, unit on a ramp), the renderer's draw list puts each entity in the expected position. Tested on the draw list, so it runs without a GPU.
- **Continuity.** `surfaceHeight` has no jump across any connecting edge, sampled at 1,000 points.
- **Lifecycle leak gate.** 100 load and unload cycles return entities, subscriptions, and timers to baseline.
- **Read-only renderer.** The runtime state hash is unchanged after 1,000 rendered frames.
- **Mixer.** Stays suspended until a gesture; skips undecoded sounds; never exceeds 24 voices.
- **Bake.** The SVG fixture produces every named frame with its authored anchor.

## 7. Phase 4 — Entities & Simulation

Phase 4 makes the world play: entities move over cliffs and ramps, see and lose each other by Warcraft III high-ground rules, and fight with telegraphed attacks, dodges, knockback, and hitstop.

**Depends on:** P1 (component types), P2 (tick slots, executor, events), P3 (world queries, map scopes) · **Blocks:** P5, Phase 6 onward · **Effort:** Extra High · **Chunks:** two (4A movement, sight, brains; 4B combat, effects)

### 7.1 Goal

At the end of Phase 4, the Emberfall fixture plays headless: a player walks up a ramp, an archer-style enemy on a plateau spots them first, a mini-boss telegraphs, the player dodges through a swing, and the boss changes behavior at half health.

### 7.2 Non-goals

| Deferred | Owner |
| --- | --- |
| Stats, stamina, costs on dodge and attacks | Phase 6 |
| Jump | Phase 6, with sprint and block (Q7) |
| Stagger and poise | Unowned; a candidate for Phase 6 (E to decide) |
| The damage pipeline (`deal-damage`) | Phase 7 |
| Pickups and loot | Phases 8 and 9 |
| Projectiles, skills, casting | Phase 10 |
| Neutral turning hostile when struck, standing | Phase 18 |
| Encounter state machine, non-lethal defeat | Phase 16 |
| Crowds, companions | Phases 20B, 20.5 |
| Falling off ledges | Q7 |

### 7.3 The central decision: data-oriented composition

An entity is a 32-bit id: 16 bits of index, 16 of generation. A stale id fails `isAlive`; it never resolves to the wrong entity. Components live in sparse sets; the hot ones (transform, motion, health) are struct-of-arrays in `Float64Array`s so the tick touches contiguous memory and allocates nothing.

- **Cap:** 8,192 live entities.
- **Despawns are deferred** to the end of the tick, so no system ever iterates a list that changes under it.
- **Spawning** builds an entity from an archetype plus its placement overrides.

Runtime-only state sits beside the authored components:

```ts
Transform     { x, y, z, facing; prevX, prevY, prevZ }   // prev* feed render interpolation
MotionState   { vx, vy, hitstopTicks }                   // knockback velocity
PathState     { waypoints: Float64Array(128); count; index; repathAt }
AttackState   { attackId; phase: 'windup' | 'active' | 'recovery'; ticksLeft; hitSet: Int32Array(16) }
Cooldowns     { attack: Map<attackId, ticks>; dodge: ticks }
DodgeState    { ticksLeft; dirX; dirY }
HealthState   { current }
ActiveEffects { list of up to 32: effectId, ticksLeft, stacks, sourceId, nextPeriodicTick }
BrainState    { stateId; enteredTick; target; lastSeenTick; homeX; homeY; patrolIndex }
AnimatorState { clip; ticksIntoClip; frame }
```

### 7.4 Movement and collision

**Intent.** The player's intent comes from the input frame: a move vector (screen-relative, converted to the world plane) or a click-to-move target, which requests a path. Facing turns toward the aim point when there is one, otherwise toward movement. Brains produce the same kind of intent.

**Speed** is `movement.speed`, scaled to 40% during an attack marked `slowed`, and to zero when `rooted`, restricted from moving, or in hitstop.

**Resolving a move** each tick:

1. Displacement = intent velocity + knockback velocity, split into two substeps when longer than the collider radius.
2. The collider circle is tested against **blocked edges**: every shared edge where `connects` is false for the entity's mode. These are precomputed per map as segments.
3. On contact the move slides along the edge; the normal component is removed.
4. Walkers and swimmers then take `z = surfaceHeight(x, y)`.

**Separation.** Overlapping solid colliders whose height ranges also overlap are pushed apart by their overlap, weighted by `motion.mass`, in one pass per tick. Entities on different levels do not push each other.

**Knockback** adds velocity of `strength / mass` away from the source; `friction` decays it every tick. Knockback obeys the same blocked edges, so an entity knocked toward a cliff slides along it. Nothing falls in the foundation.

**Hitstop** freezes an entity's motion, attack and dodge timers, and animator for its ticks. Effects keep ticking.

### 7.5 Pathfinding

The ported A\* runs over cells, with neighbors filtered by `connects` for the requester's mode and costs scaled by `moveCost`. The result is string-pulled into straight runs wherever the straight line crosses only connecting edges.

- **Budgets:** at most 4,096 node expansions per request; at most 256 cells per path; at most 8 requests per tick, with the rest queued to the next tick in request order.
- **Repath** when blocked for more than 0.5 s, or when a chased target has moved more than 1 world unit.

### 7.6 Height-aware sight

**One 3D segment cast** serves sight now and projectiles and skill targeting in Phase 10.

```ts
castSegment(from: Vec3, to: Vec3, opts: {
  mode: 'sight' | 'projectile';      // which terrain flag blocks
  ignore?: EntityId; hitEntities: boolean;
}): { hit: 'none' | 'terrain' | 'entity'; t: number; cell?: number; entity?: EntityId };
```

It walks the cells under the segment with the ported hex line. In each cell it blocks if the segment passes below the column's surface, or if the terrain blocks that mode (such terrain acts as an infinitely tall wall). Entity hits test each collider cylinder along the way.

**Can A see B?**

1. B is within A's `sight.range`, and B is not untargetable.
2. A segment from A's eye (`z + eyeHeight`) to B's center is not blocked.
3. **High ground:** when `uphillBlocked` is on and B stands on a higher level than A, B must also be within `uphillRevealRange`.

So an archer on a plateau sees down, and the player below sees the archer only when close or after climbing.

### 7.7 Factions and acquisition

Relations come from `FactionDef.relations`: missing means neutral, a faction is always its own ally, and an entity with no faction is neutral to everyone.

An entity with `acquisition` scans every 6 ticks (10 per second), staggered by entity index so scans spread across ticks. It picks the nearest hostile it can see within range, ties broken by entity index. It keeps the target until the target dies, becomes untargetable, or goes unseen for `forgetMs`.

### 7.8 Attacks and telegraphs

The player and every enemy use the same attack state machine.

**Starting** needs: not attacking or dodging, not restricted from attacking, not in hitstop, and the attack off cooldown. Facing snaps to the aim point, the windup begins, and an `attack-windup` presentation event fires. That event is the telegraph: Phase 3 plays the windup feedback and draws the hitbox on the ground.

**During the active phase**, every tick, the hitbox (arc, circle, or line, relative to facing) is tested against nearby colliders. A victim is hit when all of these hold:

- It has health and is not the attacker.
- It is not an ally, unless `friendlyFire` is on.
- Its height range overlaps the attacker's feet plus or minus `verticalReach`.
- It does not carry the invulnerable flag.
- A segment from the attacker's chest to the victim's, cast in projectile mode, is not blocked, so no one hits through a cliff or a wall.
- It has not already been hit by this activation (at most 16 victims).

**On contact:** the `attack-hit` event fires; the `onHit` actions run with the attacker as `subject` and the victim as `other`; the victim takes knockback; both take hitstop.

Then recovery, then cooldown. The player's attack-primary and attack-secondary roles use the archetype's first and second attacks.

### 7.9 Dodge

Pressing dodge, when not restricted and off cooldown, starts a dash of `distance` over `durationMs` along the move input, or facing if there is none. It is allowed from idle, movement, and attack recovery, but not during windup or active frames.

The dash applies an engine-owned effect with the invulnerable flag for `iframeMs`. Using the effect system, rather than a dodge-only check, means anything else that grants invulnerability later works the same way. The dash collides like normal movement, so it stops at cliffs.

### 7.9b Click orders (Q5, decided)

E chose Diablo-style point and click, with WASD also moving. One click becomes one **order**, and the runtime carries it out over as many ticks as it takes.

| Click on | Order |
| --- | --- |
| A hostile entity with health | **Attack:** path into range of the attack-primary attack, face, swing; repeats while the button is held |
| An entity with `dialogue` (Phase 13) | **Talk** |
| An entity with `pickup` (Phase 8) | **Pick up** |
| An entity with `interactable` | **Use:** raises `interacted` |
| A non-hostile `destructible` (Phase 13) | **Attack** |
| Any other entity | Move next to it |
| Terrain | **Move there**; holding the button re-issues the order every 6 ticks, as in Diablo |

The first matching row wins. Rows that name a later phase's component do nothing until that phase adds it, because no entity can carry the component before then.

**One resolver for click and hover.** A single pure function in `runtime` decides what a click on an entity would do. The client calls it on hover to choose the cursor (sword, speech, hand, grab, arrow) and the outline highlight, so the cursor always tells the truth about the click.

**Carrying out an order.** The player's order state paths with A\* to within range (the attack's `aiRange`, or the interact radius), re-paths when the target moves more than 1 world unit, and then acts. It cancels when the target dies, becomes untargetable, or is unreachable (the player then stops at the closest reachable point), and when WASD or dodge is pressed. Clicking an enemy on a plateau routes up the ramp. The `act` restriction blocks talk, use, and pick up.

**Picking.** The client tests entities first, front-most in draw order against their sprite bounds, then falls back to the height-aware terrain pick (section 6.6). Entity ids are assigned deterministically, so recorded orders replay exactly.

**Feasibility: high.** It reuses A\*, attack start, and interact. The new pieces are client entity picking, the resolver, and order execution, which is effectively a brain for the player. It lands in chunk 5, with cursor art in chunk 7.

**Tests:** a click on an enemy above a ramp paths up the ramp and attacks; for every row, hover's cursor matches what the click does; WASD and dodge cancel an order; an unreachable click stops at the closest reachable point.

### 7.9c Scripted jumps (Q7, decided)

There is no jump button. E decided that jumping happens only when authored content says so: a ledge the player clicks, a trigger zone at a gap, a boss leaping off a balcony. All of them run one action, `scripted-jump`.

**What it does.** The target leaves the ground on a parabola from where it stands to `to`, peaking `apex` world units above the higher end, over `durationMs`. In flight it ignores cliffs, blocked edges, and collisions, so it can cross what walking cannot. It lands on the surface height at `to` and raises `jump-landed`.

**While airborne** the target carries an engine-owned status effect with the `invulnerable` flag and the `move`, `attack`, `dodge`, and `act` restrictions, the same mechanism as dodge i-frames. Click orders and WASD are ignored until it lands. The animator plays `clip` if given.

**Authoring the common cases:**

| Case | How |
| --- | --- |
| A ledge the player clicks | An archetype with `interactable`; a map trigger on `interacted` runs `scripted-jump` on the player (`subject`) |
| A gap the player walks into | A region; a trigger on `region-entered` runs `scripted-jump` |
| An enemy leaping down | A brain state whose `onEnter` runs `scripted-jump` on itself |

**Safety.** When the action fires, `to` must be on a walk-passable cell; otherwise the action fails with a diagnostic and nothing moves. The editor lint flags any authored `scripted-jump` whose landing is impassable.

**Known limit.** Pathfinding does not know about jump points, so clicking the far side of a gap walks to the nearest reachable point rather than jumping. **Backlog (E, 17 Nov):** jump links as pathfinding edges, so a click on the far side of a gap routes through the jump point. To be scheduled in the LoreEngine roadmap.

**Feasibility: high.** `Transform` already has `z`, the renderer already draws height, and the status effect is reused. It is one small system in chunk 6.

**Tests:** a jump crosses a cliff that A\* cannot; the target lands exactly on the surface; an attack during flight makes no contact; an impassable landing fails without moving anything; a recorded jump replays identically.

### 7.10 Health, death, and effects

- **`modify-health`** clamps to 0..max. `health-crossed` fires when health falls across a threshold that a trigger in the current map listens for.
- **At zero:** `entity-died` fires, every restriction applies, the death clip plays, `onDeath` actions run, the entity despawns after `despawnAfterMs`, and its placement key joins the save's `removed` list.
- **Player death** is handled by data, not by a hidden rule: every new project starts with a trigger "player died → end-session defeat" that the author may change.

**Active effects** follow their stacking mode, convert durations to ticks once, and cap at 32 per entity; at the cap, a new independent instance is refused with a diagnostic. Readers of each payload:

| Payload | Read by |
| --- | --- |
| `restriction: move` | Movement |
| `restriction: attack` | Attack start |
| `restriction: dodge` | Dodge start |
| `restriction: act` | Interact |
| `flag: invulnerable` | Attack contact |
| `flag: untargetable` | Acquisition and sight |
| `periodic` | Effect tick: runs its actions with the bearer as `subject` |

Equipment must never become an effect (carried forward for Phase 7: gear is a contribution, or unequipping becomes stateful).

**Terrain contact** runs a terrain's `contact` actions every `everyMs` while a walker stands on it, with the walker as `subject`.

**Interact** finds the nearest interactable within its radius in the front half-circle and raises `interacted`.

### 7.11 Brains

Each tick, a brain checks its current state's transitions in authored order. The first whose conditions hold, and whose `afterMs` has elapsed, wins: its target state's `onEnter` actions run and `brain-state-entered` fires.

| Behavior | Produces |
| --- | --- |
| `idle` | Nothing |
| `wander` | A seeded random point within the radius of home every 2 to 4 s |
| `patrol` | The region's cells in stored order, looping |
| `chase` | A path to the target |
| `attack` | Faces the target and starts an attack inside its `aiRange`, in sequence or seeded random order |
| `return-home` | A path home; the target is cleared |
| `flee` | Movement directly away from the target |

**Leashing** is a transition: `away-from-home` to `return-home`. **Boss phases** are either a brain transition on `health-fraction` or a trigger on `health-crossed` that runs `set-brain-state`. No dedicated boss system is needed.

### 7.12 Animator

The animator picks the clip by priority: death, dodge, the current attack phase, hurt (200 ms after a hit, when not attacking), move, idle. Attack-phase clips are stretched to the phase's duration, so animation always matches the authored timing. Frame changes that land on a clip `cue` raise its presentation event. Hitstop freezes the animator.

### 7.13 Provider split

In this 2D branch the hex world is the host, and both halves live in LoreBrix. The split still matters for when an external host arrives.

| Rules (portable to any host) | Hex provider (this phase) |
| --- | --- |
| Attack timing, hit eligibility rules, `onHit` | Hitbox shapes, overlap tests |
| Health, effects, death, brains' decisions | Movement, collision, pathing |
| Acquisition choice, relations | `castSegment`, the high-ground rule |
| Animator clip choice | Animator clock |

### 7.14 Signature tests

- ★ **Ramps route.** A\* from low ground to the plateau goes through the ramp; with the ramp removed, there is no path.
- ★ **Cliffs hold.** 10,000 seeded random knockbacks near plateau edges never carry an entity across a non-connecting edge, and walkers always stand on the surface.
- ★ **High ground.** The plateau archer sees the player below; the player cannot see the archer beyond the reveal range; a taller column blocks both.
- ★ **I-frames.** An active window overlapping the dodge's i-frames makes no contact; the same swing one tick after they end does.
- **Telegraph timing.** `attack-windup` fires exactly `windupMs` before the first active tick.
- **One hit per activation.** A wide arc touching one target for many ticks hits it once.
- **No hits through cliffs**, **no friendly fire when off**, **hitstop freezes both for exact ticks**.
- **Effects.** Each stacking mode, each restriction reader, the 32 cap.
- **Brains.** Leash returns home; a trigger at 50% health switches the boss's state.
- **Handles.** A stale id after despawn is not alive; reuse bumps the generation.
- **Zero allocation.** Movement, collision, `castSegment`, and contact allocate nothing over 10,000 ticks (section 9 says how this is measured).

## 8. Phase 5 — Editor Shell & Playtest

Phase 5 puts an editor on top of the runtime without letting it inside: authoring edits the project document, and playtest runs a fresh runtime on a throwaway save.

**Depends on:** P1–P4 · **Blocks:** Phase 6 onward · **Effort:** High · **Chunks:** two (5A shell, map tools, playtest; 5B database editors)

### 8.1 Goal

At the end of Phase 5, E can build Emberfall's plateau, ramps, enemies, and boss in the editor, press Play, fight through it, and return to an unchanged project.

### 8.2 Non-goals

| Deferred | Owner |
| --- | --- |
| Node formula editor | Phase 10, its first consumer |
| Variables usage view | Phase 12 |
| Dialogue editor | Phase 13 |
| Title screen, slots, character creation, rebinding | Phase 11 |
| Mobile authoring | Phase 30 |

### 8.3 The central decision: the editor is a client

The editor holds a `Project` and an `EditorState` (open map, selection, camera, tool). It never holds a runtime between playtests, and it reaches the runtime only through its public API. World queries for overlays, such as which edges block or what an entity can see, call the same headless functions the game uses.

### 8.4 Layout

Three panels on Lovable's existing design system (`primitives.tsx`, the utility classes, the cream-and-ink language): the project tree and databases on the left, the map canvas in the center, the inspector on the right.

### 8.5 Map tools

| Tool | Does |
| --- | --- |
| Terrain brush | Paints terrain; brush of 1, 7, or 19 hexes |
| Raise and lower | Changes cliff level by one per stroke, clamped to `maxLevel` |
| Flatten | Sets the brushed area to the level under the first click |
| Ramp | Click a hex, drag toward the rise; the preview shows the slope before release |
| Region brush | Paints and erases named regions |
| Place | Drops an archetype; height snaps to the surface; drag to set facing |
| Select | Moves, duplicates, deletes placements; edits overrides in the inspector |

**Overlays** (toggle each): level numbers, blocked edges in red, lint warnings with click-to-focus, regions, and a sight overlay that shades every hex the selected entity can see.

### 8.6 Database editors

Every database uses one pattern: a list on the left, a form on the right, edits staged until **Save**, discarded by **Cancel**, and validated inline by the schema validator.

| Database | Extras beyond the form |
| --- | --- |
| Terrains | Passability matrix, top and cliff frame pickers |
| Archetypes | Components added and removed as sections |
| Attacks | Live hitbox preview on a small hex canvas; a timeline bar of windup, active, recovery |
| Brains | States as a list; transitions as condition rows |
| Effects, feedback, particles | A preview button that plays it on a sample entity |
| Animation sets | Clip mapping, playback per direction |
| Factions | The N × N relation grid |
| Variables, input actions, settings | Plain forms |

**Forms are generated from the schema's unions**, one form per condition, action, behavior, and payload variant. A test enumerates every variant and fails if one has no form, so a new vocabulary entry cannot ship unauthorable.

**Asset panel:** import an SVG folder or zip (baked per section 6.7), raster images, and audio, each with a preview.

**Trigger editor:** per map, a list of triggers, each a `when`, `given`, `then` form built from the same generated forms.

### 8.7 Undo and persistence

- **Canvas edits** (paint, elevation, ramps, placements, regions) are commands with undo and redo, capped at 200. A brush stroke is one command.
- **Database edits** use Save and Cancel instead of undo, the v0 Phase 5.5 policy.
- The project autosaves to IndexedDB 2 s after the last change; each save increments `contentRevision`.

### 8.8 Playtest

**Play** clones the project, creates a runtime with an ephemeral save of kind `playtest`, and runs the `player` client in an overlay. **Play from here** spawns the player at the cursor instead of the start. Leaving returns to the editor; nothing is written back.

Edits do not hot-reload into a running playtest; press Play again (Q11).

**Debug overlays** in playtest:

- Hex coordinates and levels; blocked edges
- Hitboxes: windup as an outline, active filled
- Sight segments and each enemy's current target
- Brain state labels; path waypoints
- Tick time in ms, entity count, event queue length

**Pause and step** switch the runtime to stepped mode and advance one tick per press. This is the turn-based seam earning its keep from day one.

**Repro capture** records the input frames and saves project revision, seed, and inputs as one file. The same file format feeds the determinism tests.

### 8.9 Emberfall, re-authored

Emberfall is the fixture every phase tests against. Its foundation content:

- **Village, level 0:** a talkative NPC (interact shows a message) and a lava strip that hurts on contact.
- **Plateau, level 2:** reached by two stacked ramps, guarded by a sentry that spots the player from the cliff edge first, then descends the ramp to chase.
- **Boss arena:** a mini-boss with a telegraphed slam (long windup, ground indicator, heavy knockback) and a sweep. At 50% health a trigger switches it to an enraged state with shorter cooldowns. Its death ends the session in victory.
- **Player:** a quick slash (arc), a heavy thrust (line), and a dodge.
- **Placeholder vector art** in simple shapes, so no phase waits on final art.
- **One deliberately broken ramp** in a side area, so the lint test has something to find.

Emberfall is only the foundation's test map. It carries no attributes, because the foundation has none. A game's attributes come from its own project, and our first set comes from Planet Reset, adjusted to what applies here (Phase 6 v6 §R.11).

### 8.10 Signature tests

- ★ **Playtest isolation.** After 5,000 ticks of Emberfall playtest with kills and variable changes, the project document is byte-identical and `contentRevision` is unchanged.
- ★ **Undo integrity.** 500 random canvas commands, then undo all, restore the map layers byte-identical; redo all reproduces the end state.
- **Every variant authorable.** Each union variant has a generated form.
- **Lint.** The broken ramp appears in the warnings panel.
- **Boundary.** `editor` imports only `runtime`'s public entry points.

## 9. Resource budgets and verification gates

Every cap below is a requirement. The two time budgets are targets to verify: no one has measured this engine yet, so the first bench run on E's machine either confirms them or comes back to E with real numbers.

### 9.1 Time

| Budget | Target | Measured by |
| --- | --- | --- |
| Simulation tick | 4 ms or less on the large bench: 300 entities, 60 in combat | Node bench, production build |
| Render frame | 8 ms or less, 128 × 128 map, full viewport | Browser bench, production build |
| Allocation in hot paths | 0 bytes per tick in movement, collision, `castSegment`, contact | Node bench (9.4) |

### 9.2 Caps

| Collection | Cap | On reaching it |
| --- | --- | --- |
| Live entities | 8,192 | Spawn refused, diagnostic |
| Effects per entity | 32 | New independent instance refused |
| Victims per attack activation | 16 | Further victims ignored |
| Path length | 256 cells (64 waypoints after smoothing) | Path truncated to the nearest reachable cell |
| A\* expansions per request | 4,096 | Request fails; brain retries after 0.5 s |
| Path requests per tick | 8 | Queued to next tick |
| Events per tick | 4,096 | Newest dropped, diagnostic |
| Event cascade rounds | 8 | Remainder carried to next tick |
| Live particles | 1,024 | Burst skipped |
| Audio voices | 24 | Oldest stolen |
| Occlusion silhouettes | 4 | Lowest priority dropped |
| Canvas undo history | 200 commands | Oldest discarded |
| Rolling autosaves | 3 (default) | Oldest evicted |
| Map size | 256 × 256 cells | Validator rejects |
| Atlas page | 4096 × 4096 px | Packer opens a new page |

Memory per map cell is 4 bytes (terrain index 2, level 1, ramp 1), so the largest map's layers take 256 KB.

### 9.3 Lifetimes

| Scope | Owns | Released when |
| --- | --- | --- |
| Session | The runtime, persistent entities, session subscriptions | `dispose()` |
| Map | Map entities, map subscriptions, timers, pending path requests, blocked-edge segments | Map unload |
| Playtest | Its runtime, renderer textures it loaded, its audio nodes | Leaving playtest |
| Editor | The project document, `EditorState`, undo history | Closing the project |

Nothing subscribes, schedules, or caches without one of these scopes.

### 9.4 How zero allocation is measured

In Node with `--expose-gc`: run 1,000 warm-up ticks, collect garbage, record heap used, run 10,000 ticks, collect again, and compare. The gate passes under 64 KB of growth, which allows for JIT noise but catches a per-tick allocation (10,000 ticks of even one small object would far exceed it).

### 9.5 Leak gates

- **Maps:** 100 load and unload cycles return entities, subscriptions, and timers to baseline; heap within 5% after GC.
- **Playtest:** 50 start and stop cycles return renderer texture count and audio node count to baseline; heap within 5%.

### 9.6 Verification gates per chunk

A chunk is done only when all of these pass:

1. `tsc --noEmit`, strict, every package
2. Production builds of `editor` and `player`
3. The package boundary test
4. The chunk's signature and behavior tests
5. Every earlier chunk's tests, unchanged
6. From Phase 2 on: the replay determinism test
7. From Phase 3 on: the leak gates; from Phase 4 on: the budget benches

## 10. Build order for Fable

Build the headless core first, then retire the biggest visual risk, depth order and picking on cliffs, before anything else depends on the renderer. If the Fable window closes early, every stopping point below leaves something coherent and tested.

| # | Chunk | Ends with | If the window closes here |
| --- | --- | --- | --- |
| 1 | P1 Architecture & Schema | Repo, packages, schema, validators, reader manifest, ported modules with adapters, Emberfall skeleton | A validated data model and a clean repo |
| 2 | P2 Runtime Core | Deterministic headless loop, triggers, saves, storage | A tested engine core, nothing to look at |
| 3 | P3A World | Elevation queries, connection table, lint, map lifecycle | Cliffs and ramps proven in tests |
| 4 | **P3B spike** | Terrain meshes, cliff faces, row-strip depth order, height-aware picking, placeholder sprites on the elevation fixture | **The riskiest visual question answered** |
| — | **E review gate** | E looks at the spike in a browser: cliffs, ramps, a unit behind a cliff, clicking a plateau | — |
| 5 | P4A Movement & sight | Movement, collision, pathing, `castSegment`, high ground, acquisition, basic brains | Units walk the spike map and spot each other |
| 6 | P4B Combat | Attacks, telegraphs, contact, knockback, hitstop, dodge, health, effects, animator | Headless combat proven |
| 7 | P3B rest | Vector bake, animation playback, feedback, particles, shake, audio, HUD | Combat looks and sounds alive |
| 8 | P5A Editor shell | Layout, map tools, overlays, playtest, debug overlays, repro capture | E can build and play a map |
| 9 | P5B Database editors | Generated forms, every database, asset panel, trigger editor | The foundation is complete |

Chunk 7 can run beside chunks 5 and 6: the bake pipeline and audio depend only on Phase 1 and the spike's renderer. Everything else is sequential.

**Why the gate after the spike:** the depth order rule in section 6.6 is the one design here I cannot prove on paper. If the row strips show artifacts E will not accept, the fallback (a depth-buffered renderer) changes Phase 3 only, but it must be decided before combat feedback is built on top of it.

## 11. Amendments this requires elsewhere

Eleven design documents were updated on 16 Nov 2026 and two were marked historical. Each updated document carries an authoritative **§R Reconciliation** section near its top and a ⚠ marker on every block it supersedes. Phases 15–21 and `DATA_ARCHITECTURE.md` were not provided, so their rows remain outstanding. One v1 row was withdrawn: making attributes authored content is now open question Q15, not a Phase 6 change.

| Document | Now | What changed |
| --- | --- | --- |
| `PHASE5.5_DESIGN.md` | v3, dissolved | Every item mapped to where it landed in F; kept as rationale only |
| `PHASE6_DESIGN.md` | v5 | `stats` is a component; `HealthState` owns current HP; mana and stamina are runtime state; block and sprint roles; dodge stamina cost; a regeneration tick slot; the `contribution` payload; formula editor moved to Phase 10; jump pending Q7; attributes pending Q15 |
| `PHASE7_DESIGN.md` | v5 | `loadout` component and `equip` commands; weapons carry an `attackId` (`reachTiles` removed); the `deal-damage` action; lava through the pipeline; the `panels` package; `combatFeedback` |
| `PHASE8_DESIGN.md` | v7 | `inventory` and `wallet` components; `use-item` and `drop-item` commands; owns `has-item`, `has-currency`, and give/take actions; pickups are archetypes with a cliff-safe snap |
| `PHASE9_DESIGN.md` | v5 | No enemy database: `directStats` or `stats` on an archetype; monster attacks are `AttackDef`s; `lastHitBy` for kill credit; a `progression` component |
| `PHASE10_DESIGN.md` | v6 | Uses F's `castSegment`, factions, acquisition, `StatusEffectDef`, `ActiveEffects`, `Duration`; builds the formula graph; hex-only geometry with a vertical band; `Faction` renamed `Affects` |
| `PHASE11_DESIGN.md` | v2 | No `Project.player`; presets point at archetypes; a `playthroughs` store; a field-by-field map of its `SaveState` onto F's; audio is live |
| `PHASE12_DESIGN.md` | v8 | Store, bus, triggers, evaluator, executor moved to F; keeps the editor, usage view, watch panel, `explain()`, formula constants, favor, `fire-event`; vocabulary owned by emitting phases; names aligned |
| `PHASE13_DESIGN.md` | v4 | The runner lives in `runtime`, driven by commands; `dialogue`, `provocation`, `destructible` components; faction changes are save patches |
| `PHASE13.5_DESIGN.md` | v2 | The tracker runs on F; `play-time-elapsed` renamed `elapsed-time-reached`; rewards use Phase 8's actions |
| `PHASE14_DESIGN.md` | v2 | The clock is F's tick plus `skippedMs`; `skipTime` for wait, sleep, and travel; F's tint seam |
| `ARCHITECTURE.md`, `FEATURES.md` | Marked historical | Describe v0.6.0 |
| `CHANGELOG.md` | Unchanged | Its release history is accurate |
| Phases 15–21, `DATA_ARCHITECTURE.md` | **Outstanding** | Not provided. v1's guidance holds: 15 keeps only the world map, 16 reads F's acquisition, 17 loses dodge, 18 adds neutral-to-hostile on `attack-hit`, 19 keeps ambience and attenuation, 20's brains are F's, 20.5 gets cross-map carry free, 21 keeps swimming, flight, and mounts |

## 12. Open questions

All sixteen questions are decided.

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| Q1 | Same engine as Planet Reset's LoreBrix, or separate? | **Decided: a separate repository, permanently** | E's call |
| Q2 | Schema library | **Decided: Zod** | One source gives TypeScript types, runtime validation, and, through Zod 4's built-in `z.toJSONSchema`, JSON Schema that an agent layer can hand to models |
| Q3 | Renderer | **Decided: PixiJS**, with a depth-buffered renderer as the fallback if the spike fails | Batched 2D sprites and meshes are this workload, and Spine maintains an official PixiJS 8 runtime |
| Q4 | Vector art: baked frames, live vector, or skeletal rigs | **Decided: baked frames in the foundation; rigs later as a renderer plug-in, Spine first** | Rigs are presentation only, because `AttackDef` owns combat timing |
| Q5 | Default controls | **Decided: Diablo-style click-to-act plus WASD** (section 7.9b) | E's call; feasibility is high |
| Q6 | Hex orientation | **Settled by source: pointy-top, odd-r offset storage** | v0's `ARCHITECTURE.md` |
| Q7 | Jump | **Decided: no jump input; scripted jumps from interactions and triggers** (section 7.9c) | E's call; feasibility is high |
| Q8 | Should attacking from high ground reveal the attacker? | **Decided: defer to Phase 10** as `revealOnAttackMs` | It matters once ranged attacks exist |
| Q9 | Number of cliff levels | **Decided: 16 (levels 0 to 15)**, Warcraft III's count | E's call; zero cost in data, pathing, or picking |
| Q10 | Roadmap and name | **Decided: the engine and its roadmap are LoreEngine**; renumber once after the foundation lands | E's call. A name is a trademark question, not a copyright one; check it before any public release |
| Q11 | Hot reload into a running playtest | **Decided: no**; press Play again | Restart is always correct; a hot-reloaded deterministic runtime is a project of its own |
| Q12 | Simulation in a Web Worker | **Decided: main thread now**; pathfinding is the first candidate for a worker if benchmarks show stutter | The package boundary keeps a later move open; measure first |
| Q13 | ECS library or in-house | **Decided: in-house** | Small, deterministic, and fully introspectable for an agent layer |
| Q14 | Zip library for `.loreengine` files | **Decided: fflate** | Small, dependency-free, browser and Node |
| Q15 | Authored attributes? | **Decided: yes.** Engine-fixed core stats, authored attributes, an authored derivation table (Phase 6 v6 §R.11) | E's call: an engine we reuse should not hard-code one game's attributes |
| Q16 | Square maps beside hex-iso? | **Decided: hex-iso only** | E's call |
