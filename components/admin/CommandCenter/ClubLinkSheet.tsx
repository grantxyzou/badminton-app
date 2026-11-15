'use client';

import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import ClubLinkCard from '@/components/admin/CommandCenter/ClubLinkCard';

/**
 * The Club link card in a sheet, for the places that open it beside other work:
 * the Roster's "Club link" row. The card is the one thing; this is only its
 * frame (docs/plans/one-way-in.md, step 5). English only, like every admin
 * screen (CLAUDE.md, Q10).
 */
export default function ClubLinkSheet({
  open,
  onClose,
  clubName,
}: {
  open: boolean;
  onClose: () => void;
  clubName?: string | null;
}) {
  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel="Club link">
      <BottomSheetHeader onClose={onClose} closeLabel="Close">
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>Club link</span>
      </BottomSheetHeader>
      <BottomSheetBody>{open && <ClubLinkCard groupName={clubName} bare />}</BottomSheetBody>
    </BottomSheet>
  );
}
