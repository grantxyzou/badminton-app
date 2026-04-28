import { describe, it, expect } from 'vitest';
import { appendEvent } from '../lib/recoveryAudit';

describe('recoveryAudit.appendEvent', () => {
  it('appends to an empty list', () => {
    const out = appendEvent(undefined, { event: 'pin-set', at: 'now' });
    expect(out).toHaveLength(1);
    expect(out[0].event).toBe('pin-set');
  });

  it('caps at 200 entries by dropping oldest', () => {
    const seed: { event: 'pin-set'; at: string }[] = Array.from({ length: 200 }, (_, i) => ({
      event: 'pin-set' as const,
      at: `t-${i}`,
    }));
    const out = appendEvent(seed, { event: 'pin-removed', at: 'newest' });
    expect(out).toHaveLength(200);
    expect(out[0].at).toBe('t-1'); // oldest dropped
    expect(out[199].at).toBe('newest');
  });
});
