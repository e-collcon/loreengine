/**
 * Attacks, telegraphs, contact, and dodge (spec 7.8, 7.9): tick steps 4 and 6.
 *
 * The player and every enemy use the same attack state machine. Attack
 * timing is owned by `AttackDef` (windup, active, recovery), not by
 * animation frames, so combat works with placeholder art (spec 2).
 *
 *   start      needs: not attacking or dodging, not restricted from
 *              attacking, not in hitstop, the attack off cooldown. Facing
 *              snaps to the aim point and `attack-windup` fires: the telegraph.
 *   windup     `windupMs`; the first active tick is exactly that long after the event.
 *   active     every tick the hitbox is tested against nearby colliders.
 *   recovery   then the cooldown runs.
 *
 * Nothing here allocates per tick.
 */
import type { AttackDef, BrainDef } from '@loreengine/schema';
import {
  F_COLLIDER,
  F_DEAD,
  F_HEALTH,
  FX_IFRAMES,
  MAX_ATTACK_SLOTS,
  MAX_ENTITIES,
  MAX_VICTIMS,
  NO_ENTITY,
  PHASE_ACTIVE,
  PHASE_NONE,
  PHASE_RECOVERY,
  PHASE_WINDUP,
  RESTRICT_ATTACK,
  RESTRICT_DODGE,
  STATUS_INVULNERABLE,
} from './entities.ts';
import { ALLY } from './factions.ts';
import { ROLE_ATTACK_PRIMARY, ROLE_ATTACK_SECONDARY, ROLE_DODGE } from './input.ts';
import type { MatchContext } from './match.ts';
import { attackRange } from './orders.ts';
import { HIT_NONE } from './sight.ts';
import type { Sim } from './sim.ts';
import { TICK_HZ, msToTicks } from './time.ts';

/** Speed factor while an attack marked `slowed` is in progress (spec 7.4). */
export const SLOWED_SCALE = 0.4;
/** The hurt clip plays this long after a hit (spec 7.12). */
export const HURT_TICKS = msToTicks(200);
/** Chest height as a fraction of the collider's height: where the no-hits-through-walls ray starts and ends. */
const CHEST = 0.6;

export interface CompiledAttack {
  def: AttackDef;
  index: number;
  windupTicks: number;
  activeTicks: number;
  recoveryTicks: number;
  cooldownTicks: number;
  hitstopTicks: number;
  /** How close a brain or an attack order gets before swinging. */
  range: number;
  /** For arcs: cosine of half the arc. */
  cosHalfArc: number;
  halfArc: number;
}

export class Combat {
  readonly compiled: CompiledAttack[];
  private readonly indexById = new Map<string, number>();
  private readonly buffer = new Int32Array(MAX_ENTITIES);
  private readonly ctx: MatchContext = { subject: NO_ENTITY, other: NO_ENTITY };

  constructor(private readonly sim: Sim) {
    this.compiled = sim.project.attacks.map((def, index) => {
      const halfArc = def.hitbox.shape === 'arc' ? (def.hitbox.arcDeg * Math.PI) / 360 : 0;
      return {
        def,
        index,
        // Durations become ticks once, here.
        windupTicks: msToTicks(def.windupMs),
        activeTicks: msToTicks(def.activeMs),
        recoveryTicks: msToTicks(def.recoveryMs),
        cooldownTicks: msToTicks(def.cooldownMs),
        hitstopTicks: msToTicks(def.hitstopMs),
        range: attackRange(def),
        halfArc,
        cosHalfArc: Math.cos(halfArc),
      };
    });
    sim.project.attacks.forEach((def, i) => this.indexById.set(def.id, i));
  }

  indexOf(attackId: string): number {
    return this.indexById.get(attackId) ?? -1;
  }

  /** The slot of an attack in the entity's `attacker.attackIds`, or -1 when it does not own that attack. */
  private slotOf(index: number, attack: number): number {
    const ids = this.sim.entities.data[index]!.attacker?.attackIds;
    if (ids === undefined) return -1;
    const id = this.compiled[attack]!.def.id;
    for (let k = 0; k < ids.length && k < MAX_ATTACK_SLOTS; k++) if (ids[k] === id) return k;
    return -1;
  }

  /** Is this attack off cooldown for this entity? */
  ready(index: number, attack: number): boolean {
    const slot = this.slotOf(index, attack);
    return slot < 0 || this.sim.tick >= this.sim.entities.attackReady[index * MAX_ATTACK_SLOTS + slot]!;
  }

  /** May this entity start an attack right now (ignoring the cooldown)? */
  free(index: number): boolean {
    const e = this.sim.entities;
    return (
      e.alive[index] === 1 &&
      (e.flags[index]! & F_DEAD) === 0 &&
      e.attackPhase[index] === PHASE_NONE &&
      e.dodgeTicks[index] === 0 &&
      e.hitstop[index] === 0 &&
      e.airborne[index] === 0 &&
      (e.restrict[index]! & RESTRICT_ATTACK) === 0
    );
  }

  /**
   * Start an attack. Returns false when the start conditions do not hold.
   * (aimX, aimY) is the aim point facing snaps to; pass the entity's own
   * position to keep its facing.
   */
  start(index: number, attack: number, aimX: number, aimY: number): boolean {
    const sim = this.sim;
    const e = sim.entities;
    if (attack < 0 || !this.free(index) || !this.ready(index, attack)) return false;
    if (this.slotOf(index, attack) < 0) {
      sim.diagnostics.reportOnce('attack-not-owned', `An entity swung "${this.compiled[attack]!.def.name}", which is not in its attacker.attackIds; it has no cooldown.`);
    }
    const c = this.compiled[attack]!;
    const dx = aimX - e.x[index]!;
    const dy = aimY - e.y[index]!;
    if (dx !== 0 || dy !== 0) e.facing[index] = Math.atan2(dy, dx); // facing snaps to the aim point
    e.attack[index] = attack;
    e.attackStarted[index] = sim.tick;
    e.hitCount[index] = 0;
    if (c.windupTicks > 0) {
      e.attackPhase[index] = PHASE_WINDUP;
      e.attackTicks[index] = c.windupTicks;
    } else {
      e.attackPhase[index] = PHASE_ACTIVE;
      e.attackTicks[index] = c.activeTicks;
    }
    if (sim.paths.busy(index) || e.hasGoal[index] === 1) sim.paths.clear(index);
    // The telegraph: Phase 3 plays the windup feedback and draws the hitbox on the ground.
    sim.presentation.raise('attack-windup', e.idAt(index), NO_ENTITY, c.def.id, c.windupTicks);
    return true;
  }

  /** End an attack now (a dodge out of recovery, death, a scripted jump): its cooldown starts. */
  cancel(index: number): void {
    const e = this.sim.entities;
    if (e.attackPhase[index] === PHASE_NONE) return;
    this.finish(index);
  }

  private finish(index: number): void {
    const e = this.sim.entities;
    const attack = e.attack[index]!;
    const slot = this.slotOf(index, attack);
    if (slot >= 0) e.attackReady[index * MAX_ATTACK_SLOTS + slot] = this.sim.tick + this.compiled[attack]!.cooldownTicks;
    e.attackPhase[index] = PHASE_NONE;
    e.attack[index] = -1;
    e.attackTicks[index] = 0;
    e.hitCount[index] = 0;
  }

  /** Try to dodge (spec 7.9). (mx, my) is the move input; with none, the dash goes along facing. */
  dodge(index: number, mx: number, my: number): boolean {
    const sim = this.sim;
    const e = sim.entities;
    const dodge = e.data[index]!.dodge;
    if (dodge === undefined || (e.flags[index]! & F_DEAD) !== 0) return false;
    if ((e.restrict[index]! & RESTRICT_DODGE) !== 0 || sim.tick < e.dodgeReady[index]!) return false;
    if (e.dodgeTicks[index]! > 0 || e.hitstop[index]! > 0 || e.airborne[index] === 1) return false;
    // Allowed from idle, movement, and attack recovery, but not during windup or active frames.
    const phase = e.attackPhase[index]!;
    if (phase === PHASE_WINDUP || phase === PHASE_ACTIVE) return false;
    if (phase === PHASE_RECOVERY) this.cancel(index);

    let dx = mx;
    let dy = my;
    const length = Math.hypot(dx, dy);
    if (length > 1e-9) {
      dx /= length;
      dy /= length;
    } else {
      dx = Math.cos(e.facing[index]!);
      dy = Math.sin(e.facing[index]!);
    }
    const ticks = Math.max(1, msToTicks(dodge.durationMs));
    const speed = (dodge.distance / ticks) * TICK_HZ; // world units per second
    e.dodgeTicks[index] = ticks;
    e.dashX[index] = dx * speed;
    e.dashY[index] = dy * speed;
    e.dodgeReady[index] = sim.tick + msToTicks(dodge.cooldownMs);
    // I-frames are an effect: anything else that grants invulnerability later works the same way.
    const iframes = msToTicks(dodge.iframeMs);
    if (iframes > 0) sim.effects.applyEngine(index, FX_IFRAMES, iframes);
    if (sim.paths.busy(index) || e.hasGoal[index] === 1) sim.paths.clear(index);
    sim.orders.cancel(index);
    return true;
  }

  /** Player buttons (part of tick step 2): attack-primary and attack-secondary use the first and second attacks. */
  playerInput(p: number): void {
    const sim = this.sim;
    const e = sim.entities;
    const input = sim.input;
    if ((input.pressed & ROLE_DODGE) !== 0) this.dodge(p, input.moveX, input.moveY);
    const pressed = input.pressed & (ROLE_ATTACK_PRIMARY | ROLE_ATTACK_SECONDARY);
    if (pressed === 0) return;
    const ids = e.data[p]!.attacker?.attackIds;
    if (ids === undefined) return;
    const id = ids[(pressed & ROLE_ATTACK_PRIMARY) !== 0 ? 0 : 1];
    if (id === undefined) return;
    const aimX = input.hasAim ? input.aimX : e.x[p]!;
    const aimY = input.hasAim ? input.aimY : e.y[p]!;
    if (this.start(p, this.indexOf(id), aimX, aimY)) sim.orders.cancel(p);
  }

  /** An attack order in range: swing attack-primary at the target. Returns true once the swing started. */
  orderAttack(actor: number, target: number): boolean {
    const e = this.sim.entities;
    const id = e.data[actor]!.attacker?.attackIds[0];
    if (id === undefined) return true; // nothing to swing: the order is simply done
    return this.start(actor, this.indexOf(id), e.x[target]!, e.y[target]!);
  }

  /** The `attack` brain behavior: start an attack inside its aiRange, in sequence or seeded random order. */
  brainAttack(index: number, target: number, state: BrainDef['states'][number]): void {
    const sim = this.sim;
    const e = sim.entities;
    const behavior = state.behavior;
    if (behavior.kind !== 'attack' || !this.free(index)) return;
    const n = behavior.attackIds.length;
    let pick = e.attackPick[index]!;
    if (pick < 0 || pick >= n) {
      pick = behavior.pick === 'sequence' ? e.attackSeq[index]! % n : sim.rng.nextInt(n);
      e.attackPick[index] = pick;
    }
    const attack = this.indexOf(behavior.attackIds[pick]!);
    if (attack < 0 || !this.ready(index, attack)) return;
    const reach = this.compiled[attack]!.range + (e.data[target]!.collider ? e.data[target]!.collider!.radius : 0);
    if (Math.hypot(e.x[target]! - e.x[index]!, e.y[target]! - e.y[index]!) > reach) return;
    if (this.start(index, attack, e.x[target]!, e.y[target]!)) {
      e.attackSeq[index] = e.attackSeq[index]! + 1;
      e.attackPick[index] = -1;
    }
  }

  /** Tick step 4: attack and dodge state machines advance. */
  step(): void {
    const sim = this.sim;
    const e = sim.entities;
    const end = e.highWater;
    for (let i = 0; i < end; i++) {
      if (e.alive[i] !== 1) continue;
      e.speedScale[i] = 1;
      if (e.hitstop[i]! > 0) {
        // Hitstop freezes attack and dodge timers; the speed factor still applies when it lifts.
        if (e.attackPhase[i] !== PHASE_NONE) e.speedScale[i] = this.moveScale(e.attack[i]!);
        continue;
      }
      // (The dodge's own timer counts down in the movement step, after each tick of dash.)
      const phase = e.attackPhase[i]!;
      if (phase === PHASE_NONE) continue;
      const c = this.compiled[e.attack[i]!]!;
      // An attack's timers first advance on the tick after it started, so the
      // first active tick is exactly `windupTicks` after the windup event.
      if (e.attackStarted[i] !== sim.tick && --e.attackTicks[i]! <= 0) {
        if (phase === PHASE_WINDUP) {
          e.attackPhase[i] = PHASE_ACTIVE;
          e.attackTicks[i] = c.activeTicks;
          if (c.activeTicks <= 0) this.toRecovery(i, c);
        } else if (phase === PHASE_ACTIVE) this.toRecovery(i, c);
        else this.finish(i);
      }
      if (e.attackPhase[i] !== PHASE_NONE) e.speedScale[i] = this.moveScale(e.attack[i]!);
    }
  }

  private toRecovery(i: number, c: CompiledAttack): void {
    const e = this.sim.entities;
    if (c.recoveryTicks <= 0) {
      this.finish(i);
      return;
    }
    e.attackPhase[i] = PHASE_RECOVERY;
    e.attackTicks[i] = c.recoveryTicks;
  }

  private moveScale(attack: number): number {
    const mode = this.compiled[attack]!.def.moveDuring;
    return mode === 'free' ? 1 : mode === 'slowed' ? SLOWED_SCALE : 0;
  }

  /** Tick step 6: attack contact. */
  contact(): void {
    const sim = this.sim;
    const world = sim.world;
    const hash = sim.hash;
    if (world === null || hash === null) return;
    const e = sim.entities;
    const end = e.highWater;
    const pitchX = Math.sqrt(3) * world.hexSize;
    const pitchY = 1.5 * world.hexSize;
    const friendlyFire = sim.project.settings.friendlyFire;
    for (let a = 0; a < end; a++) {
      if (e.alive[a] !== 1 || e.attackPhase[a] !== PHASE_ACTIVE || e.hitstop[a]! > 0) continue;
      const c = this.compiled[e.attack[a]!]!;
      const def = c.def;
      const ax = e.x[a]!;
      const ay = e.y[a]!;
      const az = e.z[a]!;
      const fx = Math.cos(e.facing[a]!);
      const fy = Math.sin(e.facing[a]!);
      const reach = c.range + sim.maxRadius + (def.hitbox.shape === 'circle' ? def.hitbox.radius : 0);
      const n = hash.queryRange(
        Math.floor((ax - reach) / pitchX) - 1,
        Math.floor((ay - reach) / pitchY) - 1,
        Math.floor((ax + reach) / pitchX) + 1,
        Math.floor((ay + reach) / pitchY) + 1,
        this.buffer,
      );
      // Victims in ascending index, whatever order the hash returned them in (law L5).
      for (let i = 1; i < n; i++) {
        const v = this.buffer[i]!;
        let j = i - 1;
        while (j >= 0 && this.buffer[j]! > v) {
          this.buffer[j + 1] = this.buffer[j]!;
          j--;
        }
        this.buffer[j + 1] = v;
      }
      const attackerHeight = e.data[a]!.collider ? e.data[a]!.collider!.height : 1;
      for (let k = 0; k < n; k++) {
        const v = this.buffer[k]!;
        // It has health and is not the attacker.
        if (v === a || (e.flags[v]! & (F_HEALTH | F_DEAD | F_COLLIDER)) !== (F_HEALTH | F_COLLIDER)) continue;
        // It is not an ally, unless friendlyFire is on.
        if (!friendlyFire && sim.factions.between(e.faction[a]!, e.faction[v]!) === ALLY) continue;
        const collider = e.data[v]!.collider!;
        const r = collider.radius;
        const dx = e.x[v]! - ax;
        const dy = e.y[v]! - ay;
        if (!this.overlaps(c, fx, fy, dx, dy, r)) continue;
        // Its height range overlaps the attacker's feet plus or minus verticalReach.
        if (e.z[v]! > az + def.verticalReach || e.z[v]! + collider.height < az - def.verticalReach) continue;
        // It does not carry the invulnerable flag.
        if ((e.status[v]! & STATUS_INVULNERABLE) !== 0) continue;
        // It has not already been hit by this activation (at most 16 victims).
        const id = e.idAt(v);
        const base = a * MAX_VICTIMS;
        let seen = false;
        for (let h = 0; h < e.hitCount[a]!; h++) {
          if (e.hitSet[base + h] === id) {
            seen = true;
            break;
          }
        }
        if (seen || e.hitCount[a]! >= MAX_VICTIMS) continue;
        // A segment from the attacker's chest to the victim's, cast in projectile mode, is not
        // blocked: no one hits through a cliff or a wall.
        if (sim.sight.cast(ax, ay, az + attackerHeight * CHEST, e.x[v]!, e.y[v]!, e.z[v]! + collider.height * CHEST, true, -1, false) !== HIT_NONE) continue;
        e.hitSet[base + e.hitCount[a]!] = id;
        e.hitCount[a] = e.hitCount[a]! + 1;
        this.hit(a, v, c, fx, fy);
      }
    }
  }

  /** Does the hitbox, relative to the attacker's facing (fx, fy), touch a circle of radius r at offset (dx, dy)? */
  private overlaps(c: CompiledAttack, fx: number, fy: number, dx: number, dy: number, r: number): boolean {
    const h = c.def.hitbox;
    if (h.shape === 'circle') {
      const cx = dx - fx * h.offset;
      const cy = dy - fy * h.offset;
      const reach = h.radius + r;
      return cx * cx + cy * cy <= reach * reach;
    }
    const along = dx * fx + dy * fy;
    const across = dy * fx - dx * fy;
    if (h.shape === 'line') {
      return along >= -r && along <= h.length + r && Math.abs(across) <= h.width / 2 + r;
    }
    // Arc: within range, and within half the arc of facing; the victim's radius widens both.
    const distance = Math.hypot(dx, dy);
    if (distance > h.range + r) return false;
    if (distance <= r) return true; // standing inside the victim
    if (c.halfArc >= Math.PI) return true;
    const angle = Math.abs(Math.atan2(across, along));
    return angle <= c.halfArc + Math.asin(Math.min(1, r / distance));
  }

  private hit(a: number, v: number, c: CompiledAttack, fx: number, fy: number): void {
    const sim = this.sim;
    const e = sim.entities;
    const attacker = e.idAt(a);
    const victim = e.idAt(v);
    e.lastHitBy[v] = attacker;
    e.hurtUntil[v] = sim.tick + HURT_TICKS;
    sim.bus.raise('attack-hit', attacker, victim, c.def.id);
    sim.presentation.raise('attack-hit', attacker, victim, c.def.id);
    if (c.def.feedback.hit !== undefined) sim.presentation.raise('feedback', victim, attacker, c.def.feedback.hit);
    const onHurt = e.data[v]!.feedback?.onHurt;
    if (onHurt !== undefined) sim.presentation.raise('feedback', victim, attacker, onHurt);
    // The onHit actions run with the attacker as subject and the victim as other.
    this.ctx.subject = attacker;
    this.ctx.other = victim;
    sim.executor.run(c.def.onHit, this.ctx);
    // The victim takes knockback along the attacker's facing; both take hitstop.
    const motion = e.data[v]!.motion;
    if (motion !== undefined && c.def.knockback > 0 && e.airborne[v] === 0) {
      e.vx[v] = e.vx[v]! + (fx * c.def.knockback) / motion.mass;
      e.vy[v] = e.vy[v]! + (fy * c.def.knockback) / motion.mass;
    }
    if (c.hitstopTicks > 0) {
      sim.applyHitstop(a, c.hitstopTicks);
      sim.applyHitstop(v, c.hitstopTicks);
    }
  }
}
