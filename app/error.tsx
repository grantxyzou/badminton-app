'use client';

import { useEffect, useState } from 'react';
import { looksLikeChunkError } from '@/lib/chunkError';

/**
 * The app-wide render boundary. Everything inside the root layout that is not
 * the admin subtree lands here — Home, Sign-Ups, Stats, Profile, the legal
 * pages, `migrate`.
 *
 * It exists because of the store apps. On the web a white screen reads as "the
 * site is down"; inside the Capacitor shell the SAME white screen reads as
 * "this app is broken", and that is the review someone leaves. There is no
 * offline cache to fall back to by design (the only service worker is
 * push-only and has no `fetch` handler), so the honest thing is to say what
 * happened and offer the one action that helps.
 *
 * Copy is hardcoded English on purpose, matching `AdminErrorBoundary`. A
 * boundary that calls `t()` can throw inside itself if next-intl's provider is
 * what failed, and a boundary that throws is just a white screen with extra
 * steps.
 */

/**
 * A chunk error means the bytes this page wants are gone from the server, not
 * that the code is wrong: Azure zip-deploy REPLACES wwwroot, so every
 * content-hashed chunk from the previous build disappears the moment a deploy
 * lands. Anyone holding a page open across one — and the shell's WebView is
 * held open for hours by iOS — 404s on the next lazy import.
 *
 * That person is ONLINE, which is why this cannot copy AdminErrorBoundary and
 * wait for an `online` event: it will never fire, and they would sit looking
 * at a button. Reload immediately instead.
 *
 * The guard is a timestamp, not a boolean, because both failure modes are
 * real. A tight loop (reload → same missing chunk → reload) has to be
 * impossible; but a session that survives two deploys hours apart should still
 * get the automatic fix the second time. `sessionStorage` can throw outright
 * in private mode, so an unreadable value must mean "go ahead once", never
 * "loop".
 */
const RELOAD_STAMP = 'bpm_chunk_reload_at';
const RELOAD_COOLDOWN_MS = 60_000;

function mayAutoReload(): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_STAMP) ?? 0);
    if (Number.isFinite(last) && Date.now() - last < RELOAD_COOLDOWN_MS) return false;
    window.sessionStorage.setItem(RELOAD_STAMP, String(Date.now()));
    return true;
  } catch {
    // No sessionStorage (private mode, blocked site data). One reload is still
    // the right call; without a place to record it we simply cannot promise a
    // second won't follow, and a stale bundle is the likelier failure.
    return true;
  }
}

export default function AppError({ error }: { error: Error & { digest?: string } }) {
  const isChunk = looksLikeChunkError(error);
  const [offline, setOffline] = useState(false);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    // Surface, never swallow — there is no telemetry sink in this app.
    console.error('[AppError] caught:', error);
  }, [error]);

  useEffect(() => {
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    setOffline(!online);
    if (isChunk && online && mayAutoReload()) {
      setReloading(true);
      window.location.reload();
    }
  }, [isChunk]);

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  return (
    <div
      role="alert"
      style={{
        padding: 'var(--space-9) var(--space-7)',
        textAlign: 'center',
        color: 'var(--text-muted)',
      }}
    >
      <p style={{ fontWeight: 600, color: 'var(--text)' }}>
        {isChunk ? 'BPM was updated' : 'Something went wrong'}
      </p>
      <p style={{ fontSize: 'var(--fs-base)', marginTop: 'var(--space-2)' }}>
        {reloading
          ? 'Reloading…'
          : isChunk
            ? 'This page is running an older version. Reload to pick up the new one.'
            : 'That screen failed to load. Reloading usually fixes it.'}
      </p>
      <button
        type="button"
        className="cc-btn cc-btn-ghost"
        style={{ marginTop: 'var(--space-4)' }}
        onClick={() => {
          if (offline) return;
          setReloading(true);
          window.location.reload();
        }}
        disabled={offline || reloading}
        aria-disabled={offline || reloading}
      >
        {offline ? 'Reconnect to reload' : 'Reload now'}
      </button>
    </div>
  );
}
