/**
 * Canvas overlays (spec 8.5), computed with the same headless functions the
 * game uses: blocked edges from the world's link table, lint from
 * `lintMap`, sight from `castTerrain`.
 */
import { MODE_WALK, castTerrain, lintMap } from '@loreengine/runtime/view';
import type { LintWarning, TerrainHit, World } from '@loreengine/runtime/view';
import { edgeCornerA, edgeCornerB, cornerOffsetX, cornerOffsetY } from '@loreengine/hexmath';
import type { HexDir } from '@loreengine/hexmath';
import type { MapDef, Project } from '@loreengine/schema';

export const OVERLAYS = ['levels', 'blocked', 'lint', 'regions', 'sight'] as const;
export type Overlay = (typeof OVERLAYS)[number];

/**
 * Edges a walker cannot cross although both cells are walkable: cliffs, two
 * or more levels apart. Each edge once, as x0, y0, z0, x1, y1, z1 on the
 * higher side's rim.
 */
export function blockedEdges(world: World): Float64Array {
  const out: number[] = [];
  const size = world.hexSize;
  for (let cell = 0; cell < world.cells; cell++) {
    if ((world.pass[cell]! & MODE_WALK) === 0) continue;
    for (let dir = 1; dir <= 3; dir++) {
      const other = world.neighbor[cell * 6 + dir - 1]!;
      if (other < 0 || (world.pass[other]! & MODE_WALK) === 0) continue;
      if ((world.link[cell * 6 + dir - 1]! & MODE_WALK) !== 0) continue;
      const cx = world.centerX(cell);
      const cy = world.centerY(cell);
      const a = edgeCornerA(dir as HexDir);
      const b = edgeCornerB(dir as HexDir);
      const x0 = cx + cornerOffsetX(a, size);
      const y0 = cy + cornerOffsetY(a, size);
      const x1 = cx + cornerOffsetX(b, size);
      const y1 = cy + cornerOffsetY(b, size);
      // Draw on the rim of whichever side is higher at that point.
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      const high = world.surfaceHeightIn(cell, mx, my) >= world.surfaceHeightIn(other, mx, my) ? cell : other;
      out.push(x0, y0, world.surfaceHeightIn(high, x0, y0), x1, y1, world.surfaceHeightIn(high, x1, y1));
    }
  }
  return Float64Array.from(out);
}

export interface WarningRow extends LintWarning {
  /** Where click-to-focus centers the camera, or null for a warning with no place. */
  focus: { x: number; y: number } | null;
}

/** The warnings panel's rows for one map. */
export function warningRows(project: Project, map: MapDef, world: World): WarningRow[] {
  return lintMap(project, map).map((w) => {
    let focus: WarningRow['focus'] = null;
    if (w.cell !== undefined && w.cell >= 0) focus = { x: world.centerX(w.cell), y: world.centerY(w.cell) };
    else if (w.placementKey) {
      const p = map.placements.find((q) => q.key === w.placementKey);
      if (p) focus = { x: p.x, y: p.y };
    }
    return { ...w, focus };
  });
}

/**
 * Which cells an eye at (x, y, eyeZ) sees within `range` (spec 8.5's sight
 * overlay, the rule of 7.6): a segment to a target standing on each cell
 * (`targetHeight` tall, aimed at its middle) is not blocked by terrain, and
 * high ground hides a cell beyond `uphillRevealRange` when `uphillBlocked`.
 */
export function visibleCells(project: Project, world: World, x: number, y: number, eyeZ: number, range: number, targetHeight: number): Uint8Array {
  const out = new Uint8Array(world.cells);
  const hit: TerrainHit = { t: 1, cell: -1 };
  const rule = project.settings.sight;
  const ground = world.surfaceHeight(x, y);
  const rise = 0.5 * project.settings.levelHeight;
  for (let cell = 0; cell < world.cells; cell++) {
    const cx = world.centerX(cell);
    const cy = world.centerY(cell);
    const d2 = (cx - x) * (cx - x) + (cy - y) * (cy - y);
    if (d2 > range * range) continue;
    const surface = world.surfaceHeightIn(cell, cx, cy);
    if (rule.uphillBlocked && surface - ground > rise && d2 > rule.uphillRevealRange * rule.uphillRevealRange) continue;
    if (!castTerrain(world, x, y, eyeZ, cx, cy, surface + targetHeight * 0.5, false, hit)) out[cell] = 1;
  }
  return out;
}
