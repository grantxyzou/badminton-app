// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { rememberPictures, rememberedPictures, forgetPictures } from '../lib/warmPictures';
import { clearDeviceTraces } from '../lib/clearDeviceTraces';

/**
 * Grant, 2026-11-05: "It takes a split second to load out the string asset
 * like the renders". The Equipment card remembers its own pictures' addresses
 * so the next open fetches them while the app starts.
 */
beforeEach(() => localStorage.clear());

describe('the member\'s own pictures, fetched ahead', () => {
  it('keeps the addresses, dropping blanks, at most six', () => {
    rememberPictures(['/bpm/rackets/head/a.webp', null, '', '/bpm/strings/b.webp', undefined]);
    expect(rememberedPictures()).toEqual(['/bpm/rackets/head/a.webp', '/bpm/strings/b.webp']);
    rememberPictures(Array.from({ length: 9 }, (_, i) => `/p${i}.webp`));
    expect(rememberedPictures()).toHaveLength(6);
  });

  it('reads nothing from a broken entry', () => {
    localStorage.setItem('bpm_own_pictures', '{not json');
    expect(rememberedPictures()).toEqual([]);
  });

  it('sign-out forgets them, so the next person on a shared phone starts clean', async () => {
    rememberPictures(['/bpm/rackets/head/a.webp']);
    await clearDeviceTraces(10);
    expect(rememberedPictures()).toEqual([]);
    forgetPictures();
  });
});
