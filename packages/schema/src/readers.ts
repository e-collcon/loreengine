/**
 * The reader manifest (spec 4.4). Every authored leaf field of the schema
 * source maps to the system that READS it and the id of the test that
 * PROVES it. `tests/readers.test.ts` walks the schema and fails when a
 * field has no entry, when an entry names no field, or when the test id of
 * a built chunk does not exist. This is the permanent guard against
 * authorable-but-inert fields (v0's `flag-set`, `swimmable`, `run-script`).
 *
 * Test ids are `<chunk>.<system>.<case>`; a test carries its id in its
 * title as `[P2.cond.chance]`. Chunk prefixes: P1 schema · P2 runtime core ·
 * P3A world · P3B render spike · P3C presentation · P4A movement and sight ·
 * P4B combat · P5 editor.
 */
export interface ReaderEntry {
  /** `<package>/<system>` that reads the field. */
  reader: string;
  /** Id of the test that proves the read. */
  test: string;
}

type Row = readonly [reader: string, test: string, fields: string];

const rows: readonly Row[] = [
  /* ---- Project ---------------------------------------------------------- */
  ['schema/validate', 'P1.validate.version', 'Project.schemaVersion Project.schemaMinor'],
  ['runtime/save', 'P2.save.header', 'Project.id Project.contentRevision'],
  ['editor/shell', 'P5.shell.title', 'Project.name'],
  ['runtime/session', 'P3A.lifecycle.player-spawn', 'Project.startMapId ProjectSettings.playerArchetypeId'],

  /* ---- ProjectSettings -------------------------------------------------- */
  ['runtime/time', 'P2.duration.convert', 'ProjectSettings.msPerTurn'],
  ['runtime/world', 'P3A.world.cell-at', 'ProjectSettings.hexSize'],
  ['runtime/world', 'P3A.world.surface-height', 'ProjectSettings.levelHeight'],
  ['schema/validate', 'P1.validate.ranges', 'ProjectSettings.maxLevel'],
  ['render/projection', 'P3B.projection.world-to-screen', 'ProjectSettings.pixelsPerUnit'],
  ['runtime/sight', 'P4A.sight.high-ground', 'ProjectSettings.sight.uphillBlocked ProjectSettings.sight.uphillRevealRange'],
  ['runtime/combat', 'P4B.attack.friendly-fire', 'ProjectSettings.friendlyFire'],

  /* ---- Identity: ids other content refers to ---------------------------- */
  [
    'schema/validate',
    'P1.validate.refs',
    `TerrainDef.id MapDef.id ArchetypeDef.id AnimationSetDef.id AttackDef.id BrainDef.id StatusEffectDef.id
     FeedbackDef.id ParticlePresetDef.id FactionDef.id InputActionDef.id NamedAsset.id AtlasDef.id RegionDef.id`,
  ],

  /* ---- Names: read by the editor's lists and forms ----------------------- */
  ['editor/database', 'P5.db.names', `TerrainDef.name ArchetypeDef.name AnimationSetDef.name AttackDef.name BrainDef.name
     StatusEffectDef.name FeedbackDef.name FactionDef.name InputActionDef.name`],
  ['editor/shell', 'P5.shell.map-list', 'MapDef.name RegionDef.name'],
  ['editor/assets', 'P5.assets.panel', 'NamedAsset.name'],
  ['editor/database', 'P5.db.variables', 'VariableDef.name VariableDef.description VariableDef.category'],

  /* ---- Terrain ---------------------------------------------------------- */
  ['runtime/world', 'P3A.connects.table', 'TerrainDef.passable.walk TerrainDef.passable.swim TerrainDef.passable.fly'],
  ['runtime/pathing', 'P4A.path.move-cost', 'TerrainDef.moveCost'],
  ['runtime/sight', 'P4A.sight.cast-segment', 'TerrainDef.blocksSight TerrainDef.blocksProjectiles'],
  ['runtime/terrain-contact', 'P4B.terrain.contact', 'TerrainDef.contact.everyMs'],

  /* ---- Maps ------------------------------------------------------------- */
  ['runtime/world', 'P3A.world.cell-at', 'MapDef.width MapDef.height'],
  ['runtime/world', 'P3A.connects.table', 'MapDef.terrainPalette[] MapDef.layers.terrain MapDef.layers.level'],
  ['runtime/session', 'P3A.lifecycle.player-spawn', 'MapDef.playerStart.x MapDef.playerStart.y MapDef.playerStart.facing'],
  ['runtime/session', 'P3A.lifecycle.bgm', 'MapDef.bgm'],
  ['runtime/session', 'P3A.lifecycle.save-delta', 'EntityPlacement.key'],
  ['runtime/session', 'P3A.lifecycle.placements', 'EntityPlacement.archetypeId EntityPlacement.x EntityPlacement.y EntityPlacement.facing'],
  ['runtime/conditions', 'P2.cond.in-region', 'RegionDef.cells'],

  /* ---- Archetypes and components ---------------------------------------- */
  ['runtime/match', 'P2.match.variants', 'ArchetypeDef.tags[] ComponentData.faction.factionId'],
  ['runtime/collision', 'P4A.collision.circles', 'ComponentData.collider.radius ComponentData.collider.solid'],
  ['runtime/sight', 'P4A.sight.cast-segment', 'ComponentData.collider.height ComponentData.sight.range ComponentData.sight.eyeHeight'],
  ['runtime/movement', 'P4A.movement.speed', 'ComponentData.movement.speed'],
  ['runtime/movement', 'P4A.movement.turn-rate', 'ComponentData.movement.turnRate'],
  ['runtime/movement', 'P4A.movement.modes', 'ComponentData.movement.modes[] ComponentData.movement.startMode'],
  ['runtime/movement', 'P4B.knockback.motion', 'ComponentData.motion.mass ComponentData.motion.friction'],
  ['runtime/entities', 'P2.cond.health-fraction', 'ComponentData.health.max'],
  ['runtime/acquisition', 'P4A.acquisition.range', 'ComponentData.acquisition.range ComponentData.acquisition.forgetMs'],
  ['runtime/combat', 'P4B.attack.input', 'ComponentData.attacker.attackIds[]'],
  ['runtime/dodge', 'P4B.dodge.roll', `ComponentData.dodge.distance ComponentData.dodge.durationMs
     ComponentData.dodge.iframeMs ComponentData.dodge.cooldownMs`],
  ['runtime/brains', 'P4A.brain.initial', 'ComponentData.brain.brainId BrainDef.initial'],
  ['runtime/animator', 'P4B.animator.states', 'ComponentData.sprite.animationSetId'],
  ['render/sprites', 'P3B.sprites.placeholder', 'ComponentData.sprite.scale'],
  ['runtime/health', 'P4B.feedback-events.hurt-death', 'ComponentData.feedback.onHurt ComponentData.feedback.onDeath'],
  ['runtime/orders', 'P4A.orders.interact', 'ComponentData.interactable.radius'],
  ['player/hud', 'P3C.hud.prompt', 'ComponentData.interactable.prompt'],
  ['runtime/input', 'P4A.input.player', 'ComponentData.playerControlled'],
  ['runtime/session', 'P3A.lifecycle.persistent', 'ComponentData.persistent'],
  ['runtime/health', 'P4B.death.despawn', 'ComponentData.onDeath.despawnAfterMs'],

  /* ---- Animation -------------------------------------------------------- */
  ['render/animation', 'P3C.anim.playback', 'AnimationSetDef.atlasId ClipDef.frames[][]'],
  ['render/animation', 'P3C.anim.direction', 'AnimationSetDef.directions AnimationSetDef.mirror'],
  ['runtime/animator', 'P4B.animator.states', `AnimationSetDef.stateClips.idle AnimationSetDef.stateClips.move
     AnimationSetDef.stateClips.dodge AnimationSetDef.stateClips.hurt AnimationSetDef.stateClips.death`],
  ['runtime/animator', 'P4B.animator.clock', 'ClipDef.frameMs ClipDef.loop'],
  ['render/animation', 'P3C.anim.cues', 'ClipDef.cues[].frame ClipDef.cues[].feedbackId'],

  /* ---- Attacks ---------------------------------------------------------- */
  ['runtime/combat', 'P4B.attack.phases', 'AttackDef.windupMs AttackDef.activeMs AttackDef.recoveryMs'],
  ['runtime/combat', 'P4B.attack.cooldown', 'AttackDef.cooldownMs'],
  ['runtime/combat', 'P4B.attack.hitbox-arc', 'AttackDef.hitbox<arc>.shape AttackDef.hitbox<arc>.range AttackDef.hitbox<arc>.arcDeg'],
  ['runtime/combat', 'P4B.attack.hitbox-circle', 'AttackDef.hitbox<circle>.shape AttackDef.hitbox<circle>.radius AttackDef.hitbox<circle>.offset'],
  ['runtime/combat', 'P4B.attack.hitbox-line', 'AttackDef.hitbox<line>.shape AttackDef.hitbox<line>.length AttackDef.hitbox<line>.width'],
  ['runtime/combat', 'P4B.attack.vertical-reach', 'AttackDef.verticalReach'],
  ['runtime/combat', 'P4B.attack.knockback', 'AttackDef.knockback'],
  ['runtime/combat', 'P4B.attack.hitstop', 'AttackDef.hitstopMs'],
  ['runtime/combat', 'P4B.attack.move-during', 'AttackDef.moveDuring'],
  ['runtime/animator', 'P4B.animator.attack-clips', 'AttackDef.clips.windup AttackDef.clips.active AttackDef.clips.recovery'],
  ['runtime/combat', 'P4B.attack.feedback-events', 'AttackDef.feedback.hit'],
  ['render/feedback', 'P3C.feedback.ground-indicator', 'AttackDef.feedback.windup'],
  ['runtime/brains', 'P4B.brain.attack', `AttackDef.aiRange BrainDef.states[].behavior<attack>.kind
     BrainDef.states[].behavior<attack>.attackIds[] BrainDef.states[].behavior<attack>.pick`],

  /* ---- Brains ----------------------------------------------------------- */
  ['runtime/brains', 'P4A.brain.transitions', 'BrainDef.states[].id BrainDef.states[].transitions[].to BrainDef.states[].transitions[].afterMs'],
  ['runtime/brains', 'P4A.brain.idle', 'BrainDef.states[].behavior<idle>.kind'],
  ['runtime/brains', 'P4A.brain.wander', 'BrainDef.states[].behavior<wander>.kind BrainDef.states[].behavior<wander>.radius'],
  ['runtime/brains', 'P4A.brain.patrol', 'BrainDef.states[].behavior<patrol>.kind BrainDef.states[].behavior<patrol>.regionId'],
  ['runtime/brains', 'P4A.brain.chase', 'BrainDef.states[].behavior<chase>.kind'],
  ['runtime/brains', 'P4A.brain.return-home', 'BrainDef.states[].behavior<return-home>.kind'],
  ['runtime/brains', 'P4A.brain.flee', 'BrainDef.states[].behavior<flee>.kind BrainDef.states[].behavior<flee>.distance'],

  /* ---- Status effects and durations ------------------------------------- */
  ['runtime/effects', 'P4B.effects.stacking', 'StatusEffectDef.stackMode StatusEffectDef.maxStacks StatusEffectDef.stackScope'],
  ['runtime/effects', 'P4B.effects.restricts', 'StatusEffectDef.restricts[]'],
  ['runtime/effects', 'P4B.effects.flags', 'StatusEffectDef.flags[]'],
  ['runtime/time', 'P2.duration.convert', 'Duration<ms>.kind Duration<ms>.value Duration<turns>.kind Duration<turns>.value'],

  /* ---- Feedback and particles (presentation) ----------------------------- */
  ['render/feedback', 'P3C.feedback.flash', 'FeedbackDef.flash.color FeedbackDef.flash.ms'],
  ['render/feedback', 'P3C.feedback.shake', 'FeedbackDef.shake.amplitude FeedbackDef.shake.ms'],
  ['render/feedback', 'P3C.feedback.particles', 'FeedbackDef.particles.presetId FeedbackDef.particles.count'],
  ['audio/mixer', 'P3C.feedback.sfx', 'FeedbackDef.sfx.assetId FeedbackDef.sfx.volume'],
  ['render/feedback', 'P3C.feedback.ground-indicator', 'FeedbackDef.groundIndicator.ms'],
  ['render/particles', 'P3C.particles.preset', `ParticlePresetDef.lifetimeMs ParticlePresetDef.speed ParticlePresetDef.spreadDeg
     ParticlePresetDef.gravity ParticlePresetDef.scale ParticlePresetDef.fadeOut`],

  /* ---- Factions, variables, input, triggers ------------------------------ */
  ['runtime/factions', 'P2.cond.relation', 'FactionDef.relations{}'],
  ['runtime/variables', 'P2.variables.store', `VariableDef.id VariableDef.key VariableDef.type VariableDef.initial
     VariableDef.scope VariableDef.readonly`],
  ['player/input', 'P3B.input.mapper', 'InputActionDef.kind InputActionDef.role InputActionDef.defaultBindings[]'],
  ['runtime/triggers', 'P2.triggers.once-enabled', 'TriggerDef.id TriggerDef.once TriggerDef.enabled'],

  /* ---- Assets ----------------------------------------------------------- */
  ['storage/blobs', 'P2.storage.blobs', 'AssetRef.blobId AssetRef.mime AssetRef.byteSize'],
  ['render/atlas', 'P3C.atlas.frames', `AssetRef.width AssetRef.height AtlasDef.tiers[].frames{}.x AtlasDef.tiers[].frames{}.y
     AtlasDef.tiers[].frames{}.w AtlasDef.tiers[].frames{}.h AtlasDef.tiers[].frames{}.anchorX AtlasDef.tiers[].frames{}.anchorY`],
  ['audio/mixer', 'P3C.audio.mixer', 'AssetRef.durationMs'],
  ['render/bake', 'P3C.bake.atlas', 'AtlasDef.sourceIds[]'],
  ['render/atlas', 'P3C.atlas.tier', 'AtlasDef.tiers[].scale'],
  ['render/terrain', 'P3B.terrain.frames', 'FrameRef.atlasId FrameRef.frame'],

  /* ---- Entity matching --------------------------------------------------- */
  ['runtime/match', 'P2.match.variants', `EntityMatch<player>.by EntityMatch<subject>.by EntityMatch<other>.by EntityMatch<any>.by
     EntityMatch<placement>.by EntityMatch<placement>.key EntityMatch<tag>.by EntityMatch<tag>.tag
     EntityMatch<archetype>.by EntityMatch<archetype>.archetypeId EntityMatch<faction>.by EntityMatch<faction>.factionId`],

  /* ---- Conditions: one ConditionEvaluator (L6) --------------------------- */
  ['runtime/conditions', 'P2.cond.all-any', 'Condition<all|any>.type'],
  ['runtime/conditions', 'P2.cond.not', 'Condition<not>.type'],
  ['runtime/conditions', 'P2.cond.variable', `Condition<variable>.type Condition<variable>.variableId
     Condition<variable>.comparator Condition<variable>.value`],
  ['runtime/conditions', 'P2.cond.chance', 'Condition<chance>.type Condition<chance>.probability'],
  ['runtime/conditions', 'P2.cond.alive', 'Condition<alive>.type'],
  ['runtime/conditions', 'P2.cond.count-alive', 'Condition<count-alive>.type Condition<count-alive>.comparator Condition<count-alive>.value'],
  ['runtime/conditions', 'P2.cond.in-region', 'Condition<in-region>.type Condition<in-region>.regionId'],
  ['runtime/conditions', 'P2.cond.health-fraction', `Condition<health-fraction>.type Condition<health-fraction>.comparator
     Condition<health-fraction>.value`],
  ['runtime/conditions', 'P2.cond.brain-local', `Condition<has-target>.type Condition<target-within>.type Condition<target-within>.distance
     Condition<away-from-home>.type Condition<away-from-home>.distance`],
  ['runtime/conditions', 'P2.cond.relation', 'Condition<relation>.type Condition<relation>.a Condition<relation>.b Condition<relation>.is'],

  /* ---- Actions: one ActionExecutor (L6) ---------------------------------- */
  ['runtime/actions', 'P2.act.set-variable', `Action<set-variable>.type Action<set-variable>.variableId VariableOp<set>.kind VariableOp<set>.value
     VariableOp<add>.kind VariableOp<add>.value VariableOp<toggle>.kind VariableOp<set-from>.kind VariableOp<set-from>.sourceVariableId`],
  ['runtime/actions', 'P2.act.set-trigger-enabled', `Action<set-trigger-enabled>.type Action<set-trigger-enabled>.triggerId
     Action<set-trigger-enabled>.enabled`],
  ['runtime/actions', 'P2.act.start-timer', 'Action<start-timer>.type Action<start-timer>.timerId Action<start-timer>.ms Action<start-timer>.repeat'],
  ['runtime/actions', 'P2.act.play-sfx', 'Action<play-sfx>.type Action<play-sfx>.assetId'],
  ['runtime/actions', 'P2.act.change-bgm', 'Action<change-bgm>.type Action<change-bgm>.assetId Action<change-bgm>.fadeMs'],
  ['runtime/actions', 'P2.act.show-message', 'Action<show-message>.type Action<show-message>.text Action<show-message>.ms'],
  ['runtime/actions', 'P2.act.end-session', 'Action<end-session>.type Action<end-session>.outcome'],
  ['runtime/actions', 'P3A.act.spawn', 'Action<spawn>.type Action<spawn>.archetypeId Action<spawn>.at Action<spawn>.count'],
  ['runtime/actions', 'P3A.act.despawn', 'Action<despawn>.type'],
  ['runtime/actions', 'P3A.act.teleport', 'Action<teleport>.type Action<teleport>.mapId Action<teleport>.x Action<teleport>.y'],
  ['runtime/actions', 'P4A.act.set-brain-state', 'Action<set-brain-state>.type Action<set-brain-state>.state'],
  ['runtime/actions', 'P4B.act.modify-health', 'Action<modify-health>.type Action<modify-health>.delta'],
  ['runtime/actions', 'P4B.act.apply-effect', 'Action<apply-effect|remove-effect>.type Action<apply-effect|remove-effect>.statusId'],
  ['runtime/actions', 'P4B.act.apply-impulse', 'Action<apply-impulse>.type Action<apply-impulse>.strength Action<apply-impulse>.away'],
  ['runtime/actions', 'P4B.act.play-feedback', 'Action<play-feedback>.type Action<play-feedback>.feedbackId'],
  ['runtime/actions', 'P4B.act.scripted-jump', `Action<scripted-jump>.type Action<scripted-jump>.to.x Action<scripted-jump>.to.y
     Action<scripted-jump>.durationMs Action<scripted-jump>.apex Action<scripted-jump>.clip`],

  /* ---- Events: what triggers listen for ---------------------------------- */
  ['runtime/session', 'P3A.lifecycle.events', 'EventPattern<map-loaded>.type EventPattern<map-unloaded>.type'],
  ['runtime/regions', 'P4A.events.region', 'EventPattern<region-entered|region-exited>.type EventPattern<region-entered|region-exited>.regionId'],
  ['runtime/orders', 'P4A.events.interacted', 'EventPattern<interacted>.type'],
  ['runtime/combat', 'P4B.events.attack-hit', 'EventPattern<attack-hit>.type'],
  ['runtime/health', 'P4B.events.health-crossed', 'EventPattern<health-crossed>.type EventPattern<health-crossed>.belowFraction'],
  ['runtime/health', 'P4B.events.entity-died', 'EventPattern<entity-died>.type'],
  ['runtime/entities', 'P3A.events.entity-spawned', 'EventPattern<entity-spawned>.type'],
  ['runtime/brains', 'P4A.events.brain-state', 'EventPattern<brain-state-entered>.type EventPattern<brain-state-entered>.state'],
  ['runtime/variables', 'P2.events.variable-changed', 'EventPattern<variable-changed>.type EventPattern<variable-changed>.variableId'],
  ['runtime/timers', 'P2.events.timer-fired', 'EventPattern<timer-fired>.type EventPattern<timer-fired>.timerId'],
  ['runtime/jumps', 'P4B.events.jump-landed', 'EventPattern<jump-landed>.type'],
];

function build(): Record<string, ReaderEntry> {
  const out: Record<string, ReaderEntry> = {};
  for (const [reader, test, fields] of rows) {
    for (const field of fields.split(/\s+/)) {
      if (!field) continue;
      if (out[field]) throw new Error(`reader manifest: "${field}" is listed twice`);
      out[field] = { reader, test };
    }
  }
  return out;
}

/** Leaf field path (see walk.ts) -> who reads it and which test proves it. */
export const READERS: Readonly<Record<string, ReaderEntry>> = build();
