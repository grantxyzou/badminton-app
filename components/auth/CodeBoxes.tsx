'use client';

interface Props {
  value: string;
  onChange: (digits: string) => void;
  label: string;
  /** Six, for the emailed code. */
  length?: number;
  autoFocus?: boolean;
  disabled?: boolean;
}

/**
 * The emailed code as six boxes (the canvas, "Check your email"). ONE real
 * input lies over the boxes, invisible: paste, the keyboard's one-time-code
 * suggestion, a screen reader and the delete key all meet a single ordinary
 * field, and the boxes only draw what it holds. Six separate inputs would need
 * focus juggling for every one of those.
 */
export default function CodeBoxes({ value, onChange, label, length = 6, autoFocus, disabled }: Props) {
  const digits = value.slice(0, length);
  return (
    <div className="auth-code">
      {Array.from({ length }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="auth-code-box"
          {...(i === Math.min(digits.length, length - 1) ? { 'data-active': '' } : {})}
        >
          {digits[i] ?? ''}
        </span>
      ))}
      <input
        className="auth-code-input"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        value={digits}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, length))}
        maxLength={length}
        aria-label={label}
        autoFocus={autoFocus}
        disabled={disabled}
      />
    </div>
  );
}
