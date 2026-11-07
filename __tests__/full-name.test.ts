import { describe, it, expect } from 'vitest';
import { isFullName } from '@/lib/fullName';

/** The door asks a new person for a first AND last name (Grant, 2026-11-07). */
describe('isFullName', () => {
  it.each(['Sandra Lee', '  Chris   Lu ', 'Chris L.', 'Mary Ann Smith', 'José Núñez', '张伟', '山田 太郎', '김민준'])(
    'accepts %s',
    (name) => expect(isFullName(name)).toBe(true),
  );
  it.each(['', '   ', 'Sandra', 'Player 1', 'Lin -', '张'])('refuses %j', (name) => expect(isFullName(name)).toBe(false));
});
