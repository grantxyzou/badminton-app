/**
 * GET   /api/stringing/strings — what the club stocks. Readable by players.
 * PATCH /api/stringing/strings — set the list. Admin only.
 *
 * The GET is deliberately open, for the same reason the shop sign is: the
 * request form is the whole audience, and which strings a badminton club keeps
 * on the shelf is not a secret. Nothing else is returned — no timestamps, no
 * author. Since 2026-10-10 it also carries `links`, label → catalog id, for
 * the Stringing tab's "Strings we offer" card (docs/plans/string-inventory.md).
 */
import { NextRequest, NextResponse } from 'next/server';
import { groupScope } from '@/lib/groupScope';
import { resolveGroupId } from '@/lib/groupContext';
import { isAdminAuthedWithMember, requireMember } from '@/lib/auth';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { ensureClubSettings } from '@/lib/stringingShop';
import {
  readOfferedStringsWithLinks,
  normaliseOfferedStrings,
  normaliseLinks,
  stringsDocId,
  type OfferedStringsDoc,
} from '@/lib/stringingStrings';
import { readStringCatalog } from '@/lib/stringStock';

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
  const gate = await requireMember(req);
  if (!gate.ok) return gate.response;
  // `links` (label → catalog id) rides beside `strings` since 2026-10-10
  // (docs/plans/string-inventory.md); a reader that wants only the list is
  // untouched. Unknown is unknown for both.
  const read = await readOfferedStringsWithLinks(resolveGroupId(req));
  return NextResponse.json(read ? { strings: read.strings, links: read.links } : { strings: null, links: null });
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
    const groupId = resolveGroupId(req);
    // A link to a catalog row the catalog does not have is dropped, not
    // refused — the list is what is being saved. Absent `links` keeps the
    // ones already stored for labels that survive, so an older client that
    // sends only `strings` does not wipe them.
    const prior = (await readOfferedStringsWithLinks(groupId))?.links ?? {};
    const validIds = new Set((await readStringCatalog()).keys());
    const links = normaliseLinks(body?.links === undefined ? prior : body.links, strings, validIds);
    const doc: OfferedStringsDoc = {
      id: stringsDocId(groupId),
      strings,
      links,
      updatedAt: new Date().toISOString(),
      updatedBy: admin.memberId,
    };
    // Upsert, like the shop sign: the document is one list, so there is nothing
    // to merge and nothing a concurrent write could clobber except the list
    // itself — which is what the caller means to replace.
    await groupScope(groupId).upsert('clubSettings', doc);
    return NextResponse.json({ strings: doc.strings, links: doc.links });
  } catch (err) {
    console.error('PATCH /api/stringing/strings failed:', err);
    return NextResponse.json({ error: 'write_failed' }, { status: 503 });
  }
}
