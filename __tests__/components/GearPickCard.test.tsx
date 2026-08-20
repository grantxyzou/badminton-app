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

  // Racket has a LIVE engine (unlike shoe/shuttle), so a parked racket card
  // (needsCheckIn, or the rarer empty-catalog case) must not claim the
  // feature itself is "Coming soon" — that reads as false and discourages
  // the very check-in the body line is asking for. Badge and body must not
  // tell two different stories.
  it('parks racket with reason-agnostic badge copy, never "Coming soon"', () => {
    renderCard({ category: 'racket', pick: null, status: 'parked' });
    expect(screen.queryByText('Coming soon')).toBeNull();
    expect(screen.getByText('No pick yet')).toBeTruthy();
    expect(screen.getByText("We'll suggest a racket once you've done a check-in.")).toBeTruthy();
  });
});

describe('GearPickCard — the frame a string pick assumed', () => {
  afterEach(cleanup);

  it('names the member\'s own racket when the pair used it', () => {
    renderCard({
      category: 'string',
      pick: {
        item: { ...ITEM, id: 's1', category: 'string', model: 'BG65' },
        reasons: ['Wide usable tension window'],
        pairedWith: { label: 'Yonex Astrox 88D Pro', source: 'owned' },
      },
    });
    expect(screen.getByText(/Astrox 88D Pro · yours/i)).toBeTruthy();
  });

  it('says the frame was our suggestion when the member owns none', () => {
    // The assumption must be visible. A string pick shown against a frame the
    // member does not own, with no label saying so, is advice for someone
    // else's racket.
    renderCard({
      category: 'string',
      pick: {
        item: { ...ITEM, id: 's1', category: 'string', model: 'BG65' },
        reasons: ['Wide usable tension window'],
        pairedWith: { label: 'Yonex Astrox 88D Pro', source: 'recommended' },
      },
    });
    expect(screen.getByText(/our pick for you/i)).toBeTruthy();
  });
});
