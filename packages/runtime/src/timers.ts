/**
 * Timers (tick step 11). `start-timer` creates or restarts a timer by id;
 * when it runs out it raises `timer-fired`. Timers belong to the map scope
 * (spec 9.3) and are released on map unload.
 */
import type { SaveState } from '@loreengine/schema';
import type { Diagnostics } from './diagnostics.ts';
import type { EventBus } from './events.ts';

export const MAX_TIMERS = 256;

export class TimerStore {
  private readonly ids: string[] = [];
  private readonly ticksLeft: number[] = [];
  private readonly repeatTicks: (number | null)[] = [];

  constructor(
    private readonly bus: EventBus,
    private readonly diagnostics: Diagnostics,
  ) {}

  get count(): number {
    return this.ids.length;
  }

  /** Start, or restart, the timer `id`. A restarted timer keeps its place in firing order. */
  start(id: string, ticks: number, repeat: boolean): void {
    const wait = ticks < 1 ? 1 : ticks;
    let i = this.ids.indexOf(id);
    if (i < 0) {
      if (this.ids.length >= MAX_TIMERS) {
        this.diagnostics.report('timer-cap', `Timer "${id}" was not started: ${MAX_TIMERS} timers are already running.`);
        return;
      }
      i = this.ids.length;
      this.ids.push(id);
      this.ticksLeft.push(0);
      this.repeatTicks.push(null);
    }
    this.ticksLeft[i] = wait;
    this.repeatTicks[i] = repeat ? wait : null;
  }

  /** Tick step 11: count down, fire, and repeat or retire. */
  step(): void {
    let write = 0;
    const n = this.ids.length;
    for (let i = 0; i < n; i++) {
      let left = this.ticksLeft[i]! - 1;
      let keep = true;
      if (left <= 0) {
        this.bus.raise('timer-fired', -1, -1, this.ids[i]!);
        const repeat = this.repeatTicks[i]!;
        if (repeat === null) keep = false;
        else left = repeat;
      }
      if (keep) {
        this.ids[write] = this.ids[i]!;
        this.ticksLeft[write] = left;
        this.repeatTicks[write] = this.repeatTicks[i]!;
        write++;
      }
    }
    this.ids.length = write;
    this.ticksLeft.length = write;
    this.repeatTicks.length = write;
  }

  clear(): void {
    this.ids.length = 0;
    this.ticksLeft.length = 0;
    this.repeatTicks.length = 0;
  }

  exportSave(): SaveState['timers'] {
    return this.ids.map((id, i) => ({ id, ticksLeft: this.ticksLeft[i]!, repeatTicks: this.repeatTicks[i]! }));
  }

  importSave(timers: SaveState['timers']): void {
    this.clear();
    for (const t of timers) {
      this.ids.push(t.id);
      this.ticksLeft.push(t.ticksLeft);
      this.repeatTicks.push(t.repeatTicks);
    }
  }
}
