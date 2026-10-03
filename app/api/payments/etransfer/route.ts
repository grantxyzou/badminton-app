/**
 * POST /api/payments/etransfer — the admin's Apps Script forwards one Interac
 * notification (docs/plans/payments.md; the script is `public/payments/apps-script.gs`).
 *
 * No cookie can reach this: the caller is Google's servers running the
 * admin's script. The credential is `x-payments-key`, a per-club secret minted
 * in the admin's setup card and stored hashed (`lib/paymentsInbox.ts`). It
 * names its own club, so the route never falls back to BPM.
 *
 * Not exempted from the proxy's cross-site guard and does not need to be:
 * `UrlFetchApp` sends neither `Origin` nor `sec-fetch-site`, which the guard
 * treats as not-a-browser. An exemption would only weaken the second wall.
 *
 * The response says only whether it was taken and its status — never who it
 * matched or what they owe. The script logs it; a script is not an admin.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isFlagOn } from '@/lib/flags';
import { groupForPaymentsKey, ingestEmail } from '@/lib/paymentsInbox';

export const dynamic = 'force-dynamic';

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null);

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_PAYMENTS_AUTO')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  // Rate limit before auth (rule 4). Generous: a first run backfills a day of
  // mail, and Apps Script calls come from a shared pool of Google addresses.
  const ip = getClientIp(req);
  if (!checkRateLimit(`payments-inbound:${ip}`, 120, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const groupId = await groupForPaymentsKey(req.headers.get('x-payments-key'));
  if (!groupId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const messageId = str(body.messageId, 300);
  const from = str(body.from, 300);
  const subject = str(body.subject, 1000);
  const text = str(body.body, 50_000);
  const date = str(body.date, 100);
  const authResults = body.authResults === undefined ? undefined : str(body.authResults, 5000);
  if (!messageId || from === null || subject === null || text === null || !date || authResults === null) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  try {
    const result = await ingestEmail(groupId, { messageId, from, subject, body: text, date, authResults: authResults ?? undefined });
    return NextResponse.json({ ok: true, status: result.status, duplicate: result.duplicate });
  } catch (err) {
    console.error('POST /api/payments/etransfer failed', err);
    // A 5xx makes the script leave the email unlabelled, so the next run retries it.
    return NextResponse.json({ error: 'ingest_failed' }, { status: 503 });
  }
}
