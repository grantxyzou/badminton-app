// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import StateCard, { StateLink, PreviewRow, PreviewMeter } from '../../components/primitives/StateCard';

describe('StateCard', () => {
  afterEach(() => cleanup());

  it('announces a danger state as an alert', () => {
    render(<StateCard tone="danger" message="Couldn't load payments." />);
    expect(screen.getByRole('alert').textContent).toBe("Couldn't load payments.");
    expect(screen.queryByRole('status')).toBeNull();
  });

  it.each(['warn', 'success', undefined] as const)('announces tone %s politely, as a status', (tone) => {
    render(<StateCard tone={tone} message="Sign in to see your stats." />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('puts the tone on the glass (the CSS tints by data-tone), and none for plain glass', () => {
    const { container, rerender } = render(<StateCard tone="warn" message="m" />);
    expect(container.querySelector('section')!.getAttribute('data-tone')).toBe('warn');
    rerender(<StateCard message="m" />);
    expect(container.querySelector('section')!.hasAttribute('data-tone')).toBe(false);
  });

  it('names the region after a string title', () => {
    render(<StateCard title="Payments" icon="payments" message="m" />);
    expect(screen.getByRole('region', { name: 'Payments' })).toBeTruthy();
  });

  it('leaves the region unnamed when the title is not a string', () => {
    const { container } = render(<StateCard title={<span>Payments</span>} message="m" />);
    expect(container.querySelector('section')!.hasAttribute('aria-label')).toBe(false);
  });

  it('draws no header without a title', () => {
    const { container } = render(<StateCard message="m" />);
    expect(container.querySelector('.bpm-h3')).toBeNull();
  });

  it('hides the empty preview from screen readers: shape, not content', () => {
    const { container } = render(
      <StateCard message="m">
        <PreviewRow />
      </StateCard>,
    );
    expect(container.querySelector('.state-preview')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws no preview wrapper when there is no shape to draw', () => {
    const { container } = render(<StateCard message="m" />);
    expect(container.querySelector('.state-preview')).toBeNull();
  });
});

describe('StateLink', () => {
  afterEach(() => cleanup());

  it('is a real button that never submits a surrounding form', () => {
    const onClick = vi.fn();
    render(<StateLink onClick={onClick}>Try again</StateLink>);
    const link = screen.getByRole('button', { name: 'Try again' });
    expect(link.getAttribute('type')).toBe('button');
    fireEvent.click(link);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('PreviewRow', () => {
  afterEach(() => cleanup());

  it('shows a dash where the value would be, by default', () => {
    const { container } = render(<PreviewRow />);
    expect(container.querySelector('.state-dash')!.textContent).toBe('—');
    expect(container.querySelector('.material-icons')).toBeNull();
  });

  it('drops the value dash when given an empty value', () => {
    const { container } = render(<PreviewRow value="" />);
    expect(container.querySelector('.state-dash')).toBeNull();
  });

  it('draws the leading glyph and sizes the label bar', () => {
    const { container } = render(<PreviewRow icon="person" width="30%" />);
    expect(container.querySelector('.material-icons')!.textContent).toBe('person');
    expect((container.querySelector('.state-line') as HTMLElement).style.width).toBe('30%');
  });
});

describe('PreviewMeter', () => {
  afterEach(() => cleanup());

  it('labels an empty bar', () => {
    const { container } = render(<PreviewMeter label="Share paid" />);
    expect(screen.getByText('Share paid')).toBeTruthy();
    expect(container.querySelector('.state-bar')).toBeTruthy();
  });
});
