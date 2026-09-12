/**
 * Components specimen — 1:1 with docs/design-system/preview/* specimens and
 * ui_kits/bpm-app/components.jsx. Class tokens in globals.css carry both shape
 * and color so consumers call them bare (no Tailwind companions needed).
 */

import CardHeader from '@/components/primitives/CardHeader';
import StatusBadge from '@/components/primitives/StatusBadge';
import AIBadge from '@/components/primitives/AIBadge';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';

/**
 * One specimen on one ground.
 *
 * `forceLight` stamps `data-theme="light"`, which works for the 75 light rules
 * in globals.css written as BARE attribute selectors: `[data-theme="light"]`
 * matches the wrapper itself, so it genuinely re-declares those tokens and
 * palette-class overrides for its own subtree.
 *
 * SIX ARE NOT BARE. They are anchored on `html:root[data-theme="light"]`, and
 * a wrapper can never match them — html cannot be a descendant of the div
 * wrapping it. The same is true of the theme-agnostic `html:root` field block,
 * which re-tunes --highlight-* and --list-* upward for the coloured grounds.
 * Left alone, the pane showed those two specimens at the pre-field values and
 * quietly misrepresented them. `.design-theme-pane` is on the pane so that
 * block declares them here too; see the note at its definition in globals.css.
 *
 * THE REVERSE DOES NOT WORK, and that is the thing to know before touching
 * this file. There is no `[data-theme="dark"]` block anywhere in globals.css:
 * dark is declared on `:root` and light is an OVERRIDE of it. So a
 * `data-theme="dark"` wrapper declares nothing at all, and inside a page the
 * viewer has toggled to light it renders light while claiming to be dark —
 * a specimen that lies, which is worse than the missing variant #77 was
 * opened about. Hence one forced direction and one honest label.
 *
 * The pane paints `--page-bg` itself. That is load-bearing, not decoration:
 * without it the light specimen sits on the dark page ground and every
 * contrast judgement made from it is wrong in exactly the direction this page
 * exists to check.
 */
function ThemePane({ forceLight, children }: { forceLight?: boolean; children: React.ReactNode }) {
  return (
    <div
      className="design-theme-pane"
      {...(forceLight ? { 'data-theme': 'light' } : {})}
      style={{
        /* The field gradient, not a flat fill. `.court-bg` paints --field-home
           behind the real page, and .glass-card is 5-8% white over a backdrop
           filter — so that gradient IS most of a card's visible colour, and a
           flat fill would composite every specimen against a ground it never
           actually sits on.
           The base layer is --page-bg and NOT --field-base, which would be the
           obvious choice and is wrong: --field-base is declared as
           `var(--page-bg)` on :root, and a custom property's var() is
           substituted where it is DECLARED, not where it is used. It therefore
           inherits into this pane as the already-resolved dark #100F0F no
           matter what data-theme the pane carries, and the light pane renders
           a light gradient over a dark ground. --page-bg is a literal in both
           theme blocks, so it follows the pane. Measured, not assumed. */
        background: 'var(--field-home), var(--page-bg)',
        color: 'var(--text-primary)',
        border: '1px solid var(--divider)',
        borderRadius: 'var(--radius-lg, 12px)',
        padding: 'var(--space-4)',
        display: 'grid',
        gap: 'var(--space-3)',
      }}
    >
      <span
        className="bpm-mono"
        style={{
          fontSize: 'var(--fs-2xs)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}
      >
        {forceLight ? 'light' : 'current theme'}
      </span>
      <div className="glass-card" style={{ padding: 'var(--space-6)', display: 'grid', gap: 'var(--space-4)' }}>
        {children}
      </div>
    </div>
  );
}

/**
 * Every specimen renders twice: once on the page's own theme, once forced to
 * light.
 *
 * The layout already carries a ThemeToggle, so light mode was reachable — but
 * one theme at a time, which meant proving parity required toggling and then
 * remembering what the other half had looked like. A light-mode bug you have
 * to remember to go looking for is one that reaches production, which is what
 * #77 was opened about.
 *
 * Doing this in `Row` rather than per-component is deliberate. The original
 * complaint was that SOME specimens had a light variant and the rest did not,
 * and a list of which ones get both is a list that drifts. Here a specimen
 * cannot be added without one.
 *
 * Stacked, not side by side: halving the column to ~340px reflows the
 * field-card and icon grids, and a specimen shown at a width it never occupies
 * in the app is its own kind of wrong answer.
 */
function Row({ title, caption, children }: { title: string; caption?: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <h2 className="bpm-section-label">{title}</h2>
      <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
        <ThemePane>{children}</ThemePane>
        <ThemePane forceLight>{children}</ThemePane>
      </div>
      {caption && <p className="bpm-caption" style={{ color: 'var(--text-muted)', margin: '0' }}>{caption}</p>}
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

/* The seven field card materials. `tone` is the value colour — the semantic
   cards recolour their number, the base and pick cards do not. */
const FIELD_CARDS: { cls: string; label: string; value: string; tone: string }[] = [
  { cls: '',           label: 'BASE',    value: '2.6',   tone: 'var(--fcard-title)' },
  { cls: 'is-pick',    label: 'THE PICK', value: '24 lb', tone: 'var(--btn-primary-text)' },
  { cls: 'is-good',    label: 'DONE',    value: '3/4',   tone: 'var(--accent)' },
  { cls: 'is-wait',    label: 'WAITLIST', value: '#2',   tone: 'var(--accent-amber)' },
  { cls: 'is-full',    label: 'FULL',    value: '12/12', tone: 'var(--orange, #fb923c)' },
  { cls: 'is-error',   label: 'OWING',   value: '$8.50', tone: 'var(--color-red)' },
  { cls: 'is-locked',  label: 'PRIVATE', value: '—',     tone: 'var(--text-muted)' },
];

export default function ComponentsPage() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 'var(--space-8) var(--space-5)', display: 'grid', gap: 'var(--space-6)' }}>
      <div>
        <h1 className="bpm-h1">Components</h1>
        <p className="bpm-body" style={{ color: 'var(--text-secondary)', marginTop: 'var(--space-1)' }}>
          Canonical renderings of each component, mirroring{' '}
          <code className="bpm-mono">docs/design-system/preview/*</code>.
        </p>
        <p className="bpm-caption" style={{ color: 'var(--text-muted)', marginTop: 'var(--space-2)' }}>
          Every specimen is shown twice: on the page&apos;s own theme, and forced to light. Palette
          colours are theme-aware through per-class{' '}
          <code className="bpm-mono">[data-theme=&quot;light&quot;]</code> overrides rather than tokens, so a
          component can be correct in one theme and unreadable in the other — and jsdom computes no
          stylesheet, so nothing in the test suite can see the difference. Leave the toggle on dark
          to read this page as a comparison.
        </p>
      </div>

      {/* ── Buttons — 4 states per specimen/12 ─────────────────────────── */}
      <Row title="PRIMARY BUTTON" caption="Per preview/12-button-primary.html — 4 states: default · hover · pressed · disabled. Hover = brightness(1.08). Pressed = scale(0.97) + brightness(0.92). Disabled = opacity 0.45.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-4)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <StateLabel>Default</StateLabel>
            <button type="button" className="btn-primary">Sign Up</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <StateLabel>Hover</StateLabel>
            <button type="button" className="btn-primary" style={{ filter: 'brightness(1.08)' }}>Sign Up</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <StateLabel>Pressed</StateLabel>
            <button type="button" className="btn-primary" style={{ transform: 'scale(0.97)', filter: 'brightness(0.92)' }}>Sign Up</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <StateLabel>Disabled</StateLabel>
            <button type="button" className="btn-primary" disabled aria-disabled style={{ opacity: 0.45, cursor: 'not-allowed' }}>Signing up…</button>
          </div>
        </div>
      </Row>

      <Row title="GHOST BUTTON" caption="Per preview/13-button-ghost.html — lower-emphasis pair to primary. Same shape, glass tint only.">
        <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          <button type="button" className="btn-ghost">Cancel</button>
          <button type="button" className="btn-ghost" style={{ filter: 'brightness(1.08)' }}>Cancel</button>
          <button type="button" className="btn-ghost" disabled style={{ opacity: 0.45 }}>Cancel</button>
        </div>
      </Row>

      {/* ── Glass card — per specimen/14 ───────────────────────────────── */}
      <Row title="GLASS CARD" caption="Per preview/14-glass-card.html — padding 20, radius 16, backdrop blur + 180% saturation, inset rim + layered shadow. Hover = translateY(-2px).">
        <div className="glass-card" style={{ padding: 'var(--space-5)' }}>
          <p className="bpm-section-label" style={{ color: 'var(--text-muted)' }}>UPCOMING SESSION</p>
          <p style={{ margin: 'var(--space-3) 0 0', fontFamily: 'var(--font-display)', fontSize: '1.125rem', fontWeight: 600, letterSpacing: '-0.01em' }}>Thursday, April 18</p>
          <p style={{ margin: '0', fontFamily: 'var(--font-display)', fontSize: '1.125rem', fontWeight: 600, letterSpacing: '-0.01em' }}>7:00 PM</p>
          <p style={{ margin: 'var(--space-1) 0 0', color: 'var(--text-secondary)', fontSize: '0.8125rem', opacity: 0.72 }}>~$8.50 per person</p>

          <div className="glass-card-soft" style={{ marginTop: 'var(--space-4)', padding: 'var(--space-4)' }}>
            <p style={{ margin: '0', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              Nested: <code className="bpm-mono">.glass-card-soft</code> flattens to transparent tint inside glass. Materials simplify inward.
            </p>
          </div>
        </div>
      </Row>

      {/* ── Glass card — soft (Tier 2) ─────────────────────────────────── */}
      <Row title="GLASS CARD — SOFT" caption="Tier 2 surface. Flat tint + 1px border, no blur or shadow, radius 12. Nest inside .glass-card to group related content without restating the material. .inner-card is a backwards-compatible alias.">
        <div className="glass-card-soft" style={{ padding: 'var(--space-4)' }}>
          <p className="bpm-section-label" style={{ color: 'var(--text-muted)' }}>RECOVERY PIN</p>
          <p style={{ margin: 'var(--space-2) 0 0', fontSize: '0.875rem' }}>4-digit PIN saved</p>
          <p style={{ margin: 'var(--space-1) 0 0', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
            Used for <code className="bpm-mono">.inner-card</code> + nested groupings under the primary glass surface — settings rows, PIN editor, list items inside an admin card.
          </p>
        </div>
      </Row>

      {/* ── Status banners — 3 tones per specimen/15 ───────────────────── */}
      <Row title="STATUS BANNERS" caption="Per preview/15-status-banners.html — radius 12, padding 12×14, icon 22, title 13/600, body 12 @ 0.72. Three tones: green (success) · orange (waitlist / warning) · red (error).">
        <div className="status-banner-green">
          <span className="material-icons" aria-hidden style={{ fontSize: 22, color: 'var(--accent)' }}>check_circle</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)' }}>Signed up — see you Thursday</div>
            <div style={{ fontSize: 12, opacity: 0.72, marginTop: 'var(--space-05)' }}>Paid · PIN saved</div>
          </div>
        </div>
        <div className="status-banner-orange">
          <span className="material-icons" aria-hidden style={{ fontSize: 22, color: 'var(--sev-med-text)' }}>watch_later</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--sev-med-text)' }}>You&apos;re on the waitlist</div>
            <div style={{ fontSize: 12, opacity: 0.72, marginTop: 'var(--space-05)' }}>Position #2 of 3</div>
          </div>
        </div>
        <div className="status-banner-red">
          <span className="material-icons" aria-hidden style={{ fontSize: 22, color: 'var(--sev-crit-text)' }}>error</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--sev-crit-text)' }}>Sign-up is closed</div>
            <div style={{ fontSize: 12, opacity: 0.72, marginTop: 'var(--space-05)' }}>Session filled at 6:30 PM</div>
          </div>
        </div>
      </Row>

      {/* ── Pills — per specimen/16 ─────────────────────────────────────── */}
      <Row title="PILLS" caption="Per preview/16-pills.html + components.jsx Pill — inline-flex, padding 4×12, radius 100, 11/600/0.04em/line-height 1. With icon: left padding 9, icon 13.">
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <span className="pill-paid">Paid</span>
          <span className="pill-unpaid">Unpaid</span>
          <span className="pill-waitlist">Waitlist</span>
          <span className="pill-admin">Admin</span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
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
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
            <StateLabel>Default</StateLabel>
            <input name="demo-default" autoComplete="off" type="text" placeholder="Enter your name" style={{ flex: 1 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
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
          <div className="list-header-green" style={{ padding: 'var(--space-3) var(--space-5)', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Active · 8 of 12
          </div>
          <div style={{ padding: 'var(--space-4) var(--space-5)', fontSize: '0.875rem' }}>Alice · Bob · Carol …</div>
          <div className="list-header-amber" style={{ padding: 'var(--space-3) var(--space-5)', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Waitlist · 3
          </div>
          <div style={{ padding: 'var(--space-4) var(--space-5)', fontSize: '0.875rem' }}>Dave · Eve · Frank</div>
        </div>
      </Row>

      {/* ── Player highlight rows ──────────────────────────────────────── */}
      <Row title="PLAYER HIGHLIGHT ROWS (SELF)">
        <div className="player-highlight-green" style={{ padding: 'var(--space-4) var(--space-5)', borderRadius: 'var(--radius-sm, 8px)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>1. Grant <span style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>(you)</span></span>
          <span className="pill-paid">Paid</span>
        </div>
        <div className="player-highlight-amber" style={{ padding: 'var(--space-4) var(--space-5)', borderRadius: 'var(--radius-sm, 8px)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>W1. Dave <span style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>(you · waitlisted)</span></span>
          <span className="pill-waitlist">Waitlist</span>
        </div>
      </Row>

      {/* ── Iconography — per specimen/23 ──────────────────────────────── */}
      <Row title="ICONOGRAPHY — MATERIAL SYMBOLS ROUNDED" caption="Per preview/23-material-icons.html — Rounded only, 18–24px, semantic color per state. Never mix weights.">
        <div style={{ display: 'flex', gap: 'var(--space-6)', flexWrap: 'wrap', alignItems: 'center' }}>
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
            <div key={i.name} style={{ display: 'grid', placeItems: 'center', gap: 'var(--space-1)' }}>
              <span className="material-icons" aria-hidden style={{ fontSize: 24, color: i.color }}>{i.name}</span>
              <code className="bpm-mono" style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{i.name}</code>
            </div>
          ))}
        </div>
      </Row>

      {/* ── Standardization primitives (live components, not specimens) ──── */}
      <Row title="STANDARDIZATION PRIMITIVES" caption="The shared composition primitives from components/primitives/. These render the real components, so this is the canonical visual reference — CardHeader (two-tier header spec), StatusBadge (accent/muted/phase), AIBadge (provenance), ErrorState + EmptyState (legible-fail).">
        <CardHeader
          icon="trending_up"
          title="Card header"
          subtitle="icon + bpm-h3 title + --fs-sm subtitle"
          badge={<StatusBadge>Beta</StatusBadge>}
        />
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
          <StatusBadge>Live</StatusBadge>
          <StatusBadge variant="muted">Coming soon</StatusBadge>
          <StatusBadge variant="phase" tone="accent">Refine</StatusBadge>
          <StatusBadge variant="phase" tone="amber">Switch</StatusBadge>
        </div>
        <ErrorState message="Couldn't load — refresh to try again" />
        <EmptyState>No data yet</EmptyState>
      </Row>

      {/* ── AI provenance ─────────────────────────────────────────────────
          Its own row rather than a fifth StatusBadge chip: every StatusBadge
          variant answers "what state is this in", and this one answers "where
          did this text come from". Shown ON a glass card because that is the
          only place it appears, and because the pairing IS the spec now — the
          card is deliberately unmarked and the badge carries the rainbow
          alone. */}
      <Row
        title="AI PROVENANCE"
        caption="AIBadge marks model-written text. The conic rim (--ai-rim) is defined once in globals.css and painted as a masked ::before on .badge-ai, because a conic gradient cannot be a border-color. The surface it sits on stays an ordinary glass-card: the card wore this same rim until 2026-08-27, which spent the loudest device in the system on a footnote."
      >
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
          <AIBadge label="AI generated">AI</AIBadge>
          <AIBadge label="AI generated">Beta AI</AIBadge>
        </div>
        <div
          className="glass-card"
          style={{ padding: 'var(--space-4) var(--space-5)', display: 'flex', alignItems: 'flex-start', gap: 'var(--space-4)' }}
        >
          <span style={{ flexShrink: 0, marginTop: 'var(--space-05)' }}>
            <AIBadge label="AI generated">AI</AIBadge>
          </span>
          <p style={{ margin: '0', fontSize: 'var(--fs-lg)', lineHeight: 1.45, flex: 1, minWidth: 0 }}>
            In place: the badge leads, and is the only AI marker on the card.
          </p>
        </div>
      </Row>

      {/* ── Field card materials ──────────────────────────────────────────
          Shipped behind NEXT_PUBLIC_FLAG_VISUAL_FIELDS, which retired on
          2026-09-10; this is now simply how a .glass-card renders. There is no
          longer a flag to toggle for a before/after. */}
      <Row
        title="FIELD CARD MATERIALS"
        caption="Seven states on one material, at --radius-3xl (30px). Two rules the CSS cannot enforce, so review has to: at most ONE .is-pick per screen (two solid greens and neither reads as the answer), and semantic fills stay rare (three at once means the screen has stopped communicating). Locked is the only one that isn't glass — dropping the backdrop filter is what makes private data read as inert rather than merely dim."
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(9.5rem, 1fr))', gap: 'var(--space-4)' }}>
          {FIELD_CARDS.map((c) => (
            <div key={c.cls || 'base'} className={`glass-card ${c.cls}`} style={{ padding: 'var(--space-4)' }}>
              <p className="bpm-section-label" style={{ color: 'var(--fcard-label)' }}>{c.label}</p>
              <p style={{ margin: 'var(--space-4) 0 0', font: '600 var(--fs-stat)/1 var(--font-display)', letterSpacing: '-0.03em', color: c.tone }}>
                {c.value}
              </p>
              <p className="bpm-mono" style={{ margin: 'var(--space-3) 0 0', fontSize: 'var(--fs-2xs)', color: 'var(--fcard-footnote)' }}>
                {c.cls || '.glass-card'}
              </p>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', marginTop: 'var(--space-1)' }}>
          <button type="button" className="ink-button" style={{ padding: 'var(--space-4) var(--space-5)', font: '600 var(--fs-md) var(--font-sans)' }}>
            Ink button
          </button>
          <span className="bpm-caption">
            <code className="bpm-mono">--ink-button</code> is #131313 in <em>both</em> themes — the constant that makes the direction recognisable.
          </span>
        </div>
      </Row>
    </main>
  );
}
