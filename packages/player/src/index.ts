/**
 * @loreengine/player — the game client. It hosts playtest now and the
 * shipped game later; the editor embeds it through this entry point.
 */
export { startClient, MAX_TICKS_PER_FRAME, CAMERA_DEADZONE } from './client.ts';
export type { Client, ClientOptions } from './client.ts';
export { InputMapper, mouseCode } from './input.ts';
