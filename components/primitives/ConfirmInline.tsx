/**
 * Inline "Are you sure? Yes / No" confirmation row. Replaces the
 * destructive-action confirmation pattern that appeared in PlayersTab
 * twice (active row + waitlist row) with subtly different styling
 * each time:
 *
 *   <div className="flex items-center gap-2 text-xs">
 *     <span className="text-gray-400">{message}</span>
 *     <button onClick={onYes} className="text-red-400 …">{yesLabel}</button>
 *     <button onClick={onNo} className="text-gray-400 …">{noLabel}</button>
 *   </div>
 *
 * The component standardizes the size/spacing and forces both buttons
 * to a 32px min-height for tap targets (one of the original call sites
 * had this; the other did not — drift caught and reconciled).
 */
export interface ConfirmInlineProps {
  message: string;
  yesLabel: string;
  noLabel: string;
  onYes: () => void;
  onNo: () => void;
  /**
   * Color tone for the affirmative button. Defaults to `'danger'` since
   * the canonical use is a destructive cancel/remove confirmation.
   */
  yesTone?: 'danger' | 'accent';
}

export default function ConfirmInline({
  message,
  yesLabel,
  noLabel,
  onYes,
  onNo,
  yesTone = 'danger',
}: ConfirmInlineProps) {
  const yesClass =
    yesTone === 'danger'
      ? 'text-red-400 hover:text-red-300'
      : 'text-green-400 hover:text-green-300';
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-gray-400">{message}</span>
      <button
        type="button"
        onClick={onYes}
        className={`${yesClass} transition-colors px-2 py-1`}
        style={{ minHeight: 32 }}
      >
        {yesLabel}
      </button>
      <button
        type="button"
        onClick={onNo}
        className="text-gray-400 hover:text-white transition-colors px-2 py-1"
        style={{ minHeight: 32 }}
      >
        {noLabel}
      </button>
    </div>
  );
}
