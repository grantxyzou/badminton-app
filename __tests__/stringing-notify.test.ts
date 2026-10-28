import { describe, it, expect } from 'vitest';
import { buildPlayerNotice, shouldNotify, channelsFor } from '../lib/stringingNotify';
import { STRINGING_FLOW, PLAYER_TRACK } from '../lib/stringing';
import type { StringingJob } from '../lib/types';

/**
 * Notifications are the door the price rule is most likely to escape through.
 *
 * `toPlayerJob` is tested hard because it is obviously an API boundary. An
 * email body is the same job description leaving by a different door — and it
 * is the one where copy gets hand-written at a call site, where no API test
 * looks, and where "Grant quoted you $30.00" would sail through a fully green
 * suite. These tests exist to make that impossible rather than unlikely.
 */
function job(over: Partial<StringingJob> = {}): StringingJob {
  const now = '2026-08-27T00:00:00.000Z';
  return {
    id: 'job-abc',
    memberId: 'member-wei',
    jobNo: 'J-0042',
    memberName: 'Wei',
    stringerId: 'member-grant',
    stringerName: 'Grant',
    status: 'ready',
    racketLabel: 'Astrox 99 Pro',
    stringLabel: 'BG80 · white',
    tensionMains: 26,
    tensionCrosses: 28,
    method: 'Zach · 2 strings, 4 knots',
    priceCents: 3000,
    readyBy: '2026-08-30',
    acceptedAt: null,
    paidAt: null,
    sessionId: null,
    createdAt: now,
    updatedAt: now,
    history: [],
    ...over,
  };
}

describe('a notice quotes the exact price, as the card does', () => {
  it('formats the quote the way the card does: whole dollars when whole', () => {
    expect(buildPlayerNotice(job({ priceCents: 3000 })).quote).toBe('$30');
    expect(buildPlayerNotice(job({ priceCents: 3450 })).quote).toBe('$34.50');
  });

  it('never carries the raw cents, for any price, on any stage', () => {
    for (const status of STRINGING_FLOW) {
      for (const priceCents of [999, 2800, 2999, 3000, 3001, 4200, 12345]) {
        const notice = buildPlayerNotice(job({ status, priceCents }));
        expect(notice).not.toHaveProperty('priceCents');
        expect(notice.quote).toBe(Number.isInteger(priceCents / 100) ? `$${priceCents / 100}` : `$${(priceCents / 100).toFixed(2)}`);
      }
    }
  });

  it('carries no stringer, no bench status, and no member name', () => {
    const raw = JSON.stringify(buildPlayerNotice(job()));
    expect(raw).not.toContain('Grant');
    expect(raw).not.toContain('member-grant');
    expect(raw).not.toContain('"ready"');
    // The player's word for that stage, not the bench's.
    expect(raw).toContain('ready_for_you');
  });

  it('says "not priced yet" rather than "free"', () => {
    expect(buildPlayerNotice(job({ priceCents: null })).quote).toBeNull();
    expect(buildPlayerNotice(job({ priceCents: 0 })).quote).toBe('$0');
  });
});

describe('what is worth interrupting someone for', () => {
  it('does not notify that a racket they just handed over is with the stringer', () => {
    // They were standing there. A notification carrying nothing is the fastest
    // way to teach someone to ignore this app's notifications.
    expect(shouldNotify('with_stringer')).toBe(false);
    expect(channelsFor('with_stringer')).toEqual(['in_app']);
  });

  it('does not notify that a racket in their hand has been picked up', () => {
    expect(shouldNotify('done')).toBe(false);
  });

  it('notifies on the two stages that are actual news', () => {
    expect(channelsFor('being_strung')).toEqual(['in_app', 'email', 'push']);
    expect(channelsFor('ready_for_you')).toEqual(['in_app', 'email', 'push']);
  });

  it('always includes in-app, on every stage', () => {
    // Displaying costs the player nothing and interrupts nobody. Interrupting
    // is the thing that needs justifying, not showing.
    for (const stage of PLAYER_TRACK) {
      expect(channelsFor(stage)).toContain('in_app');
    }
  });
});

describe('copy is keyed, never literal', () => {
  it('hands adapters an i18n key rather than English prose', () => {
    // An adapter shipping a literal string would be untranslatable in zh-CN,
    // and the failure would be invisible until a zh-CN member got an email.
    const notice = buildPlayerNotice(job());
    expect(PLAYER_TRACK).toContain(notice.key);
  });
});
