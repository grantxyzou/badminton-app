// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { useRef } from 'react';
import { render, cleanup } from '@testing-library/react';
import { useFocusTrap } from '../../../components/BottomSheet/useFocusTrap';

/**
 * Two traps at once — the sheet-swap case, the focus-trap twin of the
 * reference-counted body scroll lock. The closing sheet's trap must not hand
 * focus to the page beneath the sheet that is still open.
 */
afterEach(cleanup);

function Trap({ active, label }: { active: boolean; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(active, ref);
  return (
    <div ref={ref} data-trap={label}>
      <button type="button">{label} first</button>
      <button type="button">{label} last</button>
    </div>
  );
}

describe('useFocusTrap — top-of-stack only', () => {
  it('releasing the older trap leaves focus inside the newer one, and the last release restores the origin', () => {
    const origin = document.createElement('button');
    origin.textContent = 'rail card';
    document.body.appendChild(origin);
    origin.focus();

    const { rerender } = render(<><Trap active label="pick" /></>);
    expect((document.activeElement as HTMLElement).textContent).toBe('pick first');

    // The fit sheet opens while the pick sheet is still (closing but) active.
    rerender(<><Trap active label="pick" /><Trap active label="fit" /></>);
    expect((document.activeElement as HTMLElement).textContent).toBe('fit first');

    // The pick sheet finishes closing: focus must stay in the fit sheet.
    rerender(<><Trap active={false} label="pick" /><Trap active label="fit" /></>);
    expect((document.activeElement as HTMLElement).textContent).toBe('fit first');

    // The fit sheet closes: only now does focus go back to where it began.
    rerender(<><Trap active={false} label="pick" /><Trap active={false} label="fit" /></>);
    expect(document.activeElement).toBe(origin);
    origin.remove();
  });

  it('a NESTED sheet returns focus to the button inside the sheet that opened it', () => {
    function Outer({ inner }: { inner: boolean }) {
      const ref = useRef<HTMLDivElement>(null);
      useFocusTrap(true, ref);
      return (
        <div ref={ref}>
          <button type="button">outer first</button>
          <button type="button" id="opener">open inner</button>
          {inner && <Trap active label="inner" />}
        </div>
      );
    }
    const { rerender } = render(<Outer inner={false} />);
    document.getElementById('opener')!.focus();
    rerender(<Outer inner />);
    expect((document.activeElement as HTMLElement).textContent).toBe('inner first');
    rerender(<Outer inner={false} />);
    expect((document.activeElement as HTMLElement).id).toBe('opener');
  });
});
