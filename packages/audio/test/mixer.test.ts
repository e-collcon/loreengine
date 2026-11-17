/** Mixer tests (spec 6.11), driven by a fake AudioContext: no browser needed. */
import { describe, expect, it } from 'vitest';
import { buildEmberfall, emberfallBlobs, id } from '@loreengine/fixtures';
import type { Project } from '@loreengine/schema';
import { AudioMixer, MAX_VOICES, soundsForMap } from '../src/index.ts';
import type { AudioContextLike, GainLike, SourceLike } from '../src/index.ts';

class FakeGain implements GainLike {
  gain = { value: 1, ramps: [] as [number, number][], setValueAtTime: () => undefined, linearRampToValueAtTime: (v: number, t: number) => void this.gain.ramps.push([v, t]) };
  connected: unknown = null;
  connect(to: unknown) {
    this.connected = to;
  }
  disconnect() {
    this.connected = null;
  }
}
class FakeSource implements SourceLike {
  buffer: unknown = null;
  loop = false;
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  connected: unknown = null;
  connect(to: unknown) {
    this.connected = to;
  }
  disconnect() {
    this.connected = null;
  }
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
}
class FakeContext implements AudioContextLike {
  state = 'suspended';
  currentTime = 0;
  destination = { name: 'speakers' };
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  decoded = 0;
  async resume() {
    this.state = 'running';
  }
  createGain() {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  async decodeAudioData(data: ArrayBuffer) {
    this.decoded++;
    return { bytes: data.byteLength };
  }
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};
function setup(): { project: Project; ctx: FakeContext; mixer: AudioMixer; hit: string; music: string } {
  const project = buildEmberfall();
  const blobs = emberfallBlobs();
  const ctx = new FakeContext();
  const mixer = new AudioMixer(ctx, project, async (ref) => blobs.get(ref.blobId)?.bytes ?? null);
  const hit = project.assets.audio.find((a) => a.name === 'sfx/hit.wav')!.id;
  const music = project.assets.audio.find((a) => a.name === 'music/emberfall.wav')!.id;
  return { project, ctx, mixer, hit, music };
}

describe('[P3C.audio.mixer] the mixer', () => {
  it('has master, music and effects buses, and applies the player\'s three volumes', () => {
    const { ctx, mixer } = setup();
    const [master, music, effects] = ctx.gains;
    expect(master!.connected).toBe(ctx.destination);
    expect([music!.connected, effects!.connected]).toEqual([master, master]);
    mixer.setVolumes({ master: 0.5, music: 0.2, effects: 0.9 });
    expect([master!.gain.value, music!.gain.value, effects!.gain.value]).toEqual([0.5, 0.2, 0.9]);
  });

  it('stays suspended until a gesture: nothing plays before unlock', async () => {
    const { ctx, mixer, hit } = setup();
    mixer.preload([hit]);
    await settle();
    expect(mixer.isDecoded(hit)).toBe(true);
    expect(mixer.running).toBe(false);
    mixer.play(hit, 1);
    expect(ctx.sources).toHaveLength(0);
    expect(mixer.skipped).toBe(1);
    await mixer.unlock();
    expect(mixer.running).toBe(true);
    mixer.play(hit, 0.7);
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0]!.started).toBe(true);
    expect(ctx.gains[ctx.gains.length - 1]!.gain.value).toBe(0.7);
  });

  it('skips a sound that is not decoded yet, never awaiting it, and has it ready next time', async () => {
    const { ctx, mixer, hit } = setup();
    await mixer.unlock();
    mixer.play(hit, 1); // not preloaded
    expect(ctx.sources).toHaveLength(0);
    expect(mixer.skipped).toBe(1);
    await settle();
    mixer.play(hit, 1);
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.decoded).toBe(1); // decoded once, however often it is asked for
    mixer.play('no-such-asset', 1);
    expect(mixer.skipped).toBe(2);
  });

  it('never exceeds 24 voices: the oldest is stolen', async () => {
    const { ctx, mixer, hit } = setup();
    await mixer.unlock();
    mixer.preload([hit]);
    await settle();
    for (let i = 0; i < 40; i++) {
      mixer.play(hit, 1);
      expect(mixer.voiceCount).toBeLessThanOrEqual(MAX_VOICES);
    }
    expect(mixer.voiceCount).toBe(24);
    expect(mixer.stolen).toBe(16);
    expect(ctx.sources.slice(0, 16).every((s) => s.stopped)).toBe(true); // the oldest ones
    expect(ctx.sources.slice(16).some((s) => s.stopped)).toBe(false);
  });

  it('releases a voice when it ends, by its event or by the asset\'s durationMs', async () => {
    const { ctx, mixer, hit } = setup();
    await mixer.unlock();
    mixer.preload([hit]);
    await settle();
    const base = mixer.nodeCount;
    mixer.play(hit, 1);
    mixer.play(hit, 1);
    expect(mixer.nodeCount).toBe(base + 4); // a source and a gain each
    ctx.sources[0]!.onended!();
    mixer.update();
    expect(mixer.voiceCount).toBe(1);
    ctx.currentTime = 0.5; // hit.wav is 120 ms long: the second is over by its duration
    mixer.update();
    expect(mixer.voiceCount).toBe(0);
    expect(mixer.nodeCount).toBe(base);
  });

  it('changeBgm crossfades over fadeMs, and waits for the gesture and the decode', async () => {
    const { ctx, mixer, music, hit } = setup();
    mixer.changeBgm(music, 800); // before unlock: remembered
    expect(ctx.sources).toHaveLength(0);
    await settle();
    await mixer.unlock();
    expect(ctx.sources).toHaveLength(1);
    const first = ctx.sources[0]!;
    expect(first.loop).toBe(true);
    const firstGain = ctx.gains[ctx.gains.length - 1]!;
    expect(firstGain.connected).toBe(ctx.gains[1]); // on the music bus
    expect(firstGain.gain.ramps).toEqual([[1, 0.8]]); // fades in over 800 ms
    mixer.changeBgm(music, 800); // the same piece: nothing happens
    expect(ctx.sources).toHaveLength(1);
    mixer.preload([hit]);
    await settle();
    ctx.currentTime = 10;
    mixer.changeBgm(hit, 500);
    expect(ctx.sources).toHaveLength(2);
    expect(firstGain.gain.ramps[1]).toEqual([0, 10.5]); // the old piece fades out as the new one fades in
    expect(first.stopped).toBe(true);
    expect(ctx.gains[ctx.gains.length - 1]!.gain.ramps).toEqual([[1, 10.5]]);
    mixer.changeBgm(null, 200);
    expect(ctx.sources[1]!.stopped).toBe(true);
    expect(mixer.voiceCount).toBeLessThanOrEqual(MAX_VOICES); // music is not a voice
  });

  it('dispose releases every node', async () => {
    const { ctx, mixer, hit, music } = setup();
    await mixer.unlock();
    mixer.preload([hit, music]);
    await settle();
    mixer.changeBgm(music, 0);
    for (let i = 0; i < 5; i++) mixer.play(hit, 1);
    expect(mixer.nodeCount).toBeGreaterThan(3);
    mixer.dispose();
    expect(mixer.nodeCount).toBe(0);
    expect(ctx.sources.every((s) => s.stopped)).toBe(true);
    mixer.play(hit, 1); // harmless afterwards
    expect(mixer.nodeCount).toBe(0);
  });

  it('soundsForMap lists the map\'s music and every sound its archetypes\' attacks and feedback reference', () => {
    const { project, hit, music } = setup();
    const sounds = soundsForMap(project, project.startMapId);
    const name = (assetId: string) => project.assets.audio.find((a) => a.id === assetId)!.name;
    expect(sounds.map(name).sort()).toEqual(['music/emberfall.wav', 'sfx/heavy.wav', 'sfx/hit.wav', 'sfx/hurt.wav']);
    expect(sounds).toContain(hit);
    expect(sounds).toContain(music);
    expect(soundsForMap(project, id('map', 'none'))).toEqual([]);
  });
});
