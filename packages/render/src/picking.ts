/**
 * Height-aware picking (spec 6.6). The view ray from the cursor is marched
 * down from the top level to level 0 in quarter-level steps; the first
 * column the ray enters is the pick. So clicking a plateau selects the
 * plateau, not the low hex under its flat footprint, and clicking a cliff
 * face selects the column it belongs to.
 */
import type { ProjectSettings } from '@loreengine/schema';
import type { WorldView } from '@loreengine/runtime/view';
import { worldXAt, worldYAt } from './projection.ts';
import type { Camera } from './projection.ts';

export interface TerrainPick {
  /** The picked column. */
  cell: number;
  /** Where the ray meets it, on the world plane, and the surface height there. */
  x: number;
  y: number;
  z: number;
}

const STEPS_PER_LEVEL = 4;
const REFINE_STEPS = 12;

/**
 * Pick the terrain under screen point (sx, sy). Returns false when the ray
 * meets no column (off the map); otherwise fills `out` and returns true.
 */
export function pickTerrain(world: WorldView, settings: ProjectSettings, cam: Camera, sx: number, sy: number, out: TerrainPick): boolean {
  const ppu = settings.pixelsPerUnit;
  const x = worldXAt(cam, ppu, sx);
  const step = settings.levelHeight / STEPS_PER_LEVEL;
  // One level above the top, so a ramp on a maxLevel cell is still entered from above.
  const top = (settings.maxLevel + 1) * settings.levelHeight;
  let above = top; // the last height at which the ray was still in the open
  for (let h = top; h >= -1e-9; h -= step) {
    const height = h < 0 ? 0 : h;
    const y = worldYAt(cam, ppu, sy, height);
    const cell = world.cellAt(x, y);
    if (cell >= 0 && world.heightIn(cell, x, y) >= height - 1e-9) {
      // The ray is inside this column. Bisect between the last open height and this
      // one for the entry point; on a top face that is where the ray meets the surface.
      let lo = height;
      let hi = above;
      for (let i = 0; i < REFINE_STEPS && hi - lo > 1e-6; i++) {
        const mid = (lo + hi) / 2;
        const my = worldYAt(cam, ppu, sy, mid);
        const mc = world.cellAt(x, my);
        if (mc >= 0 && world.heightIn(mc, x, my) >= mid - 1e-9) lo = mid;
        else hi = mid;
      }
      const fy = worldYAt(cam, ppu, sy, lo);
      const fc = world.cellAt(x, fy);
      out.cell = fc >= 0 ? fc : cell;
      out.x = x;
      out.y = fy;
      out.z = world.heightIn(out.cell, x, fy);
      return true;
    }
    above = height;
  }
  return false;
}

/**
 * Pick the front-most entity whose sprite bounds contain (sx, sy), testing
 * in reverse draw order. Returns the entity index, or -1.
 */
export function pickEntity(
  list: { count: number; kind: Uint8Array; ref: Int32Array; left: Float64Array; top: Float64Array; right: Float64Array; bottom: Float64Array },
  sx: number,
  sy: number,
): number {
  for (let i = list.count - 1; i >= 0; i--) {
    if (list.kind[i] !== 1) continue;
    const index = list.ref[i]!;
    if (sx >= list.left[index]! && sx <= list.right[index]! && sy >= list.top[index]! && sy <= list.bottom[index]!) return index;
  }
  return -1;
}
