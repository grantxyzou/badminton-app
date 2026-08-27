const COLOR_SWATCHES: Array<{ name: string; value: string; note?: string }> = [
  { name: '--bpm-court-green',      value: '#4ade80', note: 'Primary accent (dark)' },
  { name: '--bpm-court-green-dark', value: '#16a34a', note: 'Primary accent (light)' },
  { name: '--bpm-night',            value: '#100F0F', note: 'Page bg — dark' },
  { name: '--bpm-cream',            value: '#FAF8F5', note: 'Page bg — light' },
  { name: '--bpm-ink',              value: '#1a2332', note: 'Text primary — light' },
  { name: '--bpm-fog',              value: '#e2e8f0', note: 'Text primary — dark' },
  { name: '--bpm-amber-400',        value: '#fbbf24', note: 'Waitlist' },
  { name: '--bpm-orange-400',       value: '#fb923c', note: 'Session full' },
  { name: '--bpm-red-400',          value: '#ef4444', note: 'Errors / PIN' },
  { name: '--bpm-blue-400',         value: '#60a5fa', note: 'Info / dates' },
];

const MOTION: Array<{ name: string; value: string; note: string }> = [
  { name: '--ease-glass',      value: 'cubic-bezier(0.23, 1, 0.32, 1)',   note: 'Default — liquid glass' },
  { name: '--ease-spring',     value: 'cubic-bezier(0.34, 1.56, 0.64, 1)', note: 'Bouncy — entrances' },
  { name: '--ease-sheet',      value: 'cubic-bezier(0.16, 1, 0.3, 1)',    note: 'Bottom-sheet — iOS feel' },
  { name: '--duration-fast',   value: '150ms',  note: 'Color / opacity' },
  { name: '--duration-normal', value: '250ms',  note: 'Transform / layout' },
  { name: '--duration-slow',   value: '400ms',  note: 'Glass-card lift' },
  { name: '--duration-sheet',  value: '180ms',  note: 'Bottom-sheet slide' },
];

const RADII = [
  ['--radius-xs',  '6px',  'Tags'],
  ['--radius-sm',  '8px',  'Inner cards, inputs'],
  ['--radius-md',  '10px', 'Buttons, nav pill'],
  ['--radius-lg',  '12px', 'Banners'],
  ['--radius-xl',  '16px', 'Glass card — MAX'],
  ['--radius-pill','100px','Pills, segment'],
] as const;

// Kept honest by __tests__/spacing-canary.test.ts, which parses the real
// values out of app/globals.css and fails if this table disagrees. It had
// drifted a whole rung: --space-3 was documented as 12px when it is 8px, and
// five of the six rows were wrong the same way. This page is where someone
// looks up which token to use, so a stale table here does not merely misinform
// -- it manufactures the drift it is supposed to prevent.
const SPACING = [
  ['--space-hair', '1px', 'Optical hairline — never a layout gap'],
  ['--space-05', '2px', 'Optical nudge — subtitle under a heading'],
  ['--space-1', '4px'],
  ['--space-2', '6px'],
  ['--space-3', '8px'],
  ['--space-4', '12px', 'Inner rows, tiles, stack gaps'],
  ['--space-5', '16px', 'Compact card padding'],
  ['--space-6', '20px', 'glass-card padding'],
  ['--space-7', '24px', 'Section rung'],
  ['--space-8', '32px'],
  ['--space-9', '48px', 'Page-level fallback padding'],
] as const;

const TYPE = [
  { tok: '--fs-xs / 14px',   sample: 'Caption · meta — bumped from 12px for 50+ readability', size: '14px', weight: 400 },
  { tok: '--fs-sm / 16px',   sample: 'Body copy — bumped from 14px for the same reason',       size: '16px', weight: 400 },
  { tok: '--fs-base / 16px', sample: 'Base body',                                              size: '16px', weight: 400 },
  { tok: '--fs-lg / 18px',   sample: 'Prominent body — inline announcements',                  size: '18px', weight: 500 },
  { tok: '--fs-xl / 20px',   sample: 'Card headings — UPCOMING SESSION · WAITLIST',            size: '20px', weight: 700 },
  { tok: '--fs-2xl / 24px',  sample: 'Section header',                                         size: '24px', weight: 700 },
  { tok: '--fs-3xl / 30px',  sample: 'Page title — "Sign up" / "Learn" / "Admin"',             size: '30px', weight: 700 },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <h2 className="bpm-section-label" style={{ color: 'var(--accent)' }}>{title}</h2>
      <div className="glass-card" style={{ padding: 'var(--space-6)' }}>{children}</div>
    </section>
  );
}

export default function TokensPage() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 'var(--space-8) var(--space-5)', display: 'grid', gap: 'var(--space-6)' }}>
      <h1 className="bpm-h1">Tokens</h1>

      <Section title="BRAND & SEMANTIC COLORS">
        <ul style={{ listStyle: 'none', padding: '0', margin: '0', display: 'grid', gap: 'var(--space-3)' }}>
          {COLOR_SWATCHES.map((c) => (
            <li key={c.name} style={{ display: 'grid', gridTemplateColumns: '2.25rem 1fr auto', gap: 'var(--space-4)', alignItems: 'center' }}>
              <span aria-hidden style={{ width: '2.25rem', height: '2.25rem', borderRadius: 'var(--radius-sm, 8px)', background: c.value, border: '1px solid var(--glass-border)' }} />
              <div>
                <div className="bpm-mono" style={{ fontSize: '0.75rem', color: 'var(--text-primary)' }}>{c.name}</div>
                {c.note && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{c.note}</div>}
              </div>
              <code className="bpm-mono" style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{c.value}</code>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="MOTION — EASINGS & DURATIONS">
        <ul style={{ listStyle: 'none', padding: '0', margin: '0', display: 'grid', gap: 'var(--space-4)' }}>
          {MOTION.map((m) => (
            <li key={m.name} style={{ display: 'grid', gap: 'var(--space-05)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                <code className="bpm-mono" style={{ fontSize: '0.75rem' }}>{m.name}</code>
                <code className="bpm-mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{m.value}</code>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{m.note}</div>
            </li>
          ))}
        </ul>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 'var(--space-5)' }}>
          <code className="bpm-mono">prefers-reduced-motion</code> pauses all of these — see{' '}
          <code className="bpm-mono">app/globals.css</code> reduced-motion block.
        </p>
      </Section>

      <Section title="SURFACES — TWO TIERS">
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: '0 0 var(--space-4)' }}>
          Materials simplify inward (DESIGN.md #9). Tier 1 carries the full glass material; Tier 2
          drops blur + shadow + rim and renders as a flat tint nested inside Tier 1.
        </p>
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <div className="glass-card" style={{ padding: 'var(--space-4)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-3)' }}>
              <code className="bpm-mono" style={{ fontSize: '0.75rem' }}>.glass-card</code>
              <span className="bpm-mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Tier 1 · radius 16</span>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0' }}>
              Backdrop blur, saturation, layered shadow, inset rim. Use for the primary card on each surface.
            </p>
            <div className="glass-card-soft" style={{ marginTop: 'var(--space-4)', padding: 'var(--space-4)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-2)' }}>
                <code className="bpm-mono" style={{ fontSize: '0.7rem' }}>.glass-card-soft</code>
                <span className="bpm-mono" style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Tier 2 · radius 12</span>
              </div>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '0' }}>
                Flat tint + 1px border, no blur or shadow. Nest inside Tier 1 to group related content
                without restating the material. <code className="bpm-mono">.inner-card</code> kept as a
                backwards-compatible alias.
              </p>
            </div>
          </div>
          <ul style={{ listStyle: 'none', padding: '0', margin: '0', display: 'grid', gap: 'var(--space-2)' }}>
            <li style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 'var(--space-4)', fontSize: '0.75rem' }}>
              <code className="bpm-mono">--glass-bg / --glass-border</code>
              <span style={{ color: 'var(--text-muted)' }}>Tier 1 source</span>
            </li>
            <li style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 'var(--space-4)', fontSize: '0.75rem' }}>
              <code className="bpm-mono">--glass-soft-bg / --glass-soft-border</code>
              <span style={{ color: 'var(--text-muted)' }}>Tier 2 source (alias of --inner-card-*)</span>
            </li>
          </ul>
        </div>
      </Section>

      <Section title="CORNER RADII — NEVER EXCEED 16px ON RECTANGLES">
        <ul style={{ listStyle: 'none', padding: '0', margin: '0', display: 'grid', gap: 'var(--space-3)' }}>
          {RADII.map(([tok, val, note]) => (
            <li key={tok} style={{ display: 'grid', gridTemplateColumns: '3.5rem 1fr auto', gap: 'var(--space-4)', alignItems: 'center' }}>
              <span aria-hidden style={{ width: '3.5rem', height: '2rem', borderRadius: val, background: 'var(--accent)', opacity: 0.2, border: '1px solid var(--accent)' }} />
              <div style={{ fontSize: '0.75rem' }}>
                <code className="bpm-mono">{tok}</code>
                <span style={{ color: 'var(--text-secondary)' }}> — {note}</span>
              </div>
              <code className="bpm-mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{val}</code>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="SPACING">
        <ul style={{ listStyle: 'none', padding: '0', margin: '0', display: 'grid', gap: 'var(--space-2)' }}>
          {SPACING.map((row) => (
            <li key={row[0]} style={{ display: 'grid', gridTemplateColumns: '4rem 1fr auto', gap: 'var(--space-4)', alignItems: 'center' }}>
              <span aria-hidden style={{ height: '0.5rem', width: row[1], background: 'var(--accent)', opacity: 0.4, borderRadius: 2 }} />
              <code className="bpm-mono" style={{ fontSize: '0.75rem' }}>{row[0]}</code>
              <span className="bpm-mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                {row[1]}{row[2] ? ` — ${row[2]}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="TYPE SCALE">
        <ul style={{ listStyle: 'none', padding: '0', margin: '0', display: 'grid', gap: 'var(--space-4)' }}>
          {TYPE.map((t) => (
            <li key={t.tok}>
              <div style={{ fontSize: t.size, fontWeight: t.weight, lineHeight: 1.25 }}>{t.sample}</div>
              <code className="bpm-mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{t.tok}</code>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="SECTION LABEL">
        <p className="bpm-section-label">UPCOMING SESSION</p>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 'var(--space-3)' }}>
          Uppercase, bold, <code className="bpm-mono">letter-spacing: 0.1em</code>, colored{' '}
          <code className="bpm-mono">var(--accent)</code>. Used instead of <code className="bpm-mono">&lt;hr&gt;</code> dividers.
        </p>
      </Section>
    </main>
  );
}
