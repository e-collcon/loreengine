/**
 * The world (spec 6.3): one elevation model, three consumers. Passability,
 * sight, and rendering all read the same queries here, so a cliff that
 * blocks walking always blocks sight and is always drawn.
 *
 * The elevation model follows Catlike Coding's Hex Map (part 3, "Elevation
 * and Terraces"; DECISIONS_LOG N6, D193, D194). Every cell has a level.
 *
 *   - Its inner hex (SOLID_FACTOR of its size) is flat at that level.
 *   - The band between two neighbors' inner hexes (a "bridge") is
 *       flat   when their levels are equal,
 *       slope  when they differ by one: terraced, TERRACES flat steps, and
 *              walkable,
 *       cliff  when they differ by more: each side stays flat up to the
 *              shared border, with a vertical face there.
 *   - Where three cells meet, the corner between their inner hexes blends
 *     them by the same rules (see `surfaceHeightIn`).
 *
 * Connection rule: walking and swimming cross an edge when the levels differ
 * by at most one; flying ignores levels. Terrain passability applies on top.
 * The surface is continuous across every edge walking can cross.
 */
import { cellCenterX, cellCenterY, cornerOffsetX, cornerOffsetY, dirUnitX, dirUnitY, edgeCornerA, edgeCornerB, neighborIndex, worldToCellIndex } from '@loreengine/hexmath';
import type { HexDir } from '@loreengine/hexmath';
import type { MapDef, MovementMode, Project } from '@loreengine/schema';

export const MODE_WALK = 1;
export const MODE_SWIM = 2;
export const MODE_FLY = 4;

export function modeBit(mode: MovementMode): number {
  return mode === 'walk' ? MODE_WALK : mode === 'swim' ? MODE_SWIM : MODE_FLY;
}

/** Share of a cell's size that is its flat inner hex (Catlike's solid factor). */
export const SOLID_FACTOR = 0.75;
/** Flat steps on a slope between two levels. */
export const TERRACES = 2;

export const EDGE_FLAT = 0;
export const EDGE_SLOPE = 1;
export const EDGE_CLIFF = 2;
export type EdgeType = 'flat' | 'slope' | 'cliff';

/** The edge between two levels: 0 flat, 1 slope (one level apart), 2 cliff (more). */
export function edgeType(levelA: number, levelB: number): number {
  const d = levelA > levelB ? levelA - levelB : levelB - levelA;
  return d === 0 ? EDGE_FLAT : d === 1 ? EDGE_SLOPE : EDGE_CLIFF;
}

/** The connection rule for walking and swimming: levels at most one apart. */
export function levelsConnect(levelA: number, levelB: number): boolean {
  return edgeType(levelA, levelB) !== EDGE_CLIFF;
}

const TERRACE_STEPS = TERRACES * 2 + 1;

/**
 * How far up a terraced slope a point is, 0..1, at `t` (0..1) along it:
 * rises and flat steps alternate, starting and ending with a rise.
 * terraceFraction(1 - t) = 1 - terraceFraction(t).
 */
export function terraceFraction(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const u = t * TERRACE_STEPS;
  let k = Math.floor(u);
  if (k >= TERRACE_STEPS) k = TERRACE_STEPS - 1;
  return (k & 1) === 0 ? (k / 2 + (u - k)) / (TERRACES + 1) : (k + 1) / 2 / (TERRACES + 1);
}

/** Height in levels between levels a and b, t along from a. */
function blendLevels(a: number, b: number, t: number): number {
  return a === b ? a : a + (b - a) * terraceFraction(t);
}

const SQRT3 = Math.sqrt(3);

/*
 * Per direction d (index d - 1) and side (0: the edge's corner A, 1: corner B):
 * the corner index and the other direction whose edge shares that corner.
 */
const CORNER_OF = new Int8Array(12);
const OTHER_DIR = new Int8Array(12);
for (let d = 1; d <= 6; d++) {
  for (let side = 0; side < 2; side++) {
    const corner = side === 0 ? edgeCornerA(d as HexDir) : edgeCornerB(d as HexDir);
    CORNER_OF[(d - 1) * 2 + side] = corner;
    for (let e = 1; e <= 6; e++) {
      if (e !== d && (edgeCornerA(e as HexDir) === corner || edgeCornerB(e as HexDir) === corner)) OTHER_DIR[(d - 1) * 2 + side] = e;
    }
  }
}

export class World {
  readonly width: number;
  readonly height: number;
  readonly cells: number;
  readonly hexSize: number;
  readonly levelHeight: number;
  /** Authored layers, by reference: the world never writes them. */
  readonly level: Uint8Array;
  readonly terrain: Uint16Array;
  /** Per cell: MODE_* bits the terrain is passable for. */
  readonly pass: Uint8Array;
  /** Per cell: the terrain's A* cost multiplier. */
  readonly cost: Float64Array;
  /** Per cell: 1 when the terrain blocks sight / projectiles (an infinitely tall wall). */
  readonly blocksSight: Uint8Array;
  readonly blocksProjectiles: Uint8Array;
  /** Per cell and direction (cell * 6 + dir - 1): the neighbor's index, or -1 off the map. */
  readonly neighbor: Int32Array;
  /** Per cell and direction: MODE_* bits that may cross that edge. */
  readonly link: Uint8Array;
  /** Index into `project.terrains`, per cell. */
  readonly terrainDef: Uint16Array;
  /**
   * Offsets from a cell's center to the two ends of its edge facing each
   * direction (index dir - 1): the blocked-edge segments collision tests.
   */
  readonly edgeAX = new Float64Array(6);
  readonly edgeAY = new Float64Array(6);
  readonly edgeBX = new Float64Array(6);
  readonly edgeBY = new Float64Array(6);
  /** Distance from a hex center to the middle of an edge. */
  readonly apothem: number;

  constructor(project: Project, def: MapDef) {
    this.width = def.width;
    this.height = def.height;
    this.cells = def.width * def.height;
    this.hexSize = project.settings.hexSize;
    this.levelHeight = project.settings.levelHeight;
    this.level = def.layers.level;
    this.terrain = def.layers.terrain;

    this.apothem = (SQRT3 / 2) * this.hexSize;
    for (let dir = 1; dir <= 6; dir++) {
      this.edgeAX[dir - 1] = cornerOffsetX(edgeCornerA(dir as HexDir), this.hexSize);
      this.edgeAY[dir - 1] = cornerOffsetY(edgeCornerA(dir as HexDir), this.hexSize);
      this.edgeBX[dir - 1] = cornerOffsetX(edgeCornerB(dir as HexDir), this.hexSize);
      this.edgeBY[dir - 1] = cornerOffsetY(edgeCornerB(dir as HexDir), this.hexSize);
    }

    const terrainIndex = new Map<string, number>();
    project.terrains.forEach((t, i) => terrainIndex.set(t.id, i));
    const palette = def.terrainPalette.map((id) => terrainIndex.get(id)!);

    const n = this.cells;
    this.pass = new Uint8Array(n);
    this.cost = new Float64Array(n);
    this.blocksSight = new Uint8Array(n);
    this.blocksProjectiles = new Uint8Array(n);
    this.terrainDef = new Uint16Array(n);
    for (let cell = 0; cell < n; cell++) {
      const index = palette[this.terrain[cell]!]!;
      const t = project.terrains[index]!;
      this.terrainDef[cell] = index;
      this.pass[cell] = (t.passable.walk ? MODE_WALK : 0) | (t.passable.swim ? MODE_SWIM : 0) | (t.passable.fly ? MODE_FLY : 0);
      this.cost[cell] = t.moveCost;
      this.blocksSight[cell] = t.blocksSight ? 1 : 0;
      this.blocksProjectiles[cell] = t.blocksProjectiles ? 1 : 0;
    }

    this.neighbor = new Int32Array(n * 6);
    this.link = new Uint8Array(n * 6);
    for (let cell = 0; cell < n; cell++) {
      for (let dir = 1; dir <= 6; dir++) {
        const other = neighborIndex(cell, dir as HexDir, this.width, this.height);
        const slot = cell * 6 + dir - 1;
        this.neighbor[slot] = other;
        if (other < 0) continue;
        const both = this.pass[cell]! & this.pass[other]!;
        // Walk and swim obey the connection rule; fly ignores levels.
        const ground = levelsConnect(this.level[cell]!, this.level[other]!) ? both & (MODE_WALK | MODE_SWIM) : 0;
        this.link[slot] = ground | (both & MODE_FLY);
      }
    }
  }

  /** Cell index under a world point, or -1 off the map. */
  cellAt(x: number, y: number): number {
    return worldToCellIndex(x, y, this.hexSize, this.width, this.height);
  }

  centerX(cell: number): number {
    const col = cell % this.width;
    return cellCenterX(col, (cell - col) / this.width, this.hexSize);
  }

  centerY(cell: number): number {
    return cellCenterY((cell - (cell % this.width)) / this.width, this.hexSize);
  }

  /** Surface height in world units at (x, y). Off the map it is 0. */
  surfaceHeight(x: number, y: number): number {
    const cell = this.cellAt(x, y);
    return cell < 0 ? 0 : this.surfaceHeightIn(cell, x, y);
  }

  /** Level of the neighbor of `cell` toward `dir`, or -1 off the map (a missing neighbor never blends). */
  private levelToward(cell: number, dir: number): number {
    const other = this.neighbor[cell * 6 + dir - 1]!;
    return other < 0 ? -1 : this.level[other]!;
  }

  /**
   * Surface height at (x, y) as cell `cell` defines it, in world units. The
   * point should be in or next to the cell; points just outside extend its
   * surface. Regions of the cell's hex:
   *
   *   - inside the inner hex: the cell's level;
   *   - the half bridge toward a neighbor: a slope is terraced from this
   *     cell's level (at its inner edge) to the midpoint level (at the shared
   *     border); flat and cliff edges stay at this cell's level;
   *   - the corner region by a hex corner, inside the triangle of the three
   *     inner corners there (this cell O and neighbors X, Y), with barycentric
   *     weights wO, wX, wY:
   *       no neighbor within one level   O's level;
   *       one (X)                        O blended toward X by wX / (wO + wX);
   *       both, and X and Y within one   a three-way terraced blend: the low
   *                                      level, raised by the weight of the
   *                                      cells one level up;
   *       both, but X and Y a cliff apart  toward whichever weighs more.
   */
  surfaceHeightIn(cell: number, x: number, y: number): number {
    const lh = this.levelHeight;
    const hO = this.level[cell]!;
    const dx = x - this.centerX(cell);
    const dy = y - this.centerY(cell);
    const a = this.apothem;
    // The direction whose edge the point is furthest toward.
    let best = 1;
    let bestProj = -Infinity;
    for (let d = 1; d <= 6; d++) {
      const proj = dx * dirUnitX(d as HexDir) + dy * dirUnitY(d as HexDir);
      if (proj > bestProj) {
        bestProj = proj;
        best = d;
      }
    }
    const inner = SOLID_FACTOR * a;
    if (bestProj <= inner) return hO * lh;
    const nx = dirUnitX(best as HexDir);
    const ny = dirUnitY(best as HexDir);
    // Along the edge: within the inner edge's span is the half bridge, beyond it a corner region.
    const u = -dx * ny + dy * nx;
    const halfSpan = (SOLID_FACTOR * this.hexSize) / 2;
    if (u >= -halfSpan && u <= halfSpan) {
      const hX = this.levelToward(cell, best);
      if (hX < 0 || edgeType(hO, hX) === EDGE_CLIFF) return hO * lh;
      let t = (bestProj - inner) / (2 * a * (1 - SOLID_FACTOR));
      if (t > 1) t = 1;
      return blendLevels(hO, hX, t) * lh;
    }
    // Corner region: the corner of edge `best` on the side of u, shared with direction `other`.
    const ax = cornerOffsetX(edgeCornerA(best as HexDir), this.hexSize);
    const ay = cornerOffsetY(edgeCornerA(best as HexDir), this.hexSize);
    const side = (-ax * ny + ay * nx) * u > 0 ? 0 : 1;
    const corner = CORNER_OF[(best - 1) * 2 + side]!;
    const other = OTHER_DIR[(best - 1) * 2 + side]!;
    const hX = this.levelToward(cell, best);
    const hY = this.levelToward(cell, other);
    const lx = hX >= 0 && edgeType(hO, hX) !== EDGE_CLIFF;
    const ly = hY >= 0 && edgeType(hO, hY) !== EDGE_CLIFF;
    if (!lx && !ly) return hO * lh;
    // Barycentric weights in the triangle of the three inner corners (O's at s * P).
    const px = cornerOffsetX(corner, this.hexSize);
    const py = cornerOffsetY(corner, this.hexSize);
    const span = 2 * a * (1 - SOLID_FACTOR);
    const e1x = span * nx;
    const e1y = span * ny;
    const e2x = span * dirUnitX(other as HexDir);
    const e2y = span * dirUnitY(other as HexDir);
    const vx = dx - SOLID_FACTOR * px;
    const vy = dy - SOLID_FACTOR * py;
    const det = e1x * e2y - e1y * e2x;
    let wX = (vx * e2y - vy * e2x) / det;
    let wY = (e1x * vy - e1y * vx) / det;
    if (wX < 0) wX = 0;
    if (wY < 0) wY = 0;
    let wO = 1 - wX - wY;
    if (wO < 0) {
      const sum = wX + wY;
      wX /= sum;
      wY /= sum;
      wO = 0;
    }
    if (lx && !ly) return blendLevels(hO, hX, wO + wX > 0 ? wX / (wO + wX) : 0) * lh;
    if (!lx && ly) return blendLevels(hO, hY, wO + wY > 0 ? wY / (wO + wY) : 0) * lh;
    if (edgeType(hX, hY) !== EDGE_CLIFF) {
      // All three within one level: the low level, raised by the weight of the cells a level up.
      const low = Math.min(hO, hX, hY);
      const up = (hO > low ? wO : 0) + (hX > low ? wX : 0) + (hY > low ? wY : 0);
      return (low + terraceFraction(up)) * lh;
    }
    return (wX >= wY ? blendLevels(hO, hX, wO + wX > 0 ? wX / (wO + wX) : 0) : blendLevels(hO, hY, wO + wY > 0 ? wY / (wO + wY) : 0)) * lh;
  }

  /** The edge of `cell` toward `dir`: by the two levels, or 'none' off the map. */
  edgeType(cell: number, dir: HexDir): EdgeType | 'none' {
    const other = this.neighbor[cell * 6 + dir - 1]!;
    if (other < 0) return 'none';
    const t = edgeType(this.level[cell]!, this.level[other]!);
    return t === EDGE_FLAT ? 'flat' : t === EDGE_SLOPE ? 'slope' : 'cliff';
  }

  /** May something moving in `mode` step from cell `a` to its neighbor `b`? */
  connects(a: number, b: number, mode: MovementMode): boolean {
    if (a < 0 || b < 0 || a >= this.cells || b >= this.cells) return false;
    const base = a * 6;
    for (let d = 0; d < 6; d++) {
      if (this.neighbor[base + d] === b) return (this.link[base + d]! & modeBit(mode)) !== 0;
    }
    return false;
  }

  /** Hot-path form: may `modeMask` cross the edge of `cell` facing `dir`? */
  linked(cell: number, dir: number, modeMask: number): boolean {
    return (this.link[cell * 6 + dir - 1]! & modeMask) !== 0;
  }

  /** May something moving in `modeMask` stand on `cell`? */
  passable(cell: number, modeMask: number): boolean {
    return cell >= 0 && (this.pass[cell]! & modeMask) !== 0;
  }
}
