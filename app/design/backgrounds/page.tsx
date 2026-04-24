import styles from './backgrounds.module.css';

type Variant = { id: string; title: string; blurb: string; className: string; live?: boolean; blobs?: boolean };

const VARIANTS: Variant[] = [
  { id: 'solid',    title: '01 Solid',       blurb: 'Flat --page-bg. Zero distraction — settings, long lists, dense admin.',       className: styles.solid },
  { id: 'aurora',   title: '02 Aurora',      blurb: 'Three breathing blobs (slate-blue + court-green + warm-yellow). Hero screens.', className: styles.aurora, blobs: true, live: true },
  { id: 'court',    title: '03 Court',       blurb: 'Faint doubles-court markings + soft green floor glow. Most on-theme.',          className: styles.court },
  { id: 'chalk',    title: '04 Chalk',       blurb: 'Grainy warm green + ochre wash. Cozy, physical, handmade.',                     className: styles.chalk },
  { id: 'tempo',    title: '05 Tempo field', blurb: 'Dot grid extending the logo motif (42px rhythm). Fades at the edges.',          className: styles.tempo },
  { id: 'contrail', title: '06 Contrail',    blurb: 'Dotted shuttle trajectory arcs + green glow. Most kinetic.',                    className: styles.contrail },
];

export default function BackgroundsPage() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '2rem 1rem', display: 'grid', gap: '1.25rem' }}>
      <div>
        <h1 className="bpm-h1">Backgrounds</h1>
        <p className="bpm-body" style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
          Six directions with an inline glass sample card on top so you can judge legibility. Mirrors
          <code className="bpm-mono"> docs/design-system/preview/24-app-background.html</code>.
        </p>
      </div>

      {VARIANTS.map((v) => (
        <section key={v.id} style={{ display: 'grid', gap: '0.5rem' }}>
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
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.875rem' }}>~$8.50 per person</p>
            </div>
          </div>
        </section>
      ))}
    </main>
  );
}
