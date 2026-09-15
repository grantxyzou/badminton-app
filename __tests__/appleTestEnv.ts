import { generateKeyPairSync, type KeyObject } from 'node:crypto';

/**
 * Configures Sign in with Apple for a test with a REAL, throwaway P-256 key, so
 * `configuredProviders`, `appleClient` and the revoke JWT all take their
 * configured paths rather than the not-configured early return.
 *
 * Returns the public key (to verify a signature) and a restore function.
 */
const KEYS = ['APPLE_CLIENT_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY'] as const;

export function configureAppleForTest(): { publicKey: KeyObject; restore: () => void } {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  process.env.APPLE_CLIENT_ID = 'com.motioncraft.bpm.web';
  process.env.APPLE_TEAM_ID = 'ABCDE12345';
  process.env.APPLE_KEY_ID = 'KEY1234567';
  // As it has to be written in an App Setting: literal \n escapes.
  process.env.APPLE_PRIVATE_KEY = pem.replace(/\n/g, '\\n');
  return {
    publicKey: pair.publicKey,
    restore: () => {
      for (const k of KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    },
  };
}
