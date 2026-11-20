/**
 * Terrain geometry (spec 6.6), after the elevation model of Catlike Coding's
 * Hex Map (DECISIONS_LOG D193, D194; `runtime/src/world.ts`). Each cell draws
 * its whole hex:
 *
 *   - the inner hex, flat at its level;
 *   - six half bridges to the shared borders, cut where a terraced slope
 *     turns between rise and flat step;
 *   - six corner regions by the hex corners, subdivided where they blend;
 *   - cliff faces down from the camera-facing borders (south-west and
 *     south-east), following both surfaces.
 *
 * Every vertex sits at the runtime's own surface height there, so the
 * drawing, picking, sight and walking agree. Triangles are split into flat
 * ones and rises so the renderer can shade the rises. Geometry is built per
 * row strip, in world pixels (the projection at zoom 1), and rebuilt only when
 * the map is edited. This module is pure data; `pixi.ts` turns a strip into
 * draw calls.
 */
import type { FrameRef, Project } from '@loreengine/schema';
import { SOLID_FACTOR, TERRACES, cornerOffsetX, cornerOffsetY, dirUnitX, dirUnitY, edgeCornerA, edgeCornerB } from '@loreengine/runtime/view';
import type { HexDir, WorldView } from '@loreengine/runtime/view';
import { projectX, projectY } from './projection.ts';

/** The edges whose faces look toward the camera: south-west and south-east. */
export const CAMERA_FACING: readonly HexDir[] = [5, 6];

export interface TopMesh {
  cell: number;
  /** The terrain's top art. */
  frame: FrameRef;
  /** The cell's level, for placeholder shading. */
  level: number;
  /** (x, y) pairs in world pixels. */
  vertices: Float32Array;
  /** Surface height of each vertex, world units. */
  heights: Float32Array;
  /** Each vertex's offset from the cell center on the world plane, in hex sizes: where the top art is sampled. */
  local: Float32Array;
  /** Triangles on level ground (vertex index triples). */
  flat: Uint16Array;
  /** Triangles on rises: terraced slopes and blended corners. */
  rise: Uint16Array;
  /** The six outer corners, 0..5, as vertex indices: the hex's outline. */
  outline: Uint16Array;
}

export interface FaceQuad {
  cell: number;
  dir: HexDir;
  /** The terrain's cliff art, or null for the neutral engine face. */
  frame: FrameRef | null;
  /** Four vertices: top A, top B, bottom B, bottom A; (x, y) pairs in world pixels. */
  vertices: Float32Array;
  /** World height of the face's top and bottom at its two ends. */
  topA: number;
  topB: number;
  bottomA: number;
  bottomB: number;
}

export interface StripGeometry {
  row: number;
  tops: TopMesh[];
  faces: FaceQuad[];
}

/** Breakpoints of a terraced half bridge, from the inner edge (0) to the shared border (0.5). */
const SLOPE_CUTS: readonly number[] = (() => {
  const steps = TERRACES * 2 + 1;
  const out: number[] = [];
  for (let k = 0; k * 2 < steps; k++) out.push(k / steps);
  out.push(0.5);
  return out;
})();
/** Subdivisions per side of a corner region that blends. */
const CORNER_GRID = 4;
const EPS = 1e-9;

/** The two directions whose edges meet at corner `i`. */
function directionsAtCorner(i: number): [HexDir, HexDir] {
  const out: HexDir[] = [];
  for (let d = 1 as HexDir; d <= 6; d = (d + 1) as HexDir) if (edgeCornerA(d) === i || edgeCornerB(d) === i) out.push(d);
  return [out[0]!, out[1]!];
}
const CORNER_DIRS = Array.from({ length: 6 }, (_, i) => directionsAtCorner(i));
const SQRT3 = Math.sqrt(3);
const unitX = dirUnitX;
const unitY = dirUnitY;

class MeshBuilder {
  private readonly xs: number[] = [];
  private readonly ys: number[] = [];
  private readonly zs: number[] = [];
  private readonly ls: number[] = [];
  readonly flat: number[] = [];
  readonly rise: number[] = [];

  constructor(
    private readonly world: WorldView,
    private readonly cell: number,
    private readonly cx: number,
    private readonly cy: number,
    private readonly size: number,
    private readonly ppu: number,
  ) {}

  /** A vertex at offset (dx, dy) from the cell center, world units. */
  add(dx: number, dy: number): number {
    const x = this.cx + dx;
    const y = this.cy + dy;
    const z = this.world.heightIn(this.cell, x, y);
    this.xs.push(projectX(x, this.ppu));
    this.ys.push(projectY(y, z, this.ppu));
    this.zs.push(z);
    this.ls.push(dx / this.size, dy / this.size);
    return this.zs.length - 1;
  }

  triangle(a: number, b: number, c: number): void {
    const za = this.zs[a]!;
    const target = Math.abs(za - this.zs[b]!) < EPS && Math.abs(za - this.zs[c]!) < EPS ? this.flat : this.rise;
    target.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.triangle(a, b, c);
    this.triangle(a, c, d);
  }

  height(i: number): number {
    return this.zs[i]!;
  }

  finish(): Pick<TopMesh, 'vertices' | 'heights' | 'local' | 'flat' | 'rise'> {
    const n = this.zs.length;
    const vertices = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      vertices[i * 2] = this.xs[i]!;
      vertices[i * 2 + 1] = this.ys[i]!;
    }
    return { vertices, heights: Float32Array.from(this.zs), local: Float32Array.from(this.ls), flat: Uint16Array.from(this.flat), rise: Uint16Array.from(this.rise) };
  }
}

/** Build the geometry of one map row. */
export function buildStrip(world: WorldView, project: Readonly<Project>, row: number): StripGeometry {
  const { hexSize: R, pixelsPerUnit: ppu } = project.settings;
  const s = SOLID_FACTOR;
  const span = SQRT3 * R * (1 - s); // a whole bridge: 2 x apothem x (1 - s)
  const tops: TopMesh[] = [];
  const faces: FaceQuad[] = [];
  for (let col = 0; col < world.width; col++) {
    const cell = row * world.width + col;
    const terrain = project.terrains[world.terrain(cell)]!;
    const cx = world.centerX(cell);
    const cy = world.centerY(cell);
    const level = world.level(cell);
    const m = new MeshBuilder(world, cell, cx, cy, R, ppu);
    const px = (i: number) => cornerOffsetX(i, R);
    const py = (i: number) => cornerOffsetY(i, R);

    // The inner hex: a fan around the center.
    const center = m.add(0, 0);
    const inner: number[] = [];
    for (let i = 0; i < 6; i++) inner.push(m.add(s * px(i), s * py(i)));
    for (let i = 0; i < 6; i++) m.triangle(center, inner[i]!, inner[(i + 1) % 6]!);

    // Half bridges, cut at the terrace breaks on slopes.
    for (let d = 1 as HexDir; d <= 6; d = (d + 1) as HexDir) {
      const a = edgeCornerA(d);
      const b = edgeCornerB(d);
      const other = world.neighbor(cell, d);
      const slope = other >= 0 && Math.abs(world.level(other) - level) === 1;
      const cuts = slope ? SLOPE_CUTS : [0, 0.5];
      const nx = unitX(d) * span;
      const ny = unitY(d) * span;
      let prevA = -1;
      let prevB = -1;
      for (const t of cuts) {
        const va = m.add(s * px(a) + t * nx, s * py(a) + t * ny);
        const vb = m.add(s * px(b) + t * nx, s * py(b) + t * ny);
        if (prevA >= 0) m.quad(prevA, prevB, vb, va);
        prevA = va;
        prevB = vb;
      }
    }

    // Corner regions: from the inner corner out to the hex corner, between the two half-bridge ends.
    const outline = new Uint16Array(6);
    for (let i = 0; i < 6; i++) {
      const [d1, d2] = CORNER_DIRS[i]!;
      const ix = s * px(i);
      const iy = s * py(i);
      const corners: [number, number][] = [
        [ix, iy],
        [ix + 0.5 * span * unitX(d1), iy + 0.5 * span * unitY(d1)],
        [px(i), py(i)],
        [ix + 0.5 * span * unitX(d2), iy + 0.5 * span * unitY(d2)],
      ];
      const at = (u: number, v: number): [number, number] => {
        // Bilinear over the corner quad: u from the inner corner side, v across.
        const [p0, p1, p2, p3] = corners as [[number, number], [number, number], [number, number], [number, number]];
        const x = (1 - u) * ((1 - v) * p0[0] + v * p1[0]) + u * ((1 - v) * p3[0] + v * p2[0]);
        const y = (1 - u) * ((1 - v) * p0[1] + v * p1[1]) + u * ((1 - v) * p3[1] + v * p2[1]);
        return [x, y];
      };
      // A corner whose surface is level everywhere needs two triangles; one that blends gets a grid.
      const probe = [0, 0.5, 1].flatMap((u) => [0, 0.5, 1].map((v) => at(u, v)));
      const h0 = world.heightIn(cell, cx + probe[0]![0], cy + probe[0]![1]);
      const level0 = probe.every(([x, y]) => Math.abs(world.heightIn(cell, cx + x, cy + y) - h0) < EPS);
      const n = level0 ? 1 : CORNER_GRID;
      // The grid's diagonal (u = v) runs from the inner corner to the hex corner. Where a middle cell
      // meets two cells a cliff apart, its surface steps along that line (world.ts), so vertices on
      // the diagonal get one copy per side, each taken a hair inside its own side.
      const nudge = 1e-7;
      const vertex = (iu: number, iv: number, side: number): number => {
        const [x, y] = at(iu / n, iv / n);
        if (iu !== iv || n === 1) return m.add(x, y);
        // side +1: toward v > u (the d1 half-bridge end); -1: toward u > v (the d2 end).
        const [tx, ty] = side > 0 ? at(iu / n, Math.min(1, (iv + 0.5) / n)) : at(Math.min(1, (iu + 0.5) / n), iv / n);
        const len = Math.hypot(tx - x, ty - y) || 1;
        return m.add(x + ((tx - x) / len) * nudge, y + ((ty - y) / len) * nudge);
      };
      const grid = new Map<string, number>();
      const g = (iu: number, iv: number, side: number): number => {
        const key = iu === iv && n > 1 ? `${iu},${iv},${side}` : `${iu},${iv}`;
        let id = grid.get(key);
        if (id === undefined) {
          id = vertex(iu, iv, side);
          grid.set(key, id);
        }
        return id;
      };
      for (let iu = 0; iu < n; iu++) {
        for (let iv = 0; iv < n; iv++) {
          // Split along the u = v direction; each triangle takes the diagonal copies of its own side.
          if (iu === iv) {
            m.triangle(g(iu, iv, 1), g(iu, iv + 1, 1), g(iu + 1, iv + 1, 1));
            m.triangle(g(iu, iv, -1), g(iu + 1, iv + 1, -1), g(iu + 1, iv, -1));
          } else {
            const side = iv > iu ? 1 : -1;
            m.quad(g(iu, iv, side), g(iu, iv + 1, side), g(iu + 1, iv + 1, side), g(iu + 1, iv, side));
          }
        }
      }
      // Stitch the two copies along the diagonal wherever they differ: a little vertical face.
      if (n > 1) {
        for (let k = 0; k < n; k++) {
          const a1 = g(k, k, 1);
          const b1 = g(k + 1, k + 1, 1);
          const a2 = g(k, k, -1);
          const b2 = g(k + 1, k + 1, -1);
          if (Math.abs(m.height(a1) - m.height(a2)) > EPS || Math.abs(m.height(b1) - m.height(b2)) > EPS) m.quad(a1, b1, b2, a2);
        }
      }
      outline[i] = g(n, n, 1); // (u, v) = (1, 1): the hex corner
    }

    tops.push({ cell, frame: terrain.top, level, ...m.finish(), outline });

    // Cliff faces down from the camera-facing borders, sampled along the border.
    for (const dir of CAMERA_FACING) {
      const a = edgeCornerA(dir);
      const b = edgeCornerB(dir);
      const other = world.neighbor(cell, dir);
      const ax = cx + px(a);
      const ay = cy + py(a);
      const bx = cx + px(b);
      const by = cy + py(b);
      // Corner regions take the first and last eighth of the border (with s = 0.75); sample them finely.
      const cornerShare = (1 - s) / 2;
      const ts: number[] = [];
      for (let k = 0; k <= CORNER_GRID; k++) ts.push((cornerShare * k) / CORNER_GRID);
      for (let k = CORNER_GRID; k >= 0; k--) ts.push(1 - (cornerShare * k) / CORNER_GRID);
      let prev: { x: number; y: number; top: number; bottom: number } | null = null;
      for (const t of ts) {
        const x = ax + (bx - ax) * t;
        const y = ay + (by - ay) * t;
        const top = world.heightIn(cell, x, y);
        const bottom = other < 0 ? 0 : Math.min(top, world.heightIn(other, x, y));
        const here = { x, y, top, bottom };
        if (prev && (prev.top - prev.bottom > 1e-6 || top - bottom > 1e-6)) {
          faces.push({
            cell,
            dir,
            frame: terrain.cliff ?? null,
            vertices: Float32Array.of(
              projectX(prev.x, ppu), projectY(prev.y, prev.top, ppu),
              projectX(x, ppu), projectY(y, top, ppu),
              projectX(x, ppu), projectY(y, bottom, ppu),
              projectX(prev.x, ppu), projectY(prev.y, prev.bottom, ppu),
            ),
            topA: prev.top,
            topB: top,
            bottomA: prev.bottom,
            bottomB: bottom,
          });
        }
        prev = here;
      }
    }
  }
  return { row, tops, faces };
}

/** The highest surface on the loaded map, in world units (for culling). */
export function maxSurface(world: WorldView, levelHeight: number): number {
  let top = 0;
  const cells = world.width * world.height;
  for (let cell = 0; cell < cells; cell++) {
    const level = world.level(cell);
    if (level > top) top = level;
  }
  return top * levelHeight;
}
