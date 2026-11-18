// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ActionRow from '../../components/primitives/ActionRow';

describe('ActionRow', () => {
  afterEach(() => cleanup());

  it('is a button that never submits a surrounding form', () => {
    render(<ActionRow icon="check" label="Mark paid" onClick={() => {}} />);
    expect(screen.getByRole('button').getAttribute('type')).toBe('button');
  });

  it('is named by its label, not by the icon ligature', () => {
    render(<ActionRow icon="link" label="Copy link" onClick={() => {}} />);
    // The glyph's ligature text ("link") is aria-hidden, so it is not read.
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
    expect(screen.getByText('link').getAttribute('aria-hidden')).toBe('true');
  });

  it('shows the hint under the label', () => {
    render(<ActionRow icon="undo" label="Mark unpaid" hint="Puts it back on their balance" onClick={() => {}} />);
    expect(screen.getByText('Puts it back on their balance')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Mark unpaid/ })).toBeTruthy();
  });

  it('runs its action on tap', () => {
    const onClick = vi.fn();
    render(<ActionRow icon="check" label="Mark paid" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does nothing while disabled, and looks it', () => {
    const onClick = vi.fn();
    render(<ActionRow icon="check" label="Mark paid" onClick={onClick} disabled />);
    const row = screen.getByRole('button') as HTMLButtonElement;
    expect(row.disabled).toBe(true);
    expect(row.style.opacity).toBe('0.5');
    fireEvent.click(row);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('tints the glyph and label red for a destructive action, and only then', () => {
    const { rerender } = render(<ActionRow icon="delete" label="Remove" onClick={() => {}} destructive />);
    expect(screen.getByText('Remove').style.color).toBe('var(--red-soft)');
    expect(screen.getByText('delete').style.color).toBe('var(--red-soft)');

    rerender(<ActionRow icon="delete" label="Remove" onClick={() => {}} />);
    expect(screen.getByText('Remove').style.color).toBe('var(--text-primary)');
    expect(screen.getByText('delete').style.color).toBe('var(--text-secondary)');
  });

  it('keeps its press state on the class, where :active can reach it', () => {
    render(<ActionRow icon="check" label="Mark paid" onClick={() => {}} />);
    expect(screen.getByRole('button').className).toContain('action-row');
  });
});
