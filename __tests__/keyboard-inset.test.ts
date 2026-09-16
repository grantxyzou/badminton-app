import { describe, it, expect } from 'vitest';
import { keyboardInset, KEYBOARD_MIN_PX } from '../components/BottomSheet/useKeyboardInset';

describe('keyboardInset', () => {
  it('is the gap between the layout height and what is actually visible', () => {
    expect(keyboardInset(900, { height: 560, offsetTop: 0 })).toBe(340);
  });
  it('counts a visual viewport that has scrolled down (iOS pans it with the keyboard)', () => {
    expect(keyboardInset(900, { height: 560, offsetTop: 40 })).toBe(300);
  });
  it('is zero below the toolbar threshold', () => {
    expect(keyboardInset(900, { height: 900 - (KEYBOARD_MIN_PX - 1), offsetTop: 0 })).toBe(0);
  });
  it('is zero when Android has already resized the layout (resizes-content)', () => {
    expect(keyboardInset(560, { height: 560, offsetTop: 0 })).toBe(0);
  });
});
