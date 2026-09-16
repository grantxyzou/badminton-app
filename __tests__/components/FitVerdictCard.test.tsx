// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import type { FitFacts } from '../../lib/fitVerdict';
import type { FitVerdictData } from '../../components/stats/useFitVerdict';

vi.mock('../../lib/engagement', () => ({ recordEngagement: vi.fn() }));

import { VerdictCard } from '../../components/stats/FitProfilePage';

afterEach(cleanup);

const facts = {
  state: 'fighting_slightly',
  prospective: false,
  frame: { name: 'Halbertec 9000', balance: 'Even', weightClass: '4U', flex: 'Medium' },
  reasons: [{ key: 'tensionHigh', polarity: 'minus' }],
  tensionRange: [22, 23],
  currentTensionLbs: 25,
} as unknown as FitFacts;

function renderCard(copy: FitVerdictData['copy']) {
  const data = { facts, checkInLevel: null, copy } as FitVerdictData;
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <VerdictCard data={data} error={false} forbidden={false} onRetry={() => {}} known hasRacket onBack={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe('VerdictCard — AI provenance', () => {
  it('wears the AI badge when a model wrote the words', () => {
    renderCard({ headline: 'Your Halbertec 9000 mostly suits you', body: 'One thing to sort.', reasons: ['Strings a touch tight'] });
    expect(screen.getByText('Your Halbertec 9000 mostly suits you')).toBeTruthy();
    expect(screen.getByLabelText('AI generated')).toBeTruthy();
  });

  it('carries no badge when the page wrote the words itself', () => {
    renderCard(null);
    expect(screen.getByText('Your Halbertec 9000 is fighting you slightly')).toBeTruthy();
    expect(screen.queryByLabelText('AI generated')).toBeNull();
  });
});
