/**
 * ============================================================================
 *  LoreEngine — THE SCHEMA SOURCE (law L4: a human-gated hot file)
 * ============================================================================
 *  This file changes only with E's approval. Every authored type and every
 *  structural validator is derived from the Zod schemas below; nothing
 *  re-declares them by hand. It implements docs/FOUNDATION_DESIGN.md §4.5.
 *
 *  Rules for editing (L3):
 *    - Adding an optional field or a new top-level collection is a MINOR
 *      revision: bump SCHEMA_MINOR.
 *    - Changing an existing shape is a MAJOR revision: bump SCHEMA_VERSION
 *      and add an explicit rejection or migration in validate.ts.
 *    - Every leaf field needs an entry in readers.ts (the reader manifest),
 *      or the reader-coverage test fails.
 *
 *  Conventions:
 *    - Every object is strict: unknown keys are rejected, never dropped.
 *    - There are no schema-level defaults. The validator rejects rather than
 *      repairs, so a file always states every required field. The defaults
 *      named in the spec are applied when content is CREATED (defaults.ts).
 *    - Packed layers are typed arrays in memory and base64 strings in files;
 *      the codecs below convert at the file boundary.
 *    - Cross-field rules (references resolve, levels <= maxLevel, ...) are
 *      semantic checks in validate.ts, not here.
 * ============================================================================
 */
import { z } from 'zod';
import {
  base64ToI16,
  base64ToU16,
  base64ToU8,
  i16ToBase64,
  isBase64,
  u16ToBase64,
  u8ToBase64,
} from './base64.ts';

/* -------------------------------------------------------------------------- */
/*  Versions                                                                  */
/* -------------------------------------------------------------------------- */

/** v0.6.0 files are schema 1 and are rejected. */
/** 3: the ramp layer is gone; heights follow Catlike's slopes and cliffs (D194). 2 files migrate on load. */
export const SCHEMA_VERSION = 3;
/** Additive revisions only (L3). */
export const SCHEMA_MINOR = 0;

/* -------------------------------------------------------------------------- */
/*  Primitives                                                                */
/* -------------------------------------------------------------------------- */

/** A UUID v4, branded by what it identifies. */
export type Id<K extends string> = string & { readonly __kind: K };

const id = <K extends string>(_kind: K) => z.uuidv4() as unknown as z.ZodType<Id<K>, string>;

const base64 = z.string().refine(isBase64, 'must be canonical base64');

const u8Layer = z.codec(base64, z.custom<Uint8Array>((v) => v instanceof Uint8Array, 'expected a Uint8Array'), {
  decode: (text) => base64ToU8(text),
  encode: (array) => u8ToBase64(array),
});
const u16Layer = z.codec(base64, z.custom<Uint16Array>((v) => v instanceof Uint16Array, 'expected a Uint16Array'), {
  decode: (text, ctx) => {
    try {
      return base64ToU16(text);
    } catch {
      ctx.issues.push({ code: 'custom', input: text, message: 'a 16-bit layer needs an even byte count' });
      return z.NEVER;
    }
  },
  encode: (array) => u16ToBase64(array),
});
const i16Layer = z.codec(base64, z.custom<Int16Array>((v) => v instanceof Int16Array, 'expected an Int16Array'), {
  decode: (text, ctx) => {
    try {
      return base64ToI16(text);
    } catch {
      ctx.issues.push({ code: 'custom', input: text, message: 'a 16-bit layer needs an even byte count' });
      return z.NEVER;
    }
  },
  encode: (array) => i16ToBase64(array),
});

const nonNegative = z.number().min(0);
const positive = z.number().gt(0);
const fraction = z.number().min(0).max(1);
const ms = nonNegative; // every authored duration in milliseconds
const count = z.int().min(0);

/* -------------------------------------------------------------------------- */
/*  Settings                                                                  */
/* -------------------------------------------------------------------------- */

export const ProjectSettingsSchema = z
  .strictObject({
    playerArchetypeId: id('archetype'), // spawned at the start map's playerStart; Phase 11 presets replace it
    msPerTurn: positive, //              default 3000; read only in stepped mode
    hexSize: positive, //                world units, center to corner; default 1
    levelHeight: positive, //            world units per cliff level; default 0.5
    maxLevel: z.int().min(1).max(15), // default 15: Warcraft III's 16 levels (Q9)
    pixelsPerUnit: positive, //          screen pixels per world unit at zoom 1; default 64
    sight: z.strictObject({
      uphillBlocked: z.boolean(), //     default true (WC3 high ground)
      uphillRevealRange: nonNegative, // world units; default 1.5
    }),
    friendlyFire: z.boolean(), //        global default; Phase 18 adds per-source overrides
  })
  .meta({ id: 'ProjectSettings' });

/* -------------------------------------------------------------------------- */
/*  Assets                                                                    */
/* -------------------------------------------------------------------------- */

export const AssetRefSchema = z
  .strictObject({
    blobId: z.string().regex(/^[0-9a-f]{64}$/, 'must be a lowercase hex SHA-256'), // of the DECODED bytes: the id is the hash
    mime: z.string().min(1),
    byteSize: count,
    width: positive.optional(),
    height: positive.optional(),
    durationMs: ms.optional(),
  })
  .meta({ id: 'AssetRef' });

export const NamedAssetSchema = z
  .strictObject({ id: id('asset'), name: z.string(), ref: AssetRefSchema })
  .meta({ id: 'NamedAsset' });

export const AtlasDefSchema = z
  .strictObject({
    id: id('atlas'),
    sourceIds: z.array(id('asset')),
    tiers: z
      .array(
        z.strictObject({
          scale: z.literal([1, 2]),
          image: AssetRefSchema,
          frames: z.record(
            z.string(),
            z.strictObject({
              x: nonNegative,
              y: nonNegative,
              w: positive,
              h: positive,
              anchorX: z.number(),
              anchorY: z.number(),
            }),
          ),
        }),
      )
      .min(1),
  })
  .meta({ id: 'AtlasDef' });

export const AssetManifestSchema = z
  .strictObject({
    vectorSources: z.array(NamedAssetSchema), // SVG originals
    images: z.array(NamedAssetSchema), //        raster art used as-is
    atlases: z.array(AtlasDefSchema), //         baked output (Phase 3)
    audio: z.array(NamedAssetSchema),
  })
  .meta({ id: 'AssetManifest' });

export const FrameRefSchema = z
  .strictObject({ atlasId: id('atlas'), frame: z.string().min(1) })
  .meta({ id: 'FrameRef' });

/* -------------------------------------------------------------------------- */
/*  Entity matching, conditions, actions                                      */
/* -------------------------------------------------------------------------- */

export const EntityMatchSchema = z
  .discriminatedUnion('by', [
    z.strictObject({ by: z.literal('player') }),
    z.strictObject({ by: z.literal('subject') }),
    z.strictObject({ by: z.literal('other') }),
    z.strictObject({ by: z.literal('any') }),
    z.strictObject({ by: z.literal('placement'), key: id('placement') }),
    z.strictObject({ by: z.literal('tag'), tag: z.string().min(1) }),
    z.strictObject({ by: z.literal('archetype'), archetypeId: id('archetype') }),
    z.strictObject({ by: z.literal('faction'), factionId: id('faction') }),
  ])
  .meta({ id: 'EntityMatch' });

export const ComparatorSchema = z.literal(['<', '<=', '==', '!=', '>=', '>']);
export const VariableValueSchema = z.union([z.boolean(), z.number(), z.string()]);
export const RelationSchema = z.literal(['hostile', 'neutral', 'ally']);
export const MovementModeSchema = z.literal(['walk', 'swim', 'fly']);

/** Later phases add conditions over the state they own. */
export const ConditionSchema = z
  .discriminatedUnion('type', [
    z.strictObject({
      type: z.literal(['all', 'any']),
      get of() {
        return z.array(ConditionSchema);
      },
    }),
    z.strictObject({
      type: z.literal('not'),
      get of() {
        return ConditionSchema;
      },
    }),
    z.strictObject({
      type: z.literal('variable'),
      variableId: id('variable'),
      comparator: ComparatorSchema,
      value: VariableValueSchema,
    }),
    z.strictObject({ type: z.literal('chance'), probability: fraction }), // seeded RNG
    z.strictObject({ type: z.literal('alive'), who: EntityMatchSchema }),
    z.strictObject({
      type: z.literal('count-alive'),
      who: EntityMatchSchema,
      comparator: ComparatorSchema,
      value: z.number(),
    }),
    z.strictObject({ type: z.literal('in-region'), who: EntityMatchSchema, regionId: id('region') }),
    z.strictObject({
      type: z.literal('health-fraction'),
      who: EntityMatchSchema,
      comparator: ComparatorSchema,
      value: fraction,
    }),
    z.strictObject({ type: z.literal('has-target') }), //                              brain-local
    z.strictObject({ type: z.literal('target-within'), distance: nonNegative }), //    brain-local
    z.strictObject({ type: z.literal('away-from-home'), distance: nonNegative }), //   brain-local leash
    z.strictObject({
      type: z.literal('relation'),
      a: id('faction'),
      b: id('faction'),
      is: RelationSchema,
    }),
  ])
  .meta({ id: 'Condition' });

export const VariableOpSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('set'), value: VariableValueSchema }),
    z.strictObject({ kind: z.literal('add'), value: z.number() }), // numbers only; strings never concatenate
    z.strictObject({ kind: z.literal('toggle') }), //                 bools only
    z.strictObject({ kind: z.literal('set-from'), sourceVariableId: id('variable') }),
  ])
  .meta({ id: 'VariableOp' });

/** Later phases add actions over the state they own. */
export const ActionSchema = z
  .discriminatedUnion('type', [
    z.strictObject({ type: z.literal('set-variable'), variableId: id('variable'), op: VariableOpSchema }),
    z.strictObject({ type: z.literal('modify-health'), target: EntityMatchSchema, delta: z.number() }), // authored, non-combat
    z.strictObject({
      type: z.literal(['apply-effect', 'remove-effect']),
      target: EntityMatchSchema,
      statusId: id('status'),
    }),
    z.strictObject({
      type: z.literal('apply-impulse'),
      target: EntityMatchSchema,
      strength: z.number(),
      away: z.literal(['other', 'facing']),
    }),
    z.strictObject({
      type: z.literal('spawn'),
      archetypeId: id('archetype'),
      at: z.union([id('region'), z.literal('subject')]),
      count: z.int().min(1),
    }),
    z.strictObject({ type: z.literal('despawn'), target: EntityMatchSchema }),
    z.strictObject({
      type: z.literal('teleport'),
      target: EntityMatchSchema,
      mapId: id('map'),
      x: z.number(),
      y: z.number(),
    }),
    z.strictObject({ type: z.literal('set-brain-state'), target: EntityMatchSchema, state: z.string().min(1) }),
    z.strictObject({ type: z.literal('set-trigger-enabled'), triggerId: id('trigger'), enabled: z.boolean() }),
    z.strictObject({ type: z.literal('start-timer'), timerId: z.string().min(1), ms, repeat: z.boolean() }),
    z.strictObject({ type: z.literal('play-feedback'), target: EntityMatchSchema, feedbackId: id('feedback') }),
    z.strictObject({ type: z.literal('play-sfx'), assetId: id('asset') }),
    z.strictObject({ type: z.literal('change-bgm'), assetId: id('asset').nullable(), fadeMs: ms }),
    z.strictObject({ type: z.literal('show-message'), text: z.string(), ms }),
    z.strictObject({
      type: z.literal('scripted-jump'), // Q7: the only way anything jumps
      target: EntityMatchSchema,
      to: z.strictObject({ x: z.number(), y: z.number() }),
      durationMs: ms,
      apex: nonNegative,
      clip: z.string().min(1).optional(),
    }),
    z.strictObject({ type: z.literal('end-session'), outcome: z.literal(['victory', 'defeat']) }),
  ])
  .meta({ id: 'Action' });

/* -------------------------------------------------------------------------- */
/*  Terrain and maps, with elevation                                          */
/* -------------------------------------------------------------------------- */

export const TerrainDefSchema = z
  .strictObject({
    id: id('terrain'),
    name: z.string(),
    top: FrameRefSchema, //                 the hex top
    cliff: FrameRefSchema.optional(), //    side-face art; default is a neutral engine face
    passable: z.strictObject({ walk: z.boolean(), swim: z.boolean(), fly: z.boolean() }), // read by P4 passability
    moveCost: z.number().min(1), //         A* multiplier, >= 1
    blocksSight: z.boolean(), //            default: !walk && !swim
    blocksProjectiles: z.boolean(), //      default: blocksSight
    contact: z.strictObject({ everyMs: positive, actions: z.array(ActionSchema) }).optional(), // lava; read by P4 terrain contact
  })
  .meta({ id: 'TerrainDef' });

/**
 * The six neighbors, in the ported hex module's order (AXIAL_DIRS):
 * 1 E, 2 NE, 3 NW, 4 W, 5 SW, 6 SE.
 */
export const HexDirSchema = z.literal([1, 2, 3, 4, 5, 6]);

export const RegionDefSchema = z
  .strictObject({ id: id('region'), name: z.string(), cells: i16Layer }) // packed (q, r) pairs
  .meta({ id: 'RegionDef' });

export const TriggerDefSchema = z
  .strictObject({
    id: id('trigger'),
    get when() {
      return EventPatternSchema;
    },
    given: z.array(ConditionSchema),
    then: z.array(ActionSchema),
    once: z.boolean(),
    enabled: z.boolean(),
  })
  .meta({ id: 'TriggerDef' });

/** Later phases add the events their systems emit. */
export const EventPatternSchema = z
  .discriminatedUnion('type', [
    z.strictObject({ type: z.literal('map-loaded') }),
    z.strictObject({ type: z.literal('map-unloaded') }),
    z.strictObject({
      type: z.literal(['region-entered', 'region-exited']),
      regionId: id('region'),
      who: EntityMatchSchema,
    }),
    z.strictObject({ type: z.literal('interacted'), target: EntityMatchSchema }),
    z.strictObject({ type: z.literal('attack-hit'), attacker: EntityMatchSchema, victim: EntityMatchSchema }),
    z.strictObject({ type: z.literal('health-crossed'), who: EntityMatchSchema, belowFraction: fraction }), // boss phases
    z.strictObject({ type: z.literal('entity-died'), who: EntityMatchSchema }),
    z.strictObject({ type: z.literal('entity-spawned'), who: EntityMatchSchema }),
    z.strictObject({ type: z.literal('brain-state-entered'), who: EntityMatchSchema, state: z.string().min(1) }),
    z.strictObject({ type: z.literal('variable-changed'), variableId: id('variable') }),
    z.strictObject({ type: z.literal('timer-fired'), timerId: z.string().min(1) }),
    z.strictObject({ type: z.literal('jump-landed'), who: EntityMatchSchema }),
  ])
  .meta({ id: 'EventPattern' });

/* -------------------------------------------------------------------------- */
/*  Entities by composition                                                   */
/* -------------------------------------------------------------------------- */

/** A component's presence is what gives an entity the behavior. */
export const ComponentDataSchema = z
  .strictObject({
    collider: z.strictObject({ radius: positive, height: positive, solid: z.boolean() }).optional(), // an upright cylinder
    movement: z
      .strictObject({
        speed: nonNegative,
        turnRate: nonNegative,
        modes: z.array(MovementModeSchema).min(1),
        startMode: MovementModeSchema,
      })
      .optional(),
    motion: z.strictObject({ mass: positive, friction: nonNegative }).optional(), // knockback response
    health: z.strictObject({ max: positive }).optional(),
    faction: z.strictObject({ factionId: id('faction') }).optional(),
    sight: z.strictObject({ range: nonNegative, eyeHeight: nonNegative }).optional(),
    acquisition: z.strictObject({ range: nonNegative, forgetMs: ms }).optional(),
    attacker: z.strictObject({ attackIds: z.array(id('attack')) }).optional(),
    dodge: z.strictObject({ distance: nonNegative, durationMs: ms, iframeMs: ms, cooldownMs: ms }).optional(),
    brain: z.strictObject({ brainId: id('brain') }).optional(), // leashing is a brain transition (P4)
    sprite: z.strictObject({ animationSetId: id('animset'), scale: positive.optional() }).optional(),
    feedback: z
      .strictObject({ onHurt: id('feedback').optional(), onDeath: id('feedback').optional() })
      .optional(),
    interactable: z.strictObject({ radius: positive, prompt: z.string() }).optional(),
    playerControlled: z.strictObject({}).optional(), // receives the InputFrame
    persistent: z.strictObject({}).optional(), //       survives map changes (the player; later, companions)
    onDeath: z.strictObject({ actions: z.array(ActionSchema), despawnAfterMs: ms }).optional(),
  })
  .meta({ id: 'ComponentData' });

export const ArchetypeDefSchema = z
  .strictObject({
    id: id('archetype'),
    name: z.string(),
    tags: z.array(z.string().min(1)),
    components: ComponentDataSchema,
  })
  .meta({ id: 'ArchetypeDef' });

export const EntityPlacementSchema = z
  .strictObject({
    key: id('placement'), //            stable identity; saves refer to it
    archetypeId: id('archetype'),
    x: z.number(), //                   world plane; z is derived from the surface
    y: z.number(),
    facing: z.number(), //              radians
    overrides: ComponentDataSchema.optional(), // Partial<ComponentData>: every component is already optional
  })
  .meta({ id: 'EntityPlacement' });

export const MapDefSchema = z
  .strictObject({
    id: id('map'),
    name: z.string(),
    width: z.int().min(1).max(256), //  offset-coordinate rectangle; each <= 256
    height: z.int().min(1).max(256),
    terrainPalette: z.array(id('terrain')).min(1), // the terrain layer stores palette indices
    layers: z.strictObject({
      terrain: u16Layer, //             length width*height
      level: u8Layer, //                0..maxLevel; one level apart is a slope, more is a cliff
    }),
    playerStart: z.strictObject({ x: z.number(), y: z.number(), facing: z.number() }).optional(), // required on the start map
    placements: z.array(EntityPlacementSchema), // never the player: it spawns from playerArchetypeId
    regions: z.array(RegionDefSchema),
    triggers: z.array(TriggerDefSchema), // map-scoped; the only place region events are allowed
    bgm: id('asset').optional(),
  })
  .meta({ id: 'MapDef' });

/* -------------------------------------------------------------------------- */
/*  Animation                                                                 */
/* -------------------------------------------------------------------------- */

export const ClipDefSchema = z
  .strictObject({
    frames: z.array(z.array(z.string().min(1)).min(1)).min(1), // [direction][frame] -> atlas frame name
    frameMs: positive,
    loop: z.boolean(),
    cues: z.array(z.strictObject({ frame: count, feedbackId: id('feedback') })).optional(), // footsteps, swooshes; presentation only
  })
  .meta({ id: 'ClipDef' });

export const AnimationSetDefSchema = z
  .strictObject({
    id: id('animset'),
    name: z.string(),
    atlasId: id('atlas'),
    directions: z.literal([1, 4, 6, 8]), // renderer picks the nearest to facing
    mirror: z.boolean(), //                 left-facing directions drawn by flipping
    clips: z.record(z.string().min(1), ClipDefSchema),
    stateClips: z.strictObject({
      idle: z.string(),
      move: z.string(),
      dodge: z.string(),
      hurt: z.string(),
      death: z.string(),
    }),
  })
  .meta({ id: 'AnimationSetDef' });

/* -------------------------------------------------------------------------- */
/*  Attacks                                                                   */
/* -------------------------------------------------------------------------- */

/** One definition serves the player and enemies. Windup is the telegraph. */
export const AttackDefSchema = z
  .strictObject({
    id: id('attack'),
    name: z.string(),
    windupMs: ms,
    activeMs: ms,
    recoveryMs: ms,
    cooldownMs: ms,
    hitbox: z.discriminatedUnion('shape', [
      z.strictObject({ shape: z.literal('arc'), range: positive, arcDeg: z.number().gt(0).max(360) }),
      z.strictObject({ shape: z.literal('circle'), radius: positive, offset: nonNegative }),
      z.strictObject({ shape: z.literal('line'), length: positive, width: positive }),
    ]),
    verticalReach: nonNegative, //   world units above and below the attacker's feet
    knockback: nonNegative, //       impulse along the attacker's facing
    hitstopMs: ms, //                freezes attacker and victim on contact
    onHit: z.array(ActionSchema), // e.g. modify-health on the victim; Phase 7 swaps in deal-damage
    moveDuring: z.literal(['free', 'slowed', 'rooted']),
    clips: z.strictObject({ windup: z.string(), active: z.string(), recovery: z.string() }),
    feedback: z.strictObject({ windup: id('feedback').optional(), hit: id('feedback').optional() }),
    aiRange: positive.optional(), // brains swing inside this; default = the hitbox's reach
  })
  .meta({ id: 'AttackDef' });

/* -------------------------------------------------------------------------- */
/*  Effects, feedback, factions, variables, input                             */
/* -------------------------------------------------------------------------- */

export const DurationSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('ms'), value: nonNegative }),
    z.strictObject({ kind: z.literal('turns'), value: nonNegative }), // via msPerTurn; Phase 14 adds 'game-minutes' and 'until'
  ])
  .meta({ id: 'Duration' });

/** Phase 6 adds `contribution`; Phase 10 adds `script`, `icon`, `dispellable`, `vfxClip`. */
export const StatusEffectDefSchema = z
  .strictObject({
    id: id('status'),
    name: z.string(),
    duration: DurationSchema.nullable(), // null = permanent
    stackMode: z.literal(['refresh', 'stack', 'ignore', 'independent']),
    maxStacks: z.int().min(1).optional(), // 'stack' only
    stackScope: z.literal(['per-source', 'global']),
    restricts: z.array(z.literal(['move', 'attack', 'dodge', 'act'])).optional(), // a stun
    flags: z.array(z.literal(['invulnerable', 'untargetable'])).optional(), //       i-frames
    periodic: z.strictObject({ interval: DurationSchema, actions: z.array(ActionSchema) }).optional(), // poison
  })
  .meta({ id: 'StatusEffectDef' });

export const FeedbackDefSchema = z
  .strictObject({
    id: id('feedback'),
    name: z.string(),
    flash: z
      .strictObject({ color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be #rrggbb'), ms })
      .optional(), // sprite tint
    shake: z.strictObject({ amplitude: nonNegative, ms }).optional(), // camera; scaled by the player's preference
    particles: z.strictObject({ presetId: id('particles'), count: z.int().min(1) }).optional(),
    sfx: z.strictObject({ assetId: id('asset'), volume: fraction }).optional(),
    groundIndicator: z.strictObject({ ms }).optional(), // draws the triggering attack's hitbox on the ground
  })
  .meta({ id: 'FeedbackDef' });

export const ParticlePresetDefSchema = z
  .strictObject({
    id: id('particles'),
    frame: FrameRefSchema,
    lifetimeMs: positive,
    speed: z.tuple([nonNegative, nonNegative]),
    spreadDeg: z.number().min(0).max(360),
    gravity: z.number(),
    scale: z.tuple([positive, positive]),
    fadeOut: z.boolean(),
  })
  .meta({ id: 'ParticlePresetDef' });

export const FactionDefSchema = z
  .strictObject({
    id: id('faction'),
    name: z.string(),
    relations: z.record(z.string(), RelationSchema), // faction id -> relation; missing = neutral; self = ally
  })
  .meta({ id: 'FactionDef' });

/** Phase 12's design, adopted whole. Phase 13 adds scope 'conversation'. */
export const VariableDefSchema = z
  .strictObject({
    id: id('variable'), //                        what conditions and actions store: renaming a key breaks nothing
    key: z.string().regex(/^[a-z0-9_]+$/, 'must match [a-z0-9_]+'), // unique; what authors read
    name: z.string(),
    type: z.literal(['bool', 'number', 'string']),
    initial: VariableValueSchema,
    scope: z.literal(['save', 'session', 'global']), // global is reserved: treated as save, with a one-time log
    readonly: z.boolean(), //                         a readonly variable is a constant
    description: z.string().optional(),
    category: z.string().optional(),
  })
  .meta({ id: 'VariableDef' });

export const InputActionDefSchema = z
  .strictObject({
    id: id('input'),
    name: z.string(),
    kind: z.literal(['button', 'axis2', 'pointer']),
    role: z
      .literal(['move', 'aim', 'click', 'attack-primary', 'attack-secondary', 'dodge', 'interact'])
      .optional(),
    defaultBindings: z.array(z.string().min(1)), // KeyboardEvent.code values, e.g. 'KeyW', 'Space'; 'Mouse0'
  })
  .meta({ id: 'InputActionDef' });

/* -------------------------------------------------------------------------- */
/*  Brains                                                                    */
/* -------------------------------------------------------------------------- */

export const BrainDefSchema = z
  .strictObject({
    id: id('brain'),
    name: z.string(),
    initial: z.string().min(1),
    states: z
      .array(
        z.strictObject({
          id: z.string().min(1),
          behavior: z.discriminatedUnion('kind', [
            z.strictObject({ kind: z.literal('idle') }),
            z.strictObject({ kind: z.literal('wander'), radius: nonNegative }),
            z.strictObject({ kind: z.literal('patrol'), regionId: id('region') }),
            z.strictObject({ kind: z.literal('chase') }),
            z.strictObject({ kind: z.literal('return-home') }),
            z.strictObject({
              kind: z.literal('attack'),
              attackIds: z.array(id('attack')).min(1),
              pick: z.literal(['sequence', 'random']),
            }),
            z.strictObject({ kind: z.literal('flee'), distance: nonNegative }),
          ]),
          onEnter: z.array(ActionSchema).optional(),
          transitions: z.array(
            z.strictObject({ to: z.string().min(1), when: z.array(ConditionSchema), afterMs: ms.optional() }),
          ),
        }),
      )
      .min(1),
  })
  .meta({ id: 'BrainDef' });

/* -------------------------------------------------------------------------- */
/*  The project                                                               */
/* -------------------------------------------------------------------------- */

export const ProjectSchema = z
  .strictObject({
    schemaVersion: z.literal(SCHEMA_VERSION),
    schemaMinor: count, //                    additive revisions only (L3)
    id: id('project'),
    name: z.string(),
    contentRevision: count, //                +1 per saved edit; an input to determinism (L5)
    startMapId: id('map'), //                 authored start; the editor's open map lives in EditorState
    settings: ProjectSettingsSchema,
    assets: AssetManifestSchema,
    terrains: z.array(TerrainDefSchema),
    maps: z.array(MapDefSchema),
    archetypes: z.array(ArchetypeDefSchema),
    animationSets: z.array(AnimationSetDefSchema),
    attacks: z.array(AttackDefSchema),
    brains: z.array(BrainDefSchema),
    statusEffects: z.array(StatusEffectDefSchema),
    feedback: z.array(FeedbackDefSchema),
    particlePresets: z.array(ParticlePresetDefSchema),
    factions: z.array(FactionDefSchema), //   a new project seeds player, hostile, neutral
    variables: z.array(VariableDefSchema),
    inputActions: z.array(InputActionDefSchema),
    triggers: z.array(TriggerDefSchema), //   global triggers; region events are allowed only on map triggers
  })
  .meta({ id: 'Project' });

/* -------------------------------------------------------------------------- */
/*  Inferred types (in memory: packed layers are typed arrays)                */
/* -------------------------------------------------------------------------- */

export type Project = z.output<typeof ProjectSchema>;
/** The shape on disk: identical, except packed layers are base64 strings. */
export type ProjectFile = z.input<typeof ProjectSchema>;
export type ProjectSettings = z.output<typeof ProjectSettingsSchema>;
export type AssetRef = z.output<typeof AssetRefSchema>;
export type NamedAsset = z.output<typeof NamedAssetSchema>;
export type AssetManifest = z.output<typeof AssetManifestSchema>;
export type AtlasDef = z.output<typeof AtlasDefSchema>;
export type FrameRef = z.output<typeof FrameRefSchema>;
export type TerrainDef = z.output<typeof TerrainDefSchema>;
export type HexDir = z.output<typeof HexDirSchema>;
export type MapDef = z.output<typeof MapDefSchema>;
export type EntityPlacement = z.output<typeof EntityPlacementSchema>;
export type RegionDef = z.output<typeof RegionDefSchema>;
export type MovementMode = z.output<typeof MovementModeSchema>;
export type ArchetypeDef = z.output<typeof ArchetypeDefSchema>;
export type ComponentData = z.output<typeof ComponentDataSchema>;
export type AnimationSetDef = z.output<typeof AnimationSetDefSchema>;
export type ClipDef = z.output<typeof ClipDefSchema>;
export type AttackDef = z.output<typeof AttackDefSchema>;
export type Duration = z.output<typeof DurationSchema>;
export type StatusEffectDef = z.output<typeof StatusEffectDefSchema>;
export type FeedbackDef = z.output<typeof FeedbackDefSchema>;
export type ParticlePresetDef = z.output<typeof ParticlePresetDefSchema>;
export type FactionDef = z.output<typeof FactionDefSchema>;
export type Relation = z.output<typeof RelationSchema>;
export type VariableValue = z.output<typeof VariableValueSchema>;
export type VariableDef = z.output<typeof VariableDefSchema>;
export type InputActionDef = z.output<typeof InputActionDefSchema>;
export type EntityMatch = z.output<typeof EntityMatchSchema>;
export type BrainDef = z.output<typeof BrainDefSchema>;
export type TriggerDef = z.output<typeof TriggerDefSchema>;
export type EventPattern = z.output<typeof EventPatternSchema>;
export type Comparator = z.output<typeof ComparatorSchema>;
export type Condition = z.output<typeof ConditionSchema>;
export type VariableOp = z.output<typeof VariableOpSchema>;
export type Action = z.output<typeof ActionSchema>;
