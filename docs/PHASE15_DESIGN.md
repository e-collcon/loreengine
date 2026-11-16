# Phase 15 — World Map, Interiors & Fast Travel · Technical Design (v1)

**Status:** v1 — design (no code yet). Written on 17 Nov 2026, against *LoreEngine Foundation — Phases 1–5* (cited as **F**).
**Depends on:**
- Foundation Phases 1–5 (F): map lifecycle and cross-map teleport (§6.5), regions and region events, the tint seam, height-aware picking, `castSegment`.
- Phase 8 v7: wallet, `take-currency`.
- Phase 11 v2: menu, save.
- Phase 12 v8: authoring vocabulary and `explain()`.
- Phase 14 v2: `skipTime`, hour boundaries, the interruption model.

**Blocks:**
- Phase 21: vehicles. The cart driver calls this phase's `fast-travel`.
- Phase 22: weather, which respects `interior`.

**Stage:** Stage 1 · **Effort:** High. This was Extra High in Roadmap v0; it dropped a level because 15A moved into F §6.5.
**Chunks:** three. 15A Interiors and portals, 15B Area map and minimap, 15C World map and fast travel.

---

## 0. Decisions this design is built on

| Question | E's decision (16–17 Nov) |
|---|---|
| Cross-map teleport (old 15A) | Already in the foundation (F §6.5). This phase only adds the player-facing pieces. |
| World map form | An authored **node graph** of locations, drawn over a painted image. |
| Local navigation | An **auto-drawn area map and minimap**, built from the terrain layers, revealed as the player explores. |
| Fast travel | **Only from travel points.** It costs money and game time, and is never allowed in combat. |
| Discovery | On entering a region, plus a scripted `discover-location` action (a bought map, a told rumour). |
| **Going indoors** | **Seamless.** Ground floors share the street's map: walk through the door, the roof and front walls fade, and the street stays visible around the building. No loading screen. |
| Upper floors, cellars, dungeons | Separate maps joined by two-ended portals, with a ~0.3 s fade. |

**Why seamless interiors are cheap here.** The engine already has every hard part: regions with enter and exit events, terrain that blocks sight and movement, and a mesh renderer. An interior is a region with a flag; walls are raised terrain cells; the cutaway is a fade on the camera-facing wall cells and the roof sprites. The new renderer work is a per-vertex alpha and tint attribute on the terrain meshes, about half a chunk. Multi-storey buildings inside one map would be expensive, since every system would have to understand stacked floors at the same (q, r). So upper floors stay separate maps.

---

## 1. What the foundation already gives this phase

| Need | F provides | This phase adds |
|---|---|---|
| Change maps | §6.5 load, unload, persistent entities carried across, `map-loaded` / `map-unloaded` | Portals, fade, map-switch budget |
| Know where the player is | `RegionDef`, `region-entered` / `region-exited` | The `interior` flag and what it changes |
| Walls | Terrain with `blocksSight`, impassable `passable`, cliff levels | Nothing. A wall is a raised cell of wall terrain. |
| Look | Row-strip meshes, depth order, silhouette, `setWorldTint` | Cutaway fade, per-cell tint mask, area map renderer |
| Time | Phase 14's `skipTime`, hour boundaries, interruption | Travel's own hour events |
| Money | Phase 8's wallet and `take-currency` | Route prices |
| Being in combat | Interim rule from Phase 13 §13 G1, extended to action mode below | Hard block on travel |

---

## 2. Interiors on the same map (15A)

### 2.1 How a building is built

- **Floor:** ordinary terrain cells at the street's level (or a step up).
- **Walls:** cells of a wall terrain raised `wallHeight` levels above the floor. Typically two levels.
  - The wall terrain has `passable` all false and `blocksSight: true`.
  - Its `cliff` frame is wall art, so the existing cliff-face pass draws the walls.
  - Pathing, sight, projectiles, and picking already treat it correctly. Nothing new in the runtime.
- **Doorways:** gaps in the wall at floor level. Opening and closing doors are out of scope (§14 Q1).
- **Roof:** one or more placed prop entities with a `sprite` and the new `cutaway` component. No collider.
- **The interior region:** a `RegionDef` covering the floor cells, with `interior` set.

### 2.2 The `interior` flag

```ts
interface RegionDef {
  id: Id<'region'>; name: string; cells: Int16Array;
  interior?: InteriorDef;           // NEW, minor schema revision
}

interface InteriorDef {
  shellDepth: 1 | 2;                // how many wall cells deep the auto cutaway reaches (default 1)
  cutawayCells?: Int16Array;        // extra cells to fade, beyond the auto shell
  keepCells?: Int16Array;           // cells the auto shell would fade but must not (a load-bearing pillar)
  tint?: [number, number, number];  // light inside; default [1, 1, 1] (neutral)
}
```

What the flag changes, and who reads it:

| Effect | Reader | Rule |
|---|---|---|
| Cutaway | `render` | While the camera target stands in the region, its **front shell** fades (§2.3) |
| Light | `render` | Cells of the region, and entities standing on them, take `tint` instead of the world tint (§2.4) |
| No fast travel | `runtime` travel system | Refused while the player is inside (§6.2) |
| No weather | Phase 22 | Weather overlay masked off the region's cells (seam only, no code now) |
| Area map | `render` area map | Interior cells stay hidden until explored from inside (§4.3) |

### 2.3 The cutaway

**The front shell** is computed once per map edit, never per frame:

1. Start from the region's floor cells.
2. Take every neighbor in the two camera-facing directions (SE and SW, the higher row). Keep the ones whose surface is higher than the floor.
3. Repeat from those cells `shellDepth − 1` more times.
4. Add `cutawayCells` and remove `keepCells`.

Side and back walls are never faded, so the room keeps its shape and the street is still visible past the open front.

**At runtime:**

- When the camera target (the player) enters an interior region, the renderer lerps the alpha of the shell cells' top and face vertices to `0.25` over 200 ms. It lerps every `cutaway` entity bound to that region to `0`.
- On exit, everything lerps back.
- Two adjacent interiors (a shop and its back room) cross-fade, never pop.

**Implementation:**

- The terrain meshes gain a per-vertex alpha attribute.
- Each interior's shell becomes a precomputed list of vertex ranges per row strip. A transition writes those ranges only.
- No geometry rebuild and no allocation (budget §12).

**The occlusion silhouette** (F §6.6) still applies. Anything that still covers the player, such as a neighbouring building, draws the silhouette.

```ts
interface ComponentData {
  // ...F's components
  cutaway?: { regionId: Id<'region'> };  // NEW: fades to 0 while the camera target is in that region
}
```

### 2.4 Light inside, night outside

`setWorldTint` multiplies the whole scene. That is wrong for a lit shop on a night street seen through the cut-away front. So:

- The terrain meshes gain a per-vertex tint factor, 0 to 1, that blends between the world tint and the interior's `tint`. It is written once per map load for interior cells.
- Entities read the factor of the cell under their feet.
- Effect: at night the street stays dark blue while the shop interior stays warm. Walk out the door and you step into the dark, with no transition beyond the cell boundary.

This replaces the earlier lean of "no day/night tint inside", which would have lit the visible street too.

### 2.5 Feasibility

| Piece | Cost |
|---|---|
| `interior` on regions, `cutaway` component | Schema plus reader manifest. Trivial. |
| Shell computation | A breadth-first pass over the region. Small and pure, so testable headless. |
| Per-vertex alpha and tint attributes | The one real renderer change. About half a chunk, including tests on the four spike scenes. |
| Runtime changes | None, beyond the travel refusal |

---

## 3. Portals and the map switch (15A)

### 3.1 The component

```ts
interface ComponentData {
  portal?: {                         // NEW
    toMapId: Id<'map'>;
    toKey: Id<'placement'>;          // the other end, a placement on toMapId
    mode: 'touch' | 'interact';      // stairs and cave mouths: touch; doors and hatches: interact
    oneWay?: boolean;                // a pit you drop down; default false
  };
}
```

A portal is a placement of an archetype carrying `portal` (and `interactable` when `mode` is `interact`).

- **Two-ended by default.** End A names B and B names A. The editor creates both at once (§11).
- **Lint:** reported in the editor's problems list and refused at publish.
  - An end whose `toKey` does not exist on `toMapId`.
  - A two-way end whose target does not point back.
  - An `interact` portal without `interactable`.

### 3.2 Using a portal

1. **Trigger.** A `touch` portal fires when the player's foot enters its collider radius. An `interact` portal fires on `interacted`.
2. **Re-entry guard.** A touch portal arms only after the arriving entity has left its radius once. You never bounce back.
3. **The switch.**
   - The runtime raises `portal-used`.
   - The client starts a 150 ms fade to black and enqueues the teleport.
   - F §6.5 unloads and loads, carrying persistent entities.
   - The player arrives at the target placement's position, offset one hex along its `facing`, and takes its facing.
   - The client fades in over 150 ms.
4. **Total:** about 0.3 s plus the load, which is budgeted to hide inside the fade (§12).

Within one map (a trapdoor to a sealed cellar region on the same map), the same component works and F's `teleport` just moves the player. The fade is skipped.

---

## 4. Area map and minimap (15B)

### 4.1 Drawing it

The area map is a top-down picture of the current map, drawn from the layers. No art is authored.

- **Each cell:** the average colour of its terrain's top frame, computed when the atlas is baked and cached per terrain.
- **Height:** each cliff level darkens by 6% downward from the highest. Cliff edges are drawn as 1 px lines. Ramps get a chevron.
- **Interiors:** floors in a lighter tone, with wall cells outlined.
- **Output:** one off-screen texture per map at 2 px per hex (512 × 512 at most). It is redrawn only for dirty cells: map edits in the editor, reveal updates in play.

### 4.2 Exploration

```ts
// SaveState.world.explored: Record<Id<'map'>, string>  (RLE + base64 bitset, one bit per cell)
```

- Every 10 ticks, if the player's cell changed, the runtime reveals a disc of `revealRadius` hexes around it. The default is the player's `sight.range`.
- **No line-of-sight test,** Diablo-style. It is cheap and players expect it.
- `reveal-area` (a bought map, a told rumour) reveals a whole map, or one region.

### 4.3 Interiors on the map

An interior region's cells are revealed only by standing inside it. From the street you see the building's outline, not its rooms.

### 4.4 Markers

The map shows:
- The player, with an arrow for facing.
- Portals, once both their cell and the far end are known.
- Discovered travel points.
- Quest markers: Phase 13.5's `markerEntityId`, through its read-only view.

Markers are a projection of the runtime view. The runtime never stores them.

### 4.5 Where it appears

- **Minimap:** a 160 px round overlay in the HUD (`player` package), north-up, centred on the player, hideable in settings.
- **Full area map:** on the Map tab of Phase 11's menu.
- **Toggle:** a new `map` input action in the input actions list (F `role` gains `'map'`). Default key: M.

---

## 5. World map (15C)

### 5.1 Schema

```ts
interface Project {
  // ...
  worldMap?: WorldMapDef;           // NEW, minor schema revision
}

interface WorldMapDef {
  image: AssetRef;                  // the painted map
  nodes: WorldNodeDef[];
  routes: WorldRouteDef[];
  travelConditions?: Condition[];   // optional author gate (§6.2)
}

interface WorldNodeDef {
  id: Id<'worldNode'>; name: string;
  at: { u: number; v: number };     // 0..1 on the image
  mapId: Id<'map'>;
  anchorKey: Id<'placement'>;       // the travel point placement; arrival is beside it
  discoverRegionId?: Id<'region'>;  // entering it discovers the node
  startsDiscovered?: boolean;       // the home village
  icon?: AssetRef;
}

interface WorldRouteDef {
  id: Id<'worldRoute'>;
  a: Id<'worldNode'>; b: Id<'worldNode'>;  // undirected
  gameMinutes: number;              // travel time
  cost?: { currencyId: Id<'currency'>; amount: number };
}
```

**Lint:**
- `anchorKey` must exist on `mapId` and carry `interactable`.
- `discoverRegionId` must be on `mapId`.
- A route's two ends must differ.
- A node with no routes is flagged: it can be discovered but never travelled to.

### 5.2 Discovery

A node becomes discovered in any of these cases:
- The player enters `discoverRegionId`.
- The player interacts with its anchor.
- `discover-location` runs.
- It `startsDiscovered`.

The runtime adds it to `SaveState.world.discovered`, raises `location-discovered`, and the HUD shows a toast.

### 5.3 The screen

- **Opened from the Map tab** (view mode), or by interacting with a travel point (travel mode).
- **Shows:** the painted image, discovered nodes, and routes whose ends are both discovered.
- **Travel mode:** hovering a node shows the trip's total time and price; clicking confirms.

---

## 6. Fast travel (15C)

### 6.1 The trip

1. **Path.** The cheapest path by `gameMinutes`, through discovered nodes only. This is Dijkstra over at most 256 nodes. Time and price are summed along the path.
2. **Validate** (§6.2).
3. **Pay** with Phase 8's `take-currency`.
4. **Fade out.** Raise `travel-started`.
5. **Skip time** with Phase 14's `skipTime`. At each game-hour boundary, raise `travel-hour-passed { from, to, hour }`.
   - This is Phase 14's per-hour hook pattern applied to travel.
   - A global trigger can gate an ambush with `chance` and run `interrupt-travel`.
6. **Arrive.** Use F §6.5 teleport to the destination anchor, offset one hex along its facing. Persistent entities come along. Raise `travel-arrived`. Fade in.

### 6.2 When travel is refused

Each refusal shows a HUD message saying why:

| Rule | Why |
|---|---|
| **In combat:** any hostile entity has acquired the player | The interim rule from Phase 13 §13 G1, extended to action mode. Phase 16 replaces it with a real encounter. Hard block, not authorable. |
| Player inside an `interior` region | Travel points stand outside |
| Destination not discovered, or no route | |
| Not enough money | |
| `worldMap.travelConditions` false (optional author gate, e.g. "not while escorting") | Evaluated through F's evaluator; `explain()` names the failing clause |

### 6.3 Interruption

```ts
| { type: 'interrupt-travel'; to: { mapId: Id<'map'>; x: number; y: number; facing?: number } }
```

- Stops the skip **at that hour boundary**: Phase 14 §7.2's rule, for the same reason.
- Teleports to `to` (an authored ambush clearing) instead of the destination.
- Raises `travel-interrupted`.
- The fare is not refunded.

### 6.4 Scripted travel

```ts
| { type: 'fast-travel'; toNodeId: Id<'worldNode'>; free?: boolean }
```

- Skips the world-map screen and runs §6.1 from step 2. A cart driver's dialogue option or a ferry uses it.
- `free` skips payment, for when the dialogue already took the money.
- Phase 21's vehicles resolve through this action.

---

## 7. Vocabulary added by this phase

The owner of a feature adds its vocabulary (Phase 12 §R). All use the `type` discriminant.

| Kind | Added |
|---|---|
| Events | `portal-used { portalKey, fromMapId, toMapId }`, `location-discovered { nodeId }`, `travel-started { from, to }`, `travel-hour-passed { from, to, hour }`, `travel-interrupted`, `travel-arrived { nodeId }` |
| Conditions | `location-discovered { nodeId }`, `in-interior { who: EntityMatch }` |
| Actions | `discover-location { nodeId }`, `reveal-area { mapId, regionId? }`, `open-world-map { mode: 'view' \| 'travel' }`, `fast-travel { toNodeId, free? }`, `interrupt-travel { to }` |

Entering and leaving an interior raises **no new event.** Those are F's `region-entered` and `region-exited` on a region whose `interior` is set (law L6: one pipeline per concern). `in-combat` stays unowned until Phase 16.

---

## 8. Schema changes

All of these are minor, additive revisions (law L3), behind the E-gated hot file (L4).

| Addition | Where | Reader-manifest entry |
|---|---|---|
| `RegionDef.interior` | `MapDef.regions` | `render` cutaway and tint; `runtime` travel refusal; area map |
| `ComponentData.cutaway` | archetypes, placement overrides | `render` cutaway |
| `ComponentData.portal` | archetypes, placement overrides | `runtime` portal system; editor lint |
| `Project.worldMap` | project | `runtime` discovery and travel; `player` world map screen |
| `WorldMapDef.travelConditions?: Condition[]` | project | `runtime` travel |
| Input role `'map'` | `InputActionDef.role` | `player` HUD |
| Id brands `worldNode`, `worldRoute` | `schema` | — |

---

## 9. Save changes

```ts
interface SaveState {
  // ...F §5.10, Phase 11, Phase 14
  world: {                          // NEW
    discovered: Id<'worldNode'>[];
    explored: Record<Id<'map'>, string>;  // RLE + base64 bitset
  };
}
```

A 256 × 256 map's bitset is 8 KB raw, usually under 1 KB after RLE. A save without `world` loads with nothing discovered except `startsDiscovered` nodes and nothing explored. No version bump.

---

## 10. Runtime API and commands

| Command (enqueued by the client) | Effect |
|---|---|
| `travel(toNodeId)` | §6.1 from step 1 |
| `openWorldMap(mode)` | Only raises a UI request. The runtime holds no screen state. |

| Read-only view | Contents |
|---|---|
| `view.world.discovered`, `view.world.routesFrom(nodeId)`, `view.world.quote(from, to)` | For the world map screen: path, minutes, price, and refusal reason |
| `view.explored(mapId)` | For the area map |
| `view.interiorOf(entity)` | The interior region the entity stands in, or null; read by the renderer each frame |

---

## 11. Editor

- **Region panel:**
  - An **Interior** toggle.
  - When on, the auto front shell is highlighted live on the canvas.
  - Alt-click adds a cell to the shell; Shift-click keeps a cell.
  - A **Preview cutaway** button fades it in the editor viewport.
- **Link portal tool:**
  - Place end A, pick the target map from a dropdown, and the canvas switches to it. Place end B.
  - Both placements are created in one undoable command, pointing at each other.
  - Deleting one end offers to delete the other.
- **Roof tool:** select prop placements, then **Cut away with region…**.
- **World Map database editor:**
  - Upload the image, then drag nodes onto it.
  - Draw routes between nodes, and set each route's minutes and price.
  - Pick the anchor by jumping to the map and clicking a placement.
  - Database editors use Save and Cancel (F §8.7).
- **Area map preview:** a panel showing the generated area map, so authors see what players will see.

---

## 12. Budgets

| Budget | Target | Measured by |
|---|---|---|
| Map switch (unload + load), 128 × 128, 500 placements | 100 ms or less, so it hides inside the 0.3 s fade | Node bench and browser bench, production build |
| Cutaway transition | 0 bytes allocated; vertex-range writes only | Allocation bench (F §9.4) |
| Area map reveal update | 1 ms or less per update (dirty-cell redraw) | Browser bench |
| Fast-travel quote (256 nodes, 1,024 routes) | 1 ms or less | Node bench |
| Front shell computation | Per map edit only; never in the frame loop | Code review |

---

## 13. Tests

**Interiors**
- The front shell of a 3 × 4 room with 1-thick walls is exactly the SE and SW wall cells. With `shellDepth: 2` it includes the second row. `keepCells` and `cutawayCells` apply.
- Entering the region fades the shell to 0.25 and the bound roof to 0. Exiting restores both. Two adjacent interiors cross-fade without any frame at full opacity on both.
- At night tint, a floor cell renders with the interior tint and the street cell beside the doorway with the world tint (render snapshot).
- An enemy outside cannot see the player inside through a wall cell; it can through the doorway (headless `castSegment`).

**Portals**
- Touch portal: arrive beside the far end and do not bounce back. Leaving and re-entering the radius fires it again.
- Two-way lint catches an unmatched end; a `oneWay` end needs no return.
- The player's effects and cooldowns survive the switch. A map's removed placements stay removed after a round trip.
- Map switch on the bench map meets 100 ms (bench, recorded, not tuned).

**Area map**
- Revealing at the player position sets exactly the cells within `revealRadius`. The bitset round-trips through RLE + base64.
- Interior cells stay hidden from outside and reveal from inside.
- `reveal-area` with a region reveals only that region.

**World map and travel**
- Region entry discovers a node once and raises `location-discovered` once.
- The quote picks the cheapest path by minutes through discovered nodes only; an undiscovered middle node blocks the path.
- Travel refusals: in combat, inside an interior, too poor, undiscovered, failing `travelConditions`. Each gives its own reason.
- An 8-hour trip expires a 2-hour effect and moves no entity during the skip (Phase 14's `skipTime`).
- `chance` 1.0 on `travel-hour-passed` with `interrupt-travel` stops at hour 1, lands at the ambush point, and keeps the fare taken.
- `fast-travel { free: true }` takes no money.

**Laws**
- Playtesting travel, portals, and exploration leaves the project byte-identical (L7).
- Replay determinism holds across a portal switch and a fast-travel interruption (L5).

---

## 14. Open questions (with leans)

| # | Question | Lean |
|---|---|---|
| Q1 | Doors that open and close | **Later.** Doorways only in v1. A door needs a toggleable collider and a sight blocker on an entity, which F's terrain-only `castSegment` does not have. Backlog: "entity occluders". |
| Q2 | Should a terrain author be able to override its area map colour? | **Not yet.** The baked average is enough. Add an optional `mapColor` only when a real map looks wrong. |
| Q3 | Fast travel from anywhere outdoors (Skyrim style), as a project setting? | **No.** It conflicts with "only from travel points". Revisit if a game asks for it. |
| Q4 | Companions and mounts on fast travel | They are `persistent`, so they come along automatically when Phases 20.5 and 21 land. Nothing to decide now. |

---

## 15. Amendments elsewhere

| Document | Amendment |
|---|---|
| Roadmap v0 / LoreEngine roadmap | Phase 15 is three chunks (15A, 15B, 15C). Old 15A is in F §6.5. Effort is High. Overworld-vs-interior tagging is `RegionDef.interior`, not a `TileMap` flag. |
| Phase 11 v2 | The menu gains a Map tab (area map and world map). The save gains `world` (§9). |
| Phase 13.5 v2 | Quest markers appear on the area map through its read-only view. |
| Phase 14 v2 §9 A7 | Fast travel uses `skipTime` with its own `travel-hour-passed` events and `interrupt-travel`, mirroring rest. |
| Phase 16 | Replaces the travel combat block, along with rest's. |
| Phase 21 | Vehicles resolve trips through `fast-travel`. |
| Phase 22 | Weather is masked off `interior` regions. |
| F | Nothing. The foundation spec is unchanged, and this phase adds its own map-switch bench. |
