/**
 * Components specimen — 1:1 with docs/design-system/preview/* specimens and
 * ui_kits/bpm-app/components.jsx. Class tokens in globals.css carry both shape
 * and color so consumers call them bare (no Tailwind companions needed).
 */

function Row({ title, caption, children }: { title: string; caption?: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'grid', gap: '0.5rem' }}>
      <h2 className="bpm-section-label">{title}</h2>
      <div className="glass-card" style={{ padding: '1.25rem', display: 'grid', gap: '0.9rem' }}>{children}</div>
      {caption && <p className="bpm-caption" style={{ color: 'var(--text-muted)', margin: 0 }}>{caption}</p>}
    </section>
  );
}

function StateLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.6, minWidth: 84, display: 'inline-block' }}>
      {children}
    </span>
  );
}

export default function ComponentsPage() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '2rem 1rem', display: 'grid', gap: '1.25rem' }}>
      <div>
        <h1 className="bpm-h1">Components</h1>
        <p className="bpm-body" style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
          Canonical renderings of each component, mirroring{' '}
          <code className="bpm-mono">docs/design-system/preview/*</code>.
        </p>
      </div>

      {/* ── Buttons — 4 states per specimen/12 ─────────────────────────── */}
      <Row title="PRIMARY BUTTON" caption="Per preview/12-button-primary.html — 4 states: default · hover · pressed · disabled. Hover = brightness(1.08). Pressed = scale(0.97) + brightness(0.92). Disabled = opacity 0.45.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <StateLabel>Default</StateLabel>
            <button type="button" className="btn-primary">Sign Up</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <StateLabel>Hover</StateLabel>
            <button type="button" className="btn-primary" style={{ filter: 'brightness(1.08)' }}>Sign Up</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <StateLabel>Pressed</StateLabel>
            <button type="button" className="btn-primary" style={{ transform: 'scale(0.97)', filter: 'brightness(0.92)' }}>Sign Up</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <StateLabel>Disabled</StateLabel>
            <button type="button" className="btn-primary" disabled aria-disabled style={{ opacity: 0.45, cursor: 'not-allowed' }}>Signing up…</button>
          </div>
        </div>
      </Row>

      <Row title="GHOST BUTTON" caption="Per preview/13-button-ghost.html — lower-emphasis pair to primary. Same shape, glass tint only.">
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn-ghost">Cancel</button>
          <button type="button" className="btn-ghost" style={{ filter: 'brightness(1.08)' }}>Cancel</button>
          <button type="button" className="btn-ghost" disabled style={{ opacity: 0.45 }}>Cancel</button>
        </div>
      </Row>

      {/* ── Glass card — per specimen/14 ───────────────────────────────── */}
      <Row title="GLASS CARD" caption="Per preview/14-glass-card.html — padding 20, radius 16, backdrop blur + 180% saturation, inset rim + layered shadow. Hover = translateY(-2px).">
        <div className="glass-card" style={{ padding: '1rem' }}>
          <p className="bpm-section-label" style={{ color: 'var(--text-muted)' }}>UPCOMING SESSION</p>
          <p style={{ margin: '0.5rem 0 0', fontFamily: 'var(--font-display)', fontSize: '1.125rem', fontWeight: 600, letterSpacing: '-0.01em' }}>Thursday, April 18</p>
          <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '1.125rem', fontWeight: 600, letterSpacing: '-0.01em' }}>7:00 PM</p>
          <p style={{ margin: '0.25rem 0 0', color: 'var(--text-secondary)', fontSize: '0.8125rem', opacity: 0.72 }}>~$8.50 per person</p>

          <div className="inner-card" style={{ marginTop: '0.75rem', padding: '0.75rem' }}>
            <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              Nested: <code className="bpm-mono">.inner-card</code> flattens to transparent tint inside glass. Materials simplify inward.
            </p>
          </div>
        </div>
      </Row>

      {/* ── Status banners — 3 tones per specimen/15 ───────────────────── */}
      <Row title="STATUS BANNERS" caption="Per preview/15-status-banners.html — radius 12, padding 12×14, icon 22, title 13/600, body 12 @ 0.72. Three tones: green (success) · orange (waitlist / warning) · red (error).">
        <div className="status-banner-green">
          <span className="material-icons" aria-hidden style={{ fontSize: 22, color: 'var(--accent)' }}>check_circle</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)' }}>Signed up — see you Thursday</div>
            <div style={{ fontSize: 12, opacity: 0.72, marginTop: 2 }}>Paid · PIN saved</div>
          </div>
        </div>
        <div className="status-banner-orange">
          <span className="material-icons" aria-hidden style={{ fontSize: 22, color: 'var(--sev-med-text)' }}>watch_later</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--sev-med-text)' }}>You're on the waitlist</div>
            <div style={{ fontSize: 12, opacity: 0.72, marginTop: 2 }}>Position #2 of 3</div>
          </div>
        </div>
        <div className="status-banner-red">
          <span className="material-icons" aria-hidden style={{ fontSize: 22, color: 'var(--sev-crit-text)' }}>error</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--sev-crit-text)' }}>Sign-up is closed</div>
            <div style={{ fontSize: 12, opacity: 0.72, marginTop: 2 }}>Session filled at 6:30 PM</div>
          </div>
        </div>
      </Row>

      {/* ── Pills — per specimen/16 ─────────────────────────────────────── */}
      <Row title="PILLS" caption="Per preview/16-pills.html + components.jsx Pill — inline-flex, padding 4×12, radius 100, 11/600/0.04em/line-height 1. With icon: left padding 9, icon 13.">
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span className="pill-paid">Paid</span>
          <span className="pill-unpaid">Unpaid</span>
          <span className="pill-waitlist">Waitlist</span>
          <span className="pill-admin">Admin</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span className="pill-paid">
            <span className="material-icons" aria-hidden style={{ fontSize: 13 }}>check_circle</span>
            Paid
          </span>
          <span className="pill-waitlist">
            <span className="material-icons" aria-hidden style={{ fontSize: 13 }}>watch_later</span>
            Waitlist
          </span>
          <span className="pill-admin">
            <span className="material-icons" aria-hidden style={{ fontSize: 13 }}>shield</span>
            Admin
          </span>
        </div>
      </Row>

      {/* ── Input — Default / Focus / Error per specimen/17 ─────────────── */}
      <Row title="INPUT" caption="Per preview/17-inputs.html — 3 states: default · focus (green 3px ring) · error (red 3px ring). Focus ring is on the box-shadow; border recolors simultaneously.">
        <div style={{ display: 'grid', gap: '0.6rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <StateLabel>Default</StateLabel>
            <input name="demo-default" autoComplete="off" type="text" placeholder="Enter your name" style={{ flex: 1 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <StateLabel>Focus</StateLabel>
            <input
              name="demo-focus"
              autoComplete="off"
              type="text"
              defaultValue="Grant"
              style={{
                flex: 1,
                borderColor: 'rgba(74,222,128,0.55)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1), 0 0 0 3px rgba(74,222,128,0.18)',
              }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <StateLabel>Error</StateLabel>
            <input
              name="demo-error"
              autoComplete="off"
              type="text"
              defaultValue="g@"
              style={{
                flex: 1,
                borderColor: 'rgba(248,113,113,0.6)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1), 0 0 0 3px rgba(248,113,113,0.16)',
              }}
            />
          </div>
        </div>
      </Row>

      {/* ── Segment — per specimen/18 ──────────────────────────────────── */}
      <Row title="SEGMENT CONTROL" caption="Per preview/18-segment-control.html — Apple HIG · pill 100 · active tint green. Parent needs flex; children flex-1 items-center justify-center.">
        <div className="segment-control flex" role="tablist" aria-label="Player filter" style={{ width: '100%' }}>
          <button type="button" role="tab" aria-selected="true"  className="flex-1 flex items-center justify-center text-xs segment-tab-active">Active</button>
          <button type="button" role="tab" aria-selected="false" className="flex-1 flex items-center justify-center text-xs segment-tab-inactive">Waitlist</button>
          <button type="button" role="tab" aria-selected="false" className="flex-1 flex items-center justify-center text-xs segment-tab-inactive">Removed</button>
        </div>
      </Row>

      {/* ── List-row tinted headers ────────────────────────────────────── */}
      <Row title="LIST-ROW TINTED HEADERS">
        <div style={{ overflow: 'hidden', borderRadius: 'var(--radius-lg, 12px)', border: '1px solid var(--glass-border)' }}>
          <div className="list-header-green" style={{ padding: '0.5rem 1rem', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Active · 8 of 12
          </div>
          <div style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>Alice · Bob · Carol …</div>
          <div className="list-header-amber" style={{ padding: '0.5rem 1rem', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Waitlist · 3
          </div>
          <div style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>Dave · Eve · Frank</div>
        </div>
      </Row>

      {/* ── Player highlight rows ──────────────────────────────────────── */}
      <Row title="PLAYER HIGHLIGHT ROWS (SELF)">
        <div className="player-highlight-green" style={{ padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm, 8px)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>1. Grant <span style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>(you)</span></span>
          <span className="pill-paid">Paid</span>
        </div>
        <div className="player-highlight-amber" style={{ padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm, 8px)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>W1. Dave <span style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>(you · waitlisted)</span></span>
          <span className="pill-waitlist">Waitlist</span>
        </div>
      </Row>

      {/* ── Iconography — per specimen/23 ──────────────────────────────── */}
      <Row title="ICONOGRAPHY — MATERIAL SYMBOLS ROUNDED" caption="Per preview/23-material-icons.html — Rounded only, 18–24px, semantic color per state. Never mix weights.">
        <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {[
            { name: 'home',                 color: 'var(--text-primary)' },
            { name: 'group',                color: 'var(--accent)' },
            { name: 'school',               color: 'var(--text-primary)' },
            { name: 'admin_panel_settings', color: '#c4b5fd' },
            { name: 'check_circle',         color: 'var(--accent)' },
            { name: 'schedule',             color: '#60a5fa' },
            { name: 'lock',                 color: '#ef4444' },
            { name: 'celebration',          color: 'var(--accent)' },
            { name: 'watch_later',          color: '#fcd34d' },
            { name: 'error',                color: '#fca5a5' },
          ].map((i) => (
            <div key={i.name} style={{ display: 'grid', placeItems: 'center', gap: '0.25rem' }}>
              <span className="material-icons" aria-hidden style={{ fontSize: 24, color: i.color }}>{i.name}</span>
              <code className="bpm-mono" style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{i.name}</code>
            </div>
          ))}
        </div>
      </Row>
    </main>
  );
}
