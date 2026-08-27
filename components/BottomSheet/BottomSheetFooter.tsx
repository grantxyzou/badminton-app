'use client';

interface BottomSheetFooterProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Pinned action area at the bottom of a BottomSheet.
 *
 * Render it as a SIBLING AFTER `BottomSheetBody`, never inside it —
 * `BottomSheetBody` is `flex-1 min-h-0 overflow-y-auto`, so anything after it
 * is pushed to the bottom of the sheet and stays there while the body scrolls.
 * That is the whole mechanism; there is no absolute positioning involved, and
 * putting this inside the body would simply scroll it away again.
 *
 * The reason it exists: a sheet whose primary action sits at the natural end
 * of its content only offers that action to someone who scrolls to the end.
 * `GearPickSheet`'s "Add to my kit" sat under roughly 700px of specs, reasons
 * and caveats in the string case, which is a button most members never saw.
 *
 * All of the visual treatment (padding, top border, translucent scrim, blur)
 * lives in `.bottom-sheet-footer` in `globals.css` rather than here, so the
 * pattern is defined once and this file stays free of literal values — this
 * directory is one of the areas where the token ESLint rules are `error`.
 */
export default function BottomSheetFooter({ children, className }: BottomSheetFooterProps) {
  return (
    <div className={['bottom-sheet-footer', className].filter(Boolean).join(' ')}>
      {children}
    </div>
  );
}
