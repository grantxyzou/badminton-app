/* global React, PageHeader, GlassCard, SectionLabel, StatusBanner, BtnPrimary, BtnGhost, MaterialIcon */
const { useState: useStateHome } = React;

function HomeTab({ goTo, signedUpName, setSignedUpName }) {
  const [name, setName] = useStateHome('');
  const isSignedUp = !!signedUpName;
  const players = ['Alex', 'Priya', 'Chen', 'Marco', 'Jo', 'Leila', 'Mike', ...(signedUpName ? [signedUpName] : [])];
  const spotsTotal = 12;
  const remaining = spotsTotal - players.length;

  function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setSignedUpName(name.trim());
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader title="BPM Badminton" />

      {/* Tile row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <GlassCard padding={16}>
          <SectionLabel>LOCATION</SectionLabel>
          <div style={{ fontSize: 18, fontWeight: 600, marginTop: 8, lineHeight: 1.3 }}>Central YMCA</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', textDecoration: 'underline dotted', textUnderlineOffset: 2, marginTop: 4 }}>20 Grosvenor St</div>
        </GlassCard>
        <GlassCard padding={16}>
          <SectionLabel>WHEN</SectionLabel>
          <div style={{ fontSize: 18, fontWeight: 600, marginTop: 8, lineHeight: 1.3 }}>Thursday, April 18</div>
          <div style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.3 }}>7:00 PM</div>
        </GlassCard>
      </div>

      {/* Cost */}
      <GlassCard padding={20} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Estimated cost</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>~$8.50</div>
      </GlassCard>

      {/* Announcement */}
      <GlassCard padding={20}>
        <SectionLabel>ANNOUNCEMENT</SectionLabel>
        <div style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.6, marginTop: 8 }}>
          Bring your own shuttles if you have a favourite — we'll be rotating yellow tubes tonight. See you at 7!
        </div>
      </GlassCard>

      {/* Sign-up card */}
      <GlassCard padding={20}>
        {isSignedUp ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)' }}>Sign up</div>
              <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Signed-up: {players.length} · {remaining} spots left</div>
            </div>
            <StatusBanner tone="green" icon="check_circle" title={`${signedUpName}, thank you for signing up!`} body="See you soon!" />
            <BtnGhost onClick={() => goTo('players')}>View Sign Up List</BtnGhost>
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)' }}>Sign up</div>
              <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Signed-up: {players.length} · {remaining} spots left</div>
            </div>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Enter your name" style={{ background: 'transparent', border: '1px solid var(--glass-border)', borderRadius: 14, padding: '11px 14px', color: 'var(--input-text)', fontFamily: 'inherit', fontSize: 14, outline: 'none', width: '100%' }} />
            <BtnPrimary>Sign Up</BtnPrimary>
            <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>Sign up closes on Wednesday, April 17</div>
          </form>
        )}
      </GlassCard>

      {signedUpName && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Last session (Thursday, April 11) · $8.50/person</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>E-transfer to grant@bpmbadminton.ca</div>
        </div>
      )}
    </div>
  );
}

window.HomeTab = HomeTab;
