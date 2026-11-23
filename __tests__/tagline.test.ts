import { describe, it, expect } from 'vitest';
import { pickTagline } from '@/lib/tagline';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';

describe('pickTagline', () => {
  const lines = ['a', 'b', 'c', 'd'];

  it('picks the same line for the same seed (the splash and Welcome agree)', () => {
    for (const seed of ['x', 'lI+KmsZpcF7fCHk1MViXRg==', '5lRaFfHaFN1wQg5XB+9WpQ==']) {
      expect(pickTagline(lines, seed)).toBe(pickTagline(lines, seed));
    }
  });

  it('spreads seeds across every line', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) seen.add(pickTagline(lines, `nonce-${i}`));
    expect([...seen].sort()).toEqual(lines);
  });

  it('no seed is the first line; no lines is empty', () => {
    expect(pickTagline(lines, null)).toBe('a');
    expect(pickTagline(lines, undefined)).toBe('a');
    expect(pickTagline([], 'x')).toBe('');
  });

  it('both languages have a list of lines', () => {
    expect(Array.isArray(en.signedOut.taglines) && en.signedOut.taglines.length).toBeGreaterThan(1);
    // Chinese keeps ONE line every visit; the list repeats it so its length
    // matches English's (the locale-parity tests compare leaf paths), and a new
    // English line fails here until Chinese has a slot for it.
    expect(zh.signedOut.taglines).toEqual(en.signedOut.taglines.map(() => '但愿无事能打球'));
    for (const line of en.signedOut.taglines) expect(line).toMatch(/^Badminton,? [Pp]\w* [Mm]/);
  });
});
