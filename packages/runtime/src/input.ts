/**
 * Input frames (spec 5.9). The client turns devices into one `InputFrame`
 * per tick using the project's `InputActionDef` bindings; the runtime never
 * sees a key code. Frames are quantized, which makes a stream recordable
 * and replayable.
 */
import type { EntityId } from './entities.ts';

export type ClickOrder =
  | { kind: 'ground'; x: number; y: number } // height-aware terrain pick, quantized
  | { kind: 'entity'; entity: EntityId }; //    front-most entity under the cursor

export interface InputFrame {
  move: { x: number; y: number }; //        -1..1, quantized to 1/127 (WASD); cancels a click order
  aim: { x: number; y: number } | null; //  the cursor on the world plane, quantized to 1/64 unit
  order: ClickOrder | null; //              a click this tick (section 7.9b)
  pressed: number; //                       bitmask of roles pressed this tick
  held: number; //                          bitmask of roles held
}

/** Role bits for `pressed` and `held`. */
export const ROLE_CLICK = 1 << 0;
export const ROLE_ATTACK_PRIMARY = 1 << 1;
export const ROLE_ATTACK_SECONDARY = 1 << 2;
export const ROLE_DODGE = 1 << 3;
export const ROLE_INTERACT = 1 << 4;
export const ROLE_MASK = 0b11111;

export const ROLE_BITS = {
  click: ROLE_CLICK,
  'attack-primary': ROLE_ATTACK_PRIMARY,
  'attack-secondary': ROLE_ATTACK_SECONDARY,
  dodge: ROLE_DODGE,
  interact: ROLE_INTERACT,
} as const;

export const MOVE_QUANTUM = 1 / 127;
export const AIM_QUANTUM = 1 / 64;

/** Clamp to -1..1 and snap to 1/127. */
export function quantizeMove(v: number): number {
  if (!(v > -1)) return -1;
  if (!(v < 1)) return 1;
  return Math.round(v * 127) / 127;
}

/** Snap a world-plane coordinate to 1/64 unit. */
export function quantizeAim(v: number): number {
  return Number.isFinite(v) ? Math.round(v * 64) / 64 : 0;
}

/** A frame with nothing pressed. */
export function emptyInput(): InputFrame {
  return { move: { x: 0, y: 0 }, aim: null, order: null, pressed: 0, held: 0 };
}

/** A fresh, quantized copy of a frame: what a recorder stores. */
export function quantizeInput(frame: InputFrame): InputFrame {
  const order = frame.order;
  return {
    move: { x: quantizeMove(frame.move.x), y: quantizeMove(frame.move.y) },
    aim: frame.aim ? { x: quantizeAim(frame.aim.x), y: quantizeAim(frame.aim.y) } : null,
    order: !order
      ? null
      : order.kind === 'ground'
        ? { kind: 'ground', x: quantizeAim(order.x), y: quantizeAim(order.y) }
        : { kind: 'entity', entity: order.entity },
    pressed: frame.pressed & ROLE_MASK,
    held: frame.held & ROLE_MASK,
  };
}

/**
 * The runtime's own copy of the current frame, as scalars, so applying
 * input allocates nothing. `orderKind`: 0 none, 1 ground, 2 entity.
 */
export class InputState {
  moveX = 0;
  moveY = 0;
  hasAim = false;
  aimX = 0;
  aimY = 0;
  orderKind = 0;
  orderX = 0;
  orderY = 0;
  orderEntity: EntityId = -1;
  pressed = 0;
  held = 0;

  /** Copy and quantize: whatever the client sends, the simulation sees the quantized frame. */
  set(frame: InputFrame): void {
    this.moveX = quantizeMove(frame.move.x);
    this.moveY = quantizeMove(frame.move.y);
    const aim = frame.aim;
    this.hasAim = aim !== null;
    this.aimX = aim ? quantizeAim(aim.x) : 0;
    this.aimY = aim ? quantizeAim(aim.y) : 0;
    const order = frame.order;
    if (!order) {
      this.orderKind = 0;
      this.orderEntity = -1;
    } else if (order.kind === 'ground') {
      this.orderKind = 1;
      this.orderX = quantizeAim(order.x);
      this.orderY = quantizeAim(order.y);
      this.orderEntity = -1;
    } else {
      this.orderKind = 2;
      this.orderEntity = order.entity;
    }
    this.pressed = frame.pressed & ROLE_MASK;
    this.held = frame.held & ROLE_MASK;
  }
}
