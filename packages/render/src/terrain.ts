/**
 * Terrain geometry (spec 6.6). Each hex top is a seven-vertex mesh (center
 * plus six corners), each vertex lifted by the surface height there, so a
 * ramp renders from the same top art with no per-direction ramp art. Cliff
 * faces are quads between a cell's edge height and its neighbor's, drawn
 * only on the camera-facing edges.
 *
 * Geometry is built per row strip, in world pixels (the projection at zoom
 * 1), and rebuilt only when the map is edited. This module is pure data;
 * `pixi.ts` turns a strip into draw calls.
 */
import type { FrameRef, Project } from '@loreengine/schema';
import { cornerOffsetX, cornerOffsetY, edgeCornerA, edgeCornerB } from '@loreengine/runtime/view';
import type { HexDir, WorldView } from '@loreengine/runtime/view';
import { projectX, projectY } from './projection.ts';

/** The edges whose faces look toward the camera: south-west and south-east. */
export const CAMERA_FACING: readonly HexDir[] = [5, 6];

export interface TopMesh {
  cell: number;
  /** The terrain's top art. */
  frame: FrameRef;
  /** Cliff level, for placeholder shading. */
  level: number;
  /** Seven vertices: center, then corners 0..5; (x, y) pairs in world pixels. */
  vertices: Float32Array;
  /** Surface height of each of the seven vertices, world units. */
  heights: Float32Array;
}

export interface FaceQuad {
  cell: number;
  dir: HexDir;
  /** The terrain's cliff art, or null for the neutral engine face. */
  frame: FrameRef | null;
  /** Four vertices: top A, top B, bottom B, bottom A; (x, y) pairs in world pixels. */
  vertices: Float32Array;
  /** World height of the face's top and bottom at corners A and B. */
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

/** Indices of the six triangles of a top mesh (a fan around the center). */
export const TOP_INDICES = new Uint16Array([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5, 0, 5, 6, 0, 6, 1]);

/** Build the geometry of one map row. */
export function buildStrip(world: WorldView, project: Readonly<Project>, row: number): StripGeometry {
  const { hexSize, pixelsPerUnit: ppu } = project.settings;
  const tops: TopMesh[] = [];
  const faces: FaceQuad[] = [];
  for (let col = 0; col < world.width; col++) {
    const cell = row * world.width + col;
    const terrain = project.terrains[world.terrain(cell)]!;
    const cx = world.centerX(cell);
    const cy = world.centerY(cell);

    const vertices = new Float32Array(14);
    const heights = new Float32Array(7);
    const centerZ = world.heightIn(cell, cx, cy);
    vertices[0] = projectX(cx, ppu);
    vertices[1] = projectY(cy, centerZ, ppu);
    heights[0] = centerZ;
    for (let i = 0; i < 6; i++) {
      const x = cx + cornerOffsetX(i, hexSize);
      const y = cy + cornerOffsetY(i, hexSize);
      const z = world.heightIn(cell, x, y);
      vertices[(i + 1) * 2] = projectX(x, ppu);
      vertices[(i + 1) * 2 + 1] = projectY(y, z, ppu);
      heights[i + 1] = z;
    }
    tops.push({ cell, frame: terrain.top, level: world.level(cell), vertices, heights });

    for (const dir of CAMERA_FACING) {
      const a = edgeCornerA(dir);
      const b = edgeCornerB(dir);
      const ax = cx + cornerOffsetX(a, hexSize);
      const ay = cy + cornerOffsetY(a, hexSize);
      const bx = cx + cornerOffsetX(b, hexSize);
      const by = cy + cornerOffsetY(b, hexSize);
      const topA = heights[a + 1]!;
      const topB = heights[b + 1]!;
      // The neighbor's surface along the same edge; the map's border drops to height 0.
      const other = world.neighbor(cell, dir);
      const bottomA = other < 0 ? 0 : Math.min(topA, world.heightIn(other, ax, ay));
      const bottomB = other < 0 ? 0 : Math.min(topB, world.heightIn(other, bx, by));
      if (topA - bottomA < 1e-6 && topB - bottomB < 1e-6) continue; // nothing to show: the surfaces meet
      faces.push({
        cell,
        dir,
        frame: terrain.cliff ?? null,
        vertices: Float32Array.of(
          projectX(ax, ppu), projectY(ay, topA, ppu),
          projectX(bx, ppu), projectY(by, topB, ppu),
          projectX(bx, ppu), projectY(by, bottomB, ppu),
          projectX(ax, ppu), projectY(ay, bottomA, ppu),
        ),
        topA,
        topB,
        bottomA,
        bottomB,
      });
    }
  }
  return { row, tops, faces };
}

/** The highest surface on the loaded map, in world units (for culling). */
export function maxSurface(world: WorldView, levelHeight: number): number {
  let top = 0;
  const cells = world.width * world.height;
  for (let cell = 0; cell < cells; cell++) {
    const level = world.level(cell) + (world.ramp(cell) !== 0 ? 1 : 0);
    if (level > top) top = level;
  }
  return top * levelHeight;
}
