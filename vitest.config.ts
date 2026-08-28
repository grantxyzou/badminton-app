import { defineConfig, configDefaults } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    // Never scan git worktrees under .claude/ — they carry their own copy of
    // __tests__, which double-counts the suite and surfaces failures from
    // unrelated branches. (Defaults already exclude node_modules, dist, etc.)
    // `.worktrees/` is where this repo actually puts them (see MEMORY.md); the
    // original pattern named `.claude/worktrees/`, which does not exist here —
    // so a linked worktree's tests HAVE been running all along. On 2026-08-28
    // that meant 506 files and 375 failures from another branch's checkout,
    // drowning this branch's real result. Both patterns kept: the wrong one is
    // harmless and someone may yet use that layout.
    exclude: [...configDefaults.exclude, '**/.worktrees/**', '**/.claude/worktrees/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
