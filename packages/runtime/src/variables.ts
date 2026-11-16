/**
 * The VariableStore (spec 5.7), built from `VariableDef`s at session start.
 *
 *   - Writing a readonly variable is rejected with a diagnostic.
 *   - Type mismatches are rejected, never coerced.
 *   - `variable-changed` fires only when the value actually changes.
 *   - `save` scope persists into the save; `session` scope resets on load.
 *   - `global` is reserved for a future account-level store: until then it
 *     behaves as `save` and logs once.
 *
 * Conditions and actions reference a variable by id; `key` is only what
 * authors (and diagnostics) read.
 */
import type { VariableDef, VariableOp, VariableValue } from '@loreengine/schema';
import type { Diagnostics } from './diagnostics.ts';
import type { EventBus } from './events.ts';

const typeOfValue = (v: VariableValue): VariableDef['type'] =>
  typeof v === 'boolean' ? 'bool' : typeof v === 'number' ? 'number' : 'string';

export class VariableStore {
  private readonly indexById = new Map<string, number>();
  private readonly values: VariableValue[];

  constructor(
    private readonly defs: readonly VariableDef[],
    private readonly bus: EventBus,
    private readonly diagnostics: Diagnostics,
  ) {
    this.values = defs.map((d) => d.initial);
    defs.forEach((def, i) => {
      this.indexById.set(def.id, i);
      if (def.scope === 'global') {
        diagnostics.reportOnce(
          'variable-global-scope',
          `Variable "${def.key}" has scope "global", which is reserved; it is treated as "save".`,
        );
      }
    });
  }

  has(id: string): boolean {
    return this.indexById.has(id);
  }

  /** The current value, or undefined for an unknown id. */
  get(id: string): VariableValue | undefined {
    const i = this.indexById.get(id);
    return i === undefined ? undefined : this.values[i];
  }

  /** Apply an authored operation. Returns true when the value changed. */
  apply(id: string, op: VariableOp): boolean {
    const i = this.indexById.get(id);
    if (i === undefined) {
      this.diagnostics.report('variable-unknown', `No variable ${id}.`);
      return false;
    }
    const def = this.defs[i]!;
    const current = this.values[i]!;
    let next: VariableValue;
    switch (op.kind) {
      case 'set':
        next = op.value;
        break;
      case 'add':
        if (def.type !== 'number') return this.mismatch(def, '"add" needs a number variable');
        next = (current as number) + op.value;
        break;
      case 'toggle':
        if (def.type !== 'bool') return this.mismatch(def, '"toggle" needs a bool variable');
        next = !current;
        break;
      case 'set-from': {
        const source = this.get(op.sourceVariableId);
        if (source === undefined) {
          this.diagnostics.report('variable-unknown', `No variable ${op.sourceVariableId}.`);
          return false;
        }
        next = source;
        break;
      }
    }
    return this.write(i, next);
  }

  /** Set a value directly (same rules as an authored `set`). */
  set(id: string, value: VariableValue): boolean {
    const i = this.indexById.get(id);
    if (i === undefined) {
      this.diagnostics.report('variable-unknown', `No variable ${id}.`);
      return false;
    }
    return this.write(i, value);
  }

  private write(i: number, next: VariableValue): boolean {
    const def = this.defs[i]!;
    if (def.readonly) {
      this.diagnostics.report('variable-readonly', `Variable "${def.key}" is readonly; the write was rejected.`);
      return false;
    }
    if (typeOfValue(next) !== def.type) return this.mismatch(def, `cannot hold a ${typeOfValue(next)}`);
    if (typeof next === 'number' && !Number.isFinite(next)) return this.mismatch(def, 'cannot hold a non-finite number');
    if (this.values[i] === next) return false;
    this.values[i] = next;
    this.bus.raise('variable-changed', -1, -1, def.id);
    return true;
  }

  private mismatch(def: VariableDef, why: string): false {
    this.diagnostics.report('variable-type-mismatch', `Variable "${def.key}" (${def.type}): ${why}; the write was rejected.`);
    return false;
  }

  /** Values that persist: `save` and `global` scope. */
  exportSave(): Record<string, VariableValue> {
    const out: Record<string, VariableValue> = {};
    this.defs.forEach((def, i) => {
      if (def.scope !== 'session') out[def.id] = this.values[i]!;
    });
    return out;
  }

  /**
   * Load saved values. Session-scope variables keep their initial value.
   * Entries for variables that no longer exist, or no longer fit, are
   * dropped and reported (spec 5.10: content changed since the save).
   */
  importSave(saved: Readonly<Record<string, VariableValue>>): void {
    this.defs.forEach((def, i) => {
      this.values[i] = def.initial;
    });
    for (const id of Object.keys(saved)) {
      const i = this.indexById.get(id);
      const value = saved[id]!;
      if (i === undefined) {
        this.diagnostics.report('save-dropped-variable', `The save has a value for variable ${id}, which no longer exists.`);
        continue;
      }
      const def = this.defs[i]!;
      if (def.scope === 'session') continue;
      if (typeOfValue(value) !== def.type) {
        this.diagnostics.report('save-dropped-variable', `The saved value of "${def.key}" is not a ${def.type}.`);
        continue;
      }
      this.values[i] = value;
    }
  }
}
