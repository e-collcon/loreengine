/**
 * Scripted jumps (spec 7.9c). There is no jump button: jumping happens
 * only when authored content says so, through the `scripted-jump` action.
 *
 * The target leaves the ground on a parabola from where it stands to `to`,
 * peaking `apex` world units above the higher end, over `durationMs`. In
 * flight it ignores cliffs, blocked edges, and collisions, so it can cross
 * what walking cannot. It lands on the surface height at `to` and raises
 * `jump-landed`. While airborne it carries an engine-owned effect with the
 * invulnerable flag and every restriction, the same mechanism as dodge
 * i-frames.
 */
import { F_DEAD, FX_AIRBORNE, NO_ENTITY } from './entities.ts';
import type { Sim } from './sim.ts';
import { msToTicks } from './time.ts';
import { MODE_WALK } from './world.ts';

export class Jumps {
  constructor(private readonly sim: Sim) {}

  /** Start a jump. Fails, moving nothing, when the landing is not on a walk-passable cell. */
  start(index: number, toX: number, toY: number, durationMs: number, apex: number, clip: string): boolean {
    const sim = this.sim;
    const e = sim.entities;
    const world = sim.world;
    if (world === null || (e.flags[index]! & F_DEAD) !== 0 || e.airborne[index] === 1) return false;
    if (!world.passable(world.cellAt(toX, toY), MODE_WALK)) {
      sim.diagnostics.report('jump-landing-impassable', `A scripted jump to (${toX}, ${toY}) was refused: the landing is not walkable.`);
      return false;
    }
    sim.combat.cancel(index);
    e.dodgeTicks[index] = 0;
    e.dashX[index] = 0;
    e.dashY[index] = 0;
    e.vx[index] = 0;
    e.vy[index] = 0;
    sim.paths.clear(index);
    sim.orders.cancel(index);
    e.airborne[index] = 1;
    e.jumpFromX[index] = e.x[index]!;
    e.jumpFromY[index] = e.y[index]!;
    e.jumpFromZ[index] = e.z[index]!;
    e.jumpToX[index] = toX;
    e.jumpToY[index] = toY;
    e.jumpToZ[index] = world.surfaceHeight(toX, toY);
    e.jumpApex[index] = apex;
    e.jumpTotal[index] = Math.max(1, msToTicks(durationMs));
    e.jumpTicks[index] = 0;
    e.jumpClip[index] = clip;
    sim.effects.applyEngine(index, FX_AIRBORNE, -1); // until it lands
    return true;
  }

  /** Part of tick step 5, before movement: carry airborne entities along their arcs. */
  step(): void {
    const sim = this.sim;
    const e = sim.entities;
    const end = e.highWater;
    for (let i = 0; i < end; i++) {
      if (e.alive[i] !== 1 || e.airborne[i] !== 1) continue;
      e.prevX[i] = e.x[i]!;
      e.prevY[i] = e.y[i]!;
      e.prevZ[i] = e.z[i]!;
      const total = e.jumpTotal[i]!;
      const ticks = (e.jumpTicks[i] = e.jumpTicks[i]! + 1);
      if (ticks >= total) {
        // It lands exactly on the surface at `to`.
        e.x[i] = e.jumpToX[i]!;
        e.y[i] = e.jumpToY[i]!;
        e.z[i] = e.jumpToZ[i]!;
        e.airborne[i] = 0;
        e.jumpClip[i] = '';
        sim.effects.remove(i, FX_AIRBORNE);
        sim.bus.raise('jump-landed', e.idAt(i), NO_ENTITY);
        continue;
      }
      const t = ticks / total;
      const z0 = e.jumpFromZ[i]!;
      const z1 = e.jumpToZ[i]!;
      // A parabola whose midpoint is `apex` above the higher end.
      const lift = e.jumpApex[i]! + Math.max(z0, z1) - (z0 + z1) / 2;
      e.x[i] = e.jumpFromX[i]! + (e.jumpToX[i]! - e.jumpFromX[i]!) * t;
      e.y[i] = e.jumpFromY[i]! + (e.jumpToY[i]! - e.jumpFromY[i]!) * t;
      e.z[i] = z0 + (z1 - z0) * t + 4 * lift * t * (1 - t);
    }
  }
}

/** `scripted-jump`: the only way anything jumps (Q7). */
export function registerJumpActions(sim: Sim): void {
  const buffer = new Int32Array(sim.entities.capacity);
  sim.executor.register('scripted-jump', (a, ctx) => {
    const n = sim.matcher.resolve(a.target, ctx, buffer);
    for (let k = 0; k < n; k++) sim.jumps.start(buffer[k]!, a.to.x, a.to.y, a.durationMs, a.apex, a.clip ?? '');
  });
}
