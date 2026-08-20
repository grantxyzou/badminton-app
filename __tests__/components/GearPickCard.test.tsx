// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import GearPickCard from '../../components/stats/GearPickCard';
import enMessages from '../../messages/en.json';
import type { CatalogItem } from '../../lib/types';

const ITEM: CatalogItem = {
  id: 'yonex-astrox-88d',
  category: 'racket',
  brand: 'Yonex',
  model: 'Astrox 88D Pro',
  skillRange: [3, 6],
  attributes: { weight: '3U', balance: 'head-heavy', flex: 'stiff' },
};

function renderCard(props: Partial<React.ComponentProps<typeof GearPickCard>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <GearPickCard
        category="racket"
        pick={{ item: ITEM, reasons: ['Stiffer shaft suits your smash'] }}
        owned={false}
        status="ready"
        onOpen={() => {}}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe('GearPickCard', () => {
  it('shows "Why this?" and no kit pill when the member does not own the pick', () => {
    renderCard();
    expect(screen.getByText('Why this?')).toBeTruthy();
    expect(screen.queryByText('In your kit')).toBeNull();
  });

  it('flips to the kit pill and "Why we picked it" once owned', () => {
    renderCard({ owned: true });
    expect(screen.getByText('In your kit')).toBeTruthy();
    expect(screen.getByText('Why we picked it')).toBeTruthy();
    expect(screen.queryByText('Why this?')).toBeNull();
  });

  it('renders the parked card for a category with no possible pick', () => {
    renderCard({ category: 'shoe', pick: null, status: 'parked' });
    expect(screen.getByText('Coming soon')).toBeTruthy();
    expect(screen.getByText('Court shoes matched to your footwork and fit.')).toBeTruthy();
  });
});
