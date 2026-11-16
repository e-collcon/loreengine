/**
 * Base64 for packed map layers. Pure JS: `schema` compiles without the DOM
 * or Node libraries, so neither `atob` nor `Buffer` is available here.
 * Multi-byte elements are stored little-endian regardless of the host.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < 64; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function isBase64(text: string): boolean {
  return BASE64_RE.test(text);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  const n = bytes.length;
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const v = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += ALPHABET[v >> 18]! + ALPHABET[(v >> 12) & 63]! + ALPHABET[(v >> 6) & 63]! + ALPHABET[v & 63]!;
  }
  if (i + 1 === n) {
    const v = bytes[i]! << 16;
    out += ALPHABET[v >> 18]! + ALPHABET[(v >> 12) & 63]! + '==';
  } else if (i + 2 === n) {
    const v = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += ALPHABET[v >> 18]! + ALPHABET[(v >> 12) & 63]! + ALPHABET[(v >> 6) & 63]! + '=';
  }
  return out;
}

/** Decode canonical, padded base64. Throws on anything else. */
export function base64ToBytes(text: string): Uint8Array {
  if (!isBase64(text)) throw new Error('not canonical base64');
  const n = text.length;
  if (n === 0) return new Uint8Array(0);
  const pad = text[n - 1] === '=' ? (text[n - 2] === '=' ? 2 : 1) : 0;
  const out = new Uint8Array((n / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < n; i += 4) {
    const a = LOOKUP[text.charCodeAt(i)]!;
    const b = LOOKUP[text.charCodeAt(i + 1)]!;
    const c = text[i + 2] === '=' ? 0 : LOOKUP[text.charCodeAt(i + 2)]!;
    const d = text[i + 3] === '=' ? 0 : LOOKUP[text.charCodeAt(i + 3)]!;
    const v = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = v >> 16;
    if (o < out.length) out[o++] = (v >> 8) & 255;
    if (o < out.length) out[o++] = v & 255;
  }
  return out;
}

export function u8ToBase64(a: Uint8Array): string {
  return bytesToBase64(a);
}
export function base64ToU8(text: string): Uint8Array {
  return base64ToBytes(text);
}

export function u16ToBase64(a: Uint16Array): string {
  const bytes = new Uint8Array(a.length * 2);
  for (let i = 0; i < a.length; i++) {
    const v = a[i]!;
    bytes[i * 2] = v & 255;
    bytes[i * 2 + 1] = v >> 8;
  }
  return bytesToBase64(bytes);
}
export function base64ToU16(text: string): Uint16Array {
  const bytes = base64ToBytes(text);
  if (bytes.length % 2 !== 0) throw new Error('odd byte count for a 16-bit layer');
  const out = new Uint16Array(bytes.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = bytes[i * 2]! | (bytes[i * 2 + 1]! << 8);
  return out;
}

export function i16ToBase64(a: Int16Array): string {
  return u16ToBase64(new Uint16Array(a.buffer, a.byteOffset, a.length).slice());
}
export function base64ToI16(text: string): Int16Array {
  const u = base64ToU16(text);
  const out = new Int16Array(u.length);
  for (let i = 0; i < u.length; i++) out[i] = u[i]!; // wraps to signed
  return out;
}
