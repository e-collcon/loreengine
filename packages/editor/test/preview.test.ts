import { describe, expect, it } from 'vitest';
import { EMBERFALL, buildElevation, buildEmberfall, cellCenter } from '@loreengine/fixtures';
import { seededIdFactory } from '@loreengine/schema';
import type { Id, Project } from '@loreengine/schema';
import { AddPlacement, RemovePlacement } from '../src/core/commands.ts';
import { EditorDocument } from '../src/core/document.ts';
import { blockedEdges, visibleCells, warningRows } from '../src/core/overlays.ts';
import { MapPreview, PLAYER_START_KEY } from '../src/core/preview.ts';
import { LayerStroke } from '../src/core/strokes.ts';

describe('map preview [P5A.preview]', () => {
  it('shows every placement and the player start, with overrides applied, and follows edits', () => {
    const project = buildEmberfall();
    const map = project.maps.find((m) => m.id === project.startMapId)!;
    const preview = new MapPreview(project, map.id);
    const e = preview.entities;
    expect(e.count).toBe(map.placements.length + 1);
    expect(e.placementKey(e.count - 1)).toBe(PLAYER_START_KEY);
    expect(e.archetype(e.count - 1)).toBe(project.archetypes.findIndex((a) => a.id === project.settings.playerArchetypeId));
    map.placements.forEach((p, i) => {
      expect(e.x(i)).toBe(p.x);
      expect(e.z(i)).toBeCloseTo(preview.raw.surfaceHeight(p.x, p.y) + (e.data(i).movement?.startMode === 'fly' ? 2 * project.settings.levelHeight : 0));
      if (p.overrides) for (const [k, v] of Object.entries(p.overrides)) expect(e.data(i)[k as keyof typeof p.overrides]).toEqual(v);
    });

    // Removing a placement shifts the ones after it: their ids change, so the renderer rebuilds their sprites.
    const doc = new EditorDocument(project, seededIdFactory(3));
    const firstId = e.id(0);
    const secondId = e.id(1);
    doc.run(new RemovePlacement(map.id, map.placements[0]!.key));
    preview.refresh();
    expect(e.count).toBe(map.placements.length + 1);
    expect(e.id(0)).not.toBe(firstId);
    expect(e.id(0)).not.toBe(secondId);
    doc.undo();
    preview.refresh();
    expect(e.placementKey(0)).toBe(map.placements[0]!.key);

    // Layer edits reach the world on refresh.
    const cell = 3 * map.width + 3;
    const stroke = new LayerStroke(project, 'Raise', map.id);
    stroke.raise([cell], 1);
    doc.record(stroke.finish());
    preview.refresh();
    expect(preview.world.level(cell)).toBe(map.layers.level[cell]);
    const placed = { key: doc.newId() as Id<'placement'>, archetypeId: project.archetypes[0]!.id, x: preview.world.centerX(cell), y: preview.world.centerY(cell), facing: 0 };
    doc.run(new AddPlacement(map.id, placed));
    preview.refresh();
    expect(e.z(preview.indexOfKey(placed.key))).toBeCloseTo(preview.world.surfaceHeight(placed.x, placed.y));
  });
});

describe('overlays', () => {
  it('lint: the broken ramp appears in the warnings panel, with a place to focus [P5A.lint]', () => {
    const project = buildEmberfall();
    const map = project.maps[0]!;
    const preview = new MapPreview(project, map.id);
    const rows = warningRows(project, map, preview.raw);
    const cell = EMBERFALL.brokenRamp.row * map.width + EMBERFALL.brokenRamp.col;
    const row = rows.find((r) => r.code === 'ramp-leads-nowhere' && r.cell === cell);
    expect(row).toBeDefined();
    const c = cellCenter(EMBERFALL.brokenRamp.col, EMBERFALL.brokenRamp.row);
    expect(row!.focus!.x).toBeCloseTo(c.x);
    expect(row!.focus!.y).toBeCloseTo(c.y);
  });

  it('blocked edges: cliffs show, a flattened map has none [P5A.overlay.blocked]', () => {
    const project = buildElevation();
    const map = project.maps[0]!;
    expect(blockedEdges(new MapPreview(project, map.id).raw).length).toBeGreaterThan(0);
    map.layers.level.fill(0);
    map.layers.ramp.fill(0);
    const walkable = project.terrains.findIndex((t) => t.passable.walk);
    map.layers.terrain.fill(Math.max(0, map.terrainPalette.indexOf(project.terrains[walkable]!.id)));
    expect(blockedEdges(new MapPreview(project, map.id).raw).length).toBe(0);
  });

  it('sight: open ground is all seen within range; a tall column hides what is behind it [P5A.overlay.sight]', () => {
    const project: Project = buildElevation();
    const map = project.maps[0]!;
    map.layers.level.fill(0);
    map.layers.ramp.fill(0);
    const open = project.terrains.find((t) => t.passable.walk && !t.blocksSight)!;
    if (!map.terrainPalette.includes(open.id)) map.terrainPalette.push(open.id);
    map.layers.terrain.fill(map.terrainPalette.indexOf(open.id));
    const preview = new MapPreview(project, map.id);
    const world = preview.raw;
    const row = Math.floor(map.height / 2);
    const eye = { x: world.centerX(row * map.width + 2), y: world.centerY(row * map.width + 2) };
    const range = 6;
    const seen = visibleCells(project, world, eye.x, eye.y, 1.4, range, 1.6);
    let inRange = 0;
    for (let cell = 0; cell < world.cells; cell++) {
      const d = Math.hypot(world.centerX(cell) - eye.x, world.centerY(cell) - eye.y);
      if (d <= range) inRange++;
      expect(seen[cell]).toBe(d <= range ? 1 : 0);
    }
    expect(inRange).toBeGreaterThan(20);

    // A column four levels high, two cells east: the cell right behind it is hidden; one beside the eye is not.
    map.layers.level[row * map.width + 4] = 4;
    const walled = new MapPreview(project, map.id).raw;
    const behind = visibleCells(project, walled, eye.x, eye.y, 1.4, range, 1.6);
    expect(behind[row * map.width + 5]).toBe(0);
    expect(behind[row * map.width + 3]).toBe(1);
  });
});
