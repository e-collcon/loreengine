/**
 * @loreengine/runtime — the headless engine. It imports only `schema`,
 * `hexmath` and `algorithms`, and compiles without the DOM library (law L1).
 * Clients drive it through `createRuntime`; renderer and audio import
 * `@loreengine/runtime/view` instead.
 */
export { createRuntime, MAX_RECORDED_FRAMES } from './runtime.ts';
export type { Runtime, RuntimeOptions, Recording } from './runtime.ts';
export { REPRO_FORMAT, REPRO_VERSION, parseRepro, projectForStart, replayRepro, serializeRepro, toRepro } from './repro.ts';
export type { ReproFile, ReproStart } from './repro.ts';
export { TICK_SLOTS, MAX_COMMANDS_PER_TICK } from './sim.ts';
export type { RuntimeCommand, TickSlot, ClockMode, Outcome } from './sim.ts';
export {
  emptyInput,
  quantizeInput,
  quantizeMove,
  quantizeAim,
  ROLE_BITS,
  ROLE_CLICK,
  ROLE_ATTACK_PRIMARY,
  ROLE_ATTACK_SECONDARY,
  ROLE_DODGE,
  ROLE_INTERACT,
  ROLE_MASK,
  MOVE_QUANTUM,
  AIM_QUANTUM,
} from './input.ts';
export type { InputFrame, ClickOrder } from './input.ts';
export { EVENT_TYPES, EVENT_QUEUE_CAP, EVENT_CASCADE_ROUNDS } from './events.ts';
export type { EventType } from './events.ts';
export { TICK_HZ, MS_PER_TICK, SECONDS_PER_TICK, msToTicks, durationToTicks } from './time.ts';
export { hashText } from './hash.ts';
export { Rng } from './rng.ts';
export type { RngState } from './rng.ts';
export { MAX_TIMERS } from './timers.ts';
export * from './view.ts';
