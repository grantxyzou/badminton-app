// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { useFocusTrap } from '../../../components/BottomSheet/useFocusTrap';

function Harness({ active, triggerRef }: { active: boolean; triggerRef?: React.RefObject<HTMLElement> }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(active, containerRef, triggerRef);
  return (
    <div>
      <button data-testid="outside-before">outside-before</button>
      <div ref={containerRef} data-testid="container">
        <button data-testid="first">first</button>
        <button data-testid="last">last</button>
      </div>
      <button data-testid="outside-after">outside-after</button>
    </div>
  );
}

describe('useFocusTrap', () => {
  afterEach(cleanup);

  it('moves focus to the first focusable element in container on activate', () => {
    render(<Harness active={true} />);
    expect(document.activeElement?.getAttribute('data-testid')).toBe('first');
  });

  it('does nothing when inactive', () => {
    render(<Harness active={false} />);
    expect(document.activeElement?.getAttribute('data-testid')).not.toBe('first');
  });

  it('returns focus to triggerRef on unmount', () => {
    const triggerEl = document.createElement('button');
    triggerEl.setAttribute('data-testid', 'trigger');
    document.body.appendChild(triggerEl);
    const triggerRef = { current: triggerEl };
    const { unmount } = render(<Harness active={true} triggerRef={triggerRef} />);
    expect(document.activeElement?.getAttribute('data-testid')).toBe('first');
    unmount();
    expect(document.activeElement?.getAttribute('data-testid')).toBe('trigger');
    document.body.removeChild(triggerEl);
  });
});
