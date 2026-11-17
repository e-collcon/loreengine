/**
 * SHA-256 for the blob store. `crypto.subtle` is used where it exists; a
 * non-secure origin has none, so the pure-JS implementation in `schema` is
 * the fallback (spec 5.11).
 */
import { sha256HexSync } from '@loreengine/schema';

export { sha256HexSync };

const hex = (bytes: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i]!.toString(16).padStart(2, '0');
  return out;
};

/** SHA-256 as lowercase hex: `crypto.subtle` when available, pure JS otherwise. */
export async function sha256Hex(data: Uint8Array, subtle: SubtleCrypto | null | undefined = globalThis.crypto?.subtle): Promise<string> {
  if (subtle) {
    try {
      const copy = new Uint8Array(data); // a plain ArrayBuffer view, whatever `data` was backed by
      return hex(new Uint8Array(await subtle.digest('SHA-256', copy)));
    } catch {
      // Fall through to the pure-JS path.
    }
  }
  return sha256HexSync(data);
}
