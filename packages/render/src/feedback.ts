/**
 * Game feel, presentation side (spec 6.9). The feedback system subscribes
 * to presentation events and plays `FeedbackDef`s:
 *
 *   attack windup starts   attack.feedback.windup; its groundIndicator
 *                          draws the attack's hitbox on the ground (the telegraph)
 *   attack hits            attack.feedback.hit on the victim, then the victim's onHurt
 *   entity dies            its onDeath
 *   clip cue, play-feedback   the named feedback
 *
 * It reads the runtime view and never writes it. Its randomness (particle
 * directions, shake) comes from its own generator, never the simulation's
 * (spec 5.8). This module is pure state: `pixi.ts` draws what it holds.
 */
import type { AttackDef, FeedbackDef, FrameRef, ParticlePresetDef, PlayerPrefs, Project } from '@loreengine/schema';
import { MS_PER_TICK } from '@loreengine/runtime/view';
import type { PresentationEvent, RuntimeView } from '@loreengine/runtime/view';

/** Live particles (spec 9.2). When the pool cannot hold a burst, the burst is skipped, never allocated. */
export const MAX_PARTICLES = 1024;
/** Summed shake never moves the camera further than this, in world units. */
export const MAX_SHAKE = 0.5;
export const MAX_INDICATORS = 16;
export const MAX_FLASHES = 64;

export interface GroundIndicator {
  /** The attacker's entity index. */
  entity: number;
  hitbox: AttackDef['hitbox'];
  msLeft: number;
  msTotal: number;
}

export interface AudioSink {
  play(assetId: string, volume: number): void;
  changeBgm(assetId: string | null, fadeMs: number): void;
}

const SHAKE_SCALE: Record<PlayerPrefs['shake'], number> = { off: 0, half: 0.5, full: 1 };

function parseColor(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}

export class Feedback {
  // Particles, struct-of-arrays in a fixed pool.
  readonly px = new Float32Array(MAX_PARTICLES);
  readonly py = new Float32Array(MAX_PARTICLES);
  readonly pz = new Float32Array(MAX_PARTICLES);
  readonly pvx = new Float32Array(MAX_PARTICLES);
  readonly pvy = new Float32Array(MAX_PARTICLES);
  readonly pvz = new Float32Array(MAX_PARTICLES);
  readonly pLife = new Float32Array(MAX_PARTICLES);
  readonly pLifetime = new Float32Array(MAX_PARTICLES);
  readonly pScale = new Float32Array(MAX_PARTICLES);
  readonly pGravity = new Float32Array(MAX_PARTICLES);
  readonly pFade = new Uint8Array(MAX_PARTICLES);
  /** Index into `presets`. */
  readonly pPreset = new Int16Array(MAX_PARTICLES);
  particleCount = 0;
  /** Bursts skipped because the pool was full. */
  skippedBursts = 0;

  readonly indicators: GroundIndicator[] = [];
  /** Presets in project order; a particle's `pPreset` indexes this. */
  readonly presets: readonly ParticlePresetDef[];

  private readonly feedbackById = new Map<string, FeedbackDef>();
  private readonly presetIndex = new Map<string, number>();
  private readonly attackById = new Map<string, AttackDef>();
  // Flashes: entity id -> color and time left.
  private readonly flashEntity = new Float64Array(MAX_FLASHES).fill(-1);
  private readonly flashColor = new Int32Array(MAX_FLASHES);
  private readonly flashMs = new Float32Array(MAX_FLASHES);
  // Shakes: amplitude and time left of each active one.
  private readonly shakeAmp = new Float32Array(32);
  private readonly shakeMs = new Float32Array(32);
  private readonly shakeTotal = new Float32Array(32);
  private shakes = 0;
  private cursor: number;
  private seed: number;
  private shakeX = 0;
  private shakeY = 0;
  prefs: PlayerPrefs;
  audio: AudioSink | null;

  constructor(project: Readonly<Project>, view: RuntimeView, options: { prefs: PlayerPrefs; audio?: AudioSink; seed?: number }) {
    for (const f of project.feedback) this.feedbackById.set(f.id, f);
    for (const a of project.attacks) this.attackById.set(a.id, a);
    this.presets = project.particlePresets;
    project.particlePresets.forEach((p, i) => this.presetIndex.set(p.id, i));
    this.prefs = options.prefs;
    this.audio = options.audio ?? null;
    this.seed = (options.seed ?? 0x9e3779b9) >>> 0;
    this.cursor = view.presentation.end;
  }

  /** The presentation generator: never the simulation's. */
  private random(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private readonly handle = (event: Readonly<PresentationEvent>): void => {
    const view = this.view!;
    switch (event.kind) {
      case 'feedback':
      case 'cue':
        this.play(event.s, event.a, event.kind === 'feedback' ? event.b : -1);
        break;
      case 'attack-windup': {
        const attack = this.attackById.get(event.s);
        if (!attack || attack.feedback.windup === undefined) break;
        const def = this.feedbackById.get(attack.feedback.windup);
        if (!def) break;
        this.play(attack.feedback.windup, event.a, -1);
        if (def.groundIndicator) {
          // The telegraph: the triggering attack's hitbox, drawn on the ground.
          const entity = view.entities.indexOf(event.a);
          if (entity >= 0 && this.indicators.length < MAX_INDICATORS) {
            const ms = Math.max(def.groundIndicator.ms, event.n * MS_PER_TICK);
            this.indicators.push({ entity, hitbox: attack.hitbox, msLeft: ms, msTotal: ms });
          }
        }
        break;
      }
      case 'sfx':
        this.audio?.play(event.s, event.n);
        break;
      case 'bgm':
        this.audio?.changeBgm(event.s === '' ? null : event.s, event.n);
        break;
      default:
        break;
    }
  };
  private view: RuntimeView | null = null;

  /** Read every presentation event raised since the last call and start its feedback. */
  consume(view: RuntimeView): void {
    this.view = view;
    this.cursor = view.presentation.since(this.cursor, this.handle);
  }

  /** Play one feedback on an entity (by id); `source` is who caused it, or -1. */
  play(feedbackId: string, entityId: number, source: number): void {
    const def = this.feedbackById.get(feedbackId);
    const view = this.view;
    if (!def || !view) return;
    if (def.flash) this.flash(entityId, parseColor(def.flash.color), def.flash.ms);
    if (def.shake && this.shakes < this.shakeAmp.length) {
      this.shakeAmp[this.shakes] = def.shake.amplitude;
      this.shakeMs[this.shakes] = def.shake.ms;
      this.shakeTotal[this.shakes] = def.shake.ms;
      this.shakes++;
    }
    if (def.particles) {
      const preset = this.presetIndex.get(def.particles.presetId);
      const at = view.entities.indexOf(entityId);
      if (preset !== undefined && at >= 0) {
        const from = view.entities.indexOf(source);
        const data = view.entities.data(at);
        const height = (data.collider ? data.collider.height : 1) * 0.6;
        // Sparks fly away from whoever caused them, when someone did.
        const away = from >= 0 ? Math.atan2(view.entities.y(at) - view.entities.y(from), view.entities.x(at) - view.entities.x(from)) : this.random() * Math.PI * 2;
        this.burst(preset, def.particles.count, view.entities.x(at), view.entities.y(at), view.entities.z(at) + height, away);
      }
    }
    if (def.sfx) this.audio?.play(def.sfx.assetId, def.sfx.volume);
  }

  private flash(entityId: number, color: number, ms: number): void {
    let slot = -1;
    for (let i = 0; i < MAX_FLASHES; i++) {
      if (this.flashEntity[i] === entityId) {
        slot = i;
        break;
      }
      if (slot < 0 && this.flashEntity[i] === -1) slot = i;
    }
    if (slot < 0) return;
    this.flashEntity[slot] = entityId;
    this.flashColor[slot] = color;
    this.flashMs[slot] = ms;
  }

  /** The flash tint on an entity right now, or -1. With the "outline" preference this is an outline color instead. */
  flashOf(entityId: number): number {
    for (let i = 0; i < MAX_FLASHES; i++) if (this.flashEntity[i] === entityId) return this.flashColor[i]!;
    return -1;
  }

  /** Emit `count` particles of a preset at a world point, around direction `toward`. Skipped whole when the pool is full. */
  burst(preset: number, count: number, x: number, y: number, z: number, toward: number): void {
    if (this.particleCount + count > MAX_PARTICLES) {
      this.skippedBursts++;
      return;
    }
    const p = this.presets[preset]!;
    const spread = (p.spreadDeg * Math.PI) / 180;
    for (let k = 0; k < count; k++) {
      const i = this.particleCount++;
      const angle = toward + (this.random() - 0.5) * spread;
      const speed = p.speed[0] + this.random() * (p.speed[1] - p.speed[0]);
      this.px[i] = x;
      this.py[i] = y;
      this.pz[i] = z;
      this.pvx[i] = Math.cos(angle) * speed;
      this.pvy[i] = Math.sin(angle) * speed;
      this.pvz[i] = speed * (0.4 + this.random() * 0.6);
      this.pLife[i] = p.lifetimeMs;
      this.pLifetime[i] = p.lifetimeMs;
      this.pScale[i] = p.scale[0] + this.random() * (p.scale[1] - p.scale[0]);
      this.pGravity[i] = p.gravity;
      this.pFade[i] = p.fadeOut ? 1 : 0;
      this.pPreset[i] = preset;
    }
  }

  /** The atlas frame a particle is drawn with. */
  particleFrame(i: number): FrameRef {
    return this.presets[this.pPreset[i]!]!.frame;
  }

  /** A particle's opacity: fading presets go from 1 to 0 over their lifetime. */
  particleAlpha(i: number): number {
    return this.pFade[i] === 1 ? Math.max(0, this.pLife[i]! / this.pLifetime[i]!) : 1;
  }

  /** Advance everything by `dtMs` of real time. */
  update(dtMs: number): void {
    const dt = dtMs / 1000;
    // Flashes.
    for (let i = 0; i < MAX_FLASHES; i++) {
      if (this.flashEntity[i] === -1) continue;
      this.flashMs[i] = this.flashMs[i]! - dtMs;
      if (this.flashMs[i]! <= 0) this.flashEntity[i] = -1;
    }
    // Shakes: sum the active ones, each decaying linearly to nothing.
    let amplitude = 0;
    let write = 0;
    for (let i = 0; i < this.shakes; i++) {
      const left = this.shakeMs[i]! - dtMs;
      if (left <= 0) continue;
      amplitude += this.shakeAmp[i]! * (left / this.shakeTotal[i]!);
      this.shakeAmp[write] = this.shakeAmp[i]!;
      this.shakeMs[write] = left;
      this.shakeTotal[write] = this.shakeTotal[i]!;
      write++;
    }
    this.shakes = write;
    amplitude *= SHAKE_SCALE[this.prefs.shake];
    if (amplitude > MAX_SHAKE) amplitude = MAX_SHAKE;
    if (amplitude > 0) {
      const angle = this.random() * Math.PI * 2;
      this.shakeX = Math.cos(angle) * amplitude;
      this.shakeY = Math.sin(angle) * amplitude;
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }
    // Particles: integrate, then compact the pool over the dead ones.
    let alive = 0;
    for (let i = 0; i < this.particleCount; i++) {
      const life = this.pLife[i]! - dtMs;
      if (life <= 0) continue;
      this.pvz[i] = this.pvz[i]! - this.pGravity[i]! * dt;
      const x = this.px[i]! + this.pvx[i]! * dt;
      const y = this.py[i]! + this.pvy[i]! * dt;
      const z = this.pz[i]! + this.pvz[i]! * dt;
      const j = alive++;
      this.px[j] = x;
      this.py[j] = y;
      this.pz[j] = z;
      this.pvx[j] = this.pvx[i]!;
      this.pvy[j] = this.pvy[i]!;
      this.pvz[j] = this.pvz[i]!;
      this.pLife[j] = life;
      this.pLifetime[j] = this.pLifetime[i]!;
      this.pScale[j] = this.pScale[i]!;
      this.pGravity[j] = this.pGravity[i]!;
      this.pFade[j] = this.pFade[i]!;
      this.pPreset[j] = this.pPreset[i]!;
    }
    this.particleCount = alive;
    // Ground indicators.
    for (let i = this.indicators.length - 1; i >= 0; i--) {
      this.indicators[i]!.msLeft -= dtMs;
      if (this.indicators[i]!.msLeft <= 0) this.indicators.splice(i, 1);
    }
  }

  /** Camera offset from the summed shakes, in world units; never beyond MAX_SHAKE. */
  get shakeOffsetX(): number {
    return this.shakeX;
  }
  get shakeOffsetY(): number {
    return this.shakeY;
  }
}
