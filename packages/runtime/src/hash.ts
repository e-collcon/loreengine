/**
 * A 64-bit state hash, as 16 hex digits: two independent 32-bit hashes
 * (FNV-1a and a multiplicative mix) over the same text. Used by the replay
 * and save-resume tests and by repro files; it is not cryptographic.
 */
export function hashText(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x85ebca6b);
    b = (b << 13) | (b >>> 19);
  }
  a ^= a >>> 16;
  b = Math.imul(b ^ (b >>> 15), 0xc2b2ae35);
  b ^= b >>> 13;
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
