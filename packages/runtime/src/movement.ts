/**
 * Movement and collision (spec 7.4): tick step 5.
 *
 *   1. Displacement = intent velocity + knockback velocity, split into two
 *      substeps when longer than the collider radius.
 *   2. The collider circle is tested against blocked edges: every shared
 *      edge where `connects` is false for the entity's mode.
 *   3. On contact the move slides along the edge; the normal component is
 *      removed.
 *   4. Walkers and swimmers then take z = surfaceHeight(x, y).
 *
 * Then separation: overlapping solid colliders whose height ranges also
 * overlap are pushed apart by their overlap, weighted by mass, in one pass.
 *
 * Nothing here allocates: every buffer is preallocated (law L8).
 */
import { F_COLLIDER, F_DEAD, F_MOVEMENT, F_SOLID, MAX_ENTITIES, RESTRICT_MOVE } from './entities.ts';
import type { MapInstance, Sim } from './sim.ts';
import { SECONDS_PER_TICK } from './time.ts';
import { MODE_FLY } from './world.ts';
import type { World } from './world.ts';

/** Radius used for entities that move but have no collider. */
const DEFAULT_RADIUS = 0.2;
/** A substep never moves the center further than this fraction of the radius, so it cannot cross an edge. */
const MAX_STEP = 0.9;
/** Knockback slower than this stops (world units per second). */
const REST_SPEED = 0.05;
/** Friction for an entity with no `motion` component. */
const DEFAULT_FRICTION = 12;
/** Flyers hold this many levels above the surface beneath them (spec 6.3). */
export const FLY_LEVELS = 2;

export class Movement {
  private readonly buffer = new Int32Array(MAX_ENTITIES);
  private readonly touched = new Uint8Array(MAX_ENTITIES);

  constructor(private readonly sim: Sim) {}

  /** Tick step 5. */
  step(): void {
    const sim = this.sim;
    const world = sim.world;
    const map = sim.map;
    if (world === null || map === null) return;
    const e = sim.entities;
    const dt = SECONDS_PER_TICK;
    const end = e.highWater;

    sim.paths.process();

    for (let i = 0; i < end; i++) {
      if (e.alive[i] !== 1) continue;
      if (e.airborne[i] === 1) {
        // A scripted jump carries it: no intent, no collision (jumps.ts moved it already).
        e.intentX[i] = 0;
        e.intentY[i] = 0;
        continue;
      }
      const moved = Math.hypot(e.x[i]! - e.prevX[i]!, e.y[i]! - e.prevY[i]!);
      e.prevX[i] = e.x[i]!;
      e.prevY[i] = e.y[i]!;
      e.prevZ[i] = e.z[i]!;
      const flags = e.flags[i]!;
      if ((flags & (F_COLLIDER | F_MOVEMENT)) === 0) continue;
      const data = e.data[i]!;
      const dead = (flags & F_DEAD) !== 0;

      let speed = 0;
      if ((flags & F_MOVEMENT) !== 0 && !dead && (e.restrict[i]! & RESTRICT_MOVE) === 0) speed = data.movement!.speed * e.speedScale[i]!;
      if (e.pathCount[i]! > 0 && e.intentX[i] === 0 && e.intentY[i] === 0) sim.paths.follow(i, speed, moved);
      else if (e.hasGoal[i] === 1) sim.paths.retry(i);

      let ix = e.intentX[i]!;
      let iy = e.intentY[i]!;
      e.intentX[i] = 0;
      e.intentY[i] = 0;
      if (e.hitstop[i]! > 0) continue; // frozen: no motion, and knockback waits

      // Facing turns toward the aim point when there is one, otherwise toward movement.
      if ((flags & F_MOVEMENT) !== 0 && !dead) {
        let want = e.facing[i]!;
        let turn = false;
        if (e.aiming[i] === 1) {
          const ax = e.aimX[i]! - e.x[i]!;
          const ay = e.aimY[i]! - e.y[i]!;
          if (ax !== 0 || ay !== 0) {
            want = Math.atan2(ay, ax);
            turn = true;
          }
        } else if (speed > 0 && (ix !== 0 || iy !== 0)) {
          want = Math.atan2(iy, ix);
          turn = true;
        }
        if (turn) e.facing[i] = turnToward(e.facing[i]!, want, data.movement!.turnRate * dt);
      }

      const length = Math.hypot(ix, iy);
      if (length > 1) {
        ix /= length;
        iy /= length;
      }
      // A dodge replaces walking with its dash; knockback still adds to either.
      const dashing = e.dodgeTicks[i]! > 0;
      const vx = (dashing ? e.dashX[i]! : ix * speed) + e.vx[i]!;
      const vy = (dashing ? e.dashY[i]! : iy * speed) + e.vy[i]!;
      if (vx === 0 && vy === 0) continue;

      const radius = data.collider ? data.collider.radius : DEFAULT_RADIUS;
      let dx = vx * dt;
      let dy = vy * dt;
      const distance = Math.hypot(dx, dy);
      const substeps = distance > radius ? 2 : 1;
      dx /= substeps;
      dy /= substeps;
      const limit = radius * MAX_STEP;
      if (distance / substeps > limit) {
        const k = limit / (distance / substeps);
        dx *= k;
        dy *= k;
      }
      const mask = e.mode[i]!;
      for (let s = 0; s < substeps; s++) {
        const px = e.x[i]!;
        const py = e.y[i]!;
        e.x[i] = px + dx;
        e.y[i] = py + dy;
        this.collide(world, i, radius, mask, px, py);
      }
      // A dodge lasts exactly its ticks of dash: the timer counts down after each one.
      if (dashing && --e.dodgeTicks[i]! === 0) {
        e.dashX[i] = 0;
        e.dashY[i] = 0;
      }

      // Friction decays knockback every tick.
      if (e.vx[i] !== 0 || e.vy[i] !== 0) {
        let k = 1 - (data.motion ? data.motion.friction : DEFAULT_FRICTION) * dt;
        if (k < 0) k = 0;
        e.vx[i] = e.vx[i]! * k;
        e.vy[i] = e.vy[i]! * k;
        if (Math.abs(e.vx[i]!) < REST_SPEED && Math.abs(e.vy[i]!) < REST_SPEED) {
          e.vx[i] = 0;
          e.vy[i] = 0;
        }
      }
    }

    this.separate(world);
    this.settle(world, map);
  }

  /**
   * Keep the collider circle out of every blocked edge near it. Pushing
   * out along the edge normal is what makes a move slide. (px, py) is where
   * the entity was before this substep, for the rare case it has nowhere to go.
   */
  collide(world: World, i: number, radius: number, mask: number, px: number, py: number): void {
    const e = this.sim.entities;
    const r2 = radius * radius;
    const inner = world.apothem - radius;
    for (let pass = 0; pass < 3; pass++) {
      const x = e.x[i]!;
      const y = e.y[i]!;
      const cell = world.cellAt(x, y);
      if (cell < 0 || (world.pass[cell]! & mask) === 0) {
        e.x[i] = px;
        e.y[i] = py;
        return;
      }
      // Well inside its own hex: no edge can be within reach.
      const ox = x - world.centerX(cell);
      const oy = y - world.centerY(cell);
      if (inner > 0 && ox * ox + oy * oy < inner * inner) return;

      let pushed = false;
      for (let k = 0; k < 7; k++) {
        const c = k === 0 ? cell : world.neighbor[cell * 6 + k - 1]!;
        if (c < 0) continue;
        const cx = world.centerX(c);
        const cy = world.centerY(c);
        for (let d = 0; d < 6; d++) {
          if ((world.link[c * 6 + d]! & mask) !== 0) continue; // an open edge
          const ax = cx + world.edgeAX[d]!;
          const ay = cy + world.edgeAY[d]!;
          const sx = world.edgeBX[d]! - world.edgeAX[d]!;
          const sy = world.edgeBY[d]! - world.edgeAY[d]!;
          let t = ((e.x[i]! - ax) * sx + (e.y[i]! - ay) * sy) / (sx * sx + sy * sy);
          if (t < 0) t = 0;
          else if (t > 1) t = 1;
          const qx = ax + sx * t;
          const qy = ay + sy * t;
          let nx = e.x[i]! - qx;
          let ny = e.y[i]! - qy;
          const d2 = nx * nx + ny * ny;
          if (d2 >= r2 - 1e-12) continue;
          const dist = Math.sqrt(d2);
          if (dist > 1e-9) {
            nx /= dist;
            ny /= dist;
          } else {
            // Exactly on the edge: push back toward where we came from.
            nx = px - qx;
            ny = py - qy;
            const n = Math.hypot(nx, ny);
            if (n < 1e-9) continue;
            nx /= n;
            ny /= n;
          }
          const push = radius - dist;
          e.x[i] = e.x[i]! + nx * push;
          e.y[i] = e.y[i]! + ny * push;
          // Knockback loses its component into the wall, so it slides along instead of grinding.
          const vn = e.vx[i]! * nx + e.vy[i]! * ny;
          if (vn < 0) {
            e.vx[i] = e.vx[i]! - vn * nx;
            e.vy[i] = e.vy[i]! - vn * ny;
          }
          pushed = true;
        }
      }
      if (!pushed) return;
    }
    // Still inside something after three passes (a tight corner): stay where we were.
    const cell = world.cellAt(e.x[i]!, e.y[i]!);
    if (cell < 0 || (world.pass[cell]! & mask) === 0 || this.overlaps(world, i, radius, mask)) {
      e.x[i] = px;
      e.y[i] = py;
    }
  }

  /** Is the collider circle still overlapping a blocked edge of its own cell? */
  private overlaps(world: World, i: number, radius: number, mask: number): boolean {
    const e = this.sim.entities;
    const cell = world.cellAt(e.x[i]!, e.y[i]!);
    const cx = world.centerX(cell);
    const cy = world.centerY(cell);
    for (let d = 0; d < 6; d++) {
      if ((world.link[cell * 6 + d]! & mask) !== 0) continue;
      const ax = cx + world.edgeAX[d]!;
      const ay = cy + world.edgeAY[d]!;
      const sx = world.edgeBX[d]! - world.edgeAX[d]!;
      const sy = world.edgeBY[d]! - world.edgeAY[d]!;
      let t = ((e.x[i]! - ax) * sx + (e.y[i]! - ay) * sy) / (sx * sx + sy * sy);
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const nx = e.x[i]! - (ax + sx * t);
      const ny = e.y[i]! - (ay + sy * t);
      if (nx * nx + ny * ny < radius * radius * 0.98) return true;
    }
    return false;
  }

  /** One pass of pushing overlapping solid colliders apart. */
  private separate(world: World): void {
    const sim = this.sim;
    const e = sim.entities;
    const hash = sim.hash;
    if (hash === null) return;
    const end = e.highWater;
    const buffer = this.buffer;
    // Index everything where it now stands.
    for (let i = 0; i < end; i++) {
      if (e.alive[i] !== 1) continue;
      const cell = world.cellAt(e.x[i]!, e.y[i]!);
      if (cell < 0) hash.remove(i);
      else hash.update(i, cell);
    }
    const pitchX = Math.sqrt(3) * world.hexSize;
    const pitchY = 1.5 * world.hexSize;
    let any = false;
    for (let i = 0; i < end; i++) {
      if (e.alive[i] !== 1 || (e.flags[i]! & (F_SOLID | F_DEAD)) !== F_SOLID || e.airborne[i] === 1) continue;
      const cell = hash.cellOfItem(i);
      if (cell < 0) continue;
      const di = e.data[i]!;
      const ri = di.collider!.radius;
      const reach = ri + sim.maxRadius;
      const spanX = Math.ceil(reach / pitchX) + 1;
      const spanY = Math.ceil(reach / pitchY) + 1;
      const col = cell % world.width;
      const row = (cell - col) / world.width;
      const n = hash.queryRange(col - spanX, row - spanY, col + spanX, row + spanY, buffer);
      // Bucket order depends on history; sort so the result does not (law L5).
      for (let a = 1; a < n; a++) {
        const v = buffer[a]!;
        let b = a - 1;
        while (b >= 0 && buffer[b]! > v) {
          buffer[b + 1] = buffer[b]!;
          b--;
        }
        buffer[b + 1] = v;
      }
      const fixedI = (e.flags[i]! & F_MOVEMENT) === 0 && di.motion === undefined;
      for (let k = 0; k < n; k++) {
        const j = buffer[k]!;
        if (j <= i || (e.flags[j]! & (F_SOLID | F_DEAD)) !== F_SOLID || e.airborne[j] === 1) continue;
        const dj = e.data[j]!;
        const rj = dj.collider!.radius;
        let nx = e.x[j]! - e.x[i]!;
        let ny = e.y[j]! - e.y[i]!;
        const d2 = nx * nx + ny * ny;
        const min = ri + rj;
        if (d2 >= min * min) continue;
        // Entities on different levels do not push each other.
        if (e.z[i]! + di.collider!.height <= e.z[j]! || e.z[j]! + dj.collider!.height <= e.z[i]!) continue;
        const fixedJ = (e.flags[j]! & F_MOVEMENT) === 0 && dj.motion === undefined;
        if (fixedI && fixedJ) continue;
        const dist = Math.sqrt(d2);
        if (dist > 1e-9) {
          nx /= dist;
          ny /= dist;
        } else {
          nx = 1;
          ny = 0;
        }
        const overlap = min - dist;
        const mi = di.motion ? di.motion.mass : 1;
        const mj = dj.motion ? dj.motion.mass : 1;
        // The heavier one moves less; something with no movement and no motion does not move at all.
        const wi = fixedI ? 0 : fixedJ ? 1 : mj / (mi + mj);
        const wj = fixedJ ? 0 : 1 - wi;
        if (wi > 0) {
          e.x[i] = e.x[i]! - nx * overlap * wi;
          e.y[i] = e.y[i]! - ny * overlap * wi;
          this.touched[i] = 1;
        }
        if (wj > 0) {
          e.x[j] = e.x[j]! + nx * overlap * wj;
          e.y[j] = e.y[j]! + ny * overlap * wj;
          this.touched[j] = 1;
        }
        any = true;
      }
    }
    if (!any) return;
    // Being pushed obeys the same blocked edges as moving.
    for (let i = 0; i < end; i++) {
      if (this.touched[i] !== 1) continue;
      this.touched[i] = 0;
      this.collide(world, i, e.data[i]!.collider!.radius, e.mode[i]!, e.prevX[i]!, e.prevY[i]!);
    }
  }

  /** Stand on the surface, re-index, and raise region events for whoever changed cell. */
  private settle(world: World, map: MapInstance): void {
    const sim = this.sim;
    const e = sim.entities;
    const hash = sim.hash!;
    const end = e.highWater;
    const regions = map.regionList;
    const lift = FLY_LEVELS * world.levelHeight;
    for (let i = 0; i < end; i++) {
      if (e.alive[i] !== 1) continue;
      const x = e.x[i]!;
      const y = e.y[i]!;
      const cell = world.cellAt(x, y);
      if (e.airborne[i] === 0) {
        const ground = cell < 0 ? 0 : world.surfaceHeightIn(cell, x, y);
        e.z[i] = e.mode[i] === MODE_FLY ? ground + lift : ground;
      }
      if (cell < 0) hash.remove(i);
      else hash.update(i, cell);
      if (e.airborne[i] === 1) continue; // in flight it is over cells, not on them: regions wait for the landing
      const last = e.lastCell[i]!;
      if (cell === last) continue;
      e.lastCell[i] = cell;
      if (regions.length === 0) continue;
      const id = e.idAt(i);
      for (let r = 0; r < regions.length; r++) {
        const mask = regions[r]!.mask;
        if (last >= 0 && mask[last] === 1 && (cell < 0 || mask[cell] === 0)) sim.bus.raise('region-exited', id, -1, regions[r]!.id);
      }
      for (let r = 0; r < regions.length; r++) {
        const mask = regions[r]!.mask;
        if (cell >= 0 && mask[cell] === 1 && (last < 0 || mask[last] === 0)) sim.bus.raise('region-entered', id, -1, regions[r]!.id);
      }
    }
  }
}

/** Rotate `from` toward `to` by at most `max` radians, the short way round. */
export function turnToward(from: number, to: number, max: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  if (delta > max) delta = max;
  else if (delta < -max) delta = -max;
  let out = from + delta;
  if (out > Math.PI) out -= 2 * Math.PI;
  else if (out < -Math.PI) out += 2 * Math.PI;
  return out;
}
