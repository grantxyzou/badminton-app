// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import YourKitCard from '../../components/stats/YourKitCard';
import type { UseGear } from '../../components/stats/useGear';
import type { PlayerGear } from '../../lib/types';
import { activeRacket, rackets as racketsOf } from '../../lib/activeRacket';
import enMessages from '../../messages/en.json';

/**
 * The kit rows name what the member plays with. For rackets that is the
 * ACTIVE one — a pointer, not a position.
 *
 * This card built its rows by walking `items` and taking the first of each
 * category, so a member whose active racket was not the first one they ever
 * added saw the wrong racket named as theirs, and every other gear surface
 * (all of which resolve through `activeRacket()`) disagreed with this card.
 * It also made "Change" look broken: picking a new racket appends it, so the
 * first item — and therefore this row — never moved.
 */
const OLD = { id: 'r-old', catalogId: 'c-old', category: 'racket' as const, label: 'Old Racket' };
const NEW = { id: 'r-new', catalogId: 'c-new', category: 'racket' as const, label: 'New Racket' };

function fakeGear(doc: PlayerGear, overrides: Partial<UseGear> = {}): UseGear {
  // Resolve through the REAL helper the hook uses, not a hand-rolled lookup.
  // A local `find(id === activeRacketId) ?? null` looks equivalent but drops
  // the legacy fallback (a pointerless bag resolves to items[0]), so the
  // fixture would have asserted against behaviour the app does not have.
  return {
    gear: doc,
    rackets: racketsOf(doc),
    active: activeRacket(doc),
    loaded: true,
    loadError: false,
    busy: false,
    online: true,
    reload: vi.fn(),
    add: vi.fn(async () => ({ ok: true as const })),
    activate: vi.fn(async () => ({ ok: true as const })),
    remove: vi.fn(async () => ({ ok: true as const })),
    setPrefs: vi.fn(async () => ({ ok: true as const })),
    setTension: vi.fn(async () => ({ ok: true as const })),
    ...overrides,
  };
}

function renderCard(gear: UseGear) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <YourKitCard activeName="Lin" gear={gear} />
    </NextIntlClientProvider>,
  );
}

describe('YourKitCard — the racket row names the ACTIVE racket', () => {
  afterEach(cleanup);

  it('shows the active racket even when it is not first in the bag', () => {
    const doc = { id: 'g1', memberId: 'm1', items: [OLD, NEW], activeRacketId: 'r-new' } as PlayerGear;
    renderCard(fakeGear(doc));
    expect(screen.getByLabelText(/^Racket —/).textContent).toContain('New Racket');
    expect(screen.getByLabelText(/^Racket —/).textContent).not.toContain('Old Racket');
  });

  it('falls back to the first racket for a legacy bag with no pointer', () => {
    const doc = { id: 'g1', memberId: 'm1', items: [OLD, NEW] } as PlayerGear;
    // No pointer ever existed. `activeRacket()` falls back to items[0], which
    // is what every other gear surface resolves to, so this row must agree.
    renderCard(fakeGear(doc));
    expect(screen.getByLabelText(/^Racket —/).textContent).toContain('Old Racket');
  });

  /**
   * Strings have no active pointer, so the row falls back to array order —
   * and array order is APPEND order, which made "first" the stalest thing the
   * member ever logged. A member who recorded a tension tonight saw a
   * year-old string named as their kit and no tension anywhere, which reads
   * exactly like the tension never saved.
   */
  it('names the freshest string, not the first one ever added', () => {
    const OLD_STRING = { id: 's-old', catalogId: 'c1', category: 'string' as const, label: 'Old String' };
    const NEW_STRING = { id: 's-new', catalogId: 'c2', category: 'string' as const, label: 'New String', tensionLbs: 27 };
    const doc = {
      id: 'g1', memberId: 'm1', items: [OLD, OLD_STRING, NEW_STRING], activeRacketId: 'r-old',
    } as PlayerGear;
    renderCard(fakeGear(doc));

    const row = screen.getByLabelText(/^Strings —/).textContent ?? '';
    expect(row).toContain('New String');
    expect(row).toContain('27');
    expect(row).not.toContain('Old String');
  });
});
