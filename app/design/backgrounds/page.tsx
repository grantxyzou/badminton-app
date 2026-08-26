import styles from './backgrounds.module.css';

type Variant = {
  id: string;
  title: string;
  blurb: string;
  className: string;
  live?: boolean;
  blobs?: boolean;
};

const VARIANTS: Variant[] = [
  { id: 'solid',    title: '01 Solid',       blurb: 'Flat --page-bg. Zero distraction — settings, long lists, dense admin.',       className: styles.solid },
  { id: 'aurora',   title: '02 Aurora',      blurb: 'Three breathing blobs (slate-blue + court-green + warm-yellow). Hero screens.', className: styles.aurora, blobs: true, live: true },
  { id: 'court',    title: '03 Court',       blurb: 'Faint doubles-court markings + soft green floor glow. Most on-theme.',          className: styles.court },
  { id: 'chalk',    title: '04 Chalk',       blurb: 'Grainy warm green + ochre wash. Cozy, physical, handmade.',                     className: styles.chalk },
  { id: 'tempo',    title: '05 Tempo field', blurb: 'Dot grid extending the logo motif (42px rhythm). Fades at the edges.',          className: styles.tempo },
  { id: 'contrail', title: '06 Contrail',    blurb: 'Dotted shuttle trajectory arcs + green glow. Most kinetic.',                    className: styles.contrail },
];

/* The shipped fields — one hue per tab, chosen 2026-08-26. The rejected
   alternative kept one hue at five depths and preserved the "no third brand
   colour" rule; this one trades that rule for five tabs you can tell apart at
   a glance. It spends four hues that meant something elsewhere, and two of
   those collide on their own tab — see the note under the grid. */
const FIELDS: Variant[] = [
  { id: 'f-home',    title: '07 Field · Home',     blurb: 'Court green — the one hue that kept its original meaning.',              className: styles.fieldHome },
  { id: 'f-signups', title: '08 Field · Sign-Ups', blurb: 'Amber, under the doubles-court etching. Spends "waitlist".',              className: `${styles.fieldSignups} ${styles.motifCourt}` },
  { id: 'f-stats',   title: '09 Field · Stats',    blurb: 'Blue, under the dot grid. Spends "dates / info" (--sev-low-text).',       className: `${styles.fieldStats} ${styles.motifDots}` },
  { id: 'f-profile', title: '10 Field · Profile',  blurb: 'Violet — was the admin pill. New: Profile had no field at all.',          className: styles.fieldProfile },
  { id: 'f-admin',   title: '11 Field · Admin',    blurb: 'Orange — was "session full". New: Admin was flat --page-bg.',             className: styles.fieldAdmin },
];

function Sample({ v }: { v: Variant }) {
  return (
    <section style={{ display: 'grid', gap: '0.5rem' }}>
      <h2 className="bpm-section-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span>{v.title.toUpperCase()}</span>
        {v.live && <span className="pill-paid">live</span>}
      </h2>
      <p className="bpm-caption">{v.blurb}</p>
      <div className={`${styles.viewport} ${v.className}`}>
        {v.blobs && (
          <>
            <div className={`${styles.blob} ${styles.blobA}`} aria-hidden />
            <div className={`${styles.blob} ${styles.blobB}`} aria-hidden />
            <div className={`${styles.blob} ${styles.blobC}`} aria-hidden />
          </>
        )}
        <div className="glass-card" style={{ padding: '1rem', maxWidth: '22rem', position: 'relative' }}>
          <p className="bpm-section-label" style={{ color: 'var(--text-muted)' }}>UPCOMING SESSION</p>
          <p style={{ margin: '0.5rem 0 0', fontWeight: 600 }}>Thursday, April 18 · 7:00 PM</p>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--fs-md)' }}>~$8.50 per person</p>
        </div>
      </div>
    </section>
  );
}

export default function BackgroundsPage() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '2rem 1rem', display: 'grid', gap: '1.25rem' }}>
      <div>
        <h1 className="bpm-h1">Backgrounds</h1>
        <p className="bpm-body" style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
          Each direction with an inline glass sample card on top so you can judge legibility. 01–06 mirror
          <code className="bpm-mono"> docs/design-system/preview/24-app-background.html</code>; 07–11 read the live
          <code className="bpm-mono"> --field-*</code> tokens directly, so they cannot drift from the app.
        </p>
      </div>

      {VARIANTS.map((v) => <Sample key={v.id} v={v} />)}

      <div style={{ marginTop: '1.5rem' }}>
        <h2 className="bpm-h3">Fields — one hue per tab</h2>
        <p className="bpm-body" style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
          Five tabs you can tell apart at a glance, at the cost of the no-third-colour rule. Each hue
          was carrying a meaning elsewhere, and using it as a ground spends that meaning. Two collide on
          their <em>own</em> tab: amber was <em>waitlist</em>, and Sign-Ups is where waitlists live; blue
          was <code className="bpm-mono">--sev-low-text</code>, used in five Stats components. Both are
          re-pitched in <code className="bpm-mono">globals.css</code> under
          {' '}<em>Semantic hues displaced by the fields</em>.
        </p>
      </div>
      {FIELDS.map((v) => <Sample key={v.id} v={v} />)}


      <p className="bpm-caption" style={{ marginTop: '1rem' }}>
        Check both themes, and check the top-right corner of every field — the gradient is brightest at
        78%/4%, which is exactly where <code className="bpm-mono">--text-muted</code> fails AA. It was
        already bumped from .35 to .55 once for this reason.
      </p>
    </main>
  );
}
