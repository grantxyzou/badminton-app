import { NextResponse } from 'next/server';
import { signupLanding } from '@/lib/inviteLink';

/**
 * GET /bpm/s: the club's sign-up link, answered on the WEBSITE.
 *
 * The app opens this path itself (`components/NativeBridge.tsx`) and lands on
 * Home. Everywhere else it lands here and goes to the same place on the
 * website. It reads nothing and carries nothing: unlike an invite it is not a
 * credential, so a signed-out visitor simply sees the welcome page, as the
 * bare address always showed them.
 *
 * Relative and 303 for the same reasons as `app/j/[token]/route.ts`. No
 * caching, so a change of landing reaches a phone at once.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  return new NextResponse(null, {
    status: 303,
    headers: {
      Location: signupLanding('/bpm'),
      'Cache-Control': 'no-store',
    },
  });
}
