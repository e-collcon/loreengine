/**
 * The simulation: every subsystem of one session, and the fixed tick order
 * (spec 5.4). This class is internal to `runtime`; clients hold a `Runtime`
 * (runtime.ts) and read through a `RuntimeView` (view.ts).
 */
import { offsetCol } from '@loreengine/hexmath';
import type {
  Action,
  ArchetypeDef,
  ComponentData,
  ComponentPatch,
  EntityPlacement,
  MapDef,
  Project,
  SaveKind,
  SaveState,
  SerializedEntity,
} from '@loreengine/schema';
import { ActionExecutor } from './actions.ts';
import { ConditionEvaluator } from './conditions.ts';
import { Diagnostics } from './diagnostics.ts';
import { F_DEAD, F_DESPAWNING, F_HEALTH, F_PERSISTENT, F_SPAWNED, EntityStore, NO_ENTITY } from './entities.ts';
import type { EntityId } from './entities.ts';
import { EventBus } from './events.ts';
import { FactionTable } from './factions.ts';
import { InputState } from './input.ts';
import { Matcher } from './match.ts';
import type { MatchContext } from './match.ts';
import { PresentationLog } from './presentation.ts';
import { Rng } from './rng.ts';
import { Scope } from './scope.ts';
import { msToTicks } from './time.ts';
import { TimerStore } from './timers.ts';
import { TriggerSystem } from './triggers.ts';
import { VariableStore } from './variables.ts';
import { World, modeBit } from './world.ts';

/** The twelve steps of a tick, in order (spec 5.4). Changing this is a design change. */
export const TICK_SLOTS = [
  'commands', //        1  Apply queued runtime commands
  'input', //           2  Apply input to player-controlled entities
  'brains', //          3  Brains choose intents (P4)
  'attack-dodge', //    4  Attack and dodge state machines advance (P4)
  'movement', //        5  Movement, collision, and knockback resolve (P4)
  'contact', //         6  Attack contact is detected (P4)
  'effects', //         7  Active effects tick (P4)
  'health', //          8  Health changes apply; deaths are raised (P4)
  'terrain-contact', // 9  Terrain contact fires (P4)
  'animators', //       10 Animators advance (P4)
  'timers', //          11 Timers fire
  'events', //          12 Queued events dispatch to triggers
] as const;
export type TickSlot = (typeof TICK_SLOTS)[number];
export type System = (sim: Sim) => void;

/**
 * UI-driven changes to the game (spec 5.3). The client enqueues; the
 * runtime applies them at step 1 of the next tick, in enqueue order. The
 * foundation ships the channel and one test-only command; each later phase
 * adds its own (Phase 7 `equip`, Phase 8 `use-item`, Phase 13 `dialogue-choose`).
 */
export type RuntimeCommand = { type: 'test-actions'; actions: Action[] };

export const MAX_COMMANDS_PER_TICK = 256;
/** Crossfade when a map's own music starts on entering it. */
export const MAP_BGM_FADE_MS = 1000;
/** Tries to find a passable cell when spawning into a region. */
const SPAWN_TRIES = 8;
export type ClockMode = 'continuous' | 'stepped';
export type Outcome = 'victory' | 'defeat';

/** What lasts on a map the player is not on (spec 5.10). */
export interface MapDelta {
  removed: Set<string>;
  changed: Map<string, ComponentPatch>;
  spawned: SerializedEntity[];
}

/** The loaded map. */
export interface MapInstance {
  def: MapDef;
  scope: Scope;
  /** Region id -> one byte per cell, 1 inside. */
  regionMasks: Map<string, Uint8Array>;
  /** Region id -> its on-map cells, in stored order. */
  regionCells: Map<string, Int32Array>;
  world: World;
  placements: Map<string, EntityPlacement>;
}

const emptyDelta = (): MapDelta => ({ removed: new Set(), changed: new Map(), spawned: [] });

export class Sim {
  readonly diagnostics = new Diagnostics();
  readonly bus = new EventBus(this.diagnostics);
  readonly presentation = new PresentationLog();
  readonly rng = new Rng(0);
  readonly entities = new EntityStore();
  readonly input = new InputState();
  readonly sessionScope = new Scope('session');
  readonly variables: VariableStore;
  readonly timers: TimerStore;
  readonly factions: FactionTable;
  readonly matcher: Matcher;
  readonly evaluator: ConditionEvaluator;
  readonly executor: ActionExecutor;
  readonly triggers: TriggerSystem;

  readonly archetypeIndexById = new Map<string, number>();
  readonly mapById = new Map<string, MapDef>();
  readonly mapDeltas = new Map<string, MapDelta>();

  tick = 0;
  clockMode: ClockMode = 'continuous';
  pendingSteps = 0;
  outcome: Outcome | null = null;
  map: MapInstance | null = null;
  /** The loaded map's elevation model; null between maps. */
  world: World | null = null;
  /** A cross-map teleport waiting for the end of the tick. */
  pendingMapChange: { mapId: string; x: number; y: number } | null = null;
  disposed = false;

  private readonly systems: System[][] = TICK_SLOTS.map(() => []);
  private readonly commands: RuntimeCommand[] = [];
  private readonly commandCtx: MatchContext = { subject: NO_ENTITY, other: NO_ENTITY };
  /** Test and debug hook: called as each slot starts. */
  onSlot: ((slot: TickSlot) => void) | null = null;
  /** Called with each command as it is applied (the recorder). */
  onCommand: ((command: RuntimeCommand) => void) | null = null;

  /** Systems that hold per-entity state add to these so saves stay exact. */
  readonly captureHooks: ((index: number, patch: ComponentPatch, full: boolean) => void)[] = [];
  readonly applyHooks: ((index: number, patch: ComponentPatch) => void)[] = [];
  readonly spawnHooks: ((index: number) => void)[] = [];

  constructor(readonly project: Project) {
    this.variables = new VariableStore(project.variables, this.bus, this.diagnostics);
    this.timers = new TimerStore(this.bus, this.diagnostics);
    this.factions = new FactionTable(project.factions);
    this.matcher = new Matcher(project, this.entities);
    this.evaluator = new ConditionEvaluator(this.variables, this.rng, this.entities, this.matcher, this.factions, this.diagnostics);
    this.executor = new ActionExecutor(this.diagnostics);
    this.triggers = new TriggerSystem(project, this.bus, this.matcher, this.evaluator, this.executor, this.diagnostics);
    project.archetypes.forEach((a, i) => this.archetypeIndexById.set(a.id, i));
    for (const map of project.maps) this.mapById.set(map.id, map);
    this.evaluator.inRegion = (regionId, index) => this.inRegion(regionId, index);
  }

  /* ---------------------------------------------------------------------- */
  /*  The tick                                                              */
  /* ---------------------------------------------------------------------- */

  addSystem(slot: TickSlot, system: System): void {
    this.systems[TICK_SLOTS.indexOf(slot)]!.push(system);
  }

  enqueue(command: RuntimeCommand): void {
    if (this.commands.length >= MAX_COMMANDS_PER_TICK) {
      this.diagnostics.report('command-queue-overflow', `More than ${MAX_COMMANDS_PER_TICK} commands were queued for one tick; the newest was dropped.`);
      return;
    }
    this.commands.push(command);
  }

  /** Advance exactly one 1/60 s step. Returns false when nothing advanced. */
  step(): boolean {
    if (this.outcome !== null) return false;
    if (this.clockMode === 'stepped') {
      if (this.pendingSteps <= 0) return false;
      this.pendingSteps--;
    }
    this.diagnostics.tick = this.tick;
    this.presentation.tick = this.tick;
    for (let s = 0; s < TICK_SLOTS.length; s++) {
      if (this.onSlot !== null) this.onSlot(TICK_SLOTS[s]!);
      if (s === 0) this.applyCommands();
      const systems = this.systems[s]!;
      for (let i = 0; i < systems.length; i++) systems[i]!(this);
      if (s === 10) this.timers.step();
      if (s === 11) this.bus.dispatch();
    }
    this.endOfTick();
    this.tick++;
    return true;
  }

  private applyCommands(): void {
    const n = this.commands.length;
    for (let i = 0; i < n; i++) {
      const command = this.commands[i]!;
      if (this.onCommand !== null) this.onCommand(command);
      switch (command.type) {
        case 'test-actions':
          this.commandCtx.subject = NO_ENTITY;
          this.commandCtx.other = NO_ENTITY;
          this.executor.run(command.actions, this.commandCtx);
          break;
      }
    }
    this.commands.length = 0;
  }

  /** Housekeeping after step 12: deferred despawns, then any deferred map change. */
  private endOfTick(): void {
    const e = this.entities;
    if (e.pendingDespawns > 0) {
      e.flushDespawns((index) => {
        const key = e.placementKey[index]!;
        if (key !== '' && this.map) this.deltaOf(this.map.def.id).removed.add(key);
      });
    }
    for (let i = 0; i < this.endOfTickHooks.length; i++) this.endOfTickHooks[i]!(this);
    const change = this.pendingMapChange;
    if (change !== null) {
      this.pendingMapChange = null;
      this.changeMap(this.mapById.get(change.mapId)!, change.x, change.y);
    }
  }
  readonly endOfTickHooks: System[] = [];

  /* ---------------------------------------------------------------------- */
  /*  Entities                                                              */
  /* ---------------------------------------------------------------------- */

  /** Surface height under a point on the loaded map. */
  surfaceZ(x: number, y: number): number {
    return this.world === null ? 0 : this.world.surfaceHeight(x, y);
  }

  /** Put an entity somewhere at once: on the surface, with no interpolation from where it was. */
  place(index: number, x: number, y: number): void {
    const e = this.entities;
    e.x[index] = e.prevX[index] = x;
    e.y[index] = e.prevY[index] = y;
    e.z[index] = e.prevZ[index] = this.surfaceZ(x, y);
    this.presentation.raise('teleported', e.idAt(index));
  }

  /** Build an entity from an archetype plus its placement overrides (spec 7.3). */
  spawn(
    archetypeIndex: number,
    x: number,
    y: number,
    facing: number,
    placement: EntityPlacement | null,
    spawned: boolean,
    forcedId: EntityId = NO_ENTITY,
  ): EntityId {
    const archetype: ArchetypeDef = this.project.archetypes[archetypeIndex]!;
    const data: ComponentData = placement?.overrides ? { ...archetype.components, ...placement.overrides } : archetype.components;
    const faction = data.faction ? this.factions.indexOf(data.faction.factionId) : -1;
    const id = this.entities.spawn(archetypeIndex, data, faction, x, y, this.surfaceZ(x, y), facing, placement ? placement.key : '', spawned, forcedId);
    if (id === NO_ENTITY) {
      this.diagnostics.report('entity-cap', `Spawn of "${archetype.name}" was refused: the entity cap or its saved slot is taken.`);
      return NO_ENTITY;
    }
    const index = id & 0xffff;
    for (let i = 0; i < this.spawnHooks.length; i++) this.spawnHooks[i]!(index);
    return id;
  }

  /** Mutable state of one entity. `full` is everything (current map); otherwise only what lasts. */
  capture(index: number, full: boolean): ComponentPatch {
    const e = this.entities;
    const patch: ComponentPatch = {};
    if (full) {
      patch.id = e.idAt(index);
      patch.transform = { x: e.x[index]!, y: e.y[index]!, z: e.z[index]!, facing: e.facing[index]! };
    }
    if ((e.flags[index]! & F_HEALTH) !== 0) {
      const dead = (e.flags[index]! & F_DEAD) !== 0;
      // A map the player has left keeps health only where play changed it.
      if (full || dead || e.hp[index] !== e.hpMax[index]) patch.health = { current: e.hp[index]!, dead };
    }
    for (let i = 0; i < this.captureHooks.length; i++) this.captureHooks[i]!(index, patch, full);
    return patch;
  }

  applyPatch(index: number, patch: ComponentPatch): void {
    const e = this.entities;
    if (patch.transform) {
      e.x[index] = e.prevX[index] = patch.transform.x;
      e.y[index] = e.prevY[index] = patch.transform.y;
      e.z[index] = e.prevZ[index] = patch.transform.z;
      e.facing[index] = patch.transform.facing;
    }
    if (patch.health && (e.flags[index]! & F_HEALTH) !== 0) {
      e.hp[index] = Math.min(patch.health.current, e.hpMax[index]!);
      if (patch.health.dead) e.flags[index] = e.flags[index]! | F_DEAD;
    }
    for (let i = 0; i < this.applyHooks.length; i++) this.applyHooks[i]!(index, patch);
  }

  /** Index of the first player-controlled entity, or -1. */
  playerIndex(): number {
    const e = this.entities;
    for (let i = 0; i < e.highWater; i++) if (e.alive[i] === 1 && e.data[i]!.playerControlled) return i;
    return -1;
  }

  /* ---------------------------------------------------------------------- */
  /*  Maps                                                                  */
  /* ---------------------------------------------------------------------- */

  deltaOf(mapId: string): MapDelta {
    let delta = this.mapDeltas.get(mapId);
    if (!delta) {
      delta = emptyDelta();
      this.mapDeltas.set(mapId, delta);
    }
    return delta;
  }

  inRegion(regionId: string, index: number): boolean {
    const map = this.map;
    if (!map) return false;
    const mask = map.regionMasks.get(regionId);
    if (!mask) return false;
    const e = this.entities;
    const cell = map.world.cellAt(e.x[index]!, e.y[index]!);
    return cell >= 0 && mask[cell] === 1;
  }

  /** Hooks the world (Phase 3) uses to build and release per-map data. */
  readonly mapOpenHooks: ((map: MapInstance) => void)[] = [];

  /** Open a map's scope: regions, triggers, timers. Spawns nothing. */
  openMap(def: MapDef): MapInstance {
    const scope = new Scope('map');
    const regionMasks = new Map<string, Uint8Array>();
    const regionCells = new Map<string, Int32Array>();
    for (const region of def.regions) {
      const mask = new Uint8Array(def.width * def.height);
      const cells: number[] = [];
      for (let i = 0; i + 1 < region.cells.length; i += 2) {
        const r = region.cells[i + 1]!;
        const col = offsetCol(region.cells[i]!, r);
        if (col >= 0 && r >= 0 && col < def.width && r < def.height) {
          const cell = r * def.width + col;
          if (mask[cell] === 0) cells.push(cell);
          mask[cell] = 1;
        }
      }
      regionMasks.set(region.id, mask);
      regionCells.set(region.id, Int32Array.from(cells));
    }
    const world = new World(this.project, def);
    this.world = world;
    const placements = new Map<string, EntityPlacement>();
    for (const p of def.placements) placements.set(p.key, p);
    const map: MapInstance = { def, scope, regionMasks, regionCells, world, placements };
    this.map = map;
    for (let i = 0; i < this.mapOpenHooks.length; i++) this.mapOpenHooks[i]!(map);
    this.triggers.bind(scope, def.triggers);
    // Map scope owns its timers and its entities (spec 9.3).
    scope.own(() => this.timers.clear());
    scope.own(() => {
      const e = this.entities;
      for (let i = 0; i < e.highWater; i++) {
        if (e.alive[i] === 1 && (e.flags[i]! & F_PERSISTENT) === 0) e.removeNow(i);
      }
    });
    scope.own(() => {
      if (this.map === map) {
        this.map = null;
        this.world = null;
      }
    });
    // Presentation only: tell the client which map is up, and start its music.
    this.presentation.raise('map-changed', -1, -1, def.id);
    if (def.bgm !== undefined) this.presentation.raise('bgm', -1, -1, def.bgm, MAP_BGM_FADE_MS);
    return map;
  }

  /**
   * Enter a map (spec 6.5): spawn placements minus the delta's `removed`,
   * apply `changed`, add `spawned`, and raise `map-loaded`.
   */
  enterMap(def: MapDef, beforePlacements?: () => void): void {
    const map = this.openMap(def);
    if (beforePlacements) beforePlacements();
    const delta = this.deltaOf(def.id);
    for (const placement of def.placements) {
      if (delta.removed.has(placement.key)) continue;
      const id = this.spawn(this.archetypeIndexById.get(placement.archetypeId)!, placement.x, placement.y, placement.facing, placement, false);
      const patch = delta.changed.get(placement.key);
      if (id !== NO_ENTITY && patch) this.applyPatch(id & 0xffff, patch);
    }
    for (const saved of delta.spawned) this.spawnSerialized(saved, true);
    delta.changed.clear();
    delta.spawned = [];
    this.bus.raise('map-loaded', NO_ENTITY, NO_ENTITY, map.def.id);
  }

  /**
   * Leave the loaded map (spec 6.5): write its lasting delta, raise
   * `map-unloaded` (so global triggers can react), then dispose the map
   * scope, which releases its entities, subscriptions, and timers.
   */
  leaveMap(): void {
    const map = this.map;
    if (map === null) return;
    const e = this.entities;
    const delta = this.deltaOf(map.def.id);
    delta.changed.clear();
    delta.spawned = [];
    for (let i = 0; i < e.highWater; i++) {
      if (e.alive[i] !== 1 || (e.flags[i]! & (F_PERSISTENT | F_DESPAWNING)) !== 0) continue;
      const lasting = this.capture(i, false);
      const key = e.placementKey[i]!;
      if (key !== '') {
        // Placed entities return to their placed positions on re-entry; only what lasts is kept.
        if (Object.keys(lasting).length > 0) delta.changed.set(key, lasting);
      } else if ((e.flags[i]! & F_SPAWNED) !== 0) {
        lasting.transform = { x: e.x[i]!, y: e.y[i]!, z: e.z[i]!, facing: e.facing[i]! };
        delta.spawned.push({ archetypeId: this.project.archetypes[e.archetype[i]!]!.id, state: lasting });
      }
    }
    this.bus.raise('map-unloaded', NO_ENTITY, NO_ENTITY, map.def.id);
    map.scope.dispose();
  }

  /** Teleport across maps: unload, load, and move every persistent entity across, state intact. */
  changeMap(def: MapDef, x: number, y: number): void {
    this.leaveMap();
    this.enterMap(def);
    const e = this.entities;
    for (let i = 0; i < e.highWater; i++) {
      if (e.alive[i] === 1 && (e.flags[i]! & F_PERSISTENT) !== 0) this.place(i, x, y);
    }
  }

  private spawnSerialized(saved: SerializedEntity, spawned: boolean): EntityId {
    const archetypeIndex = this.archetypeIndexById.get(saved.archetypeId);
    if (archetypeIndex === undefined) {
      this.diagnostics.report('save-dropped-entity', `The save has an entity of archetype ${saved.archetypeId}, which no longer exists.`);
      return NO_ENTITY;
    }
    const t = saved.state.transform;
    const id = this.spawn(archetypeIndex, t?.x ?? 0, t?.y ?? 0, t?.facing ?? 0, null, spawned, saved.state.id ?? NO_ENTITY);
    if (id !== NO_ENTITY) this.applyPatch(id & 0xffff, saved.state);
    return id;
  }

  /* ---------------------------------------------------------------------- */
  /*  Session start, save, restore                                          */
  /* ---------------------------------------------------------------------- */

  /** A new session: seed, global triggers, the player, the start map. */
  start(seed: number, clockMode: ClockMode): void {
    this.rng.seed(seed);
    this.clockMode = clockMode;
    this.triggers.bind(this.sessionScope, this.project.triggers);
    const startMap = this.mapById.get(this.project.startMapId)!;
    // The player is never a placement: it spawns from playerArchetypeId at the
    // start map's playerStart, before the placements, so it is always entity 0.
    this.enterMap(startMap, () => {
      const start = startMap.playerStart!;
      const id = this.spawn(this.archetypeIndexById.get(this.project.settings.playerArchetypeId)!, start.x, start.y, start.facing, null, false);
      if (id !== NO_ENTITY) this.bus.raise('entity-spawned', id);
    });
  }

  snapshot(savedAt: string, kind: SaveKind): SaveState {
    const e = this.entities;
    const persistent: SerializedEntity[] = [];
    const current = this.map;
    const currentChanged: Record<string, ComponentPatch> = {};
    const currentSpawned: SerializedEntity[] = [];
    for (let i = 0; i < e.highWater; i++) {
      if (e.alive[i] !== 1) continue;
      const flags = e.flags[i]!;
      const archetypeId = this.project.archetypes[e.archetype[i]!]!.id;
      if ((flags & F_PERSISTENT) !== 0) persistent.push({ archetypeId, state: this.capture(i, true) });
      else if (e.placementKey[i] !== '') currentChanged[e.placementKey[i]!] = this.capture(i, true);
      else if ((flags & F_SPAWNED) !== 0) currentSpawned.push({ archetypeId, state: this.capture(i, true) });
    }
    const maps: SaveState['maps'] = {};
    for (const def of this.project.maps) {
      const delta = this.mapDeltas.get(def.id);
      const isCurrent = current !== null && current.def.id === def.id;
      if (!delta && !isCurrent) continue;
      const removed = delta ? [...delta.removed].sort() : [];
      if (isCurrent) {
        maps[def.id] = { removed, changed: currentChanged, spawned: currentSpawned };
      } else if (delta && (removed.length > 0 || delta.changed.size > 0 || delta.spawned.length > 0)) {
        const changed: Record<string, ComponentPatch> = {};
        for (const [key, patch] of delta.changed) changed[key] = patch;
        maps[def.id] = { removed, changed, spawned: delta.spawned };
      }
    }
    return {
      header: { schemaVersion: 2, projectId: this.project.id, contentRevision: this.project.contentRevision, savedAt, kind },
      rng: this.rng.getState(),
      tick: this.tick,
      clockMode: this.clockMode,
      currentMapId: current ? current.def.id : this.project.startMapId,
      variables: this.variables.exportSave(),
      timers: this.timers.exportSave(),
      triggers: this.triggers.exportSave(),
      persistent,
      maps,
      entityGenerations: e.exportGenerations(),
      carriedEvents: this.bus.exportQueue(),
    };
  }

  /**
   * Resume from a save: rebuild the exact state, raising no events. If
   * content changed since the save, it loads with a warning, and deltas for
   * things that no longer exist are dropped and reported (spec 5.10).
   */
  restore(save: SaveState): void {
    if (save.header.projectId !== this.project.id) {
      throw new Error(`This save belongs to project ${save.header.projectId}, not ${this.project.id}.`);
    }
    if (save.header.contentRevision !== this.project.contentRevision) {
      this.diagnostics.report(
        'save-content-changed',
        `The save was made at content revision ${save.header.contentRevision}; the project is at ${this.project.contentRevision}.`,
      );
    }
    this.rng.setState(save.rng);
    this.tick = save.tick;
    this.clockMode = save.clockMode;
    this.variables.importSave(save.variables);
    this.triggers.importSave(save.triggers);
    this.triggers.bind(this.sessionScope, this.project.triggers);
    this.entities.importGenerations(save.entityGenerations);

    for (const mapId of Object.keys(save.maps)) {
      const def = this.mapById.get(mapId);
      if (!def) {
        this.diagnostics.report('save-dropped-map', `The save has changes for map ${mapId}, which no longer exists.`);
        continue;
      }
      if (mapId === save.currentMapId) continue;
      const saved = save.maps[mapId]!;
      const delta = this.deltaOf(mapId);
      const known = new Set(def.placements.map((p) => p.key as string));
      for (const key of saved.removed) this.keepIfKnown(known, key, mapId) && delta.removed.add(key);
      for (const key of Object.keys(saved.changed)) this.keepIfKnown(known, key, mapId) && delta.changed.set(key, saved.changed[key]!);
      delta.spawned = saved.spawned.slice();
    }

    const currentDef = this.mapById.get(save.currentMapId);
    if (!currentDef) {
      // The map the player was on is gone: fall back to the authored start.
      this.diagnostics.report('save-dropped-map', `The save's current map ${save.currentMapId} no longer exists; starting from the project's start map.`);
      const startMap = this.mapById.get(this.project.startMapId)!;
      this.enterMap(startMap);
      for (const saved of save.persistent) {
        const id = this.spawnSerialized(saved, false);
        if (id !== NO_ENTITY && startMap.playerStart) {
          const i = id & 0xffff;
          this.entities.x[i] = this.entities.prevX[i] = startMap.playerStart.x;
          this.entities.y[i] = this.entities.prevY[i] = startMap.playerStart.y;
        }
      }
      return;
    }

    const map = this.openMap(currentDef);
    const saved = save.maps[save.currentMapId] ?? { removed: [], changed: {}, spawned: [] };
    const delta = this.deltaOf(currentDef.id);
    for (const key of saved.removed) this.keepIfKnown(map.placements, key, currentDef.id) && delta.removed.add(key);
    for (const key of Object.keys(saved.changed)) this.keepIfKnown(map.placements, key, currentDef.id);

    // Entities with a saved id go back into their exact slots first; anything
    // new since the save (a placement added by an edit) then takes free slots.
    for (const s of save.persistent) this.spawnSerialized(s, false);
    const late: EntityPlacement[] = [];
    for (const placement of currentDef.placements) {
      if (delta.removed.has(placement.key)) continue;
      const patch = saved.changed[placement.key];
      if (!patch || patch.id === undefined) {
        late.push(placement);
        continue;
      }
      const id = this.spawn(this.archetypeIndexById.get(placement.archetypeId)!, placement.x, placement.y, placement.facing, placement, false, patch.id);
      if (id !== NO_ENTITY) this.applyPatch(id & 0xffff, patch);
    }
    for (const s of saved.spawned) this.spawnSerialized(s, true);
    for (const placement of late) {
      const id = this.spawn(this.archetypeIndexById.get(placement.archetypeId)!, placement.x, placement.y, placement.facing, placement, false);
      const patch = saved.changed[placement.key];
      if (id !== NO_ENTITY && patch) this.applyPatch(id & 0xffff, patch);
    }

    this.timers.importSave(save.timers);
    this.bus.importQueue(save.carriedEvents);
  }

  private keepIfKnown(known: { has(key: string): boolean }, key: string, mapId: string): boolean {
    if (known.has(key)) return true;
    this.diagnostics.report('save-dropped-placement', `The save refers to placement ${key} on map ${mapId}, which no longer exists.`);
    return false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pendingMapChange = null;
    this.map?.scope.dispose();
    this.sessionScope.dispose();
    this.bus.clear();
    const e = this.entities;
    for (let i = 0; i < e.highWater; i++) e.removeNow(i);
  }
}

/** Phase 2's action handlers: variables, timers, triggers, messages, the session, and audio requests. */
export function registerCoreActions(sim: Sim): void {
  const x = sim.executor;
  x.register('set-variable', (a) => void sim.variables.apply(a.variableId, a.op));
  x.register('start-timer', (a) => sim.timers.start(a.timerId, msToTicks(a.ms), a.repeat));
  x.register('set-trigger-enabled', (a) => sim.triggers.setEnabled(a.triggerId, a.enabled));
  x.register('show-message', (a) => sim.presentation.raise('message', -1, -1, a.text, a.ms));
  x.register('end-session', (a) => {
    if (sim.outcome !== null) return;
    sim.outcome = a.outcome;
    sim.presentation.raise('session-ended', -1, -1, a.outcome);
  });
  // Audio actions never touch audio: they raise presentation events the mixer subscribes to.
  x.register('play-sfx', (a) => sim.presentation.raise('sfx', -1, -1, a.assetId, 1));
  x.register('change-bgm', (a) => sim.presentation.raise('bgm', -1, -1, a.assetId ?? '', a.fadeMs));
}

/** Phase 3A's entity actions: spawn, despawn, and teleport (within a map, or across maps). */
export function registerWorldActions(sim: Sim): void {
  const x = sim.executor;
  const buffer = new Int32Array(sim.entities.capacity);
  const e = sim.entities;

  x.register('spawn', (a, ctx) => {
    const archetypeIndex = sim.archetypeIndexById.get(a.archetypeId);
    const map = sim.map;
    if (archetypeIndex === undefined || map === null) return;
    const mode = modeBit(sim.project.archetypes[archetypeIndex]!.components.movement?.startMode ?? 'walk');
    for (let k = 0; k < a.count; k++) {
      let px: number;
      let py: number;
      if (a.at === 'subject') {
        const subject = e.indexOf(ctx.subject);
        if (subject < 0) {
          sim.diagnostics.report('spawn-no-subject', 'A spawn "at subject" ran with no subject entity; nothing was spawned.');
          return;
        }
        px = e.x[subject]!;
        py = e.y[subject]!;
      } else {
        const cells = map.regionCells.get(a.at);
        if (cells === undefined || cells.length === 0) {
          sim.diagnostics.report('spawn-no-region', `Region ${a.at} is empty or not on the current map; nothing was spawned.`);
          return;
        }
        // Spawns draw from the simulation stream (spec 5.8).
        let cell = -1;
        for (let attempt = 0; attempt < SPAWN_TRIES && cell < 0; attempt++) {
          const pick = cells[sim.rng.nextInt(cells.length)]!;
          if (map.world.passable(pick, mode)) cell = pick;
        }
        if (cell < 0) {
          sim.diagnostics.report('spawn-no-room', `No passable cell was found in region ${a.at}; one spawn was skipped.`);
          continue;
        }
        px = map.world.centerX(cell);
        py = map.world.centerY(cell);
      }
      const id = sim.spawn(archetypeIndex, px, py, 0, null, true);
      if (id !== NO_ENTITY) sim.bus.raise('entity-spawned', id);
    }
  });

  x.register('despawn', (a, ctx) => {
    const n = sim.matcher.resolve(a.target, ctx, buffer);
    for (let i = 0; i < n; i++) e.requestDespawn(e.idAt(buffer[i]!));
  });

  x.register('teleport', (a, ctx) => {
    const n = sim.matcher.resolve(a.target, ctx, buffer);
    if (n === 0) return;
    if (sim.map !== null && a.mapId === sim.map.def.id) {
      for (let i = 0; i < n; i++) sim.place(buffer[i]!, a.x, a.y);
      return;
    }
    // Across maps only persistent entities travel; the move happens at the end of the tick.
    let persistent = false;
    for (let i = 0; i < n; i++) if ((e.flags[buffer[i]!]! & F_PERSISTENT) !== 0) persistent = true;
    if (!persistent) {
      sim.diagnostics.report('teleport-not-persistent', 'A cross-map teleport matched no persistent entity; map entities cannot leave their map.');
      return;
    }
    if (!sim.mapById.has(a.mapId)) return;
    sim.pendingMapChange = { mapId: a.mapId, x: a.x, y: a.y };
  });
}
