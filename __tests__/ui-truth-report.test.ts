import { describe, it, expect } from 'vitest';
import { categorize, delta, UI_CANARIES } from '../scripts/ui-truth-report.mjs';
import { existsSync } from 'node:fs';

describe('ui-truth-report', () => {
  it('categorizes each design-token guardrail message', () => {
    expect(categorize('Hardcoded hex color — use a design token')).toBe('hex colour');
    expect(categorize('Raw border-radius — use the radii ladder')).toBe('radius');
    expect(categorize('Raw font-size — use the type scale')).toBe('font size');
    expect(categorize('Bare rgba() literal — use a design token')).toBe('rgba');
    expect(categorize('Raw Tailwind text-size class — use')).toBe('text class');
    expect(categorize('Raw spacing value — use the ladder token')).toBe('spacing');
    expect(categorize('Something else entirely')).toBeNull();
  });

  it('prints a delta only when there is a previous run', () => {
    expect(delta(5, null)).toBe('');
    expect(delta(5, 5)).toBe(' (=)');
    expect(delta(7, 5)).toBe(' (+2)');
    expect(delta(3, 5)).toBe(' (-2)');
  });

  it('names only canaries that exist', () => {
    for (const c of UI_CANARIES) expect(existsSync(`__tests__/${c}.test.ts`), c).toBe(true);
  });
});
