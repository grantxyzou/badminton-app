/* global React */
const { useState } = React;

function MaterialIcon({ name, size = 18, color, style = {} }) {
  return <span className="material-icons" style={{ fontSize: size, color, opacity: 0.85, verticalAlign: 'middle', lineHeight: 1, ...style }}>{name}</span>;
}

function GlassCard({ children, style = {}, padding = 20, onClick, overflow = 'visible' }) {
  return <div onClick={onClick} className="glass-card" style={{ padding, overflow, ...style }}>{children}</div>;
}

function SectionLabel({ children, muted = false, style = {} }) {
  return <div style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: muted ? 'var(--text-muted)' : 'var(--accent)', ...style }}>{children}</div>;
}

function StatusBanner({ tone = 'green', icon, title, body }) {
  // Banner swatches use theme-adaptive tokens so light/dark both work.
  // (Fallback hexes match dark; light mode overrides via CSS vars in colors_and_type.css.)
  const toneMap = {
    green:  { bg: 'var(--banner-green-bg)',  border: 'var(--banner-green-border)',  color: 'var(--accent)' },
    orange: { bg: 'var(--banner-orange-bg)', border: 'var(--banner-orange-border)', color: 'var(--bpm-amber-400, #fbbf24)' },
    red:    { bg: 'var(--banner-red-bg)',    border: 'var(--banner-red-border)',    color: 'var(--bpm-red-400, #ef4444)' },
  };
  const { bg, border, color } = toneMap[tone] || toneMap.green;
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 16, padding: 14, display: 'flex', gap: 12, alignItems: 'center' }}>
      <MaterialIcon name={icon} size={22} color={color} />
      <div>
        <div style={{ fontWeight: 600, color, fontSize: 14 }}>{title}</div>
        {body && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>{body}</div>}
      </div>
    </div>
  );
}

function Pill({ tone = 'paid', icon, children }) {
  const map = {
    paid:     { bg: 'var(--pill-paid-bg)',     c: 'var(--pill-paid-text)' },
    unpaid:   { bg: 'var(--pill-unpaid-bg)',   c: 'var(--pill-unpaid-text)' },
    waitlist: { bg: 'var(--pill-waitlist-bg)', c: 'var(--pill-waitlist-text)' },
    admin:    { bg: 'var(--pill-admin-bg)',    c: 'var(--pill-admin-text)' },
  }[tone] || { bg: 'var(--pill-paid-bg)', c: 'var(--pill-paid-text)' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: map.bg, color: map.c,
      padding: icon ? '3px 11px 3px 9px' : '4px 12px',
      borderRadius: 100, fontSize: 12, fontWeight: 600, lineHeight: 1, letterSpacing: '0.02em'
    }}>
      {icon && <MaterialIcon name={icon} size={13} color={map.c} />}
      {children}
    </span>
  );
}

function BtnPrimary({ children, onClick, disabled, style = {} }) {
  return <button className="btn-primary" onClick={onClick} disabled={disabled} style={{ width: '100%', ...style }}>{children}</button>;
}
function BtnGhost({ children, onClick, style = {} }) {
  return <button className="btn-ghost" onClick={onClick} style={{ width: '100%', ...style }}>{children}</button>;
}

function PageHeader({ title, onTap }) {
  return <h1 onClick={onTap} style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1, padding: '0 8px', color: 'var(--text-primary)', userSelect: 'none', cursor: 'default' }}>{title}</h1>;
}

function BottomNav({ active, onChange, tabs }) {
  return (
    <nav style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50, paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}>
      <div style={{ maxWidth: 512, margin: '0 auto', padding: '0 16px', display: 'flex', justifyContent: 'center' }}>
        <div style={{ background: 'var(--nav-bg)', backdropFilter: 'blur(10px) saturate(140%)', WebkitBackdropFilter: 'blur(10px) saturate(140%)', borderRadius: 22, border: '1px solid var(--glass-border)', boxShadow: 'var(--nav-shadow)', display: 'inline-flex', padding: '4px 6px 6px' }}>
          {tabs.map(t => {
            const a = active === t.id;
            return (
              <button
                key={t.id}
                onClick={() => onChange(t.id)}
                aria-selected={a}
                style={{
                  flex: '0 0 auto', minWidth: 64,
                  background: 'transparent', border: 'none',
                  padding: '6px 10px 4px',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  color: a ? 'var(--nav-active-color)' : 'var(--nav-inactive-color)',
                  cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'color 150ms var(--ease-glass)'
                }}
              >
                <span className={a ? 'material-icons' : 'material-icons-outlined'} style={{ fontSize: 22, lineHeight: 1, opacity: 1 }} aria-hidden="true">
                  {t.icon}
                </span>
                <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.01em', lineHeight: 1.1 }}>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

Object.assign(window, { MaterialIcon, GlassCard, SectionLabel, StatusBanner, Pill, BtnPrimary, BtnGhost, PageHeader, BottomNav });
