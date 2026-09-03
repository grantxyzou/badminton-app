import type { Metadata } from 'next';
import MigrateClaim from '@/components/MigrateClaim';

export const metadata: Metadata = {
  title: 'Move to the BPM app',
  robots: { index: false, follow: false },
};

/** The universal-link landing. All behaviour is in the client component. */
export default function MigratePage() {
  return <MigrateClaim />;
}
