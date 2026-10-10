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
 * 44px target, the app's minimum for a tap. The glyph is `--icon-md` (18px):
 * it was `--fs-stat` (20px), a TYPE token that sits on no rung of the icon
 * ladder (13/16/18/24/40), and three stringing sheets copied that along with
 * the whole button.
 */
export default function SheetCloseButton({ onClose, label }: { onClose: () => void; label: string }) {
  return (
    <button type="button" onClick={onClose} aria-label={label} className="sheet-close-btn">
      <span className="material-icons icon-md" aria-hidden="true">
        close
      </span>
    </button>
  );
}
