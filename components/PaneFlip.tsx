'use client';

import { usePaneFlip } from '@/lib/paneMode';

/** Renders nothing; keeps `data-pane-flip` current on `<html>` (lib/paneMode.ts). */
export default function PaneFlip() {
  usePaneFlip();
  return null;
}
