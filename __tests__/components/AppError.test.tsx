// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import AppError from '../../app/error';

/**
 * The app-wide boundary. Its whole reason for existing is the store shell,
 * where a white screen is read as a broken APP rather than a down site — so
 * the cases that matter are the two automatic behaviours, not the markup.
 */
const chunkError = Object.assign(new Error('Loading chunk 42 failed.'), {
  name: 'ChunkLoadError',
});
const plainError = new Error('cannot read properties of undefined');

let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  reload = vi.fn();
  Object.defineProperty(window, 'location', {
    value: { ...window.location, reload },
    writable: true,
    configurable: true,
  });
  window.sessionStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('app/error.tsx', () => {
  it('reloads immediately on a chunk error — the user is ONLINE', async () => {
    // Azure zip-deploy replaces wwwroot, so a WebView held open across a
    // deploy 404s its next chunk while perfectly connected. Waiting for an
    // `online` event (what AdminErrorBoundary does) would wait forever.
    render(<AppError error={chunkError} />);
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('reloads AT MOST once — a genuinely missing chunk must not loop', async () => {
    render(<AppError error={chunkError} />);
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    cleanup();

    // Second mount stands in for the page coming back still broken.
    render(<AppError error={chunkError} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/running an older version/i)).toBeTruthy();
  });

  it('never auto-reloads a render bug — that WOULD loop', async () => {
    render(<AppError error={plainError} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByText(/failed to load/i)).toBeTruthy();
  });

  it('does not reload while offline, and says why', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render(<AppError error={chunkError} />);
    await new Promise((r) => setTimeout(r, 20));

    expect(reload).not.toHaveBeenCalled();
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('disabled')).not.toBeNull();
    expect(btn.textContent).toMatch(/reconnect/i);
  });
});
