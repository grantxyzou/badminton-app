// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import WhereYouSitCard from '../../components/stats/WhereYouSitCard';
import enMessages from '../../messages/en.json';

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
const ASSESSMENTS = [
  '/api/assessments',
  () => jsonResponse({ assessments: [{ takenAt: '2026-08-01T00:00:00.000Z', ratings: RATINGS }] }),
] as const;

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

function renderCard(promptOpen = false) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <WhereYouSitCard activeName="Lin" promptOpen={promptOpen} />
    </NextIntlClientProvider>,
  );
}

describe('WhereYouSitCard', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('names the sharpest and weakest rated skills', async () => {
    mockFetchByUrl([bandsResponse(), ASSESSMENTS]);
    renderCard();
    await waitFor(() => expect(screen.getByText('Where you sit')).toBeTruthy());
    expect(screen.getByText(/top third/)).toBeTruthy();
    expect(screen.getByText(/bottom third/)).toBeTruthy();
  });

  it('shows the reassuring footnote when revealed', async () => {
    mockFetchByUrl([bandsResponse(), ASSESSMENTS]);
    renderCard();
    await waitFor(() =>
      expect(screen.getByText(/No names, no leaderboard/)).toBeTruthy(),
    );
  });

  // ── Cohort minimum ──────────────────────────────────────────────────────
  it('does not render at all below the cohort minimum', async () => {
    mockFetchByUrl([bandsResponse({ cohort: 3, skills: [] }), ASSESSMENTS]);
    const { container } = renderCard();
    await waitFor(() => expect(container.querySelector('.glass-card')).toBeNull());
    expect(screen.queryByText('Where you sit')).toBeNull();
  });

  // ── The consent invariant ───────────────────────────────────────────────
  it('renders unfilled with a Private pill when the server withheld skills', async () => {
    // Server returns skills: [] for an unasked or opted-out member. The card
    // must still render — the member owns their sharpest/weakest skills, and
    // vanishing would make "Keep it private" look like it deleted something.
    mockFetchByUrl([bandsResponse({ skills: [] }), ASSESSMENTS]);
    renderCard();
    await waitFor(() => expect(screen.getByText('Where you sit')).toBeTruthy());
    expect(screen.getByText('Private')).toBeTruthy();
    expect(screen.getByText(/Your place is private/)).toBeTruthy();
    // No band is claimed anywhere.
    expect(screen.queryByText(/top third/)).toBeNull();
    expect(screen.queryByText(/bottom third/)).toBeNull();
    // ...but the member's own skills are still named.
    expect(screen.getByText('Consistency')).toBeTruthy();
  });

  it('never paints a band while the consent prompt is open', async () => {
    // Even with bands in hand, promptOpen must suppress them — the card sits
    // behind a translucent backdrop and would leak the answer being asked for.
    mockFetchByUrl([bandsResponse(), ASSESSMENTS]);
    renderCard(true);
    await waitFor(() => expect(screen.getByText('Where you sit')).toBeTruthy());
    expect(screen.queryByText(/top third/)).toBeNull();
    expect(screen.getByText('Private')).toBeTruthy();
    expect(screen.getByText(/Your place is private/)).toBeTruthy();
  });

  // ── Legible failure ─────────────────────────────────────────────────────
  it('shows an explicit error rather than vanishing like the below-cohort case', async () => {
    mockFetchByUrl([
      ['/api/stats/club/bands', () => jsonResponse({ error: 'load_failed' }, false)],
      ASSESSMENTS,
    ]);
    renderCard();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });

  it('renders one band when the best and worst skill are the same', async () => {
    mockFetchByUrl([
      bandsResponse({ skills: [{ skillKey: 'consistency', band: 'middle' }] }),
      [
        '/api/assessments',
        () =>
          jsonResponse({
            assessments: [
              { takenAt: '2026-08-01T00:00:00.000Z', ratings: [{ skillKey: 'consistency', value: 3 }] },
            ],
          }),
      ],
    ]);
    renderCard();
    await waitFor(() => expect(screen.getByText(/middle third/)).toBeTruthy());
    // The lede must be the single-skill sentence, not "and the ... at ...".
    expect(screen.queryByText(/, and the/)).toBeNull();
  });

  it('renders nothing without an active name', () => {
    mockFetchByUrl([bandsResponse(), ASSESSMENTS]);
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <WhereYouSitCard activeName={null} />
      </NextIntlClientProvider>,
    );
    expect(container.textContent).toBe('');
  });
});
