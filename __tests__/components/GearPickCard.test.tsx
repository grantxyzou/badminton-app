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

describe('GearPickCard — a parked string must not disown a shipped feature', () => {
  afterEach(cleanup);

  /**
   * The twin of commit 6f7ea48, which fixed this for rackets. `badgeKey`
   * defaults to `railComingSoon`, and that was TRUE for string while it had no
   * engine. Now it has one, so a parked string card means "no check-in yet" or
   * "empty catalog" — never "this feature doesn't exist". Claiming coming-soon
   * for something that ships is the same lie in the other direction as a
   * lying empty state.
   */
  it('says there is no pick yet, not that string picks are coming soon', () => {
    renderCard({ category: 'string', pick: null, status: 'parked' });
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    expect(screen.getByText(/no pick yet/i)).toBeTruthy();
  });

  it('still tells shoes and shuttles they are coming, because they are', () => {
    renderCard({ category: 'shoe', pick: null, status: 'parked' });
    expect(screen.getByText(/coming soon/i)).toBeTruthy();
  });
});

describe('GearPickCard — the spec line has to mean something', () => {
  afterEach(cleanup);

  /**
   * formatSpec used to take the first two attribute VALUES in key order. For a
   * racket that is weight and balance by luck of how the catalog rows were
   * written; for a string it is `series` and `stringType`, so the Li-Ning N69
   * rendered as "Li-Ning · N · Durability". "N" is the series letter. The line
   * is positional, and nothing about a catalog row guarantees key order —
   * Cosmos explicitly does not.
   */
  it('describes a string by gauge and type, not by whatever key came first', () => {
    renderCard({
      category: 'string',
      pick: {
        item: {
          id: 's1', category: 'string', brand: 'Li-Ning', model: 'N69',
          skillRange: [1, 5],
          attributes: { series: 'N', stringType: 'Durability', gaugeMm: 0.65 },
        },
        reasons: ['x'],
      },
    });
    expect(screen.getByText(/0\.65mm · Durability/)).toBeTruthy();
    expect(screen.queryByText(/· N ·/)).toBeNull();
  });

  it('still describes a racket by weight and balance', () => {
    renderCard({
      category: 'racket',
      pick: {
        item: { ...ITEM, attributes: { series: 'Astrox', weight: '3U', balance: 'Head-heavy' } },
        reasons: ['x'],
      },
    });
    expect(screen.getByText(/3U · Head-heavy/)).toBeTruthy();
  });
});
