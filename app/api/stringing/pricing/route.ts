/**
 * GET   /api/stringing/pricing — the posted rate card. Readable by players.
 * PATCH /api/stringing/pricing — set it. Admin only.
 *
 * Open GET for the same reason as the shop sign and the string list: the whole
 * point of a rate card is that people can read it before deciding.
 *
 * Since docs/plans/bench-redesign.md (PR 2) each string's own restring price
 * is the price, and this doc carries the two figures that are not a string:
 * `ownStringCents` (a restring with the player's own string; null = "Ask")
 * and `note`. `services` is still returned and stored, for rollback only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { groupScope } from '@/lib/groupScope';
import { resolveGroupId } from '@/lib/groupContext';
import { isAdminAuthedWithMember, requireMember } from '@/lib/auth';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { ensureClubSettings } from '@/lib/stringingShop';
import {
  readPricingDoc,
  normalisePricing,
  normaliseOwnStringCents,
  normaliseNote,
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
    return NextResponse.json({ services: null, ownStringCents: null, note: null });
  }
  const gate = await requireMember(req);
  if (!gate.ok) return gate.response;
  const read = await readPricingDoc(resolveGroupId(req));
  // A failed read is unknown in every field, never "no prices".
  if (!read) return NextResponse.json({ services: null, ownStringCents: null, note: null });
  return NextResponse.json(read);
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

  // Each field is optional and a field left out keeps what is stored, so the
  // set-up screen can save the own-string price without re-sending a
  // services list it no longer edits, and an older client sending only
  // `services` cannot wipe the other two. A field that IS sent and is wrong
  // refuses the whole save.
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const services = body.services === undefined ? undefined : normalisePricing(body.services);
  const ownStringCents = body.ownStringCents === undefined ? undefined : normaliseOwnStringCents(body.ownStringCents);
  const note = body.note === undefined ? undefined : normaliseNote(body.note);
  if (
    services === null ||
    (body.ownStringCents !== undefined && ownStringCents === undefined) ||
    (body.note !== undefined && note === undefined) ||
    (services === undefined && body.ownStringCents === undefined && body.note === undefined)
  ) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  try {
    await ensureClubSettings();
    const groupId = resolveGroupId(req);
    const prior = await readPricingDoc(groupId);
    if (!prior) throw new Error('pricing unreadable');
    const doc: PricingDoc = {
      id: pricingDocId(groupId),
      services: services ?? prior.services,
      ownStringCents: ownStringCents === undefined ? prior.ownStringCents : ownStringCents,
      note: note ?? prior.note,
      updatedAt: new Date().toISOString(),
      updatedBy: admin.memberId,
    };
    await groupScope(groupId).upsert('clubSettings', doc);
    return NextResponse.json({ services: doc.services, ownStringCents: doc.ownStringCents, note: doc.note });
  } catch (err) {
    console.error('PATCH /api/stringing/pricing failed:', err);
    return NextResponse.json({ error: 'write_failed' }, { status: 503 });
  }
}
