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
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.02em',
              border: '1.5px solid var(--bg-surface, #1a1a1a)',
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
          borderRadius: 100,
          background: 'linear-gradient(90deg, color-mix(in oklab, var(--accent, #22c55e) 55%, transparent), transparent)',
        }}
      />
    </div>
  );
}
