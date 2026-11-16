/**
 * Player preferences (spec 6.9, 5.11): the player's, never the project's.
 * They live in the `prefs` store, apart from projects and saves, and are
 * read by the renderer (shake, flashing) and the mixer (volumes).
 */
import { z } from 'zod';

const volume = z.number().min(0).max(1);

export const PlayerPrefsSchema = z.strictObject({
  /** Screen shake: off, half, or full. */
  shake: z.literal(['off', 'half', 'full']),
  /** Flashing sprites, or an outline in their place. */
  flashing: z.literal(['flash', 'outline']),
  volumes: z.strictObject({ master: volume, music: volume, effects: volume }),
});

export type PlayerPrefs = z.output<typeof PlayerPrefsSchema>;

export function defaultPrefs(): PlayerPrefs {
  return { shake: 'full', flashing: 'flash', volumes: { master: 1, music: 0.7, effects: 1 } };
}

/** Valid prefs, or the defaults when what was stored is missing or malformed. */
export function parsePrefs(raw: unknown): PlayerPrefs {
  const parsed = PlayerPrefsSchema.safeParse(raw);
  return parsed.success ? parsed.data : defaultPrefs();
}
