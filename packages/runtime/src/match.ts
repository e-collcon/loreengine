/**
 * EntityMatch resolution (spec 5.5). Entities are always resolved in
 * ascending entity index; that order is part of determinism.
 */
import type { EntityMatch, Project } from '@loreengine/schema';
import { F_PLAYER, MAX_ENTITIES, NO_ENTITY } from './entities.ts';
import type { EntityId, EntityStore } from './entities.ts';

/** The entities an event, action list, or condition list is about. */
export interface MatchContext {
  /** The event's entity. */
  subject: EntityId;
  /** The second entity, when there is one. */
  other: EntityId;
}

export class Matcher {
  constructor(
    private readonly project: Project,
    private readonly entities: EntityStore,
  ) {}

  /** Does the live entity at `index` satisfy `match`? */
  testIndex(match: EntityMatch, index: number, ctx: MatchContext): boolean {
    const e = this.entities;
    if (index < 0 || e.alive[index] !== 1) return false;
    switch (match.by) {
      case 'any':
        return true;
      case 'player':
        return (e.flags[index]! & F_PLAYER) !== 0;
      case 'subject':
        return ctx.subject !== NO_ENTITY && e.idAt(index) === ctx.subject;
      case 'other':
        return ctx.other !== NO_ENTITY && e.idAt(index) === ctx.other;
      case 'placement':
        return e.placementKey[index] === match.key;
      case 'tag': {
        const tags = this.project.archetypes[e.archetype[index]!]!.tags;
        for (let i = 0; i < tags.length; i++) if (tags[i] === match.tag) return true;
        return false;
      }
      case 'archetype':
        return this.project.archetypes[e.archetype[index]!]!.id === match.archetypeId;
      case 'faction': {
        const f = e.faction[index]!;
        return f >= 0 && this.project.factions[f]!.id === match.factionId;
      }
    }
  }

  /** Does the entity `id` satisfy `match`? A stale id never does. */
  test(match: EntityMatch, id: EntityId, ctx: MatchContext): boolean {
    return this.testIndex(match, this.entities.indexOf(id), ctx);
  }

  /**
   * Write the indices of every matching live entity into `out`, ascending,
   * and return how many. `out` must hold MAX_ENTITIES.
   */
  resolve(match: EntityMatch, ctx: MatchContext, out: Int32Array): number {
    const e = this.entities;
    switch (match.by) {
      case 'subject':
      case 'other': {
        const index = e.indexOf(match.by === 'subject' ? ctx.subject : ctx.other);
        if (index < 0) return 0;
        out[0] = index;
        return 1;
      }
      case 'placement': {
        const index = e.indexOfPlacement(match.key);
        if (index < 0) return 0;
        out[0] = index;
        return 1;
      }
      default: {
        let n = 0;
        const end = e.highWater;
        for (let index = 0; index < end; index++) {
          if (e.alive[index] === 1 && this.testIndex(match, index, ctx)) out[n++] = index;
        }
        return n;
      }
    }
  }
}

export function newMatchBuffer(): Int32Array {
  return new Int32Array(MAX_ENTITIES);
}
