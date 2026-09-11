// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import LevelTrendChart, { plottable } from '../../components/stats/LevelTrendChart';
import type { UseCheckIn, CheckInSnapshot } from '../../components/stats/useCheckIn';

/**
 * Your level over time.
 *
 * jsdom applies no stylesheet and lays nothing out, so NOTHING here asserts a
 * pixel. What it can assert is the shape of the SVG the component emits and,
 * more importantly, the four states — which is where the honesty lives: a
 * failed read must never render as "one check-in so far" to a member with
 * years of history.
 */

function stub(snapshots: CheckInSnapshot[], status: UseCheckIn['status'] = 'ready'): UseCheckIn {
  return {
    snapshots,
    status,
    latest: snapshots[snapshots.length - 1],
    previous: undefined,
    open: false,
    openFrom: () => {},
    close: () => {},
    reload: () => {},
    onSaved: () => {},
    savedAt: 0,
  };
}

function renderChart(checkIn: UseCheckIn) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <LevelTrendChart checkIn={checkIn} />
    </NextIntlClientProvider>,
  );
}

const TWO = [
  { takenAt: '2026-04-10T00:00:00.000Z', overall: 2.5 },
  { takenAt: '2026-08-10T00:00:00.000Z', overall: 2.9 },
];

afterEach(cleanup);

describe('LevelTrendChart', () => {
  it('draws a line with one marker per check-in', () => {
    const { container } = renderChart(stub(TWO));
    expect(container.querySelector('polyline')).toBeTruthy();
    expect(container.querySelectorAll('circle')).toHaveLength(2);
  });

  it('draws the point but NO line on a single check-in, and says why', () => {
    const { container } = renderChart(stub([TWO[1]]));
    // A line through one point would be a claim about a trend that does not
    // exist yet. The invitation is the absence, stated plainly.
    expect(container.querySelector('polyline')).toBeNull();
    expect(container.querySelectorAll('circle')).toHaveLength(1);
    expect(screen.getByText(/One check-in so far/)).toBeTruthy();
  });

  it('renders an ERROR, never an empty chart, when the history failed to load', () => {
    const { container } = renderChart(stub([], 'error'));
    // THE CASE THIS COMPONENT EXISTS TO GET RIGHT. Rendering the one-point copy
    // here would tell a member with years of check-ins that they have none.
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.queryByText(/One check-in so far/)).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('says loaded-empty in the EMPTY voice, never the error voice', () => {
    renderChart(stub([]));
    expect(screen.getByText(/No check-ins to chart yet/)).toBeTruthy();
    // Same reserved box as the error state, deliberately DIFFERENT voice: a
    // card that confidently reports nothing when the backend is broken is the
    // failure the house rule names.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the same frame in every state so the card never changes height', () => {
    // Same title, same body box, whatever came back — otherwise the bars and
    // legends below jump on every read.
    for (const s of [stub([]), stub([], 'error'), stub([], 'loading'), stub(TWO)]) {
      const { container } = renderChart(s);
      expect(container.textContent).toContain('Your level over time');
      cleanup();
    }
  });

  it('labels the chart for a screen reader — an inline SVG is otherwise invisible', () => {
    renderChart(stub(TWO));
    const img = screen.getByRole('img');
    expect(img.getAttribute('aria-label')).toMatch(/Level over time, 2 check-ins/);
  });

  it('does not auto-scale the y-axis to the data', () => {
    // Two nearly identical readings must NOT fill the plot. A 0.02 wobble drawn
    // as a mountain is the lying-empty-state rule wearing a chart.
    const flat = [
      { takenAt: '2026-04-10T00:00:00.000Z', overall: 2.90 },
      { takenAt: '2026-08-10T00:00:00.000Z', overall: 2.92 },
    ];
    const { container } = renderChart(stub(flat));
    const pts = container.querySelector('polyline')!.getAttribute('points')!.split(' ');
    const ys = pts.map((p) => Number(p.split(',')[1]));
    expect(Math.abs(ys[0] - ys[1])).toBeLessThan(1);
  });

  it('orders by takenAt and keeps uneven gaps — time, not sessions attended', () => {
    const outOfOrder = [
      { takenAt: '2026-08-10T00:00:00.000Z', overall: 3.0 },
      { takenAt: '2026-01-10T00:00:00.000Z', overall: 2.0 },
      { takenAt: '2026-02-10T00:00:00.000Z', overall: 2.5 },
    ];
    const rows = plottable(outOfOrder);
    expect(rows.map((r) => r.overall)).toEqual([2.0, 2.5, 3.0]);

    const { container } = renderChart(stub(outOfOrder));
    const xs = container
      .querySelector('polyline')!
      .getAttribute('points')!
      .split(' ')
      .map((p) => Number(p.split(',')[0]));
    // Jan -> Feb is one month; Feb -> Aug is six. An x-axis indexed on the
    // COUNT of check-ins would space these evenly and quietly say something
    // about turning up rather than about improving.
    expect(xs[1] - xs[0]).toBeLessThan(xs[2] - xs[1]);
  });

  it('drops a snapshot with no usable date or score rather than plotting a guess', () => {
    expect(plottable([{ takenAt: undefined, overall: 3 }])).toHaveLength(0);
    expect(plottable([{ takenAt: '2026-04-10T00:00:00.000Z', overall: null }])).toHaveLength(0);
    expect(plottable([{ takenAt: 'not-a-date', overall: 3 }])).toHaveLength(0);
  });
});
