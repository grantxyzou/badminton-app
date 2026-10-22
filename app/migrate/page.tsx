import type { Metadata } from 'next';
import MigrateClaim from '@/components/MigrateClaim';
import { APP_SHORT_NAME } from '@/lib/brand';

export const metadata: Metadata = {
  title: `Move to the ${APP_SHORT_NAME} app`,
  robots: { index: false, follow: false },
};

/** The universal-link landing. All behaviour is in the client component. */
export default function MigratePage() {
  return <MigrateClaim />;
}
