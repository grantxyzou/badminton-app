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

  /* The 30px rung is a scoped EXCEPTION, not a new cap. The design that
     introduced it ("Visual Colours" §06) reconciles it explicitly: "the 16px
     radius cap now holds for flat-field surfaces and --radius-3xl (30px) is
     scoped to field cards only". The ladder above still stops at 16.

     This is the only guardrail that exists for it. ESLint's radius rule is
     `Property[key.name='borderRadius'] > Literal[raw=/^[0-9]/]` — it catches a
     RAW NUMBER in JSX, so `borderRadius: 'var(--radius-3xl)'` never matches,
     and ESLint does not parse CSS at all. Without the second assertion below,
     nothing but prose stops the next person hardcoding 30px everywhere and
     quietly re-establishing it as the default corner. */
  it('scopes the 30px rung to a token instead of raw literals', () => {
    expect(css).toContain('--radius-3xl: 30px');
    // Every 30px corner must resolve through the token. Strip comments first —
    // the prose explaining this rule necessarily names the literal it forbids,
    // and a doc comment is not a declaration.
    const declarations = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(declarations).not.toMatch(/border-radius:\s*30px/);
  });

  /* Fields and card materials are a token family, not inline values — four
     directories lint bare rgba()/hex at ERROR, so the gradients have to live
     here. Presence-only, same contract as REQUIRED_TOKENS above. */
  it('defines the field + card-material token families', () => {
    for (const token of [
      '--field-base', '--field-home', '--field-signups', '--field-stats',
      '--field-profile', '--field-admin', '--field-scrim',
      '--fcard-bg', '--fcard-blur', '--fcard-inset', '--fcard-shadow',
      '--fcard-pick-bg', '--fcard-good-bg', '--fcard-wait-bg',
      '--fcard-full-bg', '--fcard-error-bg', '--fcard-locked-bg',
      '--fcard-title', '--fcard-label', '--fcard-footnote',
      '--ink-button', '--ink-button-fg',
      // Carries the Stats AA fix. Two components/stats files consume it; if it
      // is renamed away they inherit a colour instead of failing, so nothing
      // else would catch it.
      '--sev-low-label',
      // Padding is load-bearing geometry at radius 30, not decoration --
      // see the derivation beside --fcard-pad in globals.css.
      '--fcard-pad', '--fcard-pad-x', '--fcard-pad-y', '--fcard-inner-radius',
    ]) {
      expect(css).toContain(`${token}:`);
    }
  });

  /* Three facts the field work depends on that fail SILENTLY rather than
     loudly, which is the only reason they are pinned here. */
  it('keeps the field scoping selector and its light-mode escape hatch', () => {
    // Rename this selector and every field rule stops matching. Nothing errors;
    // the app just quietly looks the way it did before.
    expect(css).toContain('html[data-visual="field"]');

    // --sev-low-label lifts to blue-100 on a dark field for AA (4.58:1). Light
    // mode MUST reset it: its card resolves to #eff5fd, where blue-100 measures
    // 1.11:1. This reset is one tidy-up away from being deleted.
    expect(css).toContain('html[data-visual="field"][data-theme="light"]');

    // The locked material is defined by what it removes.
    const locked = css.slice(css.indexOf('.glass-card.is-locked'));
    expect(locked.slice(0, 400)).toContain('backdrop-filter: none');
  });

  /* The inner radius must stay DERIVED. Hand-typing 6px here would look
     identical today and silently desynchronise the moment --fcard-radius or
     --fcard-pad moves, which is exactly how the 30px-vs-12px mismatch that
     prompted this arose in the first place. */
  it('derives the concentric inner radius rather than hard-coding it', () => {
    expect(css).toMatch(
      /--fcard-inner-radius:\s*calc\(\s*var\(--fcard-radius\)\s*-\s*var\(--fcard-pad-x\)\s*\)/
    );
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
