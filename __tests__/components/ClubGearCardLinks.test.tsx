// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import ClubGearCard from '../../components/stats/ClubGearCard';
import { racketIdsByTallyKey } from '../../lib/gearSetup';
import enMessages from '../../messages/en.json';
import type { UseClubGear } from '../../components/stats/useClubGear';

afterEach(cleanup);

/** A club tally row that names a catalog racket opens that racket's page;
 *  a typed-in name has no page and stays plain text. */
describe('ClubGearCard — racket rows open the racket', () => {
  const club = {
    status: 'ready',
    entries: [
      { category: 'racket', label: 'Li-Ning Air Force 79', count: 5 },
      { category: 'racket', label: 'Old Carlton', count: 3 },
      { category: 'string', label: 'Yonex BG65', count: 3 },
    ],
    retry: () => {},
  } as unknown as UseClubGear;
  const ids = racketIdsByTallyKey([{ id: 'racket-li-ning-air-force-79', category: 'racket', brand: 'Li-Ning', model: 'Air Force 79' }]);

  it('makes only a matched racket row a button, and opens its page', () => {
    const onOpen = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ClubGearCard club={club} onOpenRacket={onOpen} racketIds={ids} />
      </NextIntlClientProvider>,
    );
    const rows = screen.getAllByRole('button');
    expect(rows).toHaveLength(1);
    fireEvent.click(rows[0]);
    expect(onOpen).toHaveBeenCalledWith('racket-li-ning-air-force-79');
    expect(screen.getByText('Old Carlton')).toBeTruthy();
  });

  it('with pages off, no row is a button', () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ClubGearCard club={club} racketIds={ids} />
      </NextIntlClientProvider>,
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
