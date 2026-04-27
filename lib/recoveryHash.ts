import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const KEY_LENGTH = 32;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };

/**
 * Returns "salt:hash" both hex-encoded.
 */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, KEY_LENGTH, SCRYPT_OPTIONS);
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
  const candidate = scryptSync(pin, saltBuf, KEY_LENGTH, SCRYPT_OPTIONS);
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
