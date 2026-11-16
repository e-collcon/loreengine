/**
 * Time (spec 2, 5.3). The simulation runs at a fixed 60 Hz. Authored
 * durations are milliseconds and are converted to ticks once, at load.
 */
import type { Duration } from '@loreengine/schema';

export const TICK_HZ = 60;
export const MS_PER_TICK = 1000 / TICK_HZ;
export const SECONDS_PER_TICK = 1 / TICK_HZ;

/**
 * Milliseconds to whole ticks, rounded to nearest. Anything above zero
 * lasts at least one tick, so a short authored duration is never erased.
 */
export function msToTicks(ms: number): number {
  if (ms <= 0) return 0;
  const ticks = Math.round(ms / MS_PER_TICK);
  return ticks < 1 ? 1 : ticks;
}

/** A `Duration` to ticks; `turns` go through the project's `msPerTurn`. */
export function durationToTicks(duration: Duration, msPerTurn: number): number {
  return msToTicks(duration.kind === 'ms' ? duration.value : duration.value * msPerTurn);
}
