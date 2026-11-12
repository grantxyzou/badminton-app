// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { requestProfileView, takeProfileView, PROFILE_VIEW_KEY } from '../lib/profileView';

describe('profileView marker', () => {
  beforeEach(() => sessionStorage.clear());

  it('hands the requested view over once, then forgets it', () => {
    requestProfileView('stats-privacy');
    expect(takeProfileView()).toBe('stats-privacy');
    expect(takeProfileView()).toBeNull();
  });

  it('carries the balance card\'s two links: See details and Redeem a gift card', () => {
    requestProfileView('balance');
    expect(takeProfileView()).toBe('balance');
    requestProfileView('gift-cards');
    expect(takeProfileView()).toBe('gift-cards');
  });

  it('ignores a value it does not know', () => {
    sessionStorage.setItem(PROFILE_VIEW_KEY, 'groups');
    expect(takeProfileView()).toBeNull();
    expect(sessionStorage.getItem(PROFILE_VIEW_KEY)).toBeNull();
  });
});
