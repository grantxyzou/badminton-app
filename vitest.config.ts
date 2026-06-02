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
    exclude: [...configDefaults.exclude, '**/.claude/worktrees/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
