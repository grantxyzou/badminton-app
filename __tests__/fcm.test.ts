import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateKeyPairSync } from 'crypto';

/**
 * `lib/fcm.ts` is the one place that talks to Firebase. Nothing here touches
 * the network: `fetch` is stubbed, and a throwaway RSA key stands in for the
 * service account so the JWT is really signed and really decodable.
 *
 * The property that matters most is the same one the web arm pins: only a
 * DEAD token reports `gone`. A 503, a 429, a refused access token — all keep
 * the subscription.
 */
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

const SA = {
  project_id: 'bpm-test',
  client_email: 'fcm@bpm-test.iam.gserviceaccount.com',
  private_key: PEM,
  token_uri: 'https://oauth2.googleapis.com/token',
};

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
let tokenResponse: () => Response;
let sendResponse: () => Response;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function load() {
  vi.resetModules();
  return import('../lib/fcm');
}

function decodeJwt(assertion: string) {
  const [h, c] = assertion.split('.');
  return {
    header: JSON.parse(Buffer.from(h!, 'base64url').toString()),
    claims: JSON.parse(Buffer.from(c!, 'base64url').toString()),
  };
}

beforeEach(() => {
  calls = [];
  tokenResponse = () => json(200, { access_token: 'ya29.test', expires_in: 3600 });
  sendResponse = () => json(200, { name: 'projects/bpm-test/messages/1' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return url.includes('oauth2') ? tokenResponse() : sendResponse();
    }),
  );
  process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify(SA);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.FCM_SERVICE_ACCOUNT_JSON;
});

describe('configuration', () => {
  it('is unconfigured when the env is absent, malformed, or missing the key', async () => {
    const { isFcmConfigured, sendFcm } = await load();
    delete process.env.FCM_SERVICE_ACCOUNT_JSON;
    expect(isFcmConfigured()).toBe(false);
    process.env.FCM_SERVICE_ACCOUNT_JSON = '{ nope';
    expect(isFcmConfigured()).toBe(false);
    process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({ ...SA, private_key: 'not a key' });
    expect(isFcmConfigured()).toBe(false);
    // And an unconfigured send is a no-op that never fetches.
    const out = await sendFcm({ token: 't'.repeat(30), title: 'x', body: 'y' });
    expect(out).toEqual({ ok: false, gone: false, status: 0, code: 'NOT_CONFIGURED' });
    expect(calls).toHaveLength(0);
  });

  it('is configured with a real-looking service account', async () => {
    const { isFcmConfigured } = await load();
    expect(isFcmConfigured()).toBe(true);
  });
});

describe('access token', () => {
  it('signs a JWT with the right issuer, scope and audience, and caches it', async () => {
    const { getAccessToken } = await load();
    const t1 = await getAccessToken(1_700_000_000_000);
    expect(t1).toBe('ya29.test');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(SA.token_uri);

    const body = new URLSearchParams(String(calls[0]!.init.body));
    expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const { header, claims } = decodeJwt(body.get('assertion')!);
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(claims.iss).toBe(SA.client_email);
    expect(claims.scope).toBe('https://www.googleapis.com/auth/firebase.messaging');
    expect(claims.aud).toBe(SA.token_uri);
    expect(claims.exp - claims.iat).toBe(3600);

    // Second call within the hour: cached, no second exchange.
    const t2 = await getAccessToken(1_700_000_000_000 + 30 * 60 * 1000);
    expect(t2).toBe('ya29.test');
    expect(calls).toHaveLength(1);
  });

  it('refreshes once the token is within a minute of expiry', async () => {
    const { getAccessToken } = await load();
    await getAccessToken(1_700_000_000_000);
    await getAccessToken(1_700_000_000_000 + 3600 * 1000 - 30 * 1000);
    expect(calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(2);
  });
});

describe('send', () => {
  const msg = { token: 'fcm-token-' + 'x'.repeat(40), title: 'Sign-ups are open', body: 'Tap in', url: '/bpm/?tab=home', tag: 'signup' };

  it('posts a v1 message with notification, data and per-platform collapse', async () => {
    const { sendFcm } = await load();
    expect(await sendFcm(msg)).toEqual({ ok: true });

    const send = calls.find((c) => c.url.includes('messages:send'))!;
    expect(send.url).toBe('https://fcm.googleapis.com/v1/projects/bpm-test/messages:send');
    expect((send.init.headers as Record<string, string>).Authorization).toBe('Bearer ya29.test');
    const { message } = JSON.parse(String(send.init.body));
    expect(message.token).toBe(msg.token);
    expect(message.notification).toEqual({ title: msg.title, body: msg.body });
    expect(message.data).toEqual({ url: msg.url, tag: msg.tag });
    expect(message.android.collapse_key).toBe('signup');
    expect(message.android.notification.tag).toBe('signup');
    expect(message.apns.headers['apns-collapse-id']).toBe('signup');
    expect(message.apns.payload.aps['thread-id']).toBe('signup');
  });

  it('UNREGISTERED (404) is gone', async () => {
    const { sendFcm } = await load();
    sendResponse = () =>
      json(404, { error: { status: 'NOT_FOUND', message: 'Requested entity was not found.', details: [{ errorCode: 'UNREGISTERED' }] } });
    const out = await sendFcm(msg);
    expect(out).toMatchObject({ ok: false, gone: true, status: 404, code: 'UNREGISTERED' });
  });

  it('a 400 naming an invalid registration token is gone', async () => {
    const { sendFcm } = await load();
    sendResponse = () =>
      json(400, { error: { status: 'INVALID_ARGUMENT', message: 'The registration token is not a valid FCM registration token', details: [{ errorCode: 'INVALID_ARGUMENT' }] } });
    expect(await sendFcm(msg)).toMatchObject({ ok: false, gone: true });
  });

  it('a 503 / UNAVAILABLE is NOT gone — the subscription must survive an outage', async () => {
    const { sendFcm } = await load();
    sendResponse = () => json(503, { error: { status: 'UNAVAILABLE', message: 'try later' } });
    expect(await sendFcm(msg)).toMatchObject({ ok: false, gone: false, status: 503 });
  });

  it('a 429 is NOT gone', async () => {
    const { sendFcm } = await load();
    sendResponse = () => json(429, { error: { status: 'QUOTA_EXCEEDED' } });
    expect(await sendFcm(msg)).toMatchObject({ ok: false, gone: false, status: 429 });
  });

  it('a refused token exchange is NOT gone and never throws', async () => {
    const { sendFcm } = await load();
    tokenResponse = () => json(401, { error: 'invalid_grant' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await sendFcm(msg)).toMatchObject({ ok: false, gone: false, code: 'EXCEPTION' });
  });

  it('a network failure is NOT gone and never throws', async () => {
    const { sendFcm } = await load();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await sendFcm(msg)).toMatchObject({ ok: false, gone: false });
  });
});
