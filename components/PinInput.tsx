'use client';
import { useId, type CSSProperties } from 'react';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  value: string;
  onChange: (v: string) => void;
  digits: 4 | 6;
  label: string;
  autoFocus?: boolean;
  disabled?: boolean;
  ariaInvalid?: boolean;
}

// Cycle the three brand baddicons (pink / yellow / green from
// public/brand/*.svg) one per typed digit. Empty fields show no icons, so
// the input doesn't leak max length at a glance. Filename `baddicon-yello`
// is intentionally short — that's how the asset ships.
const BADDICONS = ['pink', 'yello', 'green'];

export default function PinInput({
  value, onChange, digits, label, autoFocus, disabled, ariaInvalid,
}: Props) {
  const id = useId();
  return (
    <div style={{ position: 'relative' }}>
      <label htmlFor={id} className="sr-only">{label}</label>
      <input
        id={id}
        name={`pin-${digits}`}
        // Intentionally NOT type="password" — Chrome's password manager runs
        // a stored-password reuse check on every type="password" field, which
        // flags this site as "Dangerous" with a "Check your passwords"
        // overlay when the user types a PIN that matches a saved password
        // for any other domain. The shuttlecock overlay below preserves
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
        placeholder={value ? '' : label}
        style={{
          // Inherit canonical input styles from globals.css (14px radius,
          // 11px 14px padding, --input-bg/--input-border, focus ring). Only
          // override what's specific to PinInput: hide typed characters but
          // keep the caret beam so the user has typing feedback alongside
          // the baddicon overlay. Letter-spacing only applies when there's
          // a typed value — placeholder text stays at canonical body size,
          // and the caret advances ~30px per digit to align with the
          // baddicon slot pitch (24px icon + 6px gap).
          color: 'transparent',
          caretColor: 'var(--text-primary)',
          ...(value.length > 0 ? { letterSpacing: '22px' } : {}),
        } as CSSProperties}
      />
      {value.length > 0 && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 14,
            top: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            pointerEvents: 'none',
          }}
        >
          {Array.from({ length: value.length }, (_, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={`${BASE}/brand/baddicon-${BADDICONS[i % BADDICONS.length]}.svg`}
              alt=""
              aria-hidden="true"
              width={24}
              style={{
                height: 22,
                width: 24,
                flexShrink: 0,
                animation: 'baddicon-pop 320ms var(--ease-spring) both',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
