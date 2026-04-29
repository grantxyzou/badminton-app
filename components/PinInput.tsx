'use client';
import { useId, type CSSProperties } from 'react';

interface Props {
  value: string;
  onChange: (v: string) => void;
  digits: 4 | 6;
  label: string;
  autoFocus?: boolean;
  disabled?: boolean;
  ariaInvalid?: boolean;
}

export default function PinInput({
  value, onChange, digits, label, autoFocus, disabled, ariaInvalid,
}: Props) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="sr-only">{label}</label>
      <input
        id={id}
        name={`pin-${digits}`}
        // Intentionally NOT type="password" — Chrome's password manager runs
        // a stored-password reuse check on every type="password" field, which
        // flags this site as "Dangerous" with a "Check your passwords"
        // overlay when the user types a PIN that matches a saved password
        // for any other domain. The visual masking below preserves
        // shoulder-surf protection without engaging Chrome's heuristic.
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern={`[0-9]{${digits}}`}
        maxLength={digits}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, '').slice(0, digits))}
        autoFocus={autoFocus}
        disabled={disabled}
        aria-label={label}
        aria-invalid={ariaInvalid || undefined}
        placeholder={'•'.repeat(digits)}
        style={{
          fontFamily: 'var(--font-mono)',
          // Scale type down on narrow viewports so 4/6 dots + letter-spacing
          // never overflow at 320px. clamp(min, preferred, max).
          fontSize: 'clamp(20px, 6.5vw, 28px)',
          letterSpacing: '0.35em',
          textAlign: 'center',
          padding: '12px 14px',
          borderRadius: 12,
          border: ariaInvalid ? '1px solid var(--color-red, #ef4444)' : '1px solid var(--glass-border)',
          background: 'var(--input-bg, rgba(255,255,255,0.05))',
          color: 'var(--text-primary)',
          width: '100%',
          // Visual masking — renders typed digits as dots without the
          // type="password" semantic. Supported in Chrome/Safari/Edge and
          // Firefox 116+. If a Firefox user pre-dates that, digits show as
          // plain text — acceptable trade-off vs the Chrome warning.
          // `WebkitTextSecurity` isn't in csstype's CSSProperties yet, so
          // we cast through a vendor-extension intersection type.
          WebkitTextSecurity: 'disc',
        } as CSSProperties & { WebkitTextSecurity?: 'none' | 'disc' | 'circle' | 'square' }}
      />
    </div>
  );
}
