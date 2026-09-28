import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'crypto';

/**
 * ASYNC on the request path. `scryptSync` at N=16384 is ~30–60 ms of blocked
 * event loop on a B1 core, and `/api/players/recover` runs it up to six times
 * per attempt — every other request on the single instance stalled for the
 * duration. `crypto.scrypt` does the same work on libuv's threadpool with the
 * same parameters and the same `salt:hash` output, so nothing stored changes.
 * The module-load constant below keeps the sync form: once, at import.
 */
function derive(pin: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(pin, salt, KEY_LENGTH, SCRYPT_OPTIONS, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

const KEY_LENGTH = 32;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };

/**
 * Returns "salt:hash" both hex-encoded.
 */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(pin, salt);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

/**
 * Constant-time verification. Returns false for any malformed stored value.
 */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  if (typeof stored !== 'string' || !stored.includes(':')) return false;
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  let saltBuf: Buffer, expected: Buffer;
  try {
    saltBuf = Buffer.from(saltHex, 'hex');
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  if (saltBuf.length === 0 || expected.length !== KEY_LENGTH) return false;
  const candidate = await derive(pin, saltBuf);
  return timingSafeEqual(candidate, expected);
}

/**
 * Pre-computed hash used by the constant-time miss path on /recover. Verifying
 * any input against this returns false but takes the same wall-clock time as
 * a real failed verification, so an attacker can't distinguish "no player" from
 * "wrong PIN" via timing.
 */
export const FAKE_HASH: string = (() => {
  const salt = Buffer.from('00000000000000000000000000000000', 'hex');
  const hash = scryptSync('__never_match__', salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
})();
