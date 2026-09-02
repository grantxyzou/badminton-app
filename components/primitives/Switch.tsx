/**
 * Switch — the binary settings toggle (iOS spec: 51×31 track, 25px knob).
 *
 * Built for the Stats & privacy screen's club-comparison control, but shaped
 * as a primitive because the app had grown four hand-rolled copies of this
 * (SetupPage, the since-retired SessionDetailsEditor ×2, NextSessionCard, DevPanel) that had
 * already drifted on size and colour. New settings toggles should use this.
 *
 * It is a `<button role="switch">` with `aria-checked` — never a checkbox, and
 * never `aria-pressed`. That matches every existing toggle in the app and is
 * the correct role for a binary setting; `aria-pressed` here is reserved for
 * multi-select chips (kudos tags, check-in anchors, DatePicker days).
 *
 * All styling lives in `app/globals.css` under `.bpm-switch` — including the
 * focus ring, the disabled state, and the overlay that lifts the 31px track to
 * the app's 44px touch minimum. Nothing is inline, so the primitive stays
 * trivially token-clean under the strict lint override for this directory.
 *
 * Consumers that write over the network must pass `disabled` when offline —
 * the app's posture is legible-fail, never execute-then-break.
 */
export interface SwitchProps {
  /** Current state. Drives `aria-checked`, which the CSS also reads. */
  checked: boolean;
  /** Called with the NEXT value, so callers don't re-derive the negation. */
  onChange: (next: boolean) => void;
  /**
   * Required. A switch with no visible <label> association needs its own
   * name — this is a settings control, and "on/off" alone is not a label.
   */
  ariaLabel: string;
  disabled?: boolean;
  /** Associates the switch with descriptive text, e.g. the live state line. */
  ariaDescribedBy?: string;
}

export default function Switch({
  checked,
  onChange,
  ariaLabel,
  disabled = false,
  ariaDescribedBy,
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="bpm-switch"
    >
      <span className="bpm-switch__knob" />
    </button>
  );
}
