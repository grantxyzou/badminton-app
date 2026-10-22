import type { KeyboardEvent } from 'react';

/**
 * A dollar amount typed by hand: the field with its `$` drawn INSIDE it, in
 * the data face. The stringing screens had three ways to say "dollars" — a `$`
 * inside the field (New job), a `$` beside it (a string's price, Other prices)
 * and "($)" in the label (a string purchase). One field now, the New job one:
 * a placeholder disappears the moment you type, so the unit has to be part of
 * the field itself, and beside it the `$` reads as a separate control.
 *
 * Controlled and string-valued: the caller parses (an empty field is usually
 * a real answer — "Ask", or "not priced yet" — never zero).
 */
export interface MoneyInputProps {
  value: string;
  onChange: (next: string) => void;
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
}

export default function MoneyInput({ value, onChange, id, ariaLabel, placeholder, maxLength = 8, disabled, onKeyDown }: MoneyInputProps) {
  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <span
        aria-hidden="true"
        className="fs-md"
        style={{
          position: 'absolute',
          left: 'var(--space-4)',
          top: '50%',
          transform: 'translateY(-50%)',
          color: value.trim() ? 'var(--text-primary)' : 'var(--text-muted)',
          fontFamily: 'var(--font-mono)',
          pointerEvents: 'none',
        }}
      >
        $
      </span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label={ariaLabel}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        style={{ width: '100%', paddingLeft: 'var(--space-6)', fontFamily: 'var(--font-mono)' }}
      />
    </div>
  );
}
