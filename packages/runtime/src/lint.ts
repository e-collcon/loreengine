/**
 * Map lint (spec 6.4). Warnings, shown in the editor, never load failures:
 * an unfinished map is still a valid file.
 *
 *   unreachable-area        walkable cells unreachable from the player's start
 *   placement-impassable    a placement on terrain it cannot stand on
 *   placement-on-cliff      a placement whose collider overlaps a cliff edge
 *   empty-region            a region with no cells
 */
import { cornerOffsetX, cornerOffsetY, edgeCornerA, edgeCornerB } from '@loreengine/hexmath';
import type { HexDir } from '@loreengine/hexmath';
import type { MapDef, Project } from '@loreengine/schema';
import { MODE_WALK, World, modeBit } from './world.ts';

export type LintCode = 'unreachable-area' | 'placement-impassable' | 'placement-on-cliff' | 'empty-region';

export interface LintWarning {
  code: LintCode;
  mapId: string;
  message: string;
  /** The cell the warning is about, when it has one. */
  cell?: number;
  /** How many cells an unreachable area has. */
  size?: number;
  placementKey?: string;
  regionId?: string;
}

/** At most this many unreachable areas are listed per map; the rest are summarized. */
export const MAX_UNREACHABLE_AREAS = 16;

export function lintMap(project: Project, def: MapDef): LintWarning[] {
  const out: LintWarning[] = [];
  const world = new World(project, def);
  const at = (cell: number): string => `(${cell % def.width}, ${Math.floor(cell / def.width)})`;

  // Walkable areas unreachable from the player's start.
  if (def.playerStart) {
    const start = world.cellAt(def.playerStart.x, def.playerStart.y);
    const seen = new Uint8Array(world.cells);
    const stack = new Int32Array(world.cells);
    const flood = (from: number): number => {
      let size = 0;
      let top = 0;
      stack[top++] = from;
      seen[from] = 1;
      while (top > 0) {
        const cell = stack[--top]!;
        size++;
        for (let d = 0; d < 6; d++) {
          const other = world.neighbor[cell * 6 + d]!;
          if (other >= 0 && seen[other] === 0 && (world.link[cell * 6 + d]! & MODE_WALK) !== 0) {
            seen[other] = 1;
            stack[top++] = other;
          }
        }
      }
      return size;
    };
    if (start >= 0 && world.passable(start, MODE_WALK)) flood(start);
    let areas = 0;
    let hidden = 0;
    for (let cell = 0; cell < world.cells; cell++) {
      if (seen[cell] === 1 || !world.passable(cell, MODE_WALK)) continue;
      const size = flood(cell);
      if (areas < MAX_UNREACHABLE_AREAS) {
        out.push({
          code: 'unreachable-area',
          mapId: def.id,
          cell,
          size,
          message: `${size} walkable cell${size === 1 ? '' : 's'} around ${at(cell)} cannot be reached from the player's start.`,
        });
      } else hidden++;
      areas++;
    }
    if (hidden > 0) {
      out.push({ code: 'unreachable-area', mapId: def.id, message: `${hidden} more unreachable area${hidden === 1 ? '' : 's'} not listed.` });
    }
  }

  // Placements on impassable terrain, or with a collider overlapping a cliff edge.
  for (const placement of def.placements) {
    const archetype = project.archetypes.find((a) => a.id === placement.archetypeId);
    if (!archetype) continue;
    const components = { ...archetype.components, ...placement.overrides };
    const mode = modeBit(components.movement?.startMode ?? 'walk');
    const cell = world.cellAt(placement.x, placement.y);
    if (!world.passable(cell, mode)) {
      out.push({
        code: 'placement-impassable',
        mapId: def.id,
        placementKey: placement.key,
        ...(cell >= 0 ? { cell } : {}),
        message: `"${archetype.name}" is placed ${cell < 0 ? 'off the map' : `on impassable terrain at ${at(cell)}`}.`,
      });
      continue;
    }
    const radius = components.collider?.radius ?? 0;
    if (radius <= 0) continue;
    const cx = world.centerX(cell);
    const cy = world.centerY(cell);
    for (let dir = 1; dir <= 6; dir++) {
      if (world.linked(cell, dir, mode)) continue;
      const ax = cx + cornerOffsetX(edgeCornerA(dir as HexDir), world.hexSize);
      const ay = cy + cornerOffsetY(edgeCornerA(dir as HexDir), world.hexSize);
      const bx = cx + cornerOffsetX(edgeCornerB(dir as HexDir), world.hexSize);
      const by = cy + cornerOffsetY(edgeCornerB(dir as HexDir), world.hexSize);
      if (distanceToSegment(placement.x, placement.y, ax, ay, bx, by) < radius) {
        out.push({
          code: 'placement-on-cliff',
          mapId: def.id,
          placementKey: placement.key,
          cell,
          message: `"${archetype.name}" at ${at(cell)} overlaps a cliff edge: its collider (radius ${radius}) crosses an edge it cannot pass.`,
        });
        break;
      }
    }
  }

  // Regions with no cells.
  for (const region of def.regions) {
    if (region.cells.length === 0) {
      out.push({ code: 'empty-region', mapId: def.id, regionId: region.id, message: `Region "${region.name}" has no cells.` });
    }
  }
  return out;
}

/** Lint every map of a project. */
export function lintProject(project: Project): LintWarning[] {
  return project.maps.flatMap((def) => lintMap(project, def));
}

export function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

