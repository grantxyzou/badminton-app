// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import BenchJobRow from '../../components/stringing/BenchJobRow';
import BenchList from '../../components/stringing/BenchList';
import { benchGroups } from '../../lib/benchGroups';
import { blendsWithDarkPill } from '../../lib/stringShelf';
import enMessages from '../../messages/en.json';
import type { StringingJob } from '../../lib/types';

/**
 * The bench's job row and its list (docs/plans/stringing-jobs-list.md; Grant's
 * canvas, Option A). What a stringer reads at the machine: the racket, who and
 * when, M and C as two pills, a player's own request called out, the holes
 * only when counted, and no next-step button on the row.
 */
afterEach(cleanup);

const base: StringingJob = {
  id: 'job-1',
  memberId: 'member-wei',
  jobNo: 'J-0042',
  memberName: 'Wei',
  stringerId: null,
  stringerName: null,
  status: 'received',
  racketLabel: 'Astrox 99 Pro',
  stringLabel: 'BG80',
  stringColor: 'Yellow',
  tensionMains: 24,
  tensionCrosses: 26,
  method: null,
  priceCents: 3000,
  readyBy: null,
  acceptedAt: null,
  paidAt: null,
  sessionId: null,
  createdAt: '2026-11-10T00:00:00.000Z',
  updatedAt: '2026-11-10T00:00:00.000Z',
  history: [],
} as unknown as StringingJob;

function wrap(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages} timeZone="UTC">
      {node}
    </NextIntlClientProvider>,
  );
}

function row(job: Partial<StringingJob>, extra: Partial<React.ComponentProps<typeof BenchJobRow>> = {}) {
  return wrap(
    <BenchJobRow
      job={{ ...base, ...job } as StringingJob}
      today="2026-11-16"
      catalogId={null}
      onOpen={() => {}}
      openLabel="Open"
      {...extra}
    />,
  );
}

describe('BenchJobRow', () => {
  it('draws M and C as two pills with tension and string, and no custom call-out for the usual pair', () => {
    row({});
    const r = screen.getByTestId('bench-row');
    expect(r.textContent).toContain('Astrox 99 Pro');
    expect(r.textContent).toContain('Wei');
    expect(r.textContent).toContain('J-0042');
    expect(r.querySelectorAll('.bench-spec:not(.bench-spec--plain)')).toHaveLength(2);
    expect(r.textContent).toContain('24');
    expect(r.textContent).toContain('26');
    expect(r.textContent).not.toContain('Custom request');
    expect(r.querySelector('.bench-spec--custom')).toBeNull();
  });

  it('calls out a player’s own pair once, with amber tensions', () => {
    row({ tensionMains: 27, tensionCrosses: 28 });
    expect(screen.getByText('Custom request')).toBeDefined();
    expect(screen.getByTestId('bench-row').querySelectorAll('.bench-spec--custom')).toHaveLength(2);
  });

  it('a two-colour set colours each letter by its own side', () => {
    row({ stringColor: 'White/Red' });
    const letters = screen.getByTestId('bench-row').querySelectorAll<HTMLElement>('.bench-spec-letter');
    expect(letters).toHaveLength(2);
    expect(letters[0].style.background).not.toBe(letters[1].style.background);
  });

  it('a black string’s circle keeps a light edge on the dark pill; a yellow one needs none', () => {
    row({ stringColor: 'Black' });
    const black = screen.getByTestId('bench-row').querySelector<HTMLElement>('.bench-spec-letter')!;
    expect(black.dataset.dark).toBe('true');
    cleanup();
    row({ stringColor: 'Yellow' });
    const yellow = screen.getByTestId('bench-row').querySelector<HTMLElement>('.bench-spec-letter')!;
    expect(yellow.dataset.dark).toBeUndefined();
    expect(blendsWithDarkPill('navy')).toBe(true);
    expect(blendsWithDarkPill('white')).toBe(false);
    expect(blendsWithDarkPill('red')).toBe(false);
  });

  it('shows grommet holes only when counted', () => {
    row({}, { holes: 72 });
    expect(screen.getByText('72 grommet holes')).toBeDefined();
    cleanup();
    row({}, { holes: null });
    expect(screen.queryByText(/grommet holes/)).toBeNull();
  });

  it('tags Unpaid, opens the job from the whole row, and offers no next-step button', () => {
    const onOpen = vi.fn();
    row({ status: 'ready' }, { unpaid: true, onOpen });
    expect(screen.getByText('Unpaid')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /^Open · Astrox 99 Pro · J-0042/ }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: /^Mark / })).toBeNull();
  });
});

describe('benchGroups', () => {
  it('orders received, strung, ready, requested; leaves empty groups out; keeps picked up apart', () => {
    const jobs = [
      { id: 'a', status: 'requested' },
      { id: 'b', status: 'ready' },
      { id: 'c', status: 'received' },
      { id: 'd', status: 'picked_up' },
      { id: 'e', status: 'received' },
    ] as const;
    const { open, pickedUp } = benchGroups(jobs);
    expect(open.map((g) => g.status)).toEqual(['received', 'ready', 'requested']);
    expect(open[0].jobs.map((j) => j.id)).toEqual(['c', 'e']);
    expect(pickedUp.map((j) => j.id)).toEqual(['d']);
  });
});

describe('BenchList', () => {
  it('labels each group with its count and folds Picked up until tapped', () => {
    const jobs = [
      { ...base, id: 'r1', status: 'received' },
      { ...base, id: 'r2', status: 'received', memberName: 'Lin' },
      { ...base, id: 'p1', status: 'picked_up', memberName: 'Akane' },
    ] as StringingJob[];
    wrap(<BenchList jobs={jobs} renderRow={(j) => <div key={j.id}>{j.memberName}</div>} />);
    const list = screen.getByTestId('bench-list');
    expect(within(list).getByText('Received · 2')).toBeDefined();
    expect(within(list).queryByText('Akane')).toBeNull();
    const fold = within(list).getByRole('button', { name: /Picked up · 1/ });
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(fold);
    expect(within(list).getByText('Akane')).toBeDefined();
  });
});
