// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import PlusOneRow from '@/components/home/PlusOneRow';
import type { Player } from '@/lib/types';

/** Guests on Home (docs/plans/six-feathers-guests.md): a line each, and another while the club allows it. */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const guest = (id: string, guestName: string, extra: Partial<Player> = {}): Player =>
  ({ id, name: `${guestName} (Josh)`, guestName, guestOf: 'm-josh', sessionId: 's', timestamp: '2026-11-01T10:00:00Z', ...extra }) as Player;

function show(props: Partial<Parameters<typeof PlusOneRow>[0]>) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <PlusOneRow guests={[]} canAdd online onChanged={() => {}} {...props} />
    </NextIntlClientProvider>,
  );
}

describe('PlusOneRow', () => {
  it('lists each guest and offers another while there is room', () => {
    show({ guests: [guest('g1', 'Jenny')], canAdd: true });
    expect(screen.getByText('Jenny is coming with you')).toBeDefined();
    expect(screen.getByRole('button', { name: /Bring another guest/ })).toBeDefined();
  });

  it('removes the guest it was asked to, by id', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }) as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    const onChanged = vi.fn();
    show({ guests: [guest('g1', 'Jenny'), guest('g2', 'Alex', { waitlisted: true })], canAdd: false, onChanged });
    expect(screen.queryByRole('button', { name: /Bring/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Alex' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(JSON.parse(init.body)).toMatchObject({ guest: true, guestId: 'g2' });
  });

  it('says a name already on the club’s list, and hides the money note in a club without money', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ error: 'guest_on_roster' }) }) as unknown as Response));
    show({ canAdd: true, showShare: false });
    fireEvent.click(screen.getByRole('button', { name: /Bring a guest/ }));
    fireEvent.change(screen.getByLabelText('Their first name'), { target: { value: 'Kodai' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText(/Kodai is on the club’s list already/)).toBeDefined();
    expect(screen.queryByText('Their share goes on your balance.')).toBeNull();
  });
});
