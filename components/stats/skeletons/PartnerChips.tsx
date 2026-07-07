const INITIALS = ['LM', 'KT', 'JZ', 'AR', 'DW'];

export default function PartnerChips() {
  return (
    <div role="img" aria-label="Partner chips placeholder" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ display: 'flex' }}>
        {INITIALS.map((txt, i) => (
          <div
            key={i}
            style={{
              width: 34,
              height: 34,
              borderRadius: '50%',
              background: 'color-mix(in oklab, var(--accent, #22c55e) 30%, transparent)',
              color: 'var(--text-primary, #fff)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 'var(--fs-xs)',
              fontWeight: 600,
              letterSpacing: '0.02em',
              border: '1.5px solid var(--bg-surface)',
              marginLeft: i === 0 ? 0 : -10,
            }}
          >
            {txt}
          </div>
        ))}
      </div>
      <div
        style={{
          marginLeft: 8,
          height: 6,
          flex: 1,
          borderRadius: 'var(--radius-pill)',
          background: 'linear-gradient(90deg, color-mix(in oklab, var(--accent, #22c55e) 55%, transparent), transparent)',
        }}
      />
    </div>
  );
}
