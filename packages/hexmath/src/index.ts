/**
 * @loreengine/hexmath — the ported hex math plus the foundation's API.
 *
 * `ported.ts` is v0.6.0 verbatim. Everything below is an adapter: it either
 * calls the ported function directly, or (for the tick hot paths, law L8)
 * re-expresses the same formula on scalars so no object is allocated. Every
 * scalar adapter is tested for exact equality against its ported original
 * over the whole 256 x 256 range (`test/hexmath.test.ts`).
 *
 * Conventions:
 *   - Pointy-top hexes, odd-r offset storage, cell index = row * width + col.
 *   - `HexDir` is 1..6 and names a neighbor in the ported `AXIAL_DIRS` order:
 *       1 = E (+q)      2 = NE (+q, -r)   3 = NW (-r)
 *       4 = W (-q)      5 = SW (-q, +r)   6 = SE (+r)
 *     ("north" = smaller row = further from the camera.)
 *   - The world plane is the un-squashed hex plane (isoRatio 1), in world
 *     units, with `size` = `ProjectSettings.hexSize` (center to corner).
 *     The iso squash is a presentation concern and lives in `render`.
 */
export {
  AXIAL_DIRS,
  offsetToAxial,
  axialToOffset,
  cubeRound,
  hexToPixel,
  pixelToHex,
  hexCorners,
} from './ported.ts';
export type { Vec2 } from './ported.ts';

import { AXIAL_DIRS } from './ported.ts';

export type HexDir = 1 | 2 | 3 | 4 | 5 | 6;
export const HEX_DIRS: readonly HexDir[] = [1, 2, 3, 4, 5, 6];

const SQRT3 = Math.sqrt(3);
const DEG2RAD = Math.PI / 180;

/** The direction pointing back across the same edge. */
export function oppositeDir(dir: HexDir): HexDir {
  return (((dir + 2) % 6) + 1) as HexDir;
}

/** Axial q of an offset cell (scalar form of `offsetToAxial`). */
export function axialQ(col: number, row: number): number {
  return col - (row - (row & 1)) / 2;
}

/** Offset column of an axial cell (scalar form of `axialToOffset`). */
export function offsetCol(q: number, r: number): number {
  return q + (r - (r & 1)) / 2;
}

/** Column of the neighbor of offset cell (col, row) in direction `dir`. */
export function neighborCol(col: number, row: number, dir: HexDir): number {
  const d = AXIAL_DIRS[dir - 1]!;
  return offsetCol(axialQ(col, row) + d.q, row + d.r);
}

/** Row of the neighbor of an offset cell in direction `dir`. */
export function neighborRow(row: number, dir: HexDir): number {
  return row + AXIAL_DIRS[dir - 1]!.r;
}

/**
 * Cell index of the neighbor in direction `dir`, or -1 when it is off a
 * `width` x `height` map.
 */
export function neighborIndex(index: number, dir: HexDir, width: number, height: number): number {
  const col = index % width;
  const row = (index - col) / width;
  const nc = neighborCol(col, row, dir);
  const nr = neighborRow(row, dir);
  if (nc < 0 || nr < 0 || nc >= width || nr >= height) return -1;
  return nr * width + nc;
}

/**
 * The direction from cell `a` to its neighbor `b`, or 0 when they are not
 * adjacent (or are the same cell).
 */
export function dirBetween(a: number, b: number, width: number, height: number): HexDir | 0 {
  for (let dir = 1; dir <= 6; dir++) {
    if (neighborIndex(a, dir as HexDir, width, height) === b) return dir as HexDir;
  }
  return 0;
}

/** World x of an offset cell's center (scalar form of `hexToPixel`, isoRatio 1). */
export function cellCenterX(col: number, row: number, size: number): number {
  return size * (SQRT3 * axialQ(col, row) + (SQRT3 / 2) * row);
}

/** World y of an offset cell's center (scalar form of `hexToPixel`, isoRatio 1). */
export function cellCenterY(row: number, size: number): number {
  return size * 1.5 * row * 1;
}

/**
 * Cell index containing world point (x, y), or -1 off the map. Scalar form
 * of `pixelToHex` (isoRatio 1) + `cubeRound` + `axialToOffset`.
 */
export function worldToCellIndex(
  x: number,
  y: number,
  size: number,
  width: number,
  height: number,
): number {
  const uy = y / 1;
  const qf = ((SQRT3 / 3) * x - (1 / 3) * uy) / size;
  const rf = ((2 / 3) * uy) / size;
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  const col = offsetCol(q, r);
  if (col < 0 || r < 0 || col >= width || r >= height) return -1;
  return r * width + col;
}

/** Hex (cube) distance in cells between two offset cells. */
export function hexDistance(colA: number, rowA: number, colB: number, rowB: number): number {
  const aq = axialQ(colA, rowA);
  const bq = axialQ(colB, rowB);
  const dq = aq - bq;
  const dr = rowA - rowB;
  const ds = -aq - rowA + bq + rowB;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

/** x offset of corner `i` (0..5) from a hex center (scalar `hexCorners`). */
export function cornerOffsetX(i: number, size: number): number {
  return size * Math.cos(DEG2RAD * (60 * i - 30));
}

/** y offset of corner `i` (0..5) from a hex center, isoRatio 1. */
export function cornerOffsetY(i: number, size: number): number {
  return size * Math.sin(DEG2RAD * (60 * i - 30)) * 1;
}

/**
 * The two corners (indices into `hexCorners`) bounding the edge that faces
 * direction `dir`. Corner 0 is at -30 degrees (upper-right, y down), corners
 * proceed clockwise on screen; the edge toward dir 1 (E) spans corners 0, 1.
 */
export function edgeCornerA(dir: HexDir): number {
  return EDGE_CORNERS[(dir - 1) * 2]!;
}
export function edgeCornerB(dir: HexDir): number {
  return EDGE_CORNERS[(dir - 1) * 2 + 1]!;
}
// dir: 1 E -> corners 0,1 · 2 NE -> 5,0 · 3 NW -> 4,5 · 4 W -> 3,4 · 5 SW -> 2,3 · 6 SE -> 1,2
const EDGE_CORNERS: readonly number[] = [0, 1, 5, 0, 4, 5, 3, 4, 2, 3, 1, 2];

/** Unit vector x from a hex center toward its neighbor in `dir` (world plane). */
export function dirUnitX(dir: HexDir): number {
  const d = AXIAL_DIRS[dir - 1]!;
  return (SQRT3 * d.q + (SQRT3 / 2) * d.r) / SQRT3;
}

/** Unit vector y from a hex center toward its neighbor in `dir` (world plane). */
export function dirUnitY(dir: HexDir): number {
  return (1.5 * AXIAL_DIRS[dir - 1]!.r) / SQRT3;
}
