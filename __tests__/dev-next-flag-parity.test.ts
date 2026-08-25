import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * `npm run dev:next` exists to reproduce the bpm-next build locally, and the
 * only thing that makes it a faithful reproduction is that its flag list
 * matches `deploy-next.yml`. Nothing enforced that, and it drifted: the script
 * was missing GEAR_RECOMMENDER and STATS_V2 (since retired) while both were on in next, so
 * the Gear register rendered darker locally than it does on the deployment —
 * exactly the "looks behind, code is identical" trap the run skill warns about.
 *
 * Sibling of `__tests__/i18n/locale-parity.test.ts`: cheap file-shape assertion
 * standing in for a convention no tool otherwise checks.
 */
function flagsIn(text: string): string[] {
  return [...new Set(text.match(/NEXT_PUBLIC_FLAG_[A-Z0-9_]+/g) ?? [])].sort();
}

const root = join(__dirname, '..');
const devNext = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
}).scripts['dev:next'];
const deployNext = readFileSync(join(root, '.github/workflows/deploy-next.yml'), 'utf8');

describe('dev:next reproduces the bpm-next flag set', () => {
  it('every flag deploy-next.yml sets is also set by the dev:next script', () => {
    const missing = flagsIn(deployNext).filter((f) => !flagsIn(devNext).includes(f));
    expect(missing).toEqual([]);
  });

  it('dev:next sets no flag that bpm-next does not', () => {
    const extra = flagsIn(devNext).filter((f) => !flagsIn(deployNext).includes(f));
    expect(extra).toEqual([]);
  });

  it('dev:next turns each flag on with the canonical literal "true"', () => {
    const notTrue = flagsIn(devNext).filter((f) => !devNext.includes(`${f}=true`));
    expect(notTrue).toEqual([]);
  });
});
