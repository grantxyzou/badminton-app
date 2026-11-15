// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import StringDetailSheet from '../../components/stringing/StringDetailSheet';
import enMessages from '../../messages/en.json';
import type { CatalogItem } from '../../lib/types';

/**
 * A string's page (docs/plans/stringing-canvas-redesign.md, Decision 9; Grant,
 * 2026-11-12: "this section should more focus on the match and recommendation
 * of the stringer"): a slim strip says what it is; "How it suits you" leads,
 * from the server's pairing and absent rather than guessed; the stringer's
 * note follows; the ratings and specs wait behind a disclosure.
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

function wrap(item: CatalogItem, fit: unknown, onRestring = vi.fn(), note: string | null = null) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
    fit === 'fail'
      ? Promise.resolve({ ok: false, status: 503, json: async () => ({ error: 'read_failed' }) } as Response)
      : Promise.resolve({ ok: true, status: 200, json: async () => fit } as Response)));
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <StringDetailSheet item={item} label="BG80" open onClose={() => {}} price="$32" band="in" clubCount={4} note={note} onRestring={onRestring} />
    </NextIntlClientProvider>,
  );
  return onRestring;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('StringDetailSheet', () => {
  it('says what it is under its name: type and feel, gauge and stock in words', () => {
    wrap(BG80, { fit: null, reason: 'needs_check_in' });
    const strip = screen.getByTestId('string-strip');
    expect(within(strip).getByText('Repulsion · Hard feel')).toBeDefined();
    expect(within(strip).getByText('0.68 mm · In stock')).toBeDefined();
  });

  /* The canvas, frame 3 (2026-11-12): the packet beside what it is for and the
     maker's ratings as tinted bars; the price at the foot, beside its button
     (Grant: "move price to the bottom"). */
  it('shows how it plays as tinted bars, repulsion first, and the price last', () => {
    wrap(BG80, { fit: null, reason: 'needs_check_in' });
    expect(screen.getByText('All-round power string; stiff, crisp feedback with good tension hold')).toBeDefined();
    const bars = Array.from(screen.getByTestId('trait-bars').querySelectorAll<HTMLElement>('[data-trait]'));
    expect(bars.map((b) => [b.dataset.trait, b.textContent])).toEqual([
      ['power', 'Repulsion9'], ['durability', 'Durability7'], ['control', 'Control8'], ['sound', 'Sound8'],
    ]);
    const price = screen.getByTestId('string-price');
    expect(price.textContent).toBe('Restring with BG80$32');
    // The price follows everything else in the sheet's body.
    expect(screen.getByRole('button', { name: 'Ratings and specs' }).compareDocumentPosition(price) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('draws shock absorption when the maker gives it, under its full name', () => {
    wrap({ ...BG80, attributes: { ...BG80.attributes, shockAbsorption: 6 } } as CatalogItem, { fit: null });
    const bar = screen.getByTestId('trait-bars').querySelector<HTMLElement>('[data-trait="shock"]')!;
    expect(bar.textContent).toBe('Shock absorption6');
  });

  it('keeps the specs closed until asked, then says whose ratings they are', () => {
    wrap(BG80, { fit: null, reason: 'needs_check_in' });
    const toggle = screen.getByRole('button', { name: 'Ratings and specs' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Rated by Yonex, out of 10')).toBeNull();
    expect(screen.queryByText('4 in the club play it')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Rated by Yonex, out of 10')).toBeDefined();
    expect(screen.getByText('4 in the club play it')).toBeDefined();
  });

  it('says the maker rated it when the catalog says so, and the community otherwise', () => {
    wrap(BG80, { fit: null, reason: 'no_frame' });
    fireEvent.click(screen.getByRole('button', { name: 'Ratings and specs' }));
    expect(screen.getByText('Rated by Yonex, out of 10')).toBeDefined();
    cleanup();
    wrap({ ...BG80, attributes: { ...BG80.attributes, ratingSource: 'Consensus estimate' } } as CatalogItem, { fit: null });
    fireEvent.click(screen.getByRole('button', { name: 'Ratings and specs' }));
    expect(screen.getByText('Community estimates, out of 10')).toBeDefined();
    expect(screen.queryByText(/Rated by/)).toBeNull();
  });

  it('puts the stringer’s note in the same card as how it suits you (Grant: "should we combine?")', async () => {
    wrap(BG80, { fit: FIT }, vi.fn(), 'My go-to for hard hitters. I’d string it at 26 lb.');
    await screen.findByText('Yonex Astrox 88D Pro');
    const card = document.querySelector<HTMLElement>('[data-verdict="good_match"]')!;
    expect(within(card).getByTestId('stringer-note').textContent).toContain('My go-to for hard hitters. I’d string it at 26 lb.');
    expect(within(card).getByText('Your stringer recommends')).toBeDefined();
    // How it plays comes first, then the card, then the specs.
    const order = [screen.getByTestId('trait-bars'), card, screen.getByRole('button', { name: 'Ratings and specs' })];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('keeps the stringer’s note when the engine cannot say', async () => {
    wrap(BG80, { fit: null, reason: 'no_frame' }, vi.fn(), 'Hard hitters: 26 lb.');
    expect(await screen.findByText('Hard hitters: 26 lb.')).toBeDefined();
    expect(screen.queryByText('How it suits you')).toBeNull();
  });

  it('shows no stringer section when the stringer has written no note', async () => {
    wrap(BG80, { fit: FIT }, vi.fn(), '   ');
    await screen.findByText('Yonex Astrox 88D Pro');
    expect(screen.queryByText('Your stringer recommends')).toBeNull();
  });

  it('shows how it suits the member’s own racket, from the server', async () => {
    wrap(BG80, { fit: FIT });
    expect(await screen.findByText('Yonex Astrox 88D Pro')).toBeDefined();
    expect(screen.getByText('Good match')).toBeDefined();
    expect(screen.getByText('Your frame 20–28 lb · string 20–25 lb')).toBeDefined();
    expect(screen.getByText('Rated Intermediate')).toBeDefined();
    expect(String((globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0])).toContain('/api/stringing/fit?id=string-yx-bg80');
  });

  it('leaves the section out when the engine cannot say, never guessing', async () => {
    wrap(BG80, { fit: null, reason: 'needs_check_in' });
    await waitFor(() => expect(screen.queryByText('How it suits you')).toBeNull());
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
