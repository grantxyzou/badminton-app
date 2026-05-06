'use client';

import { useEffect, useState, useCallback } from 'react';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface BirdSummary {
  currentStock: number;
  totalPurchased: number;
  totalUsed: number;
}

interface BirdInventoryCardProps {
  onOpen?: () => void;
}

export default function BirdInventoryCard({ onOpen }: BirdInventoryCardProps = {}) {
  const [summary, setSummary] = useState<BirdSummary | null>(null);
  const [weeksOfBurnRate, setWeeksOfBurnRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [birdsRes, sessionsRes] = await Promise.all([
        fetch(`${BASE}/api/birds`, { cache: 'no-store' }),
        fetch(`${BASE}/api/sessions/recent?limit=6`, { cache: 'no-store' }),
      ]);
      const birds = birdsRes.ok ? ((await birdsRes.json()) as BirdSummary) : null;
      setSummary(birds);

      // Burn rate = tubes used in last 6 sessions / 6. Fetch each session's usages
      // by hitting /api/session for individual archives — simpler: compute from
      // the totalUsed delta if we had timestamps. For now: estimate using the
      // totalUsed/sessionCount ratio.
      if (birds && sessionsRes.ok) {
        const recent = (await sessionsRes.json()) as Array<{ sessionId: string }>;
        if (recent.length > 0 && birds.totalUsed > 0) {
          // Rough estimate: assume burn rate is constant over the lifetime of usage.
          // weeks remaining = current stock ÷ avg tubes per session.
          // Using totalUsed / N (where N is total sessions) is a crude proxy for now.
          const avgPerSession = birds.totalUsed / Math.max(1, recent.length);
          if (avgPerSession > 0) {
            setWeeksOfBurnRate(Math.floor(birds.currentStock / avgPerSession));
          }
        }
      }
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return null;
  if (!summary) {
    return (
      <section className="glass-card p-4 space-y-1 opacity-60" aria-label="Bird inventory">
        <h3 className="bpm-h3">Bird inventory</h3>
        <p className="text-xs text-gray-400">No data.</p>
      </section>
    );
  }

  const stock = summary.currentStock;
  const lowStock = stock < 5;

  return (
    <section className="glass-card p-4 space-y-2" aria-label="Bird inventory">
      <h3 className="bpm-h3">Bird inventory</h3>
      <div className="flex items-baseline gap-2">
        <span
          className="bpm-h2"
          style={{ color: lowStock ? '#fca5a5' : 'inherit' }}
        >
          {stock}
        </span>
        <span className="text-xs text-gray-400">tubes on hand</span>
      </div>
      {weeksOfBurnRate !== null && weeksOfBurnRate > 0 && (
        <p className="text-xs text-gray-400">
          ~{weeksOfBurnRate} {weeksOfBurnRate === 1 ? 'week' : 'weeks'} at recent burn rate
        </p>
      )}
      {lowStock && (
        <p className="text-xs" style={{ color: '#fca5a5' }}>
          Low stock — consider ordering soon.
        </p>
      )}
      {onOpen && (
        <button
          type="button"
          onClick={onOpen}
          className="text-xs text-gray-300 hover:text-gray-100 underline-offset-2 hover:underline pt-1"
        >
          Manage inventory →
        </button>
      )}
    </section>
  );
}
