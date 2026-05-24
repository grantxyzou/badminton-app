'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getIdentity } from '@/lib/identity';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const STATS_NAME_KEY = 'badminton_stats_preview_name';
const ACCENT = 'var(--accent, #22c55e)';

// Mirrors AttendanceCardLive: identity → stats preview-name → null. The preview
// key lets admins/incognito browse someone else's stats without faking identity.
function resolveActiveName(): string | null {
  const id = getIdentity();
  if (id?.name) return id.name;
  try {
    const stored = localStorage.getItem(STATS_NAME_KEY);
    if (stored && stored.trim()) return stored.trim();
  } catch {
    /* ignore */
  }
  return null;
}

interface Partner {
  name: string;
  count: number;
}

/**
 * Slice-0 partner-frequency card. Sources from co-attendance (players sharing a
 * sessionId over the last 12 weeks) — has data day one, independent of the game
 * logger. Legible-fail: a load failure renders a distinct error pill.
 */
export default function PartnerFrequencyCard() {
  const t = useTranslations('valueHub');
  const [activeName, setActiveName] = useState<string | null>(null);
  const [partners, setPartners] = useState<Partner[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    setActiveName(resolveActiveName());
  }, []);

  useEffect(() => {
    let live = true;
    if (!activeName) return;
    fetch(`${BASE}/api/stats/partners?name=${encodeURIComponent(activeName)}&weeks=12`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (live) { setPartners(d.partners ?? []); setLoadError(false); } })
      .catch(() => { if (live) setLoadError(true); });
    return () => { live = false; };
  }, [activeName]);

  // No resolvable viewer — AttendanceCardLive on the same tab owns the picker,
  // so this card just stays quiet rather than rendering a second picker.
  if (!activeName) return null;

  return (
    <div className="glass-card p-5 space-y-3">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="material-icons" aria-hidden="true" style={{ fontSize: 22, color: ACCENT }}>groups</span>
          <h3 className="bpm-h3 m-0">{t('partnersTitle')}</h3>
        </div>
        <span
          style={{
            fontSize: 10, padding: '3px 8px', borderRadius: 100, whiteSpace: 'nowrap',
            fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
            border: `1px solid ${ACCENT}`, color: ACCENT,
          }}
        >
          Beta
        </span>
      </div>
      {loadError ? (
        <p className="text-red-400 text-xs" role="alert">{t('partnersError')}</p>
      ) : partners === null ? null : partners.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{t('partnersEmpty')}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {partners.map((p) => (
            <li key={p.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span>{p.name}</span>
              <span style={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)', color: 'var(--text-muted)' }}>×{p.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
