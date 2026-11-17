/**
 * Repro files (spec 8.8): a recorded session with the project revision,
 * seed, and inputs, as one JSON file. Replaying one against the same project
 * revision reproduces the session exactly (law L5); the determinism tests
 * read the same format.
 */
import { parseProjectJson, serializeProject } from '@loreengine/schema';
import type { Project } from '@loreengine/schema';
import type { InputFrame } from './input.ts';
import { createRuntime } from './runtime.ts';
import type { Recording, Runtime } from './runtime.ts';
import type { ClockMode, RuntimeCommand } from './sim.ts';

export const REPRO_FORMAT = 'loreengine-repro';
export const REPRO_VERSION = 1;

/** Where the player started, when a playtest began "from here" instead of the map's start. */
export interface ReproStart {
  mapId: string;
  x: number;
  y: number;
  facing: number;
}

export interface ReproFile extends Recording {
  format: typeof REPRO_FORMAT;
  version: typeof REPRO_VERSION;
  start: ReproStart | null;
  /** The state hash after the last frame, which a replay must reproduce. */
  stateHash: string;
}

/**
 * The project a session starting at `start` plays: a deep copy with the
 * start map and the player's start moved there. Without `start`, a plain copy.
 */
export function projectForStart(project: Project, start: ReproStart | null): Project {
  // A deep copy through the project file format: exact for the typed-array layers, and headless (no structuredClone).
  const parsed = parseProjectJson(serializeProject(project));
  if (!parsed.ok) throw new Error(`The project does not round-trip: ${parsed.issues[0]?.message ?? ''}`);
  const copy = parsed.project;
  if (start) {
    const map = copy.maps.find((m) => m.id === start.mapId);
    if (!map) throw new Error(`No map ${start.mapId}`);
    copy.startMapId = map.id;
    map.playerStart = { x: start.x, y: start.y, facing: start.facing };
  }
  return copy;
}

export function toRepro(recording: Recording, start: ReproStart | null, stateHash: string): ReproFile {
  return { format: REPRO_FORMAT, version: REPRO_VERSION, ...(JSON.parse(JSON.stringify(recording)) as Recording), start, stateHash };
}

export function serializeRepro(repro: ReproFile): string {
  return JSON.stringify(repro);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isMode = (v: unknown): v is ClockMode => v === 'continuous' || v === 'stepped';

function checkFrame(f: unknown, i: number): InputFrame {
  const point = (p: unknown): boolean => p === null || (isObject(p) && isNumber(p['x']) && isNumber(p['y']));
  if (!isObject(f) || !isObject(f['move']) || !point(f['move']) || !point(f['aim']) || !isNumber(f['pressed']) || !isNumber(f['held'])) {
    throw new Error(`Repro frame ${i} is malformed`);
  }
  const order = f['order'];
  if (order !== null && !(isObject(order) && (order['kind'] === 'ground' ? isNumber(order['x']) && isNumber(order['y']) : order['kind'] === 'entity' && isNumber(order['entity'])))) {
    throw new Error(`Repro frame ${i} has a malformed order`);
  }
  return f as unknown as InputFrame;
}

/** Parse and check a repro file's shape. Throws with the first problem found. */
export function parseRepro(text: string): ReproFile {
  const data: unknown = JSON.parse(text);
  if (!isObject(data) || data['format'] !== REPRO_FORMAT) throw new Error('Not a LoreEngine repro file');
  if (data['version'] !== REPRO_VERSION) throw new Error(`Repro version ${String(data['version'])} is not supported`);
  if (typeof data['projectId'] !== 'string' || !isNumber(data['contentRevision']) || !isNumber(data['seed']) || !isMode(data['clockMode'])) {
    throw new Error('Repro header is malformed');
  }
  if (!Array.isArray(data['frames']) || !Array.isArray(data['commands']) || !Array.isArray(data['clock']) || typeof data['stateHash'] !== 'string') {
    throw new Error('Repro body is malformed');
  }
  data['frames'].forEach(checkFrame);
  for (const c of data['commands'] as unknown[]) {
    if (!isObject(c) || !isNumber(c['frame']) || !isObject(c['command'])) throw new Error('Repro command is malformed');
  }
  for (const c of data['clock'] as unknown[]) {
    if (!isObject(c) || !isNumber(c['frame']) || !isMode(c['mode'])) throw new Error('Repro clock change is malformed');
  }
  const start = data['start'];
  if (start !== null && !(isObject(start) && typeof start['mapId'] === 'string' && isNumber(start['x']) && isNumber(start['y']) && isNumber(start['facing']))) {
    throw new Error('Repro start is malformed');
  }
  return data as unknown as ReproFile;
}

/**
 * Replay a repro against `project` (the revision it was recorded on) and
 * return the runtime at the end. Throws when the project or revision differs.
 */
export function replayRepro(project: Project, repro: ReproFile): Runtime {
  if (project.id !== repro.projectId) throw new Error('The repro was recorded on another project');
  if (project.contentRevision !== repro.contentRevision) {
    throw new Error(`The repro was recorded on revision ${repro.contentRevision}; this project is at ${project.contentRevision}`);
  }
  const runtime = createRuntime(projectForStart(project, repro.start), null, { seed: repro.seed, clockMode: repro.clockMode });
  const commands = new Map<number, RuntimeCommand[]>();
  for (const { frame, command } of repro.commands) {
    const list = commands.get(frame) ?? [];
    list.push(command);
    commands.set(frame, list);
  }
  let clock = 0;
  const switchClock = (frame: number): void => {
    while (clock < repro.clock.length && repro.clock[clock]!.frame === frame) runtime.setClockMode(repro.clock[clock++]!.mode);
  };
  for (let i = 0; i < repro.frames.length; i++) {
    switchClock(i);
    for (const command of commands.get(i) ?? []) runtime.enqueue(command);
    if (runtime.view.clockMode === 'stepped') runtime.requestSteps(1);
    runtime.tick(repro.frames[i]!);
  }
  switchClock(repro.frames.length);
  return runtime;
}
