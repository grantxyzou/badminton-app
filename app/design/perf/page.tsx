/**
 * Mirrors design-system bundle v2 card 26 (perf-audit) — findings re-tiered
 * for an iPhone 15 / Pixel 8-class hardware floor (A16/A17 / Tensor G3).
 * Most "critical on older hardware" items are downgraded; two remain.
 *
 * Light-mode legibility fix (v3): severity pill text, inline <Code> chips,
 * and `.fix` callout body all consume theme-adaptive --sev-*-text tokens
 * (defined in globals.css) so colors flip darker on cream.
 */

type Severity = 'crit' | 'high' | 'med' | 'low' | 'good';

const SEV_COLORS: Record<Severity, { bg: string; border: string; text: string; label: string }> = {
  // Tinted fills are low-alpha so they work in both themes; text colors
  // flip to darker hues in light mode via --sev-*-text tokens (globals.css).
  crit: { bg: 'rgba(239,68,68,0.18)',  border: 'rgba(239,68,68,0.4)',  text: 'var(--sev-crit-text)', label: 'CRIT' },
  high: { bg: 'rgba(251,146,60,0.18)', border: 'rgba(251,146,60,0.4)', text: 'var(--sev-high-text)', label: 'HIGH' },
  med:  { bg: 'rgba(251,191,36,0.18)', border: 'rgba(251,191,36,0.4)', text: 'var(--sev-med-text)',  label: 'MED' },
  low:  { bg: 'rgba(96,165,250,0.15)', border: 'rgba(96,165,250,0.35)', text: 'var(--sev-low-text)',  label: 'LOW' },
  good: { bg: 'rgba(74,222,128,0.15)', border: 'rgba(74,222,128,0.4)', text: 'var(--sev-good-text)', label: 'OK' },
};

type Finding = {
  sev: Severity;
  title: string;
  body: React.ReactNode;
  file?: string;
  fix: React.ReactNode;
};

const CRITICAL: Finding[] = [
  {
    sev: 'low',
    title: 'Backdrop-filter proliferation',
    body: (<><b>Downgraded for iPhone 15+.</b> A16/A17 and Tensor G3 handle stacked <Code>backdrop-filter</Code> without measurable frame drops up to ~5 concurrent layers. Ship the glass hierarchy as-is.</>),
    file: 'globals.css · .glass-card · .btn-primary · .nav-glass',
    fix: (<>No action. Soft guidance: if a single screen stacks <b>more than 5 blur layers</b>, tier it (modals 22px, cards 10–14px, pills static).</>),
  },
  {
    sev: 'high',
    title: 'filter: blur() + mix-blend-mode on animating elements',
    body: (<><b>Still worth fixing — even on A17.</b> Combining <Code>filter: blur()</Code> with <Code>mix-blend-mode</Code> on animating blobs forces the compositor into a slow path (non-composited repaint every frame) regardless of GPU class. It's the #1 thermal cause and shows up as sustained ~8–12% extra battery draw over a 10-min session.</>),
    file: 'app/globals.css (pre-v2: .aurora-blob-1/2/3)',
    fix: (<><b className="bpm-mono" style={{ color: 'var(--accent)' }}>Done on this branch.</b> The live aurora has been swapped to the <Code>docs/design-system/aurora-bg.css</Code> pattern: pre-blurred radial gradients, no <Code>filter</Code>, no <Code>mix-blend-mode</Code>, transform-only animation, <Code>contain: strict</Code>, <Code>prefers-reduced-transparency</Code> kill-switch.</>),
  },
  {
    sev: 'med',
    title: 'Infinite animations without IntersectionObserver',
    body: (<><b>Battery-only concern on modern hardware.</b> iOS 17+ and Chrome aggressively throttle off-screen / backgrounded animations, so frame-rate cost is near zero. On-screen continuous motion still draws power but background-app throttling makes this "good hygiene," not urgent.</>),
    file: 'ShuttleLoader.tsx · globals.css shimmer',
    fix: (<>Add <Code>animation-play-state: paused</Code> on loaders once their IntersectionObserver entry is out of view. Polish pass.</>),
  },
  {
    sev: 'low',
    title: 'will-change overuse',
    body: (<><b>Largely a non-issue on iPhone 15+.</b> VRAM budget is generous enough that promoting 20+ elements to GPU layers won't OOM. Best practice is to keep the hint on <i>actively animating</i> elements only, but no visible impact expected.</>),
    file: 'scattered',
    fix: (<>Lint rule idea: flag <Code>will-change</Code> on any selector not driven by <Code>@keyframes</Code>. No cleanup needed.</>),
  },
];

const SECONDARY: Finding[] = [
  {
    sev: 'low',
    title: 'Multi-layer box-shadows',
    body: <b>Fine on A16+.</b>,
    fix: <>Shadows paint once at layout, cached. Keep the aesthetic layering.</>,
  },
  {
    sev: 'high',
    title: 'Google Fonts network weight',
    body: (<><b>Network cost is hardware-independent.</b> 6 families × multiple weights = 400–800 KB before first paint. On a first launch over 4G/5G this is the visible TTI bottleneck, not GPU.</>),
    file: 'design-system bundle (3 font pairings explored)',
    fix: (<><b className="bpm-mono" style={{ color: 'var(--accent)' }}>Locked.</b> Bundle v2 commits to Space Grotesk + JetBrains Mono only (~80 KB subset). <Code>font-display: swap</Code> and preload the 2 above-the-fold weights. Live-surface migration pending.</>),
  },
  {
    sev: 'med',
    title: 'SVG court lines / arcs as animated DOM',
    body: <>Some backgrounds animate <Code>stroke-dashoffset</Code>/<Code>offset-distance</Code>, which invalidates the SVG layer every frame on older Safari.</>,
    fix: <>Bake court markings into a static PNG/SVG <Code>background-image</Code>. Only the shuttle arc stays animated — and only when on-screen.</>,
  },
  {
    sev: 'med',
    title: 'Material Icons full webfont',
    body: (<><b>Network-bound, so hardware-independent.</b> ~100 KB icon font loaded to use ~20 glyphs.</>),
    file: 'app/layout.tsx (Google icon font link)',
    fix: <>Switch to <Code>material-symbols</Code> variable subset or inline SVG sprites. Saves 60–80 KB.</>,
  },
];

const ALREADY_STRONG: string[] = [
  'Aurora uses transform-only animation with pre-blurred gradients (post-v2).',
  'prefers-reduced-motion honored everywhere (aurora, motion, loader).',
  'prefers-reduced-transparency hook added (iOS low-power mode).',
  'content-visibility: auto + contain: strict on aurora container.',
  'GlassPhysics skips touch devices; DatePicker scroll is RAF-coalesced.',
  'Splash has a 5s failsafe so a stalled hydration cannot loop the GPU.',
  'Tokens are CSS variables — theme switch without re-render.',
];

const BUDGET: Array<[string, string]> = [
  ['backdrop-filter layers / screen', '≤ 5'],
  ['blur radius (cards)',             '≤ 18px'],
  ['blur radius (modals)',            '≤ 32px'],
  ['font families',                   '≤ 2'],
  ['font weights loaded',             '≤ 4'],
  ['total font + icon payload',       '≤ 150 KB'],
  ['first-paint critical CSS',        '≤ 40 KB'],
  ['mix-blend-mode on animation',     '0 (never)'],
  ['filter: blur() on animation',     '0 (never)'],
  ['target frame rate',               '120 Hz ProMotion'],
];

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code
      className="bpm-mono"
      style={{
        fontSize: '0.85em',
        padding: '1px 5px',
        borderRadius: 3,
        background: 'rgba(74,222,128,0.10)',
        color: 'var(--sev-code-text)',  // pastel green (dark) → court-green-dark (light)
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </code>
  );
}

function SevPill({ sev }: { sev: Severity }) {
  const s = SEV_COLORS[sev];
  return (
    <span className="bpm-mono" style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em', padding: '3px 8px', borderRadius: 5, background: s.bg, border: `1px solid ${s.border}`, color: s.text }}>
      {s.label}
    </span>
  );
}

function FindingCard({ f }: { f: Finding }) {
  return (
    <div className="glass-card" style={{ padding: '1rem 1.25rem', display: 'grid', gap: '0.6rem' }}>
      <h3 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <SevPill sev={f.sev} />
        <span>{f.title}</span>
      </h3>
      <p style={{ margin: 0, fontSize: '0.8125rem', lineHeight: 1.6, color: 'var(--text-secondary)' }}>{f.body}</p>
      {f.file && (
        <code
          className="bpm-mono"
          style={{
            fontSize: '0.7rem',
            padding: '1px 5px',
            borderRadius: 3,
            background: 'rgba(74,222,128,0.10)',
            color: 'var(--sev-code-text)',
            alignSelf: 'start',
          }}
        >
          {f.file}
        </code>
      )}
      <div
        className="bpm-mono"
        style={{
          fontSize: '0.75rem',
          lineHeight: 1.55,
          padding: '0.5rem 0.75rem',
          borderRadius: 6,
          background: 'rgba(74,222,128,0.08)',
          borderLeft: '2px solid var(--accent)',
          color: 'var(--sev-fix-text)',  // pastel green (dark) → deep-forest (light)
        }}
      >
        <span style={{ color: 'var(--accent)', fontWeight: 700 }}>→&nbsp;&nbsp;</span>{f.fix}
      </div>
    </div>
  );
}

export default function PerfAuditPage() {
  return (
    <main style={{ maxWidth: 820, margin: '0 auto', padding: '2rem 1rem', display: 'grid', gap: '1.25rem' }}>
      <div>
        <h1 className="bpm-h1">Perf audit</h1>
        <p className="bpm-body" style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
          Findings re-tiered for an <strong>iPhone 15 / Pixel 8-class (A16/A17, Tensor G3)</strong> floor.
          Modern GPUs absorb most of what would be red on older hardware. Two items remain worth fixing
          because they waste battery regardless of GPU class. Both are addressed on this branch.
        </p>
      </div>

      <div className="status-banner-green">
        {/* Single child wrapper so the banner's flex layout treats all the
            text (including inline <Code> chips) as ONE block instead of
            splitting every word/chip into its own flex item. */}
        <div style={{ fontSize: '0.8125rem', lineHeight: 1.55 }}>
          <strong>Target floor: iPhone 15 / Pixel 8.</strong> A16+ handles <Code>backdrop-filter</Code>,
          multi-layer shadows, and compositor-animated blur comfortably. Focus is on network payload and
          the <Code>filter: blur()</Code> + <Code>mix-blend-mode</Code> anti-pattern.
        </div>
      </div>

      <section style={{ display: 'grid', gap: '0.5rem' }}>
        <h2 className="bpm-section-label">CRITICAL PATH</h2>
        {CRITICAL.map((f) => <FindingCard key={f.title} f={f} />)}
      </section>

      <section style={{ display: 'grid', gap: '0.5rem' }}>
        <h2 className="bpm-section-label">SECONDARY</h2>
        {SECONDARY.map((f) => <FindingCard key={f.title} f={f} />)}
      </section>

      <section style={{ display: 'grid', gap: '0.5rem' }}>
        <h2 className="bpm-section-label" style={{ color: '#86efac' }}>ALREADY STRONG</h2>
        <div className="glass-card" style={{ padding: '1rem 1.25rem' }}>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.4rem', fontSize: '0.8125rem' }}>
            {ALREADY_STRONG.map((line) => (
              <li key={line} style={{ display: 'flex', gap: '0.5rem', color: 'var(--text-secondary)' }}>
                <span style={{ color: '#4ade80', fontWeight: 700 }}>✓</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section style={{ display: 'grid', gap: '0.5rem' }}>
        <h2 className="bpm-section-label">PERFORMANCE BUDGET</h2>
        <div className="glass-card" style={{ padding: '1rem 1.25rem' }}>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.35rem' }}>
            {BUDGET.map(([k, v]) => (
              <li key={k} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{k}</span>
                <strong style={{ color: '#86efac' }}>{v}</strong>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section style={{ display: 'grid', gap: '0.5rem' }}>
        <h2 className="bpm-section-label">ACTION LIST</h2>
        <div className="glass-card" style={{ padding: '1rem 1.25rem', display: 'grid', gap: '0.6rem', fontSize: '0.8125rem', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
          <p style={{ margin: 0 }}>
            <strong style={{ color: 'var(--accent)' }}>1.</strong> Lock one font pairing and prune the loader to ~80 KB — biggest user-perceivable win.{' '}
            <span className="pill-paid" style={{ fontSize: '0.65rem' }}>locked on branch</span>
          </p>
          <p style={{ margin: 0 }}>
            <strong style={{ color: 'var(--accent)' }}>2.</strong> Swap Material Icons full webfont for Material Symbols variable subset or SVG sprite (−60/80 KB). <em>Future branch.</em>
          </p>
          <p style={{ margin: 0 }}>
            <strong style={{ color: 'var(--accent)' }}>3.</strong> Rewrite the animated blobs to the production aurora pattern — drop <Code>filter: blur()</Code> and <Code>mix-blend-mode</Code>.{' '}
            <span className="pill-paid" style={{ fontSize: '0.65rem' }}>done on branch</span>
          </p>
          <p style={{ margin: 0 }}>
            <strong style={{ color: 'var(--accent)' }}>4.</strong> Pause loaders via IntersectionObserver when off-screen. <em>Polish.</em>
          </p>
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>
            Everything else — blur tiering, shadow layers, <Code>will-change</Code>, SVG animations — leave as-is. Target hardware absorbs it.
          </p>
        </div>
      </section>
    </main>
  );
}
