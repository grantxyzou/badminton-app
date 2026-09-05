/**
 * Did this error come from a JS chunk that could not be fetched?
 *
 * Shared by `AdminErrorBoundary` and `app/error.tsx` rather than copied into
 * both. The two boundaries answer it differently — admin waits for a
 * reconnect, the app-level one reloads immediately — but they must AGREE on
 * what a chunk error is, and this repo has been bitten before by a rule added
 * to one copy of a check while the path that actually runs kept its own
 * (CLAUDE.md, `detectSettingsDrift`).
 *
 * Next emits several spellings depending on where the failure happened
 * (webpack runtime, the native `import()`, a `next/dynamic` boundary), so this
 * matches on shape rather than on one string.
 */
export function looksLikeChunkError(error: unknown): boolean {
  const e = error as { name?: string; message?: string } | null;
  const name = e?.name ?? '';
  const msg = e?.message ?? '';
  return (
    name === 'ChunkLoadError' ||
    /ChunkLoadError|Loading chunk|Failed to load chunk|dynamically imported module/i.test(msg)
  );
}
