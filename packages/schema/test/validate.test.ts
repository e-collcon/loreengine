import { describe, expect, it } from 'vitest';
import { buildEmberfall, V060_PROJECT } from '@loreengine/fixtures';
import {
  SCHEMA_V1_MESSAGE,
  base64ToBytes,
  base64ToI16,
  base64ToU16,
  bytesToBase64,
  checkProject,
  i16ToBase64,
  parseProject,
  parseProjectJson,
  seededIdFactory,
  serializeProject,
  u16ToBase64,
} from '../src/index.ts';
import type { Action, Condition, Id, Project } from '../src/index.ts';

/** A fresh, mutable Emberfall as the JSON object a file would hold. */
const file = (): any => JSON.parse(serializeProject(buildEmberfall()));
const codes = (raw: unknown): string[] => {
  const r = parseProject(raw);
  return r.ok ? [] : r.issues.map((i) => i.code);
};
const semantic = (mutate: (p: Project) => void): string[] => {
  const p = buildEmberfall();
  mutate(p);
  return checkProject(p).map((i) => `${i.code} @ ${i.path}`);
};
const newId = seededIdFactory(77);
const fresh = <K extends string>(): Id<K> => newId() as Id<K>;

describe('[P1.validate.version] version gate', () => {
  it('accepts Emberfall', () => {
    expect(parseProject(file())).toMatchObject({ ok: true });
  });

  it('rejects a v0.6.0 file with the named message, before parsing anything else', () => {
    const r = parseProject(V060_PROJECT);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues).toHaveLength(1); // nothing is half-parsed: one issue, not a pile of shape errors
    expect(r.issues[0]!.code).toBe('schema-v1');
    expect(r.issues[0]!.message).toBe(SCHEMA_V1_MESSAGE);
    expect(r.issues[0]!.message).toContain('v0.6.0');
  });

  it('rejects schema 1 even when the rest of the file is a valid schema 2 project', () => {
    expect(codes({ ...file(), schemaVersion: 1 })).toEqual(['schema-v1']);
  });

  it('rejects a newer major and a newer minor as "made with a newer LoreEngine"', () => {
    for (const raw of [{ ...file(), schemaVersion: 3 }, { ...file(), schemaMinor: 1 }]) {
      const r = parseProject(raw);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.issues).toHaveLength(1);
      expect(r.issues[0]!.code).toBe('newer-version');
      expect(r.issues[0]!.message).toContain('made with a newer LoreEngine');
    }
  });

  it('rejects files with no usable version and non-objects', () => {
    expect(codes({ name: 'x' })).toEqual(['bad-version']);
    expect(codes({ schemaVersion: '2' })).toEqual(['bad-version']);
    expect(codes({ schemaVersion: 0 })).toEqual(['bad-version']);
    expect(codes(null)).toEqual(['not-a-project']);
    expect(codes([])).toEqual(['not-a-project']);
    expect(parseProjectJson('{ nope')).toMatchObject({ ok: false, issues: [{ code: 'bad-json' }] });
  });
});

describe('[P1.validate.structure] structure: reject, never repair', () => {
  it('rejects unknown keys instead of dropping them', () => {
    const raw = file();
    raw.player = { name: 'Hero' }; // v0's live state in authored data
    expect(codes(raw)).toEqual(['structure:unrecognized_keys']);
    const raw2 = file();
    raw2.settings.isoRatio = 0.5;
    expect(codes(raw2)).toEqual(['structure:unrecognized_keys']);
  });

  it('rejects a missing required field rather than defaulting it', () => {
    const raw = file();
    delete raw.settings.hexSize;
    expect(codes(raw)).toEqual(['structure:invalid_type']);
    const raw2 = file();
    delete raw2.factions;
    expect(codes(raw2)).toEqual(['structure:invalid_type']);
  });

  it('rejects ids that are not UUID v4', () => {
    const raw = file();
    raw.id = 'emberfall';
    expect(codes(raw)).toEqual(['structure:invalid_format']);
  });

  it('rejects unknown action, condition and event variants', () => {
    const raw = file();
    raw.triggers[0].then.push({ type: 'flag-set', flag: 'x' }); // v0's inert action
    expect(codes(raw).length).toBeGreaterThan(0);
    const raw2 = file();
    raw2.triggers[0].when = { type: 'tick' };
    expect(codes(raw2).length).toBeGreaterThan(0);
  });

  it('rejects malformed base64 layers', () => {
    const raw = file();
    raw.maps[0].layers.level = 'not base64!';
    expect(codes(raw).length).toBeGreaterThan(0);
  });
});

describe('[P1.validate.ranges] ranges', () => {
  it('rejects negative durations, probabilities and fractions outside 0..1', () => {
    const neg = file();
    neg.attacks[0].windupMs = -1;
    expect(codes(neg)).toEqual(['structure:too_small']);
    const prob = file();
    prob.triggers[2].given[0].probability = 1.5;
    expect(codes(prob)).toEqual(['structure:too_big']);
    const frac = file();
    frac.maps[0].triggers[2].when.belowFraction = -0.1;
    expect(codes(frac)).toEqual(['structure:too_small']);
  });

  it('rejects maps larger than 256 x 256 and maxLevel outside 1..15', () => {
    const big = file();
    big.maps[0].width = 257;
    expect(codes(big)).toContain('structure:too_big');
    const lvl = file();
    lvl.settings.maxLevel = 16;
    expect(codes(lvl)).toEqual(['structure:too_big']);
  });

  it('rejects a cell above maxLevel', () => {
    expect(semantic((p) => void (p.settings.maxLevel = 1))).toEqual(['out-of-range @ maps[0].layers.level']);
    expect(semantic((p) => void (p.maps[0]!.layers.level[5] = 16))).toEqual(['out-of-range @ maps[0].layers.level']);
  });

  it('rejects layers whose length is not width x height', () => {
    expect(semantic((p) => void (p.maps[0]!.layers.ramp = new Uint8Array(3)))).toEqual(['layer-length @ maps[0].layers.ramp']);
    expect(semantic((p) => void (p.maps[0]!.layers.terrain = new Uint16Array(3)))).toEqual(['layer-length @ maps[0].layers.terrain']);
  });

  it('rejects palette indices and ramp directions out of range', () => {
    expect(semantic((p) => void (p.maps[0]!.layers.terrain[9] = 6))).toEqual(['out-of-range @ maps[0].layers.terrain']);
    expect(semantic((p) => void (p.maps[0]!.layers.ramp[9] = 7))).toEqual(['out-of-range @ maps[0].layers.ramp']);
  });

  it('rejects maxStacks outside stackMode "stack" and inverted [min, max] pairs', () => {
    expect(semantic((p) => void (p.statusEffects[0]!.maxStacks = 2))).toEqual(['out-of-range @ statusEffects[0].maxStacks']);
    expect(semantic((p) => void (p.particlePresets[0]!.speed = [5, 1]))).toEqual(['out-of-range @ particlePresets[0].speed']);
  });
});

describe('[P1.validate.refs] every id resolves', () => {
  it('Emberfall has no semantic issues', () => {
    expect(checkProject(buildEmberfall())).toEqual([]);
  });

  it('rejects a start map or player archetype that does not exist', () => {
    expect(semantic((p) => void (p.startMapId = fresh()))).toEqual(['unresolved-ref @ startMapId']);
    expect(semantic((p) => void (p.settings.playerArchetypeId = fresh()))).toEqual(['unresolved-ref @ settings.playerArchetypeId']);
  });

  it('requires a playerStart on the start map', () => {
    expect(semantic((p) => void (p.maps[0]!.playerStart = undefined))).toEqual(['missing-player-start @ maps[0].playerStart']);
  });

  it('rejects dangling references from every collection', () => {
    const cases: [(p: Project) => void, string][] = [
      [(p) => void (p.maps[0]!.terrainPalette[1] = fresh()), 'unresolved-ref @ maps[0].terrainPalette[1]'],
      [(p) => void (p.maps[0]!.placements[0]!.archetypeId = fresh()), 'unresolved-ref @ maps[0].placements[0].archetypeId'],
      [(p) => void (p.maps[0]!.bgm = fresh()), 'unresolved-ref @ maps[0].bgm'],
      [(p) => void (p.terrains[0]!.top.frame = 'terrain/missing'), 'unresolved-ref @ terrains[0].top.frame'],
      [(p) => void (p.terrains[0]!.top.atlasId = fresh()), 'unresolved-ref @ terrains[0].top.atlasId'],
      [(p) => void (p.archetypes[0]!.components.faction!.factionId = fresh()), 'unresolved-ref @ archetypes[0].components.faction.factionId'],
      [(p) => void (p.archetypes[0]!.components.attacker!.attackIds[0] = fresh()), 'unresolved-ref @ archetypes[0].components.attacker.attackIds[0]'],
      [(p) => void (p.archetypes[2]!.components.brain!.brainId = fresh()), 'unresolved-ref @ archetypes[2].components.brain.brainId'],
      [(p) => void (p.archetypes[0]!.components.sprite!.animationSetId = fresh()), 'unresolved-ref @ archetypes[0].components.sprite.animationSetId'],
      [(p) => void (p.archetypes[0]!.components.feedback!.onHurt = fresh()), 'unresolved-ref @ archetypes[0].components.feedback.onHurt'],
      [(p) => void (p.animationSets[0]!.stateClips.idle = 'nope'), 'unresolved-ref @ animationSets[0].stateClips.idle'],
      [(p) => void (p.animationSets[0]!.clips['idle']!.frames[0]![0] = 'nope'), 'unresolved-ref @ animationSets[0].clips.idle.frames[0][0]'],
      [(p) => void (p.attacks[0]!.feedback.hit = fresh()), 'unresolved-ref @ attacks[0].feedback.hit'],
      [(p) => void (p.brains[0]!.initial = 'nope'), 'unresolved-ref @ brains[0].initial'],
      [(p) => void (p.brains[0]!.states[0]!.transitions[0]!.to = 'nope'), 'unresolved-ref @ brains[0].states[0].transitions[0].to'],
      [(p) => void (p.feedback[0]!.particles!.presetId = fresh()), 'unresolved-ref @ feedback[0].particles.presetId'],
      [(p) => void (p.particlePresets[0]!.frame.frame = 'nope'), 'unresolved-ref @ particlePresets[0].frame.frame'],
      [(p) => void (p.factions[0]!.relations[fresh<'faction'>()] = 'ally'), 'unresolved-ref'],
      [(p) => void ((p.maps[0]!.triggers[0]!.when as { target: { key: string } }).target.key = fresh()), 'unresolved-ref @ maps[0].triggers[0].when.target.key'],
      [(p) => void ((p.triggers[1]!.then[0] as { variableId: string }).variableId = fresh()), 'unresolved-ref @ triggers[1].then[0].variableId'],
    ];
    for (const [mutate, want] of cases) {
      const got = semantic(mutate);
      expect(got).toHaveLength(1);
      expect(got[0]).toContain(want);
    }
  });

  it('rejects duplicate ids, placement keys and trigger ids', () => {
    expect(semantic((p) => void (p.attacks[1]!.id = p.attacks[0]!.id))).toContain('duplicate-id @ attacks[1].id');
    expect(semantic((p) => void (p.maps[0]!.placements[1]!.key = p.maps[0]!.placements[0]!.key))).toContain('duplicate-id @ maps[0].placements[1].key');
    expect(semantic((p) => void (p.triggers[0]!.id = p.maps[0]!.triggers[0]!.id))).toEqual(['duplicate-id @ triggers[0].id']);
  });

  it('rejects teleport to a map that does not exist, and resolves every action reference', () => {
    const bad: Action[] = [
      { type: 'teleport', target: { by: 'player' }, mapId: fresh(), x: 0, y: 0 },
      { type: 'apply-effect', target: { by: 'subject' }, statusId: fresh() },
      { type: 'spawn', archetypeId: fresh(), at: 'subject', count: 1 },
      { type: 'spawn', archetypeId: buildEmberfall().archetypes[0]!.id, at: fresh<'region'>(), count: 1 },
      { type: 'set-trigger-enabled', triggerId: fresh(), enabled: false },
      { type: 'play-feedback', target: { by: 'subject' }, feedbackId: fresh() },
      { type: 'play-sfx', assetId: fresh() },
      { type: 'change-bgm', assetId: fresh(), fadeMs: 100 },
      { type: 'despawn', target: { by: 'archetype', archetypeId: fresh() } },
      { type: 'modify-health', target: { by: 'faction', factionId: fresh() }, delta: -1 },
    ];
    for (const action of bad) {
      const got = semantic((p) => void p.triggers[0]!.then.push(action));
      expect(got, action.type).toHaveLength(1);
      expect(got[0]).toContain('unresolved-ref @ triggers[0].then[1]');
    }
    expect(semantic((p) => void p.triggers[0]!.then.push({ type: 'change-bgm', assetId: null, fadeMs: 100 }))).toEqual([]);
  });
});

describe('[P1.validate.placement] where vocabulary may appear', () => {
  const brainLocal: Condition[] = [
    { type: 'has-target' },
    { type: 'target-within', distance: 2 },
    { type: 'away-from-home', distance: 2 },
  ];

  it('rejects brain-local conditions outside a brain transition, at any nesting depth', () => {
    for (const cond of brainLocal) {
      expect(semantic((p) => void p.triggers[0]!.given.push(cond))).toEqual(['brain-local-condition @ triggers[0].given[0]']);
      expect(semantic((p) => void p.maps[0]!.triggers[0]!.given.push({ type: 'not', of: { type: 'any', of: [cond] } }))).toEqual([
        'brain-local-condition @ maps[0].triggers[0].given[0].of.of[0]',
      ]);
    }
  });

  it('accepts them inside brain transitions (Emberfall uses all three)', () => {
    const text = serializeProject(buildEmberfall());
    for (const cond of brainLocal) expect(text).toContain(`"type": "${cond.type}"`);
  });

  it('allows region events only on map triggers, for that map\'s regions', () => {
    const p0 = buildEmberfall();
    const regionId = p0.maps[0]!.regions[0]!.id;
    expect(
      semantic((p) =>
        void p.triggers.push({ id: fresh(), when: { type: 'region-entered', regionId, who: { by: 'player' } }, given: [], then: [], once: false, enabled: true }),
      ),
    ).toEqual(['region-event-on-global-trigger @ triggers[3].when']);
    expect(
      semantic((p) => void ((p.maps[0]!.triggers[1]!.when as { regionId: string }).regionId = fresh())),
    ).toEqual(['unresolved-ref @ maps[0].triggers[1].when.regionId']);
  });
});

describe('[P2.validate.pattern-match] event patterns cannot match by subject or other', () => {
  it('rejects them: the event is what defines subject and other', () => {
    for (const by of ['subject', 'other'] as const) {
      expect(
        semantic((p) =>
          void p.triggers.push({ id: fresh(), when: { type: 'entity-died', who: { by } }, given: [], then: [], once: false, enabled: true }),
        ),
      ).toEqual(['match-without-context @ triggers[3].when.who']);
    }
    // In conditions and actions they are the normal way to refer to the event's entities.
    expect(
      semantic((p) =>
        void p.triggers.push({
          id: fresh(),
          when: { type: 'attack-hit', attacker: { by: 'player' }, victim: { by: 'any' } },
          given: [{ type: 'alive', who: { by: 'other' } }],
          then: [{ type: 'despawn', target: { by: 'subject' } }],
          once: false,
          enabled: true,
        }),
      ),
    ).toEqual([]);
  });
});

describe('[P1.validate.variables] variables', () => {
  it('rejects duplicate keys and initial values of the wrong type', () => {
    expect(semantic((p) => void (p.variables[1]!.key = p.variables[0]!.key))).toEqual(['duplicate-id @ variables[1].key']);
    expect(semantic((p) => void (p.variables[0]!.initial = 0))).toEqual(['type-mismatch @ variables[0].initial']);
  });

  it('rejects keys outside [a-z0-9_]+', () => {
    const raw = file();
    raw.variables[0].key = 'Talked-To';
    expect(codes(raw)).toEqual(['structure:invalid_format']);
  });

  it('rejects operations and comparisons that do not fit the variable type', () => {
    const p0 = buildEmberfall();
    const bool = p0.variables.find((x) => x.type === 'bool')!.id;
    const num = p0.variables.find((x) => x.type === 'number')!.id;
    const str = p0.variables.find((x) => x.type === 'string')!.id;
    const ops: Action[] = [
      { type: 'set-variable', variableId: bool, op: { kind: 'set', value: 1 } },
      { type: 'set-variable', variableId: bool, op: { kind: 'add', value: 1 } },
      { type: 'set-variable', variableId: num, op: { kind: 'toggle' } },
      { type: 'set-variable', variableId: str, op: { kind: 'add', value: 1 } }, // strings never concatenate
      { type: 'set-variable', variableId: num, op: { kind: 'set-from', sourceVariableId: str } },
    ];
    for (const action of ops) {
      const got = semantic((p) => void p.triggers[0]!.then.push(action));
      expect(got).toHaveLength(1);
      expect(got[0]).toContain('type-mismatch');
    }
    expect(semantic((p) => void p.triggers[0]!.given.push({ type: 'variable', variableId: num, comparator: '<', value: 'x' }))).toEqual([
      'type-mismatch @ triggers[0].given[0].value',
    ]);
    expect(semantic((p) => void p.triggers[0]!.given.push({ type: 'variable', variableId: bool, comparator: '<', value: true }))).toEqual([
      'type-mismatch @ triggers[0].given[0].comparator',
    ]);
    expect(semantic((p) => void p.triggers[0]!.given.push({ type: 'variable', variableId: num, comparator: '>=', value: 3 }))).toEqual([]);
  });
});

describe('[P1.base64] packed layer codecs', () => {
  it('round-trips bytes of every length mod 3', () => {
    for (let n = 0; n < 40; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 255);
      expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
    }
  });

  it('matches known vectors', () => {
    const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
    expect(bytesToBase64(ascii(''))).toBe('');
    expect(bytesToBase64(ascii('f'))).toBe('Zg==');
    expect(bytesToBase64(ascii('fo'))).toBe('Zm8=');
    expect(bytesToBase64(ascii('foobar'))).toBe('Zm9vYmFy');
  });

  it('stores 16-bit layers little-endian and keeps the sign of Int16', () => {
    expect(Array.from(base64ToBytes(u16ToBase64(Uint16Array.of(0x1234))))).toEqual([0x34, 0x12]);
    expect(Array.from(base64ToU16(u16ToBase64(Uint16Array.of(0, 1, 65535, 300))))).toEqual([0, 1, 65535, 300]);
    expect(Array.from(base64ToI16(i16ToBase64(Int16Array.of(-1, -32768, 32767, 5))))).toEqual([-1, -32768, 32767, 5]);
  });

  it('rejects non-canonical input', () => {
    expect(() => base64ToBytes('Zg')).toThrow();
    expect(() => base64ToBytes('Z*==')).toThrow();
    expect(() => base64ToU16('Zg==')).toThrow();
  });
});
