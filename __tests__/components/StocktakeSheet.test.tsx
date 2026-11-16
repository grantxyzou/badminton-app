// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';

/**
 * The scanning stocktake, end to end on screen (docs/plans/string-barcode-stocktake.md):
 * a known packet counts itself, a new code is taught once (here as a reel, so
 * it asks how full), and Save sends one line per string and colour with
 * `source: 'scan'`. The camera is a stand-in that hands codes to the sheet.
 */

let feed: ((code: string) => void) | null = null;
const stop = vi.fn();
vi.mock('@/lib/barcodeScanner', () => ({
  canScan: async () => true,
  startBarcodeScanner: async (_video: HTMLVideoElement, onCode: (code: string) => void) => {
    feed = onCode;
    return { stop };
  },
  cameraFailure: () => 'failed',
  primeBeep: () => {},
  scanFeedback: () => {},
  stopBeep: () => {},
}));

import StocktakeSheet from '@/components/stringing/StocktakeSheet';

const SHEET = {
  strings: [
    {
      label: 'BG80', catalogId: null, appSets: 4, setMetres: 10, reelMetres: 200, gramsPerMetre: 0.41, tareGrams: null,
      colours: ['white'], byColour: [], mixedSets: 0, lastCount: null,
    },
  ],
  customColours: [],
  barcodes: [{ code: 'PACKET-1', label: 'BG80', form: 'packet', color: 'white' }],
};

let posts: Array<{ url: string; body: Record<string, unknown> }> = [];

beforeEach(() => {
  feed = null;
  posts = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (!init || init.method === undefined) return new Response(JSON.stringify(SHEET), { status: 200 });
    const body = JSON.parse(String(init.body));
    posts.push({ url, body });
    if (url.endsWith('/stocktake/barcode')) {
      return new Response(JSON.stringify({ code: body.code, label: body.label, form: body.form, color: body.color ?? null }), { status: 201 });
    }
    return new Response(JSON.stringify({ countedAt: 'now', lines: [{ label: 'BG80', appSets: 4, counted: 11 }] }), { status: 201 });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderSheet = () =>
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <StocktakeSheet onClose={() => {}} />
    </NextIntlClientProvider>,
  );

describe('StocktakeSheet scanning', () => {
  it('counts a known packet, teaches a new reel, and saves the reconcile by colour', async () => {
    renderSheet();
    fireEvent.click(await screen.findByRole('button', { name: /Scan the shelf/ }));
    await waitFor(() => expect(feed).not.toBeNull());

    // A packet the club already taught: counted at once.
    act(() => feed!('PACKET-1'));
    expect(await screen.findByText('+1 packet · BG80 · White')).toBeTruthy();

    // A code the club has never seen: taught once, as a reel of mixed colour.
    act(() => feed!('REEL-NEW'));
    expect(await screen.findByText('New barcode')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Which string?'), { target: { value: 'BG80' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save and count it' }));
    await waitFor(() => expect(posts.some((p) => p.url.endsWith('/stocktake/barcode'))).toBe(true));
    expect(posts[0].body).toEqual({ code: 'REEL-NEW', label: 'BG80', form: 'reel' });

    // A reel asks how full it is.
    fireEvent.click(await screen.findByRole('button', { name: '½' }));
    expect(await screen.findByText('+1 reel · BG80 · Mixed / not sure')).toBeTruthy();

    // Review, then save: one line per string and colour, from the scan.
    fireEvent.click(screen.getByRole('button', { name: 'Review 2 lines' }));
    await waitFor(() => expect(stop).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: 'Save count' }));
    await waitFor(() => expect(posts.some((p) => p.url.endsWith('/api/stringing/stocktake'))).toBe(true));
    const saved = posts.find((p) => p.url.endsWith('/api/stringing/stocktake'))!.body;
    expect(saved.source).toBe('scan');
    expect(saved.lines).toEqual(expect.arrayContaining([
      { label: 'BG80', color: 'white', packets: 1, reels: [] },
      { label: 'BG80', packets: 0, reels: [{ by: 'eye', fullness: 'half' }] },
    ]));
    expect(await screen.findByText(/The shelf now starts from what you counted/)).toBeTruthy();
  });

  it('a code held in view counts once', async () => {
    renderSheet();
    fireEvent.click(await screen.findByRole('button', { name: /Scan the shelf/ }));
    await waitFor(() => expect(feed).not.toBeNull());
    act(() => {
      feed!('PACKET-1');
      feed!('PACKET-1');
      feed!('PACKET-1');
    });
    expect(await screen.findByText('1 packet · 0 reels')).toBeTruthy();
  });
});
