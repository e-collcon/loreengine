/**
 * The input mapper (spec 5.9). It turns device state into one `InputFrame`
 * per tick using the project's `InputActionDef` bindings, so the runtime
 * never sees a key code. This module is pure: the client feeds it DOM
 * events, and tests feed it codes.
 *
 * Binding codes are `KeyboardEvent.code` values ('KeyW', 'Space'), mouse
 * buttons as 'Mouse0' / 'Mouse1' / 'Mouse2', and 'Pointer' for the cursor.
 *
 * An `axis2` action reads its bindings in groups of four: up, left, down,
 * right (the WASD order). Screen-relative axes are the world plane's axes:
 * right is +x, down the screen is +y.
 */
import { ROLE_BITS, emptyInput } from '@loreengine/runtime';
import type { ClickOrder, InputFrame } from '@loreengine/runtime';
import type { InputActionDef } from '@loreengine/schema';

type ButtonRole = keyof typeof ROLE_BITS;

export class InputMapper {
  private readonly down = new Set<string>();
  /** Codes that went down since the last frame. */
  private readonly struck = new Set<string>();
  private pointer: { x: number; y: number } | null = null;
  private order: ClickOrder | null = null;
  private readonly moveGroups: string[][] = [];
  private readonly buttons: { bit: number; codes: string[] }[] = [];
  private aims = false;

  constructor(actions: readonly InputActionDef[]) {
    for (const action of actions) {
      if (action.role === undefined) continue; // an action with no role drives nothing in the foundation
      if (action.kind === 'axis2' && action.role === 'move') {
        for (let i = 0; i + 3 < action.defaultBindings.length; i += 4) this.moveGroups.push(action.defaultBindings.slice(i, i + 4));
      } else if (action.kind === 'pointer' && action.role === 'aim') {
        if (action.defaultBindings.includes('Pointer')) this.aims = true;
      } else if (action.kind === 'button' && action.role in ROLE_BITS) {
        this.buttons.push({ bit: ROLE_BITS[action.role as ButtonRole], codes: action.defaultBindings.slice() });
      }
    }
  }

  /** A key or mouse button went down. Auto-repeat is ignored. */
  press(code: string): void {
    if (this.down.has(code)) return;
    this.down.add(code);
    this.struck.add(code);
  }

  release(code: string): void {
    this.down.delete(code);
  }

  /** Everything up: call when the window loses focus. */
  releaseAll(): void {
    this.down.clear();
    this.struck.clear();
  }

  /** The cursor on the world plane, or null when it is off the map. */
  setPointer(point: { x: number; y: number } | null): void {
    this.pointer = point;
  }

  /** What the click role's press means this tick: the client resolves it by picking. */
  setOrder(order: ClickOrder | null): void {
    this.order = order;
  }

  /** Does `code` drive any action? The client uses this to decide which events to swallow. */
  isBound(code: string): boolean {
    return this.moveGroups.some((g) => g.includes(code)) || this.buttons.some((b) => b.codes.includes(code));
  }

  /** Build the frame for one tick, consuming this tick's presses and order. */
  frame(): InputFrame {
    const frame = emptyInput();
    let x = 0;
    let y = 0;
    for (const [up, left, down, right] of this.moveGroups) {
      if (this.down.has(right!)) x += 1;
      if (this.down.has(left!)) x -= 1;
      if (this.down.has(down!)) y += 1;
      if (this.down.has(up!)) y -= 1;
    }
    x = Math.max(-1, Math.min(1, x));
    y = Math.max(-1, Math.min(1, y));
    if (x !== 0 && y !== 0) {
      x *= Math.SQRT1_2;
      y *= Math.SQRT1_2;
    }
    frame.move.x = x;
    frame.move.y = y;
    if (this.aims && this.pointer) frame.aim = { x: this.pointer.x, y: this.pointer.y };
    for (const button of this.buttons) {
      if (button.codes.some((code) => this.down.has(code))) frame.held |= button.bit;
      if (button.codes.some((code) => this.struck.has(code))) frame.pressed |= button.bit;
    }
    if ((frame.pressed & ROLE_BITS.click) !== 0 || ((frame.held & ROLE_BITS.click) !== 0 && this.order)) frame.order = this.order;
    this.order = null;
    this.struck.clear();
    return frame;
  }
}

/** The binding code for a mouse button. */
export function mouseCode(button: number): string {
  return `Mouse${button}`;
}
