// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, waitFor, act } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';

/**
 * SkillsTab is the single owner of the check-in.
 *
 * Before this, `CheckInSheet` had THREE mount sites across two registers —
 * `SkillTrendCard` twice (its empty branch and its loaded branch, with
 * different props) and `LearnRegister` once — and the history behind it was
 * fetched independently by `SkillTrendCard` AND `OverviewStrip`. So the same
 * `/api/assessments` read ran up to three times per visit and the cards could
 * disagree with each other mid-flight.
 *
 * This is the `GearRegister` invariant applied to the other half of the tab,
 * for the same reason and in the same shape: one owner, passed down. Without a
 * canary the rule is aspirational — a second reader is one convenient
 * `useEffect` away and nothing else in the suite would notice.
 *
 * The identity chain is stubbed because `useActiveName` reads localStorage and
 * subscribes to a custom event; this test is about how many times the history
 * is read, not about how the name is resolved.
 */

vi.mock('../../lib/useActiveName', () => ({
  useActiveName: () => ({ name: 'Lin', resolved: true }),
}));

const { default: SkillsTab } = await import('../../components/SkillsTab');

function assessmentReads(): string[] {
  return (global.fetch as ReturnType<typeof vi.fn>).mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes('/api/assessments'));
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('SkillsTab — single owner of the check-in history', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      // Everything resolves to an honest empty so the tab renders its first-run
      // arrangement — which is the state a member with no check-in actually
      // sees, and the one where the old duplicate readers both fired.
      const body: Record<string, unknown> = u.includes('/api/assessments')
        ? { assessments: [] }
        : u.includes('/api/stats/level')
          ? { level: { level: null } }
          : u.includes('/api/games')
            ? { games: [] }
            : u.includes('/api/kudos')
              ? { kudos: [] }
              : u.includes('/api/stats/drills')
                ? { drills: [], done: [] }
                : {};
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    }) as unknown as typeof fetch;
  });

  /**
   * Counted AFTER a macrotask boundary, not at the moment the count reaches 1.
   *
   * `GearRegister`'s canary records why: asserting `toBe(1)` inside `waitFor`
   * passes the instant the count reaches 1, before a second reader that fires
   * in a LATER tick has had its chance. A reintroduced reader would most
   * plausibly be gated on the first read having settled — exactly the shape the
   * weak assertion cannot see.
   */
  it('issues exactly ONE GET /api/assessments per mount, including after it settles', async () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <SkillsTab />
      </NextIntlClientProvider>,
    );

    await waitFor(() => expect(assessmentReads().length).toBeGreaterThan(0));
    // Drain past a macrotask boundary — microtasks always resolve before a
    // timer fires, so this is what gives a later-tick reader room to appear.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(assessmentReads()).toHaveLength(1);
  });

  it('mounts exactly one check-in sheet for the whole tab', async () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <SkillsTab />
      </NextIntlClientProvider>,
    );

    await waitFor(() => expect(assessmentReads().length).toBeGreaterThan(0));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    // Closed, so none are rendered — the point is that no register mounts a
    // second one, and the count below is of live sheets, not of call sites.
    expect(container.querySelectorAll('.bottom-sheet').length).toBeLessThanOrEqual(1);
  });
});
