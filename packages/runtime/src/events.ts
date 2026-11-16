/**
 * Events (spec 5.5). Events raised during a tick are queued, then
 * dispatched in tick step 12 in raise order. Handlers may raise more; those
 * dispatch in a further round, at most 8 rounds per tick. Whatever is still
 * queued carries to the next tick with a diagnostic, so a trigger loop
 * slows the game instead of hanging it.
 *
 * An event is five scalars, held in a preallocated ring, so raising one
 * allocates nothing:
 *
 *   type                 a (subject)     b (other)     s            n
 *   map-loaded           -               -             map id       -
 *   map-unloaded         -               -             map id       -
 *   region-entered       entity          -             region id    -
 *   region-exited        entity          -             region id    -
 *   interacted           the interactor  the target    -            -
 *   attack-hit           attacker        victim        attack id    -
 *   health-crossed       entity          last attacker -            fraction crossed
 *   entity-died          entity          killer        -            -
 *   entity-spawned       entity          -             -            -
 *   brain-state-entered  entity          -             state id     -
 *   variable-changed     -               -             variable id  -
 *   timer-fired          -               -             timer id     -
 *   jump-landed          entity          -             -            -
 */
import type { SavedEvent } from '@loreengine/schema';
import type { Diagnostics } from './diagnostics.ts';
import type { Scope } from './scope.ts';

export const EVENT_TYPES = [
  'map-loaded',
  'map-unloaded',
  'region-entered',
  'region-exited',
  'interacted',
  'attack-hit',
  'health-crossed',
  'entity-died',
  'entity-spawned',
  'brain-state-entered',
  'variable-changed',
  'timer-fired',
  'jump-landed',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

const TYPE_INDEX = new Map<string, number>(EVENT_TYPES.map((t, i) => [t, i]));

export const EVENT_QUEUE_CAP = 4096;
export const EVENT_CASCADE_ROUNDS = 8;
export const NO_ENTITY = -1;

/** The event being dispatched. One reused object: handlers must not keep it. */
export interface GameEvent {
  type: EventType;
  a: number;
  b: number;
  s: string;
  n: number;
}

export type EventHandler = (event: Readonly<GameEvent>) => void;

interface Subscription {
  handler: EventHandler;
  scope: Scope;
}

export class EventBus {
  private readonly types = new Uint8Array(EVENT_QUEUE_CAP);
  private readonly as = new Float64Array(EVENT_QUEUE_CAP);
  private readonly bs = new Float64Array(EVENT_QUEUE_CAP);
  private readonly ns = new Float64Array(EVENT_QUEUE_CAP);
  private readonly ss: string[] = new Array<string>(EVENT_QUEUE_CAP).fill('');
  private head = 0;
  private length = 0;
  private readonly handlers: Subscription[][] = EVENT_TYPES.map(() => []);
  private subscriptions = 0;
  private readonly current: GameEvent = { type: 'map-loaded', a: NO_ENTITY, b: NO_ENTITY, s: '', n: 0 };

  constructor(private readonly diagnostics: Diagnostics) {}

  /** Queue an event. At the cap the newest is dropped and counted. */
  raise(type: EventType, a = NO_ENTITY, b = NO_ENTITY, s = '', n = 0): void {
    if (this.length >= EVENT_QUEUE_CAP) {
      this.diagnostics.count('event-queue-overflow');
      return;
    }
    const i = (this.head + this.length) % EVENT_QUEUE_CAP;
    this.types[i] = TYPE_INDEX.get(type)!;
    this.as[i] = a;
    this.bs[i] = b;
    this.ss[i] = s;
    this.ns[i] = n;
    this.length++;
  }

  /** Listen for one event type for as long as `scope` lives. */
  subscribe(scope: Scope, type: EventType, handler: EventHandler): void {
    const list = this.handlers[TYPE_INDEX.get(type)!]!;
    const sub = { handler, scope };
    // Register the cleanup first: a disposed scope throws here, before anything is subscribed.
    scope.own(() => {
      const at = list.indexOf(sub);
      if (at >= 0) {
        list.splice(at, 1);
        this.subscriptions--;
      }
    });
    list.push(sub);
    this.subscriptions++;
  }

  /**
   * Tick step 12. Dispatches queued events in raise order, in at most
   * EVENT_CASCADE_ROUNDS rounds. Returns the number left for the next tick.
   */
  dispatch(): number {
    for (let round = 0; round < EVENT_CASCADE_ROUNDS && this.length > 0; round++) {
      const inRound = this.length;
      for (let k = 0; k < inRound; k++) {
        const i = this.head;
        this.head = (this.head + 1) % EVENT_QUEUE_CAP;
        this.length--;
        const typeIndex = this.types[i]!;
        const event = this.current;
        event.type = EVENT_TYPES[typeIndex]!;
        event.a = this.as[i]!;
        event.b = this.bs[i]!;
        event.s = this.ss[i]!;
        event.n = this.ns[i]!;
        this.ss[i] = '';
        const list = this.handlers[typeIndex]!;
        // Subscriptions do not change during dispatch: map changes are
        // deferred to the end of the tick.
        for (let h = 0; h < list.length; h++) list[h]!.handler(event);
      }
    }
    if (this.length > 0) this.diagnostics.count('event-cascade-carried');
    return this.length;
  }

  get queued(): number {
    return this.length;
  }

  get subscriptionCount(): number {
    return this.subscriptions;
  }

  /** Queued events, oldest first, for the save. */
  exportQueue(): SavedEvent[] {
    const out: SavedEvent[] = [];
    for (let k = 0; k < this.length; k++) {
      const i = (this.head + k) % EVENT_QUEUE_CAP;
      out.push({ type: EVENT_TYPES[this.types[i]!]!, a: this.as[i]!, b: this.bs[i]!, s: this.ss[i]!, n: this.ns[i]! });
    }
    return out;
  }

  /** Replace the queue with saved events. Unknown types are dropped and reported. */
  importQueue(events: readonly SavedEvent[]): void {
    this.head = 0;
    this.length = 0;
    for (const e of events) {
      if (!TYPE_INDEX.has(e.type)) {
        this.diagnostics.report('save-unknown-event', `Dropped a saved event of unknown type "${e.type}".`);
        continue;
      }
      this.raise(e.type as EventType, e.a, e.b, e.s, e.n);
    }
  }

  clear(): void {
    this.head = 0;
    this.length = 0;
  }
}
