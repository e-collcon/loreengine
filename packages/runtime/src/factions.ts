/**
 * Faction relations (spec 7.7). Missing means neutral, a faction is always
 * its own ally, and an entity with no faction is neutral to everyone.
 * `relation(a, b)` is a's stance toward b, as authored on a.
 */
import type { FactionDef, Relation } from '@loreengine/schema';

export const NEUTRAL = 0;
export const HOSTILE = 1;
export const ALLY = 2;
const CODE: Record<Relation, number> = { neutral: NEUTRAL, hostile: HOSTILE, ally: ALLY };
const NAME: readonly Relation[] = ['neutral', 'hostile', 'ally'];

export class FactionTable {
  private readonly indexById = new Map<string, number>();
  private readonly matrix: Uint8Array;
  private readonly n: number;

  constructor(factions: readonly FactionDef[]) {
    this.n = factions.length;
    this.matrix = new Uint8Array(this.n * this.n);
    factions.forEach((f, i) => this.indexById.set(f.id, i));
    factions.forEach((f, i) => {
      for (const other of Object.keys(f.relations)) {
        const j = this.indexById.get(other);
        if (j !== undefined) this.matrix[i * this.n + j] = CODE[f.relations[other]!];
      }
      this.matrix[i * this.n + i] = ALLY;
    });
  }

  indexOf(id: string): number {
    return this.indexById.get(id) ?? -1;
  }

  /** Relation code between two faction indices; -1 (no faction) is neutral to everyone. */
  between(a: number, b: number): number {
    if (a < 0 || b < 0) return NEUTRAL;
    return this.matrix[a * this.n + b]!;
  }

  relation(aId: string, bId: string): Relation {
    return NAME[this.between(this.indexOf(aId), this.indexOf(bId))]!;
  }
}
