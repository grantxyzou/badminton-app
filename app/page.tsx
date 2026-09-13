import HomeShell from '@/components/HomeShell';
import SignedOutShell from '@/components/onboarding/SignedOutShell';
import { OnlineProvider } from '@/lib/useOnline';
import { headers } from 'next/headers';
import { NextRequest } from 'next/server';
import { readActiveAnnouncements } from '@/lib/announcements';
import { resolveGroupIdFromCookieHeader } from '@/lib/groupContext';
import { configuredProviders } from '@/lib/oauthProviders';
import { isFlagOn } from '@/lib/flags';
import { membersOnlyOn, requireMember } from '@/lib/auth';

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
  const cookie = (await headers()).get('cookie');
  const groupId = resolveGroupIdFromCookieHeader(cookie);
  // Which sign-in providers this deployment has credentials for. Pure env
  // reads — no Cosmos, no network — so it costs nothing here, and resolving it
  // on the server is what lets the provider buttons LEAD without the card
  // painting form-first and jumping when a client probe returns.
  const authProviders = isFlagOn('NEXT_PUBLIC_FLAG_AUTH_PROVIDERS') ? configuredProviders() : [];

  /**
   * MEMBERS ONLY (docs/plans/members-only.md): THE SERVER DECIDES WHO IS SIGNED
   * IN, BEFORE ANYTHING ABOUT THE CLUB IS READ.
   *
   * This page renders for every visitor, and a prop handed to a client
   * component is serialized into the HTML — so a read made here is published
   * to anyone with `curl`, however carefully the matching API route is gated.
   * With the flag on, a visitor the gate refuses gets `SignedOutShell` and
   * NOTHING is read: no announcement, no tabs, no nav, no client fetch.
   *
   * The gate is the SAME `requireMember` every club-data route calls, handed a
   * request built from this page's own cookie header — not a second
   * implementation of "signed in" to drift from the first. It re-reads the
   * member, so a removed person's 30-day cookie gets the signed-out screen.
   *
   * `__tests__/members-only-coverage.test.ts` pins the order: gate, early
   * return, and only then the read.
   */
  let memberName: string | null = null;
  if (membersOnlyOn()) {
    const gate = await requireMember(
      new NextRequest('http://localhost/bpm', { headers: cookie ? { cookie } : {} }),
    );
    if (!gate.ok) {
      return (
        <OnlineProvider>
          <SignedOutShell authProviders={authProviders} />
        </OnlineProvider>
      );
    }
    memberName = gate.member?.name ?? null;
  }

  const initialAnnouncement = (await readActiveAnnouncements(groupId))[0] ?? null;
  return (
    <OnlineProvider>
      <HomeShell initialAnnouncement={initialAnnouncement} authProviders={authProviders} memberName={memberName} />
    </OnlineProvider>
  );
}
