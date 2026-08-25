// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import WhoYouPlayWithCard from '../../components/stats/WhoYouPlayWithCard';
import enMessages from '../../messages/en.json';

/**
 * `/api/stats/partners` gained an owner-or-admin gate, so the card now has
 * THREE non-happy outcomes that must not look alike: refused (403), failed
 * (anything else), and genuinely nobody to show.
 */
function mockPartners(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response),
    ) as unknown as typeof fetch,
  );
}

function renderCard(name: string | null = 'Lin') {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <WhoYouPlayWithCard activeName={name} />
    </NextIntlClientProvider>,
  );
}

const SIGN_IN_COPY = enMessages.stats.signInAgain;
const LOAD_ERROR_COPY = enMessages.stats.partners.error;
const EMPTY_COPY = enMessages.stats.partners.empty;

describe('WhoYouPlayWithCard — refused, failed and empty are three different things', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lists partners when the read succeeds', async () => {
    mockPartners(200, { partners: [{ name: 'Viktor', count: 5 }, { name: 'Akane', count: 2 }] });
    renderCard();
    await waitFor(() => expect(screen.getByText('Viktor')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
  });

  it('renders the muted empty copy — NOT an error — when the member has no partners yet', async () => {
    mockPartners(200, { partners: [] });
    renderCard();
    await waitFor(() => expect(screen.getByText(EMPTY_COPY)).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders the load-error alert on a 500', async () => {
    mockPartners(500, { error: 'load_failed' });
    renderCard();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toBe(LOAD_ERROR_COPY);
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
  });

  // ── The regression f23d7ae introduced ───────────────────────────────────
  it('renders the sign-in state on a 403, distinct from both empty and load-error', async () => {
    mockPartners(403, { error: 'forbidden' });
    renderCard();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toBe(SIGN_IN_COPY);
    expect(screen.queryByText(LOAD_ERROR_COPY)).toBeNull();
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
  });
});
