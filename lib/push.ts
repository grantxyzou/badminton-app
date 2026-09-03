/**
 * Push send path — TWO transports behind one function.
 *
 *  - Web Push (the PWA and browsers): VAPID, via `web-push`.
 *  - FCM HTTP v1 (the native shell, iOS and Android alike): `lib/fcm.ts`.
 *
 * A subscription doc says which it is (`platform`; absent = web). `deliver`
 * partitions by platform and runs each arm only if that arm is configured —
 * an unconfigured arm is SKIPPED and logged once, never counted as failed,
 * so a deployment with VAPID but no Firebase keeps working for the web while
 * native devices simply wait.
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
 *  - FCM_SERVICE_ACCOUNT_JSON    — server-only secret; see lib/fcm.ts.
 *
 * Rotating the VAPID pair invalidates every existing web subscription with no
 * 410 to clean them up, so treat rotation as "purge the container, everyone
 * re-opts-in". FCM tokens are bound to the Firebase project, not to a key you
 * hold, so a rotated service account keeps sending.
 */
import { createHash } from 'crypto';
import { getContainer, ensureContainer } from './cosmos';
import { isFcmConfigured, sendFcm } from './fcm';
import type { PushSubscriptionDoc } from './types';

export interface PushPayload {
  title: string;
  body: string;
  /** Where the notification opens. Must be basePath-prefixed; the SW and the
   *  native tap handler both reject anything that doesn't start with /bpm. */
  url?: string;
  /** Collapse key — a phone that was offline gets ONE banner per tag, not one
   *  per missed send. Kept short and base64url-safe (push services cap it). */
  tag?: string;
}

export interface PushResult {
  /** False means NO transport is configured and nothing was attempted.
   *  Distinct from `sent: 0`, which means we tried and nobody was subscribed. */
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

export function isWebPushConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_SUBJECT,
  );
}

/** Either transport. Callers that only need "will anything go out?" use this. */
export function isPushConfigured(): boolean {
  return isWebPushConfigured() || isFcmConfigured();
}

/** sha256 of a send credential — a web endpoint or an FCM token. */
export function hashEndpoint(credential: string): string {
  return createHash('sha256').update(credential).digest('hex');
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

type WebSub = PushSubscriptionDoc & { endpoint: string; keys: { p256dh: string; auth: string } };
type NativeSub = PushSubscriptionDoc & { platform: 'ios' | 'android'; token: string };

export function isWebSub(d: PushSubscriptionDoc): d is WebSub {
  return (
    (d.platform === undefined || d.platform === 'web') &&
    typeof d.endpoint === 'string' &&
    !!d.keys?.p256dh &&
    !!d.keys?.auth
  );
}

export function isNativeSub(d: PushSubscriptionDoc): d is NativeSub {
  return (d.platform === 'ios' || d.platform === 'android') && typeof d.token === 'string' && d.token.length > 0;
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
    (d) => d && (isWebSub(d) || isNativeSub(d)),
  );
  if (!memberIds) return all;
  const wanted = new Set(memberIds);
  return all.filter((d) => wanted.has(d.memberId));
}

/** One place for the truncated message every transport sends. */
function shape(payload: PushPayload) {
  return {
    title: truncate(payload.title, MAX_TITLE),
    body: truncate(payload.body, MAX_BODY),
    url: payload.url,
    tag: payload.tag,
  };
}

interface Tally {
  sent: number;
  failed: number;
  removed: number;
}

/** A send resolved; a `gone` deletes the doc, anything else keeps it. */
async function record(
  sub: PushSubscriptionDoc,
  outcome: { ok: true } | { ok: false; gone: boolean; detail: unknown },
  tally: Tally,
  now: string,
): Promise<void> {
  const container = getContainer('pushSubscriptions');
  if (outcome.ok) {
    tally.sent++;
    try {
      await container.items.upsert({ ...sub, lastSuccessAt: now, failureCount: 0 });
    } catch {
      /* bookkeeping only — a failed stamp must not affect the reported result */
    }
    return;
  }
  if (outcome.gone) {
    // The subscription is definitively gone (uninstalled app, cleared site
    // data, expired). Delete it — this is the only self-healing path.
    tally.removed++;
    try {
      // Partition key must be the memberId; the mock ignores it, so a wrong
      // value here would only surface in real Cosmos.
      await container.item(sub.id, sub.memberId).delete();
    } catch (err) {
      console.error('[push] failed to delete dead subscription', sub.id, err);
    }
    return;
  }
  // Transient (429, 5xx, network). Count it, but KEEP the subscription —
  // evicting on a temporary error would silently unsubscribe live users.
  tally.failed++;
  console.error('[push] send failed', { id: sub.id, platform: sub.platform ?? 'web' }, outcome.detail);
  try {
    await container.items.upsert({ ...sub, failureCount: (sub.failureCount ?? 0) + 1 });
  } catch {
    /* bookkeeping only */
  }
}

async function deliverWeb(subs: WebSub[], payload: PushPayload, tally: Tally, now: string) {
  const webpush = await loadWebPush();
  const body = JSON.stringify(shape(payload));
  const options = {
    TTL: TTL_SECONDS,
    urgency: 'normal' as const,
    ...(payload.tag ? { topic: payload.tag } : {}),
  };

  for (let i = 0; i < subs.length; i += CHUNK_SIZE) {
    const chunk = subs.slice(i, i + CHUNK_SIZE);
    const outcomes = await Promise.allSettled(
      chunk.map((sub) =>
        webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body, options),
      ),
    );
    for (let j = 0; j < outcomes.length; j++) {
      const o = outcomes[j];
      if (o.status === 'fulfilled') {
        await record(chunk[j], { ok: true }, tally, now);
        continue;
      }
      const status = (o.reason as { statusCode?: number } | undefined)?.statusCode;
      await record(
        chunk[j],
        { ok: false, gone: status === 404 || status === 410, detail: o.reason },
        tally,
        now,
      );
    }
  }
}

async function deliverNative(subs: NativeSub[], payload: PushPayload, tally: Tally, now: string) {
  const msg = shape(payload);
  for (let i = 0; i < subs.length; i += CHUNK_SIZE) {
    const chunk = subs.slice(i, i + CHUNK_SIZE);
    // sendFcm never throws, so allSettled is belt-and-braces.
    const outcomes = await Promise.allSettled(chunk.map((sub) => sendFcm({ ...msg, token: sub.token })));
    for (let j = 0; j < outcomes.length; j++) {
      const o = outcomes[j];
      if (o.status === 'fulfilled' && o.value.ok) {
        await record(chunk[j], { ok: true }, tally, now);
        continue;
      }
      const value = o.status === 'fulfilled' ? o.value : null;
      await record(
        chunk[j],
        { ok: false, gone: value?.ok === false && value.gone, detail: value ?? (o as PromiseRejectedResult).reason },
        tally,
        now,
      );
    }
  }
}

let warnedWeb = false;
let warnedNative = false;

async function deliver(subs: PushSubscriptionDoc[], payload: PushPayload): Promise<PushResult> {
  if (!isPushConfigured()) return { ...NOT_CONFIGURED };
  if (subs.length === 0) return { configured: true, sent: 0, failed: 0, removed: 0 };

  const tally: Tally = { sent: 0, failed: 0, removed: 0 };
  const now = new Date().toISOString();
  const web = subs.filter(isWebSub);
  const native = subs.filter(isNativeSub);

  if (web.length > 0) {
    if (isWebPushConfigured()) {
      await deliverWeb(web, payload, tally, now);
    } else if (!warnedWeb) {
      warnedWeb = true;
      console.warn(`[push] ${web.length} web subscription(s) skipped: VAPID not configured`);
    }
  }
  if (native.length > 0) {
    if (isFcmConfigured()) {
      await deliverNative(native, payload, tally, now);
    } else if (!warnedNative) {
      warnedNative = true;
      console.warn(`[push] ${native.length} native subscription(s) skipped: FCM_SERVICE_ACCOUNT_JSON not configured`);
    }
  }

  return { configured: true, ...tally };
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
