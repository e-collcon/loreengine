/**
 * Hex math suite. The v0.6.0 suite (~12,000 numerical cases) was not
 * recovered, so this one is written from scratch against the ported code:
 * round trips over the whole 256 x 256 range, all six neighbors at odd and
 * even rows, cubeRound at hex boundaries, pixelToHex ∘ hexToPixel identity,
 * and exact agreement between every scalar adapter and its ported original.
 */
import { describe, expect, it } from 'vitest';
import {
  AXIAL_DIRS,
  HEX_DIRS,
  axialQ,
  axialToOffset,
  cellCenterX,
  cellCenterY,
  cornerOffsetX,
  cornerOffsetY,
  cubeRound,
  dirBetween,
  dirUnitX,
  dirUnitY,
  edgeCornerA,
  edgeCornerB,
  hexCorners,
  hexDistance,
  hexToPixel,
  neighborCol,
  neighborIndex,
  neighborRow,
  offsetCol,
  offsetToAxial,
  oppositeDir,
  pixelToHex,
  worldToCellIndex,
} from '../src/index.ts';

const N = 256;
const SQRT3 = Math.sqrt(3);

/** Tiny deterministic generator for sample points (tests only). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('[P1.hexmath.offset-axial] offset <-> axial', () => {
  it('round-trips every cell of the 256 x 256 range', () => {
    let cases = 0;
    for (let row = 0; row < N; row++) {
      for (let col = 0; col < N; col++) {
        const a = offsetToAxial(col, row);
        const o = axialToOffset(a.q, a.r);
        if (o.col !== col || o.row !== row) throw new Error(`round trip failed at ${col},${row}`);
        if (!Number.isInteger(a.q)) throw new Error(`non-integer q at ${col},${row}`);
        cases++;
      }
    }
    expect(cases).toBe(65536);
  });

  it('round-trips negative coordinates (parity via row & 1)', () => {
    for (let row = -64; row < 64; row++) {
      for (let col = -64; col < 64; col++) {
        const a = offsetToAxial(col, row);
        expect(axialToOffset(a.q, a.r)).toEqual({ col, row });
      }
    }
  });

  it('matches hand-computed values', () => {
    expect(offsetToAxial(0, 0)).toEqual({ q: 0, r: 0 });
    expect(offsetToAxial(3, 1)).toEqual({ q: 3, r: 1 });
    expect(offsetToAxial(3, 2)).toEqual({ q: 2, r: 2 });
    expect(offsetToAxial(0, 5)).toEqual({ q: -2, r: 5 });
    expect(axialToOffset(-2, 5)).toEqual({ col: 0, row: 5 });
  });

  it('scalar adapters equal the ported functions over the whole range', () => {
    for (let row = 0; row < N; row++) {
      for (let col = 0; col < N; col++) {
        const a = offsetToAxial(col, row);
        if (axialQ(col, row) !== a.q) throw new Error('axialQ mismatch');
        if (offsetCol(a.q, a.r) !== col) throw new Error('offsetCol mismatch');
      }
    }
  });
});

describe('[P1.hexmath.neighbors] neighbors', () => {
  // odd-r: odd rows are shifted half a hex to the right.
  const EVEN: Record<number, [number, number]> = {
    1: [1, 0], 2: [0, -1], 3: [-1, -1], 4: [-1, 0], 5: [-1, 1], 6: [0, 1],
  };
  const ODD: Record<number, [number, number]> = {
    1: [1, 0], 2: [1, -1], 3: [0, -1], 4: [-1, 0], 5: [0, 1], 6: [1, 1],
  };

  it('all six neighbors at even and odd rows match the odd-r table', () => {
    for (const [col, row] of [[10, 10], [10, 11], [0, 0], [0, 1], [255, 254], [255, 255]] as const) {
      const table = row & 1 ? ODD : EVEN;
      for (const dir of HEX_DIRS) {
        const [dc, dr] = table[dir]!;
        expect(neighborCol(col, row, dir)).toBe(col + dc);
        expect(neighborRow(row, dir)).toBe(row + dr);
      }
    }
  });

  it('every neighbor of every cell is at hex distance 1 and one hex-width away', () => {
    const size = 1;
    for (let row = 0; row < N; row++) {
      for (let col = 0; col < N; col++) {
        for (const dir of HEX_DIRS) {
          const nc = neighborCol(col, row, dir);
          const nr = neighborRow(row, dir);
          if (hexDistance(col, row, nc, nr) !== 1) throw new Error('distance != 1');
          const dx = cellCenterX(nc, nr, size) - cellCenterX(col, row, size);
          const dy = cellCenterY(nr, size) - cellCenterY(row, size);
          if (Math.abs(Math.hypot(dx, dy) - SQRT3 * size) > 1e-9) throw new Error('pitch mismatch');
        }
      }
    }
  });

  it('neighborIndex is symmetric through oppositeDir and -1 off the map', () => {
    const w = 37;
    const h = 23;
    for (let i = 0; i < w * h; i++) {
      for (const dir of HEX_DIRS) {
        const n = neighborIndex(i, dir, w, h);
        if (n === -1) continue;
        expect(neighborIndex(n, oppositeDir(dir), w, h)).toBe(i);
        expect(dirBetween(i, n, w, h)).toBe(dir);
      }
    }
    expect(neighborIndex(0, 4, w, h)).toBe(-1);
    expect(neighborIndex(0, 3, w, h)).toBe(-1);
    expect(neighborIndex(w * h - 1, 1, w, h)).toBe(-1);
    expect(dirBetween(0, 5, w, h)).toBe(0);
    expect(dirBetween(0, 0, w, h)).toBe(0);
  });

  it('oppositeDir pairs 1-4, 2-5, 3-6 and axial offsets cancel', () => {
    expect(HEX_DIRS.map(oppositeDir)).toEqual([4, 5, 6, 1, 2, 3]);
    for (const dir of HEX_DIRS) {
      const a = AXIAL_DIRS[dir - 1]!;
      const b = AXIAL_DIRS[oppositeDir(dir) - 1]!;
      expect(a.q + b.q).toBe(0);
      expect(a.r + b.r).toBe(0);
    }
  });

  it('dirUnit points at the neighbor center and has length 1', () => {
    for (const dir of HEX_DIRS) {
      const nc = neighborCol(4, 4, dir);
      const nr = neighborRow(4, dir);
      const dx = cellCenterX(nc, nr, 1) - cellCenterX(4, 4, 1);
      const dy = cellCenterY(nr, 1) - cellCenterY(4, 1);
      expect(dirUnitX(dir)).toBeCloseTo(dx / SQRT3, 12);
      expect(dirUnitY(dir)).toBeCloseTo(dy / SQRT3, 12);
      expect(Math.hypot(dirUnitX(dir), dirUnitY(dir))).toBeCloseTo(1, 12);
    }
  });
});

describe('[P1.hexmath.cube-round] cubeRound', () => {
  it('always returns integers on the cube plane', () => {
    const rnd = lcg(7);
    for (let i = 0; i < 20000; i++) {
      const qf = (rnd() - 0.5) * 600;
      const rf = (rnd() - 0.5) * 600;
      const c = cubeRound(qf, rf, -qf - rf);
      if (c.q + c.r + c.s !== 0) throw new Error('cube invariant broken');
      if (!Number.isInteger(c.q) || !Number.isInteger(c.r)) throw new Error('non-integer');
    }
  });

  it('is the identity on integer cube coordinates', () => {
    for (let q = -20; q <= 20; q++) {
      for (let r = -20; r <= 20; r++) {
        const c = cubeRound(q, r, -q - r);
        expect(c.q === q && c.r === r && c.s === -q - r).toBe(true);
      }
    }
  });

  it('rounds to the nearer hex on either side of each of the six boundaries', () => {
    const eps = 1e-3;
    for (const d of AXIAL_DIRS) {
      // The midpoint between hex (0,0) and its neighbor d is 0.5 * d.
      const near = cubeRound(d.q * (0.5 - eps), d.r * (0.5 - eps), -(d.q + d.r) * (0.5 - eps));
      const far = cubeRound(d.q * (0.5 + eps), d.r * (0.5 + eps), -(d.q + d.r) * (0.5 + eps));
      // `+ 0` folds the -0 that cubeRound yields for small negative inputs.
      expect({ q: near.q + 0, r: near.r + 0 }).toEqual({ q: 0, r: 0 });
      expect({ q: far.q, r: far.r }).toEqual({ q: d.q, r: d.r });
    }
  });

  it('resolves a hex corner (three-way tie region) to one of the three hexes', () => {
    // Just inside the corner shared by (0,0), (1,0) and (1,-1).
    const c = cubeRound(0.66, -0.33, -0.33);
    expect([[0, 0], [1, 0], [1, -1]]).toContainEqual([c.q + 0, c.r + 0]);
  });
});

describe('[P1.hexmath.pixel-round-trip] hexToPixel / pixelToHex', () => {
  it('pixelToHex ∘ hexToPixel is the identity over 256 x 256 for several sizes and ratios', () => {
    let cases = 0;
    for (const [size, iso] of [[1, 1], [32, 0.5], [0.75, 0.6]] as const) {
      for (let row = 0; row < N; row++) {
        for (let col = 0; col < N; col++) {
          const a = offsetToAxial(col, row);
          const p = hexToPixel(a.q, a.r, size, iso);
          const b = pixelToHex(p.x, p.y, size, iso);
          if (b.q !== a.q || b.r !== a.r) throw new Error(`identity failed at ${col},${row}`);
          cases++;
        }
      }
    }
    expect(cases).toBe(3 * 65536);
  });

  it('every point strictly inside a hex maps back to that hex', () => {
    const rnd = lcg(99);
    const size = 1;
    for (let i = 0; i < 20000; i++) {
      const col = Math.floor(rnd() * N);
      const row = Math.floor(rnd() * N);
      const a = offsetToAxial(col, row);
      const c = hexToPixel(a.q, a.r, size, 1);
      // Random point in the inscribed circle (radius = sqrt(3)/2 * size), shrunk a hair.
      const ang = rnd() * Math.PI * 2;
      const rad = Math.sqrt(rnd()) * (SQRT3 / 2) * size * 0.999;
      const b = pixelToHex(c.x + Math.cos(ang) * rad, c.y + Math.sin(ang) * rad, size, 1);
      if (b.q !== a.q || b.r !== a.r) throw new Error(`interior point escaped hex ${col},${row}`);
    }
  });

  it('matches hand-computed centers', () => {
    expect(hexToPixel(0, 0, 1, 1)).toEqual({ x: 0, y: 0 });
    expect(hexToPixel(1, 0, 1, 1).x).toBeCloseTo(SQRT3, 12);
    expect(hexToPixel(0, 1, 1, 1).x).toBeCloseTo(SQRT3 / 2, 12);
    expect(hexToPixel(0, 1, 1, 1).y).toBeCloseTo(1.5, 12);
    expect(hexToPixel(0, 2, 10, 0.5).y).toBeCloseTo(15, 12);
  });

  it('scalar adapters equal the ported functions exactly', () => {
    const rnd = lcg(3);
    for (let row = 0; row < N; row++) {
      for (let col = 0; col < N; col++) {
        const a = offsetToAxial(col, row);
        const p = hexToPixel(a.q, a.r, 1.25, 1);
        if (cellCenterX(col, row, 1.25) !== p.x) throw new Error('cellCenterX mismatch');
        if (cellCenterY(row, 1.25) !== p.y) throw new Error('cellCenterY mismatch');
      }
    }
    const w = 200;
    const h = 150;
    for (let i = 0; i < 50000; i++) {
      const x = (rnd() - 0.1) * 400;
      const y = (rnd() - 0.1) * 260;
      const a = pixelToHex(x, y, 1, 1);
      const o = axialToOffset(a.q, a.r);
      const expected = o.col < 0 || o.row < 0 || o.col >= w || o.row >= h ? -1 : o.row * w + o.col;
      if (worldToCellIndex(x, y, 1, w, h) !== expected) throw new Error(`worldToCellIndex mismatch at ${x},${y}`);
    }
  });
});

describe('[P1.hexmath.corners] hexCorners and edges', () => {
  it('produces six corners at radius `size`, corner 0 upper-right, clockwise', () => {
    const pts = hexCorners(5, 7, 2, 1);
    expect(pts).toHaveLength(6);
    for (const p of pts) expect(Math.hypot(p.x - 5, p.y - 7)).toBeCloseTo(2, 12);
    expect(pts[0]!.x).toBeGreaterThan(5);
    expect(pts[0]!.y).toBeLessThan(7); // y down: upper
    expect(pts[1]!.x).toBeGreaterThan(5);
    expect(pts[1]!.y).toBeGreaterThan(7);
    expect(pts[2]!.x).toBeCloseTo(5, 12); // bottom
    expect(pts[5]!.x).toBeCloseTo(5, 12); // top
  });

  it('applies the iso squash to y only', () => {
    const flat = hexCorners(0, 0, 3, 1);
    const iso = hexCorners(0, 0, 3, 0.5);
    for (let i = 0; i < 6; i++) {
      expect(iso[i]!.x).toBe(flat[i]!.x);
      expect(iso[i]!.y).toBeCloseTo(flat[i]!.y * 0.5, 12);
    }
  });

  it('scalar corner offsets equal hexCorners', () => {
    const pts = hexCorners(0, 0, 1.5, 1);
    for (let i = 0; i < 6; i++) {
      expect(cornerOffsetX(i, 1.5)).toBe(pts[i]!.x);
      expect(cornerOffsetY(i, 1.5)).toBe(pts[i]!.y);
    }
  });

  it('the edge facing each direction is shared with that neighbor', () => {
    const size = 1;
    for (const [col, row] of [[6, 6], [6, 7]] as const) {
      const cx = cellCenterX(col, row, size);
      const cy = cellCenterY(row, size);
      const mine = hexCorners(cx, cy, size, 1);
      for (const dir of HEX_DIRS) {
        const nc = neighborCol(col, row, dir);
        const nr = neighborRow(row, dir);
        const theirs = hexCorners(cellCenterX(nc, nr, size), cellCenterY(nr, size), size, 1);
        const a = mine[edgeCornerA(dir)]!;
        const b = mine[edgeCornerB(dir)]!;
        const oa = theirs[edgeCornerA(oppositeDir(dir))]!;
        const ob = theirs[edgeCornerB(oppositeDir(dir))]!;
        // Same two points, opposite winding.
        expect(a.x).toBeCloseTo(ob.x, 9);
        expect(a.y).toBeCloseTo(ob.y, 9);
        expect(b.x).toBeCloseTo(oa.x, 9);
        expect(b.y).toBeCloseTo(oa.y, 9);
        // The edge midpoint lies on the line to the neighbor center.
        const mx = (a.x + b.x) / 2 - cx;
        const my = (a.y + b.y) / 2 - cy;
        expect(mx).toBeCloseTo((dirUnitX(dir) * SQRT3 * size) / 2, 9);
        expect(my).toBeCloseTo((dirUnitY(dir) * SQRT3 * size) / 2, 9);
      }
    }
  });
});

describe('[P1.hexmath.distance] hexDistance', () => {
  it('is a metric: zero on identity, symmetric, triangle inequality', () => {
    const rnd = lcg(11);
    for (let i = 0; i < 5000; i++) {
      const a = [Math.floor(rnd() * N), Math.floor(rnd() * N)] as const;
      const b = [Math.floor(rnd() * N), Math.floor(rnd() * N)] as const;
      const c = [Math.floor(rnd() * N), Math.floor(rnd() * N)] as const;
      const ab = hexDistance(a[0], a[1], b[0], b[1]);
      expect(hexDistance(a[0], a[1], a[0], a[1])).toBe(0);
      expect(hexDistance(b[0], b[1], a[0], a[1])).toBe(ab);
      expect(ab).toBeLessThanOrEqual(hexDistance(a[0], a[1], c[0], c[1]) + hexDistance(c[0], c[1], b[0], b[1]));
      expect(Number.isInteger(ab)).toBe(true);
    }
  });
});
