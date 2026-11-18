/**
 * Presentation tests (spec 6.11): the bake, atlas lookup, animation
 * playback, the feedback system, and the occlusion check. All pure: no GPU,
 * no DOM.
 */
import { describe, expect, it } from 'vitest';
import { ELEVATION, buildElevation, buildEmberfall, cellCenter, emberfallBlobs, id, svgForFrame } from '@loreengine/fixtures';
import { ROLE_ATTACK_PRIMARY, createRuntime, emptyInput } from '@loreengine/runtime';
import type { Runtime } from '@loreengine/runtime';
import { defaultPrefs, sha256HexSync } from '@loreengine/schema';
import type { AnimationSetDef, AssetRef, AtlasDef, Id, Project } from '@loreengine/schema';
import { directionRow, nearestDirection, spriteFrame } from '../src/animation.ts';
import { AtlasIndex, pickTier } from '../src/atlas.ts';
import { MAX_PAGE, bakeAtlas, frameNameOf, packFrames, svgAnchor, svgSize } from '../src/bake.ts';
import type { BakeTools, SvgSource } from '../src/bake.ts';
import { DrawList } from '../src/drawlist.ts';
import { Feedback, MAX_PARTICLES, MAX_SHAKE } from '../src/feedback.ts';
import { DEFAULT_CAMERA_PITCH, createCamera, setCameraPitch, setProjectionRatios } from '../src/projection.ts';
import { isOccluded, silhouettes } from '../src/silhouette.ts';
import { maxSurface } from '../src/terrain.ts';

/** Bake tools that need no browser: each raster is filled with one value, pages are stored raw. */
function fakeTools(): BakeTools & { rasterized: [number, number][] } {
  const rasterized: [number, number][] = [];
  return {
    rasterized,
    rasterize: async (svg, width, height) => {
      rasterized.push([width, height]);
      return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(svg.length % 251) };
    },
    encode: async (page) => ({ bytes: new Uint8Array(page.data.buffer.slice(0)), mime: 'image/x-raw' }),
    putBlob: async (bytes, mime, extra) => ({ blobId: sha256HexSync(bytes), mime, byteSize: bytes.length, ...extra }),
  };
}
const text = (bytes: Uint8Array): string => String.fromCharCode(...bytes);
/** Emberfall's vector sources as the bake takes them. */
function emberfallSources(project: Project): SvgSource[] {
  const blobs = emberfallBlobs();
  return project.assets.vectorSources.map((a) => ({ assetId: a.id, name: a.name, svg: text(blobs.get(a.ref.blobId)!.bytes) }));
}

describe('[P3C.bake.atlas] the vector bake', () => {
  it('a frame\'s name is its path without the extension', () => {
    expect(frameNameOf('knight/attack-swing/dir2/03.svg')).toBe('knight/attack-swing/dir2/03');
    expect(frameNameOf('./hero/idle/0.SVG')).toBe('hero/idle/0');
    expect(frameNameOf('terrain\\grass.svg')).toBe('terrain/grass');
  });

  it('reads an SVG\'s size from width and height, or from its viewBox', () => {
    expect(svgSize('<svg xmlns="x" width="96" height="128" viewBox="0 0 96 128"></svg>')).toEqual({ width: 96, height: 128 });
    expect(svgSize('<svg viewBox="0 0 40 20"><rect width="999" height="999"/></svg>')).toEqual({ width: 40, height: 20 });
    expect(svgSize("<svg width='12px' height='7.5'/>")).toEqual({ width: 12, height: 7.5 });
    expect(() => svgSize('<svg><rect/></svg>')).toThrow(/width and height/);
  });

  it('reads the anchor from the element with id="anchor"; the default is bottom center', () => {
    expect(svgAnchor('<svg><circle id="anchor" cx="48" cy="118" r="0"/></svg>', 96, 128)).toEqual({ x: 48, y: 118 });
    expect(svgAnchor('<svg><rect x="5" y="9" id="anchor"/></svg>', 96, 128)).toEqual({ x: 5, y: 9 });
    expect(svgAnchor('<svg><circle id="other" cx="1" cy="2"/></svg>', 96, 128)).toEqual({ x: 48, y: 128 });
  });

  it('★ the SVG fixture produces every named frame with its authored anchor', async () => {
    const project = buildEmberfall();
    const placeholder = project.assets.atlases[0]!;
    const sources = emberfallSources(project);
    const tools = fakeTools();
    const { atlases, pages } = await bakeAtlas(placeholder.id, sources, tools);
    expect(atlases).toHaveLength(1);
    const atlas = atlases[0]!;
    expect(atlas.id).toBe(placeholder.id);
    expect(atlas.tiers.map((t) => t.scale)).toEqual([1, 2]);
    // AtlasDef.sourceIds: the vector sources the atlas was baked from.
    expect([...atlas.sourceIds].sort()).toEqual([...placeholder.sourceIds].sort());
    const wanted = Object.keys(placeholder.tiers[0]!.frames).sort();
    for (const tier of atlas.tiers) {
      // Every frame the project refers to exists, under its path's name.
      expect(Object.keys(tier.frames).sort()).toEqual(wanted);
      expect(pages.get(tier.image.blobId)).toBeDefined();
      expect(tier.image.width).toBeLessThanOrEqual(MAX_PAGE);
      // Frames do not overlap and lie inside the page.
      const rects = Object.values(tier.frames);
      for (const a of rects) {
        expect(a.x + a.w).toBeLessThanOrEqual(tier.image.width!);
        expect(a.y + a.h).toBeLessThanOrEqual(tier.image.height!);
        for (const b of rects) if (a !== b) expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
      }
    }
    // Authored anchors: a figure's feet at (48, 118) of its 96 x 128 frame; a hex top's center; scaled per tier.
    const [one, two] = atlas.tiers;
    expect(one!.frames['hero/idle/0']).toMatchObject({ w: 96, h: 128, anchorX: 48, anchorY: 118 });
    expect(two!.frames['hero/idle/0']).toMatchObject({ w: 192, h: 256, anchorX: 96, anchorY: 236 });
    expect(one!.frames['terrain/grass']).toMatchObject({ w: 112, h: 64, anchorX: 56, anchorY: 32 });
    expect(one!.frames['fx/spark']).toMatchObject({ w: 16, h: 16, anchorX: 8, anchorY: 8 });
    // Each source was rasterized once per tier, at 1x and 2x.
    expect(tools.rasterized).toHaveLength(sources.length * 2);
    expect(tools.rasterized).toContainEqual([96, 128]);
    expect(tools.rasterized).toContainEqual([192, 256]);
    // The result is a valid atlas for the project.
    project.assets.atlases[0] = atlas;
    const { checkProject } = await import('@loreengine/schema');
    expect(checkProject(project)).toEqual([]);
  });

  it('the packer opens a new page at the size limit, and never overlaps', () => {
    const sizes = Array.from({ length: 40 }, (_, i) => ({ w: 20 + (i % 5) * 7, h: 16 + (i % 3) * 9 }));
    const small = packFrames(sizes, 128);
    expect(small.pages.length).toBeGreaterThan(1);
    for (const page of small.pages) {
      expect(page.width).toBeLessThanOrEqual(128);
      expect(page.height).toBeLessThanOrEqual(128);
    }
    small.placements.forEach((a, i) => {
      expect([a.w, a.h]).toEqual([sizes[i]!.w, sizes[i]!.h]);
      for (const b of small.placements) {
        if (a === b || a.page !== b.page) continue;
        expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
      }
    });
    expect(packFrames(sizes).pages).toHaveLength(1); // 4096 x 4096 holds them all
    expect(() => packFrames([{ w: 200, h: 10 }], 128)).toThrow(/does not fit/);
  });

  it('frames that overflow one page go into a further atlas, since an atlas has one page per tier', async () => {
    const sources: SvgSource[] = Array.from({ length: 12 }, (_, i) => ({ assetId: id('asset', `s${i}`) as Id<'asset'>, name: `big/${i}.svg`, svg: '<svg width="60" height="60"/>' }));
    const { atlases } = await bakeAtlas(id('atlas', 'big') as Id<'atlas'>, sources, fakeTools(), { maxPage: 256, newId: () => id('atlas', 'big-2') });
    expect(atlases.length).toBeGreaterThan(1);
    expect(atlases[0]!.id).toBe(id('atlas', 'big'));
    expect(atlases.flatMap((a) => Object.keys(a.tiers[0]!.frames)).sort()).toEqual(sources.map((s) => frameNameOf(s.name)).sort());
    expect(atlases.flatMap((a) => a.sourceIds)).toHaveLength(12);
    await expect(bakeAtlas(id('atlas', 'dup') as Id<'atlas'>, [sources[0]!, sources[0]!], fakeTools())).rejects.toThrow(/same frame name/);
  });

  it('every generated placeholder frame is a well-formed SVG with an anchor', () => {
    for (const frame of ['terrain/grass', 'terrain/cliff', 'fx/spark', 'hero/slash-active/0', 'boss/death/2']) {
      const svg = svgForFrame(frame);
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
      expect(svg.endsWith('</svg>')).toBe(true);
      expect(svg).toContain('id="anchor"');
      expect(svgSize(svg).width).toBeGreaterThan(0);
    }
  });
});

describe('[P3C.atlas.frames] atlas lookup', () => {
  const page = (width: number, height: number): AssetRef => ({ blobId: 'a'.repeat(64), mime: 'image/png', byteSize: 1, width, height });
  const atlas: AtlasDef = {
    id: id('atlas', 't') as Id<'atlas'>,
    sourceIds: [],
    tiers: [
      { scale: 1, image: page(200, 100), frames: { a: { x: 10, y: 20, w: 50, h: 40, anchorX: 25, anchorY: 40 } } },
      { scale: 2, image: page(400, 200), frames: { a: { x: 20, y: 40, w: 100, h: 80, anchorX: 50, anchorY: 80 } } },
    ],
  };

  it('[P3C.atlas.tier] the tier used is the smallest at or above the zoom', () => {
    expect(pickTier(atlas.tiers, 0.5).scale).toBe(1);
    expect(pickTier(atlas.tiers, 1).scale).toBe(1);
    expect(pickTier(atlas.tiers, 1.01).scale).toBe(2);
    expect(pickTier(atlas.tiers, 2).scale).toBe(2);
    expect(pickTier(atlas.tiers, 3).scale).toBe(2); // none at or above: the largest
    expect(pickTier([atlas.tiers[1]!, atlas.tiers[0]!], 0.7).scale).toBe(1); // whatever their order
  });

  it('a frame carries its rectangle, its anchor, and its place on the page as fractions of the page\'s width and height', () => {
    const index = new AtlasIndex([atlas]);
    expect(index.frame(atlas.id, 'a', 1)).toMatchObject({ scale: 1, x: 10, y: 20, w: 50, h: 40, anchorX: 25, anchorY: 40, u0: 0.05, v0: 0.2, u1: 0.3, v1: 0.6 });
    expect(index.frame(atlas.id, 'a', 1.5)).toMatchObject({ scale: 2, x: 20, y: 40, w: 100, h: 80, anchorX: 50, anchorY: 80, u0: 0.05, v0: 0.2, u1: 0.3, v1: 0.6 });
    expect(index.frame(atlas.id, 'missing', 1)).toBeNull();
    expect(index.frame(id('atlas', 'none'), 'a', 1)).toBeNull();
    expect(index.has(atlas.id)).toBe(true);
  });
});

describe('animation playback', () => {
  const set = (directions: 1 | 4 | 6 | 8, mirror: boolean, rows: number): AnimationSetDef => ({
    id: id('animset', 'x') as Id<'animset'>,
    name: 'x',
    atlasId: id('atlas', 't') as Id<'atlas'>,
    directions,
    mirror,
    clips: { walk: { frames: Array.from({ length: rows }, (_, r) => [`w${r}a`, `w${r}b`, `w${r}c`]), frameMs: 100, loop: true, cues: undefined } },
    stateClips: { idle: 'walk', move: 'walk', dodge: 'walk', hurt: 'walk', death: 'walk' },
  });
  const deg = (d: number) => (d * Math.PI) / 180;

  it('[P3C.anim.direction] picks the direction nearest the facing', () => {
    expect([0, 44, 46, 90, 135, 180, 225, 270, 315, 359].map((d) => nearestDirection(4, deg(d)))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 0, 0]);
    expect([0, 22, 23, 45, 180, 337, 338].map((d) => nearestDirection(8, deg(d)))).toEqual([0, 0, 1, 1, 4, 7, 0]);
    expect([0, 31, 60, -60, 181].map((d) => nearestDirection(6, deg(d)))).toEqual([0, 1, 1, 5, 3]);
    expect(nearestDirection(1, deg(123))).toBe(0);
  });

  it('[P3C.anim.direction] with mirror on, left-facing directions are drawn from their mirror image, flipped', () => {
    // 8 directions, mirrored: rows exist for E, SE, S, N, NE (k = 0, 1, 2, 6, 7).
    const m8 = set(8, true, 5);
    expect(directionRow(m8, deg(0))).toEqual({ row: 0, flip: false }); //    E
    expect(directionRow(m8, deg(45))).toEqual({ row: 1, flip: false }); //   SE
    expect(directionRow(m8, deg(90))).toEqual({ row: 2, flip: false }); //   S
    expect(directionRow(m8, deg(135))).toEqual({ row: 1, flip: true }); //   SW = SE flipped
    expect(directionRow(m8, deg(180))).toEqual({ row: 0, flip: true }); //   W  = E flipped
    expect(directionRow(m8, deg(225))).toEqual({ row: 4, flip: true }); //   NW = NE flipped
    expect(directionRow(m8, deg(270))).toEqual({ row: 3, flip: false }); //  N
    expect(directionRow(m8, deg(315))).toEqual({ row: 4, flip: false }); //  NE
    // Without mirror every direction has its own row.
    expect(directionRow(set(8, false, 8), deg(180))).toEqual({ row: 4, flip: false });
    // One direction, mirrored: one row, flipped when facing left.
    expect(directionRow(set(1, true, 1), deg(10))).toEqual({ row: 0, flip: false });
    expect(directionRow(set(1, true, 1), deg(170))).toEqual({ row: 0, flip: true });
    expect(directionRow(set(1, false, 1), deg(170))).toEqual({ row: 0, flip: false });
  });

  it('[P3C.anim.playback] draws the atlas frame for the runtime\'s clip, frame and facing', () => {
    const s = set(4, false, 4);
    expect(spriteFrame(s, 'walk', 1, deg(90))).toEqual({ frame: 'w1b', flip: false });
    expect(spriteFrame(s, 'walk', 2, deg(180))).toEqual({ frame: 'w2c', flip: false });
    expect(spriteFrame(s, 'walk', 99, 0)).toEqual({ frame: 'w0c', flip: false }); // clamped
    expect(spriteFrame(s, 'missing', 0, 0)).toBeNull();
    expect(spriteFrame(set(4, false, 1), 'walk', 0, deg(180))).toEqual({ frame: 'w0a', flip: false }); // fewer rows: the first
    // Emberfall end to end: the animator's clip and frame name a frame of the set's atlas.
    const rt = createRuntime(buildEmberfall(), null, { seed: 1, clockMode: 'continuous' });
    const project = rt.view.project;
    const atlas = project.assets.atlases[0]!;
    const hero = project.animationSets.find((a) => a.name === 'hero')!;
    expect(hero.atlasId).toBe(atlas.id);
    const seen = new Set<string>();
    for (let t = 0; t < 120; t++) {
      rt.tick({ ...emptyInput(), move: { x: t < 60 ? -1 : 0, y: 0 }, pressed: t === 80 ? ROLE_ATTACK_PRIMARY : 0 });
      const frame = spriteFrame(hero, rt.view.entities.clip(0), rt.view.entities.frame(0), rt.view.entities.facing(0))!;
      expect(atlas.tiers[0]!.frames[frame.frame], frame.frame).toBeDefined();
      seen.add(`${frame.frame}${frame.flip ? ' flipped' : ''}`);
    }
    expect([...seen].some((f) => f.startsWith('hero/move/') && f.endsWith('flipped'))).toBe(true); // walking west
    expect([...seen].some((f) => f.startsWith('hero/slash-active/'))).toBe(true);
  });
});

describe('the feedback system', () => {
  const A = ELEVATION.terraces;
  function setup(mutate?: (p: Project) => void, prefs = defaultPrefs()): { rt: Runtime; fb: Feedback; sounds: [string, number][]; music: [string | null, number][] } {
    const p = buildEmberfall();
    if (mutate) mutate(p);
    const rt = createRuntime(p, null, { seed: 1, clockMode: 'continuous' });
    const sounds: [string, number][] = [];
    const music: [string | null, number][] = [];
    const fb = new Feedback(rt.view.project, rt.view, { prefs, audio: { play: (a, v) => void sounds.push([a, v]), changeBgm: (a, f) => void music.push([a, f]) } });
    return { rt, fb, sounds, music };
  }
  const act = (rt: Runtime, ...actions: Parameters<Runtime['enqueue']>[0]['actions']) => {
    rt.enqueue({ type: 'test-actions', actions });
    rt.tick(emptyInput());
  };
  const playOn = (rt: Runtime, name: string) => act(rt, { type: 'play-feedback', target: { by: 'player' }, feedbackId: id('feedback', name) as Id<'feedback'> });

  it('[P3C.feedback.flash] flash tints the sprite its color for its milliseconds', () => {
    const { rt, fb } = setup();
    const hero = rt.view.entities.id(0);
    expect(fb.flashOf(hero)).toBe(-1);
    playOn(rt, 'hurt'); // flash #ff4040 for 100 ms
    fb.consume(rt.view);
    expect(fb.flashOf(hero)).toBe(0xff4040);
    fb.update(99);
    expect(fb.flashOf(hero)).toBe(0xff4040);
    fb.update(2);
    expect(fb.flashOf(hero)).toBe(-1);
    expect(fb.flashOf(rt.view.entities.id(1))).toBe(-1); // only the target flashes
  });

  it('[P3C.feedback.shake] shake sums active shakes with decay, capped at 0.5 world units, scaled by the player\'s preference', () => {
    const magnitude = (fb: Feedback) => Math.hypot(fb.shakeOffsetX, fb.shakeOffsetY);
    const { rt, fb } = setup();
    playOn(rt, 'heavy-hit'); // amplitude 0.3 for 260 ms
    fb.consume(rt.view);
    fb.update(26);
    expect(magnitude(fb)).toBeCloseTo(0.3 * 0.9, 5); // decayed by a tenth
    fb.update(104);
    expect(magnitude(fb)).toBeCloseTo(0.3 * 0.5, 5);
    playOn(rt, 'heavy-hit');
    playOn(rt, 'heavy-hit');
    playOn(rt, 'heavy-hit');
    fb.consume(rt.view);
    fb.update(1);
    expect(magnitude(fb)).toBeCloseTo(MAX_SHAKE, 9); // three more would be over 1.0: capped
    fb.update(1000);
    expect(magnitude(fb)).toBe(0);
    // The player's preference: half, or off.
    for (const [pref, want] of [['half', 0.15], ['off', 0]] as const) {
      const s = setup(undefined, { ...defaultPrefs(), shake: pref });
      playOn(s.rt, 'heavy-hit');
      s.fb.consume(s.rt.view);
      s.fb.update(0.001);
      expect(magnitude(s.fb)).toBeCloseTo(want, 4);
    }
  });

  it('[P3C.feedback.particles] a feedback\'s particles burst `count` of its preset at the entity; [P3C.particles.preset] each lives by the preset', () => {
    const { rt, fb } = setup((p) => {
      Object.assign(p.particlePresets[0]!, { lifetimeMs: 400, speed: [2, 4], spreadDeg: 90, gravity: 10, scale: [0.5, 1.5], fadeOut: true });
    });
    const e = rt.view.entities;
    playOn(rt, 'hit'); // 6 sparks
    fb.consume(rt.view);
    expect(fb.particleCount).toBe(6);
    expect(fb.particleFrame(0)).toEqual(rt.view.project.particlePresets[0]!.frame);
    for (let i = 0; i < 6; i++) {
      expect([fb.px[i], fb.py[i]]).toEqual([Math.fround(e.x(0)), Math.fround(e.y(0))]);
      const speed = Math.hypot(fb.pvx[i]!, fb.pvy[i]!);
      expect(speed).toBeGreaterThanOrEqual(2 - 1e-5); //                speed: [min, max]
      expect(speed).toBeLessThanOrEqual(4 + 1e-5);
      expect(fb.pScale[i]).toBeGreaterThanOrEqual(0.5); //              scale: [min, max]
      expect(fb.pScale[i]).toBeLessThanOrEqual(1.5);
      expect(fb.particleAlpha(i)).toBe(1);
    }
    // spreadDeg: all six leave within a 90 degree fan.
    const angles = Array.from({ length: 6 }, (_, i) => Math.atan2(fb.pvy[i]!, fb.pvx[i]!));
    const mean = Math.atan2(angles.reduce((s, a) => s + Math.sin(a), 0), angles.reduce((s, a) => s + Math.cos(a), 0));
    for (const a of angles) expect(Math.abs(Math.atan2(Math.sin(a - mean), Math.cos(a - mean)))).toBeLessThanOrEqual(Math.PI / 2);
    const vz = fb.pvz[0]!;
    fb.update(100);
    expect(fb.pvz[0]).toBeCloseTo(vz - 10 * 0.1, 4); //                gravity
    expect(fb.particleAlpha(0)).toBeCloseTo(0.75, 5); //               fadeOut over lifetimeMs
    fb.update(299);
    expect(fb.particleCount).toBe(6);
    fb.update(2);
    expect(fb.particleCount).toBe(0); //                               lifetimeMs
    // fadeOut off: fully opaque until it dies.
    const solid = setup((p) => void (p.particlePresets[0]!.fadeOut = false));
    playOn(solid.rt, 'hit');
    solid.fb.consume(solid.rt.view);
    solid.fb.update(200);
    expect(solid.fb.particleAlpha(0)).toBe(1);
  });

  it('particles come from a pool of 1,024: when a burst does not fit, it is skipped, never allocated', () => {
    const { rt, fb } = setup((p) => void (p.particlePresets[0]!.lifetimeMs = 60_000));
    for (let k = 0; k < 80; k++) playOn(rt, 'death'); // 20 sparks each
    fb.consume(rt.view);
    expect(fb.particleCount).toBe(1020); // 51 bursts fit
    expect(fb.particleCount).toBeLessThanOrEqual(MAX_PARTICLES);
    expect(fb.skippedBursts).toBe(29);
    expect(fb.px.length).toBe(MAX_PARTICLES); // the pool never grew
  });

  it('[P3C.feedback.sfx] a feedback\'s sfx is sent to the mixer at its volume; play-sfx and change-bgm reach it too', () => {
    const { rt, fb, sounds, music } = setup();
    const project = rt.view.project;
    const hit = project.feedback.find((f) => f.name === 'hit')!;
    fb.consume(rt.view);
    expect(music).toEqual([]); // the map's own music was requested before this subscriber existed
    playOn(rt, 'hit');
    fb.consume(rt.view);
    expect(sounds).toEqual([[hit.sfx!.assetId, 0.7]]);
    act(rt, { type: 'play-sfx', assetId: hit.sfx!.assetId }, { type: 'change-bgm', assetId: null, fadeMs: 300 });
    fb.consume(rt.view);
    expect(sounds[1]).toEqual([hit.sfx!.assetId, 1]);
    expect(music).toEqual([[null, 300]]);
  });

  it('[P3C.feedback.ground-indicator] an attack\'s windup feedback draws the attack\'s hitbox on the ground: the telegraph', () => {
    // Give the hero's slash a telegraph (Emberfall's enemy attacks all have one).
    const { rt, fb } = setup((p) => void (p.attacks.find((a) => a.name === 'slash')!.feedback.windup = id('feedback', 'telegraph') as Id<'feedback'>));
    rt.tick({ ...emptyInput(), pressed: ROLE_ATTACK_PRIMARY });
    fb.consume(rt.view);
    expect(fb.indicators).toHaveLength(1);
    const slash = rt.view.project.attacks.find((a) => a.name === 'slash')!;
    expect(fb.indicators[0]).toMatchObject({ entity: 0, hitbox: slash.hitbox, msLeft: 900, msTotal: 900 }); // groundIndicator.ms
    fb.update(899);
    expect(fb.indicators).toHaveLength(1);
    fb.update(2);
    expect(fb.indicators).toHaveLength(0);
    // An attack with no windup feedback draws nothing.
    const plain = setup();
    plain.rt.tick({ ...emptyInput(), pressed: ROLE_ATTACK_PRIMARY });
    plain.fb.consume(plain.rt.view);
    expect(plain.fb.indicators).toHaveLength(0);
  });

  it('[P3C.anim.cues] a clip cue plays its feedback when the animator reaches its frame', () => {
    const { rt, fb, sounds } = setup((p) => {
      p.animationSets[0]!.clips['move']!.cues = [{ frame: 1, feedbackId: id('feedback', 'hurt') as Id<'feedback'> }];
    });
    for (let t = 0; t < 12; t++) rt.tick({ ...emptyInput(), move: { x: 1, y: 0 } });
    fb.consume(rt.view);
    expect(fb.flashOf(rt.view.entities.id(0))).toBe(0xff4040); // the cue's feedback, on the walking entity
    expect(sounds).toHaveLength(1);
  });

  it('never writes the runtime, and uses its own random generator', () => {
    const { rt, fb } = setup();
    playOn(rt, 'death');
    const before = rt.view.stateHash();
    for (let frame = 0; frame < 200; frame++) {
      fb.consume(rt.view);
      fb.update(16);
    }
    expect(rt.view.stateHash()).toBe(before);
  });

  it('the occlusion silhouette: a unit behind a cliff is covered; one on the plateau edge or in the open is not', () => {
    const p = buildElevation();
    const spot = (cell: { col: number; row: number }, plateauLevel = 2) => {
      const q = buildElevation();
      const m = q.maps[0]!;
      for (let row = A.plateau.row; row < A.plateau.row + A.plateau.h; row++) {
        for (let col = A.plateau.col; col < A.plateau.col + A.plateau.w; col++) m.layers.level[row * m.width + col] = plateauLevel;
      }
      const c = cellCenter(cell.col, cell.row);
      q.maps[0]!.playerStart = { x: c.x, y: c.y, facing: 0 };
      q.maps[0]!.placements = [];
      const rt = createRuntime(q, null, { seed: 1, clockMode: 'continuous' });
      const cam = createCamera(1600, 900);
      const mid = cellCenter(8, 5);
      cam.x = mid.x;
      cam.y = mid.y;
      cam.zoom = 0.75;
      const list = new DrawList();
      list.build(rt.view, cam, 1, maxSurface(rt.view.world, 0.5));
      const out = new Int32Array(8);
      return { occluded: isOccluded(rt.view, cam, list, 0), count: silhouettes(rt.view, cam, list, out), first: out[0] };
    };
    void p;
    try {
      // The spike's projection (squash 0.5, heights unscaled; D192): the level-2 plateau covers the unit right behind it.
      setProjectionRatios(0.5, 1);
      expect(spot(A.behindCliff)).toEqual({ occluded: true, count: 1, first: 0 });
      expect(spot(A.plateauEdge).occluded).toBe(false);
      expect(spot(A.playerStart)).toMatchObject({ occluded: false, count: 0 });
      // The default, steeper camera sees over that plateau (a cliff of h hides about 0.7 h behind it);
      // raised to level 6 (3 units) it covers the same unit again.
      setCameraPitch(DEFAULT_CAMERA_PITCH);
      expect(spot(A.behindCliff).occluded).toBe(false);
      expect(spot(A.behindCliff, 6)).toEqual({ occluded: true, count: 1, first: 0 });
      expect(spot(A.plateauEdge, 6).occluded).toBe(false);
      expect(spot(A.playerStart)).toMatchObject({ occluded: false, count: 0 });
    } finally {
      setCameraPitch(DEFAULT_CAMERA_PITCH);
    }
  });
});
