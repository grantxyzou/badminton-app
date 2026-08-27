// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import AIBadge from '../../components/primitives/AIBadge';
import StatusBadge from '../../components/primitives/StatusBadge';

/**
 * The AI provenance marker. Two of its details look like cruft and are not:
 * the `.badge-ai` class (the conic rim is a masked ::before, because a conic
 * gradient cannot be a border-color) and the nested span (that ::before paints
 * above the parent's text, so the label needs its own layer to stay readable).
 * Both have been pinned here so a tidy-up cannot quietly remove them.
 */
describe('AIBadge', () => {
  afterEach(() => cleanup());

  it('carries the .badge-ai class that paints the conic rim', () => {
    const { container } = render(<AIBadge>AI</AIBadge>);
    expect(container.querySelector('.badge-ai')).not.toBeNull();
  });

  it('sets no border — the rim is a masked ::before, not a border-color', () => {
    const { container } = render(<AIBadge>AI</AIBadge>);
    const style = container.querySelector('.badge-ai')?.getAttribute('style') ?? '';
    expect(style).not.toMatch(/(^|[^-])border:/);
  });

  it('wraps the label in its own positioned span so the ring cannot cover it', () => {
    const { container } = render(<AIBadge>AI</AIBadge>);
    const inner = container.querySelector('.badge-ai > span');
    expect(inner).not.toBeNull();
    expect(inner?.getAttribute('style') ?? '').toContain('position: relative');
    expect(inner?.textContent).toBe('AI');
  });

  it('exposes an accessible label when given one', () => {
    render(<AIBadge label="AI generated">AI</AIBadge>);
    expect(screen.getByLabelText('AI generated')).toBeTruthy();
  });

  it('renders without a label — the surrounding copy may already say so', () => {
    const { container } = render(<AIBadge>AI</AIBadge>);
    expect(container.querySelector('.badge-ai')?.hasAttribute('aria-label')).toBe(false);
  });

  /**
   * It left StatusBadge because it answers "where did this come from", not
   * "what state is this in" — and because it was the only variant that was not
   * a plain style object.
   */
  it('is not reachable through StatusBadge any more', () => {
    const { container } = render(
      // @ts-expect-error — 'ai' is deliberately no longer a StatusBadge variant.
      <StatusBadge variant="ai">AI</StatusBadge>,
    );
    expect(container.querySelector('.badge-ai')).toBeNull();
  });
});
