import { describe, expect, it } from 'vitest';
import { buildEmberfall } from '@loreengine/fixtures';
import { seededIdFactory, serializeProject } from '@loreengine/schema';
import type { TriggerDef } from '@loreengine/schema';
import { EditorDocument } from '../src/core/document.ts';
import { saveDatabase, saveSettings, saveTriggers } from '../src/core/staging.ts';
import { defaultContext, itemSchema } from '../src/forms/databases.ts';
import { FormBuilder, defaultValue } from '../src/forms/model.ts';

const fresh = (): EditorDocument => new EditorDocument(buildEmberfall(), seededIdFactory(5));

describe('database Save and Cancel [P5B.databases.staging]', () => {
  it('a valid edit saves into the project and counts as a change (not an undo step)', () => {
    const doc = fresh();
    const draft = structuredClone(doc.project.archetypes);
    draft[0]!.name = 'Renamed';
    const version = doc.version;
    expect(saveDatabase(doc, 'archetypes', draft)).toEqual({ ok: true });
    expect(doc.project.archetypes[0]!.name).toBe('Renamed');
    expect(doc.version).toBe(version + 1);
    expect(doc.dirty).toBe(true);
    expect(doc.stack.size).toBe(0);
    // The saved array is a copy: editing the draft afterwards does not reach the project.
    draft[0]!.name = 'Later';
    expect(doc.project.archetypes[0]!.name).toBe('Renamed');
  });

  it('an invalid field is refused with its path; the project is untouched', () => {
    const doc = fresh();
    const before = serializeProject(doc.project);
    const draft = structuredClone(doc.project.terrains);
    draft[1]!.moveCost = 0; // must be >= 1
    const result = saveDatabase(doc, 'terrains', draft);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ index: 1, path: 'moveCost' }));
    expect(serializeProject(doc.project)).toBe(before);
  });

  it('deleting an item that is still referenced is refused', () => {
    const doc = fresh();
    const before = serializeProject(doc.project);
    const used = doc.project.maps[0]!.placements[0]!.archetypeId;
    const result = saveDatabase(doc, 'archetypes', doc.project.archetypes.filter((a) => a.id !== used));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.index === -1)).toBe(true);
    expect(serializeProject(doc.project)).toBe(before);
  });

  it('a new item from its generated form saves', () => {
    const doc = fresh();
    const builder = new FormBuilder();
    const ctx = defaultContext(doc.project, doc.project.maps[0], doc.newId);
    for (const key of ['factions', 'particlePresets', 'feedback', 'statusEffects'] as const) {
      const item = defaultValue(builder.spec(itemSchema(key)), ctx) as { name?: string };
      if ('name' in item) item.name = `New ${key}`;
      const result = saveDatabase(doc, key, [...(doc.project[key] as unknown[]), item]);
      expect(result, key).toEqual({ ok: true });
    }
  });

  it('region events are allowed on map triggers only; settings must fit the maps', () => {
    const doc = fresh();
    const map = doc.project.maps[0]!;
    const region = map.regions[0]!;
    const trigger: TriggerDef = {
      id: doc.newId() as TriggerDef['id'],
      when: { type: 'region-entered', regionId: region.id, who: { by: 'player' } },
      given: [],
      then: [{ type: 'show-message', text: 'Hello', ms: 2000 }],
      once: true,
      enabled: true,
    } as TriggerDef;
    expect(saveTriggers(doc, null, [...doc.project.triggers, trigger]).ok).toBe(false);
    expect(saveTriggers(doc, map.id, [...map.triggers, trigger])).toEqual({ ok: true });
    expect(doc.project.maps[0]!.triggers.at(-1)!.id).toBe(trigger.id);

    const levels = Math.max(...doc.project.maps.flatMap((m) => Array.from(m.layers.level)));
    expect(levels).toBeGreaterThan(1);
    expect(saveSettings(doc, { ...doc.project.settings, maxLevel: 1 }).ok).toBe(false);
    expect(saveSettings(doc, { ...doc.project.settings, friendlyFire: !doc.project.settings.friendlyFire })).toEqual({ ok: true });
  });
});
