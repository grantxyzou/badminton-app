// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import HydrationMark from '../../components/HydrationMark';

describe('HydrationMark', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-hydrated');
  });

  it('sets data-hydrated="true" on <html> after mount', () => {
    expect(document.documentElement.getAttribute('data-hydrated')).toBeNull();
    render(<HydrationMark />);
    expect(document.documentElement.getAttribute('data-hydrated')).toBe('true');
  });

  it('renders nothing to the DOM', () => {
    const { container } = render(<HydrationMark />);
    expect(container.firstChild).toBeNull();
  });
});
