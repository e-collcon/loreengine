/**
 * Height-aware sight (spec 7.6). One 3D segment cast serves sight now and
 * projectiles and skill targeting in Phase 10 (law L6: one raycast).
 *
 * The cast walks the cells under the segment. In each cell it blocks if the
 * segment passes below the column's surface, or if the terrain blocks that
 * mode (such terrain acts as an infinitely tall wall). A cell's surface is
 * a plane and the segment's height is linear, so testing where the segment
 * enters and leaves each cell is exact. Entity hits test each collider
 * cylinder along the way.
 *
 * The hot-path form writes its result into fields and allocates nothing.
 */
import { F_COLLIDER, F_DEAD, MAX_ENTITIES, NO_ENTITY, STATUS_UNTARGETABLE } from './entities.ts';
import type { EntityId } from './entities.ts';
import type { Sim } from './sim.ts';

export const HIT_NONE = 0;
export const HIT_TERRAIN = 1;
export const HIT_ENTITY = 2;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
export interface CastOptions {
  /** Which terrain flag blocks. */
  mode: 'sight' | 'projectile';
  ignore?: EntityId;
  hitEntities: boolean;
}
export interface CastResult {
  hit: 'none' | 'terrain' | 'entity';
  /** How far along the segment, 0..1; 1 when nothing was hit. */
  t: number;
  cell?: number;
  entity?: EntityId;
}

const EPS = 1e-6;
/** Sampling step along the segment, as a fraction of hexSize. */
const STEP = 0.2;
const BISECT = 12;

export class Sight {
  /** Result of the last `cast`: HIT_*, how far along (0..1), and what. */
  hit = HIT_NONE;
  t = 1;
  cell = -1;
  /** Entity index of an entity hit, or -1. */
  entity = -1;

  private readonly buffer = new Int32Array(MAX_ENTITIES);

  constructor(private readonly sim: Sim) {}

  /**
   * Cast a segment. Returns HIT_*; details are in `t`, `cell`, `entity`.
   * `projectile` picks the terrain flag; `ignore` is an entity index or -1.
   */
  cast(fx: number, fy: number, fz: number, tx: number, ty: number, tz: number, projectile: boolean, ignore: number, hitEntities: boolean): number {
    this.hit = HIT_NONE;
    this.t = 1;
    this.cell = -1;
    this.entity = -1;
    const world = this.sim.world;
    if (world === null) return HIT_NONE;
    const walls = projectile ? world.blocksProjectiles : world.blocksSight;
    const dx = tx - fx;
    const dy = ty - fy;
    const dz = tz - fz;
    const length = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(length / (world.hexSize * STEP)));

    let current = world.cellAt(fx, fy);
    let from = 0; // a parameter known to be inside `current`
    terrain: for (let i = 1; i <= steps; i++) {
      const to = i / steps;
      // There may be more than one crossing inside a step: handle them one by one.
      for (let guard = 0; guard < 4; guard++) {
        if (world.cellAt(fx + dx * to, fy + dy * to) === current) break;
        let lo = from;
        let hi = to;
        for (let k = 0; k < BISECT; k++) {
          const mid = (lo + hi) / 2;
          if (world.cellAt(fx + dx * mid, fy + dy * mid) === current) lo = mid;
          else hi = mid;
        }
        const x = fx + dx * hi;
        const y = fy + dy * hi;
        const z = fz + dz * hi;
        // Leaving `current` below its surface: the segment passed under the column's top.
        if (current >= 0 && z < world.surfaceHeightIn(current, x, y) - EPS) {
          this.hit = HIT_TERRAIN;
          this.t = hi;
          this.cell = current;
          break terrain;
        }
        const next = world.cellAt(x, y);
        if (next >= 0 && (walls[next] === 1 || z < world.surfaceHeightIn(next, x, y) - EPS)) {
          this.hit = HIT_TERRAIN;
          this.t = hi;
          this.cell = next;
          break terrain;
        }
        current = next;
        from = hi;
      }
      from = to;
    }
    if (this.hit === HIT_NONE && current >= 0 && tz < world.surfaceHeightIn(current, tx, ty) - EPS) {
      this.hit = HIT_TERRAIN;
      this.t = 1;
      this.cell = current;
    }

    if (hitEntities && length > 0) this.castEntities(fx, fy, fz, dx, dy, dz, ignore);
    return this.hit;
  }

  /** Test collider cylinders along the segment; keep the nearest hit before the terrain hit. */
  private castEntities(fx: number, fy: number, fz: number, dx: number, dy: number, dz: number, ignore: number): void {
    const sim = this.sim;
    const world = sim.world!;
    const hash = sim.hash;
    if (hash === null) return;
    const e = sim.entities;
    const pitchX = Math.sqrt(3) * world.hexSize;
    const pitchY = 1.5 * world.hexSize;
    const x0 = Math.min(fx, fx + dx);
    const x1 = Math.max(fx, fx + dx);
    const y0 = Math.min(fy, fy + dy);
    const y1 = Math.max(fy, fy + dy);
    const reach = sim.maxRadius;
    const n = hash.queryRange(
      Math.floor((x0 - reach) / pitchX) - 1,
      Math.floor((y0 - reach) / pitchY) - 1,
      Math.floor((x1 + reach) / pitchX) + 1,
      Math.floor((y1 + reach) / pitchY) + 1,
      this.buffer,
    );
    const a = dx * dx + dy * dy;
    let best = this.t;
    let found = -1;
    for (let k = 0; k < n; k++) {
      const i = this.buffer[k]!;
      if (i === ignore || (e.flags[i]! & F_COLLIDER) === 0 || (e.flags[i]! & F_DEAD) !== 0) continue;
      const collider = e.data[i]!.collider!;
      const ox = fx - e.x[i]!;
      const oy = fy - e.y[i]!;
      const b = ox * dx + oy * dy;
      const c = ox * ox + oy * oy - collider.radius * collider.radius;
      let t: number;
      if (c <= 0) t = 0; // the segment starts inside the cylinder's footprint
      else {
        const disc = b * b - a * c;
        if (disc < 0) continue;
        t = (-b - Math.sqrt(disc)) / a;
        if (t < 0 || t > 1) continue;
      }
      const z = fz + dz * t;
      if (z < e.z[i]! - EPS || z > e.z[i]! + collider.height + EPS) continue;
      // Nearest first; ties go to the lower index, so bucket order never matters.
      if (t < best || (t === best && found >= 0 && i < found)) {
        best = t;
        found = i;
      }
    }
    if (found >= 0) {
      this.hit = HIT_ENTITY;
      this.t = best;
      this.entity = found;
      this.cell = world.cellAt(fx + dx * best, fy + dy * best);
    }
  }

  /**
   * Can the entity at index `a` see the one at `b`? (spec 7.6)
   *   1. B is within A's sight range, and B is not untargetable.
   *   2. A segment from A's eye to B's center is not blocked.
   *   3. High ground: when `uphillBlocked` is on and B stands on a higher
   *      level than A, B must also be within `uphillRevealRange`.
   */
  canSee(a: number, b: number): boolean {
    const sim = this.sim;
    const e = sim.entities;
    const data = e.data[a]!;
    const range = data.sight ? data.sight.range : data.acquisition ? data.acquisition.range : 0;
    const dx = e.x[b]! - e.x[a]!;
    const dy = e.y[b]! - e.y[a]!;
    const d2 = dx * dx + dy * dy;
    if (d2 > range * range) return false;
    if ((e.status[b]! & STATUS_UNTARGETABLE) !== 0) return false;
    const eye = e.z[a]! + (data.sight ? data.sight.eyeHeight : data.collider ? data.collider.height * 0.9 : 1);
    const other = e.data[b]!.collider;
    const center = e.z[b]! + (other ? other.height * 0.5 : 0.5);
    if (this.cast(e.x[a]!, e.y[a]!, eye, e.x[b]!, e.y[b]!, center, false, -1, false) !== HIT_NONE) return false;
    const rule = sim.project.settings.sight;
    if (rule.uphillBlocked) {
      // "Level" is the ground under each of them, so a flyer is not on high ground by flying.
      const rise = sim.surfaceZ(e.x[b]!, e.y[b]!) - sim.surfaceZ(e.x[a]!, e.y[a]!);
      if (rise > 0.5 * sim.project.settings.levelHeight && d2 > rule.uphillRevealRange * rule.uphillRevealRange) return false;
    }
    return true;
  }

  /** The spec's signature, for clients and debug overlays (allocates its result). */
  castSegment(from: Vec3, to: Vec3, opts: CastOptions): CastResult {
    const ignore = opts.ignore === undefined ? -1 : this.sim.entities.indexOf(opts.ignore);
    const kind = this.cast(from.x, from.y, from.z, to.x, to.y, to.z, opts.mode === 'projectile', ignore, opts.hitEntities);
    if (kind === HIT_NONE) return { hit: 'none', t: 1 };
    if (kind === HIT_TERRAIN) return { hit: 'terrain', t: this.t, cell: this.cell };
    return { hit: 'entity', t: this.t, cell: this.cell, entity: this.sim.entities.idAt(this.entity) };
  }
}

export { NO_ENTITY };
