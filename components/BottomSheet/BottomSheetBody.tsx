'use client';

interface BottomSheetBodyProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Scrollable content area inside a BottomSheet.
 *
 * Uses `flex-1 + min-h-0 + overflow-y-auto` so it grows to fill the remaining
 * height inside the sheet's max-height (after the header). No opinionated
 * padding — consumers pass it via className (e.g. "p-5 pb-20" or "px-5 pb-8").
 *
 * `min-h-0` is required to let `flex-1` shrink below its content's natural
 * height, which is what enables `overflow-y-auto` to actually scroll instead
 * of overflowing the parent.
 */
export default function BottomSheetBody({ children, className, style }: BottomSheetBodyProps) {
  return (
    <div
      className={`min-h-0 flex-1 overflow-y-auto ${className ?? ''}`}
      style={style}
    >
      {children}
    </div>
  );
}
