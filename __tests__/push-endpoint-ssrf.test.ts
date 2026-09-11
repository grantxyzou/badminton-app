// @vitest-environment node
/**
 * The push endpoint is a client-supplied URL the SERVER later POSTs to.
 *
 * It was checked only for an `https:` scheme, under a comment asserting that
 * this "keeps the send path from being pointed at an arbitrary internal host".
 * `https://10.0.0.5/probe` satisfies that check exactly, so the sender was a
 * blind SSRF from inside the App Service's network position — with a readable
 * side channel, because `lib/push.ts` deletes a subscription on 404/410 and
 * keeps it otherwise, and re-subscribing the same endpoint answers
 * `refreshed: true` if the doc survived. One bit per send, repeatable.
 *
 * Two halves are pinned here: the predicate itself, and the fact that BOTH the
 * front door (subscribe) and the send path (`isWebSub`) consult it. The sender
 * used to defer to the route's validation, which is a claim about a stored
 * row's history that the row does not carry.
 */
import { describe, it, expect } from 'vitest';
import { isSafePushEndpoint, MAX_PUSH_ENDPOINT_LEN } from '@/lib/pushEndpoint';
import { isWebSub } from '@/lib/push';
import type { PushSubscriptionDoc } from '@/lib/types';

/** A realistic browser endpoint — the shape that must keep working. */
const REAL = 'https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91bHqRs7';

describe('isSafePushEndpoint', () => {
  it('accepts the real push-service shapes', () => {
    expect(isSafePushEndpoint(REAL)).toBe(true);
    expect(isSafePushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/gAAAA')).toBe(true);
    expect(isSafePushEndpoint('https://web.push.apple.com/QAbcdef123')).toBe(true);
    expect(isSafePushEndpoint('https://sin.notify.windows.com/w/?token=Ab2')).toBe(true);
  });

  it('refuses an IP-literal host — the whole point of the finding', () => {
    // No push service is addressed by a bare address, so refusing the form
    // removes the internal-probe family without enumerating private ranges.
    expect(isSafePushEndpoint('https://10.0.0.5/probe')).toBe(false);
    expect(isSafePushEndpoint('https://192.168.1.1/')).toBe(false);
    expect(isSafePushEndpoint('https://172.16.0.1/')).toBe(false);
    expect(isSafePushEndpoint('https://127.0.0.1/')).toBe(false);
    // The cloud metadata endpoint, which is the classic SSRF target.
    expect(isSafePushEndpoint('https://169.254.169.254/metadata/instance')).toBe(false);
    // A PUBLIC literal is refused too — equally illegitimate, equally a probe.
    expect(isSafePushEndpoint('https://8.8.8.8/')).toBe(false);
  });

  it('refuses IPv6 literals and integer-encoded addresses', () => {
    expect(isSafePushEndpoint('https://[::1]/')).toBe(false);
    expect(isSafePushEndpoint('https://[fe80::1]/')).toBe(false);
    expect(isSafePushEndpoint('https://[fd00::1]/')).toBe(false);
    // 2130706433 === 127.0.0.1 written as a single integer.
    expect(isSafePushEndpoint('https://2130706433/')).toBe(false);
  });

  it('refuses loopback and internal-looking names', () => {
    expect(isSafePushEndpoint('https://localhost/probe')).toBe(false);
    expect(isSafePushEndpoint('https://LOCALHOST/probe')).toBe(false);
    expect(isSafePushEndpoint('https://db.internal/')).toBe(false);
    expect(isSafePushEndpoint('https://printer.local/')).toBe(false);
    expect(isSafePushEndpoint('https://thing.home.arpa/')).toBe(false);
  });

  it('refuses credentials in the URL', () => {
    expect(isSafePushEndpoint('https://user:pass@fcm.googleapis.com/fcm/send/x')).toBe(false);
  });

  it('still refuses non-https, junk and over-long values', () => {
    expect(isSafePushEndpoint('http://fcm.googleapis.com/fcm/send/x')).toBe(false);
    expect(isSafePushEndpoint('file:///etc/passwd')).toBe(false);
    expect(isSafePushEndpoint('not a url')).toBe(false);
    expect(isSafePushEndpoint('')).toBe(false);
    expect(isSafePushEndpoint(undefined)).toBe(false);
    expect(isSafePushEndpoint(null)).toBe(false);
    expect(isSafePushEndpoint(`https://fcm.googleapis.com/${'a'.repeat(MAX_PUSH_ENDPOINT_LEN)}`)).toBe(false);
  });
});

describe('the SENDER re-checks, it does not trust the stored row', () => {
  function doc(endpoint: string): PushSubscriptionDoc {
    return {
      id: 'd1',
      memberId: 'm1',
      memberName: 'Lin',
      endpoint,
      keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) },
      endpointHash: 'h',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
    } as PushSubscriptionDoc;
  }

  it('counts a real endpoint as a web sub', () => {
    expect(isWebSub(doc(REAL))).toBe(true);
  });

  it('does NOT count a row pointing at an internal host', () => {
    // A doc written before the check tightened, by another route, or by hand is
    // indistinguishable at send time — so the safety has to be a property of
    // what is about to be POSTed, not of how the row arrived.
    expect(isWebSub(doc('https://169.254.169.254/metadata/instance'))).toBe(false);
    expect(isWebSub(doc('https://10.0.0.5/probe'))).toBe(false);
  });
});
