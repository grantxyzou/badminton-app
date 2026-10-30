// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import LevelTrendChart, { plottableTrail, phaseReading } from '../../components/stats/LevelTrendChart';
import type { LevelState } from '../../lib/useLevelRead';
import type { TrailPoint } from '../../lib/levelRead';

/**
 * Your level over time.
 *
 * jsdom applies no stylesheet and lays nothing out, so NOTHING here asserts a
 * pixel. What it can assert is the shape of the SVG the component emits and,
 * more importantly, the four states — which is where the honesty lives: a
 * failed read must never render as "one check-in so far" to a member with
 * years of history.
 */

/** The level read the chart is handed: the canonical level's trail
 *  (`docs/plans/one-level.md`), ending on the current level. */
function stub(trail: TrailPoint[], status: LevelState['status'] = 'ready'): LevelState {
  return status === 'ready'
    ? { status, data: { level: trail.length ? trail[trail.length - 1].level : null, trail } }
    : { status, data: null };
}

function renderChart(level: LevelState) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages} timeZone="UTC">
      <LevelTrendChart level={level} onRetry={() => {}} />
    </NextIntlClientProvider>,
  );
}

const pt = (at: string, level: number): TrailPoint => ({ at, level });

const TWO = [
  pt('2026-04-10T00:00:00.000Z', 2.5),
  pt('2026-08-10T00:00:00.000Z', 2.9),
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
      pt('2026-04-10T00:00:00.000Z', 2.90),
      pt('2026-08-10T00:00:00.000Z', 2.92),
    ];
    const { container } = renderChart(stub(flat));
    const pts = container.querySelector('polyline')!.getAttribute('points')!.split(' ');
    const ys = pts.map((p) => Number(p.split(',')[1]));
    expect(Math.abs(ys[0] - ys[1])).toBeLessThan(1);
  });

  it('orders by takenAt and keeps uneven gaps — time, not sessions attended', () => {
    const outOfOrder = [
      pt('2026-08-10T00:00:00.000Z', 3.0),
      pt('2026-01-10T00:00:00.000Z', 2.0),
      pt('2026-02-10T00:00:00.000Z', 2.5),
    ];
    const rows = plottableTrail(outOfOrder);
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

  it('drops a point with no usable date or level rather than plotting a guess', () => {
    expect(plottableTrail([pt('not-a-date', 3)])).toHaveLength(0);
    expect(plottableTrail([pt('2026-04-10T00:00:00.000Z', Number.NaN)])).toHaveLength(0);
  });

  it('hides itself on a refused read, like the rest of the locked card', () => {
    const { container } = renderChart(stub([], 'forbidden'));
    expect(container.textContent).toBe('');
  });

  // ── The phase reading (Stats canvas, 2026-10-20) ──────────────────────────
  it('names the phase the latest check-in sits in, and how far the next one is', () => {
    renderChart(stub(TWO));
    // 2.9 sits in 2.6–3.4: Intermediate, 0.5 from Advanced.
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === "You're Intermediate, 0.5 from Advanced.")).toBeTruthy();
    // Every phase is named down the side, plain words only.
    for (const name of ['Beginner', 'Improver', 'Intermediate', 'Advanced', 'Competitive']) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }
  });

  it('says how far the level moved since the first check-in', () => {
    renderChart(stub(TWO));
    expect(screen.getByText('▲ 0.4 since Apr 10')).toBeTruthy();
  });

  it('labels each check-in with its value', () => {
    const { container } = renderChart(stub(TWO));
    expect(Array.from(container.querySelectorAll('.level-chart-value')).map((e) => e.textContent)).toEqual(['2.5', '2.9']);
  });
});

describe('phaseReading', () => {
  it.each([
    [1.0, 'foundation', 'exploration', 0.8],
    [2.6, 'switch', 'commitment', 0.8],
    [3.39, 'switch', 'commitment', 0.01],
    [4.3, 'advanced', null, null],
  ] as const)('%s → %s', (level, phase, next, gap) => {
    const r = phaseReading(level);
    expect(r.phase).toBe(phase);
    if (next === null) expect(r.next).toBeNull();
    else {
      expect(r.next!.phase).toBe(next);
      expect(r.next!.gap).toBeCloseTo(gap!, 5);
    }
  });
});
