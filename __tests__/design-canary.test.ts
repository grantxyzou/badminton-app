import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Design-system canary — mirrors __tests__/i18n/canary-strings.test.tsx but for
 * the CSS token/class contract. globals.css is the single source of truth for
 * design tokens, and stable + next share it, so a renamed/deleted token is a
 * silent, app-wide regression (and a schema-rule violation). This test pins the
 * canonical tokens + utility classes the shared primitives and the --fs-/--space-
 * scales depend on. If you intentionally rename one, update this list in the
 * same commit.
 */
const css = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');

// Tokens that must be defined (as `--name:`), grouped by role.
const REQUIRED_TOKENS = [
  // color
  '--accent', '--accent-amber', '--text-primary', '--text-secondary', '--text-muted',
  // glass surfaces
  '--glass-bg', '--glass-border', '--glass-blur', '--inner-card-border',
  // radii ladder
  '--radius-xs', '--radius-sm', '--radius-md', '--radius-lg', '--radius-xl', '--radius-pill',
  // type-size scale (standardization Phase 0)
  '--fs-2xs', '--fs-xs', '--fs-sm', '--fs-base', '--fs-md', '--fs-lg',
  // stats headline data scale + compat aliases (design-audit P0/P1)
  '--fs-stat', '--fs-stat-lg', '--color-red', '--color-amber', '--sev-warn',
  // icon glyph-size ladder (mirrors .icon-* classes; design-audit item #3)
  '--icon-xs', '--icon-sm', '--icon-md', '--icon-lg', '--icon-xl',
  // type families (--font-mono was a phantom token; see design-audit)
  '--font-display', '--font-sans', '--font-mono',
  '--lh-tight', '--lh-snug', '--lh-normal',
  // inline spacing scale (Phase 0)
  '--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6',
];

// Utility/surface classes the primitives + cards rely on.
const REQUIRED_CLASSES = [
  '.glass-card', '.glass-card-soft', '.bpm-h1', '.bpm-h2', '.bpm-h3',
  '.section-label', '.fs-2xs', '.fs-sm', '.fs-base', '.cc-btn', '.segment-control',
  '.fs-stat', '.field-error',
];

describe('design-system canary: globals.css token/class contract', () => {
  it.each(REQUIRED_TOKENS)('defines token %s', (token) => {
    expect(css).toContain(`${token}:`);
  });

  it.each(REQUIRED_CLASSES)('defines class %s', (cls) => {
    expect(css).toContain(cls);
  });

  it('pins the canonical --fs scale values (a re-scale must update this test)', () => {
    expect(css).toContain('--fs-2xs: 10px');
    expect(css).toContain('--fs-sm: 12px');
    expect(css).toContain('--fs-base: 13px');
    expect(css).toContain('--fs-lg: 16px');
  });

  it('caps the rectangular radius ladder at 16px (corner-radii ladder rule)', () => {
    expect(css).toContain('--radius-xl: 16px');
    expect(css).toContain('--radius-pill: 100px');
  });

  /* Reduced motion means fewer and gentler, not zero (PRODUCT.md → Accessibility).
     The wildcard must keep opacity in its transition-property allowlist so state
     changes stay legible as changes; collapsing it back to a blanket
     `transition-duration: 0.01ms` on all properties is the regression this pins. */
  it('preserves opacity crossfades under prefers-reduced-motion', () => {
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    const wildcard = block.slice(block.indexOf('*, *::before, *::after'));
    expect(wildcard).toContain('transition-property: opacity');
    // Movement must NOT be in the allowlist — transform transitions have to snap.
    expect(wildcard.slice(0, wildcard.indexOf('}'))).not.toContain('transform');
  });

  /* The thermal fix (perf audit rank 1 + 5): the infinitely-animating, GPU-backed
     elements are hard-stopped and their compositor hints released. Preserving
     crossfades above must never come at the cost of this. */
  it('still hard-stops the GPU-backed infinite animations under reduced motion', () => {
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    for (const sel of ['.aurora-blob-1', '.ring-spinner', '.shimmer-line', '.splash']) {
      expect(block).toContain(sel);
    }
    expect(block).toContain('will-change: auto !important');
  });

  /* Overshoot easing is rare-surface-only (PRODUCT.md → Design Principles #2).
     `.animate-slideUp` was the one broad surface applying it and is deliberately
     gone; re-adding a general-purpose bounce utility should fail here. */
  it('ships no general-purpose overshoot-easing utility class', () => {
    // Match the *definition* (`selector {`), not any mention: the removal is
    // documented by name in a comment at the old site, which should stay.
    expect(css).not.toMatch(/\.animate-slideUp\s*\{/);
  });
});
