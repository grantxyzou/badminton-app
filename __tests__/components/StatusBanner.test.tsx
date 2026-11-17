// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import StatusBanner, { type StatusTone } from '../../components/primitives/StatusBanner';

function root(container: HTMLElement) {
  return container.firstElementChild as HTMLElement;
}

describe('StatusBanner', () => {
  afterEach(() => cleanup());

  it.each([
    ['success', 'status-banner-green'],
    ['warn', 'status-banner-orange'],
    ['danger', 'status-banner-red'],
  ] as [StatusTone, string][])('tone %s wears the canonical %s class', (tone, cls) => {
    const { container } = render(<StatusBanner tone={tone} icon="info" title="Title" />);
    expect(root(container).className).toBe(cls);
  });

  it('bakes the title colour into the tone, so call sites never thread it', () => {
    render(<StatusBanner tone="warn" icon="watch_later" title="Sign-ups close soon" />);
    expect(screen.getByText('Sign-ups close soon').className).toContain('text-amber-300');
  });

  it('hides the glyph from screen readers', () => {
    render(<StatusBanner tone="success" icon="celebration" title="You're in" />);
    expect(screen.getByText('celebration').getAttribute('aria-hidden')).toBe('true');
  });

  it('shows the body when given one, and nothing in its place otherwise', () => {
    const { rerender, container } = render(
      <StatusBanner tone="success" icon="check" title="Paid" body="Thanks, you're all square." />,
    );
    expect(screen.getByText("Thanks, you're all square.")).toBeTruthy();
    rerender(<StatusBanner tone="success" icon="check" title="Paid" />);
    expect(container.querySelectorAll('p')).toHaveLength(1);
  });

  it('adds the celebration only when asked', () => {
    const { container, rerender } = render(<StatusBanner tone="success" icon="celebration" title="You're in" celebrate />);
    expect(root(container).className).toBe('status-banner-green status-celebrate');
    rerender(<StatusBanner tone="success" icon="celebration" title="You're in" />);
    expect(root(container).className).not.toContain('status-celebrate');
  });

  it('puts a trailing figure at the far edge of the row', () => {
    render(<StatusBanner tone="success" icon="check" title="Your racket is ready" trailing="$28.00" />);
    expect(screen.getByText('$28.00')).toBeTruthy();
  });

  it('becomes a column holding the action under the row', () => {
    const { container } = render(
      <StatusBanner
        tone="warn"
        icon="edit"
        title="The stringer changed your order"
        action={<button type="button">Review the change</button>}
      />,
    );
    const banner = root(container);
    expect(banner.style.flexDirection).toBe('column');
    // The row comes first, the action after it.
    expect(banner.lastElementChild!.textContent).toBe('Review the change');
    expect(banner.firstElementChild!.textContent).toContain('The stringer changed your order');
  });

  it('stays a single row without an action', () => {
    const { container } = render(<StatusBanner tone="warn" icon="lock_clock" title="Sign-ups are closed" />);
    expect(root(container).style.flexDirection).toBe('');
  });
});
