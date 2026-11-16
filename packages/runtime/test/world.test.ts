import { describe, expect, it } from 'vitest';
import { ELEVATION, EMBERFALL, MapPainter, buildElevation, buildEmberfall, cellCenter, id } from '@loreengine/fixtures';
import { HEX_DIRS, cornerOffsetX, cornerOffsetY, edgeCornerA, edgeCornerB, neighborIndex, oppositeDir } from '@loreengine/hexmath';
import type { HexDir } from '@loreengine/hexmath';
import { checkProject } from '@loreengine/schema';
import type { MapDef, MovementMode, Project } from '@loreengine/schema';
import { lintMap, lintProject } from '../src/lint.ts';
import { MODE_FLY, MODE_SWIM, MODE_WALK, SLOPED, World, edgeLevel, edgesConnect } from '../src/world.ts';

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

  /** Build the pair (center, neighbor in `dir`) with the given level and ramp each, and ask every mode. */
  function pair(dir: HexDir, a: { level: number; ramp: number }, b: { level: number; ramp: number }): Record<MovementMode, boolean> {
    const { world } = customMap(W, W, (m) => {
      m.fill({ col: 0, row: 0, w: W, h: W }, T.grass, 9); // surroundings far above: nothing else connects
      const set = (cell: number, c: { level: number; ramp: number }) =>
        c.ramp ? m.setRamp(col(cell), row(cell), T.grass, c.level, c.ramp) : m.fill({ col: col(cell), row: row(cell), w: 1, h: 1 }, T.grass, c.level);
      set(CENTER, a);
      set(nb(dir), b);
    });
    const out = {} as Record<MovementMode, boolean>;
    for (const mode of MODES) {
      out[mode] = world.connects(CENTER, nb(dir), mode);
      // The rule is symmetric: if you can step a -> b you can step b -> a.
      expect(world.connects(nb(dir), CENTER, mode), `symmetry ${mode}`).toBe(out[mode]);
    }
    return out;
  }

  const flat = (level: number) => ({ level, ramp: 0 });
  const ramp = (level: number, toward: HexDir) => ({ level, ramp: toward });
  /** A direction 60 degrees off `dir`: a ramp's side. */
  const side = (dir: HexDir): HexDir => ((dir % 6) + 1) as HexDir;

  it('edge heights follow the table: flat is L all round; a ramp is L + 1 toward its rise, L opposite, sloped on the four sides', () => {
    for (const dir of HEX_DIRS) {
      expect(edgeLevel(3, 0, dir)).toBe(3);
      for (const rise of HEX_DIRS) {
        const want = dir === rise ? 4 : dir === oppositeDir(rise) ? 3 : SLOPED;
        expect(edgeLevel(3, rise, dir)).toBe(want);
      }
    }
    const { world } = customMap(3, 3, (m) => m.setRamp(1, 1, T.grass, 2, 1));
    expect(world.edgeHeight(4, 1)).toBe(3);
    expect(world.edgeHeight(4, 4)).toBe(2);
    for (const dir of [2, 3, 5, 6] as HexDir[]) expect(world.edgeHeight(4, dir)).toBe('sloped');
    expect(world.edgeHeight(0, 5)).toBe(0);
  });

  it('flat to flat: connects at the same level, a cliff otherwise', () => {
    for (const dir of HEX_DIRS) {
      expect(pair(dir, flat(2), flat(2)).walk).toBe(true);
      expect(pair(dir, flat(2), flat(3)).walk).toBe(false);
      expect(pair(dir, flat(3), flat(2)).walk).toBe(false);
      expect(pair(dir, flat(0), flat(15)).walk).toBe(false);
    }
  });

  it('walking up and down a ramp: low edge meets level L, high edge meets level L + 1', () => {
    for (const dir of HEX_DIRS) {
      const back = oppositeDir(dir);
      // The neighbor is a ramp rising away from the center: we stand at its low edge.
      expect(pair(dir, flat(1), ramp(1, dir)).walk).toBe(true);
      expect(pair(dir, flat(2), ramp(1, dir)).walk).toBe(false);
      expect(pair(dir, flat(0), ramp(1, dir)).walk).toBe(false);
      // The center is a ramp rising toward the neighbor: the neighbor is at its high edge.
      expect(pair(dir, ramp(1, dir), flat(2)).walk).toBe(true);
      expect(pair(dir, ramp(1, dir), flat(1)).walk).toBe(false);
      expect(pair(dir, ramp(1, dir), flat(3)).walk).toBe(false);
      // The neighbor is a ramp rising toward the center: the center is at its high edge.
      expect(pair(dir, flat(2), ramp(1, back)).walk).toBe(true);
      expect(pair(dir, flat(1), ramp(1, back)).walk).toBe(false);
    }
  });

  it('stacked ramps climb two levels; two ramps of the same level in a line do not connect', () => {
    for (const dir of HEX_DIRS) {
      expect(pair(dir, ramp(0, dir), ramp(1, dir)).walk).toBe(true);
      expect(pair(dir, ramp(1, dir), ramp(2, dir)).walk).toBe(true);
      expect(pair(dir, ramp(0, dir), ramp(0, dir)).walk).toBe(false); // high edge 1 meets low edge 0
      expect(pair(dir, ramp(0, dir), ramp(2, dir)).walk).toBe(false);
    }
  });

  it('ramps meeting head-on form a ridge or a valley when their edges agree', () => {
    for (const dir of HEX_DIRS) {
      const back = oppositeDir(dir);
      expect(pair(dir, ramp(1, dir), ramp(1, back)).walk).toBe(true); // ridge: both high edges at 2
      expect(pair(dir, ramp(1, back), ramp(1, dir)).walk).toBe(true); // valley: both low edges at 1
      expect(pair(dir, ramp(1, dir), ramp(2, back)).walk).toBe(false);
    }
  });

  it('stepping off a ramp\'s side is blocked, whatever is beside it', () => {
    for (const dir of HEX_DIRS) {
      for (const level of [0, 1, 2, 3]) {
        expect(pair(dir, ramp(1, side(dir)), flat(level)).walk).toBe(false);
        expect(pair(dir, flat(level), ramp(1, side(dir))).walk).toBe(false);
      }
    }
  });

  it('wide ramps: side-by-side ramps of the same level and direction do not connect sideways (N6)', () => {
    for (const dir of HEX_DIRS) {
      for (const rise of HEX_DIRS) {
        if (rise === dir || rise === oppositeDir(dir)) continue;
        expect(pair(dir, ramp(1, rise), ramp(1, rise)).walk).toBe(false);
      }
    }
  });

  it('the rule is symmetric for every combination of level, ramp and direction', () => {
    let cases = 0;
    for (const dir of HEX_DIRS) {
      for (let la = 0; la < 4; la++) for (let ra = 0; ra <= 6; ra++) for (let lb = 0; lb < 4; lb++) for (let rb = 0; rb <= 6; rb++) {
        expect(edgesConnect(la, ra, lb, rb, dir)).toBe(edgesConnect(lb, rb, la, ra, oppositeDir(dir)));
        cases++;
      }
    }
    expect(cases).toBe(6 * 4 * 7 * 4 * 7);
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
      m.fill({ col: 3, row: 0, w: 1, h: 1 }, T.water, 1); // a higher pool: a waterfall edge
    });
    expect(world.connects(1, 2, 'swim')).toBe(true);
    expect(world.connects(1, 2, 'walk')).toBe(false);
    expect(world.connects(0, 1, 'swim')).toBe(false); // grass is not swimmable
    expect(world.connects(2, 3, 'swim')).toBe(false); // same terrain, different level: a cliff
    expect(world.passable(1, MODE_SWIM)).toBe(true);
  });

  it('fly ignores edge heights and is blocked only by terrain with passable.fly false', () => {
    const { world } = customMap(5, 1, (m) => {
      m.fill({ col: 1, row: 0, w: 1, h: 1 }, T.grass, 7); // a cliff
      m.setRamp(2, 0, T.grass, 3, 2); //                     a ramp seen from its side
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

  it('Emberfall: the plateau is reached only through its two stacked ramps', () => {
    const p = buildEmberfall();
    const world = new World(p, p.maps[0]!);
    const at = (c: { col: number; row: number }) => c.row * EMBERFALL.width + c.col;
    const low = at(EMBERFALL.rampLow);
    const high = at(EMBERFALL.rampHigh);
    const top = at({ col: EMBERFALL.plateau.col, row: EMBERFALL.rampLow.row });
    expect(world.connects(low - 1, low, 'walk')).toBe(true);
    expect(world.connects(low, high, 'walk')).toBe(true);
    expect(world.connects(high, top, 'walk')).toBe(true);
    // Every other edge of the plateau's rim is a cliff.
    let rimLinks = 0;
    const { plateau } = EMBERFALL;
    for (let r = plateau.row; r < plateau.row + plateau.h; r++) {
      for (let c = plateau.col; c < plateau.col + plateau.w; c++) {
        const cell = at({ col: c, row: r });
        for (let d = 0; d < 6; d++) {
          const other = world.neighbor[cell * 6 + d]!;
          if (other >= 0 && world.level[other] !== 2 && (world.link[cell * 6 + d]! & MODE_WALK) !== 0) rimLinks++;
        }
      }
    }
    expect(rimLinks).toBe(1);
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

  it('a ramp rises linearly from its low edge to its high edge', () => {
    const p = buildElevation();
    const world = new World(p, p.maps[0]!);
    const apothem = Math.sqrt(3) / 2;
    const low = cellCenter(ELEVATION.terraces.rampLow.col, ELEVATION.terraces.rampLow.row);
    expect(world.surfaceHeight(low.x - apothem + 1e-9, low.y)).toBeCloseTo(0, 6);
    expect(world.surfaceHeight(low.x, low.y)).toBeCloseTo(0.25, 12); // halfway up one level of 0.5
    expect(world.surfaceHeight(low.x + apothem - 1e-9, low.y)).toBeCloseTo(0.5, 6);
    expect(world.surfaceHeight(low.x + apothem / 2, low.y)).toBeCloseTo(0.375, 12);
    // Height depends only on the distance along the rise, not across it.
    expect(world.surfaceHeight(low.x, low.y + 0.5)).toBeCloseTo(0.25, 12);
    // The upper stacked ramp continues from level 1 to level 2.
    const high = cellCenter(ELEVATION.terraces.rampHigh.col, ELEVATION.terraces.rampHigh.row);
    expect(world.surfaceHeight(high.x, high.y)).toBeCloseTo(0.75, 12);
    // A ramp rising north-west (dir 3).
    const t = cellCenter(ELEVATION.terraces.terraceRamp.col, ELEVATION.terraces.terraceRamp.row);
    expect(world.surfaceHeight(t.x, t.y)).toBeCloseTo(0.25, 12);
    expect(world.surfaceHeight(t.x - 0.3, t.y - 0.52)).toBeGreaterThan(0.25); // toward NW: up
    expect(world.surfaceHeight(t.x + 0.3, t.y + 0.52)).toBeLessThan(0.25);
  });

  it('scales with ProjectSettings.levelHeight', () => {
    const { world } = customMap(3, 1, (m) => {
      m.fill({ col: 0, row: 0, w: 1, h: 1 }, T.grass, 3);
      m.setRamp(1, 0, T.grass, 3, 1);
    }, { levelHeight: 2 });
    expect(world.surfaceHeight(0, 0)).toBe(6);
    const c = cellCenter(1, 0);
    expect(world.surfaceHeight(c.x, c.y)).toBeCloseTo(7, 12);
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
    // Random maps dense with ramps in every direction, so every connecting kind of edge occurs.
    for (let k = 0; k < 6; k++) {
      worlds.push(
        customMap(14, 14, (m) => {
          for (let i = 0; i < 14 * 14; i++) {
            const col = i % 14;
            const row = Math.floor(i / 14);
            const level = Math.floor(rnd() * 3);
            if (rnd() < 0.45) m.setRamp(col, row, T.grass, level, 1 + Math.floor(rnd() * 6));
            else m.fill({ col, row, w: 1, h: 1 }, T.grass, level);
          }
        }).world,
      );
    }
    let samples = 0;
    let rampEdges = 0;
    for (const world of worlds) {
      for (let cell = 0; cell < world.cells; cell++) {
        for (const dir of HEX_DIRS) {
          const other = world.neighbor[cell * 6 + dir - 1]!;
          if (other < 0 || !world.linked(cell, dir, MODE_WALK)) continue;
          if (world.ramp[cell] !== 0 || world.ramp[other] !== 0) rampEdges++;
          const cx = world.centerX(cell);
          const cy = world.centerY(cell);
          const ax = cx + cornerOffsetX(edgeCornerA(dir), world.hexSize);
          const ay = cy + cornerOffsetY(edgeCornerA(dir), world.hexSize);
          const bx = cx + cornerOffsetX(edgeCornerB(dir), world.hexSize);
          const by = cy + cornerOffsetY(edgeCornerB(dir), world.hexSize);
          for (const t of [0.02, 0.5, 0.98, rnd()]) {
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
    expect(rampEdges).toBeGreaterThan(50);
  });

  it('why wide ramps cannot connect sideways: their surfaces differ by half a level along the shared edge (N6)', () => {
    // Two ramps of the same level, both rising east, side by side (NE neighbors).
    const { world } = customMap(4, 4, (m) => {
      m.setRamp(1, 2, T.grass, 0, 1);
      m.setRamp(1, 1, T.grass, 0, 1); // the NE neighbor of (1, 2), since row 1 is odd
    });
    const a = 2 * 4 + 1;
    const b = neighborIndex(a, 2, 4, 4);
    expect(b).toBe(1 * 4 + 1);
    const cx = world.centerX(a);
    const cy = world.centerY(a);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const px = cx + cornerOffsetX(edgeCornerA(2), 1) * (1 - t) + cornerOffsetX(edgeCornerB(2), 1) * t;
      const py = cy + cornerOffsetY(edgeCornerA(2), 1) * (1 - t) + cornerOffsetY(edgeCornerB(2), 1) * t;
      expect(world.surfaceHeightIn(a, px, py) - world.surfaceHeightIn(b, px, py)).toBeCloseTo(0.25, 9); // half of levelHeight 0.5
    }
    expect(world.connects(a, b, 'walk')).toBe(false);
  });
});

describe('[P3A.lint.map] map lint: warnings, never load failures', () => {
  it('Emberfall: the deliberately broken ramp is the only warning', () => {
    const p = buildEmberfall();
    expect(checkProject(p)).toEqual([]); // an unfinished map is still a valid file
    const warnings = lintProject(p);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      code: 'ramp-leads-nowhere',
      mapId: p.maps[0]!.id,
      cell: EMBERFALL.brokenRamp.row * EMBERFALL.width + EMBERFALL.brokenRamp.col,
    });
    expect(warnings[0]!.message).toContain('(6, 6)');
  });

  it('the elevation fixture is clean', () => {
    expect(lintProject(buildElevation())).toEqual([]);
  });

  it('a ramp whose high edge meets the map border, a lower cell, or a ramp side is reported', () => {
    const { project, def } = customMap(5, 3, (m) => {
      m.setRamp(4, 0, T.grass, 0, 1); // rises off the east border
      m.setRamp(1, 1, T.grass, 0, 1); // rises into flat level 0
      m.setRamp(1, 2, T.grass, 0, 1);
      m.fill({ col: 2, row: 2, w: 1, h: 1 }, T.grass, 1); // a good ramp, for contrast
    });
    const ramps = lintMap(project, def).filter((w) => w.code === 'ramp-leads-nowhere');
    expect(ramps.map((w) => w.cell)).toEqual([4, 1 * 5 + 1]);
    expect(ramps[0]!.message).toContain('the map ends there');
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
