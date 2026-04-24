import Link from 'next/link';
import { SUBPAGES } from './_nav';

export default function DesignIndexPage() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '2rem 1rem', display: 'grid', gap: '1rem' }}>
      <h1 className="bpm-h1" style={{ marginBottom: 0 }}>BPM Design System</h1>
      <p className="bpm-body" style={{ color: 'var(--text-secondary)', marginTop: 0 }}>
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
      <div style={{ display: 'grid', gap: '0.75rem', marginTop: '0.5rem' }}>
        {SUBPAGES.map((p) => (
          <Link
            key={p.href}
            href={p.href}
            className="glass-card"
            style={{
              display: 'block',
              padding: '1.25rem',
              textDecoration: 'none',
              color: 'var(--text-primary)',
            }}
          >
            <div style={{ fontSize: '1.125rem', fontWeight: 600 }}>{p.label}</div>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              {p.blurb}
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
