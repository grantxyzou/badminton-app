// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import CardHeader from '../../components/primitives/CardHeader';

describe('CardHeader', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders icon glyph, title, and subtitle', () => {
    render(<CardHeader icon="trending_up" title="Your stats" subtitle="Sessions played" />);
    expect(screen.getByText('Your stats')).toBeTruthy();
    expect(screen.getByText('Sessions played')).toBeTruthy();
    expect(screen.getByText('trending_up')).toBeTruthy(); // material-icons glyph name
  });

  it('subtitle uses the token-backed .fs-sm class, not an inline font size', () => {
    render(<CardHeader icon="x" title="T" subtitle="Sub copy" />);
    const sub = screen.getByText('Sub copy');
    expect(sub.className).toContain('fs-sm');
    // no hand-typed pixel font size on the subtitle
    expect(sub.getAttribute('style') ?? '').not.toMatch(/font-size:\s*\d/);
  });

  it('title uses bpm-h3', () => {
    render(<CardHeader title="Heading" />);
    expect(screen.getByText('Heading').className).toContain('bpm-h3');
  });

  it('renders a trailing badge when provided', () => {
    render(<CardHeader icon="x" title="T" badge={<span>Beta</span>} />);
    expect(screen.getByText('Beta')).toBeTruthy();
  });

  it('renders a trailing action when provided', () => {
    render(<CardHeader title="T" action={<button>Re-rate</button>} />);
    expect(screen.getByRole('button', { name: 'Re-rate' })).toBeTruthy();
  });

  it('omits the icon span when no icon is given', () => {
    const { container } = render(<CardHeader title="No icon" />);
    expect(container.querySelector('.material-icons')).toBeNull();
  });

  /**
   * `compact` swaps the title to `.section-label-muted`, and the icon has to
   * follow it. globals.css already styles `.section-label-muted .material-icons`
   * at --icon-sm/600, but that is a DESCENDANT selector and this icon is a
   * SIBLING of the <h3> — so the rule never applies here and the size has to be
   * set explicitly. Shipped as a visible mismatch on Home: the stringing card's
   * icon rendered 22px beside UnpaidSessionsCard's 16px one.
   */
  describe('compact icon matches the section label it sits beside', () => {
    it('renders the icon at --icon-sm, not the Tier-A heading size', () => {
      const { container } = render(<CardHeader compact icon="grid_4x4" title="Stringing" />);
      const style = container.querySelector('.material-icons')?.getAttribute('style') ?? '';
      expect(style).toContain('--icon-sm');
      expect(style).not.toContain('--fs-stat-lg');
    });

    it('renders the icon at weight 600 so it does not read thin against the label', () => {
      const { container } = render(<CardHeader compact icon="grid_4x4" title="Stringing" />);
      const style = container.querySelector('.material-icons')?.getAttribute('style') ?? '';
      expect(style).toMatch(/wght'?\s*600/);
    });

    it('leaves the non-compact icon at the Tier-A heading size', () => {
      const { container } = render(<CardHeader icon="trending_up" title="Trend" />);
      const style = container.querySelector('.material-icons')?.getAttribute('style') ?? '';
      expect(style).toContain('--fs-stat-lg');
      expect(style).not.toContain('--icon-sm');
    });

    it('renders the compact title as a section label', () => {
      render(<CardHeader compact icon="x" title="Balance" />);
      expect(screen.getByText('Balance').className).toContain('section-label-muted');
    });
  });
});
