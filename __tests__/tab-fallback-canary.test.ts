import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Loading cascade, phase 1 (`docs/plans/loading-cascade.md`).
 *
 * Every lazy tab shows a copy of its OWN first loading frame while its chunk
 * downloads. Stringing, Stats and Profile used to borrow Home's `TabSkeleton`
 * (Home's tiles, no header) and Admin had no fallback — a blank page — so
 * opening any of them flashed the wrong screen first. A source scan, because
 * jsdom never shows a chunk-loading frame.
 */
const shell = readFileSync(join(__dirname, '..', 'components', 'HomeShell.tsx'), 'utf8');

const TABS: Array<[string, string]> = [
  ['StringingTab', 'StringingFallback'],
  ['SkillsTab', 'StatsFallback'],
  ['ProfileTab', 'ProfileFallback'],
  ['AdminTab', 'AdminFallback'],
];

describe('lazy tab fallbacks', () => {
  for (const [tab, fallback] of TABS) {
    it(`${tab} shows ${fallback} while its chunk loads`, () => {
      const line = shell.split('\n').find((l) => l.startsWith(`const ${tab} = dynamic(`));
      expect(line, `${tab} is no longer a dynamic() import — update this canary`).toBeDefined();
      expect(line).toContain(`loading: () => <${fallback} />`);
    });
  }

  it("no tab borrows Home's skeleton", () => {
    expect(shell).not.toMatch(/loading: \(\) => <TabSkeleton/);
  });
});
