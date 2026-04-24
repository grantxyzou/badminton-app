/**
 * Type system — locked per design-system bundle v3.
 *
 *   Space Grotesk   → display + headlines  (self-hosted variable, wght 300–700)
 *   IBM Plex Sans   → body + UI            (self-hosted variable, wght 100–700 + italic)
 *   JetBrains Mono  → data (PINs / $ / time) (Google Fonts subset)
 *
 * Loaded globally in `app/layout.tsx` via next/font/local + next/font/google.
 * This page exposes the pairing at display/headline/body/mono scales.
 */

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'grid', gap: '0.5rem' }}>
      <h2 className="bpm-section-label">{title}</h2>
      <div className="glass-card" style={{ padding: '1.5rem', display: 'grid', gap: '1rem' }}>{children}</div>
    </section>
  );
}

export default function TypeSystemPage() {
  return (
    <main style={{ maxWidth: 820, margin: '0 auto', padding: '2rem 1rem', display: 'grid', gap: '1.25rem' }}>
      <div>
        <h1 className="bpm-h1">Type system</h1>
        <p className="bpm-body" style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
          Locked pairing. <strong style={{ fontFamily: 'var(--font-display)' }}>Space Grotesk</strong> for
          display, <strong>IBM Plex Sans</strong> for body and UI,{' '}
          <strong style={{ fontFamily: 'var(--font-mono, monospace)' }}>JetBrains Mono</strong> for data.
          Space Grotesk + IBM Plex Sans are self-hosted variable fonts; JetBrains Mono loads from Google Fonts.
        </p>
      </div>

      <Block title="DISPLAY — SPACE GROTESK 700">
        <div style={{ fontFamily: 'var(--font-display)', fontSize: '5.25rem', fontWeight: 700, lineHeight: 0.95, letterSpacing: '-0.04em' }}>
          BPM.
        </div>
        <code className="bpm-mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          Space Grotesk · 700 · 84px · tracking −0.04em
        </code>
      </Block>

      <Block title="HEADLINE — SPACE GROTESK 700">
        <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.02em' }}>
          Thursday, April 18 · 7:00 PM
        </div>
        <code className="bpm-mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          var(--font-display) · 700 · 28px · tracking −0.02em
        </code>
      </Block>

      <Block title="BODY — IBM PLEX SANS 400 / 500">
        <p style={{ fontSize: '0.9375rem', lineHeight: 1.6, margin: 0 }}>
          Sign up to claim your spot at this week's casual session. Twelve players on court,
          waitlist open once we're full. Your share of court + shuttles is about{' '}
          <span className="bpm-mono">~$8.50</span>.
        </p>
        <p style={{ fontSize: '0.9375rem', lineHeight: 1.6, margin: 0, color: 'var(--text-secondary)' }}>
          <em>Italic accents use the italic variable TTF</em> — same family, genuine italic, not
          synthesized slant.
        </p>
        <code className="bpm-mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          IBM Plex Sans · 400 · 15px · line-height 1.6
        </code>
      </Block>

      <Block title="MONO MOMENTS — JETBRAINS MONO">
        <div className="bpm-mono" style={{ fontSize: '1.125rem', fontVariantNumeric: 'tabular-nums', display: 'grid', gap: '0.6rem' }}>
          <div>PIN  <strong style={{ letterSpacing: '0.25em' }}>0 4 2 7</strong></div>
          <div>Cost  <strong>~$8.50</strong> / person</div>
          <div>Next  <strong>Thu 2026-04-18 19:00</strong></div>
          <div>Build  <strong>bpm-next @ 3d71f58</strong></div>
        </div>
        <code className="bpm-mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          JetBrains Mono · 500 · 18px · tabular-nums
        </code>
      </Block>

      <Block title="WEIGHT LADDER — IBM PLEX SANS">
        <div style={{ display: 'grid', gap: '0.4rem' }}>
          <div style={{ fontWeight: 300, fontSize: '1.25rem' }}>300 · Light — captions, metadata.</div>
          <div style={{ fontWeight: 400, fontSize: '1.25rem' }}>400 · Regular — body copy defaults here.</div>
          <div style={{ fontWeight: 500, fontSize: '1.25rem' }}>500 · Medium — list items, chip labels.</div>
          <div style={{ fontWeight: 600, fontSize: '1.25rem' }}>600 · Semibold — card headings, nav labels.</div>
          <div style={{ fontWeight: 700, fontSize: '1.25rem' }}>700 · Bold — page titles, display moments.</div>
        </div>
        <code className="bpm-mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          IBM Plex Sans variable axis wght 100–700
        </code>
      </Block>

      <Block title="ANATOMY — COMPARE THE TWO SANS">
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Aa Bb Gg · 4 8 2 1 &amp; ? · <span className="bpm-mono" style={{ fontWeight: 500 }}>0x4A</span>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 500, lineHeight: 1.2 }}>
            Aa Bb Gg · 4 8 2 1 &amp; ? · <span className="bpm-mono" style={{ fontWeight: 500 }}>0x4A</span>
          </div>
        </div>
        <p className="bpm-caption">Top = Space Grotesk display · Bottom = IBM Plex Sans body.</p>
      </Block>

      <Block title="TOKEN REFERENCE">
        <ul className="bpm-mono" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.4rem', fontSize: '0.8rem' }}>
          <li><span style={{ color: 'var(--accent)' }}>--font-display</span>{' = '}<span style={{ color: 'var(--text-secondary)' }}>Space Grotesk, IBM Plex Sans, -apple-system, …</span></li>
          <li><span style={{ color: 'var(--accent)' }}>--font-sans</span>{' = '}<span style={{ color: 'var(--text-secondary)' }}>IBM Plex Sans, -apple-system, BlinkMacSystemFont, …</span></li>
          <li><span style={{ color: 'var(--accent)' }}>--font-mono</span>{' = '}<span style={{ color: 'var(--text-secondary)' }}>JetBrains Mono, SF Mono, Menlo, …</span></li>
        </ul>
        <p className="bpm-caption">
          Space Grotesk + IBM Plex Sans come from <code className="bpm-mono">app/fonts/*.ttf</code> via{' '}
          <code className="bpm-mono">next/font/local</code>. First paint never waits on the network.
        </p>
      </Block>
    </main>
  );
}
