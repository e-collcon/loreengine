/**
 * Pathfinding (spec 7.5). The ported A* runs over cells, with neighbors
 * filtered by `connects` for the requester's mode and costs scaled by
 * `moveCost`. The result is string-pulled into straight runs wherever the
 * straight line crosses only connecting edges.
 *
 * Budgets (spec 9.2): 4,096 expansions per request, 256 cells per path, 64
 * waypoints after smoothing, 8 requests per tick with the rest queued to
 * the next tick in request order.
 */
import { findPath } from '@loreengine/algorithms';
import type { PathGrid } from '@loreengine/algorithms';
import { MAX_ENTITIES, MAX_WAYPOINTS, WAYPOINT_STRIDE } from './entities.ts';
import type { Sim } from './sim.ts';
import { SECONDS_PER_TICK, TICK_HZ } from './time.ts';
import type { World } from './world.ts';

export const MAX_PATH_CELLS = 256;
export const MAX_PATH_REQUESTS_PER_TICK = 8;
export const MAX_EXPANSIONS = 4096;
/** A failed or exhausted search is retried after 0.5 s; so is a blocked walker. */
export const REPATH_TICKS = TICK_HZ / 2;
/** How far ahead string-pulling looks for a straight run, in path cells. */
const LOOKAHEAD = 24;

export class Paths {
  /** Entity indices waiting for a path, oldest first. */
  private readonly queue = new Int32Array(MAX_ENTITIES);
  private head = 0;
  private length = 0;
  private sequence = 0;
  private mask = 0;
  /** While string-pulling: the costliest terrain a straight run may cross. */
  private maxCost = Infinity;
  private world: World | null = null;
  private readonly grid: PathGrid;
  /** Result of the last search, for tests and the debug overlay. */
  lastStatus: 'found' | 'unreachable' | 'exhausted' | 'invalid' = 'invalid';
  lastExplored = 0;

  constructor(private readonly sim: Sim) {
    const self = this;
    this.grid = {
      get width() {
        return self.world!.width;
      },
      get height() {
        return self.world!.height;
      },
      passable: (cell) => self.world!.passable(cell, self.mask),
      connects: (a, b) => {
        const w = self.world!;
        const base = a * 6;
        for (let d = 0; d < 6; d++) if (w.neighbor[base + d] === b) return (w.link[base + d]! & self.mask) !== 0;
        return false;
      },
      moveCost: (cell) => self.world!.cost[cell]!,
    };
  }

  get queued(): number {
    return this.length;
  }

  /** Ask for a path to (x, y). The search runs in the movement step, at most 8 per tick. */
  request(index: number, x: number, y: number): void {
    const e = this.sim.entities;
    e.hasGoal[index] = 1;
    e.goalX[index] = x;
    e.goalY[index] = y;
    if (e.pathPending[index]! >= 0) return; // already queued: it will use the newest goal
    e.pathPending[index] = this.sequence++;
    this.queue[(this.head + this.length) % MAX_ENTITIES] = index;
    this.length++;
  }

  /** Drop an entity's path, goal, and any queued request. */
  clear(index: number): void {
    const e = this.sim.entities;
    e.pathCount[index] = 0;
    e.pathIndex[index] = 0;
    e.hasGoal[index] = 0;
    e.pathPending[index] = -1; // its queue entry is skipped when reached
    e.blockedTicks[index] = 0;
    e.repathAt[index] = 0;
  }

  /** Is the entity still on its way: a path to follow, or a request in the queue? */
  busy(index: number): boolean {
    const e = this.sim.entities;
    return e.pathCount[index]! > 0 || e.pathPending[index]! >= 0;
  }

  /** Run up to 8 queued searches, in request order. */
  process(): void {
    const e = this.sim.entities;
    let done = 0;
    while (this.length > 0 && done < MAX_PATH_REQUESTS_PER_TICK) {
      const index = this.queue[this.head]!;
      this.head = (this.head + 1) % MAX_ENTITIES;
      this.length--;
      if (e.alive[index] !== 1 || e.pathPending[index]! < 0) continue; // cancelled, or the entity is gone
      e.pathPending[index] = -1;
      this.search(index);
      done++;
    }
  }

  /** An entity's place in the queue (0 = next), or -1 when it has no request waiting. */
  rankOf(index: number): number {
    const e = this.sim.entities;
    if (e.pathPending[index]! < 0) return -1;
    let rank = 0;
    for (let k = 0; k < this.length; k++) {
      const other = this.queue[(this.head + k) % MAX_ENTITIES]!;
      if (other === index) return rank;
      if (e.alive[other] === 1 && e.pathPending[other]! >= 0) rank++;
    }
    return -1;
  }

  /** Forget every queued request (map unload: the map scope owns them). */
  reset(): void {
    this.head = 0;
    this.length = 0;
  }

  /** Rebuild the queue from saved per-entity sequence numbers, oldest first. */
  restoreQueue(): void {
    const e = this.sim.entities;
    this.reset();
    const pending: number[] = [];
    for (let i = 0; i < e.highWater; i++) if (e.alive[i] === 1 && e.pathPending[i]! >= 0) pending.push(i);
    pending.sort((a, b) => e.pathPending[a]! - e.pathPending[b]!);
    for (const index of pending) {
      this.queue[this.length++] = index;
      if (e.pathPending[index]! >= this.sequence) this.sequence = e.pathPending[index]! + 1;
    }
  }

  private search(index: number): void {
    const sim = this.sim;
    const e = sim.entities;
    const world = sim.world;
    e.pathCount[index] = 0;
    e.pathIndex[index] = 0;
    e.blockedTicks[index] = 0;
    e.repathAt[index] = 0;
    if (world === null) {
      e.hasGoal[index] = 0;
      return;
    }
    this.world = world;
    this.mask = e.mode[index]!;
    const start = world.cellAt(e.x[index]!, e.y[index]!);
    const gx = e.goalX[index]!;
    const gy = e.goalY[index]!;
    const goal = world.cellAt(gx, gy);
    const result = findPath(this.grid, start, goal, { maxExplored: MAX_EXPANSIONS });
    this.lastStatus = result.status;
    this.lastExplored = result.explored;
    if (result.status === 'invalid') {
      e.hasGoal[index] = 0;
      return;
    }
    const cells = result.path;
    const reached = result.status === 'found' && cells.length <= MAX_PATH_CELLS;
    if (cells.length > MAX_PATH_CELLS) cells.length = MAX_PATH_CELLS; // truncated: walk as far as the cap reaches
    if (result.status === 'exhausted') e.repathAt[index] = sim.tick + REPATH_TICKS; // retry from wherever we get to

    // String-pull: from each anchor, jump to the farthest cell center a straight walk can reach.
    const radius = e.data[index]!.collider ? e.data[index]!.collider!.radius : 0;
    const base = index * WAYPOINT_STRIDE;
    let count = 0;
    let ax = e.x[index]!;
    let ay = e.y[index]!;
    let i = 0;
    while (i < cells.length && count < MAX_WAYPOINTS) {
      let j = i;
      const far = Math.min(cells.length - 1, i + LOOKAHEAD);
      for (let k = far; k > i; k--) {
        // A shortcut may not cross terrain costlier than the stretch of path it replaces,
        // or smoothing would undo what A* paid a detour to avoid.
        let cost = world.cost[cells[i]!]!;
        for (let c = i + 1; c <= k; c++) if (world.cost[cells[c]!]! > cost) cost = world.cost[cells[c]!]!;
        this.maxCost = cost;
        if (this.walkable(world, ax, ay, world.centerX(cells[k]!), world.centerY(cells[k]!), radius)) {
          j = k;
          break;
        }
      }
      this.maxCost = Infinity;
      ax = world.centerX(cells[j]!);
      ay = world.centerY(cells[j]!);
      e.waypoints[base + count * 2] = ax;
      e.waypoints[base + count * 2 + 1] = ay;
      count++;
      i = j + 1;
    }
    if (reached) {
      // End on the exact point asked for, not the cell's center.
      if (count === 0) count = 1;
      e.waypoints[base + (count - 1) * 2] = gx;
      e.waypoints[base + (count - 1) * 2 + 1] = gy;
    }
    e.pathCount[index] = count;
    if (count === 0) e.hasGoal[index] = 0; // nowhere to go: already at the nearest reachable point
  }

  /**
   * Does the straight line from (x0, y0) to (x1, y1) cross only connecting
   * edges, for a walker `radius` wide? Conservative: an ambiguous corner
   * counts as blocked.
   */
  walkable(world: World, x0: number, y0: number, x1: number, y1: number, radius: number): boolean {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.hypot(dx, dy);
    if (length < 1e-9) return true;
    if (!this.lineClear(world, x0, y0, dx, dy, length)) return false;
    if (radius <= 0) return true;
    const ox = (-dy / length) * radius * 0.8;
    const oy = (dx / length) * radius * 0.8;
    return this.lineClear(world, x0 + ox, y0 + oy, dx, dy, length) && this.lineClear(world, x0 - ox, y0 - oy, dx, dy, length);
  }

  private lineClear(world: World, x0: number, y0: number, dx: number, dy: number, length: number): boolean {
    const steps = Math.max(1, Math.ceil(length / (world.hexSize * 0.2)));
    let cell = world.cellAt(x0, y0);
    if (!world.passable(cell, this.mask)) return false;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const next = world.cellAt(x0 + dx * t, y0 + dy * t);
      if (next === cell) continue;
      if (next < 0) return false;
      let linked = false;
      const base = cell * 6;
      for (let d = 0; d < 6; d++) {
        if (world.neighbor[base + d] === next) {
          linked = (world.link[base + d]! & this.mask) !== 0;
          break;
        }
      }
      if (!linked) return false; // a blocked edge, or two cells crossed in one step (a corner)
      if (world.cost[next]! > this.maxCost) return false;
      cell = next;
    }
    return true;
  }

  /**
   * Turn an entity's path into this tick's intent: head for the current
   * waypoint, advance when it is reached, stop at the last one. `moved` is
   * how far the entity got last tick, for blocked detection.
   */
  follow(index: number, speed: number, moved: number): void {
    const sim = this.sim;
    const e = sim.entities;
    const count = e.pathCount[index]!;
    if (count === 0) return;
    const stepLength = speed * SECONDS_PER_TICK;
    if (stepLength <= 0) return;

    // Blocked for more than 0.5 s: ask again (spec 7.5).
    if (moved < stepLength * 0.2) {
      if (++e.blockedTicks[index]! > REPATH_TICKS) {
        e.blockedTicks[index] = 0;
        if (e.hasGoal[index] === 1) this.request(index, e.goalX[index]!, e.goalY[index]!);
      }
    } else e.blockedTicks[index] = 0;

    const base = index * WAYPOINT_STRIDE;
    let at = e.pathIndex[index]!;
    let dx = e.waypoints[base + at * 2]! - e.x[index]!;
    let dy = e.waypoints[base + at * 2 + 1]! - e.y[index]!;
    let distance = Math.hypot(dx, dy);
    // Pass through waypoints already within this tick's reach.
    while (distance <= stepLength && at < count - 1) {
      at++;
      dx = e.waypoints[base + at * 2]! - e.x[index]!;
      dy = e.waypoints[base + at * 2 + 1]! - e.y[index]!;
      distance = Math.hypot(dx, dy);
    }
    e.pathIndex[index] = at;
    if (distance <= 1e-6) {
      this.arrive(index);
      return;
    }
    if (distance <= stepLength) {
      // The last waypoint is within reach: land on it exactly, and be done.
      const k = distance / stepLength;
      e.intentX[index] = (dx / distance) * k;
      e.intentY[index] = (dy / distance) * k;
      this.arrive(index);
      return;
    }
    e.intentX[index] = dx / distance;
    e.intentY[index] = dy / distance;
  }

  private arrive(index: number): void {
    const e = this.sim.entities;
    e.pathCount[index] = 0;
    e.pathIndex[index] = 0;
    e.blockedTicks[index] = 0;
    // After an exhausted search the goal stays: `retry` asks again once 0.5 s have passed.
    if (e.repathAt[index]! > 0) return;
    e.hasGoal[index] = 0;
  }

  /** An exhausted search retries after 0.5 s, from wherever the partial path led. */
  retry(index: number): void {
    const e = this.sim.entities;
    if (e.repathAt[index]! <= 0 || e.hasGoal[index] !== 1 || e.pathCount[index]! > 0 || e.pathPending[index]! >= 0) return;
    if (this.sim.tick < e.repathAt[index]!) return;
    e.repathAt[index] = 0;
    this.request(index, e.goalX[index]!, e.goalY[index]!);
  }
}
