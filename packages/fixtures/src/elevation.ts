/**
 * The elevation fixture: a small two-map project for world, lifecycle, and
 * render-spike tests. It reuses Emberfall's terrains, attacks, and art.
 *
 *   Terraces (16 x 12)
 *     - a level-2 plateau reached from the west by two stacked ramps
 *     - a level-1 terrace east of it, reached from the south by one ramp
 *     - a pond, a rock pillar, and a level-3 rock spire
 *     - three inert dummies that set up the spike scenes:
 *         behind-cliff   on low ground north of the plateau (hidden by it)
 *         plateau-edge   on the plateau's southern edge
 *         on-ramp        on the upper stacked ramp
 *     - a door region that teleports the player to the cellar
 *
 *   Cellar (8 x 8)
 *     - a walled room with stairs back to the terraces and one dummy
 */
import type { ArchetypeDef, EntityPlacement, MapDef, Project, TriggerDef } from '@loreengine/schema';
import { MapPainter, cellCenter, id, regionCells } from './build.ts';
import { buildEmberfall } from './emberfall.ts';

/** Named cells of the fixture, in offset coordinates. */
export const ELEVATION = {
  terraces: {
    width: 16,
    height: 12,
    playerStart: { col: 3, row: 9 },
    plateau: { col: 6, row: 2, w: 5, h: 5 },
    rampLow: { col: 4, row: 4 }, //   level 0 -> 1, rising east
    rampHigh: { col: 5, row: 4 }, //  level 1 -> 2, rising east
    terrace: { col: 11, row: 2, w: 3, h: 5 },
    terraceRamp: { col: 12, row: 7 }, // level 0 -> 1, rising north-west (dir 3)
    pond: { col: 1, row: 6, w: 2, h: 2 },
    pillar: { col: 8, row: 9 },
    spire: { col: 2, row: 2 },
    behindCliff: { col: 8, row: 1 },
    plateauEdge: { col: 8, row: 6 },
    onRamp: { col: 5, row: 4 },
    door: { col: 14, row: 10 },
    arrival: { col: 13, row: 9 },
  },
  cellar: {
    width: 8,
    height: 8,
    stairs: { col: 1, row: 1 },
    arrival: { col: 4, row: 4 },
    guard: { col: 5, row: 5 },
  },
} as const;

const T = { grass: 0, dirt: 1, stone: 2, lava: 3, water: 4, rock: 5 } as const;

export function buildElevation(): Project {
  const p = buildEmberfall();
  p.id = id('project', 'elevation');
  p.name = 'Elevation fixture';
  p.triggers = [];

  // A unit that only stands there: no brain, no movement.
  const dummy: ArchetypeDef = {
    id: id('archetype', 'dummy'),
    name: 'Dummy',
    tags: ['dummy'],
    components: {
      collider: { radius: 0.35, height: 1.6, solid: true },
      health: { max: 50 },
      sprite: { animationSetId: id('animset', 'sentry'), scale: undefined },
    },
  };
  p.archetypes.push(dummy);

  const palette = p.terrains.map((t) => t.id);
  const place = (name: string, cell: { col: number; row: number }): EntityPlacement => ({
    key: id('placement', name),
    archetypeId: dummy.id,
    ...cellCenter(cell.col, cell.row),
    facing: Math.PI / 2,
    overrides: undefined,
  });
  const trigger = (name: string, when: TriggerDef['when'], then: TriggerDef['then']): TriggerDef => ({
    id: id('trigger', name),
    when,
    given: [],
    then,
    once: false,
    enabled: true,
  });

  /* ---- terraces --------------------------------------------------------- */
  const A = ELEVATION.terraces;
  const paintA = new MapPainter(A.width, A.height);
  paintA.fill({ col: 0, row: 0, w: A.width, h: A.height }, T.grass, 0);
  paintA.fill(A.plateau, T.stone, 2);
  paintA.setRamp(A.rampLow.col, A.rampLow.row, T.dirt, 0, 1);
  paintA.setRamp(A.rampHigh.col, A.rampHigh.row, T.dirt, 1, 1);
  paintA.fill(A.terrace, T.dirt, 1);
  paintA.setRamp(A.terraceRamp.col, A.terraceRamp.row, T.dirt, 0, 3);
  paintA.fill(A.pond, T.water, 0);
  paintA.fill({ ...A.pillar, w: 1, h: 1 }, T.rock, 0);
  paintA.fill({ ...A.spire, w: 1, h: 1 }, T.rock, 3);

  const terracesId = id('map', 'terraces');
  const cellarId = id('map', 'cellar');
  const doorRegion = id('region', 'door');
  const stairsRegion = id('region', 'stairs');
  const startA = cellCenter(A.playerStart.col, A.playerStart.row);
  const arriveB = cellCenter(ELEVATION.cellar.arrival.col, ELEVATION.cellar.arrival.row);
  const arriveA = cellCenter(A.arrival.col, A.arrival.row);

  const terraces: MapDef = {
    id: terracesId,
    name: 'Terraces',
    width: A.width,
    height: A.height,
    terrainPalette: palette,
    layers: paintA.layers(),
    playerStart: { x: startA.x, y: startA.y, facing: -Math.PI / 2 },
    placements: [place('behind-cliff', A.behindCliff), place('plateau-edge', A.plateauEdge), place('on-ramp', A.onRamp)],
    regions: [
      { id: doorRegion, name: 'Door', cells: regionCells({ ...A.door, w: 1, h: 1 }) },
      { id: id('region', 'plateau'), name: 'Plateau', cells: regionCells(A.plateau) },
    ],
    triggers: [
      trigger('enter-cellar', { type: 'region-entered', regionId: doorRegion, who: { by: 'player' } }, [
        { type: 'teleport', target: { by: 'player' }, mapId: cellarId, x: arriveB.x, y: arriveB.y },
      ]),
    ],
    bgm: undefined,
  };

  /* ---- cellar ----------------------------------------------------------- */
  const B = ELEVATION.cellar;
  const paintB = new MapPainter(B.width, B.height);
  paintB.fill({ col: 0, row: 0, w: B.width, h: B.height }, T.stone, 0);
  paintB.frame({ col: 0, row: 0, w: B.width, h: B.height }, T.rock, 0);
  const cellar: MapDef = {
    id: cellarId,
    name: 'Cellar',
    width: B.width,
    height: B.height,
    terrainPalette: palette,
    layers: paintB.layers(),
    playerStart: undefined,
    placements: [place('cellar-guard', B.guard)],
    regions: [{ id: stairsRegion, name: 'Stairs', cells: regionCells({ ...B.stairs, w: 1, h: 1 }) }],
    triggers: [
      trigger('leave-cellar', { type: 'region-entered', regionId: stairsRegion, who: { by: 'player' } }, [
        { type: 'teleport', target: { by: 'player' }, mapId: terracesId, x: arriveA.x, y: arriveA.y },
      ]),
    ],
    bgm: undefined,
  };

  p.maps = [terraces, cellar];
  p.startMapId = terracesId;
  return p;
}
