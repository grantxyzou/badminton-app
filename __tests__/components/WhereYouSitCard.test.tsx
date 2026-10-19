// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import WhereYouSitCard from '../../components/stats/WhereYouSitCard';
import enMessages from '../../messages/en.json';
import type { UseCheckIn } from '../../components/stats/useCheckIn';
import { resetSharedReads } from '../../lib/sharedRead';

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, status: ok ? 200 : 500, json: async () => body } as Response);
}

function mockFetchByUrl(handlers: ReadonlyArray<readonly [string, () => Promise<Response>]>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      const entry = handlers.find(([needle]) => url.includes(needle));
      if (!entry) return Promise.reject(new Error(`Unmocked fetch: ${url}`));
      return entry[1]();
    }) as unknown as typeof fetch,
  );
}

// consistency is the member's best, drops their worst.
const RATINGS = [
  { skillKey: 'consistency', value: 5 },
  { skillKey: 'drops', value: 1 },
  { skillKey: 'smashes', value: 3 },
];
/**
 * The member's own ratings arrive as a PROP now, not as this card's own read.
 *
 * `useCheckIn` in `SkillsTab` is the single owner: this card, `OverviewStrip`
 * and `SkillTrendCard` each used to fetch `/api/assessments`, so one visit read
 * the same history three times and the cards could disagree mid-flight
 * (`StatsCheckInOwner.test.tsx` is the canary). The BANDS read stays this
 * card's own — it is consent-gated server-side and must re-run when the member
 * answers that prompt.
 */
function stubCheckIn(ratings: Array<{ skillKey: string; value: number }> = RATINGS): UseCheckIn {
  const latest = { takenAt: '2026-08-01T00:00:00.000Z', ratings };
  return {
    snapshots: [latest],
    status: 'ready',
    latest,
    previous: undefined,
    open: false,
    openFrom: () => {},
    close: () => {},
    reload: () => {},
    onSaved: () => {},
    savedAt: 0,
  };
}

function bandsResponse(over: Record<string, unknown> = {}) {
  return [
    '/api/stats/club/bands',
    () =>
      jsonResponse({
        cohort: 8,
        minCohort: 5,
        dimensionMedians: { technical: 3, physical: 3, mental: 3 },
        skills: [
          { skillKey: 'consistency', band: 'top' },
          { skillKey: 'drops', band: 'bottom' },
        ],
        ...over,
      }),
  ] as const;
}

function renderCard(promptOpen = false, checkIn: UseCheckIn = stubCheckIn()) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <WhereYouSitCard activeName="Lin" promptOpen={promptOpen} checkIn={checkIn} />
    </NextIntlClientProvider>,
  );
}

describe('WhereYouSitCard', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    // Module state (lib/sharedRead.ts): one test's answer must not reach the next.
    resetSharedReads();
  });

  it('names the sharpest and weakest rated skills', async () => {
    mockFetchByUrl([bandsResponse()]);
    renderCard();
    await waitFor(() => expect(screen.getByText('Where you sit')).toBeTruthy());
    expect(screen.getByText(/top third/i)).toBeTruthy();
    expect(screen.getByText(/bottom third/i)).toBeTruthy();
  });

  /**
   * Compact rows (canvas option C, 2026-10-19): one row per skill carrying
   * its own band, the lit dot in the band's position, and no sentence above
   * repeating what the rows already say.
   */
  it('draws one row per skill with the matching dot lit', async () => {
    mockFetchByUrl([bandsResponse()]);
    const { container } = renderCard();
    await waitFor(() => expect(screen.getByText('Where you sit')).toBeTruthy());
    const rows = Array.from(container.querySelectorAll('.sit-row'));
    expect(rows.map((r) => r.getAttribute('data-band'))).toEqual(['top', 'bottom']);
    expect(rows[0].textContent).toContain('Consistency');
    expect(rows[0].textContent).toContain('Top third');
    // Dots run bottom → top, so the top third is the last dot.
    const lit = (r: Element) =>
      Array.from(r.querySelectorAll('.sit-dot')).map((d) => d.classList.contains('is-on'));
    expect(lit(rows[0])).toEqual([false, false, true]);
    expect(lit(rows[1])).toEqual([true, false, false]);
    expect(screen.getByText('in the group')).toBeTruthy();
    expect(screen.queryByText(/You're in the/)).toBeNull();
  });

  it('shows the footnote when revealed', async () => {
    mockFetchByUrl([bandsResponse()]);
    renderCard();
    await waitFor(() =>
      expect(screen.getByText(/how it compares to the players in the group/)).toBeTruthy(),
    );
  });

  // ── Cohort minimum ──────────────────────────────────────────────────────
  it('does not render at all below the cohort minimum', async () => {
    mockFetchByUrl([bandsResponse({ cohort: 3, skills: [] })]);
    const { container } = renderCard();
    await waitFor(() => expect(container.querySelector('.glass-card')).toBeNull());
    expect(screen.queryByText('Where you sit')).toBeNull();
  });

  // ── The consent invariant ───────────────────────────────────────────────
  it('renders unfilled with a Private pill when the server withheld skills', async () => {
    // Server returns skills: [] for an unasked or opted-out member. The card
    // must still render — the member owns their sharpest/weakest skills, and
    // vanishing would make "Keep it private" look like it deleted something.
    mockFetchByUrl([bandsResponse({ skills: [] })]);
    const { container } = renderCard();
    await waitFor(() => expect(screen.getByText('Where you sit')).toBeTruthy());
    expect(screen.getByText('Private')).toBeTruthy();
    expect(screen.getByText(/Your place is private/)).toBeTruthy();
    // The rows stay, with no dot lit and no tone to read from.
    expect(container.querySelectorAll('.sit-row')).toHaveLength(2);
    expect(container.querySelector('.sit-dot.is-on')).toBeNull();
    expect(container.querySelector('.sit-row[data-band]')).toBeNull();
    expect(screen.queryByText('in the group')).toBeNull();
    // No band is claimed anywhere.
    expect(screen.queryByText(/top third/i)).toBeNull();
    expect(screen.queryByText(/bottom third/i)).toBeNull();
    // ...but the member's own skills are still named.
    expect(screen.getByText('Consistency')).toBeTruthy();
  });

  it('never paints a band while the consent prompt is open', async () => {
    // Even with bands in hand, promptOpen must suppress them — the card sits
    // behind a translucent backdrop and would leak the answer being asked for.
    mockFetchByUrl([bandsResponse()]);
    renderCard(true);
    await waitFor(() => expect(screen.getByText('Where you sit')).toBeTruthy());
    expect(screen.queryByText(/top third/i)).toBeNull();
    expect(screen.getByText('Private')).toBeTruthy();
    expect(screen.getByText(/Your place is private/)).toBeTruthy();
  });

  // ── Legible failure ─────────────────────────────────────────────────────
  it('shows an explicit error rather than vanishing like the below-cohort case', async () => {
    mockFetchByUrl([
      ['/api/stats/club/bands', () => jsonResponse({ error: 'load_failed' }, false)],
    ]);
    renderCard();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });

  /**
   * THE OTHER SOURCE. The ratings moved onto the shared `useCheckIn` owner but
   * the card's `status` still tracked only its own bands read, so a failed
   * HISTORY read collapsed into `ratings: []`, fell through to
   * `picked.length === 0` and returned `null`. That is the same silent vanish
   * the test above exists to forbid, arriving through the door the refactor
   * opened — and indistinguishable from the legitimate below-cohort case.
   */
  it('shows an error when the HISTORY read failed, even though bands loaded', async () => {
    mockFetchByUrl([bandsResponse()]);
    renderCard(false, { ...stubCheckIn(), status: 'error', latest: undefined, snapshots: [] });
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });

  it('waits for the history rather than rendering empty and popping in', async () => {
    // Bands resolve first in practice. Keyed only on its own status the card
    // rendered a `null` it then replaced when the history landed — a visible
    // jump in the middle of the You register.
    mockFetchByUrl([bandsResponse()]);
    const { container } = renderCard(false, {
      ...stubCheckIn(),
      status: 'loading',
      latest: undefined,
      snapshots: [],
    });
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeNull());
    expect(screen.queryByText(/top third/i)).toBeNull();
    // A skeleton, not an absence: something holds the slot.
    expect(container.firstChild).not.toBeNull();
  });

  it('still renders nothing for a member who simply has no ratings', async () => {
    // The fix must not turn the honest empty case into an error. `ready` with
    // no snapshot is a member who has never checked in, and the card is absent
    // for them by design.
    mockFetchByUrl([bandsResponse()]);
    const { container } = renderCard(false, {
      ...stubCheckIn(),
      status: 'ready',
      latest: undefined,
      snapshots: [],
    });
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeNull());
    expect(container.firstChild).toBeNull();
  });

  it('renders one band when the best and worst skill are the same', async () => {
    mockFetchByUrl([bandsResponse({ skills: [{ skillKey: 'consistency', band: 'middle' }] })]);
    // One rated skill, so sharpest and weakest are the same row.
    const { container } = renderCard(false, stubCheckIn([{ skillKey: 'consistency', value: 3 }]));
    await waitFor(() => expect(screen.getByText(/middle third/i)).toBeTruthy());
    expect(container.querySelectorAll('.sit-row')).toHaveLength(1);
  });

  it('renders nothing — never throws — on a 200 with an unreadable body', async () => {
    // A malformed 200 used to reach `bands.skills.length` and throw, taking the
    // whole You register down with it. `undefined < undefined` is false, so a
    // missing `cohort` sailed straight through the cohort guard rather than
    // being caught by it. Unknown is not known-false: a payload we cannot read
    // is "no comparison available", which is what a small club already sees.
    mockFetchByUrl([['/api/stats/club/bands', () => jsonResponse({})]]);
    const { container } = renderCard();
    await waitFor(() => expect(container.textContent).toBe(''));
  });

  it('renders nothing without an active name', () => {
    mockFetchByUrl([bandsResponse()]);
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <WhereYouSitCard activeName={null} />
      </NextIntlClientProvider>,
    );
    expect(container.textContent).toBe('');
  });
});
