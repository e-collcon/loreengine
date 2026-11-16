/**
 * The entity store (spec 7.3, law L2). An entity is a 32-bit id: 16 bits
 * of index, 16 of generation. A stale id fails `isAlive`; it never resolves
 * to the wrong entity. There is no class hierarchy: an entity is a slot in
 * a set of parallel arrays, and what it can do follows from which
 * components its archetype carries.
 *
 * Hot state is struct-of-arrays in typed arrays, so a tick touches
 * contiguous memory and allocates nothing. Authored component data is not
 * copied: each entity points at its (shared, read-only) `ComponentData`.
 *
 * Determinism: a new entity always takes the lowest free index, and
 * iteration is always in ascending index. Despawns are deferred to the end
 * of the tick, so no system iterates a list that changes under it.
 */
import type { ComponentData } from '@loreengine/schema';

export type EntityId = number;
export const NO_ENTITY: EntityId = -1;
export const MAX_ENTITIES = 8192;

/** Component-presence and status bits, per entity. */
export const F_PLAYER = 1 << 0; //      playerControlled
export const F_PERSISTENT = 1 << 1; //  survives map changes
export const F_HEALTH = 1 << 2;
export const F_COLLIDER = 1 << 3;
export const F_SOLID = 1 << 4;
export const F_MOVEMENT = 1 << 5;
export const F_DEAD = 1 << 6; //        health reached zero; still present until despawn
export const F_SPAWNED = 1 << 7; //     created at runtime, not by a placement
export const F_DESPAWNING = 1 << 8; //  despawn requested; removed at the end of the tick

/** Up to 64 waypoints of (x, y) per entity (spec 9.2). */
export const MAX_WAYPOINTS = 64;
export const WAYPOINT_STRIDE = MAX_WAYPOINTS * 2;

/** What active effects forbid (spec 7.10). */
export const RESTRICT_MOVE = 1 << 0;
export const RESTRICT_ATTACK = 1 << 1;
export const RESTRICT_DODGE = 1 << 2;
export const RESTRICT_ACT = 1 << 3;
/** What active effects grant. */
export const STATUS_INVULNERABLE = 1 << 0;
export const STATUS_UNTARGETABLE = 1 << 1;

/** Click orders (spec 7.9b). */
export const ORDER_NONE = 0;
export const ORDER_MOVE = 1; //     walk to a ground point
export const ORDER_ATTACK = 2; //   path into range of a hostile, face it, swing
export const ORDER_USE = 3; //      path into an interactable's radius and raise `interacted`
export const ORDER_APPROACH = 4; // move next to any other entity

const EMPTY: ComponentData = {};

export function indexOfId(id: EntityId): number {
  return id & 0xffff;
}
export function generationOfId(id: EntityId): number {
  return id >>> 16;
}

export class EntityStore {
  readonly capacity = MAX_ENTITIES;
  readonly generation = new Uint16Array(MAX_ENTITIES);
  readonly alive = new Uint8Array(MAX_ENTITIES);
  readonly flags = new Uint16Array(MAX_ENTITIES);
  /** Index into `project.archetypes`. */
  readonly archetype = new Int32Array(MAX_ENTITIES).fill(-1);
  /** Index into `project.factions`, or -1. */
  readonly faction = new Int32Array(MAX_ENTITIES).fill(-1);
  /** Effective authored components: the archetype's, with placement overrides applied. */
  readonly data: ComponentData[] = new Array<ComponentData>(MAX_ENTITIES).fill(EMPTY);
  /** Placement key, or '' for runtime-spawned and persistent entities. */
  readonly placementKey: string[] = new Array<string>(MAX_ENTITIES).fill('');

  // Transform. prev* feed render interpolation.
  readonly x = new Float64Array(MAX_ENTITIES);
  readonly y = new Float64Array(MAX_ENTITIES);
  readonly z = new Float64Array(MAX_ENTITIES);
  readonly facing = new Float64Array(MAX_ENTITIES);
  readonly prevX = new Float64Array(MAX_ENTITIES);
  readonly prevY = new Float64Array(MAX_ENTITIES);
  readonly prevZ = new Float64Array(MAX_ENTITIES);

  // HealthState.
  readonly hp = new Float64Array(MAX_ENTITIES);
  readonly hpMax = new Float64Array(MAX_ENTITIES);

  // Movement. `mode` is a MODE_* bit; the intent is this tick's desired velocity, consumed by movement.
  readonly mode = new Uint8Array(MAX_ENTITIES);
  readonly intentX = new Float64Array(MAX_ENTITIES);
  readonly intentY = new Float64Array(MAX_ENTITIES);
  /** Where to face: 0 along movement, 1 toward (aimX, aimY). */
  readonly aiming = new Uint8Array(MAX_ENTITIES);
  readonly aimX = new Float64Array(MAX_ENTITIES);
  readonly aimY = new Float64Array(MAX_ENTITIES);
  /** The cell the entity was on after the last movement step, or -1: region events compare against it. */
  readonly lastCell = new Int32Array(MAX_ENTITIES).fill(-1);

  // MotionState: knockback velocity and hitstop.
  readonly vx = new Float64Array(MAX_ENTITIES);
  readonly vy = new Float64Array(MAX_ENTITIES);
  readonly hitstop = new Int32Array(MAX_ENTITIES);
  /** Bits of what active effects forbid (RESTRICT_*), and what they grant (STATUS_*). */
  readonly restrict = new Uint8Array(MAX_ENTITIES);
  readonly status = new Uint8Array(MAX_ENTITIES);
  /** 1 while a scripted jump carries the entity: movement leaves it alone and input is ignored. */
  readonly airborne = new Uint8Array(MAX_ENTITIES);
  /** Movement speed factor for this tick: 1, 0.4 while an attack is `slowed`, 0 while `rooted`. */
  readonly speedScale = new Float64Array(MAX_ENTITIES).fill(1);

  // PathState: up to 64 waypoints of (x, y).
  readonly waypoints = new Float64Array(MAX_ENTITIES * WAYPOINT_STRIDE);
  readonly pathCount = new Uint8Array(MAX_ENTITIES);
  readonly pathIndex = new Uint8Array(MAX_ENTITIES);
  /** 1 while the entity wants to reach (goalX, goalY). */
  readonly hasGoal = new Uint8Array(MAX_ENTITIES);
  readonly goalX = new Float64Array(MAX_ENTITIES);
  readonly goalY = new Float64Array(MAX_ENTITIES);
  /** Sequence number of a queued path request, or -1. */
  readonly pathPending = new Float64Array(MAX_ENTITIES).fill(-1);
  /** Tick before which no new path is requested (a failed search retries after 0.5 s). */
  readonly repathAt = new Float64Array(MAX_ENTITIES);
  /** Consecutive ticks of following a path without getting anywhere. */
  readonly blockedTicks = new Int32Array(MAX_ENTITIES);

  // Acquisition: the current target and when it was last seen.
  readonly target = new Float64Array(MAX_ENTITIES).fill(-1);
  readonly lastSeen = new Float64Array(MAX_ENTITIES);

  // BrainState.
  /** Index into the compiled brains, or -1. */
  readonly brain = new Int32Array(MAX_ENTITIES).fill(-1);
  readonly brainState = new Int32Array(MAX_ENTITIES);
  readonly brainEntered = new Float64Array(MAX_ENTITIES);
  readonly homeX = new Float64Array(MAX_ENTITIES);
  readonly homeY = new Float64Array(MAX_ENTITIES);
  readonly patrolIndex = new Int32Array(MAX_ENTITIES);
  /** Tick at which a wandering brain picks its next point. */
  readonly wanderAt = new Float64Array(MAX_ENTITIES);

  // The player's click order (spec 7.9b): ORDER_* kind, its target entity, and its ground point.
  readonly orderKind = new Uint8Array(MAX_ENTITIES);
  readonly orderTarget = new Float64Array(MAX_ENTITIES).fill(-1);
  readonly orderX = new Float64Array(MAX_ENTITIES);
  readonly orderY = new Float64Array(MAX_ENTITIES);

  private readonly byPlacement = new Map<string, number>();
  private readonly pending = new Int32Array(MAX_ENTITIES);
  private pendingCount = 0;
  private live = 0;
  private lowestFree = 0;
  /** One past the highest index ever used: the bound for iteration. */
  highWater = 0;

  get count(): number {
    return this.live;
  }

  idAt(index: number): EntityId {
    return this.generation[index]! * 65536 + index;
  }

  isAlive(id: EntityId): boolean {
    const index = id & 0xffff;
    return index < MAX_ENTITIES && this.alive[index] === 1 && this.generation[index] === id >>> 16;
  }

  /** The index of a live entity, or -1 for a stale or empty id. */
  indexOf(id: EntityId): number {
    return this.isAlive(id) ? id & 0xffff : -1;
  }

  /** Present and not dead: what conditions and acquisition mean by "alive". */
  isActive(index: number): boolean {
    return this.alive[index] === 1 && (this.flags[index]! & F_DEAD) === 0;
  }

  indexOfPlacement(key: string): number {
    return this.byPlacement.get(key) ?? -1;
  }

  /**
   * Create an entity. Returns NO_ENTITY at the 8,192 cap (spec 9.2).
   * `forcedId` restores a saved entity into its exact slot and generation.
   */
  spawn(
    archetypeIndex: number,
    data: ComponentData,
    factionIndex: number,
    x: number,
    y: number,
    z: number,
    facing: number,
    placementKey: string,
    spawned: boolean,
    forcedId: EntityId = NO_ENTITY,
  ): EntityId {
    let index: number;
    if (forcedId !== NO_ENTITY) {
      index = forcedId & 0xffff;
      if (index >= MAX_ENTITIES || this.alive[index] === 1) return NO_ENTITY;
      this.generation[index] = forcedId >>> 16;
    } else {
      if (this.live >= MAX_ENTITIES) return NO_ENTITY;
      index = this.lowestFree;
      while (this.alive[index] === 1) index++;
    }
    this.alive[index] = 1;
    this.live++;
    if (index >= this.highWater) this.highWater = index + 1;
    if (index === this.lowestFree) {
      let next = index + 1;
      while (next < MAX_ENTITIES && this.alive[next] === 1) next++;
      this.lowestFree = next;
    }

    let flags = spawned ? F_SPAWNED : 0;
    if (data.playerControlled) flags |= F_PLAYER;
    if (data.persistent) flags |= F_PERSISTENT;
    if (data.health) flags |= F_HEALTH;
    if (data.collider) flags |= F_COLLIDER;
    if (data.collider?.solid) flags |= F_SOLID;
    if (data.movement) flags |= F_MOVEMENT;
    this.flags[index] = flags;
    this.archetype[index] = archetypeIndex;
    this.faction[index] = factionIndex;
    this.data[index] = data;
    this.placementKey[index] = placementKey;
    if (placementKey !== '') this.byPlacement.set(placementKey, index);
    this.x[index] = this.prevX[index] = x;
    this.y[index] = this.prevY[index] = y;
    this.z[index] = this.prevZ[index] = z;
    this.facing[index] = facing;
    const max = data.health ? data.health.max : 0;
    this.hp[index] = max;
    this.hpMax[index] = max;
    // A slot is reused: every piece of runtime-only state starts clean.
    this.mode[index] = 0;
    this.intentX[index] = this.intentY[index] = 0;
    this.aiming[index] = 0;
    this.aimX[index] = this.aimY[index] = 0;
    this.lastCell[index] = -1;
    this.vx[index] = this.vy[index] = 0;
    this.hitstop[index] = 0;
    this.restrict[index] = 0;
    this.status[index] = 0;
    this.speedScale[index] = 1;
    this.airborne[index] = 0;
    this.pathCount[index] = this.pathIndex[index] = 0;
    this.hasGoal[index] = 0;
    this.goalX[index] = this.goalY[index] = 0;
    this.pathPending[index] = -1;
    this.repathAt[index] = 0;
    this.blockedTicks[index] = 0;
    this.target[index] = NO_ENTITY;
    this.lastSeen[index] = 0;
    this.brain[index] = -1;
    this.brainState[index] = 0;
    this.brainEntered[index] = 0;
    this.homeX[index] = x;
    this.homeY[index] = y;
    this.patrolIndex[index] = 0;
    this.wanderAt[index] = 0;
    this.orderKind[index] = 0;
    this.orderTarget[index] = NO_ENTITY;
    this.orderX[index] = this.orderY[index] = 0;
    return this.generation[index]! * 65536 + index;
  }

  /** Ask for an entity to be removed at the end of this tick. */
  requestDespawn(id: EntityId): void {
    const index = this.indexOf(id);
    if (index < 0 || (this.flags[index]! & F_DESPAWNING) !== 0) return;
    this.flags[index] = this.flags[index]! | F_DESPAWNING;
    this.pending[this.pendingCount++] = index;
  }

  get pendingDespawns(): number {
    return this.pendingCount;
  }

  /**
   * End of tick: free every entity whose despawn was requested, in request
   * order. `onRemove` sees each one while its data is still readable.
   */
  flushDespawns(onRemove: (index: number) => void): void {
    for (let k = 0; k < this.pendingCount; k++) {
      const index = this.pending[k]!;
      if (this.alive[index] !== 1) continue;
      onRemove(index);
      this.free(index);
    }
    this.pendingCount = 0;
  }

  /** Remove at once. Only for scope disposal (map unload), never mid-tick. */
  removeNow(index: number): void {
    if (this.alive[index] === 1) this.free(index);
  }

  private free(index: number): void {
    const key = this.placementKey[index]!;
    if (key !== '' && this.byPlacement.get(key) === index) this.byPlacement.delete(key);
    this.alive[index] = 0;
    this.flags[index] = 0;
    this.data[index] = EMPTY;
    this.placementKey[index] = '';
    this.archetype[index] = -1;
    this.faction[index] = -1;
    // Reuse bumps the generation, so every id handed out for this slot goes stale now.
    this.generation[index] = (this.generation[index]! + 1) & 0xffff;
    this.live--;
    if (index < this.lowestFree) this.lowestFree = index;
  }

  /** Generations up to the high-water mark, for the save. */
  exportGenerations(): number[] {
    return Array.from(this.generation.subarray(0, this.highWater));
  }

  /** Restore generations into an EMPTY store, before any entity is spawned. */
  importGenerations(generations: readonly number[]): void {
    for (let i = 0; i < generations.length && i < MAX_ENTITIES; i++) this.generation[i] = generations[i]!;
    this.highWater = Math.min(generations.length, MAX_ENTITIES);
  }
}
