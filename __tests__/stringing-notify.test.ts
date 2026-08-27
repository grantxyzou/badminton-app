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

describe('a notice can never carry the exact price', () => {
  it('bands the price, exactly as the API does', () => {
    expect(buildPlayerNotice(job({ priceCents: 3000 })).priceRange).toBe('$28–32');
  });

  it('leaks nothing exact for ANY price, on any stage', () => {
    // Brute force rather than a spot check: the failure mode is one branch
    // somewhere forgetting to band, and a single example would miss it.
    for (const status of STRINGING_FLOW) {
      for (const priceCents of [999, 2800, 2999, 3000, 3001, 4200, 12345]) {
        const notice = buildPlayerNotice(job({ status, priceCents }));
        // Against the notice's OWN values, not the whole serialised blob:
        // scanning the blob made `priceCents: 0` fail on the "0" inside
        // "J-0042", which is a false alarm about the job number rather than a
        // leak. A $0 job has nothing to hide anyway.
        const values = Object.values(notice).map(String).join('|');
        expect(values).not.toContain((priceCents / 100).toFixed(2));
        expect(values).not.toContain(String(priceCents));
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
    expect(buildPlayerNotice(job({ priceCents: null })).priceRange).toBeNull();
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
