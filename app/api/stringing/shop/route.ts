/**
 * GET   /api/stringing/shop — is the stringing service taking rackets?
 * PATCH /api/stringing/shop — open or close it. Admin only.
 *
 * A SHOP SIGN, NOT A FEATURE FLAG. `NEXT_PUBLIC_FLAG_STRINGING` answers "does
 * this code exist in this build" and is baked in at build time. This answers
 * "am I taking rackets this week", changes from a phone in two taps, and is a
 * fact about the club rather than about the deployment.
 *
 * WHY NOT /api/admin/settings, WHICH IS WHERE ADMIN SETTINGS LIVE
 * --------------------------------------------------------------
 * That endpoint reads and writes the CALLING ADMIN'S OWN member document. Two
 * things break here. It is per-admin, so a second stringer would see a
 * different sign than the one Grant hung. And a player cannot read another
 * member's document at all — but the player is the entire audience for a shop
 * sign, so the value has to live somewhere they can see.
 *
 * WHY ITS OWN CONTAINER AND NOT A SINGLETON IN `stringingJobs`
 * -----------------------------------------------------------
 * The bench lists jobs with `SELECT * FROM c`. A settings document sitting in
 * that container would come back as a job with no name, no racket and no
 * status — the same trap the birds container already carries with its
 * adjustment documents, which every sum over that container has to remember to
 * filter out. Better to not create the trap.
 *
 * CLOSED DOES NOT STOP THE BENCH. An admin can still log a walk-up, and every
 * job already in flight still needs finishing. Closed means "not taking new
 * requests from players" — it is a sign in the window, not a lock on the door.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { ensureClubSettings, readShopOpen, SHOP_DOC_ID, type ShopDoc } from '@/lib/stringingShop';
import { isAdminAuthedWithMember } from '@/lib/auth';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const ip = getClientIp(req);
  if (!checkRateLimit(`stringing-shop-read:${ip}`, 120, HOUR_MS)) {
    // Unknown, not closed. Answering "closed" on a throttled read would hang a
    // CLOSED sign on a shop that is open — the lying-empty-state rule applied
    // to a capability, where the confident answer is the harmful one.
    return NextResponse.json({ open: null });
  }

  // Deliberately readable without auth: the sign is for players, and whether
  // this club strings rackets is not a secret. Nothing else is exposed.
  // Shared with the request route so the two cannot disagree about "open".
  return NextResponse.json({ open: await readShopOpen() });
}

export async function PATCH(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const ip = getClientIp(req);
  if (!checkRateLimit(`stringing-shop-write:${ip}`, 60, HOUR_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const admin = await isAdminAuthedWithMember(req);
  if (!admin.authed) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.open !== 'boolean') {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  try {
    await ensureClubSettings();
    const doc: ShopDoc = {
      id: SHOP_DOC_ID,
      open: body.open,
      updatedAt: new Date().toISOString(),
      updatedBy: admin.memberId,
    };
    // Upsert, not read-modify-write: the document has one meaningful field, so
    // there is nothing to merge and nothing a concurrent write could clobber
    // except the answer itself — which is exactly what the caller intends.
    await getContainer('clubSettings').items.upsert(doc);
    return NextResponse.json({ open: doc.open });
  } catch (err) {
    console.error('PATCH /api/stringing/shop failed:', err);
    return NextResponse.json({ error: 'write_failed' }, { status: 503 });
  }
}
