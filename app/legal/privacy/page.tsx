import type { Metadata } from 'next';
import { APP_NAME } from '@/lib/brand';
import LegalDoc from '../_LegalDoc';

export const metadata: Metadata = { title: `Privacy policy — ${APP_NAME}` };

export default function PrivacyPage() {
  return <LegalDoc doc="privacy" />;
}
