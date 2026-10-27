/**
 * The token-endpoint round trip both providers share: one form POST, one JSON
 * answer. Replaces `arctic`'s `sendTokenRequest` (deprecated upstream July
 * 2026, docs/plans/oauth-library-replacement.md) and keeps its contract,
 * because the callbacks were written against it:
 *
 *   200 + a JSON object  → `OAuthTokens`
 *   400/401 + `{ error }` → throws `OAuthRequestError` carrying the code
 *   anything else        → throws
 *
 * Both callbacks catch every throw as `exchange_failed`, so what matters is
 * THAT a failed exchange throws, never which class. The request is byte-for-
 * byte what arctic sent (`__tests__/fixtures/oauth-arctic-requests.json`),
 * User-Agent included: providers have seen that string on every sign-in so far.
 */

export class OAuthRequestError extends Error {
  constructor(
    readonly code: string,
    readonly description: string | null,
  ) {
    super(`OAuth request error: ${code}`);
  }
}

export class OAuthTokens {
  constructor(private readonly data: Record<string, unknown>) {}

  /** Throws when the provider sent no `id_token` — the callbacks rely on that landing in their catch. */
  idToken(): string {
    const v = this.data.id_token;
    if (typeof v !== 'string') throw new Error("Missing or invalid 'id_token' field");
    return v;
  }

  hasRefreshToken(): boolean {
    return typeof this.data.refresh_token === 'string';
  }

  refreshToken(): string {
    const v = this.data.refresh_token;
    if (typeof v !== 'string') throw new Error("Missing or invalid 'refresh_token' field");
    return v;
  }
}

export async function sendTokenRequest(endpoint: string, body: URLSearchParams, authorization?: string): Promise<OAuthTokens> {
  const bytes = new TextEncoder().encode(body.toString());
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
    'User-Agent': 'arctic',
    'Content-Length': String(bytes.byteLength),
  };
  if (authorization) headers.Authorization = authorization;
  const res = await fetch(new Request(endpoint, { method: 'POST', headers, body: bytes }));

  if (res.status === 400 || res.status === 401) {
    const data: unknown = await res.json().catch(() => null);
    const code = data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string' ? (data as { error: string }).error : null;
    if (!code) throw new Error(`Unexpected error response: ${res.status}`);
    const description = (data as { error_description?: unknown }).error_description;
    throw new OAuthRequestError(code, typeof description === 'string' ? description : null);
  }
  if (res.status === 200) {
    const data: unknown = await res.json().catch(() => null);
    if (!data || typeof data !== 'object') throw new Error('Unexpected token response body');
    return new OAuthTokens(data as Record<string, unknown>);
  }
  await res.body?.cancel();
  throw new Error(`Unexpected token response: ${res.status}`);
}
