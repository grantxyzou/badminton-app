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

  // ── No club comparison here (Stats canvas, 2026-10-20) ─────────────────
  // The median ticks moved to Where you sit, the one consent-gated card.
  it('draws no club tick and no median legend at all', () => {
    renderBars({ scores: SCORES });
    expect(screen.queryByText(/group median/)).toBeNull();
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
