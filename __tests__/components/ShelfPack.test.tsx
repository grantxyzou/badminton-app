// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ShelfPack, shelfHasPacks } from '@/components/stringing/StringPackImage';

/**
 * The shelf lists' packet (Grant, 2026-11-16: "add the packet render to
 * strings inventory list"): the picture when the string's catalog link has
 * one, a same-size blank when another row does (so names line up), and
 * nothing on a shelf with no pictures at all.
 */
afterEach(cleanup);

describe('ShelfPack', () => {
  it('shows the packet for a linked string with a picture', () => {
    const { container } = render(<ShelfPack catalogId="string-yx-bg80" reserve />);
    expect(container.querySelector('img')?.getAttribute('src')).toMatch(/string-yx-bg80\.webp$/);
  });

  it('holds the space for a string without one when other rows show a packet', () => {
    const { container } = render(<ShelfPack catalogId={undefined} reserve />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.string-pack-row')).not.toBeNull();
  });

  it('draws nothing on a shelf with no pictures', () => {
    const { container } = render(<ShelfPack catalogId={undefined} reserve={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('reserves only when some shelf string has a picture', () => {
    expect(shelfHasPacks(['BG80', 'House'], { BG80: 'string-yx-bg80' })).toBe(true);
    expect(shelfHasPacks(['House'], {})).toBe(false);
    expect(shelfHasPacks(['Typo'], { Typo: 'no-such-string' })).toBe(false);
  });
});
