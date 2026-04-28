'use client';
import { useId } from 'react';

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
        type="password"
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
        }}
      />
    </div>
  );
}
