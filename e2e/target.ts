/**
 * Which app a run points at. Two answers only, and production must be asked
 * for by name: a typo'd target never falls through to production.
 */
export type Target = 'mock' | 'prod';

export const PROD_BASE = 'https://bpm.grantzou.com/bpm';
const MOCK_BASE = 'http://localhost:3100/bpm';

export function target(): Target {
  const t = process.env.E2E_TARGET ?? 'mock';
  if (t !== 'mock' && t !== 'prod') {
    throw new Error(`E2E_TARGET must be "mock" or "prod", not "${t}"`);
  }
  return t;
}

export function baseUrl(): string {
  const fallback = target() === 'prod' ? PROD_BASE : MOCK_BASE;
  return (process.env.E2E_BASE_URL || fallback).replace(/\/$/, '');
}

/**
 * The mock target must point at this machine. Its personas are the seeded
 * famous players with known PINs, and sending those PINs to a real host would
 * be a sign-in attempt against real accounts that share the names.
 */
export function assertMockIsLocal(): void {
  if (target() !== 'mock') return;
  const host = new URL(baseUrl()).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`E2E_TARGET=mock refuses a non-local host (${host}); use E2E_TARGET=prod for production`);
  }
}
