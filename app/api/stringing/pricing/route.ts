/**
 * GET   /api/stringing/pricing — the posted rate card. Readable by players.
 * PATCH /api/stringing/pricing — set it. Admin only.
 *
 * Open GET for the same reason as the shop sign and the string list: the whole
 * point of a rate card is that people can read it before deciding. Returns the
 * list and nothing else.
 */
import { NextRequest, NextResponse } from 'next/server';
import { groupScope } from '@/lib/groupScope';
import { resolveGroupId } from '@/lib/groupContext';
import { isAdminAuthedWithMember } from '@/lib/auth';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { ensureClubSettings } from '@/lib/stringingShop';
import {
  readPricing,
  normalisePricing,
  pricingDocId,
  type PricingDoc,
} from '@/lib/stringingPricing';

export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const ip = getClientIp(req);
  if (!checkRateLimit(`stringing-pricing-read:${ip}`, 120, HOUR_MS)) {
    // Unknown, not empty. "No prices posted" is a claim; a throttled read is
    // not entitled to make it.
    return NextResponse.json({ services: null });
  }
  return NextResponse.json({ services: await readPricing(resolveGroupId(req)) });
}

export async function PATCH(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const ip = getClientIp(req);
  if (!checkRateLimit(`stringing-pricing-write:${ip}`, 60, HOUR_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const admin = await isAdminAuthedWithMember(req);
  if (!admin.authed) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const services = normalisePricing(body?.services);
  if (services === null) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  try {
    await ensureClubSettings();
    const groupId = resolveGroupId(req);
    const doc: PricingDoc = {
      id: pricingDocId(groupId),
      services,
      updatedAt: new Date().toISOString(),
      updatedBy: admin.memberId,
    };
    await groupScope(groupId).upsert('clubSettings', doc);
    return NextResponse.json({ services: doc.services });
  } catch (err) {
    console.error('PATCH /api/stringing/pricing failed:', err);
    return NextResponse.json({ error: 'write_failed' }, { status: 503 });
  }
}
