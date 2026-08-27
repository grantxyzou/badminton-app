/**
 * Password hashing for the email+password provider.
 *
 * Deliberately separate from `lib/recoveryHash.ts` (PINs). Two reasons:
 * touching that module would invalidate every stored PIN, and its bare
 * `salt:hash` format cannot survive a cost-parameter change — there is nowhere
 * to record which parameters produced a given hash. This format is
 * self-describing, so N can be raised later without locking anyone out.
 *
 * Cost: N=2^16, r=8, p=1 => 128 * N * r = 64 MiB per hash. OWASP's floor is
 * N=2^17, but this runs on a small Azure App Service instance and 2^17 would
 * mean 128 MiB per concurrent sign-in. Sign-in is rare for a friend group;
 * memory is the binding constraint. Node's default scrypt maxmem is 32 MiB and
 * THROWS above it, so maxmem must be passed explicitly.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const SCHEME = 'scrypt';
const N = 65536;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const MAXMEM = 128 * N * R * 2; // 128 MiB headroom; scrypt needs 128*N*r

const MIN_LENGTH = 10;

/** Passwords so common that length alone does not make them safe. */
const COMMON = new Set([
  'password',
  'password1',
  'password123',
  '1234567890',
  '12345678901',
  'qwertyuiop',
  'letmein123',
  'iloveyou12',
  'admin12345',
  'welcome123',
  'badminton1',
  'shuttlecock',
]);

function derive(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: MAXMEM });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = derive(password, salt);
  return `${SCHEME}$${N}$${R}$${P}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** Constant-time. Returns false for any malformed stored value rather than throwing. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6) return false;
  const [scheme, nStr, rStr, pStr, saltHex, hashHex] = parts;
  if (scheme !== SCHEME) return false;
  const n = Number(nStr),
    r = Number(rStr),
    p = Number(pStr);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (n < 2 || (n & (n - 1)) !== 0) return false; // must be a power of two
  if (r < 1 || p < 1) return false;
  if (!/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(hashHex)) return false;
  let salt: Buffer, expected: Buffer;
  try {
    salt = Buffer.from(saltHex, 'hex');
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length !== KEY_LENGTH) return false;
  let candidate: Buffer;
  try {
    candidate = scryptSync(password, salt, KEY_LENGTH, {
      N: n,
      r,
      p,
      maxmem: 128 * n * r * 2,
    });
  } catch {
    return false;
  }
  return timingSafeEqual(candidate, expected);
}

/**
 * Verifying against this takes the same wall-clock time as a real failed
 * verification, so timing cannot distinguish "no account for that email" from
 * "wrong password". Mirrors `FAKE_HASH` in lib/recoveryHash.ts.
 */
export const FAKE_PASSWORD_HASH: string = (() => {
  const salt = Buffer.from('00000000000000000000000000000000', 'hex');
  const hash = derive('__never_match__', salt);
  return `${SCHEME}$${N}$${R}$${P}$${salt.toString('hex')}$${hash.toString('hex')}`;
})();

/**
 * Length plus a common-password blocklist. No composition rules — they push
 * people toward `Passw0rd!`, which is weaker than a long ordinary phrase.
 */
export function validatePasswordStrength(
  password: string,
): { ok: true } | { ok: false; reason: string } {
  if (typeof password !== 'string' || password.length < MIN_LENGTH) {
    return { ok: false, reason: `Use at least ${MIN_LENGTH} characters.` };
  }
  if (password.length > 200) {
    return { ok: false, reason: 'That password is too long.' };
  }
  if (COMMON.has(password.toLowerCase())) {
    return { ok: false, reason: 'That password is too easy to guess.' };
  }
  return { ok: true };
}
