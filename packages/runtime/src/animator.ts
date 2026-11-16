/**
 * The animator (spec 7.12): tick step 10. The simulation owns animation
 * time; the renderer only draws the frame the runtime says is current.
 *
 * Clip priority: death, the scripted jump's clip, dodge, the current attack
 * phase, hurt (200 ms after a hit, when not attacking), move, idle.
 * Attack-phase clips are stretched to the phase's duration, so animation
 * always matches the authored timing. A frame change that lands on a clip
 * cue raises its presentation event. Hitstop freezes the animator.
 */
import type { AnimationSetDef, ClipDef } from '@loreengine/schema';
import { F_DEAD, PHASE_ACTIVE, PHASE_NONE, PHASE_WINDUP } from './entities.ts';
import type { Sim } from './sim.ts';
import { MS_PER_TICK } from './time.ts';

/** An entity counts as moving when it travelled further than this in the tick. */
const MOVING = 1e-4;

export class Animator {
  private readonly setById = new Map<string, AnimationSetDef>();

  constructor(private readonly sim: Sim) {
    for (const set of sim.project.animationSets) this.setById.set(set.id, set);
  }

  /** Tick step 10. */
  step(): void {
    const sim = this.sim;
    const e = sim.entities;
    const end = e.highWater;
    for (let i = 0; i < end; i++) {
      if (e.alive[i] !== 1) continue;
      const sprite = e.data[i]!.sprite;
      if (sprite === undefined) continue;
      // Hitstop: the pose holds. On the tick of the hit itself the animator still
      // steps, so what holds is the impact pose, not the frame before it.
      if (e.hitstop[i]! > 0 && e.hitstopAt[i] !== sim.tick) continue;
      const set = this.setById.get(sprite.animationSetId);
      if (set === undefined) continue;

      let name: string;
      /** For a stretched clip: how far through the phase, 0..1; otherwise -1. */
      let progress = -1;
      const phase = e.attackPhase[i]!;
      if ((e.flags[i]! & F_DEAD) !== 0) name = set.stateClips.death;
      else if (e.airborne[i] === 1 && e.jumpClip[i] !== '') name = e.jumpClip[i]!;
      else if (e.dodgeTicks[i]! > 0) name = set.stateClips.dodge;
      else if (phase !== PHASE_NONE) {
        const c = sim.combat.compiled[e.attack[i]!]!;
        const clips = c.def.clips;
        const total = phase === PHASE_WINDUP ? c.windupTicks : phase === PHASE_ACTIVE ? c.activeTicks : c.recoveryTicks;
        name = phase === PHASE_WINDUP ? clips.windup : phase === PHASE_ACTIVE ? clips.active : clips.recovery;
        progress = total > 0 ? 1 - e.attackTicks[i]! / total : 0;
      } else if (sim.tick < e.hurtUntil[i]!) name = set.stateClips.hurt;
      else if (Math.abs(e.x[i]! - e.prevX[i]!) > MOVING || Math.abs(e.y[i]! - e.prevY[i]!) > MOVING) name = set.stateClips.move;
      else name = set.stateClips.idle;

      let clip: ClipDef | undefined = set.clips[name];
      if (clip === undefined) {
        // Attack clip names are per animation set; one that is missing falls back to idle.
        name = set.stateClips.idle;
        clip = set.clips[name];
        progress = -1;
        if (clip === undefined) continue;
      }
      const frames = clip.frames[0]!.length;
      let ticks: number;
      if (e.animClip[i] !== name) {
        e.animClip[i] = name;
        e.animFrame[i] = -1; // so frame 0's cue fires
        ticks = 0;
      } else ticks = e.animTicks[i]! + 1;
      e.animTicks[i] = ticks;

      let frame: number;
      if (progress >= 0) {
        frame = Math.floor(progress * frames);
      } else {
        frame = Math.floor((ticks * MS_PER_TICK) / clip.frameMs);
        if (clip.loop) frame %= frames;
      }
      if (frame > frames - 1) frame = frames - 1;
      if (frame === e.animFrame[i]) continue;
      e.animFrame[i] = frame;
      const cues = clip.cues;
      if (cues !== undefined) {
        for (let c = 0; c < cues.length; c++) {
          if (cues[c]!.frame === frame) sim.presentation.raise('cue', e.idAt(i), -1, cues[c]!.feedbackId);
        }
      }
    }
  }
}
