/* global React, PageHeader, GlassCard, SectionLabel, MaterialIcon */

function SignupsTab({ signedUpName, setSignedUpName }) {
  const active = ['Alex', 'Priya', 'Chen', 'Marco', 'Jo', 'Leila', 'Mike', ...(signedUpName ? [signedUpName] : [])];
  const waitlist = ['Sam', 'Riya'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader title="Sign-Up" />

      <GlassCard padding={0} overflow="hidden">
        <div style={{ padding: '12px 16px 8px', fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--accent)' }}>
          Thursday, April 18
        </div>
        <div style={{ padding: '0 8px 8px' }}>
          {active.map((p, i) => {
            const me = p === signedUpName;
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', gap: 12, borderRadius: 12, background: me ? 'var(--highlight-green)' : 'transparent' }}>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', width: 20, textAlign: 'right', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>{i + 1}</div>
                <div style={{ flex: 1, fontSize: 14, color: 'var(--text-primary)', fontWeight: 500 }}>
                  {p}
                  {me && <span style={{ marginLeft: 6, fontSize: 13, color: 'var(--accent)', fontWeight: 400 }}>(you)</span>}
                </div>
                {me && (
                  <button onClick={() => setSignedUpName(null)} style={{ background: 'transparent', border: 'none', color: 'var(--bpm-red-400, #ef4444)', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}>Cancel</button>
                )}
              </div>
            );
          })}
        </div>
      </GlassCard>

      <GlassCard padding={0} overflow="hidden">
        <div style={{ padding: '8px 16px', fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', background: 'var(--list-amber-bg)', color: 'var(--list-amber-text)', borderBottom: '1px solid var(--list-amber-border)' }}>
          Waitlist
        </div>
        <div style={{ padding: '8px' }}>
          {waitlist.map((p, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', gap: 12 }}>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', width: 20, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{active.length + i + 1}</div>
              <div style={{ flex: 1, fontSize: 14, color: 'var(--text-secondary)', fontWeight: 500 }}>{p}</div>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}

function SkillsTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader title="Learn" />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '50vh' }}>
        <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--text-muted)', textAlign: 'center' }}>Progress together?</div>
      </div>
    </div>
  );
}

Object.assign(window, { SignupsTab, SkillsTab });
