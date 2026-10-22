// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import MoneyInput from '../../components/primitives/MoneyInput';

/**
 * The one way the stringing screens take a dollar amount: the `$` inside the
 * field, the value a string the caller parses (empty is an answer, not 0).
 */
afterEach(cleanup);

describe('MoneyInput', () => {
  it('draws the $ inside the field and hands back exactly what was typed', () => {
    const onChange = vi.fn();
    render(<MoneyInput value="" onChange={onChange} ariaLabel="Your price" placeholder="Ask" />);
    const input = screen.getByLabelText('Your price') as HTMLInputElement;
    expect(input.getAttribute('inputmode')).toBe('decimal');
    expect(input.parentElement?.textContent).toBe('$');
    fireEvent.change(input, { target: { value: '32.50' } });
    expect(onChange).toHaveBeenCalledWith('32.50');
  });

  it('labels by id when a <label htmlFor> names it', () => {
    render(
      <>
        <label htmlFor="p">Restring price</label>
        <MoneyInput id="p" value="30" onChange={() => {}} />
      </>,
    );
    expect((screen.getByLabelText('Restring price') as HTMLInputElement).value).toBe('30');
  });
});
