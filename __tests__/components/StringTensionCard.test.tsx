// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import StringTensionCard from '../../components/stats/StringTensionCard';
import type { UseGear } from '../../components/stats/useGear';
import enMessages from '../../messages/en.json';

function fakeGear(overrides: Partial<UseGear> = {}): UseGear {
  return {
    gear: null,
    rackets: [],
    active: null,
    loaded: true,
    loadError: false,
    busy: false,
    online: true,
    reload: vi.fn(),
    add: vi.fn(async () => ({ ok: true as const })),
    activate: vi.fn(async () => ({ ok: true as const })),
    remove: vi.fn(async () => ({ ok: true as const })),
    setPrefs: vi.fn(async () => ({ ok: true as const })),
    ...overrides,
  };
}

function mockLevel(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response),
    ) as unknown as typeof fetch,
  );
}

function renderCard(gear: UseGear = fakeGear(), suppressed = false) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <StringTensionCard activeName="Lin" gear={gear} suppressed={suppressed} />
    </NextIntlClientProvider>,
  );
}

const TENSION_ERROR = enMessages.stats.gear.tensionError;
const SIGN_IN_COPY = enMessages.stats.signInAgain;

describe('StringTensionCard — no number without something behind it', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders the advice when the level and the gear doc both load', async () => {
    mockLevel(200, { level: { level: 3 } });
    renderCard(fakeGear({ gear: { name: 'Lin', items: [], playFormat: 'doubles' } as never }));
    // round(21 + 3) = 24, doubles.
    await waitFor(() => expect(screen.getByText('24')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('picks the singles number when the stored format says singles', async () => {
    mockLevel(200, { level: { level: 3 } });
    renderCard(fakeGear({ gear: { name: 'Lin', items: [], playFormat: 'singles' } as never }));
    await waitFor(() => expect(screen.getByText('26')).toBeTruthy());
  });

  // ── C1: a failed level read used to vanish the card ─────────────────────
  it('renders NOTHING when the level read succeeds and there is no level yet', async () => {
    mockLevel(200, { level: null });
    const { container } = renderCard();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('renders the error state when the level read FAILS — not the same silence', async () => {
    mockLevel(500, { error: 'load_failed' });
    renderCard();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toBe(TENSION_ERROR);
  });

  it('renders the sign-in state when the level read is refused (403)', async () => {
    mockLevel(403, { error: 'forbidden' });
    renderCard();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toBe(SIGN_IN_COPY);
  });

  // ── B1: a failed gear read used to print a doubles number at a singles
  //        player, with the Doubles segment lit as a stored preference ─────
  it('refuses to print a number when the gear read failed, so the format is unknown', async () => {
    mockLevel(200, { level: { level: 3 } });
    renderCard(fakeGear({ loadError: true, loaded: true }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toBe(TENSION_ERROR);
    expect(screen.queryByText('24')).toBeNull();
    expect(screen.queryByText(enMessages.stats.gear.doubles)).toBeNull();
  });

  it('still lights Doubles for a member whose gear doc loaded EMPTY (a real default)', async () => {
    mockLevel(200, { level: { level: 3 } });
    renderCard(fakeGear({ gear: null, loaded: true, loadError: false }));
    await waitFor(() => expect(screen.getByText('24')).toBeTruthy());
    expect(screen.getByText(enMessages.stats.gear.doubles).getAttribute('aria-current')).toBe('true');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('stays silent when suppressed, errors included', async () => {
    mockLevel(500, { error: 'load_failed' });
    const { container } = renderCard(fakeGear({ loadError: true }), true);
    await waitFor(() => expect(container.textContent).toBe(''));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

/**
 * A refused format change must say so.
 *
 * The toggle was `void gear.setPrefs(...)`, defended in a comment as "silent
 * by design: the preference is not something the member is waiting on". The
 * headline number on this card IS `recommendTension(level, format)`, so
 * tapping Singles is precisely the member asking for a different number. On a
 * refusal `useGear` correctly leaves the stored value alone — which means the
 * segment snaps back to Doubles, the number does not move, and nothing
 * explains why. A dead control, unchanged by reload.
 */
describe('StringTensionCard — a refused format change is not silent', () => {
  afterEach(cleanup);

  it('names a lapsed session instead of doing nothing at all', async () => {
    mockLevel(200, { level: { level: 3 } });
    const gear = fakeGear({
      setPrefs: vi.fn(async () => ({ ok: false as const, reason: 'unauthorized' as const })),
    });
    renderCard(gear);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Singles' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Singles' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(SIGN_IN_COPY));
    expect(gear.setPrefs).toHaveBeenCalledWith({ playFormat: 'singles' });
  });

  it('keeps the recommendation on screen — only the change was refused', async () => {
    mockLevel(200, { level: { level: 3 } });
    renderCard(fakeGear({
      setPrefs: vi.fn(async () => ({ ok: false as const, reason: 'error' as const })),
    }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Singles' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Singles' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(TENSION_ERROR));
    // The number is still valid data; a refused change must not blank the card.
    expect(screen.getByRole('button', { name: 'Doubles' })).toBeTruthy();
  });

  it('stays silent when the change is accepted', async () => {
    mockLevel(200, { level: { level: 3 } });
    const gear = fakeGear();
    renderCard(gear);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Singles' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Singles' }));

    await waitFor(() => expect(gear.setPrefs).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
