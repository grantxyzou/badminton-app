import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'docs/design-system/**',
      '.claude/**',
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
];
