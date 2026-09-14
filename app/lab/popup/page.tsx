/**
 * TEMPORARY SPIKE — delete once answered (docs/plans/oauth-handoff-gaps.md).
 *
 * The question: can an installed iOS home-screen app open a pop-up window and
 * hear back from it? If yes, Google/Apple sign-in could finish INSIDE the app
 * (no Safari trip, no handoff), which closes both open takeovers. Developers
 * report `window.opener` is null on iOS 17.5+, so this is measured on a real
 * device before anything is built on it.
 *
 * Reads no club data, sets no cookie, needs no CSP change: test A never leaves
 * this origin, and test B only NAVIGATES the pop-up to Google's consent page.
 */
import type { Metadata } from 'next';
import PopupLab from './PopupLab';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Pop-up test', robots: { index: false, follow: false } };

export default function PopupLabPage() {
  // A Google client ID is public — it appears in every authorization URL.
  const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() || null;
  return <PopupLab googleClientId={googleClientId} />;
}
