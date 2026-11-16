/**
 * Health, death, and terrain contact (spec 7.10): tick steps 8 and 9.
 *
 *   - `modify-health` clamps to 0..max.
 *   - `health-crossed` fires when health falls across a threshold that a
 *     loaded trigger listens for.
 *   - At zero: `entity-died` fires, every restriction applies, the death
 *     clip plays, `onDeath` actions run, the entity despawns after
 *     `despawnAfterMs`, and its placement key joins the save's `removed` list.
 *   - Terrain contact runs a terrain's `contact` actions every `everyMs`
 *     while a walker stands on it, with the walker as subject.
 */
import { F_DEAD, F_HEALTH, NO_ENTITY } from './entities.ts';
import type { MatchContext } from './match.ts';
import type { Sim } from './sim.ts';
import { msToTicks } from './time.ts';
import { HURT_TICKS } from './combat.ts';
import { MODE_WALK } from './world.ts';

export class Health {
  private readonly ctx: MatchContext = { subject: NO_ENTITY, other: NO_ENTITY };
  /** Per terrain: ticks between contact runs, or 0 when the terrain has no contact. */
  private readonly contactTicks: Int32Array;

  constructor(private readonly sim: Sim) {
    this.contactTicks = Int32Array.from(sim.project.terrains, (t) => (t.contact ? Math.max(1, msToTicks(t.contact.everyMs)) : 0));
  }

  /** Change an entity's health by `delta`, clamped to 0..max. Dead entities and those without health are untouched. */
  modify(index: number, delta: number): void {
    const sim = this.sim;
    const e = sim.entities;
    if ((e.flags[index]! & (F_HEALTH | F_DEAD)) !== F_HEALTH) return;
    let hp = e.hp[index]! + delta;
    if (hp < 0) hp = 0;
    else if (hp > e.hpMax[index]!) hp = e.hpMax[index]!;
    if (hp === e.hp[index]) return;
    const change = hp - e.hp[index]!;
    e.hp[index] = hp;
    if (change < 0) {
      e.hurtUntil[index] = sim.tick + HURT_TICKS;
      sim.presentation.raise('hurt', e.idAt(index), NO_ENTITY, '', change);
    }
  }

  /** Tick step 8: health changes apply; deaths are raised. */
  step(): void {
    const sim = this.sim;
    const e = sim.entities;
    const end = e.highWater;
    const thresholds = sim.triggers.healthThresholds;
    for (let i = 0; i < end; i++) {
      if (e.alive[i] !== 1 || (e.flags[i]! & F_HEALTH) === 0) continue;
      if ((e.flags[i]! & F_DEAD) !== 0) {
        if (sim.tick >= e.despawnAt[i]!) e.requestDespawn(e.idAt(i));
        continue;
      }
      const hp = e.hp[i]!;
      const seen = e.hpSeen[i]!;
      if (hp === seen) continue;
      e.hpSeen[i] = hp;
      const max = e.hpMax[i]!;
      const id = e.idAt(i);
      if (hp < seen && max > 0) {
        // One event per threshold the health fell across since the last step.
        const was = seen / max;
        const now = hp / max;
        for (let t = thresholds.length - 1; t >= 0; t--) {
          const threshold = thresholds[t]!;
          if (was >= threshold && now < threshold) sim.bus.raise('health-crossed', id, e.lastHitBy[i]!, '', threshold);
        }
      }
      if (hp <= 0) this.die(i);
    }
  }

  private die(i: number): void {
    const sim = this.sim;
    const e = sim.entities;
    const id = e.idAt(i);
    const killer = e.isAlive(e.lastHitBy[i]!) ? e.lastHitBy[i]! : NO_ENTITY;
    e.flags[i] = e.flags[i]! | F_DEAD;
    // Every restriction applies: whatever it was doing stops.
    sim.combat.cancel(i);
    e.dodgeTicks[i] = 0;
    e.dashX[i] = 0;
    e.dashY[i] = 0;
    sim.paths.clear(i);
    sim.orders.cancel(i);
    e.target[i] = NO_ENTITY;
    sim.bus.raise('entity-died', id, killer);
    sim.presentation.raise('death', id, killer);
    const data = e.data[i]!;
    if (data.feedback?.onDeath !== undefined) sim.presentation.raise('feedback', id, killer, data.feedback.onDeath);
    const onDeath = data.onDeath;
    e.despawnAt[i] = sim.tick + (onDeath ? msToTicks(onDeath.despawnAfterMs) : 0);
    if (onDeath && onDeath.actions.length > 0) {
      this.ctx.subject = id;
      this.ctx.other = killer;
      sim.executor.run(onDeath.actions, this.ctx);
    }
  }

  /** Tick step 9: terrain contact fires. */
  terrainContact(): void {
    const sim = this.sim;
    const world = sim.world;
    if (world === null) return;
    const e = sim.entities;
    const end = e.highWater;
    for (let i = 0; i < end; i++) {
      if (e.alive[i] !== 1 || e.mode[i] !== MODE_WALK || (e.flags[i]! & F_DEAD) !== 0 || e.airborne[i] === 1) continue;
      const cell = e.lastCell[i]!;
      const every = cell < 0 ? 0 : this.contactTicks[world.terrainDef[cell]!]!;
      if (every === 0) {
        e.terrainTicks[i] = 0; // off it: the next step onto it fires at once
        continue;
      }
      if (e.terrainTicks[i]! > 0) {
        e.terrainTicks[i] = e.terrainTicks[i]! - 1;
        continue;
      }
      e.terrainTicks[i] = every - 1;
      this.ctx.subject = e.idAt(i);
      this.ctx.other = NO_ENTITY;
      sim.executor.run(sim.project.terrains[world.terrainDef[cell]!]!.contact!.actions, this.ctx);
    }
  }
}

/** `modify-health`, `apply-impulse`, and `play-feedback`. */
export function registerHealthActions(sim: Sim): void {
  const buffer = new Int32Array(sim.entities.capacity);
  const e = sim.entities;

  sim.executor.register('modify-health', (a, ctx) => {
    const n = sim.matcher.resolve(a.target, ctx, buffer);
    for (let k = 0; k < n; k++) sim.health.modify(buffer[k]!, a.delta);
  });

  sim.executor.register('apply-impulse', (a, ctx) => {
    const n = sim.matcher.resolve(a.target, ctx, buffer);
    for (let k = 0; k < n; k++) {
      const i = buffer[k]!;
      const motion = e.data[i]!.motion;
      if (motion === undefined || e.airborne[i] === 1) continue; // no knockback response
      let dx: number;
      let dy: number;
      if (a.away === 'other') {
        // Away from the other entity; when the target IS the other, away from the subject.
        const from = e.indexOf(e.idAt(i) === ctx.other ? ctx.subject : ctx.other);
        if (from < 0 || from === i) {
          sim.diagnostics.report('impulse-no-source', 'apply-impulse "away: other" ran with no other entity to push away from.');
          continue;
        }
        dx = e.x[i]! - e.x[from]!;
        dy = e.y[i]! - e.y[from]!;
        const d = Math.hypot(dx, dy);
        if (d < 1e-9) {
          dx = Math.cos(e.facing[from]!);
          dy = Math.sin(e.facing[from]!);
        } else {
          dx /= d;
          dy /= d;
        }
      } else {
        // Along the facing of whoever is pushing: the subject, or the target itself for a lunge.
        const pusher = e.indexOf(ctx.subject);
        const facing = e.facing[pusher >= 0 ? pusher : i]!;
        dx = Math.cos(facing);
        dy = Math.sin(facing);
      }
      e.vx[i] = e.vx[i]! + (dx * a.strength) / motion.mass;
      e.vy[i] = e.vy[i]! + (dy * a.strength) / motion.mass;
    }
  });

  sim.executor.register('play-feedback', (a, ctx) => {
    const n = sim.matcher.resolve(a.target, ctx, buffer);
    for (let k = 0; k < n; k++) sim.presentation.raise('feedback', e.idAt(buffer[k]!), ctx.subject, a.feedbackId);
  });
}
