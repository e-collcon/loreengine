/**
 * Placeholder art and sound, generated in code (kickoff §3.6): nothing
 * waits on real art. Every frame is a small SVG of simple shapes, named by
 * its path as the vector pipeline expects (spec 6.7), with its anchor on an
 * element with id="anchor". Sounds are short synthesized WAVs.
 *
 * `fixtures` may import only `schema`, so this is plain string and byte
 * building: no DOM, no canvas.
 */

export interface GeneratedAsset {
  /** The asset's path, e.g. `hero/slash-windup/1.svg`. */
  name: string;
  mime: string;
  bytes: Uint8Array;
  width?: number;
  height?: number;
  durationMs?: number;
}

const ascii = (text: string): Uint8Array => Uint8Array.from(text, (c) => c.charCodeAt(0) & 0x7f);

function hashOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* -------------------------------------------------------------------------- */
/*  Terrain                                                                   */
/* -------------------------------------------------------------------------- */

const TERRAIN: Record<string, { fill: string; mark: string; edge: string }> = {
  grass: { fill: '#6a9e4f', mark: '#4f7f3a', edge: '#4a7437' },
  dirt: { fill: '#a5855c', mark: '#8a6c47', edge: '#7c6040' },
  stone: { fill: '#8f95a0', mark: '#737986', edge: '#666c78' },
  lava: { fill: '#e0622c', mark: '#ffd166', edge: '#9c3a14' },
  water: { fill: '#3f86cc', mark: '#8fc3f2', edge: '#2c659e' },
  rock: { fill: '#5d5766', mark: '#48434f', edge: '#3c3842' },
};

/** A hex top as it lies on screen: a pointy-top hexagon in a 112 x 64 box. */
function terrainSvg(kind: string): string {
  const c = TERRAIN[kind] ?? TERRAIN['stone']!;
  const rnd = lcg(hashOf(kind));
  let marks = '';
  for (let i = 0; i < 14; i++) {
    const x = 14 + rnd() * 84;
    const y = 12 + rnd() * 40;
    if (kind === 'grass') marks += `<path d="M${x.toFixed(1)} ${y.toFixed(1)}l2 -5l2 5" stroke="${c.mark}" stroke-width="1.5" fill="none"/>`;
    else if (kind === 'water') marks += `<path d="M${x.toFixed(1)} ${y.toFixed(1)}q4 -3 8 0" stroke="${c.mark}" stroke-width="1.5" fill="none"/>`;
    else if (kind === 'lava') marks += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(1.5 + rnd() * 2.5).toFixed(1)}" fill="${c.mark}"/>`;
    else marks += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(2 + rnd() * 3).toFixed(1)}" ry="${(1 + rnd() * 1.5).toFixed(1)}" fill="${c.mark}"/>`;
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="112" height="64" viewBox="0 0 112 64">` +
    `<polygon points="56,0 112,16 112,48 56,64 0,48 0,16" fill="${c.fill}" stroke="${c.edge}" stroke-width="2"/>` +
    marks +
    `<circle id="anchor" cx="56" cy="32" r="0"/></svg>`
  );
}

function cliffSvg(): string {
  let strata = '';
  for (let y = 8; y < 64; y += 11) strata += `<path d="M0 ${y}q16 ${y % 2 ? 3 : -3} 32 0t32 0" stroke="#5c4f40" stroke-width="2" fill="none"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" fill="#7a6a58"/>${strata}<circle id="anchor" cx="32" cy="64" r="0"/></svg>`;
}

function sparkSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path d="M8 0l2 6l6 2l-6 2l-2 6l-2 -6l-6 -2l6 -2z" fill="#fff3b0" stroke="#ffb703" stroke-width="1"/><circle id="anchor" cx="8" cy="8" r="0"/></svg>`;
}

/* -------------------------------------------------------------------------- */
/*  Figures                                                                   */
/* -------------------------------------------------------------------------- */

const FIGURES: Record<string, { body: string; trim: string; weapon: string }> = {
  hero: { body: '#3d7bfd', trim: '#1d3f8f', weapon: '#e8edf5' },
  elder: { body: '#e3c35b', trim: '#8a7227', weapon: '#8a5a2b' },
  sentry: { body: '#d24a43', trim: '#7a211c', weapon: '#cfd3da' },
  boss: { body: '#8e2bd0', trim: '#4a1270', weapon: '#ffb703' },
};

/**
 * One frame of a figure facing right, in a 96 x 128 box with its feet at
 * (48, 118). `clip` and `frame` decide the pose: a lean, a bob, and where
 * the weapon is.
 */
function figureSvg(kind: string, clip: string, frame: number): string {
  const c = FIGURES[kind] ?? FIGURES['sentry']!;
  let lean = 0; //      degrees, about the feet
  let bob = 0; //       pixels up
  let squash = 1; //    vertical scale
  let weapon = 20; //   degrees from straight up, clockwise (toward the right)
  let reach = 34; //    weapon length
  let swoosh = false;
  let tint = '';
  let fade = 1;
  const phase = clip.includes('-') ? clip.slice(clip.lastIndexOf('-') + 1) : clip;
  if (clip === 'idle') bob = frame === 0 ? 0 : 2;
  else if (clip === 'move') {
    lean = 6;
    bob = frame % 2 === 0 ? 0 : 3;
    weapon = frame % 2 === 0 ? 30 : 10;
  } else if (clip === 'dodge') {
    lean = 28;
    squash = frame === 0 ? 0.8 : 0.7;
  } else if (clip === 'hurt') {
    lean = -14;
    tint = '#ffffff';
  } else if (clip === 'death') {
    lean = [-30, -62, -88][frame] ?? -88;
    fade = [1, 0.85, 0.6][frame] ?? 0.6;
  } else if (phase === 'windup') {
    lean = -8 - frame * 4;
    weapon = -40 - frame * 25;
    reach = 38;
  } else if (phase === 'active') {
    lean = 14;
    weapon = 95;
    reach = 46;
    swoosh = true;
  } else if (phase === 'recovery') {
    lean = 8 - frame * 6;
    weapon = 70 - frame * 35;
  }
  const fx = 48;
  const fy = 118;
  const bodyH = 62 * squash;
  const top = fy - bodyH - bob;
  const headY = top - 10;
  const handX = fx + 15;
  const handY = top + bodyH * 0.4;
  const rad = (weapon * Math.PI) / 180;
  const tipX = handX + Math.sin(rad) * reach;
  const tipY = handY - Math.cos(rad) * reach;
  const body = tint || c.body;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="128" viewBox="0 0 96 128">` +
    `<g opacity="${fade}" transform="rotate(${lean} ${fx} ${fy})">` +
    (swoosh ? `<path d="M${(handX + 4).toFixed(1)} ${(handY - 34).toFixed(1)}q38 12 30 46" stroke="#ffffff" stroke-opacity="0.75" stroke-width="5" fill="none" stroke-linecap="round"/>` : '') +
    `<rect x="${fx - 17}" y="${top.toFixed(1)}" width="34" height="${bodyH.toFixed(1)}" rx="13" fill="${body}" stroke="${c.trim}" stroke-width="3"/>` +
    `<circle cx="${fx}" cy="${headY.toFixed(1)}" r="14" fill="${body}" stroke="${c.trim}" stroke-width="3"/>` +
    `<circle cx="${fx + 6}" cy="${(headY - 2).toFixed(1)}" r="2.5" fill="${c.trim}"/>` +
    `<line x1="${handX}" y1="${handY.toFixed(1)}" x2="${tipX.toFixed(1)}" y2="${tipY.toFixed(1)}" stroke="${c.weapon}" stroke-width="5" stroke-linecap="round"/>` +
    `<line x1="${handX}" y1="${handY.toFixed(1)}" x2="${tipX.toFixed(1)}" y2="${tipY.toFixed(1)}" stroke="${c.trim}" stroke-width="1"/>` +
    `</g><circle id="anchor" cx="${fx}" cy="${fy}" r="0"/></svg>`
  );
}

/** The SVG source for one atlas frame name, e.g. `terrain/grass` or `hero/slash-active/0`. */
export function svgForFrame(frame: string): string {
  const parts = frame.split('/');
  if (parts[0] === 'terrain') return parts[1] === 'cliff' ? cliffSvg() : terrainSvg(parts[1] ?? 'stone');
  if (parts[0] === 'fx') return sparkSvg();
  return figureSvg(parts[0] ?? 'sentry', parts[1] ?? 'idle', Number(parts[2] ?? 0));
}

/** One generated SVG per frame name. */
export function generateArt(frames: readonly string[]): GeneratedAsset[] {
  return frames.map((frame) => {
    const svg = svgForFrame(frame);
    const width = Number(/width="(\d+)"/.exec(svg)![1]);
    const height = Number(/height="(\d+)"/.exec(svg)![1]);
    return { name: `${frame}.svg`, mime: 'image/svg+xml', bytes: ascii(svg), width, height };
  });
}

/* -------------------------------------------------------------------------- */
/*  Sound                                                                     */
/* -------------------------------------------------------------------------- */

const RATE = 22050;

/** A mono 16-bit PCM WAV from samples in -1..1. */
function wav(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i);
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, Math.round(v * 32767), true);
  }
  return bytes;
}

function tone(ms: number, fn: (t: number, k: number, noise: number) => number, seed: number): GeneratedAsset['bytes'] {
  const n = Math.round((RATE * ms) / 1000);
  const out = new Float32Array(n);
  const rnd = lcg(seed);
  for (let i = 0; i < n; i++) out[i] = fn(i / RATE, i / n, rnd() * 2 - 1);
  return wav(out);
}

/** The fixture's four sounds: a hit, a heavy hit, a hurt, and a looping music bed. */
export function generateAudio(): GeneratedAsset[] {
  const TAU = Math.PI * 2;
  const sound = (name: string, durationMs: number, bytes: Uint8Array): GeneratedAsset => ({ name, mime: 'audio/wav', bytes, durationMs });
  const notes = [220, 261.63, 329.63, 392, 329.63, 261.63, 196, 246.94]; // an A minor figure
  return [
    sound('sfx/hit.wav', 120, tone(120, (t, k, noise) => (noise * 0.6 + Math.sin(TAU * 900 * t) * 0.4) * (1 - k) ** 2, 11)),
    sound('sfx/heavy.wav', 260, tone(260, (t, k, noise) => (Math.sin(TAU * (120 - 60 * k) * t) * 0.8 + noise * 0.3) * (1 - k) ** 1.5, 12)),
    sound('sfx/hurt.wav', 140, tone(140, (t, k) => Math.sin(TAU * (520 - 260 * k) * t) * 0.6 * (1 - k), 13)),
    sound(
      'music/emberfall.wav',
      4000,
      tone(
        4000,
        (t) => {
          const step = Math.floor(t / 0.5) % notes.length;
          const local = (t % 0.5) / 0.5;
          const env = Math.min(1, local * 12) * (1 - local) ** 1.2;
          const f = notes[step]!;
          return (Math.sin(TAU * f * t) * 0.5 + Math.sin(TAU * f * 2 * t) * 0.15 + Math.sin(TAU * (f / 2) * t) * 0.25) * env * 0.5;
        },
        14,
      ),
    ),
  ];
}
