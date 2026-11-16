/**
 * The save boundary (spec 5.10). A save is a sparse record of what play
 * changed: it never contains authored data, and the project never contains
 * play state (law L7). Saves are not authored content, so their fields are
 * outside the reader manifest; the runtime both writes and reads them.
 *
 * Two fields go beyond the spec's listing, because the ★ save-resume test
 * (5.12) cannot pass without them; see DECISIONS_LOG "Needs E" N4:
 *   - `entityGenerations`: the entity allocator's generation per slot, so a
 *     resumed session hands out the same entity ids as the uninterrupted one
 *     (recorded click orders name entities by id).
 *   - `carriedEvents`: events still queued after the 8-round cascade cap,
 *     which the spec carries to the next tick.
 */
import { z } from 'zod';
import { SCHEMA_VERSION, VariableValueSchema } from './project.ts';
import type { ValidationIssue } from './validate.ts';

const finite = z.number();
const tick = z.int().min(0);
const entityId = z.int().min(0);

/**
 * Changed component fields of one entity. Every block is optional: a map
 * the player has left keeps only what lasts (health), the current map keeps
 * full mutable state so a resume is exact. Later chunks add blocks here.
 */
export const ComponentPatchSchema = z
  .strictObject({
    /** The runtime entity id. Present for entities on the current map and persistent entities. */
    id: entityId.optional(),
    transform: z.strictObject({ x: finite, y: finite, z: finite, facing: finite }).optional(),
    health: z
      .strictObject({
        current: finite,
        dead: z.boolean(),
        /** Health as the health step last saw it, who hit last, and the death and hurt timers (current map only). */
        seen: finite.optional(),
        lastHitBy: z.int().optional(),
        despawnAt: tick.optional(),
        hurtUntil: tick.optional(),
      })
      .optional(),
    /** Knockback velocity, hitstop, the cell region events last saw, and the previous position. */
    motion: z
      .strictObject({
        vx: finite,
        vy: finite,
        hitstop: tick,
        lastCell: z.int(),
        /** Where the entity was a tick ago: interpolation and blocked detection both read it. */
        prevX: finite,
        prevY: finite,
        prevZ: finite,
      })
      .optional(),
    /** The goal being walked to, the smoothed path, and any queued request. */
    path: z
      .strictObject({
        goalX: finite,
        goalY: finite,
        hasGoal: z.boolean(),
        pending: z.int(),
        repathAt: tick,
        blocked: tick,
        index: tick,
        waypoints: z.array(finite),
      })
      .optional(),
    brain: z
      .strictObject({
        state: z.string(),
        entered: tick,
        homeX: finite,
        homeY: finite,
        patrolIndex: tick,
        wanderAt: tick,
        attackSeq: tick,
        attackPick: z.int(),
      })
      .optional(),
    /** An attack in progress: which, its phase (1 windup, 2 active, 3 recovery), ticks left, and who it has hit. */
    attack: z.strictObject({ id: z.string(), phase: z.int().min(1).max(3), ticks: z.int(), started: tick, hits: z.array(z.int()) }).optional(),
    /** The tick each attack slot and the dodge are ready again. */
    cooldowns: z.strictObject({ attacks: z.array(tick), dodge: tick }).optional(),
    dodge: z.strictObject({ ticks: tick, x: finite, y: finite }).optional(),
    /** Active effects, in order. `status` is a status effect id, or '@iframes' / '@airborne' for the engine's own. */
    effects: z.array(z.strictObject({ status: z.string(), ticks: z.int(), stacks: z.int().min(1), source: z.int(), next: z.int() })).optional(),
    jump: z
      .strictObject({ fromX: finite, fromY: finite, fromZ: finite, toX: finite, toY: finite, toZ: finite, apex: finite, ticks: tick, total: tick, clip: z.string() })
      .optional(),
    anim: z.strictObject({ clip: z.string(), ticks: tick, frame: z.int() }).optional(),
    /** Ticks until terrain contact fires again. */
    terrain: z.strictObject({ ticks: tick }).optional(),
    target: z.strictObject({ id: z.int(), lastSeen: tick }).optional(),
    /** The player's click order. */
    order: z.strictObject({ kind: z.int().min(0).max(4), target: z.int(), x: finite, y: finite }).optional(),
  })
  .meta({ id: 'ComponentPatch' });

export const SerializedEntitySchema = z
  .strictObject({
    archetypeId: z.string(),
    state: ComponentPatchSchema,
  })
  .meta({ id: 'SerializedEntity' });

export const SavedEventSchema = z.strictObject({
  type: z.string(),
  a: z.int(),
  b: z.int(),
  s: z.string(),
  n: finite,
});

export const SaveStateSchema = z
  .strictObject({
    header: z.strictObject({
      schemaVersion: z.literal(SCHEMA_VERSION),
      projectId: z.string(),
      contentRevision: z.int().min(0),
      savedAt: z.string(),
      kind: z.literal(['manual', 'auto', 'playtest']), // playtest saves live in memory only
    }),
    rng: z.tuple([z.int(), z.int(), z.int(), z.int()]),
    tick, //                                   the one elapsed clock; Phase 14 adds skippedMs
    clockMode: z.literal(['continuous', 'stepped']),
    currentMapId: z.string(),
    variables: z.record(z.string(), VariableValueSchema), // variable id -> value; save scope only
    timers: z.array(z.strictObject({ id: z.string(), ticksLeft: tick, repeatTicks: tick.nullable() })),
    triggers: z.strictObject({ fired: z.array(z.string()), enabled: z.record(z.string(), z.boolean()) }), // once-fired and toggled
    persistent: z.array(SerializedEntitySchema), // entities with the persistent component (the player)
    maps: z.record(
      z.string(),
      z.strictObject({
        removed: z.array(z.string()), //                        placement keys gone (killed, despawned, taken)
        changed: z.record(z.string(), ComponentPatchSchema), // placement key -> changed component fields
        spawned: z.array(SerializedEntitySchema), //            runtime-spawned entities still alive
      }),
    ),
    entityGenerations: z.array(z.int().min(0).max(65535)),
    carriedEvents: z.array(SavedEventSchema),
  })
  .meta({ id: 'SaveState' });

export type SaveState = z.output<typeof SaveStateSchema>;
export type ComponentPatch = z.output<typeof ComponentPatchSchema>;
export type SerializedEntity = z.output<typeof SerializedEntitySchema>;
export type SavedEvent = z.output<typeof SavedEventSchema>;
export type SaveKind = SaveState['header']['kind'];

export type ParseSaveResult = { ok: true; save: SaveState } | { ok: false; issues: ValidationIssue[] };

/** The message a schema 1 save is rejected with. */
export const SAVE_V1_MESSAGE =
  'This save was made with LoreBrix v0.6.0 (schema 1). LoreEngine reads schema 2 saves and does not migrate older ones.';

/** Validate a JSON-decoded save. Rejects rather than repairs, like the project validator. */
export function parseSave(raw: unknown): ParseSaveResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, issues: [{ path: '', code: 'not-a-save', message: 'Not a LoreEngine save: expected a JSON object.' }] };
  }
  const header = (raw as { header?: { schemaVersion?: unknown } }).header;
  const version = header?.schemaVersion ?? (raw as { schemaVersion?: unknown }).schemaVersion;
  if (version === 1) return { ok: false, issues: [{ path: 'header.schemaVersion', code: 'schema-v1', message: SAVE_V1_MESSAGE }] };
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, issues: [{ path: 'header.schemaVersion', code: 'bad-version', message: 'Not a LoreEngine save: schemaVersion is missing or not a version number.' }] };
  }
  if (version > SCHEMA_VERSION) {
    return {
      ok: false,
      issues: [{ path: 'header.schemaVersion', code: 'newer-version', message: `This save was made with a newer LoreEngine (schema ${version}; this build reads up to ${SCHEMA_VERSION}).` }],
    };
  }
  const parsed = SaveStateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        code: `structure:${issue.code}`,
        message: issue.message,
      })),
    };
  }
  return { ok: true, save: parsed.data };
}

/** Canonical JSON text of a save (a save exports as JSON, spec 5.11). */
export function serializeSave(save: SaveState): string {
  return JSON.stringify(SaveStateSchema.parse(save));
}
