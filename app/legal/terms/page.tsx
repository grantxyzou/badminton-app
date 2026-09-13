import type { Metadata } from 'next';
import { APP_NAME } from '@/lib/brand';
import LegalDoc from '../_LegalDoc';

export const metadata: Metadata = { title: `Terms of use — ${APP_NAME}` };

export default function TermsPage() {
  return <LegalDoc doc="terms" />;
}
