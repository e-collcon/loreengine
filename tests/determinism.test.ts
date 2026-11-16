/**
 * ★ Replay determinism and ★ save resume (spec 5.12, law L5): the same
 * project, seed and recorded input stream produce the same state hash on
 * every run, and a save taken mid-run resumes to the identical result.
 *
 * These tests grow with the engine: as later chunks add movement, brains
 * and combat, the same 10,000-tick stream exercises them.
 */
import { describe, expect, it } from 'vitest';
import { buildEmberfall, id } from '@loreengine/fixtures';
import { createRuntime } from '@loreengine/runtime';
import type { InputFrame, Runtime, RuntimeCommand } from '@loreengine/runtime';
import { parseSave, serializeSave } from '@loreengine/schema';

const TICKS = 10_000;
const SEED = 20261117;

/** A deterministic "recorded" input stream: wandering, aiming, clicking, attacking, dodging. */
function recordStream(ticks: number, seed: number): { frames: InputFrame[]; commands: Map<number, RuntimeCommand> } {
  let s = seed >>> 0;
  const rnd = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const frames: InputFrame[] = [];
  let moveX = 0;
  let moveY = 0;
  let held = 0;
  for (let t = 0; t < ticks; t++) {
    if (rnd() < 0.03) {
      const stop = rnd() < 0.3;
      moveX = stop ? 0 : Math.round((rnd() * 2 - 1) * 127) / 127;
      moveY = stop ? 0 : Math.round((rnd() * 2 - 1) * 127) / 127;
    }
    let pressed = 0;
    if (rnd() < 0.02) pressed |= 2; // attack-primary
    if (rnd() < 0.008) pressed |= 4; // attack-secondary
    if (rnd() < 0.01) pressed |= 8; // dodge
    if (rnd() < 0.005) pressed |= 16; // interact
    let order: InputFrame['order'] = null;
    if (rnd() < 0.004) {
      pressed |= 1;
      order = { kind: 'ground', x: Math.round(rnd() * 80 * 64) / 64, y: Math.round(rnd() * 46 * 64) / 64 };
    } else if (rnd() < 0.002) {
      pressed |= 1;
      order = { kind: 'entity', entity: Math.floor(rnd() * 4) };
    }
    held = (held | pressed) & (rnd() < 0.1 ? 0 : 31);
    frames.push({
      move: { x: moveX, y: moveY },
      aim: rnd() < 0.9 ? { x: Math.round(rnd() * 80 * 64) / 64, y: Math.round(rnd() * 46 * 64) / 64 } : null,
      order,
      pressed,
      held,
    });
  }
  // Menu-style commands arrive beside the frames and must replay too.
  const pulses = id('variable', 'ember_pulses');
  const commands = new Map<number, RuntimeCommand>();
  for (const t of [100, 2500, 4999, 5000, 7777]) {
    commands.set(t, { type: 'test-actions', actions: [{ type: 'set-variable', variableId: pulses, op: { kind: 'add', value: 1000 } }] });
  }
  return { frames, commands };
}

const stream = recordStream(TICKS, 99);

function play(rt: Runtime, from: number, to: number, checkpoints?: Map<number, string>): void {
  for (let t = from; t < to; t++) {
    const command = stream.commands.get(t);
    if (command) rt.enqueue(command);
    rt.tick(stream.frames[t]!);
    if (checkpoints && (t + 1) % 1000 === 0) checkpoints.set(t + 1, rt.view.stateHash());
  }
}

describe('determinism (law L5)', () => {
  const project = buildEmberfall();
  const reference = new Map<number, string>();
  const first = createRuntime(project, null, { seed: SEED, clockMode: 'continuous' });
  play(first, 0, TICKS, reference);
  const finalHash = first.view.stateHash();

  it('★ [P2.determinism.replay] Emberfall with a recorded 10,000-tick input stream produces the same state hash on three runs', () => {
    expect(first.view.tick).toBe(TICKS);
    for (let run = 0; run < 2; run++) {
      const checkpoints = new Map<number, string>();
      const rt = createRuntime(buildEmberfall(), null, { seed: SEED, clockMode: 'continuous' });
      play(rt, 0, TICKS, checkpoints);
      expect(rt.view.stateHash()).toBe(finalHash);
      expect([...checkpoints]).toEqual([...reference]); // tick for tick, not only at the end
    }
  });

  it('the hash moves with the state: every checkpoint differs, and another seed diverges', () => {
    expect(new Set(reference.values()).size).toBe(reference.size);
    const other = createRuntime(project, null, { seed: SEED + 1, clockMode: 'continuous' });
    play(other, 0, TICKS);
    expect(other.view.stateHash()).not.toBe(finalHash);
  });

  it('the stream really exercises the simulation', () => {
    const pulses = first.view.variable(id('variable', 'ember_pulses')) as number;
    const lucky = first.view.variable(id('variable', 'lucky_pulses')) as number;
    expect(pulses).toBeGreaterThan(5000); // five commands of +1000, plus the heartbeat timer
    expect(lucky).toBeGreaterThan(10); // `chance` drew from the simulation RNG
    expect(lucky).toBeLessThan(pulses);
  });

  it('★ [P2.determinism.save-resume] saving at tick 5,000, loading, and finishing the stream yields the same final hash', () => {
    const a = createRuntime(buildEmberfall(), null, { seed: SEED, clockMode: 'continuous' });
    play(a, 0, 5000);
    expect(a.view.stateHash()).toBe(reference.get(5000));
    // Through the file format, as a real save would go.
    const parsed = parseSave(JSON.parse(serializeSave(a.snapshot({ savedAt: '2026-11-17T02:00:00.000Z', kind: 'manual' }))));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    a.dispose();
    const b = createRuntime(buildEmberfall(), parsed.save, { seed: 0, clockMode: 'continuous' });
    expect(b.view.tick).toBe(5000);
    expect(b.view.stateHash()).toBe(reference.get(5000));
    const checkpoints = new Map<number, string>();
    play(b, 5000, TICKS, checkpoints);
    expect(b.view.stateHash()).toBe(finalHash);
    for (const [tick, hash] of checkpoints) expect(hash).toBe(reference.get(tick));
  });

  it('resuming from saves taken at awkward ticks also converges', () => {
    for (const at of [1, 59, 4999, 5001]) {
      const a = createRuntime(buildEmberfall(), null, { seed: SEED, clockMode: 'continuous' });
      play(a, 0, at);
      const parsed = parseSave(JSON.parse(serializeSave(a.snapshot())));
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
      const b = createRuntime(buildEmberfall(), parsed.save, { seed: 0, clockMode: 'continuous' });
      play(b, at, 6000);
      expect(b.view.stateHash(), `resume at ${at}`).toBe(reference.get(6000));
    }
  });
});
