import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EMBERFALL, axial, buildEmberfall, cellCenter } from '@loreengine/fixtures';
import { axialQ, cellCenterX, cellCenterY } from '@loreengine/hexmath';
import { parseProjectJson, serializeProject } from '@loreengine/schema';

const GOLDEN = fileURLToPath(new URL('../packages/fixtures/emberfall.project.json', import.meta.url));

describe('[P1.roundtrip.emberfall] Emberfall round trip', () => {
  it('validates, serializes, and re-validates byte-identical', () => {
    const text = serializeProject(buildEmberfall());
    const first = parseProjectJson(text);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const text2 = serializeProject(first.project);
    expect(text2).toBe(text);
    const second = parseProjectJson(text2);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(serializeProject(second.project)).toBe(text);
  });

  it('decodes packed layers to typed arrays of the map size', () => {
    const r = parseProjectJson(serializeProject(buildEmberfall()));
    if (!r.ok) throw new Error('invalid');
    const map = r.project.maps[0]!;
    expect(map.layers.terrain).toBeInstanceOf(Uint16Array);
    expect(map.layers.level).toBeInstanceOf(Uint8Array);
    expect(map.layers.ramp).toBeInstanceOf(Uint8Array);
    expect(map.regions[0]!.cells).toBeInstanceOf(Int16Array);
    expect(map.layers.terrain.length).toBe(EMBERFALL.width * EMBERFALL.height);
    expect(Array.from(map.layers.level)).toEqual(Array.from(buildEmberfall().maps[0]!.layers.level));
    expect(Array.from(map.regions[0]!.cells)).toEqual(Array.from(buildEmberfall().maps[0]!.regions[0]!.cells));
  });

  it('builds the same project every time', () => {
    expect(serializeProject(buildEmberfall())).toBe(serializeProject(buildEmberfall()));
  });

  it('matches the committed project file (UPDATE_FIXTURES=1 rewrites it)', () => {
    const text = serializeProject(buildEmberfall());
    if (process.env['UPDATE_FIXTURES'] === '1' || !existsSync(GOLDEN)) writeFileSync(GOLDEN, text);
    expect(readFileSync(GOLDEN, 'utf8')).toBe(text);
  });
});

describe('[P1.fixtures.content] Emberfall content (spec 8.9)', () => {
  const p = buildEmberfall();
  const map = p.maps[0]!;
  const at = (c: { col: number; row: number }) => c.row * map.width + c.col;

  it('has a village on level 0, a plateau on level 2 and two stacked ramps between', () => {
    expect(map.layers.level[at(EMBERFALL.playerStart)]).toBe(0);
    expect(map.layers.level[at({ col: EMBERFALL.plateau.col, row: EMBERFALL.plateau.row })]).toBe(2);
    expect([map.layers.level[at(EMBERFALL.rampLow)], map.layers.ramp[at(EMBERFALL.rampLow)]]).toEqual([0, 1]);
    expect([map.layers.level[at(EMBERFALL.rampHigh)], map.layers.ramp[at(EMBERFALL.rampHigh)]]).toEqual([1, 1]);
    expect(EMBERFALL.rampHigh.col + 1).toBe(EMBERFALL.plateau.col);
  });

  it('has one deliberately broken ramp, an elder, a sentry and a boss', () => {
    expect(map.layers.ramp[at(EMBERFALL.brokenRamp)]).toBe(1);
    expect(map.layers.level[at({ col: EMBERFALL.brokenRamp.col + 1, row: EMBERFALL.brokenRamp.row })]).toBe(0);
    expect(map.placements.map((x) => p.archetypes.find((a) => a.id === x.archetypeId)!.name)).toEqual(['Elder', 'Sentry', 'Ember Warden']);
  });

  it('seeds the three factions and never places the player', () => {
    expect(p.factions.map((f) => f.name)).toEqual(['player', 'hostile', 'neutral']);
    expect(map.placements.some((x) => x.archetypeId === p.settings.playerArchetypeId)).toBe(false);
  });

  it('fixture hex helpers agree with hexmath', () => {
    for (let row = 0; row < 40; row++) {
      for (let col = 0; col < 40; col++) {
        const c = cellCenter(col, row, 1.5);
        expect(c.x).toBeCloseTo(cellCenterX(col, row, 1.5), 12);
        expect(c.y).toBeCloseTo(cellCenterY(row, 1.5), 12);
        expect(axial(col, row)).toEqual([axialQ(col, row), row]);
      }
    }
  });
});
