/**
 * Three logo finalists from the chat iteration (C, D, E).
 * User picked "C as primary with D's 4 tempo dots connecting into the period"
 * — that's rendered as candidate C+D. Candidate E (net + shuttle arc) kept
 * so the comparison is honest. All three are SVG-only so they scale cleanly.
 */

function Wordmark({ variant, color = 'var(--text-primary)' }: { variant: 'C' | 'CD' | 'E'; color?: string }) {
  const common = {
    fontFamily: 'var(--font-display, system-ui)',
    fontWeight: 800,
    fontSize: '4rem',
    lineHeight: 1,
    letterSpacing: '-0.04em',
    color,
  } as const;

  if (variant === 'C') {
    return <span style={common}>bpm<span style={{ color: 'var(--accent)' }}>.</span></span>;
  }
  if (variant === 'CD') {
    return (
      <span style={common}>
        bpm
        <span aria-hidden style={{ display: 'inline-flex', alignItems: 'flex-end', gap: '0.08em', marginLeft: '0.02em' }}>
          <span style={{ display: 'inline-block', width: '0.12em', height: '0.12em', borderRadius: '50%', background: 'var(--accent)', opacity: 0.32 }} />
          <span style={{ display: 'inline-block', width: '0.16em', height: '0.16em', borderRadius: '50%', background: 'var(--accent)', opacity: 0.55 }} />
          <span style={{ display: 'inline-block', width: '0.20em', height: '0.20em', borderRadius: '50%', background: 'var(--accent)', opacity: 0.78 }} />
          <span style={{ display: 'inline-block', width: '0.24em', height: '0.24em', borderRadius: '50%', background: 'var(--accent)' }} />
        </span>
      </span>
    );
  }
  // Candidate E — net + shuttle arc
  return (
    <span style={{ ...common, display: 'inline-flex', alignItems: 'center', gap: '0.3em' }}>
      <svg aria-hidden width="1.1em" height="1.1em" viewBox="0 0 64 64" style={{ display: 'block' }}>
        <line x1="4"  y1="50" x2="60" y2="50" stroke="currentColor" strokeWidth="2" opacity="0.35" />
        {Array.from({ length: 7 }).map((_, i) => (
          <line key={i} x1={8 + i * 8} y1="42" x2={8 + i * 8} y2="50" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
        ))}
        <path d="M 6 44 Q 32 8 58 44" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeDasharray="3 5" />
        <circle cx="58" cy="44" r="3.5" fill="var(--accent)" />
      </svg>
      <span>bpm</span>
    </span>
  );
}

function ContextTile({
  label,
  bg,
  children,
  radius = 'var(--radius-xl, 16px)',
}: {
  label: string;
  bg: string;
  children: React.ReactNode;
  radius?: string;
}) {
  return (
    <div style={{ display: 'grid', gap: '0.35rem' }}>
      <div
        style={{
          background: bg,
          borderRadius: radius,
          border: '1px solid var(--glass-border)',
          padding: '2rem 1rem',
          display: 'grid',
          placeItems: 'center',
          minHeight: '8rem',
        }}
      >
        {children}
      </div>
      <code className="bpm-mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{label}</code>
    </div>
  );
}

function CandidateRow({ title, description, variant, selected }: { title: string; description: string; variant: 'C' | 'CD' | 'E'; selected?: boolean }) {
  return (
    <section style={{ display: 'grid', gap: '0.5rem' }}>
      <header style={{ display: 'flex', gap: '0.75rem', alignItems: 'baseline' }}>
        <h2 className="bpm-section-label" style={{ color: selected ? 'var(--accent)' : 'var(--text-muted)' }}>{title}</h2>
        {selected && (
          <span className="pill-paid" style={{ fontSize: '0.65rem' }}>user pick</span>
        )}
      </header>
      <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{description}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '0.75rem', marginTop: '0.5rem' }}>
        <ContextTile label="01 · Dark (primary)" bg="#100F0F">
          <Wordmark variant={variant} color="#e2e8f0" />
        </ContextTile>
        <ContextTile label="02 · Light (primary)" bg="#FAF8F5">
          <Wordmark variant={variant} color="#1a2332" />
        </ContextTile>
        <ContextTile label="03 · Knockout on green" bg="#16a34a">
          <Wordmark variant={variant} color="#FAF8F5" />
        </ContextTile>
        <ContextTile label="04 · App icon (120px)" bg="#100F0F" radius="28px">
          <div style={{ transform: 'scale(0.45)', transformOrigin: 'center' }}>
            <Wordmark variant={variant} color="#4ade80" />
          </div>
        </ContextTile>
      </div>
    </section>
  );
}

export default function LogoPage() {
  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '2rem 1rem', display: 'grid', gap: '1.75rem' }}>
      <div>
        <h1 className="bpm-h1">Logo</h1>
        <p className="bpm-body" style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
          Three finalists from the chat iteration. Each shown in 4 contexts: dark primary, light primary,
          knockout-on-green, and app icon.
        </p>
      </div>

      <CandidateRow
        title="CANDIDATE C+D — WORDMARK + TEMPO DOTS"
        description='"bpm" with 4 tempo dots crescendoing into the period (0.32 → 0.55 → 0.78 → 1.0 opacity, 0.12 → 0.24em sizes). Scales as ems so it holds from 20px to 96px.'
        variant="CD"
        selected
      />

      <CandidateRow
        title="CANDIDATE C — WORDMARK ONLY"
        description='"bpm." Simplest ownable mark, zero IP risk. Accented period in court-green.'
        variant="C"
      />

      <CandidateRow
        title="CANDIDATE E — NET + SHUTTLE ARC"
        description="Adds sport reference: doubles-court net with the shuttle's dotted trajectory landing at the far side."
        variant="E"
      />

      <section className="glass-card" style={{ padding: '1.25rem', display: 'grid', gap: '0.5rem' }}>
        <h2 className="bpm-section-label">BUNDLE SVGs</h2>
        <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
          The design bundle also includes production-ready SVGs at{' '}
          <code className="bpm-mono">public/brand/bpm-logo.svg</code> and{' '}
          <code className="bpm-mono">public/brand/shuttlecock.svg</code>. Reach for these over redrawing.
        </p>
        <div style={{ display: 'flex', gap: '2rem', alignItems: 'center', marginTop: '0.5rem' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bpm/brand/bpm-logo.svg" alt="BPM wordmark" style={{ height: '3rem' }} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bpm/brand/shuttlecock.svg" alt="BPM shuttlecock glyph" style={{ height: '3rem' }} />
        </div>
      </section>
    </main>
  );
}
