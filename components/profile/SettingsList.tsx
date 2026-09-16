'use client';

/**
 * Profile's settings rows: one field card, rows divided by a hairline, icon /
 * label / meta / chevron. Lifted out of `ProfileTab` when "Your groups" needed
 * the same rows for its Join and Create actions — two copies of a row diverge.
 */

export interface SettingsRow {
  icon: string;
  label: string;
  onClick: () => void;
  /** Right-aligned status text shown before the chevron (e.g. "Set" / "Not set"). */
  meta?: string;
  /**
   * Tint the icon and meta green. Reserved for a live count that is asking to
   * be acted on — accent is currency here, the same rule Home follows. The
   * `destructive` variant this replaces went with Log out when it left the
   * list to become a standalone centred button.
   */
  accent?: boolean;
}

export default function SettingsList({ rows }: { rows: SettingsRow[] }) {
  return (
    // Page-level card, so the field-card glass — not `.glass-card-soft`, the
    // flat bordered style for rows INSIDE a card, which made Profile read as
    // frosted plastic beside every other tab (Grant, 2026-09-14).
    <div className="glass-card is-flush" style={{ overflow: 'hidden' }}>
      <ul style={{ listStyle: 'none', margin: '0', padding: '0' }}>
        {rows.map((row, idx) => (
          <li key={row.label} style={{ borderTop: idx === 0 ? 'none' : '1px solid var(--divider)' }}>
            <button
              type="button"
              onClick={row.onClick}
              // `.settings-row` owns the background so :active can flash it;
              // an inline background would outrank the press state.
              className="settings-row"
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-4)',
                padding: 'var(--space-4) var(--space-5)',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-primary)',
                fontSize: 'var(--fs-lg)',
                textAlign: 'left',
              }}
            >
              <span
                className="material-icons"
                aria-hidden="true"
                style={{
                  fontSize: 'var(--fs-stat)',
                  color: row.accent ? 'var(--accent)' : 'var(--text-secondary)',
                }}
              >
                {row.icon}
              </span>
              <span style={{ flex: 1 }}>{row.label}</span>
              {row.meta && (
                <span
                  // Meta arrives after its own fetch ("PIN · Google"); keyed so
                  // it fades in rather than popping beside a settled label.
                  key={row.meta}
                  className="motion-fade"
                  style={{
                    fontSize: 'var(--fs-base)',
                    color: row.accent ? 'var(--accent)' : 'var(--text-secondary)',
                  }}
                >
                  {row.meta}
                </span>
              )}
              <span
                className="material-icons"
                aria-hidden="true"
                style={{ fontSize: 'var(--icon-md)', color: 'var(--text-secondary)' }}
              >
                chevron_right
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
