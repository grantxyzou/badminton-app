/**
 * Turns an Anthropic SDK failure into something an admin can act on.
 *
 * `POST /api/claude` used to answer every failure with a flat
 * `{ error: 'AI request failed' }` and a 500. When the pinned model was
 * retired, the server knew exactly what was wrong — the SDK said
 * a `not_found_error` naming the exact dead model — and told the admin nothing.
 * The polish buttons were dead in production for weeks because the one person
 * who could fix it could not see the reason. (The retired ID itself lives in
 * the denylist in `__tests__/ai-model-canary.test.ts`, which is why it is not
 * repeated here — that canary flags the literal anywhere under app/lib/
 * components, comments included.)
 *
 * This route is admin-gated (`isAdminAuthed`), so the audience is trusted and
 * upstream detail is safe to surface. Two guards keep that honest: the upstream
 * text is length-capped so a hostile or enormous body can't be reflected
 * wholesale, and the category prefix always states whose problem it is —
 * configuration (the admin must act) versus transient (retry).
 *
 * Deliberately NOT a lookup keyed on `status` alone: an Anthropic 401 means our
 * API key is wrong, which is a server misconfiguration, and mapping it straight
 * through would tell the admin they are unauthenticated when they are not.
 */

/** Upstream messages are echoed to the admin, so cap what can be reflected. */
const MAX_UPSTREAM_CHARS = 200;

export interface AiFailure {
  /** Shown directly to the admin — both callers render `data.error` verbatim. */
  message: string;
  /** HTTP status for the route to return. */
  status: number;
  /** Machine-readable category, for callers that want to branch. */
  kind: 'config' | 'transient' | 'unknown';
}

function upstreamDetail(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  // The SDK nests the API body under `error`; fall back to the Error message.
  const body = (err as { error?: { error?: { message?: unknown } } }).error?.error?.message;
  const raw = typeof body === 'string' ? body : (err as { message?: unknown }).message;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const trimmed = raw.trim();
  return trimmed.length > MAX_UPSTREAM_CHARS
    ? `${trimmed.slice(0, MAX_UPSTREAM_CHARS)}…`
    : trimmed;
}

export function describeAiFailure(err: unknown): AiFailure {
  const status = typeof (err as { status?: unknown })?.status === 'number'
    ? (err as { status: number }).status
    : null;
  const detail = upstreamDetail(err);
  const withDetail = (lead: string) => (detail ? `${lead} (${detail})` : lead);

  // No key configured — the SDK throws before any request is made.
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      kind: 'config',
      status: 500,
      message: 'AI is not configured on this server — ANTHROPIC_API_KEY is missing.',
    };
  }

  switch (status) {
    case 400:
      return { kind: 'config', status: 500, message: withDetail('The AI request was rejected as invalid.') };
    case 401:
    case 403:
      // Ours, not the caller's — they already passed the admin check.
      return { kind: 'config', status: 500, message: withDetail("The server's Anthropic API key was rejected.") };
    case 404:
      // The exact case that hid the retired-model outage.
      return { kind: 'config', status: 500, message: withDetail('The configured AI model is unavailable — it may have been retired.') };
    case 413:
      return { kind: 'config', status: 400, message: withDetail('That request was too large for the AI to process.') };
    case 429:
      return { kind: 'transient', status: 429, message: 'The AI is rate-limited right now — wait a moment and try again.' };
    case 500:
    case 502:
    case 503:
    case 529:
      return { kind: 'transient', status: 503, message: 'The AI service is temporarily unavailable — try again shortly.' };
    default:
      break;
  }

  // No HTTP status at all — DNS, TLS, socket, abort.
  if (status === null) {
    return { kind: 'transient', status: 503, message: withDetail("Couldn't reach the AI service.") };
  }
  return { kind: 'unknown', status: 500, message: withDetail(`The AI request failed (HTTP ${status}).`) };
}
