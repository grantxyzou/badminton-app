'use client';

interface BottomSheetHeaderProps {
  children?: React.ReactNode;
  className?: string;
  /**
   * Drop the default layout + padding and take `className` alone.
   *
   * NOTE THE ASYMMETRY with `BottomSheetBody`'s `bare`, which drops padding
   * only: this one drops the ROW LAYOUT too. If you reach for it just to
   * change padding you also lose `flex items-center justify-between`, and a
   * title and close button will stack. Supply the layout yourself (as
   * `CheckInSheet` and `AdvanceSessionForm` do on an inner div) or don't use
   * `bare`.
   *
   * For the four headers that genuinely aren't a title-and-close-button row:
   * `ReleaseNotesSheet` (terminal titlebar), `CoverSheet` (stacked title +
   * subtitle, so `justify-between` would sit them side by side), and
   * `CheckInSheet` / `AdvanceSessionForm` (an inner div owns the flex, and as
   * a flex child it would shrink to its content width instead of filling).
   *
   * Reach for this only when the default would be *wrong*, not when it would
   * merely be different — a one-off padding value is the thing this component
   * exists to stop.
   */
  bare?: boolean;
}

/**
 * The header row of a BottomSheet: title on the left, close button on the right.
 *
 * The padding is baked in rather than passed per call site. It used to be the
 * consumer's job, and 23 sheets each re-deciding it meant two of them shipped
 * with none at all — the title sat flush at x=0 while the body padded 20px, and
 * the close button's focus ring was sliced in half by the sheet's
 * `overflow-hidden`. Nothing caught it because there was nothing to catch it
 * against.
 *
 * `px-5` matches `BottomSheetBody`'s 20px so a title lands in the same column
 * as the copy beneath it. Consumer `className` is appended, so it can add (a
 * background, a border) but should not re-state padding — Tailwind resolves a
 * `p-4` vs `px-5` collision by stylesheet order, not by argument order, so the
 * winner would not be predictable. Use `bare` for a real variant instead.
 */
export default function BottomSheetHeader({ children, className, bare }: BottomSheetHeaderProps) {
  const base = bare ? '' : 'flex items-center justify-between px-5 pt-4 pb-3';
  const cls = [base, className].filter(Boolean).join(' ');
  return <div className={cls || undefined}>{children}</div>;
}
