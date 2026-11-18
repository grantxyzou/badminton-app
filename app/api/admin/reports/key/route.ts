/**
 * The weekly-report key (docs/plans/usage-metrics.md).
 *
 * GET  — whether one exists, when it was made and last used. Never the key.
 * POST — mint (or rotate) it. The plaintext is in THIS response and nowhere
 *        else; rotating stops the old key at once, which is the point when a
 *        key has leaked.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed, isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { mintReportsKey, readReportsAccess } from '@/lib/reportsAccess';
import { isOperatorAdmin } from '@/lib/operator';
import { BPM_GROUP_ID } from '@/lib/groupScope';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!checkRateLimit(`admin-reports-key-get:${getClientIp(req)}`, 60, 60 * 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!isAdminAuthed(req)) return unauthorized();
  try {
    const doc = await readReportsAccess(resolveGroupId(req));
    return NextResponse.json({
      configured: !!doc?.keyHash,
      keyCreatedAt: doc?.keyCreatedAt ?? null,
      lastUsedAt: doc?.lastUsedAt ?? null,
    });
  } catch (err) {
    console.error('GET /api/admin/reports/key failed', err);
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  if (!checkRateLimit(`admin-reports-key:${getClientIp(req)}`, 10, 60 * 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const auth = await isAdminAuthedWithMember(req);
  if (!auth.authed) return unauthorized();
  // BPM's key also opens the deployment-wide problem reports
  // (`GET /api/reports/feedback`), written by members of EVERY club, so it is
  // the operator's to mint, a person and not a club (Claude Security F26,
  // 2026-11-17). Another club's key reads only that club's totals.
  if (auth.groupId === BPM_GROUP_ID && !isOperatorAdmin(auth)) {
    return NextResponse.json({ error: 'operator_only' }, { status: 403 });
  }
  try {
    const key = await mintReportsKey(auth.groupId);
    return NextResponse.json({ key }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('POST /api/admin/reports/key failed', err);
    return NextResponse.json({ error: 'mint_failed' }, { status: 500 });
  }
}
