import { describe, expect, it } from 'vitest';
import { EMBERFALL, buildEmberfall, cellCenter } from '@loreengine/fixtures';
import { DrawList, createCamera, followCamera, maxSurface } from '@loreengine/render';
import { createRuntime, emptyInput } from '@loreengine/runtime';
import { hudModel } from '../src/hud.ts';

function scene(mutate?: (p: ReturnType<typeof buildEmberfall>) => void) {
  const p = buildEmberfall();
  if (mutate) mutate(p);
  const rt = createRuntime(p, null, { seed: 1, clockMode: 'continuous' });
  const cam = createCamera(1280, 720);
  const list = new DrawList();
  const model = () => {
    const i = rt.view.entities.playerIndex();
    followCamera(cam, rt.view.entities.x(i), rt.view.entities.y(i), rt.view.entities.z(i), 0);
    list.build(rt.view, cam, 1, maxSurface(rt.view.world, 0.5));
    return hudModel(rt.view, list);
  };
  return { rt, model };
}

describe('[P3C.hud.prompt] the HUD model', () => {
  it('shows the interactable\'s prompt exactly when the interact key would use it', () => {
    const elder = cellCenter(EMBERFALL.elder.col, EMBERFALL.elder.row);
    // Next to the elder and facing them: the prompt is the elder's `interactable.prompt`.
    const near = scene((p) => {
      p.maps[0]!.playerStart = { x: elder.x + 1.1, y: elder.y, facing: Math.PI };
      p.archetypes.find((a) => a.name === 'Elder')!.components.brain = undefined;
    });
    expect(near.model().prompt).toBe('Talk');
    // Facing away, or out of its radius: no prompt.
    const away = scene((p) => {
      p.maps[0]!.playerStart = { x: elder.x + 1.1, y: elder.y, facing: 0 };
      p.archetypes.find((a) => a.name === 'Elder')!.components.brain = undefined;
    });
    expect(away.model().prompt).toBeNull();
    expect(scene().model().prompt).toBeNull();
    // The prompt text is authored.
    const custom = scene((p) => {
      p.maps[0]!.playerStart = { x: elder.x + 1.1, y: elder.y, facing: Math.PI };
      const c = p.archetypes.find((a) => a.name === 'Elder')!.components;
      c.brain = undefined;
      c.interactable = { radius: 1.5, prompt: 'Ask about the plateau' };
    });
    expect(custom.model().prompt).toBe('Ask about the plateau');
  });

  it('shows the player\'s health, and bars only over damaged entities', () => {
    const { rt, model } = scene((p) => {
      const boss = cellCenter(EMBERFALL.boss.col - 3, EMBERFALL.boss.row);
      p.maps[0]!.playerStart = { x: boss.x, y: boss.y, facing: 0 };
    });
    expect(model()).toMatchObject({ player: { hp: 100, max: 100 }, bars: [], outcome: null });
    const boss = rt.view.entities.indexOf(rt.view.entities.id(3));
    rt.enqueue({ type: 'test-actions', actions: [{ type: 'modify-health', target: { by: 'tag', tag: 'boss' }, delta: -75 }, { type: 'modify-health', target: { by: 'player' }, delta: -40 }] });
    rt.tick(emptyInput());
    const m = model();
    expect(m.player).toEqual({ hp: 60, max: 100 });
    expect(m.bars).toHaveLength(1); // the boss; the player's health has its own readout
    expect(m.bars[0]).toMatchObject({ entity: boss, fraction: 0.75 });
    expect(m.bars[0]!.y).toBeLessThan(360); // above its sprite, which stands at mid-screen height
  });

  it('reports the session outcome', () => {
    const { rt, model } = scene();
    rt.enqueue({ type: 'test-actions', actions: [{ type: 'end-session', outcome: 'victory' }] });
    rt.tick(emptyInput());
    expect(model().outcome).toBe('victory');
  });
});
