// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import Switch from '../../components/primitives/Switch';

describe('Switch', () => {
  afterEach(() => cleanup());

  it('exposes role="switch" with aria-checked, not a checkbox', () => {
    render(<Switch checked={false} onChange={() => {}} ariaLabel="Club comparison" />);
    const el = screen.getByRole('switch');
    expect(el.getAttribute('aria-checked')).toBe('false');
    expect(el.tagName).toBe('BUTTON');
    // A binary setting must not be announced as a toggle-button.
    expect(el.hasAttribute('aria-pressed')).toBe(false);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('reflects the checked state on aria-checked (the CSS reads this too)', () => {
    render(<Switch checked onChange={() => {}} ariaLabel="Club comparison" />);
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  });

  it('is labelled', () => {
    render(<Switch checked={false} onChange={() => {}} ariaLabel="Club comparison" />);
    expect(screen.getByRole('switch', { name: 'Club comparison' })).toBeTruthy();
  });

  it('calls onChange with the NEXT value, not the current one', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Switch checked={false} onChange={onChange} ariaLabel="Club comparison" />,
    );
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);

    rerender(<Switch checked onChange={onChange} ariaLabel="Club comparison" />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('does not fire onChange while disabled (the offline posture)', () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} ariaLabel="Club comparison" disabled />);
    const el = screen.getByRole('switch') as HTMLButtonElement;
    expect(el.disabled).toBe(true);
    fireEvent.click(el);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('wires aria-describedby so the live state line can describe it', () => {
    render(
      <>
        <Switch
          checked
          onChange={() => {}}
          ariaLabel="Club comparison"
          ariaDescribedBy="cmp-state"
        />
        <p id="cmp-state">On — you&apos;ll see your band on every compared skill.</p>
      </>,
    );
    expect(screen.getByRole('switch').getAttribute('aria-describedby')).toBe('cmp-state');
  });
});
