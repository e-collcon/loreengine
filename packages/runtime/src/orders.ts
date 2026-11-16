/**
 * Player input and click orders (spec 7.4, 7.9b, 7.10): tick step 2.
 *
 * WASD moves directly and cancels a click order. One click becomes one
 * order, which the runtime carries out over as many ticks as it takes: it
 * paths with A* to within range, re-paths when the target moves more than
 * 1 world unit, and then acts.
 *
 *   click on                         order
 *   a hostile entity with health     attack: path into range of attack-primary, face, swing
 *   an entity with `interactable`    use: path into its radius and raise `interacted`
 *   any other entity                 move next to it
 *   terrain                          move there
 *
 * One pure function, `clickAction`, decides what a click on an entity would
 * do; the client calls it on hover to choose the cursor, so the cursor
 * always tells the truth about the click.
 */
import type { AttackDef } from '@loreengine/schema';
import {
  F_DEAD,
  F_HEALTH,
  F_PLAYER,
  NO_ENTITY,
  ORDER_APPROACH,
  ORDER_ATTACK,
  ORDER_MOVE,
  ORDER_NONE,
  ORDER_USE,
  RESTRICT_ACT,
  STATUS_UNTARGETABLE,
} from './entities.ts';
import { HOSTILE } from './factions.ts';
import { ROLE_CLICK, ROLE_INTERACT } from './input.ts';
import type { Sim } from './sim.ts';

export type ClickAction = 'attack' | 'use' | 'move-to' | 'none';

/** A finite stand-in for "no point yet" (saves are JSON, which has no NaN). */
const NOWHERE = -1e9;

/** How far an attack reaches from the attacker's center. */
export function attackReach(attack: AttackDef): number {
  const h = attack.hitbox;
  return h.shape === 'arc' ? h.range : h.shape === 'circle' ? h.offset + h.radius : h.length;
}

/** The distance brains and attack orders close to before swinging: `aiRange`, or the hitbox's reach. */
export function attackRange(attack: AttackDef): number {
  return attack.aiRange ?? attackReach(attack);
}

/** What would a click by the entity at `actor` on the entity at `target` do? The first matching row wins. */
export function clickAction(sim: Sim, actor: number, target: number): ClickAction {
  const e = sim.entities;
  if (actor < 0 || target < 0 || actor === target || e.alive[target] !== 1) return 'none';
  const flags = e.flags[target]!;
  if ((flags & F_DEAD) !== 0 || (e.status[target]! & STATUS_UNTARGETABLE) !== 0) return 'none';
  if ((flags & F_HEALTH) !== 0 && sim.factions.between(e.faction[actor]!, e.faction[target]!) === HOSTILE) return 'attack';
  if (e.data[target]!.interactable !== undefined) return 'use';
  return 'move-to';
}

export class Orders {
  constructor(private readonly sim: Sim) {}

  cancel(index: number): void {
    const e = this.sim.entities;
    e.orderKind[index] = ORDER_NONE;
    e.orderTarget[index] = NO_ENTITY;
  }

  /** Tick step 2. */
  step(): void {
    const sim = this.sim;
    if (sim.world === null) return;
    const e = sim.entities;
    const input = sim.input;
    const end = e.highWater;
    for (let p = 0; p < end; p++) {
      if (e.alive[p] !== 1 || (e.flags[p]! & F_PLAYER) === 0) continue;
      if ((e.flags[p]! & F_DEAD) !== 0 || e.airborne[p] === 1) {
        // Dead, or in a scripted jump: click orders and WASD are ignored.
        this.cancel(p);
        continue;
      }

      e.aiming[p] = input.hasAim ? 1 : 0;
      if (input.hasAim) {
        e.aimX[p] = input.aimX;
        e.aimY[p] = input.aimY;
      }

      if (input.moveX !== 0 || input.moveY !== 0) {
        // WASD cancels a click order.
        this.cancel(p);
        if (sim.paths.busy(p) || e.hasGoal[p] === 1) sim.paths.clear(p);
        e.intentX[p] = input.moveX;
        e.intentY[p] = input.moveY;
      } else if (input.orderKind === 1) {
        e.orderKind[p] = ORDER_MOVE;
        e.orderTarget[p] = NO_ENTITY;
        e.orderX[p] = input.orderX;
        e.orderY[p] = input.orderY;
        sim.paths.request(p, input.orderX, input.orderY);
      } else if (input.orderKind === 2) {
        const target = e.indexOf(input.orderEntity);
        const action = clickAction(sim, p, target);
        if (action !== 'none') {
          e.orderKind[p] = action === 'attack' ? ORDER_ATTACK : action === 'use' ? ORDER_USE : ORDER_APPROACH;
          e.orderTarget[p] = input.orderEntity;
          e.orderX[p] = NOWHERE; // no path toward this target has been tried yet
          e.orderY[p] = NOWHERE;
          sim.paths.clear(p);
        }
      }

      if ((input.pressed & ROLE_INTERACT) !== 0) this.interact(p);
      // Dodge and the two attack buttons; a dodge or a swing cancels the order.
      sim.combat.playerInput(p);
      if (e.orderKind[p] !== ORDER_NONE) this.carryOut(p);
    }
  }

  /** Interact: the nearest interactable within its radius in the front half-circle. */
  private interact(p: number): void {
    const sim = this.sim;
    const e = sim.entities;
    if ((e.restrict[p]! & RESTRICT_ACT) !== 0) return;
    const fx = Math.cos(e.facing[p]!);
    const fy = Math.sin(e.facing[p]!);
    let best = -1;
    let bestD2 = Infinity;
    for (let i = 0; i < e.highWater; i++) {
      if (i === p || e.alive[i] !== 1 || (e.flags[i]! & F_DEAD) !== 0) continue;
      const interactable = e.data[i]!.interactable;
      if (interactable === undefined) continue;
      const dx = e.x[i]! - e.x[p]!;
      const dy = e.y[i]! - e.y[p]!;
      const d2 = dx * dx + dy * dy;
      if (d2 > interactable.radius * interactable.radius || dx * fx + dy * fy < 0) continue;
      if (d2 < bestD2) {
        best = i;
        bestD2 = d2;
      }
    }
    if (best >= 0) sim.bus.raise('interacted', e.idAt(p), e.idAt(best));
  }

  private carryOut(p: number): void {
    const sim = this.sim;
    const e = sim.entities;
    const kind = e.orderKind[p]!;
    if (kind === ORDER_MOVE) {
      // Done on arrival, or on stopping at the closest reachable point.
      if (!sim.paths.busy(p) && e.hasGoal[p] === 0) this.cancel(p);
      return;
    }
    const t = e.indexOf(e.orderTarget[p]!);
    // The order cancels when the target dies, becomes untargetable, or is gone.
    if (t < 0 || (e.flags[t]! & F_DEAD) !== 0 || (e.status[t]! & STATUS_UNTARGETABLE) !== 0) {
      this.cancel(p);
      sim.paths.clear(p);
      return;
    }
    const data = e.data[p]!;
    const targetData = e.data[t]!;
    const myRadius = data.collider ? data.collider.radius : 0;
    const theirRadius = targetData.collider ? targetData.collider.radius : 0;
    let range: number;
    if (kind === ORDER_ATTACK) {
      const attackId = data.attacker?.attackIds[0];
      const attack = attackId === undefined ? undefined : sim.attackById.get(attackId);
      range = attack ? attackRange(attack) + theirRadius : myRadius + theirRadius + 0.2;
    } else if (kind === ORDER_USE) {
      range = targetData.interactable!.radius;
    } else {
      range = myRadius + theirRadius + 0.2;
    }
    const dx = e.x[t]! - e.x[p]!;
    const dy = e.y[t]! - e.y[p]!;
    const distance = Math.hypot(dx, dy);

    if (distance <= range) {
      if (sim.paths.busy(p) || e.hasGoal[p] === 1) sim.paths.clear(p);
      // Face what we are about to act on.
      e.aiming[p] = 1;
      e.aimX[p] = e.x[t]!;
      e.aimY[p] = e.y[t]!;
      if (kind === ORDER_USE) {
        // The `act` restriction blocks use.
        if ((e.restrict[p]! & RESTRICT_ACT) === 0) sim.bus.raise('interacted', e.idAt(p), e.idAt(t));
        this.cancel(p);
      } else if (kind === ORDER_APPROACH) {
        this.cancel(p);
      } else {
        // Swing; the order repeats while the click button is held, and ends otherwise.
        const held = (sim.input.held & ROLE_CLICK) !== 0;
        if (sim.combat.orderAttack(p, t) && !held) this.cancel(p);
      }
      return;
    }

    // Out of range: path toward the target, and again when it has moved more than 1 world unit.
    const drift = Math.hypot(e.goalX[p]! - e.x[t]!, e.goalY[p]! - e.y[t]!);
    if (e.hasGoal[p] === 0 && !sim.paths.busy(p)) {
      if (e.orderX[p] === e.x[t] && e.orderY[p] === e.y[t]) {
        // We already walked a path toward exactly here and it stopped short: unreachable.
        this.cancel(p);
        return;
      }
      e.orderX[p] = e.x[t]!;
      e.orderY[p] = e.y[t]!;
      sim.paths.request(p, e.x[t]!, e.y[t]!);
    } else if (drift > 1 && e.pathPending[p]! < 0) {
      e.orderX[p] = e.x[t]!;
      e.orderY[p] = e.y[t]!;
      sim.paths.request(p, e.x[t]!, e.y[t]!);
    }
  }
}
