/**
 * 토큰·서명.
 *
 * 규칙 둘:
 *  1. 비밀은 **원문으로 저장하지 않는다.** 저장소에는 해시만 둔다.
 *  2. 비교는 **길이에 상관없이 같은 시간**이 걸리게 한다 — 앞자리부터 맞춰 가며
 *     알아내는 것을 막으려는 것이다.
 */

const enc = new TextEncoder();

/** 안전한 난수 토큰(기본 32바이트 → 64글자 hex) */
export function randomToken(bytes = 32): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  let out = '';
  for (const x of b) out += x.toString(16).padStart(2, '0');
  return out;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input));
  const b = new Uint8Array(digest);
  let out = '';
  for (const x of b) out += x.toString(16).padStart(2, '0');
  return out;
}

/** 시간 차이로 내용을 알아내지 못하게 하는 비교 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 저장된 해시와 들어온 원문을 견준다 */
export async function verifyToken(plain: string | undefined, storedHash: string | null): Promise<boolean> {
  if (!plain || !storedHash) return false;
  return timingSafeEqual(await sha256Hex(plain), storedHash);
}

/* ------------------------------------------------------------------ base64url */

export function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlEncodeString(text: string): string {
  return b64urlEncode(enc.encode(text));
}

export function b64urlDecodeString(text: string): string {
  const pad = text.length % 4 === 0 ? '' : '='.repeat(4 - (text.length % 4));
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* ------------------------------------------------------------------ HMAC */

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  const b = new Uint8Array(sig);
  let out = '';
  for (const x of b) out += x.toString(16).padStart(2, '0');
  return out;
}

export async function hmacB64url(secret: string, message: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return b64urlEncode(new Uint8Array(sig));
}
