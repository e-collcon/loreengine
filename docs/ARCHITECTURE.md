# LoreBrix — System Architecture (Phase 1)

> **Historical — describes shipped v0.6.0.** The *LoreEngine Foundation — Phases 1–5* (formerly the LoreBrix Foundation Rewrite) (16 Nov 2026) replaces this architecture greenfield: a headless runtime with the editor as a client, composition instead of the entity class hierarchy, schema v2, hex-iso with cliff levels. Only the hex math, A\*, and spatial hash carry over, with their tests. Keep this file as the record of what v0.6.0 was.


Schema version 1 · All data shapes live in `src/core/types.ts` · File format: `.lorebrix.json`

LoreBrix is a browser-based RPG creation engine. Phase 1 defines the skeleton every later phase inherits: the data model, the module boundaries, the state management contract, and the on-disk file format. No implementation code exists yet by design — this document plus `types.ts` is the contract Phases 2 through 5 build against.

## Module map

```
┌────────────────────────────────────────────────────────────────┐
│                       App Shell (React) — Phase 5              │
│                                                                │
│  ┌────────────┐   ┌──────────────────┐   ┌──────────────────┐  │
│  │   Asset    │   │      Canvas      │   │   Properties /   │  │
│  │  Browser   │   │     Viewport     │   │  Rules Editor    │  │
│  │            │   │                  │   │    (Phase 4)     │  │
│  └─────┬──────┘   └────────┬─────────┘   └────────┬─────────┘  │
└────────┼───────────────────┼──────────────────────┼────────────┘
         │ imports           │ mounts               │ edits
         ▼                   ▼                      ▼
   ┌───────────┐      ┌─────────────┐        ┌─────────────┐
   │   Asset   │      │  TileEngine │        │ RulesEngine │
   │  Manager  │      │  (Phase 2)  │        │  (pure TS)  │
   └─────┬─────┘      └──────┬──────┘        └──────┬──────┘
         │ resolves          │ queries               │ evaluates
         │ AssetRef          ▼                      │ in playtest
         │           ┌──────────────┐               │
         └──────────►│EntityManager │◄──────────────┘
                     │  (Phase 3)   │
                     └──────┬───────┘
                            │ reads/writes
                            ▼
                  ┌──────────────────────┐
                  │      EditorState     │
                  │  (single store, one  │
                  │  Project, command-   │
                  │    pattern undo)     │
                  └──────────┬───────────┘
                             │ toJSON / fromJSON
                             ▼
                  Serializer ⇄ .lorebrix.json
```

## Module responsibilities

**TileEngine (Phase 2)** owns the canvas, the camera, and all coordinate math. It renders `TileMap` values of both kinds, switching on `map.kind`: `'square'` gets orthographic grid rendering, `'hex-iso'` gets pointy-top hexes squashed by `isoRatio` into an isometric projection. It exposes tile picking (screen px → grid cell), grid overlay, PNG export, and an event surface (`onTileClick`, `onTileHover`, `onCameraMove`). It knows nothing about entities beyond asking the EntityManager what to draw and where.

**EntityManager (Phase 3)** owns every `AnyEntity` on the active map: CRUD, a grid-bucketed spatial hash for proximity and collision queries, serialization, and an event bus (`onEntityAdded`, `onEntityRemoved`, `onEntityUpdated`). It also reads `TerrainProperties` off the map's tiles to answer passability and damage-on-enter questions — terrain data lives on tiles, but terrain *behavior* is enforced here.

**RulesEngine** is pure functions with zero DOM or canvas dependencies: evaluate a `FormulaGraph` given attacker and defender stat blocks, tick `StatusEffectDef`s, check `Condition` arrays for win/loss, and step `BehaviorStateMachine`s for NPC AI. Because it is pure, the same code drives the Phase 5 playtest loop and any future headless game runtime on the LoreBrix platform.

**AssetManager** resolves `AssetRef` strings into decoded images and audio buffers, slices tilesets into indexed cells, and caches everything. In v1 an `AssetRef` is a data URL embedded in the project file; when platform storage arrives, only the resolver changes.

**App Shell (Phase 5)** composes everything: three-panel layout, toolbar, layer panel, mode switching, save/load, and the playtest loop.

## Data flow

Flow is unidirectional. A UI interaction produces an `EditorCommand` — a labeled pair of `apply`/`revert` closures. Dispatching a command applies it to the single `EditorState` store, pushes it onto the undo stack, clears the redo stack, and marks the project dirty. Subscribers (TileEngine, EntityManager, React panels) are then notified and re-render from state. Nothing mutates the `Project` except through commands, which is what makes undo/redo trivially correct.

Playtest mode takes a deep-frozen snapshot of the `Project`, then runs a `requestAnimationFrame` loop that moves the player, steps NPC state machines, and evaluates rules via the RulesEngine — all against a *working copy*. Exiting playtest restores the snapshot, so testing can never corrupt an authored project.

## State management schema

The full shape is `EditorState` in `types.ts`. In brief: `project` holds the authored `Project` (the only part that ever serializes), `ui` holds transient editor state (active tool, selected entities, brush tile, camera, grid toggle), `playtest` holds the active flag plus the restore snapshot, and `history` holds the undo/redo command stacks, which are runtime-only because commands contain closures.

## File format: `.lorebrix.json`

A project file is a single JSON document — the `Project` interface serialized directly, assets embedded as data URLs for full portability. One file is one game.

```jsonc
{
  "schemaVersion": 1,
  "id": "9f1c…",
  "meta": {
    "name": "Emberfall",
    "author": "E",
    "description": "A three-level dungeon crawler.",
    "createdAt": "2026-07-05T09:00:00Z",
    "updatedAt": "2026-07-05T11:30:00Z",
    "publishing": { "visibility": "private" }
  },
  "maps": [
    {
      "kind": "square",
      "id": "m1", "name": "Overworld",
      "tileSize": 32, "width": 40, "height": 30,
      "layers": [
        { "id": "L1", "name": "Ground", "type": "background",
          "visible": true, "locked": false, "opacity": 1,
          "data": [ { "ref": { "tilesetId": "t1", "index": 4 } }, null, "…" ] }
      ],
      "entities": [ { "kind": "npc", "id": "e1", "name": "Blacksmith", "…": "…" } ],
      "triggers": [],
      "spawnPoint": { "kind": "square", "x": 5, "y": 5 },
      "backgroundColor": "#1a1a2e"
    }
  ],
  "activeMapId": "m1",
  "player": { "kind": "player", "…": "…" },
  "templates": { "npcs": [], "props": [], "doodads": [] },
  "rules": { "mode": "turn-based", "…": "…" },
  "behaviors": [],
  "assets": { "tilesets": [], "spritesheets": [], "audio": [] }
}
```

Loading validates `schemaVersion` first; any future format change bumps the version and ships a migration function, never a silent break.

## Key decisions and rationale

**Discriminated unions over class hierarchies in data.** `TileMap.kind`, entity `.kind`, `GameplayRule.mode`, and `GridPos.kind` give engines a single switch point, keep JSON round-tripping trivial, and let TypeScript narrow types for free. Classes appear only at runtime (Phase 3 wraps these shapes); the persisted format stays plain data.

**Terrain is tile data, not an entity.** Terrain is dense (every cell has it) while entities are sparse. Storing `TerrainProperties` on tiles keeps maps compact and collision lookups O(1) by cell. Phase 3's runtime reads terrain off the map rather than instantiating thousands of terrain "entities."

**Entities embed per-map; templates live at project level.** A placed NPC belongs to its map and serializes with it. Reusable blueprints sit in `Project.templates`, and placing one deep-copies it — so editing a template never mutates already-placed instances behind the creator's back.

**Hex storage is odd-r offset in a rectangular array; hex math is cube coordinates.** Offset packing means hex layers reuse the exact same dense-array machinery as square layers (`index = row * width + col`). Phase 2 owns the offset ⇄ axial ⇄ cube conversions and all pixel math.

**Platform-ready, not platform-heavy.** `ProjectMeta.publishing` and the `AssetRef` indirection are the only concessions to the LoreBrix platform vision in v1. They cost nothing now and prevent a schema migration later, but the MVP remains a self-contained editor.

## HANDOFF CONTEXT

```
SCHEMA v1 · file ext .lorebrix.json · all types in src/core/types.ts — import, never redefine.
Discriminated unions: TileMap.kind='square'|'hex-iso'; entity .kind='player'|'npc'|'prop'|'doodad'; GameplayRule.mode='turn-based'|'action'; GridPos = {kind:'square',x,y} | {kind:'hex',q,r} (cube s=-q-r).
Hex: pointy-top only, radius hexSize, iso squash via isoRatio; storage = odd-r offset in dense rectangular array, index = row*width+col; Phase 2 owns offset⇄cube⇄pixel conversions.
Layers: background|midground|foreground|collision; (Tile|null)[] dense row-major.
Terrain = tile data (TerrainProperties on TerrainTile), NOT an entity; runtime enforces it.
Entities embedded in map.entities; blueprints in Project.templates (place = deep copy). Player/NPC share CombatantBase (StatBlock: hp/mp/atk/def/spd + custom record).
Anim key contract: idle, walk-up/down/left/right, attack, hurt, death (CORE_ANIM_KEYS).
Engines: TileEngine (canvas/camera/picking/exportPNG), EntityManager (CRUD + spatial hash + event bus), RulesEngine (pure fns). Single EditorState store, EditorCommand undo (runtime-only). Assets = data URLs in AssetManifest.
```
