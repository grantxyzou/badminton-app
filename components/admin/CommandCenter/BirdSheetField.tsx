/** A labelled input slot for the two bird sheets. Presentation only. */
export default function BirdSheetField({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', ...style }}>
      <label style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{label}</label>
      {children}
    </div>
  );
}
