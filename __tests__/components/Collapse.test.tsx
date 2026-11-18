// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import Collapse from '../../components/primitives/Collapse';

// --duration-sheet. The close unmounts after it.
const CLOSE_MS = 180;

function body(container: HTMLElement) {
  return container.querySelector<HTMLElement>('.motion-collapse');
}

describe('Collapse', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('closed is ABSENT, like the `{open && …}` it replaces', () => {
    const { container } = render(
      <Collapse open={false}>
        <p>Details</p>
      </Collapse>,
    );
    expect(screen.queryByText('Details')).toBeNull();
    expect(body(container)).toBeNull();
  });

  it('starts open when mounted open', () => {
    const { container } = render(
      <Collapse open>
        <p>Details</p>
      </Collapse>,
    );
    expect(screen.getByText('Details')).toBeTruthy();
    expect(body(container)!.getAttribute('data-open')).toBe('true');
  });

  it('opening mounts the content and expands it in the same commit', () => {
    const { container, rerender } = render(
      <Collapse open={false}>
        <p>Details</p>
      </Collapse>,
    );
    rerender(
      <Collapse open>
        <p>Details</p>
      </Collapse>,
    );
    expect(screen.getByText('Details')).toBeTruthy();
    expect(body(container)!.getAttribute('data-open')).toBe('true');
  });

  it('closing collapses first and unmounts only after the close has played', () => {
    const { container, rerender } = render(
      <Collapse open>
        <p>Details</p>
      </Collapse>,
    );
    rerender(
      <Collapse open={false}>
        <p>Details</p>
      </Collapse>,
    );
    // Still on screen, animating shut.
    expect(body(container)!.getAttribute('data-open')).toBe('false');
    expect(screen.getByText('Details')).toBeTruthy();

    act(() => vi.advanceTimersByTime(CLOSE_MS - 1));
    expect(screen.getByText('Details')).toBeTruthy();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('Details')).toBeNull();
  });

  it('reopening during the close keeps the content mounted', () => {
    const { container, rerender } = render(
      <Collapse open>
        <p>Details</p>
      </Collapse>,
    );
    rerender(
      <Collapse open={false}>
        <p>Details</p>
      </Collapse>,
    );
    act(() => vi.advanceTimersByTime(CLOSE_MS / 2));
    rerender(
      <Collapse open>
        <p>Details</p>
      </Collapse>,
    );
    act(() => vi.advanceTimersByTime(CLOSE_MS));
    expect(screen.getByText('Details')).toBeTruthy();
    expect(body(container)!.getAttribute('data-open')).toBe('true');
  });

  it('carries the id a control points at with aria-controls', () => {
    const { container } = render(
      <Collapse open id="more-options">
        <p>Details</p>
      </Collapse>,
    );
    expect(body(container)!.id).toBe('more-options');
  });

  it('moves the space above inside the clipped area, so it closes with the content', () => {
    const { container } = render(
      <Collapse open spaceAbove="var(--space-3)">
        <p>Details</p>
      </Collapse>,
    );
    const wrapper = body(container)!;
    expect(wrapper.style.marginTop).toBe('0px');
    const inner = screen.getByText('Details').parentElement as HTMLElement;
    expect(inner.style.paddingTop).toBe('var(--space-3)');
  });

  it('adds no spacing styles without spaceAbove', () => {
    const { container } = render(
      <Collapse open>
        <p>Details</p>
      </Collapse>,
    );
    expect(body(container)!.getAttribute('style')).toBeNull();
  });
});
