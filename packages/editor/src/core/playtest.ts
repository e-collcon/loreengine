/**
 * Playtest (spec 8.8): Play clones the project and runs a fresh runtime from
 * an ephemeral save of kind `playtest`, kept in memory. Nothing is written
 * back to the document. "Play from here" starts the player at a chosen spot.
 */
import { createRuntime, projectForStart, toRepro } from '@loreengine/runtime';
import type { Recording, ReproFile, ReproStart, Runtime } from '@loreengine/runtime';
import type { Project, SaveState } from '@loreengine/schema';

export interface PlaytestPlan {
  /** A deep copy of the document's project, with the start moved for "Play from here". */
  readonly project: Project;
  readonly seed: number;
  readonly start: ReproStart | null;
  /** The session's start, as an ephemeral `playtest` save: Restart loads it again. */
  readonly save: SaveState;
}

export function planPlaytest(source: Project, seed: number, start: ReproStart | null = null): PlaytestPlan {
  const project = projectForStart(source, start);
  const fresh = createRuntime(project, null, { seed, clockMode: 'continuous' });
  const save = fresh.snapshot({ kind: 'playtest' });
  fresh.dispose();
  return { project, seed, start, save };
}

/** A headless runtime for a plan, recording its inputs (what the playtest client runs). */
export function runPlaytest(plan: PlaytestPlan): Runtime {
  return createRuntime(plan.project, plan.save, { seed: plan.seed, clockMode: 'continuous', record: true });
}

/** The repro file for a playtest so far (spec 8.8): the revision, seed, start, and inputs. */
export function captureRepro(plan: PlaytestPlan, recording: Recording, stateHash: string): ReproFile {
  return toRepro(recording, plan.start, stateHash);
}
