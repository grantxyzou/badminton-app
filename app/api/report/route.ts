import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getContainer, ensureContainer } from '@/lib/cosmos';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { notifyReport } from '@/lib/reportEmail';

export const dynamic = 'force-dynamic';

const MAX_MESSAGE = 2000;
const RATE_MAX = 10;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// Lazy container bootstrap — real Cosmos doesn't auto-create containers, and
// `feedback` is global (not session-scoped), so its partition key is `/id`.
// Cache the promise so createIfNotExists fires at most once per instance.
let feedbackReady: Promise<void> | null = null;
function ensureFeedbackContainer(): Promise<void> {
  if (!feedbackReady) {
    feedbackReady = ensureContainer('feedback', '/id').catch((err) => {
      feedbackReady = null;
      throw err;
    });
  }
  return feedbackReady;
}

/** Trim, drop-if-empty, and cap an optional free-text field. */
function optionalStr(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

export async function POST(req: NextRequest) {
  // Rate limit FIRST — this is a public, unauthenticated endpoint, so the limit
  // is the only thing standing between a bored friend and a flood of texts.
  const ip = getClientIp(req);
  if (!checkRateLimit(`report:${ip}`, RATE_MAX, RATE_WINDOW_MS)) {
    return NextResponse.json(
      { error: 'Too many reports — please try again later.' },
      { status: 429 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const raw = body.message;
  if (typeof raw !== 'string' || !raw.trim()) {
    return NextResponse.json({ error: 'A message is required' }, { status: 400 });
  }
  const message = raw.trim();
  // Reject (rather than silently truncate) an over-long body so a pasted log
  // dump can't masquerade as a real report.
  if (message.length > MAX_MESSAGE) {
    return NextResponse.json({ error: 'Message is too long' }, { status: 400 });
  }

  const report = {
    id: `report-${randomBytes(8).toString('hex')}`,
    message,
    name: optionalStr(body.name, 80),
    tab: optionalStr(body.tab, 40),
    url: optionalStr(body.url, 300),
    createdAt: new Date().toISOString(),
    ip,
  };

  // Persist FIRST — the store is the source of truth. If this throws, the error
  // propagates (500) rather than pretending the report was captured.
  await ensureFeedbackContainer();
  await getContainer('feedback').items.create(report);

  // Notify best-effort. An email hiccup must NOT fail the request — the report
  // is already safely stored and will surface in the admin feed.
  let emailed = false;
  try {
    emailed = (await notifyReport(report)).sent;
  } catch (err) {
    console.error('[report] email notification failed (report still stored):', err);
  }

  return NextResponse.json({ ok: true, emailed }, { status: 201 });
}
