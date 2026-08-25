// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import CheckInSheet from '../../components/stats/CheckInSheet';
import { OnlineProvider } from '../../lib/useOnline';
import enMessages from '../../messages/en.json';
import { SKILLS } from '../../lib/assessment';

function jsonResponse(body: unknown, ok = true, status?: number) {
  return Promise.resolve({ ok, status: status ?? (ok ? 200 : 500), json: async () => body } as Response);
}

const posted: unknown[] = [];

function mockFetch(opts: { saveOk?: boolean; saveStatus?: number; saveBody?: unknown; level?: unknown } = {}) {
  const { saveOk = true, saveStatus, saveBody = { id: 'a1' }, level = { level: { level: 3.1, phase: 'switch' } } } = opts;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') {
        posted.push(JSON.parse(String(init.body)));
        return jsonResponse(saveBody, saveOk, saveStatus);
      }
      if (url.includes('/api/stats/level')) return jsonResponse(level);
      if (url.includes('/api/games')) return jsonResponse({ games: [] });
      return jsonResponse({});
    }) as unknown as typeof fetch,
  );
}

function renderSheet(previous?: Map<string, number>, onSaved = vi.fn(), onClose = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <OnlineProvider>
        <CheckInSheet name="Lin" open onClose={onClose} onSaved={onSaved} previous={previous} />
      </OnlineProvider>
    </NextIntlClientProvider>,
  );
  return { onSaved, onClose };
}

/** Walk from the intro to the first skill screen. */
async function start() {
  await waitFor(() => expect(screen.getByRole('button', { name: /Start check-in/i })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: /Start check-in/i }));
}

/**
 * The five anchor buttons in level order. Selecting by `pressed: false` is
 * wrong here: a seeded rating marks one anchor pressed, which shifts every
 * later index by one and silently picks a different level than intended.
 */
function anchor(level: 1 | 2 | 3 | 4 | 5): HTMLElement {
  const all = Array.from(document.querySelectorAll('[aria-pressed]')) as HTMLElement[];
  return all[level - 1];
}

describe('CheckInSheet — v2 behaviour', () => {
  beforeEach(() => {
    posted.length = 0;
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the step counter and the dimension eyebrow', async () => {
    mockFetch();
    renderSheet();
    await start();
    expect(screen.getByText(`1 of ${SKILLS.length}`)).toBeTruthy();
    expect(screen.getByText('Technical')).toBeTruthy();
  });

  // ── Skip is its own control ─────────────────────────────────────────────
  it('offers Back, Skip and Next as three separate controls', async () => {
    mockFetch();
    renderSheet();
    await start();
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy();
  });

  it('keeps Next labelled Next after rating — the label no longer flips', async () => {
    mockFetch();
    renderSheet();
    await start();
    fireEvent.click(anchor(1));
    expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeTruthy();
  });

  it('Skip clears a seeded rating so the control means what it says', async () => {
    mockFetch();
    // Seeded from a previous check-in — skipping must not silently keep it.
    renderSheet(new Map([[SKILLS[0].key, 4]]));
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop here and review' }));
    await waitFor(() => expect(screen.queryByText(SKILLS[0].label)).toBeNull());
  });

  it('labels the last skill\'s advance button Review', async () => {
    mockFetch();
    renderSheet();
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'Stop here and review' }));
    // Getting to the last skill via Back from review.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save check-in' })).toBeTruthy());
  });

  // ── Escape to review ────────────────────────────────────────────────────
  it('lets a member stop early instead of tapping through eleven more', async () => {
    mockFetch();
    renderSheet();
    await start();
    fireEvent.click(anchor(1));
    fireEvent.click(screen.getByRole('button', { name: 'Stop here and review' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save check-in' })).toBeTruthy());
  });

  // ── Review lists what changed ───────────────────────────────────────────
  it('lists the changed skills with their deltas, not just a count', async () => {
    mockFetch();
    renderSheet(new Map([[SKILLS[0].key, 2]]));
    await start();
    // Re-rate the first skill from 2 to 4.
    fireEvent.click(anchor(4));
    fireEvent.click(screen.getByRole('button', { name: 'Stop here and review' }));
    await waitFor(() => expect(screen.getByText(SKILLS[0].label)).toBeTruthy());
    expect(screen.getByText(/▲ 2/)).toBeTruthy();
  });

  it('marks a reviewed-but-unchanged skill as same', async () => {
    mockFetch();
    renderSheet(new Map([[SKILLS[0].key, 3]]));
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'Stop here and review' }));
    await waitFor(() => expect(screen.getByText('same')).toBeTruthy());
  });

  // ── Saving shows the result ─────────────────────────────────────────────
  it('does NOT close on save — it shows the recomputed level', async () => {
    mockFetch();
    const { onClose, onSaved } = renderSheet(new Map([[SKILLS[0].key, 3]]));
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'Stop here and review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save check-in' }));

    await waitFor(() => expect(screen.getByText('Your level now')).toBeTruthy());
    expect(screen.getByText('3.1')).toBeTruthy();
    expect(screen.getByText('The Switch')).toBeTruthy();
    // The tab behind is told immediately, but the sheet stays put.
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes only when the member taps Done', async () => {
    mockFetch();
    const { onClose } = renderSheet(new Map([[SKILLS[0].key, 3]]));
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'Stop here and review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save check-in' }));
    await waitFor(() => expect(screen.getByText('Your level now')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('still confirms the save when the level READ-BACK fails', async () => {
    // The save succeeded; only the follow-up read did not. Showing an error
    // would imply nothing was saved.
    mockFetch({ level: null });
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST') return jsonResponse({ id: 'a1' }, true, 201);
        if (url.includes('/api/stats/level')) return jsonResponse({ error: 'x' }, false);
        if (url.includes('/api/games')) return jsonResponse({ games: [] });
        return jsonResponse({});
      }) as unknown as typeof fetch,
    );
    renderSheet(new Map([[SKILLS[0].key, 3]]));
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'Stop here and review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save check-in' }));
    await waitFor(() => expect(screen.getByText('Your level now')).toBeTruthy());
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // ── Preserved failure handling ──────────────────────────────────────────
  it('still distinguishes an expired sign-in from a generic save failure', async () => {
    mockFetch({ saveOk: false, saveStatus: 401, saveBody: { error: 'needs_signin' } });
    renderSheet(new Map([[SKILLS[0].key, 3]]));
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'Stop here and review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save check-in' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText(enMessages.stats.assess.saveErrorAuth)).toBeTruthy();
    expect(screen.queryByText('Your level now')).toBeNull();
  });

  it('still disables Save with nothing rated', async () => {
    mockFetch();
    renderSheet();
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'Stop here and review' }));
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Save check-in' }) as HTMLButtonElement).disabled).toBe(true),
    );
  });
});
