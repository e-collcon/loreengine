import { describe, expect, it } from 'vitest';
import { buildEmberfall, id } from '@loreengine/fixtures';
import { emptyInput, parseRepro, replayRepro, serializeRepro } from '@loreengine/runtime';
import type { InputFrame, RuntimeCommand } from '@loreengine/runtime';
import { seededIdFactory, serializeProject } from '@loreengine/schema';
import type { Id } from '@loreengine/schema';
import { Autosaver, EditorDocument } from '../src/core/document.ts';
import { captureRepro, planPlaytest, runPlaytest } from '../src/core/playtest.ts';

describe('★ playtest isolation [P5A.playtest.isolation]', () => {
  it('5,000 ticks of Emberfall with kills and variable changes leave the document byte-identical, revision unchanged', async () => {
    const doc = new EditorDocument(buildEmberfall(), seededIdFactory(1));
    const writes: number[] = [];
    const saver = new Autosaver(doc, async (p) => void writes.push(p.contentRevision));
    const before = serializeProject(doc.project);
    const revision = doc.project.contentRevision;
    const version = doc.version;

    const map = doc.project.maps.find((m) => m.id === doc.project.startMapId)!;
    const start = { mapId: map.id, x: map.playerStart!.x + 1, y: map.playerStart!.y, facing: 0 };
    const plan = planPlaytest(doc.project, 42, start);
    expect(plan.project).not.toBe(doc.project);
    expect(plan.save.header.kind).toBe('playtest');
    const rt = runPlaytest(plan);

    // Kill every placement but the boss, one every 400 ticks, and change variables as we go.
    const warden = id('placement', 'warden');
    const mortal = (archetypeId: string): boolean => doc.project.archetypes.find((a) => a.id === archetypeId)?.components.health !== undefined;
    const victims = map.placements.filter((p) => p.key !== warden && mortal(p.archetypeId)).map((p) => p.key as Id<'placement'>);
    expect(victims.length).toBeGreaterThan(0);
    const commands = new Map<number, RuntimeCommand>();
    victims.forEach((key, k) => commands.set(200 + k * 400, { type: 'test-actions', actions: [{ type: 'modify-health', target: { by: 'placement', key }, delta: -1e6 }] }));
    for (const t of [50, 1500, 3000, 4500]) {
      commands.set(t + 1, {
        type: 'test-actions',
        actions: [
          { type: 'set-variable', variableId: id('variable', 'ember_pulses'), op: { kind: 'add', value: 7 } },
          { type: 'set-variable', variableId: id('variable', 'talked_to_elder'), op: { kind: 'set', value: true } },
        ],
      });
    }
    let deaths = 0;
    let cursor = 0;
    for (let t = 0; t < 5000; t++) {
      const command = commands.get(t);
      if (command) rt.enqueue(command);
      // The player walks in circles and swings.
      const frame: InputFrame = { ...emptyInput(), move: { x: Math.round(Math.cos(t / 90) * 127) / 127, y: Math.round(Math.sin(t / 90) * 127) / 127 }, pressed: t % 45 === 0 ? 2 : 0 };
      rt.tick(frame);
      cursor = rt.view.presentation.since(cursor, (e) => {
        if (e.kind === 'death') deaths++;
      });
    }
    expect(rt.view.tick).toBe(5000);
    expect(deaths).toBeGreaterThanOrEqual(victims.length);
    expect(rt.view.variable(id('variable', 'ember_pulses'))).toBeGreaterThanOrEqual(28);
    expect(rt.view.variable(id('variable', 'talked_to_elder'))).toBe(true);

    // The playtest's repro replays to the same state.
    const repro = parseRepro(serializeRepro(captureRepro(plan, rt.recording()!, rt.view.stateHash())));
    expect(replayRepro(doc.project, repro).view.stateHash()).toBe(repro.stateHash);
    rt.dispose();

    await saver.flush();
    expect(serializeProject(doc.project)).toBe(before);
    expect(doc.project.contentRevision).toBe(revision);
    expect(doc.version).toBe(version);
    expect(writes).toEqual([]);
    saver.dispose();
  });
});
