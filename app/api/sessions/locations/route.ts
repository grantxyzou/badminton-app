import { NextRequest, NextResponse } from 'next/server';
import { getContainer, POINTER_ID } from '@/lib/cosmos';
import { isAdminAuthed, unauthorized } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface RecentLocation {
  locationName: string;
  locationAddress: string;
}

/**
 * Returns deduplicated recent venues + session titles (admin-only), so the
 * advance/create-session form can offer one-tap autosuggest chips instead of
 * making the admin retype the venue every week.
 */
export async function GET(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();

  try {
    const container = getContainer('sessions');
    const { resources } = await container.items
      .query({
        query:
          'SELECT c.title, c.locationName, c.locationAddress FROM c WHERE c.id != @pointerId AND c.id != @legacyId ORDER BY c.id DESC OFFSET 0 LIMIT 30',
        parameters: [
          { name: '@pointerId', value: POINTER_ID },
          { name: '@legacyId', value: 'current-session' },
        ],
      })
      .fetchAll();

    // Dedupe venues by name+address (most-recent-first order preserved).
    const seenLoc = new Set<string>();
    const locations: RecentLocation[] = [];
    const seenTitle = new Set<string>();
    const titles: string[] = [];

    for (const r of resources as Array<Record<string, unknown>>) {
      const locationName = typeof r.locationName === 'string' ? r.locationName.trim() : '';
      const locationAddress = typeof r.locationAddress === 'string' ? r.locationAddress.trim() : '';
      if (locationName || locationAddress) {
        const key = `${locationName}|${locationAddress}`;
        if (!seenLoc.has(key)) {
          seenLoc.add(key);
          locations.push({ locationName, locationAddress });
        }
      }
      const title = typeof r.title === 'string' ? r.title.trim() : '';
      if (title && !seenTitle.has(title)) {
        seenTitle.add(title);
        titles.push(title);
      }
    }

    return NextResponse.json({ locations: locations.slice(0, 6), titles: titles.slice(0, 6) });
  } catch (error) {
    // Surface the failure (503) rather than a lying empty list — a 200 + []
    // would read as "no prior venues" when the read actually failed
    // (CLAUDE.md: "Lying empty state is forbidden"). Consumers guard on res.ok.
    console.error('GET sessions/locations error:', error);
    return NextResponse.json({ error: 'Failed to load locations' }, { status: 503 });
  }
}
