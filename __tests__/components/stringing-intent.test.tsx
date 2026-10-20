// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import StringingCard from '../../components/stringing/StringingCard';
import StringTensionCard from '../../components/stats/StringTensionCard';
import type { UseGear } from '../../components/stats/useGear';
import enMessages from '../../messages/en.json';
import { resetSharedReads } from '../../lib/sharedRead';
import {
  STRINGING_INTENT_KEY,
  hasStringingIntent,
  requestStringingAt,
  takeStringingIntent,
} from '../../lib/stringingIntent';

/**
 * "Get it strung at 24 lb" (Stats canvas, 2026-10-20): the String tension
 * card hands its number to the Stringing tab, and the request form opens at
 * it. One sessionStorage marker carries it across the tab switch.
 */

function fakeGear(): UseGear {
  const ok = vi.fn(async () => ({ ok: true as const }));
  return {
    gear: { name: 'Lin', items: [], playFormat: 'doubles' } as never,
    rackets: [], active: null, loaded: true, loadError: false, forbidden: false, busy: false, online: true,
    reload: vi.fn(), add: ok, addCustom: ok, activate: ok, remove: ok, setPrefs: ok, setTension: ok,
    setFeel: ok, setLook: ok, setCrosses: ok,
  };
}

/** /shop answers `open`; the level read answers level 3 (→ 24 lb, doubles). */
function mockApi(open: boolean) {
  const fetchMock = vi.fn((url: string) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: async () => {
        const u = String(url);
        if (u.includes('/stringing/shop')) return { open };
        if (u.includes('/stringing/jobs')) return { jobs: [], view: 'player', lastStrungAt: null };
        if (u.includes('/stringing/strings')) return { strings: ['BG80 white'] };
        if (u.includes('/catalog')) return { items: [] };
        return { level: { level: 3 } };
      },
    } as Response),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  resetSharedReads();
  sessionStorage.clear();
  vi.stubGlobal('navigator', { ...global.navigator, onLine: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the marker', () => {
  it('carries a tension once, then is gone', () => {
    requestStringingAt(24);
    expect(hasStringingIntent()).toBe(true);
    expect(takeStringingIntent()).toBe(24);
    expect(takeStringingIntent()).toBeNull();
    expect(hasStringingIntent()).toBe(false);
  });

  it('drops anything the request form could not show', () => {
    for (const raw of ['40', '10', 'abc', '24.5']) {
      sessionStorage.setItem(STRINGING_INTENT_KEY, raw);
      expect(takeStringingIntent()).toBeNull();
      expect(sessionStorage.getItem(STRINGING_INTENT_KEY)).toBeNull();
    }
  });
});

function renderTension(onRequestStringing?: (lbs: number) => void) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <StringTensionCard activeName="Lin" gear={fakeGear()} onRequestStringing={onRequestStringing} />
    </NextIntlClientProvider>,
  );
}

describe('the tension card row', () => {
  it('offers to string it at the card’s own number while the shop is open', async () => {
    mockApi(true);
    const onRequest = vi.fn();
    renderTension(onRequest);
    const row = await screen.findByRole('button', { name: /Get it strung at 24 lb/ });
    expect(screen.queryByText(enMessages.stats.gear.tensionAdvisory)).toBeNull();
    fireEvent.click(row);
    expect(onRequest).toHaveBeenCalledWith(24);
  });

  it('keeps the advisory, and no door, while the shop is closed', async () => {
    mockApi(false);
    renderTension(vi.fn());
    expect(await screen.findByText(enMessages.stats.gear.tensionAdvisory)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Get it strung/ })).toBeNull();
  });

  it('keeps the advisory when nobody wired the row', async () => {
    mockApi(true);
    renderTension();
    expect(await screen.findByText(enMessages.stats.gear.tensionAdvisory)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Get it strung/ })).toBeNull();
  });
});

/** The stepper's figure: the number with its "lb" unit nested beside it. */
const stepperAt = (n: number) => (_: string, el: Element | null) =>
  el?.classList.contains('fs-stat') === true && el.textContent === `${n}lb`;

function renderStringing() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <StringingCard hasIdentity />
    </NextIntlClientProvider>,
  );
}

describe('arriving on Stringing', () => {
  it('opens the request form at the tension it was sent with', async () => {
    mockApi(true);
    requestStringingAt(24);
    renderStringing();
    await screen.findByRole('radiogroup', { name: 'Which string?' });
    await waitFor(() => expect(screen.getByText(stepperAt(24))).toBeTruthy());
    expect(hasStringingIntent()).toBe(false);
  });

  it('opens at the usual 26 from its own button, after a prefilled visit', async () => {
    mockApi(true);
    requestStringingAt(22);
    renderStringing();
    await screen.findByRole('radiogroup', { name: 'Which string?' });
    await waitFor(() => expect(screen.getByText(stepperAt(22))).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: enMessages.recovery.close }));
    fireEvent.click(await screen.findByRole('button', { name: 'Submit a request' }));
    await waitFor(() => expect(screen.getByText(stepperAt(26))).toBeTruthy());
  });

  it('a closed shop consumes the marker and opens nothing', async () => {
    mockApi(false);
    requestStringingAt(24);
    renderStringing();
    expect(await screen.findByText('Coming soon')).toBeTruthy();
    expect(screen.queryByLabelText('Which racket?')).toBeNull();
    expect(hasStringingIntent()).toBe(false);
  });
});
