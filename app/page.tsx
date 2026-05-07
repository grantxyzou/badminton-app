import HomeShell from '@/components/HomeShell';
import { readActiveAnnouncements } from '@/lib/announcements';

// Force dynamic rendering — the announcement read hits Cosmos at request
// time, which Next.js would otherwise statically cache by default. We want
// every visit to see the freshest announcement.
export const dynamic = 'force-dynamic';

/**
 * Async server component. Server-renders the announcement (the LCP
 * element on the home tab) into the initial HTML payload so the user
 * sees it on first paint instead of waiting for JS bundle parse +
 * hydration + a client-side `/api/announcements` round-trip.
 *
 * All client-side state — tab routing, identity, dev mode, admin
 * gating, the easter egg, etc. — lives in `<HomeShell>` which is the
 * `'use client'` boundary. This file is the seam between server-
 * rendered data and client-rendered interactivity, the canonical
 * Next.js 13+ pattern.
 *
 * Lighthouse measured the announcement element render delay at 6028ms
 * before this change. Direct server-render shaves the bulk of that.
 */
export default async function Page() {
  const announcements = await readActiveAnnouncements();
  const initialAnnouncement = announcements[0] ?? null;
  return <HomeShell initialAnnouncement={initialAnnouncement} />;
}
