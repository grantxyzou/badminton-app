'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import ErrorState from '@/components/primitives/ErrorState';
import { getIdentity } from '@/lib/identity';
import { avatarColors } from '@/lib/avatar';
import CardHeader from '@/components/primitives/CardHeader';
import StatusBadge from '@/components/primitives/StatusBadge';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const STATS_NAME_KEY = 'badminton_stats_preview_name';

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
      <CardHeader icon="groups" title={t('partnersTitle')} badge={<StatusBadge>Beta</StatusBadge>} />
      {loadError ? (
        <ErrorState message={t('partnersError')} />
      ) : partners === null ? (
        // Loading: shimmer the avatar-row body so the card reserves its shape.
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }} aria-hidden="true">
          <div className="shimmer-line" style={{ width: 46, height: 46, borderRadius: '50%' }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="shimmer-line rounded-lg" style={{ height: 11, width: '40%' }} />
            <div className="shimmer-line rounded-lg" style={{ height: 16, width: '65%' }} />
          </div>
        </div>
      ) : partners.length === 0 ? (
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: 0 }}>{t('partnersEmpty')}</p>
      ) : (
        // Hero the #1 partner — in doubles your most-frequent partner is the
        // meaningful relationship, so lead with "who you play most with" rather
        // than a flat ranked list. The rest trail as a compact line.
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(() => {
            const top = partners[0];
            const ava = avatarColors(top.name);
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: '50%',
                    background: ava.bg,
                    color: ava.fg,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'var(--font-display, "Space Grotesk")',
                    fontWeight: 600,
                    fontSize: 19,
                    flexShrink: 0,
                    border: '1px solid rgba(var(--glass-tint), 0.10)',
                  }}
                >
                  {top.name.slice(0, 1).toUpperCase()}
                </span>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{t('partnersMostWith')}</p>
                  <p style={{ margin: 0, fontSize: 19, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                    {top.name}
                  </p>
                  <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-secondary)' }}>
                    {t('partnersTogether', { count: top.count })}
                  </p>
                </div>
              </div>
            );
          })()}
          {partners.length > 1 && (
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {partners.slice(1).map((p) => `${p.name} ${p.count}`).join('  ·  ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
