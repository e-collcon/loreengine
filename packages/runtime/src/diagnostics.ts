/**
 * Diagnostics: what the runtime reports instead of throwing or logging.
 * The runtime has no console (it compiles without the DOM or Node
 * libraries); clients read these through the view.
 *
 * Counters are exact. The message log is a ring of the latest 256 entries
 * (law L8: every collection is capped).
 */
export interface DiagnosticEntry {
  tick: number;
  code: string;
  message: string;
}

const LOG_CAP = 256;

export class Diagnostics {
  private readonly counts = new Map<string, number>();
  private readonly log: DiagnosticEntry[] = [];
  private start = 0;
  /** Set by the runtime each tick so entries carry the tick they happened on. */
  tick = 0;

  /** Count an occurrence without a message (safe on hot paths: no allocation once the code is known). */
  count(code: string): void {
    this.counts.set(code, (this.counts.get(code) ?? 0) + 1);
  }

  /** Count an occurrence and keep a message. */
  report(code: string, message: string): void {
    this.count(code);
    const entry = { tick: this.tick, code, message };
    if (this.log.length < LOG_CAP) this.log.push(entry);
    else {
      this.log[this.start] = entry;
      this.start = (this.start + 1) % LOG_CAP;
    }
  }

  /** Report only the first time a code occurs ("logs once"). */
  reportOnce(code: string, message: string): void {
    if (this.counts.has(code)) return;
    this.report(code, message);
  }

  countOf(code: string): number {
    return this.counts.get(code) ?? 0;
  }

  /** Every counter, sorted by code. */
  counters(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const code of [...this.counts.keys()].sort()) out[code] = this.counts.get(code)!;
    return out;
  }

  /** The retained messages, oldest first. */
  entries(): DiagnosticEntry[] {
    return [...this.log.slice(this.start), ...this.log.slice(0, this.start)];
  }
}
