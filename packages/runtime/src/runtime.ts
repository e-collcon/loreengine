/**
 * The public runtime (spec 5.3). The client drives ticks; the runtime owns
 * time. One call moves time: `tick(input)` advances exactly one 1/60 s
 * step. Wall clock, frame rate, and devices all stay outside, arriving as
 * one quantized `InputFrame` per tick.
 */
import { checkProject } from '@loreengine/schema';
import type { Project, SaveKind, SaveState } from '@loreengine/schema';
import { F_DEAD, STATUS_INVULNERABLE, WAYPOINT_STRIDE } from './entities.ts';
import { clickAction } from './orders.ts';
import { hashText } from './hash.ts';
import { quantizeInput } from './input.ts';
import type { InputFrame } from './input.ts';
import { Sim, registerCoreActions, registerWorldActions } from './sim.ts';
import type { ClockMode, RuntimeCommand, TickSlot } from './sim.ts';
import type { RuntimeView } from './view.ts';

export interface RuntimeOptions {
  /** 32-bit seed for a new session. Ignored when resuming: the save carries the RNG state. */
  seed: number;
  /** Clock mode for a new session. A resumed session keeps the save's mode. */
  clockMode: ClockMode;
  /** Keep the input frames and commands of this session, for repro files and replays. */
  record?: boolean;
  /** Test and debug hook: called as each tick slot starts. */
  onSlot?: (slot: TickSlot) => void;
}

/** A recorded session: with the project revision and seed, it replays exactly. */
export interface Recording {
  projectId: string;
  contentRevision: number;
  seed: number;
  clockMode: ClockMode;
  /** One frame per tick that advanced. */
  frames: InputFrame[];
  /** Commands, tagged with the index of the frame they were applied in. */
  commands: { frame: number; command: RuntimeCommand }[];
}

/** One hour at 60 Hz. Recording stops there with a diagnostic (law L8). */
export const MAX_RECORDED_FRAMES = 216_000;

export interface Runtime {
  /** Exactly one step; a no-op in stepped mode without pending steps, and after the session ends. */
  tick(input: InputFrame): void;
  /** UI-driven changes; applied at the start of the next tick, in enqueue order. */
  enqueue(cmd: RuntimeCommand): void;
  /** Stepped (turn-based) mode only. */
  requestSteps(n: number): void;
  /** Only between ticks. */
  snapshot(meta?: { savedAt?: string; kind?: SaveKind }): SaveState;
  /** The recording so far, when `record` was set. */
  recording(): Recording | null;
  /** Read-only; what render and audio import. */
  readonly view: RuntimeView;
  dispose(): void;
}

/** Build the internal simulation. Exposed for this package's tests; clients use `createRuntime`. */
export function createSim(project: Project, save: SaveState | null, opts: RuntimeOptions): Sim {
  const issues = checkProject(project);
  if (issues.length > 0) {
    throw new Error(`The project is not valid (${issues.length} issue(s)); first: ${issues[0]!.path}: ${issues[0]!.message}`);
  }
  const sim = new Sim(project);
  registerCoreActions(sim);
  registerWorldActions(sim);
  sim.onSlot = opts.onSlot ?? null;
  if (save) sim.restore(save);
  else sim.start(opts.seed, opts.clockMode);
  return sim;
}

const EPOCH = '1970-01-01T00:00:00.000Z';

export function createRuntime(project: Project, save: SaveState | null, opts: RuntimeOptions): Runtime {
  const sim = createSim(project, save, opts);
  const e = sim.entities;
  let inTick = false;

  const rec: Recording | null = opts.record
    ? { projectId: project.id, contentRevision: project.contentRevision, seed: opts.seed, clockMode: sim.clockMode, frames: [], commands: [] }
    : null;
  if (rec) sim.onCommand = (command) => void rec.commands.push({ frame: rec.frames.length, command });

  const view: RuntimeView = {
    project,
    get tick() {
      return sim.tick;
    },
    get clockMode() {
      return sim.clockMode;
    },
    get pendingSteps() {
      return sim.pendingSteps;
    },
    get currentMapId() {
      return sim.map ? sim.map.def.id : project.startMapId;
    },
    get outcome() {
      return sim.outcome;
    },
    entities: {
      get count() {
        return e.count;
      },
      get highWater() {
        return e.highWater;
      },
      alive: (i) => e.alive[i] === 1,
      id: (i) => e.idAt(i),
      indexOf: (id) => e.indexOf(id),
      playerIndex: () => sim.playerIndex(),
      x: (i) => e.x[i]!,
      y: (i) => e.y[i]!,
      z: (i) => e.z[i]!,
      facing: (i) => e.facing[i]!,
      prevX: (i) => e.prevX[i]!,
      prevY: (i) => e.prevY[i]!,
      prevZ: (i) => e.prevZ[i]!,
      hp: (i) => e.hp[i]!,
      hpMax: (i) => e.hpMax[i]!,
      dead: (i) => (e.flags[i]! & F_DEAD) !== 0,
      archetype: (i) => e.archetype[i]!,
      data: (i) => e.data[i]!,
      placementKey: (i) => e.placementKey[i]!,
      brainState: (i) => sim.brains.stateOf(i),
      target: (i) => e.target[i]!,
      clip: (i) => e.animClip[i]!,
      frame: (i) => e.animFrame[i]!,
      attackPhase: (i) => e.attackPhase[i]!,
      attack: (i) => e.attack[i]!,
      dodging: (i) => e.dodgeTicks[i]! > 0,
      airborne: (i) => e.airborne[i] === 1,
      hitstop: (i) => e.hitstop[i]!,
      invulnerable: (i) => (e.status[i]! & STATUS_INVULNERABLE) !== 0,
      path: (i, out) => {
        const left = e.pathCount[i]! - e.pathIndex[i]!;
        const n = Math.max(0, Math.min(left, out.length >> 1));
        const base = i * WAYPOINT_STRIDE + e.pathIndex[i]! * 2;
        for (let k = 0; k < n * 2; k++) out[k] = e.waypoints[base + k]!;
        return n;
      },
    },
    presentation: {
      get end() {
        return sim.presentation.end;
      },
      since: (cursor, visit) => sim.presentation.since(cursor, visit),
    },
    diagnostics: {
      countOf: (code) => sim.diagnostics.countOf(code),
      counters: () => sim.diagnostics.counters(),
      entries: () => sim.diagnostics.entries(),
    },
    world: {
      get loaded() {
        return sim.world !== null;
      },
      get width() {
        return sim.world ? sim.world.width : 0;
      },
      get height() {
        return sim.world ? sim.world.height : 0;
      },
      cellAt: (x, y) => (sim.world ? sim.world.cellAt(x, y) : -1),
      surfaceHeight: (x, y) => (sim.world ? sim.world.surfaceHeight(x, y) : 0),
      edgeHeight: (cell, dir) => (sim.world ? sim.world.edgeHeight(cell, dir) : 0),
      connects: (a, b, mode) => (sim.world ? sim.world.connects(a, b, mode) : false),
      level: (cell) => (sim.world ? sim.world.level[cell]! : 0),
      ramp: (cell) => (sim.world ? sim.world.ramp[cell]! : 0),
      terrain: (cell) => (sim.world ? sim.world.terrainDef[cell]! : 0),
      centerX: (cell) => (sim.world ? sim.world.centerX(cell) : 0),
      centerY: (cell) => (sim.world ? sim.world.centerY(cell) : 0),
      neighbor: (cell, dir) => (sim.world ? sim.world.neighbor[cell * 6 + dir - 1]! : -1),
      heightIn: (cell, x, y) => (sim.world ? sim.world.surfaceHeightIn(cell, x, y) : 0),
    },
    variable: (id) => sim.variables.get(id),
    clickAction: (entity) => clickAction(sim, sim.playerIndex(), e.indexOf(entity)),
    interactTarget: () => sim.orders.interactable(sim.playerIndex()),
    castSegment: (from, to, opts) => sim.sight.castSegment(from, to, opts),
    canSee: (a, b) => {
      const ia = e.indexOf(a);
      const ib = e.indexOf(b);
      return ia >= 0 && ib >= 0 && sim.sight.canSee(ia, ib);
    },
    stats: () => ({ entities: e.count, subscriptions: sim.bus.subscriptionCount, timers: sim.timers.count, queuedEvents: sim.bus.queued }),
    stateHash: () => {
      const state = sim.snapshot(EPOCH, 'playtest');
      return hashText(JSON.stringify(state) + '|' + (sim.outcome ?? ''));
    },
  };

  const alive = (): void => {
    if (sim.disposed) throw new Error('This runtime has been disposed.');
  };

  return {
    tick(input) {
      alive();
      if (inTick) throw new Error('tick() was called from inside a tick.');
      inTick = true;
      try {
        sim.input.set(input);
        const advanced = sim.step();
        if (advanced && rec) {
          if (rec.frames.length < MAX_RECORDED_FRAMES) rec.frames.push(quantizeInput(input));
          else sim.diagnostics.reportOnce('recording-full', `Recording stopped at ${MAX_RECORDED_FRAMES} frames.`);
        }
      } finally {
        inTick = false;
      }
    },
    enqueue(cmd) {
      alive();
      sim.enqueue(cmd);
    },
    requestSteps(n) {
      alive();
      if (sim.clockMode !== 'stepped') {
        sim.diagnostics.report('steps-in-continuous-mode', 'requestSteps() has no effect in continuous mode.');
        return;
      }
      if (Number.isInteger(n) && n > 0) sim.pendingSteps += n;
    },
    snapshot(meta) {
      alive();
      if (inTick) throw new Error('snapshot() is only valid between ticks.');
      return sim.snapshot(meta?.savedAt ?? EPOCH, meta?.kind ?? 'playtest');
    },
    recording() {
      return rec;
    },
    view,
    dispose() {
      sim.dispose();
    },
  };
}
