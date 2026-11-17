import { describe, expect, it } from 'vitest';
import { buildEmberfall } from '@loreengine/fixtures';
import { Rng } from '@loreengine/runtime';
import { seededIdFactory, serializeProject } from '@loreengine/schema';
import type { Id, Project } from '@loreengine/schema';
import { BRUSH_SIZES, brushCells } from '../src/core/brush.ts';
import { AddPlacement, AddRegion, CommandStack, RemovePlacement, UpdatePlacement } from '../src/core/commands.ts';
import { Autosaver, EditorDocument } from '../src/core/document.ts';
import type { Timers } from '../src/core/document.ts';
import { LayerStroke, RegionStroke, nearestHexDir, regionCellSet } from '../src/core/strokes.ts';

const fresh = (): { project: Project; doc: EditorDocument; mapId: string } => {
  const project = buildEmberfall();
  const doc = new EditorDocument(project, seededIdFactory(7));
  return { project, doc, mapId: project.maps[0]!.id };
};

describe('brushes', () => {
  it('cover 1, 7 and 19 hexes away from the edges, clipped at them', () => {
    const w = 20;
    const h = 20;
    for (const size of BRUSH_SIZES) {
      expect(brushCells(10 * w + 10, size, w, h)).toHaveLength(size);
      expect(brushCells(11 * w + 10, size, w, h)).toHaveLength(size); // odd row
    }
    expect(brushCells(0, 7, w, h).length).toBeLessThan(7);
    expect(brushCells(-1, 7, w, h)).toEqual([]);
  });
});

describe('strokes', () => {
  it('raise changes each cell by one per stroke and clamps to maxLevel', () => {
    const { project, doc, mapId } = fresh();
    const map = project.maps[0]!;
    const cells = brushCells(10 * map.width + 10, 7, map.width, map.height);
    const before = cells.map((c) => map.layers.level[c]!);
    const stroke = new LayerStroke(project, 'Raise', mapId);
    for (let pass = 0; pass < 5; pass++) stroke.raise(cells, 1); // dragging back and forth
    doc.record(stroke.finish());
    cells.forEach((c, i) => expect(map.layers.level[c]).toBe(Math.min(project.settings.maxLevel, before[i]! + 1)));
    // With a cap of 1, raising clamps at 1; cancel puts every cell back.
    const raised = cells.map((c) => map.layers.level[c]!);
    const top = new LayerStroke(project, 'Raise', mapId, 1);
    top.raise(cells, 1);
    cells.forEach((c, i) => expect(map.layers.level[c]).toBe(Math.min(1, raised[i]! + 1)));
    top.cancel(project);
    cells.forEach((c, i) => expect(map.layers.level[c]).toBe(raised[i]));
    doc.undo();
    cells.forEach((c, i) => expect(map.layers.level[c]).toBe(before[i]));
  });

  it('flatten sets the level under the first click and clears ramps', () => {
    const { project, mapId } = fresh();
    const map = project.maps[0]!;
    const cells = brushCells(5 * map.width + 5, 19, map.width, map.height);
    map.layers.ramp[cells[3]!] = 2;
    const stroke = new LayerStroke(project, 'Flatten', mapId);
    stroke.flatten(cells, 3);
    for (const c of cells) {
      expect(map.layers.level[c]).toBe(3);
      expect(map.layers.ramp[c]).toBe(0);
    }
  });

  it('ramp direction follows the drag', () => {
    expect(nearestHexDir(0, 0, 1, 0)).toBe(1);
    expect(nearestHexDir(0, 0, -1, 0)).toBe(4);
    expect(nearestHexDir(0, 0, 0.5, -0.9)).toBe(2); // up the screen is -y
    expect(nearestHexDir(0, 0, 0.5, 0.9)).toBe(6);
  });

  it('a terrain not in the palette is appended once and removed on undo', () => {
    const { project, doc, mapId } = fresh();
    const map = project.maps[0]!;
    const unused = project.terrains.find((t) => !map.terrainPalette.includes(t.id));
    const terrainId = (unused ?? project.terrains[0]!).id as Id<'terrain'>;
    const length = map.terrainPalette.length;
    const stroke = new LayerStroke(project, 'Paint', mapId);
    stroke.paintTerrain(brushCells(3 * map.width + 3, 7, map.width, map.height), terrainId);
    doc.record(stroke.finish());
    expect(map.terrainPalette.length).toBe(unused ? length + 1 : length);
    doc.undo();
    expect(map.terrainPalette.length).toBe(length);
  });

  it('a stroke that changes nothing records nothing', () => {
    const { project, doc, mapId } = fresh();
    const map = project.maps[0]!;
    const cell = 4 * map.width + 4;
    const stroke = new LayerStroke(project, 'Paint', mapId);
    stroke.paintTerrain([cell], map.terrainPalette[map.layers.terrain[cell]!]! as Id<'terrain'>);
    doc.record(stroke.finish());
    expect(doc.stack.size).toBe(0);
  });

  it('region strokes paint and erase as one command', () => {
    const { project, doc, mapId } = fresh();
    const map = project.maps[0]!;
    const region = { id: doc.newId() as Id<'region'>, name: 'Test', cells: new Int16Array(0) };
    doc.run(new AddRegion(mapId, region));
    const stroke = new RegionStroke(project, mapId, region.id);
    stroke.paint(brushCells(6 * map.width + 6, 19, map.width, map.height), false);
    stroke.paint(brushCells(6 * map.width + 6, 1, map.width, map.height), true);
    doc.record(stroke.finish());
    const live = map.regions.find((r) => r.id === region.id)!;
    expect(regionCellSet(live.cells, map.width, map.height).size).toBe(18);
    doc.undo();
    expect(map.regions.find((r) => r.id === region.id)!.cells.length).toBe(0);
  });
});

/** One random canvas command against the first map: every kind the canvas makes. */
function randomCommand(doc: EditorDocument, rng: Rng): void {
  const project = doc.project;
  const map = project.maps[0]!;
  const mapId = map.id;
  const cell = rng.nextInt(map.width * map.height);
  const size = BRUSH_SIZES[rng.nextInt(3)]!;
  const cells = brushCells(cell, size, map.width, map.height);
  const kind = rng.nextInt(9);
  if (kind <= 4) {
    const stroke = new LayerStroke(project, 'stroke', mapId);
    if (kind === 0) stroke.paintTerrain(cells, project.terrains[rng.nextInt(project.terrains.length)]!.id as Id<'terrain'>);
    else if (kind === 1) stroke.raise(cells, 1);
    else if (kind === 2) stroke.raise(cells, -1);
    else if (kind === 3) stroke.flatten(cells, map.layers.level[cell]!);
    else stroke.setRamp(cell, rng.nextInt(7) as 0 | 1 | 2 | 3 | 4 | 5 | 6);
    doc.record(stroke.finish());
  } else if (kind === 5) {
    if (map.regions.length === 0 || rng.nextInt(4) === 0) {
      doc.run(new AddRegion(mapId, { id: doc.newId() as Id<'region'>, name: 'r', cells: new Int16Array(0) }));
    } else {
      const stroke = new RegionStroke(project, mapId, map.regions[rng.nextInt(map.regions.length)]!.id);
      stroke.paint(cells, rng.nextInt(3) === 0);
      doc.record(stroke.finish());
    }
  } else if (kind === 6 || map.placements.length === 0) {
    const archetype = project.archetypes[rng.nextInt(project.archetypes.length)]!;
    doc.run(new AddPlacement(mapId, { key: doc.newId() as Id<'placement'>, archetypeId: archetype.id, x: rng.nextFloat() * map.width, y: rng.nextFloat() * map.height, facing: rng.nextFloat() * 6 }));
  } else if (kind === 7) {
    doc.run(new RemovePlacement(mapId, map.placements[rng.nextInt(map.placements.length)]!.key));
  } else {
    const before = structuredClone(map.placements[rng.nextInt(map.placements.length)]!);
    doc.run(new UpdatePlacement('Move', mapId, before, { ...before, x: rng.nextFloat() * map.width, y: rng.nextFloat() * map.height, facing: rng.nextFloat() * 6 }));
  }
}

describe('★ undo integrity [P5A.undo.integrity]', () => {
  it('200 random canvas commands, undo all: byte-identical; redo all: the end state', () => {
    const { project, doc } = fresh();
    const original = serializeProject(project);
    const rng = new Rng(1234);
    let recorded = 0;
    while (recorded < 200) {
      const size = doc.stack.size;
      randomCommand(doc, rng);
      if (doc.stack.size > size) recorded++;
    }
    const end = serializeProject(project);
    expect(end).not.toBe(original);
    while (doc.undo());
    expect(serializeProject(project)).toBe(original);
    while (doc.redo());
    expect(serializeProject(project)).toBe(end);
  });

  it('500 random canvas commands: undo reaches back the 200 the stack keeps, exactly; redo returns', () => {
    const { project, doc } = fresh();
    const rng = new Rng(99);
    const snapshots = new Map<number, string>();
    let recorded = 0;
    while (recorded < 500) {
      const size = doc.stack.size;
      const before = serializeProject(project);
      randomCommand(doc, rng);
      if (doc.stack.size > size || (size === CommandStack.CAP && serializeProject(project) !== before)) recorded++;
      if (recorded === 300 && !snapshots.has(300)) snapshots.set(300, serializeProject(project));
    }
    const end = serializeProject(project);
    expect(doc.stack.size).toBe(CommandStack.CAP);
    let undone = 0;
    while (doc.undo()) undone++;
    expect(undone).toBe(CommandStack.CAP);
    expect(serializeProject(project)).toBe(snapshots.get(300));
    while (doc.redo());
    expect(serializeProject(project)).toBe(end);
  });
});

describe('autosave [P5A.autosave]', () => {
  it('saves 2 s after the last change, once, and each save moves contentRevision on', async () => {
    const { project, doc, mapId } = fresh();
    let now = 0;
    const pending: { at: number; fn: () => void; id: number }[] = [];
    let nextId = 0;
    const timers: Timers = {
      set: (fn, ms) => {
        const id = nextId++;
        pending.push({ at: now + ms, fn, id });
        return id;
      },
      clear: (h) => {
        const i = pending.findIndex((p) => p.id === h);
        if (i >= 0) pending.splice(i, 1);
      },
    };
    const advance = async (ms: number): Promise<void> => {
      now += ms;
      for (const p of pending.filter((p) => p.at <= now)) {
        pending.splice(pending.indexOf(p), 1);
        p.fn();
      }
      await Promise.resolve();
    };
    const written: number[] = [];
    const saver = new Autosaver(doc, async (p) => void written.push(p.contentRevision), timers);
    const revision = project.contentRevision;
    const map = project.maps[0]!;
    const place = (): void =>
      doc.run(new AddPlacement(mapId, { key: doc.newId() as Id<'placement'>, archetypeId: project.archetypes[0]!.id, x: 3, y: 3, facing: 0 }));
    place();
    await advance(1500);
    place(); // restarts the 2 s wait
    await advance(1500);
    expect(written).toEqual([]);
    await advance(600);
    await saver.saving;
    expect(written).toEqual([revision + 1]);
    expect(project.contentRevision).toBe(revision + 1);
    await advance(5000);
    expect(written).toHaveLength(1); // nothing changed since
    expect(map.placements.length).toBeGreaterThan(0);
    saver.dispose();
  });
});
