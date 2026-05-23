import { describe, it, expect } from 'vitest';
import { topPartners } from '@/lib/recommend';

describe('topPartners', () => {
  const sessions = [
    { sessionId: 's1', names: ['Me', 'Alice', 'Bob'] },
    { sessionId: 's2', names: ['Me', 'Alice'] },
    { sessionId: 's3', names: ['Alice', 'Bob'] }, // Me absent — ignored
  ];

  it('counts co-attendance only for sessions the viewer attended', () => {
    expect(topPartners({ me: 'Me', sessions })).toEqual([
      { name: 'Alice', count: 2 },
      { name: 'Bob', count: 1 },
    ]);
  });

  it('is case-insensitive on the viewer name', () => {
    expect(topPartners({ me: 'me', sessions })[0]).toEqual({ name: 'Alice', count: 2 });
  });

  it('returns [] when the viewer attended nothing', () => {
    expect(topPartners({ me: 'Ghost', sessions })).toEqual([]);
  });

  it('breaks count ties alphabetically and respects limit', () => {
    const tied = [{ sessionId: 'x', names: ['Me', 'Zoe', 'Amy'] }];
    expect(topPartners({ me: 'Me', sessions: tied, limit: 1 })).toEqual([{ name: 'Amy', count: 1 }]);
  });
});
