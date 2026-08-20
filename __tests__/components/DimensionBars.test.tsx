// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import DimensionBars from '../../components/stats/DimensionBars';
import enMessages from '../../messages/en.json';

function renderBars(props: Parameters<typeof DimensionBars>[0]) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <DimensionBars {...props} />
    </NextIntlClientProvider>,
  );
}

const SCORES = { technical: 2.6, physical: 2.7, mental: 3.8 };
const MEDIANS = { technical: 2.7, physical: 2.8, mental: 3.5 };

describe('DimensionBars', () => {
  afterEach(() => cleanup());

  it('renders all three dimensions with their values', () => {
    renderBars({ scores: SCORES });
    expect(screen.getByText('Technical')).toBeTruthy();
    expect(screen.getByText('Physical')).toBeTruthy();
    expect(screen.getByText('Mental')).toBeTruthy();
    expect(screen.getByText('2.6')).toBeTruthy();
    expect(screen.getByText('3.8')).toBeTruthy();
  });

  it('shows an em dash for an unrated dimension, never 0.0', () => {
    renderBars({ scores: { technical: 2.6, physical: null, mental: null } });
    expect(screen.getAllByText('—').length).toBe(2);
    expect(screen.queryByText('0.0')).toBeNull();
  });

  // ── Median ticks are gated ──────────────────────────────────────────────
  it('renders no tick and no legend when showTicks is false', () => {
    renderBars({ scores: SCORES, medians: MEDIANS, showTicks: false });
    // No ghost tick and no apology line — an absent comparison should look
    // like plain bars, not like something failed.
    expect(screen.queryByText('tick marks are the club median')).toBeNull();
  });

  it('renders the legend once ticks are shown', () => {
    renderBars({ scores: SCORES, medians: MEDIANS, showTicks: true });
    expect(screen.getByText('tick marks are the club median')).toBeTruthy();
  });

  it('renders no legend when showTicks is true but no dimension has a median', () => {
    renderBars({
      scores: SCORES,
      medians: { technical: null, physical: null, mental: null },
      showTicks: true,
    });
    expect(screen.queryByText('tick marks are the club median')).toBeNull();
  });

  it('tolerates a null medians object', () => {
    renderBars({ scores: SCORES, medians: null, showTicks: true });
    expect(screen.getByText('2.6')).toBeTruthy();
    expect(screen.queryByText('tick marks are the club median')).toBeNull();
  });

  // ── Deltas ──────────────────────────────────────────────────────────────
  it('shows an up delta against the previous snapshot', () => {
    renderBars({ scores: SCORES, prevScores: { technical: 2.2, physical: 2.7, mental: 3.8 } });
    expect(screen.getByText(/▲ 0.4/)).toBeTruthy();
  });

  it('shows a down delta', () => {
    renderBars({ scores: SCORES, prevScores: { technical: 3.0, physical: 2.7, mental: 3.8 } });
    expect(screen.getByText(/▼ 0.4/)).toBeTruthy();
  });

  it('hides an imperceptible delta rather than rendering an arrow with 0.0', () => {
    renderBars({ scores: SCORES, prevScores: { technical: 2.61, physical: 2.7, mental: 3.8 } });
    expect(screen.queryByText(/[▲▼]/)).toBeNull();
  });

  it('renders no deltas at all on a first check-in', () => {
    renderBars({ scores: SCORES });
    expect(screen.queryByText(/[▲▼]/)).toBeNull();
  });
});
