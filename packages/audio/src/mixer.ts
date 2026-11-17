/**
 * The Web Audio mixer (spec 6.10): master, music, and effects buses.
 *
 *   - Starts suspended; resumes on the first user gesture, because browsers
 *     block autoplay.
 *   - A sound not yet decoded is skipped, never awaited, so audio can never
 *     stall a frame.
 *   - At most 24 voices; the oldest is stolen.
 *   - `changeBgm` crossfades over its `fadeMs`.
 *
 * It takes an AudioContext-shaped object, so the tests drive it with a fake
 * and no browser. It reads project data and presentation requests; it never
 * touches the runtime.
 */
import type { AssetRef, PlayerPrefs, Project } from '@loreengine/schema';

export const MAX_VOICES = 24;

/** The slice of the Web Audio API the mixer uses. A real `AudioContext` satisfies it. */
export interface AudioContextLike {
  readonly state: string;
  readonly currentTime: number;
  readonly destination: unknown;
  resume(): Promise<void>;
  close?(): Promise<void>;
  createGain(): GainLike;
  createBufferSource(): SourceLike;
  decodeAudioData(data: ArrayBuffer): Promise<unknown>;
}
export interface GainLike {
  gain: { value: number; setValueAtTime?(value: number, time: number): unknown; linearRampToValueAtTime?(value: number, time: number): unknown };
  connect(destination: unknown): unknown;
  disconnect(): void;
}
export interface SourceLike {
  buffer: unknown;
  loop: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the DOM hands this an Event; a fake hands it nothing
  onended: ((event?: any) => unknown) | null;
  connect(destination: unknown): unknown;
  disconnect(): void;
  start(when?: number): void;
  stop(when?: number): void;
}

/** Resolves an asset's bytes. The client injects it; the mixer never imports `storage`. */
export type AudioResolver = (ref: AssetRef) => Promise<Uint8Array | null>;

interface Voice {
  source: SourceLike;
  gain: GainLike;
  /** When it should have ended (ms), from the asset's durationMs. */
  endsAt: number;
  ended: boolean;
}

export class AudioMixer {
  private readonly master: GainLike;
  private readonly music: GainLike;
  private readonly effects: GainLike;
  private readonly buffers = new Map<string, unknown>();
  private readonly loading = new Set<string>();
  private readonly refs = new Map<string, AssetRef>();
  private readonly voices: Voice[] = [];
  private bgm: { assetId: string; voice: Voice } | null = null;
  private pendingBgm: { assetId: string; fadeMs: number } | null = null;
  private nodes = 0;
  private disposed = false;
  /** Sounds skipped because they were not decoded yet, or the context was still suspended. */
  skipped = 0;
  /** Voices stopped early to stay within 24. */
  stolen = 0;

  constructor(
    private readonly ctx: AudioContextLike,
    project: Readonly<Project>,
    private readonly resolve: AudioResolver,
  ) {
    for (const asset of project.assets.audio) this.refs.set(asset.id, asset.ref);
    this.master = this.gain(ctx.destination);
    this.music = this.gain(this.master);
    this.effects = this.gain(this.master);
  }

  private gain(to: unknown): GainLike {
    const node = this.ctx.createGain();
    node.connect(to);
    this.nodes++;
    return node;
  }

  /** Is the context running? It stays suspended until `unlock` is called from a user gesture. */
  get running(): boolean {
    return this.ctx.state === 'running';
  }

  /** Call from the first user gesture: browsers block audio until then. */
  async unlock(): Promise<void> {
    if (this.disposed || this.running) return;
    await this.ctx.resume();
    if (this.pendingBgm) {
      const { assetId, fadeMs } = this.pendingBgm;
      this.pendingBgm = null;
      this.changeBgm(assetId, fadeMs);
    }
  }

  /** The three volumes of the player's preferences. */
  setVolumes(volumes: PlayerPrefs['volumes']): void {
    this.master.gain.value = volumes.master;
    this.music.gain.value = volumes.music;
    this.effects.gain.value = volumes.effects;
  }

  /** Fetch and decode sounds in the background. Nothing waits on this. */
  preload(assetIds: Iterable<string>): void {
    for (const id of assetIds) {
      if (this.buffers.has(id) || this.loading.has(id)) continue;
      const ref = this.refs.get(id);
      if (!ref) continue;
      this.loading.add(id);
      void this.resolve(ref)
        .then((bytes) => (bytes ? this.ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer) : null))
        .then((buffer) => {
          if (buffer && !this.disposed) this.buffers.set(id, buffer);
        })
        .catch(() => undefined)
        .finally(() => {
          this.loading.delete(id);
          if (this.pendingBgm?.assetId === id && this.running) {
            const { fadeMs } = this.pendingBgm;
            this.pendingBgm = null;
            this.changeBgm(id, fadeMs);
          }
        });
    }
  }

  isDecoded(assetId: string): boolean {
    return this.buffers.has(assetId);
  }

  /** Play a sound on the effects bus. A sound that is not decoded is skipped, never awaited. */
  play(assetId: string, volume: number): void {
    if (this.disposed) return;
    const buffer = this.buffers.get(assetId);
    if (buffer === undefined || !this.running) {
      this.skipped++;
      if (buffer === undefined) this.preload([assetId]);
      return;
    }
    this.reap();
    // At most 24 voices: the oldest is stolen. (Music is not a voice.)
    while (this.voices.length >= MAX_VOICES) {
      this.stop(this.voices.shift()!);
      this.stolen++;
    }
    this.voices.push(this.start(buffer, this.effects, volume, false, this.refs.get(assetId)?.durationMs));
  }

  /** Crossfade to another piece of music, or to silence with `null`. */
  changeBgm(assetId: string | null, fadeMs: number): void {
    if (this.disposed) return;
    if (assetId !== null && (!this.running || !this.buffers.has(assetId))) {
      // Not ready: remember it and start when the context is unlocked and the music decoded.
      this.pendingBgm = { assetId, fadeMs };
      this.preload([assetId]);
      return;
    }
    this.pendingBgm = null;
    if (this.bgm && this.bgm.assetId === assetId) return;
    const now = this.ctx.currentTime;
    const fade = Math.max(0, fadeMs) / 1000;
    const old = this.bgm;
    this.bgm = null;
    if (old) {
      old.voice.gain.gain.setValueAtTime?.(old.voice.gain.gain.value, now);
      old.voice.gain.gain.linearRampToValueAtTime?.(0, now + fade);
      old.voice.source.stop(now + fade);
      old.voice.endsAt = this.nowMs() + fadeMs;
      this.voices.push(old.voice); // reaped once its fade is over
    }
    if (assetId === null) return;
    const voice = this.start(this.buffers.get(assetId), this.music, 0, true, undefined);
    voice.gain.gain.setValueAtTime?.(0, now);
    if (voice.gain.gain.linearRampToValueAtTime) voice.gain.gain.linearRampToValueAtTime(1, now + fade);
    else voice.gain.gain.value = 1;
    this.bgm = { assetId, voice };
  }

  private nowMs(): number {
    return this.ctx.currentTime * 1000;
  }

  private start(buffer: unknown, bus: GainLike, volume: number, loop: boolean, durationMs: number | undefined): Voice {
    const gain = this.gain(bus);
    gain.gain.value = volume;
    const source = this.ctx.createBufferSource();
    this.nodes++;
    source.buffer = buffer;
    source.loop = loop;
    source.connect(gain);
    const voice: Voice = { source, gain, endsAt: loop || durationMs === undefined ? Infinity : this.nowMs() + durationMs + 50, ended: false };
    source.onended = () => {
      voice.ended = true;
    };
    source.start();
    return voice;
  }

  private stop(voice: Voice): void {
    try {
      voice.source.stop();
    } catch {
      // already stopped
    }
    voice.source.onended = null;
    voice.source.disconnect();
    voice.gain.disconnect();
    this.nodes -= 2;
  }

  /** Release voices that have finished: by their `ended` event, or by their asset's duration. */
  private reap(): void {
    const now = this.nowMs();
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const voice = this.voices[i]!;
      if (voice.ended || now >= voice.endsAt) {
        this.stop(voice);
        this.voices.splice(i, 1);
      }
    }
  }

  /** Call once a frame (cheap): releases finished voices. */
  update(): void {
    if (!this.disposed) this.reap();
  }

  get voiceCount(): number {
    return this.voices.length;
  }

  /** Audio nodes this mixer holds: the playtest leak gate compares it with a baseline (spec 9.5). */
  get nodeCount(): number {
    return this.nodes;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const voice of this.voices) this.stop(voice);
    this.voices.length = 0;
    if (this.bgm) this.stop(this.bgm.voice);
    this.bgm = null;
    for (const node of [this.effects, this.music, this.master]) {
      node.disconnect();
      this.nodes--;
    }
    this.buffers.clear();
    void this.ctx.close?.();
  }
}

/**
 * The sounds a map needs (spec 6.10): its music, and every sound its
 * archetypes' attacks and feedback reference.
 */
export function soundsForMap(project: Readonly<Project>, mapId: string): string[] {
  const out = new Set<string>();
  const map = project.maps.find((m) => m.id === mapId);
  if (!map) return [];
  if (map.bgm !== undefined) out.add(map.bgm);
  const feedback = new Map(project.feedback.map((f) => [f.id as string, f]));
  const attacks = new Map(project.attacks.map((a) => [a.id as string, a]));
  const addFeedback = (id: string | undefined): void => {
    const sfx = id === undefined ? undefined : feedback.get(id)?.sfx;
    if (sfx) out.add(sfx.assetId);
  };
  const archetypes = new Set<string>([project.settings.playerArchetypeId, ...map.placements.map((p) => p.archetypeId)]);
  for (const archetype of project.archetypes) {
    if (!archetypes.has(archetype.id)) continue;
    const c = archetype.components;
    addFeedback(c.feedback?.onHurt);
    addFeedback(c.feedback?.onDeath);
    for (const attackId of c.attacker?.attackIds ?? []) {
      const attack = attacks.get(attackId);
      addFeedback(attack?.feedback.windup);
      addFeedback(attack?.feedback.hit);
    }
  }
  return [...out];
}
