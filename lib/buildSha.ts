'use client';

import { useEffect, useState } from 'react';

/**
 * The deployed build's short commit, read at RUN time from the page's own
 * `<meta name="bpm-build">` (set by `app/layout.tsx`), never inlined from
 * `NEXT_PUBLIC_GIT_SHA` into client code.
 *
 * Inlined, the commit sat inside Profile's chunk (126 KB) and the preview
 * banner's (43 KB), so EVERY deploy renamed both and every phone downloaded
 * them again on its next open — about 54 KB compressed even for a deploy that
 * changed nothing those screens run (measured 2026-11-05: two production
 * builds differing only in the commit). The page itself is never cached, so
 * the tag is always the live build's.
 */
export function readBuildSha(): string {
  if (typeof document === 'undefined') return 'dev';
  const v = document.querySelector('meta[name="bpm-build"]')?.getAttribute('content');
  return (v || 'dev').slice(0, 7);
}

/** The same, for a render: '' on the server and the first client render, so they agree. */
export function useBuildSha(): string {
  const [sha, setSha] = useState('');
  useEffect(() => setSha(readBuildSha()), []);
  return sha;
}
