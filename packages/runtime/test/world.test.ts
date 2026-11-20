import { describe, expect, it } from 'vitest';
import { ELEVATION, EMBERFALL, MapPainter, buildElevation, buildEmberfall, cellCenter, id } from '@loreengine/fixtures';
import { HEX_DIRS, cornerOffsetX, cornerOffsetY, edgeCornerA, edgeCornerB, neighborIndex, oppositeDir } from '@loreengine/hexmath';
import type { HexDir } from '@loreengine/hexmath';
import { checkProject } from '@loreengine/schema';
import type { MapDef, MovementMode, Project } from '@loreengine/schema';
import { lintMap, lintProject } from '../src/lint.ts';
import { EDGE_CLIFF, EDGE_FLAT, EDGE_SLOPE, MODE_FLY, MODE_SWIM, MODE_WALK, SOLID_FACTOR, World, edgeType, levelsConnect, terraceFraction } from '../src/world.ts';

const T = { grass: 0, dirt: 1, stone: 2, lava: 3, water: 4, rock: 5 } as const;

/** A one-map project over Emberfall's terrains, painted by `paint`. */
function customMap(width: number, height: number, paint: (m: MapPainter) => void, settings?: Partial<Project['settings']>): { project: Project; def: MapDef; world: World } {
  const project = buildEmberfall();
  Object.assign(project.settings, settings);
  const painter = new MapPainter(width, height);
  painter.fill({ col: 0, row: 0, w: width, h: height }, T.grass, 0);
  paint(painter);
  const start = cellCenter(0, 0, project.settings.hexSize);
  const def: MapDef = { ...project.maps[0]!, id: id('map', 'custom'), width, height, layers: painter.layers(), playerStart: { x: start.x, y: start.y, facing: 0 }, placements: [], regions: [], triggers: [] };
  project.maps = [def];
  project.startMapId = def.id;
  expect(checkProject(project)).toEqual([]);
  return { project, def, world: new World(project, def) };
}

const MODES: MovementMode[] = ['walk', 'swim', 'fly'];

describe('[P3A.connects.table] ★ the connection table', () => {
  // The cell at the center of a 5 x 5 map, and its neighbor in each direction.
  const W = 5;
  const CENTER = 2 * W + 2;
  const nb = (dir: HexDir): number => neighborIndex(CENTER, dir, W, W);
  const col = (cell: number) => cell % W;
  const row = (cell: number) => Math.floor(cell / W);

  /** Build the pair (center, neighbor in `dir`) at the given levels, and ask every mode. */
  function pair(dir: HexDir, a: number, b: number): Record<MovementMode, boolean> {
    const { world } = customMap(W, W, (m) => {
      m.fill({ col: 0, row: 0, w: W, h: W }, T.grass, 15); // surroundings far above: nothing else connects
      m.fill({ col: col(CENTER), row: row(CENTER), w: 1, h: 1 }, T.grass, a);
      m.fill({ col: col(nb(dir)), row: row(nb(dir)), w: 1, h: 1 }, T.grass, b);
    });
    const out = {} as Record<MovementMode, boolean>;
    for (const mode of MODES) {
      out[mode] = world.connects(CENTER, nb(dir), mode);
      // The rule is symmetric: if you can step a -> b you can step b -> a.
      expect(world.connects(nb(dir), CENTER, mode), `symmetry ${mode}`).toBe(out[mode]);
    }
    return out;
  }

  it('edge types follow Catlike: flat at the same level, a slope one level apart, a cliff two or more (D194)', () => {
    for (let a = 0; a <= 15; a++) {
      for (let b = 0; b <= 15; b++) {
        const d = Math.abs(a - b);
        expect(edgeType(a, b)).toBe(d === 0 ? EDGE_FLAT : d === 1 ? EDGE_SLOPE : EDGE_CLIFF);
        expect(edgeType(a, b)).toBe(edgeType(b, a));
        expect(levelsConnect(a, b)).toBe(d <= 1);
      }
    }
    const { world } = customMap(3, 3, (m) => {
      m.fill({ col: 1, row: 1, w: 1, h: 1 }, T.grass, 2);
      m.fill({ col: 2, row: 1, w: 1, h: 1 }, T.grass, 3); // east of the middle: a slope
      m.fill({ col: 0, row: 1, w: 1, h: 1 }, T.grass, 2); // west: flat
    });
    expect(world.edgeType(4, 1)).toBe('slope');
    expect(world.edgeType(4, 4)).toBe('flat');
    for (const dir of [2, 3, 5, 6] as HexDir[]) expect(world.edgeType(4, dir)).toBe('cliff'); // level 0 around
    expect(world.edgeType(0, 4)).toBe('none'); // west of the corner cell: off the map
  });

  it('walk connects at the same level and one level apart, in both directions, and never two or more apart', () => {
    for (const dir of HEX_DIRS) {
      expect(pair(dir, 2, 2).walk).toBe(true);
      expect(pair(dir, 2, 3).walk).toBe(true);
      expect(pair(dir, 3, 2).walk).toBe(true);
      expect(pair(dir, 0, 1).walk).toBe(true);
      expect(pair(dir, 2, 4).walk).toBe(false);
      expect(pair(dir, 4, 2).walk).toBe(false);
      expect(pair(dir, 0, 15).walk).toBe(false);
    }
  });

  it('the rule is symmetric for every pair of levels and every direction', () => {
    let cases = 0;
    for (const dir of HEX_DIRS) {
      for (let la = 0; la < 5; la++) {
        for (let lb = 0; lb < 5; lb++) {
          expect(pair(dir, la, lb).walk).toBe(Math.abs(la - lb) <= 1);
          cases++;
        }
      }
    }
    expect(cases).toBe(6 * 25);
  });

  it('walk needs walk-passable terrain on both sides', () => {
    const { world } = customMap(4, 1, (m) => {
      m.fill({ col: 2, row: 0, w: 1, h: 1 }, T.rock, 0);
      m.fill({ col: 3, row: 0, w: 1, h: 1 }, T.water, 0);
    });
    expect(world.connects(0, 1, 'walk')).toBe(true);
    expect(world.connects(1, 2, 'walk')).toBe(false); // grass -> rock
    expect(world.connects(2, 3, 'walk')).toBe(false); // rock -> water
    expect(world.passable(1, MODE_WALK)).toBe(true);
    expect(world.passable(3, MODE_WALK)).toBe(false);
  });

  it('swim uses the same rule on swimmable cells', () => {
    const { world } = customMap(5, 1, (m) => {
      m.fill({ col: 1, row: 0, w: 2, h: 1 }, T.water, 0);
      m.fill({ col: 3, row: 0, w: 1, h: 1 }, T.water, 2); // a pool two levels up: a waterfall edge
      m.fill({ col: 4, row: 0, w: 1, h: 1 }, T.water, 3); // and one more level: a slope from it
    });
    expect(world.connects(1, 2, 'swim')).toBe(true);
    expect(world.connects(1, 2, 'walk')).toBe(false);
    expect(world.connects(0, 1, 'swim')).toBe(false); // grass is not swimmable
    expect(world.connects(2, 3, 'swim')).toBe(false); // same terrain, two levels apart: a cliff
    expect(world.connects(3, 4, 'swim')).toBe(true); //  one level apart: a slope
    expect(world.passable(1, MODE_SWIM)).toBe(true);
  });

  it('fly ignores edge heights and is blocked only by terrain with passable.fly false', () => {
    const { world } = customMap(5, 1, (m) => {
      m.fill({ col: 1, row: 0, w: 1, h: 1 }, T.grass, 7); // a cliff
      m.fill({ col: 2, row: 0, w: 1, h: 1 }, T.grass, 3); // another cliff, down
      m.fill({ col: 3, row: 0, w: 1, h: 1 }, T.water, 0);
      m.fill({ col: 4, row: 0, w: 1, h: 1 }, T.rock, 0); //  rock: fly false
    });
    expect(world.connects(0, 1, 'fly')).toBe(true);
    expect(world.connects(1, 2, 'fly')).toBe(true);
    expect(world.connects(2, 3, 'fly')).toBe(true);
    expect(world.connects(3, 4, 'fly')).toBe(false);
    expect(world.connects(0, 1, 'walk')).toBe(false);
    expect(world.passable(4, MODE_FLY)).toBe(false);
  });

  it('nothing connects off the map or between cells that are not neighbors', () => {
    const { world } = customMap(4, 4, () => {});
    expect(world.connects(0, 2, 'walk')).toBe(false);
    expect(world.connects(0, 0, 'walk')).toBe(false);
    expect(world.connects(0, -1, 'walk')).toBe(false);
    expect(world.connects(0, 99, 'fly')).toBe(false);
    expect(world.neighbor[0 * 6 + 3]).toBe(-1); // west of the corner cell
  });

  it('Emberfall: the plateau is reached only through its level-1 step', () => {
    const p = buildEmberfall();
    const world = new World(p, p.maps[0]!);
    const at = (c: { col: number; row: number }) => c.row * EMBERFALL.width + c.col;
    const { plateau, step } = EMBERFALL;
    const stepCells = new Set<number>();
    for (let r = step.row; r < step.row + step.h; r++) for (let c = step.col; c < step.col + step.w; c++) stepCells.add(at({ col: c, row: r }));
    // Every step cell joins the ground (level 0) and the plateau (level 2).
    for (const cell of stepCells) {
      expect(world.level[cell]).toBe(1);
      const levels = new Set<number>();
      for (let d = 0; d < 6; d++) {
        const other = world.neighbor[cell * 6 + d]!;
        if (other >= 0 && (world.link[cell * 6 + d]! & MODE_WALK) !== 0) levels.add(world.level[other]!);
      }
      expect(levels.has(0) && levels.has(2)).toBe(true);
    }
    // Every other edge of the plateau's rim is a cliff: its only walkable links off the plateau go to the step.
    let rimLinks = 0;
    for (let r = plateau.row; r < plateau.row + plateau.h; r++) {
      for (let c = plateau.col; c < plateau.col + plateau.w; c++) {
        const cell = at({ col: c, row: r });
        for (let d = 0; d < 6; d++) {
          const other = world.neighbor[cell * 6 + d]!;
          if (other < 0 || world.level[other] === 2 || (world.link[cell * 6 + d]! & MODE_WALK) === 0) continue;
          expect(stepCells.has(other)).toBe(true);
          rimLinks++;
        }
      }
    }
    expect(rimLinks).toBeGreaterThanOrEqual(2);
  });
});

describe('[P3A.world.cell-at] cellAt', () => {
  it('maps every cell center to its cell and anything off the map to -1', () => {
    const p = buildElevation();
    const world = new World(p, p.maps[0]!);
    for (let row = 0; row < world.height; row++) {
      for (let col = 0; col < world.width; col++) {
        const c = cellCenter(col, row);
        expect(world.cellAt(c.x, c.y)).toBe(row * world.width + col);
        expect(world.centerX(row * world.width + col)).toBeCloseTo(c.x, 12);
        expect(world.centerY(row * world.width + col)).toBeCloseTo(c.y, 12);
      }
    }
    expect(world.cellAt(-5, 0)).toBe(-1);
    expect(world.cellAt(0, -5)).toBe(-1);
    expect(world.cellAt(1e6, 3)).toBe(-1);
    expect(world.cellAt(3, 1e6)).toBe(-1);
    expect([world.width, world.height, world.cells]).toEqual([16, 12, 192]);
  });

  it('scales with ProjectSettings.hexSize', () => {
    const { world } = customMap(6, 6, () => {}, { hexSize: 2.5 });
    const c = cellCenter(3, 2, 2.5);
    expect(world.cellAt(c.x, c.y)).toBe(2 * 6 + 3);
    expect(world.cellAt(c.x + 2.0, c.y)).toBe(2 * 6 + 3); // still inside a hex of size 2.5
    const small = customMap(6, 6, () => {}, { hexSize: 1 }).world;
    expect(small.cellAt(c.x, c.y)).not.toBe(2 * 6 + 3);
  });
});

describe('[P3A.world.surface-height] surfaceHeight', () => {
  it('a flat cell is level x levelHeight everywhere on it', () => {
    const p = buildElevation();
    const world = new World(p, p.maps[0]!);
    const A = ELEVATION.terraces;
    const h = (cell: { col: number; row: number }, dx = 0, dy = 0) => {
      const c = cellCenter(cell.col, cell.row);
      return world.surfaceHeight(c.x + dx, c.y + dy);
    };
    expect(h(A.playerStart)).toBe(0);
    expect(h(A.plateauEdge)).toBe(1); // level 2 x 0.5
    expect(h(A.plateauEdge, 0.4, -0.3)).toBe(1);
    expect(h({ col: A.terrace.col, row: A.terrace.row })).toBe(0.5);
    expect(h(A.spire)).toBe(1.5);
    expect(world.surfaceHeight(-10, -10)).toBe(0); // off the map
  });

  it('a slope is terraced: flat inner hexes, rises and flat steps between, as Catlike draws it (D194)', () => {
    // Two cells side by side, east-west: level 0 and level 1 (a slope), levelHeight 0.5.
    const { world } = customMap(2, 1, (m) => m.fill({ col: 1, row: 0, w: 1, h: 1 }, T.grass, 1));
    const a = Math.sqrt(3) / 2;
    const c0 = cellCenter(0, 0);
    const inner = SOLID_FACTOR * a;
    const span = 2 * a * (1 - SOLID_FACTOR);
    const h = (t: number) => world.surfaceHeight(c0.x + inner + t * span, c0.y);
    expect(world.surfaceHeight(c0.x, c0.y)).toBe(0);
    expect(world.surfaceHeight(c0.x + inner * 0.99, c0.y)).toBe(0); // the inner hex is flat
    // Rise, flat step, rise, flat step, rise: a third of a level each rise.
    expect(h(0.1)).toBeCloseTo((0.5 / 3) * 0.5, 9);
    expect(h(0.2)).toBeCloseTo(0.5 / 3, 9);
    expect(h(0.3)).toBeCloseTo(0.5 / 3, 9); //        on the first flat step
    expect(h(0.5)).toBeCloseTo(0.25, 9); //           halfway: the shared border
    expect(h(0.7)).toBeCloseTo((2 * 0.5) / 3, 9); //  the second flat step
    expect(h(0.9)).toBeCloseTo((2.5 * 0.5) / 3, 9);
    expect(world.surfaceHeight(cellCenter(1, 0).x, c0.y)).toBe(0.5);
    // The profile is symmetric: f(1 - t) = 1 - f(t).
    for (const t of [0, 0.05, 0.2, 0.33, 0.5, 0.61, 0.8, 0.97, 1]) expect(terraceFraction(1 - t)).toBeCloseTo(1 - terraceFraction(t), 12);
  });

  it('a cliff keeps each side flat up to the shared border', () => {
    const { world } = customMap(2, 1, (m) => m.fill({ col: 1, row: 0, w: 1, h: 1 }, T.grass, 2));
    const c0 = cellCenter(0, 0);
    const border = c0.x + Math.sqrt(3) / 2;
    expect(world.surfaceHeight(border - 1e-6, c0.y)).toBe(0);
    expect(world.surfaceHeight(border + 1e-6, c0.y)).toBe(1);
    expect(world.surfaceHeight(c0.x + 0.8, c0.y)).toBe(0);
  });

  it('wide steps connect sideways and both ways (N6 resolved)', () => {
    // A column of level-1 cells between level 0 (west) and level 2 (east).
    const { world } = customMap(5, 5, (m) => {
      m.fill({ col: 2, row: 0, w: 1, h: 5 }, T.grass, 1);
      m.fill({ col: 3, row: 0, w: 2, h: 5 }, T.grass, 2);
    });
    const a = 2 * 5 + 2;
    for (const dir of HEX_DIRS) {
      const other = world.neighbor[a * 6 + dir - 1]!;
      expect(world.connects(a, other, 'walk')).toBe(true); // flat to its step neighbors, slopes east and west
    }
  });

  it('scales with ProjectSettings.levelHeight', () => {
    const { world } = customMap(3, 1, (m) => {
      m.fill({ col: 0, row: 0, w: 1, h: 1 }, T.grass, 3);
      m.fill({ col: 1, row: 0, w: 1, h: 1 }, T.grass, 4);
    }, { levelHeight: 2 });
    expect(world.surfaceHeight(0, 0)).toBe(6);
    const c = cellCenter(1, 0);
    expect(world.surfaceHeight(c.x, c.y)).toBe(8);
    expect(world.surfaceHeight((cellCenter(0, 0).x + c.x) / 2, c.y)).toBeCloseTo(7, 9); // the shared border, halfway up
  });

  it('[P3A.world.continuity] has no jump across any connecting edge, sampled at 1,000+ points', () => {
    let s = 12345;
    const rnd = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const worlds: World[] = [];
    const emberfall = buildEmberfall();
    worlds.push(new World(emberfall, emberfall.maps[0]!));
    const elevation = buildElevation();
    worlds.push(new World(elevation, elevation.maps[0]!));
    // Random maps with levels 0..3, so flats, slopes, cliffs and every kind of corner occur.
    for (let k = 0; k < 6; k++) {
      worlds.push(
        customMap(14, 14, (m) => {
          for (let i = 0; i < 14 * 14; i++) m.fill({ col: i % 14, row: Math.floor(i / 14), w: 1, h: 1 }, T.grass, Math.floor(rnd() * 4));
        }).world,
      );
    }
    let samples = 0;
    let slopeEdges = 0;
    for (const world of worlds) {
      for (let cell = 0; cell < world.cells; cell++) {
        for (const dir of HEX_DIRS) {
          const other = world.neighbor[cell * 6 + dir - 1]!;
          if (other < 0 || !world.linked(cell, dir, MODE_WALK)) continue;
          if (world.level[cell] !== world.level[other]) slopeEdges++;
          const cx = world.centerX(cell);
          const cy = world.centerY(cell);
          const ax = cx + cornerOffsetX(edgeCornerA(dir), world.hexSize);
          const ay = cy + cornerOffsetY(edgeCornerA(dir), world.hexSize);
          const bx = cx + cornerOffsetX(edgeCornerB(dir), world.hexSize);
          const by = cy + cornerOffsetY(edgeCornerB(dir), world.hexSize);
          // Along the whole shared edge, into the corner regions at both ends (not the corner point itself).
          for (const t of [0.002, 0.02, 0.1, 0.2, 0.5, 0.8, 0.9, 0.98, 0.998, rnd()]) {
            const px = ax + (bx - ax) * t;
            const py = ay + (by - ay) * t;
            // The same point on the shared edge, as each of the two cells defines its height.
            const mine = world.surfaceHeightIn(cell, px, py);
            const theirs = world.surfaceHeightIn(other, px, py);
            if (Math.abs(mine - theirs) > 1e-9) throw new Error(`jump of ${mine - theirs} across edge ${cell} -> ${other}`);
            samples++;
          }
        }
      }
    }
    expect(samples).toBeGreaterThan(1000);
    expect(slopeEdges).toBeGreaterThan(50);
  });

  it('where every corner\'s cells are within one level, the surface is continuous everywhere, inside cells too', () => {
    let s = 777;
    const rnd = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    let checked = 0;
    for (let k = 0; k < 4; k++) {
      // Levels k and k + 1 only: no cliffs anywhere.
      const { world } = customMap(12, 12, (m) => {
        for (let i = 0; i < 144; i++) m.fill({ col: i % 12, row: Math.floor(i / 12), w: 1, h: 1 }, T.grass, k + (rnd() < 0.5 ? 1 : 0));
      });
      const w = Math.sqrt(3) * 12;
      for (let n = 0; n < 4000; n++) {
        const x = 1 + rnd() * (w - 2);
        const y = 1 + rnd() * 15;
        const step = 1e-5;
        const angle = rnd() * Math.PI * 2;
        const dh = Math.abs(world.surfaceHeight(x, y) - world.surfaceHeight(x + step * Math.cos(angle), y + step * Math.sin(angle)));
        // The steepest rise climbs a third of a level over a fifth of a bridge: far less than 0.01 over 1e-5.
        if (dh > 1e-2) throw new Error(`jump of ${dh} at (${x}, ${y})`);
        checked++;
      }
    }
    expect(checked).toBe(16000);
  });
});

describe('[P3A.lint.map] map lint: warnings, never load failures', () => {
  it('Emberfall: the deliberately unreachable ledge is the only warning', () => {
    const p = buildEmberfall();
    expect(checkProject(p)).toEqual([]); // an unfinished map is still a valid file
    const warnings = lintProject(p);
    expect(warnings).toHaveLength(1);
    const { ledge } = EMBERFALL;
    expect(warnings[0]).toMatchObject({ code: 'unreachable-area', mapId: p.maps[0]!.id, size: ledge.w * ledge.h });
    const cell = warnings[0]!.cell!;
    const col = cell % EMBERFALL.width;
    const row = Math.floor(cell / EMBERFALL.width);
    expect(col >= ledge.col && col < ledge.col + ledge.w && row >= ledge.row && row < ledge.row + ledge.h).toBe(true);
  });

  it('the elevation fixture is clean', () => {
    expect(lintProject(buildElevation())).toEqual([]);
  });

  it('a pinnacle one level up is reachable; two levels up it is not (D194)', () => {
    const { project, def } = customMap(6, 3, (m) => {
      m.fill({ col: 2, row: 1, w: 1, h: 1 }, T.grass, 1);
      m.fill({ col: 4, row: 1, w: 1, h: 1 }, T.grass, 2);
    });
    const areas = lintMap(project, def).filter((w) => w.code === 'unreachable-area');
    expect(areas.map((w) => w.cell)).toEqual([1 * 6 + 4]);
  });

  it('walkable areas unreachable from the player\'s start are reported with their size', () => {
    const { project, def } = customMap(8, 4, (m) => {
      m.fill({ col: 4, row: 0, w: 1, h: 4 }, T.rock, 0); // a wall splitting the map
      m.fill({ col: 6, row: 1, w: 1, h: 1 }, T.grass, 5); // an isolated pinnacle
    });
    const areas = lintMap(project, def).filter((w) => w.code === 'unreachable-area');
    expect(areas.map((w) => w.size).sort()).toEqual([1, 11]);
    expect(areas.every((w) => typeof w.cell === 'number')).toBe(true);
  });

  it('a placement on impassable terrain, or with its collider overlapping a cliff edge, is reported', () => {
    const p = buildElevation();
    const def = p.maps[0]!;
    const A = ELEVATION.terraces;
    const key = (name: string) => id('placement', name);
    const template = def.placements[0]!;
    const rock = cellCenter(A.pillar.col, A.pillar.row);
    const pond = cellCenter(A.pond.col, A.pond.row);
    const edge = cellCenter(A.plateau.col, A.plateau.row); // the plateau's north-west corner cell
    def.placements.push(
      { ...template, key: key('in-rock'), x: rock.x, y: rock.y },
      { ...template, key: key('in-pond'), x: pond.x, y: pond.y },
      { ...template, key: key('off-map'), x: -9, y: -9 },
      { ...template, key: key('hugging-cliff'), x: edge.x - 0.7, y: edge.y }, // 0.17 from the west edge, radius 0.35
      { ...template, key: key('safe-on-plateau'), x: edge.x + 1.7, y: edge.y + 1.5 },
    );
    const warnings = lintMap(p, def);
    expect(warnings.filter((w) => w.code === 'placement-impassable').map((w) => w.placementKey).sort()).toEqual([key('in-pond'), key('in-rock'), key('off-map')].sort());
    expect(warnings.filter((w) => w.code === 'placement-on-cliff').map((w) => w.placementKey)).toEqual([key('hugging-cliff')]);
    expect(warnings.find((w) => w.placementKey === key('off-map'))!.message).toContain('off the map');
  });

  it('a region with no cells is reported', () => {
    const p = buildElevation();
    p.maps[0]!.regions.push({ id: id('region', 'empty'), name: 'Nothing here', cells: new Int16Array(0) });
    const warnings = lintMap(p, p.maps[0]!);
    expect(warnings).toEqual([{ code: 'empty-region', mapId: p.maps[0]!.id, regionId: id('region', 'empty'), message: 'Region "Nothing here" has no cells.' }]);
  });
});
