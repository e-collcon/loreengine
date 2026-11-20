/**
 * Project validation (spec 4.6). Runs on every load and import, and rejects
 * rather than repairs:
 *
 *   1. Version gate — before anything is parsed, so a v0.6.0 file is never
 *      half-read.
 *   2. Structure — the Zod source in project.ts (strict objects, ranges that
 *      belong to one field).
 *   3. Semantics — `checkProject`: references resolve, layers fit their map,
 *      levels stay under `maxLevel`, brain-local conditions appear only in
 *      brain transitions, region events only on map triggers.
 */
import { z } from 'zod';
import { ProjectSchema, SCHEMA_MINOR, SCHEMA_VERSION } from './project.ts';
import type { Action, Condition, EntityMatch, EventPattern, Project, TriggerDef, VariableValue } from './project.ts';

export interface ValidationIssue {
  /** Where, e.g. `maps[0].layers.level`. */
  path: string;
  /** Stable machine code, e.g. `schema-v1`, `unresolved-ref`. */
  code: string;
  message: string;
}

export type ParseResult = { ok: true; project: Project } | { ok: false; issues: ValidationIssue[] };

/** The message a v0.6.0 (schema 1) file is rejected with. */
export const SCHEMA_V1_MESSAGE =
  `This file was made with LoreBrix v0.6.0 (schema 1). LoreEngine reads schema ${SCHEMA_VERSION} and does not migrate v0.6.0 files.`;

/** Version gate: the only thing read from a file before it is known to be ours. */
export function checkVersion(raw: unknown): ValidationIssue | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { path: '', code: 'not-a-project', message: 'Not a LoreEngine project: expected a JSON object.' };
  }
  const { schemaVersion, schemaMinor } = raw as { schemaVersion?: unknown; schemaMinor?: unknown };
  if (schemaVersion === 1) return { path: 'schemaVersion', code: 'schema-v1', message: SCHEMA_V1_MESSAGE };
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    return {
      path: 'schemaVersion',
      code: 'bad-version',
      message: 'Not a LoreEngine project: schemaVersion is missing or not a version number.',
    };
  }
  const minor = typeof schemaMinor === 'number' ? schemaMinor : 0;
  if (schemaVersion > SCHEMA_VERSION || (schemaVersion === SCHEMA_VERSION && minor > SCHEMA_MINOR)) {
    return {
      path: 'schemaVersion',
      code: 'newer-version',
      message: `This file was made with a newer LoreEngine (schema ${schemaVersion}.${minor}; this build reads up to ${SCHEMA_VERSION}.${SCHEMA_MINOR}).`,
    };
  }
  return null;
}

function zodPath(path: PropertyKey[]): string {
  let out = '';
  for (const part of path) out += typeof part === 'number' ? `[${part}]` : out ? `.${String(part)}` : String(part);
  return out;
}

/**
 * Schema 2 -> 3 (D194): maps lose their ramp layer. A ramp cell keeps its
 * level, its low edge, so beside a cell one level up it becomes a slope.
 */
export function migrateSchema2(raw: Record<string, unknown>): Record<string, unknown> {
  const maps = Array.isArray(raw['maps']) ? (raw['maps'] as Record<string, unknown>[]) : [];
  return {
    ...raw,
    schemaVersion: 3,
    schemaMinor: 0,
    maps: maps.map((map) => {
      const layers = (map?.['layers'] ?? {}) as Record<string, unknown>;
      const { ramp: _ramp, ...rest } = layers;
      return { ...map, layers: rest };
    }),
  };
}

/** Validate a JSON-decoded project file. Typed-array layers are decoded from base64. Schema 2 files are migrated first. */
export function parseProject(raw: unknown): ParseResult {
  const version = checkVersion(raw);
  if (version) return { ok: false, issues: [version] };
  if ((raw as { schemaVersion?: unknown }).schemaVersion === 2) raw = migrateSchema2(raw as Record<string, unknown>);
  const parsed = z.safeDecode(ProjectSchema, raw as z.input<typeof ProjectSchema>);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: zodPath(issue.path),
        code: `structure:${issue.code}`,
        message: issue.message,
      })),
    };
  }
  const issues = checkProject(parsed.data);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, project: parsed.data };
}

/** Validate the text of a `project.json`. */
export function parseProjectJson(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, issues: [{ path: '', code: 'bad-json', message: `Not valid JSON: ${(err as Error).message}` }] };
  }
  return parseProject(raw);
}

/**
 * Canonical file text of a project. Keys follow the schema's declaration
 * order, so parse -> serialize -> parse -> serialize is byte-identical.
 * Throws if the project does not satisfy the schema.
 */
export function serializeProject(project: Project): string {
  return JSON.stringify(z.encode(ProjectSchema, project), null, 2) + '\n';
}

/* -------------------------------------------------------------------------- */
/*  Semantic checks                                                           */
/* -------------------------------------------------------------------------- */

type VarType = 'bool' | 'number' | 'string';
const typeOfValue = (v: VariableValue): VarType =>
  typeof v === 'boolean' ? 'bool' : typeof v === 'number' ? 'number' : 'string';

/** Where a condition or action list sits, which decides what it may contain. */
interface Site {
  /** True only inside a brain transition: brain-local conditions are legal. */
  inBrain: boolean;
  /** Set for map triggers: the regions of that map (region events must use them). */
  mapRegions: Set<string> | null;
}

/**
 * Cross-field validation of an in-memory project. Returns every issue found
 * (an empty array means valid). The editor calls this live; `parseProject`
 * calls it after the structural pass.
 */
export function checkProject(project: Project): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const bad = (path: string, code: string, message: string): void => {
    issues.push({ path, code, message });
  };

  const idSet = (items: readonly { id: string }[], path: string): Set<string> => {
    const set = new Set<string>();
    items.forEach((item, i) => {
      if (set.has(item.id)) bad(`${path}[${i}].id`, 'duplicate-id', `Duplicate id ${item.id}.`);
      set.add(item.id);
    });
    return set;
  };

  const assetLists = ['vectorSources', 'images', 'audio'] as const;
  const assetIds = new Set<string>();
  for (const list of assetLists) {
    project.assets[list].forEach((asset, i) => {
      if (assetIds.has(asset.id)) bad(`assets.${list}[${i}].id`, 'duplicate-id', `Duplicate asset id ${asset.id}.`);
      assetIds.add(asset.id);
    });
  }
  const audioIds = new Set(project.assets.audio.map((a) => a.id as string));
  const sourceIds = new Set([...project.assets.vectorSources, ...project.assets.images].map((a) => a.id as string));
  const atlasFrames = new Map<string, Set<string>>();
  idSet(project.assets.atlases, 'assets.atlases');
  project.assets.atlases.forEach((atlas, i) => {
    const first = new Set(Object.keys(atlas.tiers[0]!.frames));
    atlasFrames.set(atlas.id, first);
    atlas.sourceIds.forEach((sid, j) => {
      if (!sourceIds.has(sid)) bad(`assets.atlases[${i}].sourceIds[${j}]`, 'unresolved-ref', `No vector source or image ${sid}.`);
    });
    const scales = new Set<number>();
    atlas.tiers.forEach((tier, t) => {
      if (scales.has(tier.scale)) bad(`assets.atlases[${i}].tiers[${t}].scale`, 'duplicate-tier', `Two tiers at scale ${tier.scale}.`);
      scales.add(tier.scale);
      const names = Object.keys(tier.frames);
      if (names.length !== first.size || names.some((n) => !first.has(n))) {
        bad(`assets.atlases[${i}].tiers[${t}].frames`, 'tier-mismatch', 'Every tier of an atlas must hold the same frame names.');
      }
    });
  });

  const terrainIds = idSet(project.terrains, 'terrains');
  const mapIds = idSet(project.maps, 'maps');
  const archetypeIds = idSet(project.archetypes, 'archetypes');
  const animsetIds = idSet(project.animationSets, 'animationSets');
  const attackIds = idSet(project.attacks, 'attacks');
  const brainIds = idSet(project.brains, 'brains');
  const statusIds = idSet(project.statusEffects, 'statusEffects');
  const feedbackIds = idSet(project.feedback, 'feedback');
  const particleIds = idSet(project.particlePresets, 'particlePresets');
  const factionIds = idSet(project.factions, 'factions');
  idSet(project.variables, 'variables');
  idSet(project.inputActions, 'inputActions');
  const variables = new Map(project.variables.map((v) => [v.id as string, v]));

  const regionIds = new Set<string>();
  const placementKeys = new Set<string>();
  const triggerIds = new Set<string>();
  project.maps.forEach((map, m) => {
    map.regions.forEach((region, r) => {
      if (regionIds.has(region.id)) bad(`maps[${m}].regions[${r}].id`, 'duplicate-id', `Duplicate region id ${region.id}.`);
      regionIds.add(region.id);
    });
    map.placements.forEach((placement, p) => {
      if (placementKeys.has(placement.key)) bad(`maps[${m}].placements[${p}].key`, 'duplicate-id', `Duplicate placement key ${placement.key}.`);
      placementKeys.add(placement.key);
    });
    map.triggers.forEach((trigger, t) => {
      if (triggerIds.has(trigger.id)) bad(`maps[${m}].triggers[${t}].id`, 'duplicate-id', `Duplicate trigger id ${trigger.id}.`);
      triggerIds.add(trigger.id);
    });
  });
  project.triggers.forEach((trigger, t) => {
    if (triggerIds.has(trigger.id)) bad(`triggers[${t}].id`, 'duplicate-id', `Duplicate trigger id ${trigger.id}.`);
    triggerIds.add(trigger.id);
  });

  const ref = (set: ReadonlySet<string>, value: string | undefined, path: string, what: string): void => {
    if (value !== undefined && !set.has(value)) bad(path, 'unresolved-ref', `No ${what} ${value}.`);
  };
  const frameRef = (frame: { atlasId: string; frame: string } | undefined, path: string): void => {
    if (!frame) return;
    const frames = atlasFrames.get(frame.atlasId);
    if (!frames) bad(`${path}.atlasId`, 'unresolved-ref', `No atlas ${frame.atlasId}.`);
    else if (!frames.has(frame.frame)) bad(`${path}.frame`, 'unresolved-ref', `Atlas ${frame.atlasId} has no frame "${frame.frame}".`);
  };

  const checkMatch = (match: EntityMatch, path: string): void => {
    if (match.by === 'placement') ref(placementKeys, match.key, `${path}.key`, 'placement');
    else if (match.by === 'archetype') ref(archetypeIds, match.archetypeId, `${path}.archetypeId`, 'archetype');
    else if (match.by === 'faction') ref(factionIds, match.factionId, `${path}.factionId`, 'faction');
  };

  const checkCondition = (cond: Condition, path: string, site: Site): void => {
    switch (cond.type) {
      case 'all':
      case 'any':
        cond.of.forEach((c, i) => checkCondition(c, `${path}.of[${i}]`, site));
        break;
      case 'not':
        checkCondition(cond.of, `${path}.of`, site);
        break;
      case 'variable': {
        const def = variables.get(cond.variableId);
        if (!def) {
          bad(`${path}.variableId`, 'unresolved-ref', `No variable ${cond.variableId}.`);
        } else {
          if (typeOfValue(cond.value) !== def.type) {
            bad(`${path}.value`, 'type-mismatch', `Variable "${def.key}" is a ${def.type}; it cannot be compared with a ${typeOfValue(cond.value)}.`);
          }
          if (def.type !== 'number' && cond.comparator !== '==' && cond.comparator !== '!=') {
            bad(`${path}.comparator`, 'type-mismatch', `Only == and != apply to the ${def.type} variable "${def.key}".`);
          }
        }
        break;
      }
      case 'alive':
      case 'count-alive':
      case 'health-fraction':
        checkMatch(cond.who, `${path}.who`);
        break;
      case 'in-region':
        checkMatch(cond.who, `${path}.who`);
        ref(regionIds, cond.regionId, `${path}.regionId`, 'region');
        break;
      case 'has-target':
      case 'target-within':
      case 'away-from-home':
        if (!site.inBrain) {
          bad(path, 'brain-local-condition', `"${cond.type}" is brain-local: it is only evaluated inside a brain transition.`);
        }
        break;
      case 'relation':
        ref(factionIds, cond.a, `${path}.a`, 'faction');
        ref(factionIds, cond.b, `${path}.b`, 'faction');
        break;
      case 'chance':
        break;
    }
  };
  const checkConditions = (list: readonly Condition[], path: string, site: Site): void => {
    list.forEach((c, i) => checkCondition(c, `${path}[${i}]`, site));
  };

  const checkAction = (action: Action, path: string): void => {
    switch (action.type) {
      case 'set-variable': {
        const def = variables.get(action.variableId);
        if (!def) {
          bad(`${path}.variableId`, 'unresolved-ref', `No variable ${action.variableId}.`);
          break;
        }
        const op = action.op;
        if (op.kind === 'set' && typeOfValue(op.value) !== def.type) {
          bad(`${path}.op.value`, 'type-mismatch', `Variable "${def.key}" is a ${def.type}; it cannot be set to a ${typeOfValue(op.value)}.`);
        } else if (op.kind === 'add' && def.type !== 'number') {
          bad(`${path}.op`, 'type-mismatch', `"add" needs a number variable; "${def.key}" is a ${def.type}.`);
        } else if (op.kind === 'toggle' && def.type !== 'bool') {
          bad(`${path}.op`, 'type-mismatch', `"toggle" needs a bool variable; "${def.key}" is a ${def.type}.`);
        } else if (op.kind === 'set-from') {
          const source = variables.get(op.sourceVariableId);
          if (!source) bad(`${path}.op.sourceVariableId`, 'unresolved-ref', `No variable ${op.sourceVariableId}.`);
          else if (source.type !== def.type) {
            bad(`${path}.op.sourceVariableId`, 'type-mismatch', `"${source.key}" (${source.type}) cannot be copied into "${def.key}" (${def.type}).`);
          }
        }
        break;
      }
      case 'modify-health':
      case 'apply-impulse':
      case 'despawn':
      case 'set-brain-state':
      case 'scripted-jump':
        checkMatch(action.target, `${path}.target`);
        break;
      case 'apply-effect':
      case 'remove-effect':
        checkMatch(action.target, `${path}.target`);
        ref(statusIds, action.statusId, `${path}.statusId`, 'status effect');
        break;
      case 'spawn':
        ref(archetypeIds, action.archetypeId, `${path}.archetypeId`, 'archetype');
        if (action.at !== 'subject') ref(regionIds, action.at, `${path}.at`, 'region');
        break;
      case 'teleport':
        checkMatch(action.target, `${path}.target`);
        ref(mapIds, action.mapId, `${path}.mapId`, 'map');
        break;
      case 'set-trigger-enabled':
        ref(triggerIds, action.triggerId, `${path}.triggerId`, 'trigger');
        break;
      case 'play-feedback':
        checkMatch(action.target, `${path}.target`);
        ref(feedbackIds, action.feedbackId, `${path}.feedbackId`, 'feedback');
        break;
      case 'play-sfx':
        ref(audioIds, action.assetId, `${path}.assetId`, 'audio asset');
        break;
      case 'change-bgm':
        if (action.assetId !== null) ref(audioIds, action.assetId, `${path}.assetId`, 'audio asset');
        break;
      case 'start-timer':
      case 'show-message':
      case 'end-session':
        break;
    }
  };
  const checkActions = (list: readonly Action[] | undefined, path: string): void => {
    list?.forEach((a, i) => checkAction(a, `${path}[${i}]`));
  };

  /**
   * A match inside an event pattern. `subject` and `other` are what the event
   * defines for the trigger's conditions and actions, so a pattern cannot
   * refer to them: such a pattern could never match.
   */
  const checkPatternMatch = (match: EntityMatch, path: string): void => {
    if (match.by === 'subject' || match.by === 'other') {
      bad(path, 'match-without-context', `An event pattern cannot match by "${match.by}": the event is what defines it.`);
    }
    checkMatch(match, path);
  };

  const checkEvent = (when: EventPattern, path: string, site: Site): void => {
    switch (when.type) {
      case 'region-entered':
      case 'region-exited':
        if (!site.mapRegions) {
          bad(path, 'region-event-on-global-trigger', `"${when.type}" is allowed only on a map's own triggers.`);
        } else if (!site.mapRegions.has(when.regionId)) {
          bad(`${path}.regionId`, 'unresolved-ref', `This map has no region ${when.regionId}.`);
        }
        checkPatternMatch(when.who, `${path}.who`);
        break;
      case 'interacted':
        checkPatternMatch(when.target, `${path}.target`);
        break;
      case 'attack-hit':
        checkPatternMatch(when.attacker, `${path}.attacker`);
        checkPatternMatch(when.victim, `${path}.victim`);
        break;
      case 'health-crossed':
      case 'entity-died':
      case 'entity-spawned':
      case 'brain-state-entered':
      case 'jump-landed':
        checkPatternMatch(when.who, `${path}.who`);
        break;
      case 'variable-changed':
        ref(new Set(variables.keys()), when.variableId, `${path}.variableId`, 'variable');
        break;
      case 'map-loaded':
      case 'map-unloaded':
      case 'timer-fired':
        break;
    }
  };
  const checkTrigger = (trigger: TriggerDef, path: string, site: Site): void => {
    checkEvent(trigger.when, `${path}.when`, site);
    checkConditions(trigger.given, `${path}.given`, site);
    checkActions(trigger.then, `${path}.then`);
  };

  const checkComponents = (c: Project['archetypes'][number]['components'], path: string): void => {
    ref(factionIds, c.faction?.factionId, `${path}.faction.factionId`, 'faction');
    c.attacker?.attackIds.forEach((aid, i) => ref(attackIds, aid, `${path}.attacker.attackIds[${i}]`, 'attack'));
    ref(brainIds, c.brain?.brainId, `${path}.brain.brainId`, 'brain');
    ref(animsetIds, c.sprite?.animationSetId, `${path}.sprite.animationSetId`, 'animation set');
    ref(feedbackIds, c.feedback?.onHurt, `${path}.feedback.onHurt`, 'feedback');
    ref(feedbackIds, c.feedback?.onDeath, `${path}.feedback.onDeath`, 'feedback');
    if (c.movement && !c.movement.modes.includes(c.movement.startMode)) {
      bad(`${path}.movement.startMode`, 'out-of-range', `startMode "${c.movement.startMode}" is not one of the entity's modes.`);
    }
    checkActions(c.onDeath?.actions, `${path}.onDeath.actions`);
  };

  /* ---- top level ---------------------------------------------------------- */

  const global: Site = { inBrain: false, mapRegions: null };

  ref(archetypeIds, project.settings.playerArchetypeId, 'settings.playerArchetypeId', 'archetype');
  const startMap = project.maps.find((m) => m.id === project.startMapId);
  if (!startMap) bad('startMapId', 'unresolved-ref', `No map ${project.startMapId}.`);
  else if (!startMap.playerStart) {
    bad(`maps[${project.maps.indexOf(startMap)}].playerStart`, 'missing-player-start', 'The start map must have a playerStart.');
  }

  project.terrains.forEach((terrain, i) => {
    frameRef(terrain.top, `terrains[${i}].top`);
    frameRef(terrain.cliff, `terrains[${i}].cliff`);
    checkActions(terrain.contact?.actions, `terrains[${i}].contact.actions`);
  });

  project.maps.forEach((map, m) => {
    const path = `maps[${m}]`;
    const cells = map.width * map.height;
    map.terrainPalette.forEach((tid, i) => ref(terrainIds, tid, `${path}.terrainPalette[${i}]`, 'terrain'));
    const { terrain, level } = map.layers;
    if (terrain.length !== cells) bad(`${path}.layers.terrain`, 'layer-length', `Expected ${cells} cells, found ${terrain.length}.`);
    if (level.length !== cells) bad(`${path}.layers.level`, 'layer-length', `Expected ${cells} cells, found ${level.length}.`);
    for (let i = 0; i < terrain.length; i++) {
      if (terrain[i]! >= map.terrainPalette.length) {
        bad(`${path}.layers.terrain`, 'out-of-range', `Cell ${i} uses palette index ${terrain[i]}, but the palette has ${map.terrainPalette.length} entries.`);
        break;
      }
    }
    for (let i = 0; i < level.length; i++) {
      if (level[i]! > project.settings.maxLevel) {
        bad(`${path}.layers.level`, 'out-of-range', `Cell ${i} is at level ${level[i]}, above maxLevel ${project.settings.maxLevel}.`);
        break;
      }
    }
    const mapRegions = new Set<string>();
    map.regions.forEach((region, r) => {
      mapRegions.add(region.id);
      if (region.cells.length % 2 !== 0) bad(`${path}.regions[${r}].cells`, 'layer-length', 'Region cells are (q, r) pairs: the length must be even.');
    });
    map.placements.forEach((placement, p) => {
      ref(archetypeIds, placement.archetypeId, `${path}.placements[${p}].archetypeId`, 'archetype');
      if (placement.overrides) checkComponents(placement.overrides, `${path}.placements[${p}].overrides`);
    });
    const site: Site = { inBrain: false, mapRegions };
    map.triggers.forEach((trigger, t) => checkTrigger(trigger, `${path}.triggers[${t}]`, site));
    ref(audioIds, map.bgm, `${path}.bgm`, 'audio asset');
  });

  project.archetypes.forEach((archetype, i) => checkComponents(archetype.components, `archetypes[${i}].components`));

  project.animationSets.forEach((set, i) => {
    const path = `animationSets[${i}]`;
    const frames = atlasFrames.get(set.atlasId);
    if (!frames) bad(`${path}.atlasId`, 'unresolved-ref', `No atlas ${set.atlasId}.`);
    for (const [name, clip] of Object.entries(set.clips)) {
      if (clip.frames.length > set.directions) {
        bad(`${path}.clips.${name}.frames`, 'out-of-range', `${clip.frames.length} direction rows, but the set has ${set.directions} directions.`);
      }
      const frameCount = clip.frames[0]!.length;
      clip.frames.forEach((row, d) => {
        if (row.length !== frameCount) bad(`${path}.clips.${name}.frames[${d}]`, 'out-of-range', 'Every direction of a clip must have the same number of frames.');
        if (frames) row.forEach((frame, f) => {
          if (!frames.has(frame)) bad(`${path}.clips.${name}.frames[${d}][${f}]`, 'unresolved-ref', `Atlas ${set.atlasId} has no frame "${frame}".`);
        });
      });
      clip.cues?.forEach((cue, c) => {
        if (cue.frame >= frameCount) bad(`${path}.clips.${name}.cues[${c}].frame`, 'out-of-range', `Cue on frame ${cue.frame}, but the clip has ${frameCount} frames.`);
        ref(feedbackIds, cue.feedbackId, `${path}.clips.${name}.cues[${c}].feedbackId`, 'feedback');
      });
    }
    for (const state of ['idle', 'move', 'dodge', 'hurt', 'death'] as const) {
      if (!(set.stateClips[state] in set.clips)) {
        bad(`${path}.stateClips.${state}`, 'unresolved-ref', `No clip "${set.stateClips[state]}" in this set.`);
      }
    }
  });

  project.attacks.forEach((attack, i) => {
    ref(feedbackIds, attack.feedback.windup, `attacks[${i}].feedback.windup`, 'feedback');
    ref(feedbackIds, attack.feedback.hit, `attacks[${i}].feedback.hit`, 'feedback');
    checkActions(attack.onHit, `attacks[${i}].onHit`);
  });

  project.brains.forEach((brain, i) => {
    const path = `brains[${i}]`;
    const states = new Set<string>();
    brain.states.forEach((state, s) => {
      if (states.has(state.id)) bad(`${path}.states[${s}].id`, 'duplicate-id', `Duplicate state "${state.id}".`);
      states.add(state.id);
    });
    if (!states.has(brain.initial)) bad(`${path}.initial`, 'unresolved-ref', `No state "${brain.initial}".`);
    const site: Site = { inBrain: true, mapRegions: null };
    brain.states.forEach((state, s) => {
      const sp = `${path}.states[${s}]`;
      if (state.behavior.kind === 'patrol') ref(regionIds, state.behavior.regionId, `${sp}.behavior.regionId`, 'region');
      if (state.behavior.kind === 'attack') {
        state.behavior.attackIds.forEach((aid, a) => ref(attackIds, aid, `${sp}.behavior.attackIds[${a}]`, 'attack'));
      }
      checkActions(state.onEnter, `${sp}.onEnter`);
      state.transitions.forEach((transition, t) => {
        if (!states.has(transition.to)) bad(`${sp}.transitions[${t}].to`, 'unresolved-ref', `No state "${transition.to}".`);
        checkConditions(transition.when, `${sp}.transitions[${t}].when`, site);
      });
    });
  });

  project.statusEffects.forEach((status, i) => {
    if (status.maxStacks !== undefined && status.stackMode !== 'stack') {
      bad(`statusEffects[${i}].maxStacks`, 'out-of-range', 'maxStacks applies only to stackMode "stack".');
    }
    checkActions(status.periodic?.actions, `statusEffects[${i}].periodic.actions`);
  });

  project.feedback.forEach((fb, i) => {
    ref(particleIds, fb.particles?.presetId, `feedback[${i}].particles.presetId`, 'particle preset');
    ref(audioIds, fb.sfx?.assetId, `feedback[${i}].sfx.assetId`, 'audio asset');
  });

  project.particlePresets.forEach((preset, i) => {
    frameRef(preset.frame, `particlePresets[${i}].frame`);
    if (preset.speed[0] > preset.speed[1]) bad(`particlePresets[${i}].speed`, 'out-of-range', 'speed is [min, max]: min must not exceed max.');
    if (preset.scale[0] > preset.scale[1]) bad(`particlePresets[${i}].scale`, 'out-of-range', 'scale is [min, max]: min must not exceed max.');
  });

  project.factions.forEach((faction, i) => {
    for (const other of Object.keys(faction.relations)) {
      ref(factionIds, other, `factions[${i}].relations.${other}`, 'faction');
    }
  });

  const keys = new Set<string>();
  project.variables.forEach((variable, i) => {
    if (keys.has(variable.key)) bad(`variables[${i}].key`, 'duplicate-id', `Duplicate variable key "${variable.key}".`);
    keys.add(variable.key);
    if (typeOfValue(variable.initial) !== variable.type) {
      bad(`variables[${i}].initial`, 'type-mismatch', `A ${variable.type} variable cannot start as a ${typeOfValue(variable.initial)}.`);
    }
  });

  project.triggers.forEach((trigger, t) => checkTrigger(trigger, `triggers[${t}]`, global));

  return issues;
}
