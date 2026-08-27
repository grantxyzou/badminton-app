import Link from 'next/link';
import { SUBPAGES } from './_nav';

export default function DesignIndexPage() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 'var(--space-8) var(--space-5)', display: 'grid', gap: 'var(--space-5)' }}>
      <h1 className="bpm-h1" style={{ marginBottom: '0' }}>BPM Design System</h1>
      <p className="bpm-body" style={{ color: 'var(--text-secondary)', marginTop: '0' }}>
        Preview route. Not linked from the app nav. Renders the formalized tokens and components
        imported from{' '}
        <code className="bpm-mono" style={{ color: 'var(--accent)' }}>
          docs/design-system/colors_and_type.css
        </code>
        .
      </p>
      <p className="bpm-caption">
        Flag-gated — visible only on dev and <code className="bpm-mono">bpm-next</code>. See{' '}
        <code className="bpm-mono">lib/flags.ts</code>.
      </p>
      <div style={{ display: 'grid', gap: 'var(--space-4)', marginTop: 'var(--space-3)' }}>
        {SUBPAGES.map((p) => (
          <Link
            key={p.href}
            href={p.href}
            className="glass-card"
            style={{
              display: 'block',
              padding: 'var(--space-6)',
              textDecoration: 'none',
              color: 'var(--text-primary)',
            }}
          >
            <div style={{ fontSize: '1.125rem', fontWeight: 600 }}>{p.label}</div>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: 'var(--space-1)' }}>
              {p.blurb}
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
