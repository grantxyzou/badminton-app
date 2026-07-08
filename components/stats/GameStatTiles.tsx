'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getIdentity } from '@/lib/identity';
import StatCard from './StatCard';
import { recentSessions } from './cards/AttendanceSessionStrip';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const STATS_NAME_KEY = 'badminton_stats_preview_name';
const RECENT = 8;

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

interface AttendanceResponse {
  history: Array<{ sessionId: string; datetime: string | null; attended: boolean }>;
}
interface Partner {
  name: string;
  count: number;
}

/**
 * Game-stats summary tiles — Recent form + Top partner as gradient StatCards,
 * the "Insights" tile row up top. Recent form ("5 / 8") is a positive, no-loss
 * framing — deliberately NOT a streak. AttendanceCardLive owns the name picker
 * and the detailed strip below, so this stays quiet when there's no resolvable
 * viewer (never renders a second picker).
 */
export default function GameStatTiles() {
  const t = useTranslations('valueHub');
  const [activeName, setActiveName] = useState<string | null>(null);
  const [attendance, setAttendance] = useState<AttendanceResponse | null>(null);
  const [partners, setPartners] = useState<Partner[] | null>(null);

  useEffect(() => {
    setActiveName(resolveActiveName());
  }, []);

  useEffect(() => {
    if (!activeName) return;
    let live = true;
    fetch(`${BASE}/api/stats/attendance?name=${encodeURIComponent(activeName)}&weeks=52`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live) setAttendance(d); })
      .catch(() => { /* AttendanceCardLive surfaces the authoritative error */ });
    fetch(`${BASE}/api/stats/partners?name=${encodeURIComponent(activeName)}&weeks=12`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live) setPartners(d?.partners ?? []); })
      .catch(() => { /* tile shows a dash */ });
    return () => { live = false; };
  }, [activeName]);

  if (!activeName) return null;

  const recent = attendance ? recentSessions(attendance.history, RECENT) : [];
  const recentAttended = recent.filter((s) => s.attended).length;
  const attLoaded = attendance !== null;

  const partLoaded = partners !== null;
  const top = partners && partners.length > 0 ? partners[0] : null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--space-3)' }}>
      <StatCard
        tone="blue"
        size="tile"
        label={t('recentFormLabel')}
        value={attLoaded ? recentAttended : '—'}
        unit={attLoaded && recent.length > 0 ? `/ ${recent.length}` : undefined}
        caption={attLoaded ? t('recentFormCaption') : undefined}
      />
      <StatCard
        tone="amber"
        size="tile"
        label={t('partnersTileLabel')}
        value={partLoaded ? (top ? top.name : '—') : '—'}
        caption={partLoaded ? (top ? t('partnersTogether', { count: top.count }) : t('partnersEmpty')) : undefined}
      />
    </div>
  );
}
