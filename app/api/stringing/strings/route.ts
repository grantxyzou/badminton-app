/**
 * GET   /api/stringing/strings — what the club stocks. Readable by players.
 * PATCH /api/stringing/strings — set the list. Admin only.
 *
 * The GET is deliberately open, for the same reason the shop sign is: the
 * request form is the whole audience, and which strings a badminton club keeps
 * on the shelf is not a secret. Nothing else is returned — no timestamps, no
 * author.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { isAdminAuthedWithMember } from '@/lib/auth';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { ensureClubSettings } from '@/lib/stringingShop';
import {
  readOfferedStrings,
  normaliseOfferedStrings,
  STRINGS_DOC_ID,
  type OfferedStringsDoc,
} from '@/lib/stringingStrings';

export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const ip = getClientIp(req);
  if (!checkRateLimit(`stringing-strings-read:${ip}`, 120, HOUR_MS)) {
    // Unknown, not empty. An empty list tells the form "nothing is stocked, go
    // custom"; a throttled read must not be allowed to say that confidently.
    return NextResponse.json({ strings: null });
  }
  return NextResponse.json({ strings: await readOfferedStrings() });
}

export async function PATCH(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const ip = getClientIp(req);
  if (!checkRateLimit(`stringing-strings-write:${ip}`, 60, HOUR_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const admin = await isAdminAuthedWithMember(req);
  if (!admin.authed) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const strings = normaliseOfferedStrings(body?.strings);
  if (strings === null) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  try {
    await ensureClubSettings();
    const doc: OfferedStringsDoc = {
      id: STRINGS_DOC_ID,
      strings,
      updatedAt: new Date().toISOString(),
      updatedBy: admin.memberId,
    };
    // Upsert, like the shop sign: the document is one list, so there is nothing
    // to merge and nothing a concurrent write could clobber except the list
    // itself — which is what the caller means to replace.
    await getContainer('clubSettings').items.upsert(doc);
    return NextResponse.json({ strings: doc.strings });
  } catch (err) {
    console.error('PATCH /api/stringing/strings failed:', err);
    return NextResponse.json({ error: 'write_failed' }, { status: 503 });
  }
}
