/**
 * Web Push send path.
 *
 * Mirrors the posture of `lib/reportEmail.ts`:
 *  - env-gated no-op FIRST, so an unconfigured environment (local dev, CI, any
 *    test run) never touches the network and never needs the dependency;
 *  - the heavy dependency is imported lazily, so it isn't loaded where it
 *    won't be used;
 *  - it NEVER throws. Delivery is a side effect — a failed send must not fail
 *    the user action that triggered it (the `app/api/report/route.ts` rule:
 *    persist first, notify best-effort).
 *
 * Env vars:
 *  - NEXT_PUBLIC_VAPID_PUBLIC_KEY — also read by the client; baked at build time.
 *  - VAPID_PRIVATE_KEY           — server-only secret.
 *  - VAPID_SUBJECT               — mailto:/https: contact required by the protocol.
 *
 * Rotating the key pair invalidates every existing subscription with no 410 to
 * clean them up, so treat rotation as "purge the container, everyone re-opts-in".
 */
import { createHash } from 'crypto';
import { getContainer, ensureContainer } from './cosmos';
import type { PushSubscriptionDoc } from './types';

export interface PushPayload {
  title: string;
  body: string;
  /** Where the notification opens. Must be basePath-prefixed; the SW rejects
   *  anything that doesn't start with /bpm. */
  url?: string;
  /** Collapse key — a phone that was offline gets ONE banner per tag, not one
   *  per missed send. Kept short and base64url-safe (push services cap it). */
  tag?: string;
}

export interface PushResult {
  /** False means the env is unconfigured and nothing was attempted. Distinct
   *  from `sent: 0`, which means we tried and nobody was subscribed. */
  configured: boolean;
  sent: number;
  failed: number;
  removed: number;
}

const NOT_CONFIGURED: PushResult = { configured: false, sent: 0, failed: 0, removed: 0 };

/** Notification titles/bodies are truncated here rather than at call sites, so
 *  no caller can blow the ~4KB post-encryption payload cap. */
const MAX_TITLE = 60;
const MAX_BODY = 160;
/** Push services cap the Topic header; keep it short and base64url-safe. */
const MAX_TAG = 32;
/** How long a push service should hold an undelivered message. A sign-up
 *  notification is worthless a day later. */
const TTL_SECONDS = 60 * 60 * 6;
/** Concurrency per round. At friend-group scale this is one round; the chunking
 *  exists so a larger roster doesn't open every socket at once. */
const CHUNK_SIZE = 20;

export function isPushConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_SUBJECT,
  );
}

export function hashEndpoint(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex');
}

function truncate(value: string, max: number): string {
  const s = String(value ?? '').trim();
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/** Base64url-safe, length-capped collapse key. */
export function safeTag(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, MAX_TAG);
  return cleaned || undefined;
}

let ready: Promise<void> | null = null;
export function ensurePushContainer(): Promise<void> {
  if (!ready) {
    ready = ensureContainer('pushSubscriptions', '/memberId').catch((err) => {
      // Reset so the next request retries rather than caching the failure.
      ready = null;
      throw err;
    });
  }
  return ready;
}

let vapidReady = false;
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
async function loadWebPush(): Promise<any> {
  const webpush = (await import('web-push')).default;
  if (!vapidReady) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT as string,
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY as string,
      process.env.VAPID_PRIVATE_KEY as string,
    );
    vapidReady = true;
  }
  return webpush;
}

/** All subscription docs, optionally narrowed to a set of members. */
async function loadSubscriptions(memberIds?: string[]): Promise<PushSubscriptionDoc[]> {
  await ensurePushContainer();
  // NOTE: the mock store only understands @sessionId/@name/@id params, so a
  // @memberId WHERE is ignored there and the whole container comes back. We
  // JS-filter for mock/real parity — same convention as app/api/kudos/route.ts.
  const { resources } = await getContainer('pushSubscriptions')
    .items.query({ query: 'SELECT * FROM c' })
    .fetchAll();

  const all = (resources as PushSubscriptionDoc[]).filter(
    (d) => d && typeof d.endpoint === 'string' && d.keys?.p256dh && d.keys?.auth,
  );
  if (!memberIds) return all;
  const wanted = new Set(memberIds);
  return all.filter((d) => wanted.has(d.memberId));
}

async function deliver(subs: PushSubscriptionDoc[], payload: PushPayload): Promise<PushResult> {
  if (!isPushConfigured()) return { ...NOT_CONFIGURED };
  if (subs.length === 0) return { configured: true, sent: 0, failed: 0, removed: 0 };

  const webpush = await loadWebPush();
  const container = getContainer('pushSubscriptions');

  const body = JSON.stringify({
    title: truncate(payload.title, MAX_TITLE),
    body: truncate(payload.body, MAX_BODY),
    url: payload.url,
    tag: payload.tag,
  });
  const options = {
    TTL: TTL_SECONDS,
    urgency: 'normal' as const,
    ...(payload.tag ? { topic: payload.tag } : {}),
  };

  let sent = 0;
  let failed = 0;
  let removed = 0;
  const now = new Date().toISOString();

  for (let i = 0; i < subs.length; i += CHUNK_SIZE) {
    const chunk = subs.slice(i, i + CHUNK_SIZE);
    const outcomes = await Promise.allSettled(
      chunk.map((sub) =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          body,
          options,
        ),
      ),
    );

    for (let j = 0; j < outcomes.length; j++) {
      const outcome = outcomes[j];
      const sub = chunk[j];

      if (outcome.status === 'fulfilled') {
        sent++;
        try {
          await container.items.upsert({ ...sub, lastSuccessAt: now, failureCount: 0 });
        } catch {
          /* bookkeeping only — a failed stamp must not affect the reported result */
        }
        continue;
      }

      const status = (outcome.reason as { statusCode?: number } | undefined)?.statusCode;
      if (status === 404 || status === 410) {
        // The subscription is definitively gone (uninstalled PWA, cleared site
        // data, expired). Delete it — this is the only self-healing path.
        removed++;
        try {
          // Partition key must be the memberId; the mock ignores it, so a wrong
          // value here would only surface in real Cosmos.
          await container.item(sub.id, sub.memberId).delete();
        } catch (err) {
          console.error('[push] failed to delete dead subscription', sub.id, err);
        }
        continue;
      }

      // Transient (429, 5xx, network). Count it, but KEEP the subscription —
      // evicting on a temporary error would silently unsubscribe live users.
      failed++;
      console.error(
        '[push] send failed',
        { id: sub.id, status: status ?? 'unknown' },
        outcome.reason,
      );
      try {
        await container.items.upsert({
          ...sub,
          failureCount: (sub.failureCount ?? 0) + 1,
        });
      } catch {
        /* bookkeeping only */
      }
    }
  }

  return { configured: true, sent, failed, removed };
}

/** Send to specific members (payment reminders, admin self-test). */
export async function sendPushToMembers(
  memberIds: string[],
  payload: PushPayload,
): Promise<PushResult> {
  if (!isPushConfigured()) return { ...NOT_CONFIGURED };
  if (memberIds.length === 0) return { configured: true, sent: 0, failed: 0, removed: 0 };
  try {
    return await deliver(await loadSubscriptions(memberIds), payload);
  } catch (err) {
    console.error('[push] sendPushToMembers failed:', err);
    return { configured: true, sent: 0, failed: 0, removed: 0 };
  }
}

/** Broadcast to everyone subscribed (sign-ups open). */
export async function sendPushToAll(payload: PushPayload): Promise<PushResult> {
  if (!isPushConfigured()) return { ...NOT_CONFIGURED };
  try {
    return await deliver(await loadSubscriptions(), payload);
  } catch (err) {
    console.error('[push] sendPushToAll failed:', err);
    return { configured: true, sent: 0, failed: 0, removed: 0 };
  }
}
