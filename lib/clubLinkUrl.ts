import { invitePath } from '@/lib/inviteLink';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * The club's link as a person receives it: `/bpm/j/<token>` (lib/inviteLink.ts)
 * from the window's own origin, because behind the Azure proxy, in the
 * installed PWA and in the native WebView the origin differs, and a link
 * pointing at the wrong one is worse than none. Server-side it is the path.
 */
export function clubLinkUrl(token: string): string {
  const path = invitePath(token, BASE);
  return typeof window === 'undefined' ? path : `${window.location.origin}${path}`;
}
