// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import SkillTrendCard from '../../components/stats/SkillTrendCard';
import type { UseCheckIn } from '../../components/stats/useCheckIn';
import enMessages from '../../messages/en.json';
import { resetSharedReads } from '../../lib/sharedRead';
import { SKILLS } from '../../lib/assessment';

/**
 * Strengths / Work on next (Stats › You, canvas 2026-10-20): two panels, each
 * skill's rating as five dots with the number beside them, and a line saying
 * what the list is for.
 */

const RATINGS: Record<string, number> = { serves_returns: 5, smashes: 4, drives: 4, net_play: 1, drops: 2, clears_lifts: 2 };

function checkIn(): UseCheckIn {
  const ratings = SKILLS.map((s) => ({ skillKey: s.key, value: RATINGS[s.key] ?? 3 }));
  const snap = {
    id: 'a1', takenAt: '2026-10-01T00:00:00Z', ratings, overall: 3,
    dimensionScores: { technical: 3, physical: 3, mental: 3 }, phase: 'switch',
  };
  return {
    snapshots: [snap] as never, status: 'ready', latest: snap as never, previous: undefined,
    open: false, openFrom: vi.fn(), close: vi.fn(), reload: vi.fn(), onSaved: vi.fn(), savedAt: 0,
  };
}

beforeEach(() => {
  resetSharedReads();
  localStorage.setItem('badminton_identity', JSON.stringify({ name: 'Lin', token: 't', sessionId: 's' }));
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

describe('Strengths / Work on next panels', () => {
  it('draws each rating as five dots, with the lit ones matching the number', () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <SkillTrendCard checkIn={checkIn()} />
      </NextIntlClientProvider>,
    );
    const strengths = screen.getByText(enMessages.stats.assess.strengths).closest('.skill-panel') as HTMLElement;
    const workOn = screen.getByText(enMessages.stats.assess.workOn).closest('.skill-panel') as HTMLElement;
    expect(workOn.classList.contains('skill-panel--warn')).toBe(true);
    expect(strengths.classList.contains('skill-panel--warn')).toBe(false);

    const top = within(strengths).getByRole('img', { name: '5 of 5' });
    expect(top.querySelectorAll('.skill-dot')).toHaveLength(5);
    expect(top.querySelectorAll('.skill-dot.is-on')).toHaveLength(5);
    const low = within(workOn).getByRole('img', { name: '1 of 5' });
    expect(low.querySelectorAll('.skill-dot.is-on')).toHaveLength(1);

    expect(within(strengths).getByText(enMessages.stats.assess.strengthsHint)).toBeTruthy();
    expect(within(workOn).getByText(enMessages.stats.assess.workOnHint)).toBeTruthy();
  });
});
