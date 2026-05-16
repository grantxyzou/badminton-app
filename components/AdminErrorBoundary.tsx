'use client';

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
  isChunkError: boolean;
  isOffline: boolean;
}

function looksLikeChunkError(error: unknown): boolean {
  const e = error as { name?: string; message?: string } | null;
  const name = e?.name ?? '';
  const msg = e?.message ?? '';
  return (
    name === 'ChunkLoadError' ||
    /ChunkLoadError|Loading chunk|Failed to load chunk|dynamically imported module/i.test(msg)
  );
}

/**
 * Containment for the admin subtree.
 *
 * Two failure shapes land here:
 *  1. A CommandCenter card throws during render (e.g. mapping over data a
 *     failed fetch left undefined) — generic render error.
 *  2. The lazy `AdminTab` chunk can't be downloaded offline — ChunkLoadError.
 *     React.lazy CACHES the rejected import, so a remount re-throws the
 *     cached rejection forever; the only real recovery is a full document
 *     reload (re-fetches the chunk). That's why "Retry" here is
 *     `location.reload()`, not a React remount — and why we auto-reload
 *     when connectivity returns (the "it didn't recover when I came back
 *     online" complaint).
 *
 * Still does NOT catch floating async rejections (uncaught `await fetch()`
 * in a `void load()` effect) — those need the per-card `catch` pass.
 */
export default class AdminErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, isChunkError: false, isOffline: false };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { hasError: true, isChunkError: looksLikeChunkError(error) };
  }

  componentDidCatch(error: unknown) {
    // No telemetry sink yet (no Sentry) — surface, never swallow silently.
    console.error('[AdminErrorBoundary] caught:', error);
  }

  componentDidMount() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.setState({ isOffline: true });
    }
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
  }

  componentWillUnmount() {
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
  }

  // Reconnecting is the natural recovery point for a chunk that failed to
  // download. The `online` event only fires on a transition, so this is at
  // most one reload per reconnect — no loop. Only auto-reload for chunk
  // errors; a generic render bug could reload-loop, so that stays manual.
  handleOnline = () => {
    if (this.state.hasError && this.state.isChunkError) {
      window.location.reload();
      return;
    }
    this.setState({ isOffline: false });
  };

  handleOffline = () => {
    this.setState({ isOffline: true });
  };

  handleReload = () => {
    // Guard: a full reload is a server round-trip — doomed while offline
    // and it replaces the contained fallback with a hard browser error
    // page (the "reload breaks the site" report). Only act when online.
    if (this.state.isOffline) return;
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--text-muted)' }}
        >
          <p style={{ fontWeight: 600, color: 'var(--text)' }}>
            {this.state.isChunkError ? 'Admin needs a connection' : 'Couldn’t load admin'}
          </p>
          <p style={{ fontSize: 13, marginTop: 6 }}>
            {this.state.isChunkError
              ? 'It’ll reload automatically when you’re back online.'
              : 'Something went wrong loading this view.'}
          </p>
          <button
            type="button"
            className="cc-btn cc-btn-ghost"
            style={{ marginTop: 14 }}
            onClick={this.handleReload}
            disabled={this.state.isOffline}
            aria-disabled={this.state.isOffline}
          >
            {this.state.isOffline ? 'Reconnect to reload' : 'Reload now'}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
