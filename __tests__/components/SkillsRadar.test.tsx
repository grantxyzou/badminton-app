// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import SkillsRadar from '../../components/SkillsRadar';
import type { PlayerSkills } from '../../components/SkillsRadar';

/**
 * Characterization tests for SkillsRadar (M1 mitigation for BottomSheet migration).
 *
 * SkillsRadar had zero pre-existing test coverage. Task 7b rewrites its inner
 * BottomSheet (~200 LOC) to use the new shared primitive. These tests pin the
 * CURRENT behavior so that migration cannot silently regress the open → edit →
 * close flow. They are not aspirational — if a path is unreachable in jsdom
 * (e.g. inside a recharts SVG), we document that with an early return.
 *
 * Inspection findings:
 *   - Prop shape: `{ players: PlayerSkills[]; onScoresChanged?: () => void }`.
 *   - `PlayerSkills = { id, name, scores: Record<string, number> }`.
 *   - Sheet trigger: each category in the 2-column grid is a `<button>` whose
 *     text content is `SKILL_DIMENSIONS[i].name` (e.g. "Grip & Stroke",
 *     "Movement"). Clicking it calls `openSheet(dimId, 'detail')`.
 *   - Sheet close: a round button with a "material-icons" child whose text is
 *     literally "close". No aria-label; we locate it via the icon text.
 *   - Score edit: inside the sheet's detail view, a "Edit level" button
 *     switches to edit mode, which renders six buttons (level 1..6) with text
 *     like "1. Beginner". Clicking one calls `onScoreChange` and PATCHes the
 *     API (mocked here via global.fetch stub).
 *   - Component doesn't use next-intl, so no `<NextIntlClientProvider>`
 *     wrapper is needed — rendering it inside one would be dead weight.
 *
 * recharts requires `window` measurements that jsdom can't provide reliably,
 * so we mock it out. The non-chart DOM (pills, toggle, category grid, sheet)
 * is what these tests characterize.
 */

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="recharts-container">{children}</div>
  ),
  RadarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="radar-chart">{children}</div>
  ),
  PolarGrid: () => null,
  PolarAngleAxis: () => null,
  PolarRadiusAxis: () => null,
  Radar: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

const mockPlayer: PlayerSkills = {
  id: 'p1',
  name: 'TestPlayer',
  scores: {
    'grip-stroke': 3,
    movement: 2,
    'serve-return': 0,
    offense: 0,
    defense: 0,
    strategy: 0,
    knowledge: 0,
  },
};

function renderRadar(overrides: Partial<Parameters<typeof SkillsRadar>[0]> = {}) {
  const defaultProps = {
    players: [mockPlayer],
    onScoresChanged: vi.fn(),
  };
  return render(<SkillsRadar {...defaultProps} {...overrides} />);
}

describe('SkillsRadar — sheet lifecycle (characterization, M1 mitigation)', () => {
  beforeEach(() => {
    // Stub fetch so EditContent's PATCH doesn't reach the network.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true } as Response)),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    // The sheet mounts a body-lock effect that pins `position: fixed` on
    // document.body. Reset so leaks between tests don't cascade.
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    document.body.style.overflow = '';
    document.documentElement.style.overscrollBehavior = '';
  });

  it('renders the radar chart container on mount (no sheet by default)', () => {
    renderRadar();
    // The mocked ResponsiveContainer renders — proves we got past the
    // component's top-level JSX without crashing.
    expect(screen.queryByTestId('recharts-container')).not.toBeNull();
    // Category grid buttons are present — these are the sheet triggers.
    expect(screen.queryByRole('button', { name: /Grip & Stroke/i })).not.toBeNull();
    // No sheet content yet. The sheet's identifying text is "All Levels"
    // (the uppercase section header in DetailContent) — absence proves
    // the sheet isn't mounted.
    expect(screen.queryByText(/^All Levels$/)).toBeNull();
  });

  it('opens the sheet (detail view) when a category card is clicked', () => {
    renderRadar();
    const trigger = screen.getByRole('button', { name: /Grip & Stroke/i });
    fireEvent.click(trigger);

    // Detail view markers: the "All Levels" header and the "Edit level"
    // button both only exist when the sheet is open in detail mode.
    expect(screen.queryByText(/^All Levels$/)).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Edit level/i })).not.toBeNull();
  });

  it('closes the sheet when the close affordance is clicked', () => {
    renderRadar();
    fireEvent.click(screen.getByRole('button', { name: /Grip & Stroke/i }));
    expect(screen.queryByText(/^All Levels$/)).not.toBeNull();

    // Close button has no accessible label — it's a round button whose
    // only child is a material-icons span with text "close". Locate by
    // that icon text, then walk up to the button.
    const icon = screen.getByText('close', { selector: '.material-icons' });
    const closeBtn = icon.closest('button');
    expect(closeBtn).not.toBeNull();
    fireEvent.click(closeBtn!);

    // Sheet is gone — both the "All Levels" header and the "Edit level"
    // button are unmounted.
    expect(screen.queryByText(/^All Levels$/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit level/i })).toBeNull();
  });

  it('switches to edit view and records a score change through onScoreChange', () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true } as Response));
    vi.stubGlobal('fetch', fetchMock);

    renderRadar();
    fireEvent.click(screen.getByRole('button', { name: /Grip & Stroke/i }));
    // Enter edit view.
    fireEvent.click(screen.getByRole('button', { name: /Edit level/i }));

    // Edit view renders six level buttons (1..6) with text like "1. Beginner".
    const levelFiveBtn = screen.getByRole('button', { name: /5\. Provincial/i });
    fireEvent.click(levelFiveBtn);

    // Characterization: clicking a level triggers a PATCH to /api/skills
    // with the new level for the active dimension.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/skills');
    expect(init.method).toBe('PATCH');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ id: 'p1', scores: { 'grip-stroke': 5 } });
  });
});

/**
 * Green-rebalance characterization (2026-04-16): after demoting informational
 * level text from var(--accent) to var(--text-primary), the category card's
 * level readout MUST render with primary color, not accent. Preserves the five
 * swaps from the page-headers-skills-polish branch through future changes.
 */
describe('SkillsRadar — green rebalance', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true } as Response)));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('category card level text uses primary color, not accent green', () => {
    renderRadar();
    // Category cards render a button per skill dimension with two <p> tags:
    // the dimension name and the level readout ("3 — Competent" or "Not rated").
    // Assert the level readout's inline style uses var(--text-primary), not
    // var(--accent), per the 2026-04-16 green-rebalance spec.
    const levelTexts = screen.getAllByText(/—|Not rated/);
    expect(levelTexts.length).toBeGreaterThan(0);
    const first = levelTexts[0]!;
    const styleAttr = first.getAttribute('style') ?? '';
    expect(styleAttr).not.toContain('var(--accent)');
    expect(styleAttr).toContain('var(--text-primary)');
  });
});
