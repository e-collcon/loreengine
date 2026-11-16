/**
 * Presentation events: what the renderer and the audio mixer react to.
 * The runtime raises them and never reads them back; nothing in the
 * simulation depends on whether anyone is listening (spec 2: renderer and
 * audio are subscribers).
 *
 * They live in a ring of the latest 1,024, each with a sequence number. A
 * subscriber keeps its own cursor and asks for everything since, so the
 * view stays read-only and a client that renders less often than it ticks
 * misses nothing. Raising one allocates nothing.
 *
 *   kind            a          b         s                   n
 *   message         -          -         text                ms
 *   sfx             -          -         asset id            volume
 *   bgm             -          -         asset id, '' = stop fade ms
 *   session-ended   -          -         outcome             -
 *   feedback        entity     source    feedback id         -
 *   attack-windup   attacker   -         attack id           windup ticks
 *   attack-hit      attacker   victim    attack id           -
 *   hurt            entity     -         -                   health change
 *   death           entity     -         -                   -
 *   cue             entity     -         feedback id         -
 *   teleported      entity     -         -                   -   (skip interpolation)
 *   map-changed     -          -         map id              -
 */
export const PRESENTATION_KINDS = [
  'message',
  'sfx',
  'bgm',
  'session-ended',
  'feedback',
  'attack-windup',
  'attack-hit',
  'hurt',
  'death',
  'cue',
  'teleported',
  'map-changed',
] as const;
export type PresentationKind = (typeof PRESENTATION_KINDS)[number];

const KIND_INDEX = new Map<string, number>(PRESENTATION_KINDS.map((k, i) => [k, i]));
export const PRESENTATION_CAP = 1024;

/** One reused object handed to visitors: copy what you keep. */
export interface PresentationEvent {
  seq: number;
  tick: number;
  kind: PresentationKind;
  a: number;
  b: number;
  s: string;
  n: number;
}

export class PresentationLog {
  private readonly kinds = new Uint8Array(PRESENTATION_CAP);
  private readonly ticks = new Float64Array(PRESENTATION_CAP);
  private readonly as = new Float64Array(PRESENTATION_CAP);
  private readonly bs = new Float64Array(PRESENTATION_CAP);
  private readonly ns = new Float64Array(PRESENTATION_CAP);
  private readonly ss: string[] = new Array<string>(PRESENTATION_CAP).fill('');
  /** Sequence number the next event will get; events `next - cap .. next - 1` are retained. */
  private next = 0;
  private readonly current: PresentationEvent = { seq: 0, tick: 0, kind: 'message', a: -1, b: -1, s: '', n: 0 };
  tick = 0;

  raise(kind: PresentationKind, a = -1, b = -1, s = '', n = 0): void {
    const i = this.next % PRESENTATION_CAP;
    this.kinds[i] = KIND_INDEX.get(kind)!;
    this.ticks[i] = this.tick;
    this.as[i] = a;
    this.bs[i] = b;
    this.ss[i] = s;
    this.ns[i] = n;
    this.next++;
  }

  /** The cursor a new subscriber starts from: everything raised after now. */
  get end(): number {
    return this.next;
  }

  /**
   * Visit every retained event with `seq >= cursor`, oldest first, and
   * return the new cursor. Events older than the ring are gone.
   */
  since(cursor: number, visit: (event: Readonly<PresentationEvent>) => void): number {
    let seq = Math.max(cursor, this.next - PRESENTATION_CAP, 0);
    const event = this.current;
    for (; seq < this.next; seq++) {
      const i = seq % PRESENTATION_CAP;
      event.seq = seq;
      event.tick = this.ticks[i]!;
      event.kind = PRESENTATION_KINDS[this.kinds[i]!]!;
      event.a = this.as[i]!;
      event.b = this.bs[i]!;
      event.s = this.ss[i]!;
      event.n = this.ns[i]!;
      visit(event);
    }
    return this.next;
  }
}
