import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

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
      'no-restricted-syntax': [
        'warn',
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
      ],
    },
  },
];

export default config;
