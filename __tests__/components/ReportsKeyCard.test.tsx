// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ReportsKeyCard from '@/components/admin/metrics/ReportsKeyCard';

/** The weekly-report key card: the key is shown once, a rotation asks first,
 *  and a status that failed to load says so rather than offering a button. */

let status: unknown = { configured: false, keyCreatedAt: null, lastUsedAt: null };
let statusOk = true;
const posts: string[] = [];

function mockFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts.push(url);
      return new Response(JSON.stringify({ key: 'bpm.' + 'a'.repeat(48) }), { status: 200 });
    }
    return statusOk ? new Response(JSON.stringify(status), { status: 200 }) : new Response('x', { status: 503 });
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  posts.length = 0;
  statusOk = true;
  status = { configured: false, keyCreatedAt: null, lastUsedAt: null };
});

describe('<ReportsKeyCard />', () => {
  it('creates a key and shows it once', async () => {
    mockFetch();
    render(<ReportsKeyCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create key' }));
    expect(await screen.findByText('bpm.' + 'a'.repeat(48))).toBeTruthy();
    expect(screen.getByText(/never paste/)).toBeTruthy();
    expect(posts).toHaveLength(1);
  });

  it('asks before replacing a key that exists, and does nothing on No', async () => {
    status = { configured: true, keyCreatedAt: '2026-10-01T00:00:00.000Z', lastUsedAt: null };
    mockFetch();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<ReportsKeyCard />);
    expect(await screen.findByText(/Not used yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create a new key' }));
    expect(window.confirm).toHaveBeenCalled();
    expect(posts).toHaveLength(0);
  });

  it('says a failed status load failed', async () => {
    statusOk = false;
    mockFetch();
    render(<ReportsKeyCard />);
    expect(await screen.findByText("Couldn't load the key status.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Create/ })).toBeNull();
  });
});
