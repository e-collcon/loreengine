import { describe, expect, it } from 'vitest';
import { buildEmberfall, id } from '@loreengine/fixtures';
import { ROLE_ATTACK_PRIMARY, ROLE_ATTACK_SECONDARY, ROLE_CLICK, ROLE_DODGE, ROLE_INTERACT } from '@loreengine/runtime';
import type { Id, InputActionDef } from '@loreengine/schema';
import { InputMapper, mouseCode } from '../src/input.ts';

const defaults = (): InputActionDef[] => buildEmberfall().inputActions;
const action = (kind: InputActionDef['kind'], role: InputActionDef['role'], defaultBindings: string[]): InputActionDef => ({
  id: id('input', `${kind}-${role}-${defaultBindings.join('-')}`) as Id<'input'>,
  name: 'test',
  kind,
  role,
  defaultBindings,
});

describe('[P3B.input.mapper] the input mapper: bindings in, InputFrame out', () => {
  it('the seeded defaults are Diablo-style click-to-act plus WASD', () => {
    const m = new InputMapper(defaults());
    m.press('KeyD');
    expect(m.frame().move).toEqual({ x: 1, y: 0 });
    m.release('KeyD');
    m.press('KeyW');
    expect(m.frame().move).toEqual({ x: 0, y: -1 }); // up the screen is -y on the world plane
    m.press('KeyA');
    const diagonal = m.frame().move;
    expect(diagonal.x).toBeCloseTo(-Math.SQRT1_2, 12); // diagonals are not faster
    expect(diagonal.y).toBeCloseTo(-Math.SQRT1_2, 12);
    m.press('KeyS'); // W and S cancel
    expect(m.frame().move).toEqual({ x: -1, y: 0 });
  });

  it('button roles set `pressed` on the tick they go down and `held` while down', () => {
    const m = new InputMapper(defaults());
    m.press('Space');
    m.press('KeyJ');
    let f = m.frame();
    expect(f.pressed).toBe(ROLE_DODGE | ROLE_ATTACK_PRIMARY);
    expect(f.held).toBe(ROLE_DODGE | ROLE_ATTACK_PRIMARY);
    f = m.frame();
    expect(f.pressed).toBe(0); // an edge, not a level
    expect(f.held).toBe(ROLE_DODGE | ROLE_ATTACK_PRIMARY);
    m.press('Space'); // key auto-repeat while held is not a new press
    expect(m.frame().pressed).toBe(0);
    m.release('Space');
    m.release('KeyJ');
    expect(m.frame().held).toBe(0);
    m.press('KeyE');
    expect(m.frame().pressed).toBe(ROLE_INTERACT);
  });

  it('an action with several bindings fires from any of them', () => {
    const m = new InputMapper(defaults());
    m.press(mouseCode(2));
    expect(m.frame().pressed).toBe(ROLE_ATTACK_SECONDARY);
    m.release('Mouse2');
    m.frame();
    m.press('KeyK');
    expect(m.frame().pressed).toBe(ROLE_ATTACK_SECONDARY);
  });

  it('a press and release between two ticks is still seen once', () => {
    const m = new InputMapper(defaults());
    m.press('Space');
    m.release('Space');
    const f = m.frame();
    expect(f.pressed).toBe(ROLE_DODGE);
    expect(f.held).toBe(0);
  });

  it('the pointer action supplies `aim`; the click action carries the order the client resolved', () => {
    const m = new InputMapper(defaults());
    expect(m.frame().aim).toBeNull();
    m.setPointer({ x: 12.5, y: 7.25 });
    expect(m.frame().aim).toEqual({ x: 12.5, y: 7.25 });
    m.press('Mouse0');
    m.setOrder({ kind: 'ground', x: 3, y: 4 });
    const f = m.frame();
    expect(f.pressed).toBe(ROLE_CLICK);
    expect(f.order).toEqual({ kind: 'ground', x: 3, y: 4 });
    expect(m.frame().order).toBeNull(); // consumed
    // While the button is held, the client may re-issue the order.
    m.setOrder({ kind: 'entity', entity: 2 });
    expect(m.frame().order).toEqual({ kind: 'entity', entity: 2 });
    m.release('Mouse0');
    m.setOrder({ kind: 'ground', x: 1, y: 1 });
    expect(m.frame().order).toBeNull(); // no click role down: no order
    m.setPointer(null);
    expect(m.frame().aim).toBeNull();
  });

  it('reads kind, role and defaultBindings from the project: rebinding in data changes the mapping', () => {
    const m = new InputMapper([
      action('axis2', 'move', ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'KeyI', 'KeyJ', 'KeyK', 'KeyL']), // two groups of four
      action('button', 'dodge', ['ShiftLeft']),
      action('button', 'attack-primary', ['Space']),
    ]);
    m.press('KeyW'); // not bound any more
    m.press('ArrowRight');
    m.press('KeyK');
    const f = m.frame();
    expect(f.move.x).toBeCloseTo(Math.SQRT1_2, 12);
    expect(f.move.y).toBeCloseTo(Math.SQRT1_2, 12);
    m.press('Space');
    m.press('ShiftLeft');
    expect(m.frame().pressed).toBe(ROLE_ATTACK_PRIMARY | ROLE_DODGE);
    expect(m.isBound('ArrowUp')).toBe(true);
    expect(m.isBound('KeyW')).toBe(false);
    m.setPointer({ x: 1, y: 1 });
    expect(m.frame().aim).toBeNull(); // no aim action in this project
  });

  it('kind and role must agree: a button cannot move, an axis cannot attack, no role drives nothing', () => {
    const m = new InputMapper([action('button', 'move', ['KeyW', 'KeyA', 'KeyS', 'KeyD']), action('axis2', 'dodge', ['Space']), action('button', undefined, ['KeyQ']), action('pointer', 'aim', ['KeyP'])]);
    for (const code of ['KeyW', 'Space', 'KeyQ']) m.press(code);
    m.setPointer({ x: 1, y: 1 });
    expect(m.frame()).toEqual({ move: { x: 0, y: 0 }, aim: null, order: null, pressed: 0, held: 0 });
  });

  it('releaseAll clears everything (window blur)', () => {
    const m = new InputMapper(defaults());
    m.press('KeyD');
    m.press('Space');
    m.releaseAll();
    expect(m.frame()).toEqual({ move: { x: 0, y: 0 }, aim: null, order: null, pressed: 0, held: 0 });
  });
});
