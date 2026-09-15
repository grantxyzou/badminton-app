'use client';

/**
 * The ✕ in a sheet's header — one component, so every sheet has the same one.
 *
 * Sheets used to hand-roll this button, and eight of them simply did not: a
 * member reached "Delete account" or "Cancel your spot" with Escape as the only
 * way out, which a phone does not have. `__tests__/sheet-close-canary.test.ts`
 * now fails the build on a sheet with no close control.
 *
 * `label` is passed in rather than looked up here, so this renders in any tree —
 * including the admin sheets that are tested without a translation provider.
 * 44px target, the app's minimum for a tap.
 */
export default function SheetCloseButton({ onClose, label }: { onClose: () => void; label: string }) {
  return (
    <button type="button" onClick={onClose} aria-label={label} className="sheet-close-btn">
      <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--fs-stat)' }}>
        close
      </span>
    </button>
  );
}
