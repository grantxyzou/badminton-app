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

/* Track A — one hue, five depths. Keeps the "one brand accent, no third
   brand colour" rule from docs/design-system/README.md: tabs are told apart
   by how deep and how warm the ground is, never by a new hue. Profile and
   Admin borrow the two aurora blob colours, which were never brand colours. */
const TRACK_A: Variant[] = [
  { id: 'f-home',    title: '07 Field · Home',     blurb: 'Court green at 42%. Brightest — the landing tab.',                        className: styles.fieldHome },
  { id: 'f-signups', title: '08 Field · Sign-Ups', blurb: 'Deeper green at 44%, under the doubles-court etching.',                   className: `${styles.fieldSignups} ${styles.motifCourt}` },
  { id: 'f-stats',   title: '09 Field · Stats',    blurb: 'Forest 800 into green 34%, under the dot grid. Numbers need quiet.',      className: `${styles.fieldStats} ${styles.motifDots}` },
  { id: 'f-profile', title: '10 Field · Profile',  blurb: 'Cool slate-blue. New — Profile had no field, it fell through to aurora.', className: styles.fieldProfile },
  { id: 'f-admin',   title: '11 Field · Admin',    blurb: 'Warm sand. New — Admin was flat --page-bg.',                              className: styles.fieldAdmin },
];

/* Track B — one hue per tab. Looks better and breaks the rule. Every hue is
   already in the file doing a SEMANTIC job, so spending it as a ground costs
   that meaning. The collision to judge: an orange "session full" banner on
   an orange Admin field. If B wins, those four roles need reassigning. */
const TRACK_B: Variant[] = [
  { id: 'fb-home',    title: '12 Field B · Home',     blurb: 'Court green — unchanged from Track A.',                       className: styles.fieldBHome },
  { id: 'fb-signups', title: '13 Field B · Sign-Ups', blurb: 'Amber — spends the "waitlist" meaning.',                      className: `${styles.fieldBSignups} ${styles.motifCourt}` },
  { id: 'fb-stats',   title: '14 Field B · Stats',    blurb: 'Blue — spends the "dates, info" meaning.',                    className: `${styles.fieldBStats} ${styles.motifDots}` },
  { id: 'fb-profile', title: '15 Field B · Profile',  blurb: 'Violet — already the admin pill colour.',                     className: styles.fieldBProfile },
  { id: 'fb-admin',   title: '16 Field B · Admin',    blurb: 'Orange — spends "session full". Watch the banner collision.', className: styles.fieldBAdmin },
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
          <code className="bpm-mono"> docs/design-system/preview/24-app-background.html</code>; 07–16 read the live
          <code className="bpm-mono"> --field-*</code> tokens directly, so they cannot drift from the app.
        </p>
      </div>

      {VARIANTS.map((v) => <Sample key={v.id} v={v} />)}

      <div style={{ marginTop: '1.5rem' }}>
        <h2 className="bpm-h3">Fields · Track A — one hue, five depths</h2>
        <p className="bpm-body" style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
          Tabs differ by depth and warmth, not hue, so amber / orange / blue / violet stay free to mean
          waitlist, session full, info and admin. Nothing here is a new colour.
        </p>
      </div>
      {TRACK_A.map((v) => <Sample key={v.id} v={v} />)}

      <div style={{ marginTop: '1.5rem' }}>
        <h2 className="bpm-h3">Fields · Track B — one hue per tab</h2>
        <p className="bpm-body" style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
          Five tabs recognisable from across the room, at the cost of the no-third-colour rule. Each hue
          already carries a meaning elsewhere in the app, and using it as a ground spends that meaning.
          Judge 16 hardest: an orange <em>session full</em> banner sits on an orange Admin field.
        </p>
      </div>
      {TRACK_B.map((v) => <Sample key={v.id} v={v} />)}

      <p className="bpm-caption" style={{ marginTop: '1rem' }}>
        Check both themes, and check the top-right corner of every field — the gradient is brightest at
        78%/4%, which is exactly where <code className="bpm-mono">--text-muted</code> fails AA. It was
        already bumped from .35 to .55 once for this reason.
      </p>
    </main>
  );
}
