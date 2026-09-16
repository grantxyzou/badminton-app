import { describe, it, expect } from 'vitest';
import { toTab } from '@/components/HomeShell';
import { buildStringingPayload, buildPendingEditPayload } from '@/lib/pushMessages';

/**
 * Sign-Ups left the nav on 2026-09-16, but its id did not leave the world: a
 * shared `?tab=players` link, a push delivered before the deploy, a PWA
 * restoring its last session. Each meant "the sign-up list", which is Home.
 */
describe('toTab', () => {
  it('maps the retired players tab to Home', () => {
    expect(toTab('players')).toBe('home');
  });
  it('accepts the tabs that exist', () => {
    for (const t of ['home', 'stringing', 'skills', 'admin', 'profile']) expect(toTab(t)).toBe(t);
  });
  it('rejects anything else, including nothing', () => {
    expect(toTab('bogus')).toBeNull();
    expect(toTab(null)).toBeNull();
    expect(toTab(undefined)).toBeNull();
  });
});

describe('stringing notifications land on the Stringing tab', () => {
  it('a stage notice', () => {
    const p = buildStringingPayload({ jobNo: 'J-0001', key: 'ready_for_you', racketLabel: 'Astrox 88D' } as never);
    expect(p).not.toBeNull();
    expect(p?.url).toMatch(/\?tab=stringing$/);
  });
  it('a change to confirm', () => {
    expect(buildPendingEditPayload({ jobNo: 'J-0001', racketLabel: 'Astrox 88D' }).url).toMatch(/\?tab=stringing$/);
  });
});
