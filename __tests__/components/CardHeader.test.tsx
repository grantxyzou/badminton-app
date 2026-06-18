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
});
