/**
 * Active effects (spec 7.10): tick step 7. An effect follows its stacking
 * mode, has its duration converted to ticks once, and is one of at most 32
 * on an entity. Readers of each payload:
 *
 *   restriction: move     movement
 *   restriction: attack   attack start
 *   restriction: dodge    dodge start
 *   restriction: act      interact
 *   flag: invulnerable    attack contact
 *   flag: untargetable    acquisition and sight
 *   periodic              the effect tick: runs its actions with the bearer as subject
 *
 * I-frames are an effect, not a special case: the dodge applies an
 * engine-owned effect with the invulnerable flag, and a scripted jump one
 * with invulnerable plus every restriction.
 */
import type { StatusEffectDef } from '@loreengine/schema';
import {
  FX_AIRBORNE,
  FX_IFRAMES,
  MAX_EFFECTS,
  NO_ENTITY,
  RESTRICT_ACT,
  RESTRICT_ATTACK,
  RESTRICT_DODGE,
  RESTRICT_MOVE,
  STATUS_INVULNERABLE,
  STATUS_UNTARGETABLE,
} from './entities.ts';
import type { EntityId } from './entities.ts';
import type { MatchContext } from './match.ts';
import type { Sim } from './sim.ts';
import { durationToTicks } from './time.ts';

interface CompiledStatus {
  def: StatusEffectDef;
  /** -1 for a permanent effect. */
  ticks: number;
  restrict: number;
  status: number;
  intervalTicks: number;
  maxStacks: number;
}

const RESTRICT_BITS = { move: RESTRICT_MOVE, attack: RESTRICT_ATTACK, dodge: RESTRICT_DODGE, act: RESTRICT_ACT } as const;
const STATUS_BITS = { invulnerable: STATUS_INVULNERABLE, untargetable: STATUS_UNTARGETABLE } as const;
const ALL_RESTRICTIONS = RESTRICT_MOVE | RESTRICT_ATTACK | RESTRICT_DODGE | RESTRICT_ACT;

/** Names the two engine-owned effects carry in a save. */
export const FX_NAMES: Record<number, string> = { [FX_IFRAMES]: '@iframes', [FX_AIRBORNE]: '@airborne' };

export class Effects {
  readonly compiled: CompiledStatus[];
  private readonly indexById = new Map<string, number>();
  private readonly ctx: MatchContext = { subject: NO_ENTITY, other: NO_ENTITY };

  constructor(private readonly sim: Sim) {
    const msPerTurn = sim.project.settings.msPerTurn;
    this.compiled = sim.project.statusEffects.map((def) => {
      let restrict = 0;
      let status = 0;
      for (const r of def.restricts ?? []) restrict |= RESTRICT_BITS[r];
      for (const f of def.flags ?? []) status |= STATUS_BITS[f];
      return {
        def,
        ticks: def.duration === null ? -1 : durationToTicks(def.duration, msPerTurn),
        restrict,
        status,
        intervalTicks: def.periodic ? Math.max(1, durationToTicks(def.periodic.interval, msPerTurn)) : 0,
        maxStacks: def.maxStacks ?? 255,
      };
    });
    sim.project.statusEffects.forEach((def, i) => this.indexById.set(def.id, i));
  }

  indexOf(statusId: string): number {
    return this.indexById.get(statusId) ?? -1;
  }

  /** The id an effect slot is saved under. */
  nameOf(status: number): string {
    return status < 0 ? FX_NAMES[status]! : this.compiled[status]!.def.id;
  }

  /** The inverse of `nameOf`; undefined for a status that no longer exists. */
  statusOf(name: string): number | undefined {
    if (name === FX_NAMES[FX_IFRAMES]) return FX_IFRAMES;
    if (name === FX_NAMES[FX_AIRBORNE]) return FX_AIRBORNE;
    return this.indexById.get(name);
  }

  /** Does the entity carry at least one instance of this status? */
  has(index: number, status: number): boolean {
    const e = this.sim.entities;
    const base = index * MAX_EFFECTS;
    for (let k = 0; k < e.fxCount[index]!; k++) if (e.fxStatus[base + k] === status) return true;
    return false;
  }

  /** Stacks of a status on an entity, summed over its instances. */
  stacks(index: number, status: number): number {
    const e = this.sim.entities;
    const base = index * MAX_EFFECTS;
    let n = 0;
    for (let k = 0; k < e.fxCount[index]!; k++) if (e.fxStatus[base + k] === status) n += e.fxStacks[base + k]!;
    return n;
  }

  /**
   * Apply an authored status to an entity, following its stacking mode.
   * `source` is who applied it (NO_ENTITY for the world).
   */
  apply(index: number, status: number, source: EntityId): void {
    const e = this.sim.entities;
    const c = this.compiled[status]!;
    const base = index * MAX_EFFECTS;
    const mode = c.def.stackMode;
    if (mode !== 'independent') {
      // Find the instance this application lands on: per source, or one for everyone.
      const perSource = c.def.stackScope === 'per-source';
      for (let k = 0; k < e.fxCount[index]!; k++) {
        if (e.fxStatus[base + k] !== status) continue;
        if (perSource && e.fxSource[base + k] !== source) continue;
        if (mode === 'ignore') return;
        e.fxTicks[base + k] = c.ticks; // refresh and stack both renew the duration
        if (mode === 'stack' && e.fxStacks[base + k]! < c.maxStacks) e.fxStacks[base + k] = e.fxStacks[base + k]! + 1;
        e.fxSource[base + k] = source;
        return;
      }
    }
    this.add(index, status, c.ticks, source, c.intervalTicks);
  }

  /** Apply an engine-owned effect for `ticks`; an existing one is extended, never stacked. */
  applyEngine(index: number, status: number, ticks: number): void {
    const e = this.sim.entities;
    const base = index * MAX_EFFECTS;
    for (let k = 0; k < e.fxCount[index]!; k++) {
      if (e.fxStatus[base + k] === status) {
        if (ticks < 0 || (e.fxTicks[base + k]! >= 0 && e.fxTicks[base + k]! < ticks)) e.fxTicks[base + k] = ticks;
        return;
      }
    }
    this.add(index, status, ticks, NO_ENTITY, 0);
  }

  private add(index: number, status: number, ticks: number, source: EntityId, interval: number): void {
    const e = this.sim.entities;
    const n = e.fxCount[index]!;
    if (n >= MAX_EFFECTS) {
      // At the cap a new instance is refused (spec 9.2).
      this.sim.diagnostics.report('effect-cap', `An entity already carries ${MAX_EFFECTS} effects; "${this.nameOf(status)}" was refused.`);
      return;
    }
    const slot = index * MAX_EFFECTS + n;
    e.fxStatus[slot] = status;
    e.fxTicks[slot] = ticks;
    e.fxStacks[slot] = 1;
    e.fxSource[slot] = source;
    e.fxNext[slot] = interval;
    e.fxCount[index] = n + 1;
    this.refresh(index);
  }

  /** Remove every instance of a status. Returns how many were removed. */
  remove(index: number, status: number): number {
    const e = this.sim.entities;
    const base = index * MAX_EFFECTS;
    let write = 0;
    const n = e.fxCount[index]!;
    for (let k = 0; k < n; k++) {
      if (e.fxStatus[base + k] === status) continue;
      if (write !== k) this.move(base + k, base + write);
      write++;
    }
    e.fxCount[index] = write;
    if (write !== n) this.refresh(index);
    return n - write;
  }

  private move(from: number, to: number): void {
    const e = this.sim.entities;
    e.fxStatus[to] = e.fxStatus[from]!;
    e.fxTicks[to] = e.fxTicks[from]!;
    e.fxStacks[to] = e.fxStacks[from]!;
    e.fxSource[to] = e.fxSource[from]!;
    e.fxNext[to] = e.fxNext[from]!;
  }

  /** Recompute what an entity's effects forbid and grant. */
  refresh(index: number): void {
    const e = this.sim.entities;
    const base = index * MAX_EFFECTS;
    let restrict = 0;
    let status = 0;
    for (let k = 0; k < e.fxCount[index]!; k++) {
      const s = e.fxStatus[base + k]!;
      if (s === FX_IFRAMES) status |= STATUS_INVULNERABLE;
      else if (s === FX_AIRBORNE) {
        status |= STATUS_INVULNERABLE;
        restrict |= ALL_RESTRICTIONS;
      } else {
        restrict |= this.compiled[s]!.restrict;
        status |= this.compiled[s]!.status;
      }
    }
    e.restrict[index] = restrict;
    e.status[index] = status;
  }

  /** Tick step 7: periodic payloads run, durations count down, expired effects go. Hitstop does not pause this. */
  step(): void {
    const sim = this.sim;
    const e = sim.entities;
    const end = e.highWater;
    for (let i = 0; i < end; i++) {
      if (e.alive[i] !== 1 || e.fxCount[i] === 0) continue;
      const base = i * MAX_EFFECTS;
      const id = e.idAt(i);
      // Periodic payloads first; their actions may add or remove effects on anyone, including this entity.
      for (let k = 0; k < e.fxCount[i]!; k++) {
        const s = e.fxStatus[base + k]!;
        if (s < 0) continue;
        const c = this.compiled[s]!;
        if (c.intervalTicks === 0) continue;
        if (--e.fxNext[base + k]! > 0) continue;
        e.fxNext[base + k] = c.intervalTicks;
        this.ctx.subject = id;
        this.ctx.other = e.fxSource[base + k]!;
        // One run per stack: three stacks of poison hurt three times as much.
        const stacks = e.fxStacks[base + k]!;
        for (let n = 0; n < stacks; n++) sim.executor.run(c.def.periodic!.actions, this.ctx);
      }
      let write = 0;
      const n = e.fxCount[i]!;
      for (let k = 0; k < n; k++) {
        const ticks = e.fxTicks[base + k]!;
        if (ticks >= 0) {
          if (ticks <= 1) continue; // expires now
          e.fxTicks[base + k] = ticks - 1;
        }
        if (write !== k) this.move(base + k, base + write);
        write++;
      }
      if (write !== n) {
        e.fxCount[i] = write;
        this.refresh(i);
      }
    }
  }
}

/** `apply-effect` and `remove-effect`. */
export function registerEffectActions(sim: Sim): void {
  const buffer = new Int32Array(sim.entities.capacity);
  const run = (statusId: string, target: Parameters<Sim['matcher']['resolve']>[0], ctx: MatchContext, add: boolean): void => {
    const status = sim.effects.indexOf(statusId);
    if (status < 0) return;
    const n = sim.matcher.resolve(target, ctx, buffer);
    const source = sim.entities.isAlive(ctx.subject) ? ctx.subject : NO_ENTITY;
    for (let k = 0; k < n; k++) {
      if (add) sim.effects.apply(buffer[k]!, status, source);
      else sim.effects.remove(buffer[k]!, status);
    }
  };
  sim.executor.register('apply-effect', (a, ctx) => run(a.statusId, a.target, ctx, true));
  sim.executor.register('remove-effect', (a, ctx) => run(a.statusId, a.target, ctx, false));
}
