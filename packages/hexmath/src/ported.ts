/**
 * Hex math ported VERBATIM from LoreBrix v0.6.0 `src/tile-engine.ts`
 * (byte-identical in v0.5.0, the copy in `legacy/`). Pointy-top hexes,
 * odd-r offset storage, cube-coordinate math.
 *
 * Do not edit the function bodies. New API lives in `index.ts` as thin
 * adapters over these functions.
 */

export interface Vec2 {
  x: number;
  y: number;
}

const SQRT3 = Math.sqrt(3);
const DEG2RAD = Math.PI / 180;

/** Axial-direction offsets for the six neighbors of a pointy-top hex. */
export const AXIAL_DIRS: ReadonlyArray<{ q: number; r: number }> = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

/**
 * Convert odd-r offset storage coordinates (col, row) to axial (q, r).
 * Odd rows are shifted +half-hex to the right; `row & 1` yields the
 * mathematically correct parity for negative rows too.
 */
export function offsetToAxial(col: number, row: number): { q: number; r: number } {
  return { q: col - (row - (row & 1)) / 2, r: row };
}

/** Convert axial (q, r) back to odd-r offset storage coordinates. */
export function axialToOffset(q: number, r: number): { col: number; row: number } {
  return { col: q + (r - (r & 1)) / 2, row: r };
}

/**
 * Round fractional cube coordinates to the nearest valid hex, preserving
 * the cube invariant q + r + s = 0 by re-deriving the component with the
 * largest rounding error.
 */
export function cubeRound(
  qf: number,
  rf: number,
  sf: number,
): { q: number; r: number; s: number } {
  let q = Math.round(qf);
  let r = Math.round(rf);
  let s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  else s = -q - r;
  return { q, r, s };
}

/**
 * Axial hex (q, r) → world-space pixel center for a pointy-top hex of
 * radius `size`, with vertical iso squash applied.
 */
export function hexToPixel(q: number, r: number, size: number, isoRatio: number): Vec2 {
  return {
    x: size * (SQRT3 * q + (SQRT3 / 2) * r),
    y: size * 1.5 * r * isoRatio,
  };
}

/**
 * World-space pixel → nearest axial hex (q, r). Inverse of hexToPixel:
 * un-squashes y, solves the fractional axial coords, then cube-rounds.
 */
export function pixelToHex(
  x: number,
  y: number,
  size: number,
  isoRatio: number,
): { q: number; r: number } {
  const uy = y / isoRatio;
  const qf = ((SQRT3 / 3) * x - (1 / 3) * uy) / size;
  const rf = ((2 / 3) * uy) / size;
  const { q, r } = cubeRound(qf, rf, -qf - rf);
  return { q, r };
}

/**
 * The six corner points of a pointy-top hex centered at (cx, cy), radius
 * `size`, with iso squash applied to the vertical axis. Corner 0 is the
 * upper-right; corners proceed clockwise.
 */
export function hexCorners(cx: number, cy: number, size: number, isoRatio: number): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = DEG2RAD * (60 * i - 30);
    pts.push({
      x: cx + size * Math.cos(angle),
      y: cy + size * Math.sin(angle) * isoRatio,
    });
  }
  return pts;
}
