/**
 * The one ActionExecutor (spec 5.6, law L6). It runs every action list:
 * triggers, attack `onHit`, effect `periodic`, brain `onEnter`, terrain
 * contact, `onDeath`. Handlers are registered by type; Phase 2 registers
 * the variable, timer, trigger, message, session, and audio-request
 * actions, and later chunks register the entity actions.
 *
 * Each action receives a context of `subject` (the event's entity) and
 * `other` (the second entity, when there is one).
 */
import type { Action } from '@loreengine/schema';
import type { Diagnostics } from './diagnostics.ts';
import type { MatchContext } from './match.ts';

export type ActionType = Action['type'];
export type ActionOf<T extends ActionType> = Extract<Action, { type: T }>;
export type ActionHandler<T extends ActionType> = (action: ActionOf<T>, ctx: MatchContext) => void;

export class ActionExecutor {
  private readonly handlers = new Map<string, ActionHandler<ActionType>>();

  constructor(private readonly diagnostics: Diagnostics) {}

  /** Register the handler for one action type. A type has exactly one handler. */
  register<T extends ActionType>(type: T, handler: ActionHandler<T>): void {
    if (this.handlers.has(type)) throw new Error(`action "${type}" already has a handler`);
    this.handlers.set(type, handler as unknown as ActionHandler<ActionType>);
  }

  has(type: ActionType): boolean {
    return this.handlers.has(type);
  }

  /** The action types with a handler, sorted. */
  registered(): string[] {
    return [...this.handlers.keys()].sort();
  }

  /** Run a list in order. An action with no handler is reported, never silently skipped. */
  run(actions: readonly Action[], ctx: MatchContext): void {
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i]!;
      const handler = this.handlers.get(action.type);
      if (handler === undefined) {
        this.diagnostics.report('action-unhandled', `No handler is registered for action "${action.type}".`);
        continue;
      }
      handler(action, ctx);
    }
  }
}
