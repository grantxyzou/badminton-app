import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

// Selectors for the design-token guardrail — shared between the app-wide
// `warn` rule and the per-area `error` overrides (Phase 4 tightening).
const DESIGN_TOKEN_SELECTORS = [
  {
    selector: 'Literal[value=/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]',
    message:
      'Hardcoded hex color — use a design token from globals.css (var(--accent), --text-*, --sev-*, etc.) instead of a bare hex literal.',
  },
  {
    selector: "Property[key.name='borderRadius'] > Literal[raw=/^[0-9]/]",
    message:
      'Raw border-radius — use the radii ladder token: var(--radius-xs|sm|md|lg|xl|pill).',
  },
];

// Extended guardrail (design-audit P0). These cover the two largest UNGUARDED
// drift categories from the audit: hand-typed numeric `fontSize` and bare
// `rgba()` literals. Kept SEPARATE from DESIGN_TOKEN_SELECTORS and wired only
// into the app-wide `warn` rule — NOT the per-area `error` overrides — because
// there is still a backlog (odd sizes like 15/18/19 with no scale token, and
// legitimate rgba in a few spots). Area sweeps tokenize these, after which the
// area can graduate to `error` by switching to [...DESIGN_TOKEN_SELECTORS,
// ...EXTRA_TOKEN_SELECTORS] in its override.
const EXTRA_TOKEN_SELECTORS = [
  {
    selector: "Property[key.name='fontSize'] > Literal[raw=/^[0-9]/]",
    message:
      'Raw font-size — use the type scale token (var(--fs-2xs|xs|sm|base|md|lg|stat|stat-lg)) or a .fs-* utility class instead of a hand-typed pixel number.',
  },
  {
    selector: 'Literal[value=/rgba\\(\\s*\\d/]',
    message:
      'Bare rgba() literal — use a design token (var(--glass-border), --divider, --text-*, --sev-*, etc.) so the value is theme-aware.',
  },
];

/** @type {import('eslint').Linter.Config[]} */
const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'docs/design-system/**',
      '.claude/**',
      '.remember/**',
      'next-env.d.ts',
      'coverage/**',
    ],
  },
  ...coreWebVitals,
  ...typescript,
  {
    // react-hooks@7 (bundled by eslint-config-next 16) ships the React Compiler
    // ruleset as *errors* — set-state-in-effect, purity, refs, static-components.
    // This app isn't on the React Compiler, and these flag intentional, idiomatic
    // patterns (e.g. fetch-then-setState inside an effect). Keep them visible as
    // warnings — a future "make it compiler-ready" pass (audit Harvest B) can
    // address them — but don't block CI on them. The classic correctness rule
    // `rules-of-hooks` stays an error; `exhaustive-deps` stays a warning.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
  {
    // Build/tooling config files are CommonJS by necessity (Next/Tailwind load
    // them via require), so `require()` is correct there, not a smell.
    files: ['**/*.config.{js,cjs,mjs,ts}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // Unused vars are now an ERROR (was warn) — but `_`-prefixed names stay
    // exempt. That's load-bearing: the security strip pattern destructures
    // secrets out via `const { deleteToken: _dt, pinHash: _ph, ...safe } = rec`
    // (CLAUDE.md) — those `_`-names are intentionally unused and MUST NOT be
    // deleted, or the secret re-enters `...safe`. Same for required-but-unused
    // handler params (`_req`, `_session`, `_pk`).
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // Design-token guardrail (standardization Phase 2). Steers inline styles
    // toward the globals.css tokens instead of hand-typed values. Scoped to
    // app/components/lib source only (not tests). Shipped as `warn` first —
    // there's an existing backlog of ~230 hardcoded colors / ~74 raw radii;
    // the Phase-3 sweeps clear them area-by-area, after which this tightens
    // to `error`. Note: the `var(--accent, #22c55e)` fallback form is NOT
    // flagged — the hex there is inside the var() string, not a bare literal.
    files: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['warn', ...DESIGN_TOKEN_SELECTORS, ...EXTRA_TOKEN_SELECTORS],
    },
  },
  {
    // Phase-4 tightening, applied per cleared area. components/stats is fully
    // swept (radii tokenized; the only remaining hex are recharts SVG defaults
    // carrying eslint-disable), so the guardrail is an ERROR there — new color/
    // radius drift in stats fails CI. Other areas flip to error as their sweeps land.
    files: ['components/stats/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', ...DESIGN_TOKEN_SELECTORS],
    },
  },
];

export default config;
