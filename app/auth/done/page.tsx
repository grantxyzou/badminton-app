import type { Metadata } from 'next';
import HandoffDone from '@/components/auth/HandoffDone';

export const metadata: Metadata = {
  title: 'Finishing sign-in',
  robots: { index: false, follow: false },
};

/**
 * Where a Google/Apple sign-in lands when the APP finishes it — a pop-up the
 * installed iOS web app opened, or the full-page Safari trip. See
 * `handoffLanding` in lib/oauthCallback.ts. All behaviour is client-side,
 * because everything it acts on is in the URL fragment.
 */
export default function HandoffDonePage() {
  return <HandoffDone />;
}
