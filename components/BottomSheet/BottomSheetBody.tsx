'use client';

interface BottomSheetBodyProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  /**
   * Drop the default padding and take `className` alone.
   *
   * Two kinds of consumer need this. Sheets whose body is a bare scroll
   * container with an inner element that owns the padding (`LearnRegister`,
   * `SteppedGameLoggerSheet`, `ClubConsentSheet`, `AdvanceSessionForm`) —
   * applying the default there would pad twice. And sheets with a deliberate
   * variant: `SkillTrendCard` / `CheckInSheet` (no top padding, plus a
   * safe-area inset), `InstallSheet`, `CoverSheet`, `ReleaseNotesSheet`.
   */
  bare?: boolean;
}

/**
 * Scrollable content area inside a BottomSheet.
 *
 * `flex-1 + min-h-0 + overflow-y-auto` so it fills the remaining height inside
 * the sheet's max-height. `min-h-0` is required — it lets `flex-1` shrink below
 * its content's natural height, which is what makes `overflow-y-auto` scroll
 * instead of overflowing the parent.
 *
 * Padding defaults to `p-5 pb-8` (the 20px column its header shares, with room
 * at the bottom for a thumb). Consumer `className` is appended and should not
 * re-state padding — see the note in `BottomSheetHeader`. Use `bare` instead.
 */
export default function BottomSheetBody({ children, className, style, bare }: BottomSheetBodyProps) {
  const base = bare ? 'min-h-0 flex-1 overflow-y-auto' : 'min-h-0 flex-1 overflow-y-auto p-5 pb-8';
  return (
    <div className={[base, className].filter(Boolean).join(' ')} style={style}>
      {children}
    </div>
  );
}
