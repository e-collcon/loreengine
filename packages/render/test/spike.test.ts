/**
 * Render spike tests (spec 6.11). Everything here runs on the draw list,
 * the strip geometry, and the picking function: no GPU, no DOM.
 */
import { describe, expect, it } from 'vitest';
import { ELEVATION, buildElevation, buildEmberfall, cellCenter, id } from '@loreengine/fixtures';
import { createRuntime, emptyInput } from '@loreengine/runtime';
import type { Runtime } from '@loreengine/runtime';
import type { Project } from '@loreengine/schema';
import { DrawList, ITEM_ENTITY, ITEM_STRIP } from '../src/drawlist.ts';
import { pickEntity, pickTerrain } from '../src/picking.ts';
import type { TerrainPick } from '../src/picking.ts';
import { ISO_RATIO, clampZoom, createCamera, followCamera, projectX, projectY, screenX, screenY, visibleRows, worldXAt, worldYAt } from '../src/projection.ts';
import type { Camera } from '../src/projection.ts';
import { colorOf, footprintRadius, shade, spriteMetrics } from '../src/sprites.ts';
import { CAMERA_FACING, TOP_INDICES, buildStrip, maxSurface } from '../src/terrain.ts';

const A = ELEVATION.terraces;
const PPU = 64;
const cellOf = (c: { col: number; row: number }): number => c.row * A.width + c.col;

function start(mutate?: (p: Project) => void): Runtime {
  const p = buildElevation();
  if (mutate) mutate(p);
  return createRuntime(p, null, { seed: 1, clockMode: 'continuous' });
}
/** A camera that shows the whole terraces map. */
function wideCamera(): Camera {
  const cam = createCamera(1600, 900);
  const mid = cellCenter(8, 5);
  cam.x = mid.x;
  cam.y = mid.y;
  cam.zoom = 0.75;
  return cam;
}
/** Screen position of a world point. */
const at = (cam: Camera, x: number, y: number, z: number): [number, number] => [screenX(cam, PPU, x), screenY(cam, PPU, y, z)];
const entityOf = (rt: Runtime, name: string): number => {
  const key = id('placement', name);
  for (let i = 0; i < rt.view.entities.highWater; i++) if (rt.view.entities.placementKey(i) === key) return i;
  throw new Error(`no entity ${name}`);
};

describe('[P3B.projection.world-to-screen] the hex-iso projection', () => {
  it('places (x, y) with the iso squash and lifts by z x pixelsPerUnit x zoom', () => {
    const cam = createCamera(800, 600);
    cam.x = 10;
    cam.y = 20;
    expect(at(cam, 10, 20, 0)).toEqual([400, 300]); // the camera's focus is the screen center
    expect(at(cam, 11, 20, 0)).toEqual([400 + 64, 300]);
    expect(at(cam, 10, 21, 0)).toEqual([400, 300 + 64 * ISO_RATIO]);
    expect(at(cam, 10, 20, 1)).toEqual([400, 300 - 64]); // height lifts straight up
    cam.zoom = 2;
    expect(at(cam, 11, 21, 0.5)).toEqual([400 + 128, 300 + 64 - 64]);
  });

  it('reads pixelsPerUnit from the project settings', () => {
    const cam = createCamera(800, 600);
    expect(screenX(cam, 32, 1)).toBe(400 + 32);
    expect(screenY(cam, 32, 0, 1)).toBe(300 - 32);
    expect(projectX(2, 100)).toBe(200);
    expect(projectY(2, 0.5, 100)).toBe((2 * ISO_RATIO - 0.5) * 100);
  });

  it('worldXAt / worldYAt invert the projection at any height', () => {
    const cam = createCamera(1280, 720);
    cam.x = 7.3;
    cam.y = -2.1;
    cam.z = 1;
    cam.zoom = 1.5;
    for (const [x, y, z] of [[0, 0, 0], [3.5, 9.25, 2], [-4, 1, 0.75]] as const) {
      const [sx, sy] = at(cam, x, y, z);
      expect(worldXAt(cam, PPU, sx)).toBeCloseTo(x, 10);
      expect(worldYAt(cam, PPU, sy, z)).toBeCloseTo(y, 10);
    }
  });

  it('the camera clamps zoom to 0.5 .. 2.0 and follows with a deadzone', () => {
    expect([clampZoom(0.1), clampZoom(1.3), clampZoom(9)]).toEqual([0.5, 1.3, 2]);
    const cam = createCamera(800, 600);
    followCamera(cam, 0.5, -0.5, 0, 1);
    expect([cam.x, cam.y]).toEqual([0, 0]); // inside the deadzone: no movement
    followCamera(cam, 3, -4, 2, 1);
    expect([cam.x, cam.y, cam.z]).toEqual([2, -3, 2]); // moved just far enough
  });

  it('visibleRows covers the viewport, plus rows that raised terrain lifts into view', () => {
    const cam = createCamera(800, 600);
    cam.y = 30;
    const out = { first: 0, last: 0 };
    visibleRows(cam, PPU, 1, 100, 0, out);
    const flat = { ...out };
    expect(flat.first).toBeGreaterThan(0);
    expect(flat.last).toBeLessThan(99);
    visibleRows(cam, PPU, 1, 100, 4, out);
    expect(out.first).toBe(flat.first);
    expect(out.last).toBeGreaterThan(flat.last); // tall things further south can poke up
    visibleRows(cam, PPU, 1, 10, 0, out);
    expect(out.last).toBe(9); // clamped to the map
  });
});

describe('[P3B.terrain.frames] terrain strips', () => {
  const rt = start();
  const project = rt.view.project;
  const strip = (row: number) => buildStrip(rt.view.world, project, row);

  it('builds one seven-vertex top per cell, carrying the terrain\'s top FrameRef', () => {
    const s = strip(0);
    expect(s.tops).toHaveLength(A.width);
    const top = s.tops[3]!;
    expect(top.cell).toBe(3);
    expect(top.vertices).toHaveLength(14);
    expect(top.heights).toHaveLength(7);
    expect(TOP_INDICES).toHaveLength(18);
    const grass = project.terrains[0]!;
    expect(top.frame).toEqual({ atlasId: grass.top.atlasId, frame: 'terrain/grass' });
    expect(strip(A.plateau.row).tops[A.plateau.col]!.frame.frame).toBe('terrain/stone');
    expect(strip(A.pond.row).tops[A.pond.col]!.frame.frame).toBe('terrain/water');
  });

  it('lifts every vertex by the surface height there: flat tops are level, ramp tops are tilted', () => {
    const flat = strip(A.plateau.row).tops[A.plateau.col]!;
    expect(Array.from(flat.heights)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    const c = cellCenter(A.plateau.col, A.plateau.row);
    expect(flat.vertices[0]).toBeCloseTo(c.x * PPU, 3);
    expect(flat.vertices[1]).toBeCloseTo((c.y * ISO_RATIO - 1) * PPU, 3);
    // The lower stacked ramp rises east from level 0 to level 1 (0 .. 0.5 world units).
    const ramp = strip(A.rampLow.row).tops[A.rampLow.col]!;
    const h = Array.from(ramp.heights).map((v) => Math.round(v * 1000) / 1000);
    // center, then corners 0..5: upper-right, lower-right, bottom, lower-left, upper-left, top
    expect(h).toEqual([0.25, 0.5, 0.5, 0.25, 0, 0, 0.25]);
  });

  it('draws cliff faces only on camera-facing edges, between the cell\'s edge and its neighbor\'s', () => {
    expect([...CAMERA_FACING]).toEqual([5, 6]);
    // The plateau's southern row: every cell has faces dropping from 1.0 to the ground.
    const south = strip(A.plateau.row + A.plateau.h - 1);
    const faces = south.faces.filter((f) => f.cell === cellOf(A.plateauEdge));
    expect(faces.map((f) => f.dir).sort()).toEqual([5, 6]);
    for (const f of faces) {
      expect([f.topA, f.topB, f.bottomA, f.bottomB]).toEqual([1, 1, 0, 0]);
      expect(f.frame).toEqual(project.terrains[2]!.cliff);
      expect(f.vertices).toHaveLength(8);
      // Bottom vertices sit one world unit (64 px) below the top ones.
      expect(f.vertices[7]! - f.vertices[1]!).toBeCloseTo(64, 3);
    }
    // Interior plateau rows have no faces (their neighbors are at the same height) ...
    expect(strip(A.plateau.row + 1).faces.filter((f) => f.cell === cellOf({ col: 8, row: A.plateau.row + 1 }))).toEqual([]);
    // ... and flat ground has none at all, except the map's southern border, which drops to 0 from 0.
    expect(strip(10).faces).toEqual([]);
    expect(strip(A.height - 1).faces).toEqual([]);
  });

  it('a face is as tall as the step: plateau to terrace is one level, terrace to ground one level', () => {
    const row = A.terrace.row + A.terrace.h - 1; // the terrace's southern row
    const face = buildStrip(rt.view.world, project, row).faces.find((f) => f.cell === row * A.width + A.terrace.col + 1)!;
    expect([face.topA, face.bottomA]).toEqual([0.5, 0]);
  });

  it('the neutral engine face is used when a terrain has no cliff art', () => {
    const plain = start((p) => void (p.terrains[2]!.cliff = undefined));
    const s = buildStrip(plain.view.world, plain.view.project, A.plateau.row + A.plateau.h - 1);
    expect(s.faces.find((f) => f.cell === cellOf(A.plateauEdge))!.frame).toBeNull();
  });

  it('maxSurface is the highest surface on the map, in world units', () => {
    expect(maxSurface(rt.view.world, project.settings.levelHeight)).toBe(1.5); // the level-3 spire
  });
});

describe('[P3B.sprites.placeholder] placeholder sprites', () => {
  it('are sized from the collider and scaled by sprite.scale', () => {
    const p = buildEmberfall();
    const hero = p.archetypes.find((a) => a.name === 'Hero')!.components;
    const boss = p.archetypes.find((a) => a.name === 'Ember Warden')!.components;
    const m = { width: 0, height: 0 };
    spriteMetrics(hero, m);
    expect(m).toEqual({ width: 0.35 * 2 * 1.3, height: 1.6 });
    spriteMetrics(boss, m);
    expect(m.height).toBeCloseTo(2.6 * 1.6, 12); // sprite.scale 1.6
    expect(m.width).toBeCloseTo(0.8 * 2 * 1.3 * 1.6, 12);
    spriteMetrics({}, m);
    expect(m.height).toBeGreaterThan(0);
    expect(footprintRadius(boss)).toBe(0.8);
  });

  it('have stable placeholder colors', () => {
    expect(colorOf('terrain/grass')).toBe(colorOf('grass'));
    expect(colorOf('something new')).toBe(colorOf('something new'));
    expect(colorOf('something new')).not.toBe(colorOf('something else'));
    expect(shade(0x808080, 0.5)).toBe(0x404040);
    expect(shade(0xffffff, 2)).toBe(0xffffff);
  });
});

describe('[P3B.depth.order] ★ depth order, on the draw list', () => {
  const rt = start();
  const cam = wideCamera();
  const list = new DrawList();
  const top = maxSurface(rt.view.world, 0.5);
  list.build(rt.view, cam, 1, top);

  it('is row strips back to front, each followed by the entities standing in it', () => {
    const strips: number[] = [];
    for (let i = 0; i < list.count; i++) if (list.kind[i] === ITEM_STRIP) strips.push(list.ref[i]!);
    expect(strips).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(list.count).toBe(12 + 4); // twelve strips, the player and three dummies
    expect(list.kind[0]).toBe(ITEM_STRIP); // terrain first
  });

  it('a unit behind a cliff is drawn before the plateau, so the cliff covers it', () => {
    const unit = list.indexOfEntity(entityOf(rt, 'behind-cliff'));
    expect(unit).toBeGreaterThan(list.indexOfStrip(A.behindCliff.row));
    expect(unit).toBeLessThan(list.indexOfStrip(A.plateau.row)); // every plateau strip comes after
    // And the plateau really is in front of it on screen: its lifted top overlaps the sprite.
    const i = entityOf(rt, 'behind-cliff');
    const edge = cellCenter(A.behindCliff.col, A.plateau.row); // a plateau cell directly south
    const [, plateauTopY] = at(cam, edge.x, edge.y - 1, 1); // its north vertex, lifted
    expect(plateauTopY).toBeLessThan(list.bottom[i]!);
    expect(plateauTopY).toBeGreaterThan(list.top[i]!);
  });

  it('a unit on a plateau edge is drawn after the plateau (and its cliff face) and before the ground below', () => {
    const unit = list.indexOfEntity(entityOf(rt, 'plateau-edge'));
    expect(unit).toBe(list.indexOfStrip(A.plateauEdge.row) + 1); // immediately after its own strip
    expect(unit).toBeLessThan(list.indexOfStrip(A.plateauEdge.row + 1));
    // Its feet are drawn at the plateau's height, one world unit above the ground position.
    const c = cellCenter(A.plateauEdge.col, A.plateauEdge.row);
    expect(list.footY[entityOf(rt, 'plateau-edge')]).toBeCloseTo(screenY(cam, PPU, c.y, 0) - 64 * cam.zoom, 6);
  });

  it('a unit on a ramp is drawn after the ramp\'s strip, at the ramp\'s height', () => {
    const i = entityOf(rt, 'on-ramp');
    const unit = list.indexOfEntity(i);
    expect(unit).toBeGreaterThan(list.indexOfStrip(A.onRamp.row));
    expect(unit).toBeLessThan(list.indexOfStrip(A.onRamp.row + 1));
    const c = cellCenter(A.onRamp.col, A.onRamp.row);
    expect(list.footY[i]).toBeCloseTo(screenY(cam, PPU, c.y, 0.75), 6);
  });

  it('within a strip, entities are ordered by foot screen position, then by index', () => {
    const row = 9;
    const a = cellCenter(5, row);
    const two = start((p) => {
      const dummy = p.maps[0]!.placements[0]!;
      p.maps[0]!.placements.push(
        { ...dummy, key: id('placement', 'front'), x: a.x, y: a.y + 0.3 },
        { ...dummy, key: id('placement', 'back'), x: a.x + 2, y: a.y - 0.3 },
        { ...dummy, key: id('placement', 'tie-1'), x: a.x + 4, y: a.y },
        { ...dummy, key: id('placement', 'tie-2'), x: a.x + 6, y: a.y },
      );
    });
    const l = new DrawList();
    l.build(two.view, cam, 1, top);
    const order = ['back', 'tie-1', 'tie-2', 'front'].map((n) => l.indexOfEntity(entityOf(two, n)));
    expect(order).toEqual([...order].sort((x, y) => x - y));
    expect(order[0]).toBeGreaterThan(l.indexOfStrip(row));
  });

  it('a unit low in its hex sorts into the next strip, whose interlocking tops would otherwise cover its feet', () => {
    const c = cellCenter(4, 9);
    const low = start((p) => {
      const dummy = p.maps[0]!.placements[0]!;
      p.maps[0]!.placements.push({ ...dummy, key: id('placement', 'low'), x: c.x, y: c.y + 0.8 }); // in the hex's bottom triangle
      p.maps[0]!.placements.push({ ...dummy, key: id('placement', 'mid'), x: c.x + 4, y: c.y });
    });
    const l = new DrawList();
    l.build(low.view, cam, 1, top);
    expect(l.sortRow[entityOf(low, 'low')]).toBe(10);
    expect(l.sortRow[entityOf(low, 'mid')]).toBe(9);
    expect(l.indexOfEntity(entityOf(low, 'low'))).toBeGreaterThan(l.indexOfStrip(10));
    // But never into a strip it could not be standing on: the unit just north of the plateau stays behind it.
    const north = cellCenter(A.behindCliff.col, A.plateau.row - 1);
    const behind = start((p) => void (p.maps[0]!.placements[0] = { ...p.maps[0]!.placements[0]!, x: north.x, y: north.y + 0.45 }));
    const l2 = new DrawList();
    l2.build(behind.view, cam, 1, top);
    expect(l2.sortRow[entityOf(behind, 'behind-cliff')]).toBe(A.plateau.row - 1);
  });

  it('positions are interpolated between the previous and current tick; a teleport skips it', () => {
    const moving = start();
    const e = moving.view.entities;
    const player = e.playerIndex();
    const l = new DrawList();
    const here = cellCenter(A.playerStart.col, A.playerStart.row);
    const there = cellCenter(A.playerStart.col + 2, A.playerStart.row);
    moving.enqueue({ type: 'test-actions', actions: [{ type: 'teleport', target: { by: 'player' }, mapId: id('map', 'terraces'), x: there.x, y: there.y }] });
    moving.tick(emptyInput());
    for (const alpha of [0, 0.5, 1]) {
      l.build(moving.view, cam, alpha, top);
      expect(l.footX[player]).toBeCloseTo(screenX(cam, PPU, there.x), 9); // prev = current after a teleport
    }
    expect(e.prevX(player)).not.toBe(here.x);
  });

  it('culls entities and strips that are off screen', () => {
    const close = createCamera(320, 240);
    const c = cellCenter(A.plateauEdge.col, A.plateauEdge.row);
    close.x = c.x;
    close.y = c.y;
    close.z = 1;
    const l = new DrawList();
    l.build(rt.view, close, 1, top);
    expect(l.indexOfEntity(entityOf(rt, 'plateau-edge'))).toBeGreaterThan(-1);
    expect(l.indexOfEntity(entityOf(rt, 'behind-cliff'))).toBe(-1);
    expect(l.indexOfEntity(rt.view.entities.playerIndex())).toBe(-1);
    expect(l.indexOfStrip(0)).toBe(-1);
    expect(l.firstRow).toBeGreaterThan(0);
    let entities = 0;
    for (let i = 0; i < l.count; i++) if (l.kind[i] === ITEM_ENTITY) entities++;
    expect(entities).toBe(1);
  });

  it('entity picking takes the front-most sprite under the cursor', () => {
    const c = cellCenter(6, 9);
    const two = start((p) => {
      const dummy = p.maps[0]!.placements[0]!;
      p.maps[0]!.placements.push({ ...dummy, key: id('placement', 'rear'), x: c.x, y: c.y - 0.6 }, { ...dummy, key: id('placement', 'near'), x: c.x + 0.1, y: c.y + 0.2 });
    });
    const l = new DrawList();
    l.build(two.view, cam, 1, top);
    const near = entityOf(two, 'near');
    const rear = entityOf(two, 'rear');
    // A point inside both sprites' bounds: the nearer one wins.
    expect(pickEntity(l, l.footX[near]!, l.footY[near]! - 30)).toBe(near);
    // Above the near sprite's head only the rear one is there.
    expect(pickEntity(l, l.footX[rear]!, l.top[rear]! + 2)).toBe(rear);
    expect(pickEntity(l, 5, 5)).toBe(-1);
  });
});

describe('[P3B.picking.height-aware] ★ height-aware picking', () => {
  const rt = start();
  const world = rt.view.world;
  const settings = rt.view.project.settings;
  const cam = wideCamera();
  const pick = (sx: number, sy: number): TerrainPick | null => {
    const out: TerrainPick = { cell: -1, x: 0, y: 0, z: 0 };
    return pickTerrain(world, settings, cam, sx, sy, out) ? out : null;
  };
  /** Screen position of a point on a cell's top surface, offset from its center in world units. */
  const onTop = (cell: { col: number; row: number }, dx = 0, dy = 0): [number, number] => {
    const c = cellCenter(cell.col, cell.row);
    return at(cam, c.x + dx, c.y + dy, world.surfaceHeight(c.x + dx, c.y + dy));
  };

  it('points over a plateau\'s top return the plateau cell, not the low hex under its flat footprint', () => {
    for (const cell of [A.plateauEdge, { col: 7, row: 3 }, { col: 9, row: 5 }]) {
      for (const [dx, dy] of [[0, 0], [0.5, 0.2], [-0.4, -0.5], [0, 0.7]] as const) {
        const [sx, sy] = onTop(cell, dx, dy);
        const hit = pick(sx, sy)!;
        expect(hit.cell).toBe(cellOf(cell));
        expect(hit.z).toBeCloseTo(1, 6);
        expect(hit.y).toBeCloseTo(cellCenter(cell.col, cell.row).y + dy, 3);
        // A flat pick at the same screen point would have landed two rows further north, on other cells.
        const flatY = worldYAt(cam, PPU, sy, 0);
        expect(world.cellAt(worldXAt(cam, PPU, sx), flatY)).not.toBe(cellOf(cell));
      }
    }
  });

  it('points over a cliff face return the column the face belongs to', () => {
    // The plateau's south face: under the bottom vertex of a southern-row cell, between ground and top.
    const c = cellCenter(A.plateauEdge.col, A.plateauEdge.row);
    for (const k of [0.15, 0.5, 0.85]) {
      // A point on the face below the cell's south-west edge midpoint, at height k.
      const [sx, sy] = at(cam, c.x - 0.4, c.y + 0.77, k);
      const hit = pick(sx, sy)!;
      expect(hit.cell).toBe(cellOf(A.plateauEdge));
      expect(world.level(hit.cell)).toBe(2);
    }
    // The terrace's south face belongs to the terrace.
    const t = cellCenter(A.terrace.col + 1, A.terrace.row + A.terrace.h - 1);
    const [fx, fy] = at(cam, t.x - 0.4, t.y + 0.77, 0.25);
    expect(world.level(pick(fx, fy)!.cell)).toBe(1);
  });

  it('points over low ground return low ground', () => {
    for (const cell of [A.playerStart, { col: 14, row: 10 }, { col: 0, row: 0 }, { col: 3, row: 5 }]) {
      const [sx, sy] = onTop(cell);
      const hit = pick(sx, sy)!;
      expect(hit.cell).toBe(cellOf(cell));
      expect(hit.z).toBe(0);
    }
    // Just below the foot of the cliff face, the pick is the ground in front of it.
    const c = cellCenter(A.plateauEdge.col, A.plateauEdge.row);
    const [sx, sy] = at(cam, c.x, c.y + 1.2, 0);
    expect(pick(sx, sy)!.cell).toBe(world.cellAt(c.x, c.y + 1.2));
    expect(world.level(pick(sx, sy)!.cell)).toBe(0);
  });

  it('ground hidden behind the plateau cannot be picked: the plateau in front is', () => {
    // The ground cell just north of the plateau, seen where the plateau's lifted top covers it.
    const hidden = cellCenter(A.behindCliff.col, A.plateau.row - 1);
    const [sx, sy] = at(cam, hidden.x, hidden.y + 0.9, 0);
    const hit = pick(sx, sy)!;
    expect(world.level(hit.cell)).toBe(2);
    expect(hit.z).toBeCloseTo(1, 6);
  });

  it('points on a ramp return the ramp, at the surface height under the cursor', () => {
    for (const [dx, want] of [[-0.6, 0.75 - 0.6 * (0.5 / Math.sqrt(3))], [0, 0.75], [0.6, 0.75 + 0.6 * (0.5 / Math.sqrt(3))]] as const) {
      const [sx, sy] = onTop(A.onRamp, dx, 0);
      const hit = pick(sx, sy)!;
      expect(hit.cell).toBe(cellOf(A.onRamp));
      expect(hit.z).toBeCloseTo(want, 3);
    }
  });

  it('every cell\'s top center picks that cell, across the whole fixture', () => {
    // Skip cells whose center is hidden behind raised terrain in front of them.
    let checked = 0;
    for (let row = 0; row < A.height; row++) {
      for (let col = 0; col < A.width; col++) {
        const [sx, sy] = onTop({ col, row });
        const hit = pick(sx, sy)!;
        if (hit.cell !== cellOf({ col, row })) {
          expect(hit.y).toBeGreaterThan(cellCenter(col, row).y); // whatever covers it is in front
          expect(hit.z).toBeGreaterThan(world.surfaceHeight(cellCenter(col, row).x, cellCenter(col, row).y));
          continue;
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(170);
  });

  it('a cursor off the map picks nothing', () => {
    expect(pick(-4000, -4000)).toBeNull();
    expect(pick(1e5, 1e5)).toBeNull();
  });

  it('picking follows the camera: zoom and pan change the screen point, not the answer', () => {
    const cam2 = createCamera(1024, 768);
    const c = cellCenter(A.plateauEdge.col, A.plateauEdge.row);
    cam2.x = c.x + 1;
    cam2.y = c.y - 2;
    cam2.z = 0.5;
    cam2.zoom = 2;
    const out: TerrainPick = { cell: -1, x: 0, y: 0, z: 0 };
    expect(pickTerrain(world, settings, cam2, screenX(cam2, PPU, c.x), screenY(cam2, PPU, c.y, 1), out)).toBe(true);
    expect(out.cell).toBe(cellOf(A.plateauEdge));
  });
});

describe('[P3B.render.read-only] the renderer never writes the runtime', () => {
  it('the runtime state hash is unchanged after 1,000 rendered frames', () => {
    const rt = createRuntime(buildEmberfall(), null, { seed: 5, clockMode: 'continuous' });
    for (let i = 0; i < 30; i++) rt.tick(emptyInput());
    const before = rt.view.stateHash();
    const cam = createCamera(1280, 720);
    const list = new DrawList();
    const top = maxSurface(rt.view.world, rt.view.project.settings.levelHeight);
    const out: TerrainPick = { cell: -1, x: 0, y: 0, z: 0 };
    let cursor = rt.view.presentation.end;
    for (let frame = 0; frame < 1000; frame++) {
      const p = rt.view.entities.playerIndex();
      followCamera(cam, rt.view.entities.x(p), rt.view.entities.y(p), rt.view.entities.z(p), 1);
      cam.zoom = 0.5 + (frame % 150) / 100;
      list.build(rt.view, cam, (frame % 10) / 10, top);
      for (let row = list.firstRow; row <= list.lastRow && frame % 100 === 0; row++) buildStrip(rt.view.world, rt.view.project, row);
      pickTerrain(rt.view.world, rt.view.project.settings, cam, (frame * 37) % 1280, (frame * 91) % 720, out);
      pickEntity(list, (frame * 53) % 1280, (frame * 29) % 720);
      cursor = rt.view.presentation.since(cursor, () => {});
    }
    expect(list.count).toBeGreaterThan(5);
    expect(rt.view.stateHash()).toBe(before);
    expect(rt.view.tick).toBe(30);
  });
});
