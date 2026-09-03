import type { Metadata } from 'next';
import LegalDoc from '../_LegalDoc';

export const metadata: Metadata = { title: 'Privacy policy — BPM Badminton' };

export default function PrivacyPage() {
  return <LegalDoc doc="privacy" />;
}
