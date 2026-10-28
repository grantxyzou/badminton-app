// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import StringDetailSheet from '../../components/stringing/StringDetailSheet';
import enMessages from '../../messages/en.json';
import type { CatalogItem } from '../../lib/types';

/**
 * A string's page (docs/plans/stringing-canvas-redesign.md, Decision 9): the
 * hero says whose ratings these are; "Based on your racket and skill" comes
 * from the server's pairing and is absent rather than guessed.
 */
const BG80 = {
  id: 'string-yx-bg80', category: 'string', brand: 'Yonex', model: 'BG80', msrp: 17,
  attributes: {
    stringType: 'Repulsion', gaugeMm: 0.68, gaugeClass: 'Standard', feel: 'Hard', feelScale: 4,
    repulsion: 9, durability: 7, control: 8, hittingSound: 8, ratingSource: 'Brand published',
    tensionMinLbs: 20, tensionMaxLbs: 25, skillLevel: 'Intermediate',
    bestFor: 'All-round power string; stiff, crisp feedback with good tension hold', colors: 'White; Blue',
  },
} as unknown as CatalogItem;

const FIT = {
  racket: 'Yonex Astrox 88D Pro', verdict: 'good_match', reason: 'Enough power to hold length from the rear court.',
  frameTension: [20, 28], stringTension: [20, 25], level: 'Intermediate', stringLevel: 'Intermediate',
};

function wrap(item: CatalogItem, fit: unknown, onRestring = vi.fn()) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
    fit === 'fail'
      ? Promise.resolve({ ok: false, status: 503, json: async () => ({ error: 'read_failed' }) } as Response)
      : Promise.resolve({ ok: true, status: 200, json: async () => fit } as Response)));
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <StringDetailSheet item={item} label="BG80" open onClose={() => {}} price="$32" band="in" onRestring={onRestring} />
    </NextIntlClientProvider>,
  );
  return onRestring;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('StringDetailSheet', () => {
  it('leads with what the string is, its price and its four ratings', async () => {
    wrap(BG80, { fit: null, reason: 'needs_check_in' });
    expect(screen.getByText('Hard feel')).toBeDefined();
    expect(screen.getByText('0.68 mm · standard gauge')).toBeDefined();
    expect(screen.getByText('$32')).toBeDefined();
    expect(screen.getByText('Restring price')).toBeDefined();
    for (const label of ['Power', 'Control', 'Durability', 'Sound']) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  });

  it('says the maker rated it when the catalog says so, and the community otherwise', () => {
    wrap(BG80, { fit: null, reason: 'no_frame' });
    expect(screen.getByText('Rated by Yonex, out of 10')).toBeDefined();
    cleanup();
    wrap({ ...BG80, attributes: { ...BG80.attributes, ratingSource: 'Consensus estimate' } } as CatalogItem, { fit: null });
    expect(screen.getByText('Community estimates, out of 10')).toBeDefined();
    expect(screen.queryByText(/Rated by/)).toBeNull();
  });

  it('shows how it suits the member’s own racket, from the server', async () => {
    wrap(BG80, { fit: FIT });
    expect(await screen.findByText('Yonex Astrox 88D Pro')).toBeDefined();
    expect(screen.getByText('Good match')).toBeDefined();
    expect(screen.getByText('Your frame 20–28 lb · string 20–25 lb')).toBeDefined();
    expect(screen.getByText('Rated Intermediate, like you')).toBeDefined();
    expect(String((globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0])).toContain('/api/stringing/fit?id=string-yx-bg80');
  });

  it('leaves the section out when the engine cannot say, never guessing', async () => {
    wrap(BG80, { fit: null, reason: 'needs_check_in' });
    await waitFor(() => expect(screen.queryByText('Based on your racket and skill')).toBeNull());
  });

  it('says it could not check when the read fails', async () => {
    wrap(BG80, 'fail');
    expect(await screen.findByText(enMessages.home.stringing.offer.fitError)).toBeDefined();
  });

  it('flags a level that differs, in the member’s words', async () => {
    wrap(BG80, { fit: { ...FIT, level: 'Beginner', verdict: 'worth_a_look' } });
    expect(await screen.findByText('Rated Intermediate · you\'re Beginner')).toBeDefined();
    expect(screen.getByText('Worth a look')).toBeDefined();
  });

  it('opens the request with this string, by its shelf name', () => {
    const onRestring = wrap(BG80, { fit: null });
    fireEvent.click(screen.getByRole('button', { name: 'Restring with this string' }));
    expect(onRestring).toHaveBeenCalledWith('BG80');
  });

  it('drops the sections the hero and fit now answer', () => {
    wrap(BG80, { fit: null });
    expect(screen.queryByText('What this means')).toBeNull();
    expect(screen.queryByText('Specs')).toBeNull();
  });
});
