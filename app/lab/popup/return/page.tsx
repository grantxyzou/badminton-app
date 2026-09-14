/** TEMPORARY SPIKE — the pop-up's landing. See ../page.tsx. */
import type { Metadata } from 'next';
import PopupReturn from './PopupReturn';

export const metadata: Metadata = { title: 'Pop-up test', robots: { index: false, follow: false } };

export default function PopupReturnPage() {
  return <PopupReturn />;
}
