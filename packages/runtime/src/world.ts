/**
 * The world (spec 6.3): one elevation model, three consumers. Every hex is
 * a column. Its height comes from its cliff level; a ramp tilts its top so
 * it rises one level toward one neighbor. Passability, sight, and rendering
 * all read the same queries here, so a cliff that blocks walking always
 * blocks sight and is always drawn.
 *
 * Edge heights, in levels:
 *
 *   cell                          toward the rise   opposite   the four sides
 *   flat, level L                 L                 L          L
 *   ramp, level L, rising to d    L + 1             L          sloped
 *
 * Connection rule: two neighboring cells connect across their shared edge
 * when both edges are flat and at the same height. Everything else is a
 * cliff, including every sloped (ramp side) edge; see DECISIONS_LOG N6 for
 * why a "wide ramp" cannot connect sideways on a hex grid.
 */
import { cellCenterX, cellCenterY, cornerOffsetX, cornerOffsetY, dirUnitX, dirUnitY, edgeCornerA, edgeCornerB, neighborIndex, oppositeDir, worldToCellIndex } from '@loreengine/hexmath';
import type { HexDir } from '@loreengine/hexmath';
import type { MapDef, MovementMode, Project } from '@loreengine/schema';

export const MODE_WALK = 1;
export const MODE_SWIM = 2;
export const MODE_FLY = 4;

export function modeBit(mode: MovementMode): number {
  return mode === 'walk' ? MODE_WALK : mode === 'swim' ? MODE_SWIM : MODE_FLY;
}

/** Marks a sloped edge in the numeric edge-height queries. */
export const SLOPED = -1;

/**
 * Height, in levels, of the edge of a cell facing `dir`, or SLOPED for a
 * ramp's four side edges. `ramp` is 0 or the HexDir the ramp rises toward.
 */
export function edgeLevel(level: number, ramp: number, dir: HexDir): number {
  if (ramp === 0) return level;
  if (dir === ramp) return level + 1;
  if (dir === oppositeDir(ramp as HexDir)) return level;
  return SLOPED;
}

/**
 * The connection rule, as a pure function of the two cells' level and ramp
 * and the direction from A to B. It ignores terrain: passability per
 * movement mode is applied on top.
 */
export function edgesConnect(levelA: number, rampA: number, levelB: number, rampB: number, dirAtoB: HexDir): boolean {
  const a = edgeLevel(levelA, rampA, dirAtoB);
  const b = edgeLevel(levelB, rampB, oppositeDir(dirAtoB));
  return a !== SLOPED && b !== SLOPED && a === b;
}

const SQRT3 = Math.sqrt(3);

export class World {
  readonly width: number;
  readonly height: number;
  readonly cells: number;
  readonly hexSize: number;
  readonly levelHeight: number;
  /** Authored layers, by reference: the world never writes them. */
  readonly level: Uint8Array;
  readonly ramp: Uint8Array;
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
    this.ramp = def.layers.ramp;
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
        // Walk and swim obey the connection rule; fly ignores edge heights.
        const ground = edgesConnect(this.level[cell]!, this.ramp[cell]!, this.level[other]!, this.ramp[other]!, dir as HexDir)
          ? both & (MODE_WALK | MODE_SWIM)
          : 0;
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

  /**
   * Surface height in world units. On a flat cell, `level * levelHeight`.
   * On a ramp, height rises linearly along the ramp's direction from its
   * low edge to its high edge. Off the map it is 0.
   */
  surfaceHeight(x: number, y: number): number {
    const cell = this.cellAt(x, y);
    return cell < 0 ? 0 : this.surfaceHeightIn(cell, x, y);
  }

  /** Surface height at (x, y) as cell `cell` defines it (the point need not be inside). */
  surfaceHeightIn(cell: number, x: number, y: number): number {
    const level = this.level[cell]!;
    const ramp = this.ramp[cell]!;
    if (ramp === 0) return level * this.levelHeight;
    const apothem = (SQRT3 / 2) * this.hexSize;
    const along = (x - this.centerX(cell)) * dirUnitX(ramp as HexDir) + (y - this.centerY(cell)) * dirUnitY(ramp as HexDir);
    let t = (along + apothem) / (2 * apothem);
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    return (level + t) * this.levelHeight;
  }

  /** Height of a cell's edge, in levels, or 'sloped' for a ramp's side edges. */
  edgeHeight(cell: number, dir: HexDir): number | 'sloped' {
    const h = edgeLevel(this.level[cell]!, this.ramp[cell]!, dir);
    return h === SLOPED ? 'sloped' : h;
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
