// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBodyScrollLock } from '../../../components/BottomSheet/useBodyScrollLock';

describe('useBodyScrollLock', () => {
  afterEach(() => {
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
  });

  it('applies position: fixed to body when active', () => {
    renderHook(() => useBodyScrollLock(true));
    expect(document.body.style.position).toBe('fixed');
  });

  it('does NOT apply when inactive', () => {
    renderHook(() => useBodyScrollLock(false));
    expect(document.body.style.position).toBe('');
  });

  it('restores body styles on unmount', () => {
    const { unmount } = renderHook(() => useBodyScrollLock(true));
    expect(document.body.style.position).toBe('fixed');
    unmount();
    expect(document.body.style.position).toBe('');
    expect(document.body.style.top).toBe('');
    expect(document.body.style.width).toBe('');
  });
});
