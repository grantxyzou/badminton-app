import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isFlagOn, FLAGS } from '../lib/flags';
import { SUBPAGES } from '../app/design/_nav';

const originalEnv = { ...process.env };

describe('design preview route — flag + nav isolation', () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_FLAG_DESIGN_PREVIEW;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('registers NEXT_PUBLIC_FLAG_DESIGN_PREVIEW in the FLAGS map', () => {
    expect(FLAGS.NEXT_PUBLIC_FLAG_DESIGN_PREVIEW).toBeDefined();
    expect(FLAGS.NEXT_PUBLIC_FLAG_DESIGN_PREVIEW.description).toMatch(/design[- ]system/i);
  });

  it('isFlagOn(NEXT_PUBLIC_FLAG_DESIGN_PREVIEW) defaults to false (so bpm-stable hides /design)', () => {
    expect(isFlagOn('NEXT_PUBLIC_FLAG_DESIGN_PREVIEW')).toBe(false);
  });

  it('isFlagOn(NEXT_PUBLIC_FLAG_DESIGN_PREVIEW) returns true only when env var is exactly "true"', () => {
    process.env.NEXT_PUBLIC_FLAG_DESIGN_PREVIEW = '1';
    expect(isFlagOn('NEXT_PUBLIC_FLAG_DESIGN_PREVIEW')).toBe(false);
    process.env.NEXT_PUBLIC_FLAG_DESIGN_PREVIEW = 'true';
    expect(isFlagOn('NEXT_PUBLIC_FLAG_DESIGN_PREVIEW')).toBe(true);
  });

  it('SUBPAGES lists all specimen sub-pages in order', () => {
    const hrefs = SUBPAGES.map((p) => p.href);
    expect(hrefs).toEqual([
      '/design/tokens',
      '/design/components',
      '/design/logo',
      '/design/fonts',
      '/design/backgrounds',
      '/design/perf',
      '/design/stats',
    ]);
  });

  it('Type-system sub-page is labeled after the locked pairing, not "Fonts"', () => {
    const typeEntry = SUBPAGES.find((p) => p.href === '/design/fonts');
    expect(typeEntry?.label).toBe('Type system');
    expect(typeEntry?.blurb).toMatch(/Space Grotesk/);
  });

  it('BottomNav does not link to /design (route stays hidden from end users)', () => {
    const source = readFileSync(join(__dirname, '..', 'components', 'BottomNav.tsx'), 'utf8');
    expect(source).not.toMatch(/['"]\/design/);
    // Sanity — make sure we're reading the right file
    expect(source).toMatch(/BottomNav|nav-glass|material-icons/);
  });
});
