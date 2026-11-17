/**
 * The occlusion silhouette (spec 6.6). When terrain in front covers the
 * player, a tinted silhouette of the player is drawn through it. At most 4
 * entities get one (the player now; companions later).
 *
 * Whether an entity is covered is decided with the same height-aware pick
 * that clicks use: if the terrain picked at its lower body is in front of
 * where it stands, something is drawn over it.
 */
import type { RuntimeView } from '@loreengine/runtime/view';
import type { DrawList } from './drawlist.ts';
import { pickTerrain } from './picking.ts';
import type { TerrainPick } from './picking.ts';
import type { Camera } from './projection.ts';

export const MAX_SILHOUETTES = 4;

const scratch: TerrainPick = { cell: -1, x: 0, y: 0, z: 0 };

/** Is the entity at `index` (which must be in the draw list) covered by terrain in front of it? */
export function isOccluded(view: RuntimeView, cam: Camera, list: DrawList, index: number): boolean {
  if (list.indexOfEntity(index) < 0) return false;
  const sx = list.footX[index]!;
  // A third of the way up from its feet: a cliff in front covers a unit from the ground up.
  const sy = list.bottom[index]! - (list.bottom[index]! - list.top[index]!) * 0.3;
  if (!pickTerrain(view.world, view.project.settings, cam, sx, sy, scratch)) return false;
  // What the ray met is nearer the camera than the entity's feet, and stands higher than them.
  return scratch.y > view.entities.y(index) + 0.3 && scratch.z > view.entities.z(index) + 0.1;
}

/**
 * The entities that get a silhouette this frame: persistent, player-controlled
 * entities first, in index order, capped at 4. Writes indices into `out` and
 * returns how many.
 */
export function silhouettes(view: RuntimeView, cam: Camera, list: DrawList, out: Int32Array): number {
  let n = 0;
  const e = view.entities;
  for (let i = 0; i < e.highWater && n < MAX_SILHOUETTES && n < out.length; i++) {
    if (!e.alive(i)) continue;
    const data = e.data(i);
    if (data.playerControlled === undefined && data.persistent === undefined) continue; // lowest priority: dropped
    if (isOccluded(view, cam, list, i)) out[n++] = i;
  }
  return n;
}
