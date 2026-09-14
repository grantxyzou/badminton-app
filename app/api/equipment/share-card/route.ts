import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { verifyMemberAuth, isAdminAuthed, requireMember } from '@/lib/auth';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { isFlagOn } from '@/lib/flags';
import { resolveGroupId } from '@/lib/groupContext';
import { resolveActiveMemberId } from '@/lib/memberResolve';
import { readGroup, readMembership } from '@/lib/groups';
import { readGearOrNull } from '@/lib/racketFitInput';
import { ensureCatalogSeeded } from '@/lib/catalogSeed';
import { activeRacket } from '@/lib/activeRacket';
import { tallyClubGear } from '@/lib/clubGear';
import { clubTensionFor } from '@/lib/clubTension';
import { readClubGearDocs } from '@/lib/clubGearDocs';
import { buildShareCard } from '@/lib/shareCard';
import type { CatalogItem, Member } from '@/lib/types';

/**
 * The share card's facts, for the member themselves (lib/shareCard.ts).
 *
 * OWNER OR ADMIN, like the gear read it summarises. Every club-relative number
 * is computed HERE from the club reads, because a "1 of 4" worked out on a
 * phone from whatever it last cached is a correctness bug, not a rounding one.
 * A read that fails for a secondary fact (the club, the group name) drops that
 * fact rather than the card.
 */

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`share-card:${ip}`, 30, 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const gate = await requireMember(req);
  if (!gate.ok) return gate.response;

  const name = new URL(req.url).searchParams.get('name')?.trim().slice(0, 50) ?? '';
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 });

  try {
    const caller = verifyMemberAuth(req);
    const admin = isAdminAuthed(req);
    if (!caller && !admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    const groupId = resolveGroupId(req);
    const memberId = await resolveActiveMemberId(groupId, name);
    if (!memberId || (caller?.memberId !== memberId && !admin)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const gear = await readGearOrNull(memberId);
    const racket = activeRacket(gear);

    let racketRow: CatalogItem | null = null;
    if (racket?.catalogId) {
      try {
        await ensureCatalogSeeded();
        const { resource } = await getContainer('equipmentCatalog').item(racket.catalogId, 'racket').read();
        racketRow = (resource as CatalogItem | undefined) ?? null;
      } catch { racketRow = null; }
    }

    let joinedAt: string | null = null;
    try {
      if (isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP')) joinedAt = (await readMembership(groupId, memberId))?.joinedAt ?? null;
      if (!joinedAt) {
        const { resource } = await getContainer('members').item(memberId, memberId).read();
        joinedAt = (resource as Member | undefined)?.createdAt ?? null;
      }
    } catch { joinedAt = null; }

    let clubName: string | null = null;
    try { clubName = (await readGroup(groupId))?.name ?? null; } catch { clubName = null; }

    let clubEntries: ReturnType<typeof tallyClubGear> = [];
    let band = null;
    try {
      const docs = await readClubGearDocs(groupId);
      clubEntries = tallyClubGear(docs);
      band = racket?.catalogId ? clubTensionFor(docs, racket.catalogId) : null;
    } catch { /* the club facts drop; the card does not */ }

    return NextResponse.json({ card: buildShareCard({ name, joinedAt, clubName, gear, racketRow, clubEntries, band }) });
  } catch (error) {
    console.error('GET equipment/share-card error:', error);
    return NextResponse.json({ error: 'load_failed' }, { status: 500 });
  }
}
