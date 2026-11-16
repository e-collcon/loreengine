import { describe, expect, it } from 'vitest';
import type { AttackDef, ComponentData, Id, Project } from '@loreengine/schema';
import { HURT_TICKS, SLOWED_SCALE } from '../src/combat.ts';
import { FX_IFRAMES, PHASE_ACTIVE, PHASE_NONE, PHASE_RECOVERY, PHASE_WINDUP, RESTRICT_ATTACK, RESTRICT_DODGE, STATUS_INVULNERABLE } from '../src/entities.ts';
import { ROLE_ATTACK_PRIMARY, ROLE_ATTACK_SECONDARY, ROLE_DODGE } from '../src/index.ts';
import type { Sim } from '../src/sim.ts';
import { TERRAIN, V, addVar, cellCenter, id, indexOfKey, presented, run, runWith, stageSim, trigger } from './helpers.ts';
import type { Stage } from './helpers.ts';

const T = TERRAIN;
const HERO = { col: 6, row: 6 };
const here = cellCenter(HERO.col, HERO.row);
const PRIMARY = { pressed: ROLE_ATTACK_PRIMARY };
const SECONDARY = { pressed: ROLE_ATTACK_SECONDARY };

/** A hostile body that only stands there: 100 health, mass 1. */
const TARGET: ComponentData = { collider: { radius: 0.4, height: 1.6, solid: true }, health: { max: 100 }, motion: { mass: 1, friction: 12 } };

/** A flat stage with the hero at (6, 6) facing east and targets at offsets from the hero. */
/** For hitbox geometry: targets that do not push each other about. */
const ghosts = (s: Stage): void => {
  s.project.archetypes.find((a) => a.name === 'Target')!.components.collider = { radius: 0.4, height: 1.6, solid: false };
};

function duel(targets: Record<string, [dx: number, dy: number]>, build?: (s: Stage) => void, mutate?: (p: Project) => void): Sim {
  return stageSim(
    30,
    14,
    HERO,
    (_m, s) => {
      const hostile = s.project.factions[1]!.id;
      s.archetype('Target', { ...TARGET, faction: { factionId: hostile } }, ['target']);
      for (const [name, [dx, dy]] of Object.entries(targets)) s.place(name, 'Target', { x: here.x + dx, y: here.y + dy });
      if (build) build(s);
    },
    mutate,
  );
}
const hp = (sim: Sim, name: string): number => sim.entities.hp[indexOfKey(sim, name)]!;
/** Swap the hero's first attack for one with the given fields changed. */
const withSlash = (change: Partial<AttackDef>) => (p: Project) => {
  const slash = p.attacks.find((a) => a.name === 'slash')!;
  Object.assign(slash, change);
};
/** Run until the hero's attack is over; returns the ticks it took. */
function finish(sim: Sim, max = 200): number {
  let t = 0;
  while (sim.entities.attackPhase[0] !== PHASE_NONE && t < max) {
    run(sim, 1);
    t++;
  }
  return t;
}

describe('attacks: one state machine for the player and every enemy', () => {
  it('[P4B.attack.input] attack-primary and attack-secondary use the archetype\'s first and second attacks', () => {
    const sim = duel({ a: [1.2, 0] });
    const slash = sim.combat.indexOf(id('attack', 'slash'));
    const thrust = sim.combat.indexOf(id('attack', 'thrust'));
    runWith(sim, 1, PRIMARY);
    expect(sim.entities.attack[0]).toBe(slash);
    finish(sim);
    expect(hp(sim, 'a')).toBe(90); // slash: -10
    runWith(sim, 1, SECONDARY);
    expect(sim.entities.attack[0]).toBe(thrust);
    finish(sim);
    expect(hp(sim, 'a')).toBe(66); // thrust: -24
    // An entity with no attacker component swings nothing.
    const unarmed = duel({ a: [1.2, 0] }, undefined, (p) => void (p.archetypes[0]!.components.attacker = undefined));
    runWith(unarmed, 1, PRIMARY);
    expect(unarmed.entities.attackPhase[0]).toBe(PHASE_NONE);
  });

  it('[P4B.attack.phases] windup, active and recovery last their authored milliseconds; the telegraph fires exactly windupMs before the first active tick', () => {
    // thrust: windup 260 ms = 16 ticks, active 120 ms = 7, recovery 300 ms = 18.
    const sim = duel({});
    const e = sim.entities;
    runWith(sim, 1, SECONDARY);
    const started = sim.tick - 1;
    const windup = presented(sim).filter((x) => x.kind === 'attack-windup');
    expect(windup).toEqual([{ kind: 'attack-windup', a: e.idAt(0), b: -1, s: id('attack', 'thrust'), n: 16, tick: started }]);
    const phases: number[] = [e.attackPhase[0]!];
    for (let t = 0; t < 60; t++) {
      run(sim, 1);
      phases.push(e.attackPhase[0]!);
    }
    // phases[k] is the phase during tick started + k.
    expect(phases.indexOf(PHASE_ACTIVE)).toBe(16); // first active tick: exactly 16 ticks after the event
    expect(phases.filter((p) => p === PHASE_WINDUP)).toHaveLength(16);
    expect(phases.filter((p) => p === PHASE_ACTIVE)).toHaveLength(7);
    expect(phases.filter((p) => p === PHASE_RECOVERY)).toHaveLength(18);
    expect(phases.indexOf(PHASE_NONE)).toBe(16 + 7 + 18);
  });

  it('contact happens on the first active tick, not before', () => {
    const sim = duel({ a: [1.5, 0] });
    runWith(sim, 1, SECONDARY);
    run(sim, 15);
    expect(hp(sim, 'a')).toBe(100); // 16 ticks in: still winding up
    run(sim, 1);
    expect(hp(sim, 'a')).toBe(76);
  });

  it('[P4B.attack.cooldown] after recovery the cooldown runs before the same attack can start again', () => {
    // thrust: cooldown 600 ms = 36 ticks. slash has none.
    const sim = duel({});
    const e = sim.entities;
    runWith(sim, 1, SECONDARY);
    finish(sim);
    const ended = sim.tick;
    for (let t = 0; t < 35; t++) {
      runWith(sim, 1, SECONDARY);
      expect(e.attackPhase[0]).toBe(PHASE_NONE);
    }
    expect(sim.tick).toBe(ended + 35);
    // Another attack is not held back by thrust's cooldown.
    runWith(sim, 1, PRIMARY);
    expect(e.attackPhase[0]).toBe(PHASE_WINDUP);
    finish(sim);
    runWith(sim, 1, SECONDARY);
    expect(e.attackPhase[0]).toBe(PHASE_WINDUP);
    // slash (cooldown 0) can start again on the tick after it ends.
    finish(sim);
    runWith(sim, 1, PRIMARY);
    finish(sim);
    runWith(sim, 1, PRIMARY);
    expect(e.attackPhase[0]).toBe(PHASE_WINDUP);
  });

  it('starting needs: not attacking or dodging, not restricted from attacking, not in hitstop', () => {
    const sim = duel({});
    const e = sim.entities;
    runWith(sim, 1, PRIMARY);
    const ticks = e.attackTicks[0];
    runWith(sim, 1, SECONDARY); // already attacking
    expect(e.attack[0]).toBe(sim.combat.indexOf(id('attack', 'slash')));
    expect(e.attackTicks[0]).toBe(ticks! - 1);
    finish(sim);
    e.restrict[0] = RESTRICT_ATTACK;
    runWith(sim, 1, PRIMARY);
    expect(e.attackPhase[0]).toBe(PHASE_NONE);
    e.restrict[0] = 0;
    sim.applyHitstop(0, 5);
    runWith(sim, 1, PRIMARY);
    expect(e.attackPhase[0]).toBe(PHASE_NONE);
    run(sim, 6);
    runWith(sim, 1, { pressed: ROLE_DODGE });
    runWith(sim, 1, PRIMARY); // mid-dodge
    expect(e.attackPhase[0]).toBe(PHASE_NONE);
  });

  it('facing snaps to the aim point when the attack starts', () => {
    const sim = duel({ behind: [-1.3, 0], ahead: [1.3, 0] });
    expect(sim.entities.facing[0]).toBe(0);
    runWith(sim, 1, { ...PRIMARY, aim: { x: here.x - 4, y: here.y } });
    expect(Math.abs(sim.entities.facing[0]!)).toBeCloseTo(Math.PI, 6); // at once, not at turnRate
    finish(sim);
    expect([hp(sim, 'behind'), hp(sim, 'ahead')]).toEqual([90, 100]);
  });

  it('[P4B.attack.hitbox-arc] an arc hits within its range and half its angle of facing', () => {
    // slash: range 1.6, arc 110 degrees. Targets have radius 0.4.
    const deg = (a: number, d: number): [number, number] => [Math.cos((a * Math.PI) / 180) * d, Math.sin((a * Math.PI) / 180) * d];
    const sim = duel({
      front: deg(0, 1.5),
      edge: deg(50, 1.5), //      inside the 55 degree half-arc
      grazed: deg(68, 1.5), //    outside it, but its body reaches in
      outside: deg(95, 1.5), //   well outside
      far: deg(0, 2.2), //        beyond range even counting its radius
      behind: deg(180, 1.2),
    }, ghosts, withSlash({ hitstopMs: 0, knockback: 0 }));
    runWith(sim, 1, PRIMARY);
    finish(sim);
    expect(Object.fromEntries(['front', 'edge', 'grazed', 'outside', 'far', 'behind'].map((n) => [n, hp(sim, n)]))).toEqual({
      front: 90, edge: 90, grazed: 90, outside: 100, far: 100, behind: 100,
    });
    // arcDeg is read: a full circle catches the one behind too.
    const wide = duel({ behind: [-1.2, 0] }, undefined, withSlash({ hitbox: { shape: 'arc', range: 1.6, arcDeg: 360 } }));
    runWith(wide, 1, PRIMARY);
    finish(wide);
    expect(hp(wide, 'behind')).toBe(90);
    // range is read.
    const long = duel({ far: [2.6, 0] }, undefined, withSlash({ hitbox: { shape: 'arc', range: 2.4, arcDeg: 110 } }));
    runWith(long, 1, PRIMARY);
    finish(long);
    expect(hp(long, 'far')).toBe(90);
  });

  it('[P4B.attack.hitbox-circle] a circle hits around a point `offset` ahead', () => {
    const circle = withSlash({ hitbox: { shape: 'circle', radius: 1, offset: 2 }, hitstopMs: 0, knockback: 0 });
    const sim = duel({ center: [2, 0], rim: [2, 1.3], side: [2, 1.6], near: [0.5, 0], beyond: [3.3, 0], past: [3.6, 0] }, ghosts, circle);
    runWith(sim, 1, PRIMARY);
    finish(sim);
    expect(Object.fromEntries(['center', 'rim', 'side', 'near', 'beyond', 'past'].map((n) => [n, hp(sim, n)]))).toEqual({
      center: 90, rim: 90, side: 100, near: 100, beyond: 90, past: 100,
    });
  });

  it('[P4B.attack.hitbox-line] a line hits along facing for its length and half its width either side', () => {
    // thrust: length 2.6, width 0.7.
    const sim = duel({ close: [0.9, 0], tip: [2.9, 0], beyond: [3.2, 0], beside: [1.5, 0.7], wide: [1.5, 0.9], behind: [-0.6, 0] }, ghosts, (p) => {
      Object.assign(p.attacks.find((a) => a.name === 'thrust')!, { hitstopMs: 0, knockback: 0 });
    });
    runWith(sim, 1, SECONDARY);
    finish(sim);
    expect(Object.fromEntries(['close', 'tip', 'beyond', 'beside', 'wide', 'behind'].map((n) => [n, hp(sim, n)]))).toEqual({
      close: 76, tip: 76, beyond: 100, beside: 76, wide: 100, behind: 100,
    });
  });

  it('[P4B.attack.vertical-reach] a victim is hit only when its height range overlaps the attacker\'s feet plus or minus verticalReach', () => {
    // A level-3 ledge (1.5 units) right in front: slash reaches 1.0 up, so the one on it is safe.
    const build = (reach: number) =>
      stageSim(
        20,
        12,
        HERO,
        (m, s) => {
          m.fill({ col: 7, row: 0, w: 13, h: 12 }, T.grass, 3);
          s.archetype('Target', { ...TARGET, faction: { factionId: s.project.factions[1]!.id } });
          s.place('up', 'Target', { x: here.x + 1.4, y: here.y });
        },
        (p) => {
          withSlash({ verticalReach: reach, hitbox: { shape: 'arc', range: 3, arcDeg: 120 } })(p);
        },
      );
    const low = build(1);
    expect(low.entities.z[indexOfKey(low, 'up')]).toBe(1.5);
    runWith(low, 1, PRIMARY);
    finish(low);
    expect(hp(low, 'up')).toBe(100);
    // With more reach the blow lands: the victim stands at the ledge's rim, in plain view from below.
    const tall = build(2);
    runWith(tall, 1, PRIMARY);
    finish(tall);
    expect(hp(tall, 'up')).toBe(90);
  });

  it('no hits through cliffs or walls: the chest-to-chest ray must be clear', () => {
    const sim = stageSim(20, 12, HERO, (m, s) => {
      m.fill({ col: 7, row: 6, w: 1, h: 1 }, T.rock, 0); // a rock pillar in the next cell east
      s.archetype('Target', { ...TARGET, faction: { factionId: s.project.factions[1]!.id } });
      s.place('hidden', 'Target', { x: here.x + 2.5, y: here.y });
      s.place('open', 'Target', { x: here.x, y: here.y + 1.3 });
    }, withSlash({ hitbox: { shape: 'arc', range: 3, arcDeg: 360 } }));
    runWith(sim, 1, PRIMARY);
    finish(sim);
    expect([hp(sim, 'hidden'), hp(sim, 'open')]).toEqual([100, 90]);
  });

  it('one hit per activation: a wide arc touching one target for many ticks hits it once', () => {
    const sim = duel({ a: [1.2, 0] }, undefined, withSlash({ activeMs: 1000, hitstopMs: 0, knockback: 0 }));
    runWith(sim, 1, PRIMARY);
    finish(sim);
    expect(hp(sim, 'a')).toBe(90);
    // The next activation hits again.
    runWith(sim, 1, PRIMARY);
    finish(sim);
    expect(hp(sim, 'a')).toBe(80);
  });

  it('at most 16 victims per activation; further victims are ignored', () => {
    const targets: Record<string, [number, number]> = {};
    for (let k = 0; k < 20; k++) targets[`t${k}`] = [Math.cos(k * 0.314) * 1.2, Math.sin(k * 0.314) * 1.2];
    const sim = duel(targets, (s) => {
      s.project.archetypes.find((a) => a.name === 'Target')!.components.collider = { radius: 0.1, height: 1.6, solid: false };
    }, withSlash({ hitbox: { shape: 'arc', range: 2, arcDeg: 360 }, hitstopMs: 0 }));
    runWith(sim, 1, PRIMARY);
    finish(sim);
    const hit = Object.keys(targets).filter((n) => hp(sim, n) < 100);
    expect(hit).toHaveLength(16);
    expect(hit).toEqual(Object.keys(targets).slice(0, 16)); // in ascending entity index
  });

  it('[P4B.attack.friendly-fire] an ally is not hit unless friendlyFire is on; neutrals and hostiles are', () => {
    const build = (ff: boolean) =>
      duel({ foe: [1.2, 0.5] }, (s) => {
        const [player, , neutral] = s.project.factions.map((f) => f.id);
        s.archetype('Friend', { ...TARGET, faction: { factionId: player! } });
        s.archetype('Passerby', { ...TARGET, faction: { factionId: neutral! } });
        s.archetype('Unaligned', { ...TARGET });
        s.place('friend', 'Friend', { x: here.x + 1.2, y: here.y - 0.5 });
        s.place('passerby', 'Passerby', { x: here.x + 1.4, y: here.y });
        s.place('unaligned', 'Unaligned', { x: here.x + 0.9, y: here.y });
      }, (p) => {
        p.settings.friendlyFire = ff;
        withSlash({ hitstopMs: 0 })(p);
      });
    const off = build(false);
    runWith(off, 1, PRIMARY);
    finish(off);
    expect([hp(off, 'foe'), hp(off, 'friend'), hp(off, 'passerby'), hp(off, 'unaligned')]).toEqual([90, 100, 90, 90]);
    const on = build(true);
    runWith(on, 1, PRIMARY);
    finish(on);
    expect(hp(on, 'friend')).toBe(90);
  });

  it('[P4B.attack.knockback] the victim takes knockback along the attacker\'s facing; [P4B.knockback.motion] mass divides it and friction decays it', () => {
    const sim = duel({ light: [1.2, 0.3] }, (s) => {
      const hostile = s.project.factions[1]!.id;
      s.archetype('Heavy', { ...TARGET, motion: { mass: 4, friction: 6 }, faction: { factionId: hostile } });
      s.archetype('Fixed', { ...TARGET, motion: undefined, faction: { factionId: hostile } });
      s.place('heavy', 'Heavy', { x: here.x + 1.2, y: here.y - 0.6 });
      s.place('fixed', 'Fixed', { x: here.x + 0.9, y: here.y + 1.1 });
    }, withSlash({ knockback: 8, hitstopMs: 0, hitbox: { shape: 'arc', range: 1.8, arcDeg: 200 } }));
    const e = sim.entities;
    const [light, heavy, fixed] = ['light', 'heavy', 'fixed'].map((n) => indexOfKey(sim, n));
    const at = [light, heavy, fixed].map((i) => [e.x[i!]!, e.y[i!]!]);
    runWith(sim, 1, PRIMARY);
    run(sim, 5); // the contact tick
    // Facing is east (0): velocity is +x, strength / mass.
    expect([e.vx[light!], e.vy[light!]]).toEqual([8, 0]);
    expect([e.vx[heavy!], e.vy[heavy!]]).toEqual([2, 0]);
    expect([e.vx[fixed!], e.vy[fixed!]]).toEqual([0, 0]); // no motion component: no knockback response
    run(sim, 1);
    expect(e.vx[light!]).toBeCloseTo(8 * (1 - 12 / 60), 9); // friction 12
    expect(e.vx[heavy!]).toBeCloseTo(2 * (1 - 6 / 60), 9); //  friction 6
    run(sim, 120);
    // Roughly velocity / friction: 8 / 12 for the light one, 2 / 6 for the heavy one.
    expect(e.x[light!]! - at[0]![0]!).toBeGreaterThan(0.55);
    expect(e.x[light!]! - at[0]![0]!).toBeLessThan(0.75);
    expect(e.x[heavy!]! - at[1]![0]!).toBeGreaterThan(0.25);
    expect(e.x[heavy!]! - at[1]![0]!).toBeLessThan(0.4);
    expect(e.y[light!]).toBeCloseTo(at[0]![1]!, 6);
    expect([e.x[fixed!], e.y[fixed!]]).toEqual(at[2]);
    expect([hp(sim, 'light'), hp(sim, 'heavy'), hp(sim, 'fixed')]).toEqual([90, 90, 90]);
  });

  it('[P4B.attack.hitstop] hitstop freezes attacker and victim for exactly its ticks; effects keep ticking', () => {
    // thrust: hitstop 90 ms = 5 ticks, active 7 ticks, knockback 5.
    const sim = duel({ a: [1.5, 0] });
    const e = sim.entities;
    const a = indexOfKey(sim, 'a');
    runWith(sim, 1, SECONDARY);
    run(sim, 16); // contact happened on this tick
    expect(hp(sim, 'a')).toBe(76);
    const ticksAtContact = e.attackTicks[0]!;
    const x = e.x[a]!;
    expect(e.vx[a]).toBe(5); // knockback is waiting
    sim.effects.applyEngine(a, FX_IFRAMES, 100);
    for (let t = 1; t <= 5; t++) {
      run(sim, 1);
      expect(e.attackTicks[0], `tick ${t}`).toBe(ticksAtContact); // the attacker's timer is frozen
      expect(e.x[a], `tick ${t}`).toBe(x); // the victim does not move
      expect(e.vx[a]).toBe(5);
      expect(e.fxTicks[a * 32]).toBe(100 - t); // but its effects keep ticking
    }
    run(sim, 1); // the sixth tick: both resume
    expect(e.attackTicks[0]).toBe(ticksAtContact - 1);
    expect(e.x[a]).toBeGreaterThan(x);
    expect(e.vx[a]).toBeLessThan(5);
  });

  it('[P4B.attack.move-during] free, slowed and rooted scale movement while the attack runs', () => {
    const travel = (mode: AttackDef['moveDuring']): number => {
      const sim = duel({}, undefined, withSlash({ moveDuring: mode, windupMs: 500, activeMs: 0, recoveryMs: 0 }));
      runWith(sim, 1, { ...PRIMARY, move: { x: 1, y: 0 } });
      const x = sim.entities.x[0]!;
      runWith(sim, 20, { move: { x: 1, y: 0 } });
      return (sim.entities.x[0]! - x) / (20 * (4.5 / 60));
    };
    expect(travel('free')).toBeCloseTo(1, 9);
    expect(travel('slowed')).toBeCloseTo(SLOWED_SCALE, 9);
    expect(travel('rooted')).toBe(0);
    // And full speed returns the tick the attack ends.
    const sim = duel({}, undefined, withSlash({ moveDuring: 'rooted' }));
    runWith(sim, 1, PRIMARY);
    finish(sim);
    const x = sim.entities.x[0]!;
    runWith(sim, 1, { move: { x: 1, y: 0 } });
    expect(sim.entities.x[0]! - x).toBeCloseTo(4.5 / 60, 9);
  });

  it('[P4B.events.attack-hit] contact raises attack-hit and runs onHit with the attacker as subject and the victim as other', () => {
    const sim = duel({ a: [1.2, 0] }, undefined, (p) => {
      p.triggers.push(
        trigger({ type: 'attack-hit', attacker: { by: 'player' }, victim: { by: 'tag', tag: 'target' } }, [addVar(V.pulses, 1)], {
          given: [{ type: 'health-fraction', who: { by: 'other' }, comparator: '<', value: 1 }, { type: 'alive', who: { by: 'subject' } }],
        }),
        trigger({ type: 'attack-hit', attacker: { by: 'tag', tag: 'target' }, victim: { by: 'any' } }, [addVar(V.lucky, 1)]), // wrong way round
      );
      // onHit: hurt the victim (other) and note that the subject is the attacker.
      p.attacks.find((x) => x.name === 'slash')!.onHit.push({ type: 'modify-health', target: { by: 'subject' }, delta: -1 });
    });
    runWith(sim, 1, PRIMARY);
    finish(sim);
    run(sim, 1);
    expect([sim.variables.get(V.pulses), sim.variables.get(V.lucky)]).toEqual([1, 0]);
    expect(hp(sim, 'a')).toBe(90);
    expect(sim.entities.hp[0]).toBe(99); // the attacker was the subject
    expect(sim.entities.lastHitBy[indexOfKey(sim, 'a')]).toBe(sim.entities.idAt(0));
  });

  it('[P4B.attack.feedback-events] a hit raises the attack\'s hit feedback and the victim\'s onHurt, on the victim', () => {
    const sim = duel({ a: [1.2, 0] }, (s) => {
      s.project.archetypes.find((x) => x.name === 'Target')!.components.feedback = { onHurt: id('feedback', 'hurt') as Id<'feedback'>, onDeath: undefined };
    });
    const e = sim.entities;
    runWith(sim, 1, PRIMARY);
    finish(sim);
    const victim = e.idAt(indexOfKey(sim, 'a'));
    const events = presented(sim);
    expect(events.filter((x) => x.kind === 'attack-hit')).toEqual([{ kind: 'attack-hit', a: e.idAt(0), b: victim, s: id('attack', 'slash'), n: 0, tick: 5 }]);
    expect(events.filter((x) => x.kind === 'feedback').map((x) => [x.a, x.b, x.s])).toEqual([
      [victim, e.idAt(0), id('feedback', 'hit')], //   attack.feedback.hit
      [victim, e.idAt(0), id('feedback', 'hurt')], //  the victim's feedback.onHurt
    ]);
    expect(events.filter((x) => x.kind === 'hurt').map((x) => [x.a, x.n])).toEqual([[victim, -10]]);
    expect(e.hurtUntil[indexOfKey(sim, 'a')]).toBe(5 + HURT_TICKS);
  });
});

describe('[P4B.dodge.roll] dodge', () => {
  // The hero's dodge: 3 world units over 250 ms (15 ticks), 200 ms of i-frames (12 ticks), 700 ms cooldown (42 ticks).
  it('dashes `distance` over `durationMs` along the move input, or along facing with none', () => {
    const sim = duel({});
    const e = sim.entities;
    runWith(sim, 1, { pressed: ROLE_DODGE, move: { x: 0, y: 1 } });
    expect(e.dodgeTicks[0]).toBe(14); // 15 ticks of dash, the first already taken
    expect(e.y[0]! - here.y).toBeCloseTo(3 / 15, 9);
    run(sim, 13);
    expect(e.dodgeTicks[0]).toBe(1);
    run(sim, 1);
    expect(e.dodgeTicks[0]).toBe(0);
    expect(e.y[0]! - here.y).toBeCloseTo(3, 9);
    expect(e.x[0]).toBeCloseTo(here.x, 9);
    run(sim, 30);
    expect(e.y[0]! - here.y).toBeCloseTo(3, 9); // and no further
    // With no move input it goes along facing.
    const still = duel({});
    still.entities.facing[0] = Math.PI;
    runWith(still, 1, { pressed: ROLE_DODGE });
    run(still, 20);
    expect(still.entities.x[0]! - here.x).toBeCloseTo(-3, 9);
  });

  it('has a cooldown, is blocked by the dodge restriction, and needs the dodge component', () => {
    const sim = duel({});
    const e = sim.entities;
    runWith(sim, 1, { pressed: ROLE_DODGE });
    const started = sim.tick - 1;
    run(sim, 20);
    for (; sim.tick < started + 42; ) {
      runWith(sim, 1, { pressed: ROLE_DODGE });
      expect(e.dodgeTicks[0]).toBe(0);
    }
    runWith(sim, 1, { pressed: ROLE_DODGE });
    expect(e.dodgeTicks[0]).toBe(14);
    run(sim, 60);
    e.restrict[0] = RESTRICT_DODGE;
    runWith(sim, 1, { pressed: ROLE_DODGE });
    expect(e.dodgeTicks[0]).toBe(0);
    const none = duel({}, undefined, (p) => void (p.archetypes[0]!.components.dodge = undefined));
    runWith(none, 1, { pressed: ROLE_DODGE });
    expect(none.entities.dodgeTicks[0]).toBe(0);
  });

  it('is allowed from idle, movement and attack recovery, but not during windup or active frames', () => {
    const sim = duel({});
    const e = sim.entities;
    runWith(sim, 1, SECONDARY); // thrust: 16 windup, 7 active, 18 recovery
    runWith(sim, 1, { pressed: ROLE_DODGE });
    expect([e.attackPhase[0], e.dodgeTicks[0]]).toEqual([PHASE_WINDUP, 0]);
    run(sim, 16);
    expect(e.attackPhase[0]).toBe(PHASE_ACTIVE);
    runWith(sim, 1, { pressed: ROLE_DODGE });
    expect(e.dodgeTicks[0]).toBe(0);
    run(sim, 7);
    expect(e.attackPhase[0]).toBe(PHASE_RECOVERY);
    runWith(sim, 1, { pressed: ROLE_DODGE });
    expect(e.dodgeTicks[0]).toBe(14);
    expect(e.attackPhase[0]).toBe(PHASE_NONE); // the dodge cut the recovery short
  });

  it('collides like normal movement, so it stops at cliffs', () => {
    const sim = stageSim(20, 12, HERO, (m) => m.fill({ col: 8, row: 0, w: 12, h: 12 }, T.grass, 2));
    runWith(sim, 1, { pressed: ROLE_DODGE, move: { x: 1, y: 0 } });
    run(sim, 20);
    expect(sim.world!.level[sim.world!.cellAt(sim.entities.x[0]!, sim.entities.y[0]!)]).toBe(0);
    expect(sim.entities.x[0]! - here.x).toBeLessThan(2.3); // less than the full 3: the cliff stopped it
  });

  it('applies an engine-owned effect with the invulnerable flag for iframeMs', () => {
    const sim = duel({});
    const e = sim.entities;
    // Count the ticks on which attack contact (step 6) would find the hero invulnerable.
    let invulnerableTicks = 0;
    sim.onSlot = (slot) => {
      if (slot === 'contact' && (e.status[0]! & STATUS_INVULNERABLE) !== 0) invulnerableTicks++;
    };
    runWith(sim, 1, { pressed: ROLE_DODGE });
    expect(invulnerableTicks).toBe(1); // from the very tick the dodge starts
    run(sim, 30);
    expect(invulnerableTicks).toBe(12); // 200 ms
    expect(sim.effects.has(0, FX_IFRAMES)).toBe(false);
    expect(e.fxCount[0]).toBe(0);
  });

  it('[P4B.dodge.iframes] ★ an active window overlapping the dodge\'s i-frames makes no contact; the same swing one tick after they end does', () => {
    /**
     * A swinger whose blow becomes active `delay` ticks after the hero dodges in place.
     * Its swing: windup 10 ticks, one active tick.
     */
    const trial = (delay: number): number => {
      const sim = stageSim(30, 14, HERO, (_m, s) => {
        const hostile = s.project.factions[1]!.id;
        s.project.attacks.push({
          ...s.project.attacks.find((a) => a.name === 'stab')!,
          id: id('attack', 'test-swing') as Id<'attack'>,
          name: 'test swing',
          windupMs: 1000 / 6, //  10 ticks
          activeMs: 1000 / 60, // 1 tick
          recoveryMs: 0,
          cooldownMs: 0,
          hitbox: { shape: 'circle', radius: 6, offset: 0 }, // reaches wherever the dodge goes
          knockback: 0,
          hitstopMs: 0,
          onHit: [{ type: 'modify-health', target: { by: 'other' }, delta: -7 }],
        });
        s.archetype('Swinger', { ...TARGET, faction: { factionId: hostile }, attacker: { attackIds: [id('attack', 'test-swing') as Id<'attack'>] } });
        s.place('swinger', 'Swinger', { x: here.x + 1.5, y: here.y });
      });
      const swinger = indexOfKey(sim, 'swinger');
      const swing = sim.combat.indexOf(id('attack', 'test-swing'));
      // The swing's only active tick is 10 ticks after it starts. Start it so that
      // tick lands `delay` ticks after the dodge's first tick.
      const dodgeAt = 20;
      const startAt = dodgeAt + delay - 10;
      for (let t = 0; t < 60; t++) {
        if (t === startAt) expect(sim.combat.start(swinger, swing, sim.entities.x[0]!, sim.entities.y[0]!)).toBe(true);
        runWith(sim, 1, t === dodgeAt ? { pressed: ROLE_DODGE } : {});
      }
      return sim.entities.hp[0]!;
    };
    // The dodge's i-frames (200 ms) cover its first 12 ticks: offsets 0..11.
    for (const delay of [0, 1, 6, 11]) expect(trial(delay), `active tick ${delay} after the dodge`).toBe(100);
    // One tick after they end, the same swing connects.
    expect(trial(12)).toBe(93);
    // And one tick before the dodge it connects too.
    expect(trial(-1)).toBe(93);
  });
});
