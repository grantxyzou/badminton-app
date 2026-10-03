import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { isLandingUrl, LANDING_PARAMS, NOT_LANDING_PARAMS } from '@/lib/landingParams';

/**
 * The launch screen steps aside for a landing URL, and it knows one from
 * `LANDING_PARAMS`. The two shells are where those parameters are actually
 * consumed, so the list is only right while it agrees with them — and a list
 * tested against itself agrees with nothing. Every `params.get('x')` in either
 * shell must be CLASSIFIED: a landing, or written down as not one. A new
 * parameter in neither list fails here, at the moment it is added.
 */
const SHELLS = ['components/HomeShell.tsx', 'components/onboarding/SignedOutShell.tsx'];

function paramsRead(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  return [...new Set([...src.matchAll(/params\.get\('([A-Za-z]+)'\)/g)].map((m) => m[1]))];
}

describe('landing params', () => {
  for (const file of SHELLS) {
    it(`${file}: every URL parameter it reads is classified`, () => {
      const known = new Set<string>([...LANDING_PARAMS, ...NOT_LANDING_PARAMS]);
      expect(paramsRead(file).filter((p) => !known.has(p))).toEqual([]);
    });
  }

  it('has no dead entries: a shell still reads each one', () => {
    const read = new Set(SHELLS.flatMap(paramsRead));
    expect([...LANDING_PARAMS, ...NOT_LANDING_PARAMS].filter((p) => !read.has(p))).toEqual([]);
  });

  it('a deep link into a tab is still a launch', () => {
    expect(isLandingUrl('?tab=profile&intent=delete')).toBe(false);
    expect(isLandingUrl('?authError=denied')).toBe(true);
    expect(isLandingUrl('')).toBe(false);
  });
});
