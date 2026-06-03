// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import NameAutocompleteInput from '@/components/home/NameAutocompleteInput';

afterEach(() => cleanup());

function renderInput(over: Partial<React.ComponentProps<typeof NameAutocompleteInput>> = {}) {
  const onValueChange = vi.fn();
  render(
    <NameAutocompleteInput
      id="name"
      value=""
      onValueChange={onValueChange}
      suggestions={['Lin', 'Viktor', 'Carolina']}
      placeholder="Your name"
      ariaLabel="Your name"
      {...over}
    />,
  );
  return { onValueChange, input: screen.getByRole('combobox') as HTMLInputElement };
}

describe('NameAutocompleteInput — combobox a11y', () => {
  it('exposes combobox roles; collapsed until focused', () => {
    const { input } = renderInput();
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('expands on focus and renders the suggestions as options', () => {
    const { input } = renderInput();
    fireEvent.focus(input);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    const listbox = screen.getByRole('listbox');
    expect(input.getAttribute('aria-controls')).toBe(listbox.id);
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('ArrowDown moves the active option (aria-activedescendant + aria-selected)', () => {
    const { input } = renderInput();
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // → first
    const opts = screen.getAllByRole('option');
    expect(input.getAttribute('aria-activedescendant')).toBe(opts[0].id);
    expect(opts[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // → second
    expect(input.getAttribute('aria-activedescendant')).toBe(opts[1].id);
    expect(opts[1].getAttribute('aria-selected')).toBe('true');
    expect(opts[0].getAttribute('aria-selected')).toBe('false');
  });

  it('ArrowUp from the first option wraps to the last', () => {
    const { input } = renderInput();
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // first
    fireEvent.keyDown(input, { key: 'ArrowUp' });   // wrap → last
    const opts = screen.getAllByRole('option');
    expect(input.getAttribute('aria-activedescendant')).toBe(opts[2].id);
  });

  it('Enter selects the active option and cancels the event (no form submit)', () => {
    const { input, onValueChange } = renderInput();
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // activate "Lin"
    const notPrevented = fireEvent.keyDown(input, { key: 'Enter' });
    expect(onValueChange).toHaveBeenCalledWith('Lin');
    expect(notPrevented).toBe(false); // preventDefault was called
  });

  it('Enter with NO active option falls through to form submit (does not cancel)', () => {
    const { input, onValueChange } = renderInput();
    fireEvent.focus(input); // open, but nothing highlighted
    const notPrevented = fireEvent.keyDown(input, { key: 'Enter' });
    expect(onValueChange).not.toHaveBeenCalled();
    expect(notPrevented).toBe(true); // event left alone → the form's submit runs
  });

  it('Escape collapses the listbox', () => {
    const { input } = renderInput();
    fireEvent.focus(input);
    expect(screen.getByRole('listbox')).toBeDefined();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('still selects via mouse (onMouseDown — load-bearing vs blur)', () => {
    const { input, onValueChange } = renderInput();
    fireEvent.focus(input);
    fireEvent.mouseDown(screen.getByText('Viktor'));
    expect(onValueChange).toHaveBeenCalledWith('Viktor');
  });
});
