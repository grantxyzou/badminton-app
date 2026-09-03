import type { Metadata } from 'next';
import LegalDoc from '../_LegalDoc';

export const metadata: Metadata = { title: 'Terms of use — BPM Badminton' };

export default function TermsPage() {
  return <LegalDoc doc="terms" />;
}
