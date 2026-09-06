'use client';

/**
 * One action inside a per-row action sheet.
 *
 * Lifted verbatim out of `PaymentsCard`, where it lived as a private helper,
 * when the stringing bench needed the same row. Two copies of a row component
 * is the bug class `lib/memberResolve.ts` exists to prevent — the second copy
 * does not diverge on the day it is made, it diverges four months later when
 * somebody fixes the disabled state in one of them.
 *
 * Structural only, like `ListRow`: it owns the icon / label / hint geometry and
 * the destructive tint, and takes no view on what the action does.
 */
export default function ActionRow({
  icon,
  label,
  hint,
  onClick,
  disabled,
  destructive,
}: {
  icon: string;
  label: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-4)',
        padding: 'var(--space-4) var(--space-5)',
        borderRadius: 'var(--radius-lg)',
        background: 'rgba(var(--glass-tint), 0.04)',
        border: '1px solid rgba(var(--glass-tint), 0.10)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        textAlign: 'left',
        opacity: disabled ? 0.5 : 1,
        color: 'var(--text-primary)',
      }}
    >
      <span
        className="material-icons"
        style={{
          fontSize: 'var(--fs-stat)',
          color: destructive ? 'var(--red-soft)' : 'var(--text-secondary)',
        }}
      >
        {icon}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <span
          style={{
            fontSize: 'var(--fs-md)',
            fontWeight: 500,
            color: destructive ? 'var(--red-soft)' : 'var(--text-primary)',
          }}
        >
          {label}
        </span>
        {hint && (
          <span
            style={{
              fontSize: 'var(--fs-xs)',
              color: 'var(--text-muted)',
              marginTop: 'var(--space-05)',
            }}
          >
            {hint}
          </span>
        )}
      </span>
    </button>
  );
}
