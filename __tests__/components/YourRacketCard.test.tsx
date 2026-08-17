// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import YourRacketCard from '../../components/stats/cards/YourRacketCard';
import enMessages from '../../messages/en.json';
import type { CatalogItem } from '../../lib/types';

afterEach(cleanup);

const ASTROX: CatalogItem = {
  id: 'racket-yonex-astrox-100zz', category: 'racket', brand: 'Yonex', model: 'Astrox 100ZZ',
  skillRange: [4, 6],
  attributes: { playStyle: 'Power', balance: 'Head-heavy', weight: '4U', weightGrams: '83-88', flex: 'Extra Stiff' },
};

function renderCard(props: Partial<React.ComponentProps<typeof YourRacketCard>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <YourRacketCard item={null} label={null} loading={false} error={false} onEdit={vi.fn()} {...props} />
    </NextIntlClientProvider>,
  );
}

describe('YourRacketCard', () => {
  it('always asks the question, answered or not', () => {
    renderCard();
    expect(screen.getByText('What is the racket you are using today?')).toBeTruthy();
  });

  it('leads with the model, then brand, then the two spec tiers', () => {
    renderCard({ item: ASTROX, label: 'Yonex Astrox 100ZZ' });
    expect(screen.getByText('Astrox 100ZZ')).toBeTruthy();
    expect(screen.getByText('Yonex')).toBeTruthy();
    expect(screen.getByText('Power · Head-heavy')).toBeTruthy();
    expect(screen.getByText('4U (83–88g) · Extra Stiff')).toBeTruthy();
  });

  // A legacy row has no weightGrams/playStyle. It must render without gaps.
  it('degrades by omission on a sparse legacy item', () => {
    const legacy: CatalogItem = {
      id: 'racket-yonex-astrox-88d-pro', category: 'racket', brand: 'Yonex', model: 'Astrox 88D Pro',
      skillRange: [4, 6], attributes: { weight: '4U', flex: 'stiff' },
    };
    renderCard({ item: legacy, label: 'Yonex Astrox 88D Pro' });
    expect(screen.getByText('4U · stiff')).toBeTruthy();
    expect(screen.queryByText(/undefined|null|·\s*$/)).toBeNull();
  });

  it('prompts when no racket is set', () => {
    renderCard();
    expect(screen.getByText('Tap to pick yours')).toBeTruthy();
  });

  // Lying-empty-state rule: a load failure must not look like "no racket yet".
  it('shows an error, not the empty prompt, when the load failed', () => {
    renderCard({ error: true });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Tap to pick yours')).toBeNull();
  });

  // The label is stored on the gear doc; the CatalogItem may be missing if the
  // catalogId dangles. Show the name rather than falling back to "no racket".
  it('falls back to the stored label when the catalog item is missing', () => {
    renderCard({ item: null, label: 'Some Discontinued Racket' });
    expect(screen.getByText('Some Discontinued Racket')).toBeTruthy();
    expect(screen.queryByText('Tap to pick yours')).toBeNull();
  });
});
