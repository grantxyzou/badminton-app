/**
 * Firebase Cloud Messaging, HTTP v1 — the ONE native push transport.
 *
 * Both native platforms hand the app an FCM registration token
 * (`@capacitor-firebase/messaging`; on iOS Firebase relays to APNs with the
 * `.p8` key uploaded to the Firebase project), so the server needs exactly one
 * sender for the shell. Direct APNs would be a second transport with a second
 * key format and a second "gone" semantics to get right.
 *
 * Zero dependencies: the v1 API is a bearer-token REST call, and the bearer
 * is a service-account JWT exchanged at Google's token endpoint. Node's
 * `crypto.createSign` does RS256; nothing else is needed.
 *
 * Same posture as `lib/push.ts`'s web arm:
 *  - env-gated no-op FIRST (`isFcmConfigured()`), so local dev, CI and every
 *    test run never touch the network;
 *  - NEVER throws from `sendFcm` — delivery is a side effect.
 *
 * Env: `FCM_SERVICE_ACCOUNT_JSON` — the service-account JSON from Firebase
 * console → Project settings → Service accounts, as ONE line. Server-only,
 * runtime (Azure App Settings), never in a workflow file. It contains a
 * `private_key`, which `scripts/block-secret-commit.mjs` already refuses.
 */
import { createSign } from 'crypto';

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
/** Access tokens live an hour; refresh a minute early so a send never
 *  races expiry. */
const TOKEN_LEEWAY_MS = 60 * 1000;
/** How long FCM should hold an undelivered message — same as the web arm. */
const TTL_SECONDS = 60 * 60 * 6;

export function loadServiceAccount(): ServiceAccount | null {
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    if (
      typeof parsed.project_id === 'string' &&
      typeof parsed.client_email === 'string' &&
      typeof parsed.private_key === 'string' &&
      parsed.private_key.includes('PRIVATE KEY')
    ) {
      return parsed as ServiceAccount;
    }
    return null;
  } catch {
    return null;
  }
}

export function isFcmConfigured(): boolean {
  return loadServiceAccount() !== null;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

let cached: { token: string; expiresAt: number } | null = null;

/** Tests only — the cache is module state. */
export function resetFcmTokenCache(): void {
  cached = null;
}

/**
 * A bearer token for the messaging scope, minted from the service account and
 * cached until shortly before it expires. Throws on a misconfigured account
 * or a refused exchange; `sendFcm` catches.
 */
export async function getAccessToken(now: number = Date.now()): Promise<string> {
  if (cached && cached.expiresAt - TOKEN_LEEWAY_MS > now) return cached.token;

  const sa = loadServiceAccount();
  if (!sa) throw new Error('fcm_not_configured');

  const iat = Math.floor(now / 1000);
  const tokenUri = sa.token_uri ?? DEFAULT_TOKEN_URI;
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: tokenUri, iat, exp: iat + 3600 }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(sa.private_key).toString('base64url');
  const assertion = `${header}.${claims}.${signature}`;

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });
  if (!res.ok) throw new Error(`fcm_token_exchange_${res.status}`);
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error('fcm_token_exchange_empty');
  cached = {
    token: data.access_token,
    expiresAt: now + (data.expires_in ?? 3600) * 1000,
  };
  return cached.token;
}

export interface FcmMessage {
  token: string;
  /** Already truncated by lib/push.ts — truncation lives in one place. */
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export type FcmOutcome =
  | { ok: true }
  /** `gone` is the ONLY signal that deletes a subscription. */
  | { ok: false; gone: boolean; status: number; code?: string };

/**
 * FCM's "this token is dead" answers, mirrored from the web arm's 404/410.
 * Everything else — 429, 5xx, UNAVAILABLE, INTERNAL, a bad access token —
 * keeps the subscription. Getting this backwards would silently unsubscribe
 * live devices on a transient outage.
 */
function isGone(status: number, code: string | undefined, message: string | undefined): boolean {
  if (status === 404) return true; // UNREGISTERED
  if (code === 'UNREGISTERED') return true;
  // A token that FCM will never accept again is reported as a 400 naming it.
  if (status === 400 && code === 'INVALID_ARGUMENT' && /registration token/i.test(message ?? '')) {
    return true;
  }
  return false;
}

export async function sendFcm(msg: FcmMessage): Promise<FcmOutcome> {
  const sa = loadServiceAccount();
  if (!sa) return { ok: false, gone: false, status: 0, code: 'NOT_CONFIGURED' };

  try {
    const bearer = await getAccessToken();
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: msg.token,
            notification: { title: msg.title, body: msg.body },
            // The tap handler reads these — same keys the web SW receives.
            data: { ...(msg.url ? { url: msg.url } : {}), ...(msg.tag ? { tag: msg.tag } : {}) },
            android: {
              ttl: `${TTL_SECONDS}s`,
              ...(msg.tag ? { collapse_key: msg.tag } : {}),
              notification: { channel_id: 'bpm', ...(msg.tag ? { tag: msg.tag } : {}) },
            },
            apns: {
              headers: {
                'apns-expiration': String(Math.floor(Date.now() / 1000) + TTL_SECONDS),
                ...(msg.tag ? { 'apns-collapse-id': msg.tag } : {}),
              },
              payload: { aps: { sound: 'default', ...(msg.tag ? { 'thread-id': msg.tag } : {}) } },
            },
          },
        }),
      },
    );
    if (res.ok) return { ok: true };

    let code: string | undefined;
    let message: string | undefined;
    try {
      const err = (await res.json()) as {
        error?: { status?: string; message?: string; details?: Array<{ errorCode?: string }> };
      };
      code = err.error?.details?.find((d) => d.errorCode)?.errorCode ?? err.error?.status;
      message = err.error?.message;
    } catch {
      /* non-JSON error body — status alone decides */
    }
    return { ok: false, gone: isGone(res.status, code, message), status: res.status, code };
  } catch (err) {
    // Network, token exchange, anything thrown: transient by definition.
    console.error('[fcm] send failed:', err);
    return { ok: false, gone: false, status: 0, code: 'EXCEPTION' };
  }
}
