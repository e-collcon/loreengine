/**
 * A minimal LoreBrix v0.6.0 project file (schema 1), shaped after
 * `legacy/core/types.ts`. It exists so the version gate has a real v0.6.0
 * shape to reject (spec 4.6, 4.7).
 */
export const V060_PROJECT: unknown = {
  schemaVersion: 1,
  id: '0b0f4f0e-6f0a-4c56-9a3d-2f1f6f6f0a01',
  meta: {
    name: 'Emberfall (v0.6.0)',
    author: 'E',
    description: 'A v0.6.0 project file.',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
  },
  maps: [
    {
      id: '0b0f4f0e-6f0a-4c56-9a3d-2f1f6f6f0a02',
      name: 'Village',
      kind: 'hex-iso',
      width: 4,
      height: 4,
      hexSize: 32,
      isoRatio: 0.5,
      layers: [],
      entities: [],
    },
  ],
  activeMapId: '0b0f4f0e-6f0a-4c56-9a3d-2f1f6f6f0a02',
  player: { id: '0b0f4f0e-6f0a-4c56-9a3d-2f1f6f6f0a03', kind: 'player', name: 'Hero' },
  templates: { npcs: [], props: [], doodads: [] },
  rules: { winConditions: [], loseConditions: [] },
  behaviors: [],
  assets: { tilesets: [], spritesheets: [] },
};
