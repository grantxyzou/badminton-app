'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import AdminBackHeader from '../AdminBackHeader';
import { parseBirdName } from '@/lib/birdBrand';
import { normalizeBirdUsages } from '@/lib/birdUsages';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import type { BirdPurchase, Session } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface BirdsPageProps {
  onBack: () => void;
}

interface BrandSummary {
  brand: string;
  remaining: number;
  bought: number;
  speed: number | null;
  quality: number | null;
  weeksLeft: number | null;
}

function fmtDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}

function Stars({ n }: { n: number }) {
  return (
    <span style={{ display: 'inline-flex', gap: 1.5 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className="material-icons"
          style={{ fontSize: 12, color: i <= n ? 'var(--amber)' : 'rgba(255,255,255,0.18)' }}
        >
          star
        </span>
      ))}
    </span>
  );
}

export default function BirdsPage({ onBack }: BirdsPageProps) {
  const [purchases, setPurchases] = useState<BirdPurchase[]>([]);
  const [currentStock, setCurrentStock] = useState(0);
  const [usedByPurchase, setUsedByPurchase] = useState<Map<string, number>>(new Map());
  const [recentSessionCount, setRecentSessionCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // Add Purchase sheet state
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [addTubes, setAddTubes] = useState<number | ''>('');
  const [addCost, setAddCost] = useState<number | ''>('');
  const [addSpeed, setAddSpeed] = useState<number | ''>('');
  const [addQuality, setAddQuality] = useState<number>(0);
  const [addDate, setAddDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [addNotes, setAddNotes] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [birdsRes, sessionsRes] = await Promise.all([
        fetch(`${BASE}/api/birds`, { cache: 'no-store' }),
        fetch(`${BASE}/api/sessions`, { cache: 'no-store' }),
      ]);
      const birds = birdsRes.ok ? await birdsRes.json() as { purchases: BirdPurchase[]; currentStock: number } : { purchases: [], currentStock: 0 };
      const sessions = sessionsRes.ok ? await sessionsRes.json() as Session[] : [];

      // Build per-purchase usage map.
      const used = new Map<string, number>();
      let recent = 0;
      const sixtyDaysAgo = Date.now() - 60 * 86_400_000;
      for (const s of sessions) {
        const usages = normalizeBirdUsages(s);
        for (const u of usages) {
          used.set(u.purchaseId, (used.get(u.purchaseId) ?? 0) + u.tubes);
        }
        if (s.datetime) {
          const t = new Date(s.datetime).getTime();
          if (Number.isFinite(t) && t >= sixtyDaysAgo) recent++;
        }
      }
      setPurchases(birds.purchases ?? []);
      setCurrentStock(birds.currentStock ?? 0);
      setUsedByPurchase(used);
      setRecentSessionCount(recent);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function resetAddForm() {
    setAddName('');
    setAddTubes('');
    setAddCost('');
    setAddSpeed('');
    setAddQuality(0);
    setAddDate(new Date().toISOString().slice(0, 10));
    setAddNotes('');
    setAddError('');
  }

  async function handleAdd() {
    const name = addName.trim();
    const tubes = typeof addTubes === 'number' ? addTubes : 0;
    const totalCost = typeof addCost === 'number' ? addCost : 0;
    if (!name) { setAddError('Brand / model required.'); return; }
    if (tubes <= 0) { setAddError('Tubes must be > 0.'); return; }
    if (totalCost <= 0) { setAddError('Total cost must be > 0.'); return; }

    setAdding(true);
    setAddError('');
    try {
      const body: Record<string, unknown> = {
        name,
        tubes,
        totalCost,
        date: addDate,
        ...(typeof addSpeed === 'number' ? { speed: addSpeed } : {}),
        ...(addQuality > 0 ? { qualityRating: addQuality } : {}),
        ...(addNotes.trim() ? { notes: addNotes.trim() } : {}),
      };
      const res = await fetch(`${BASE}/api/birds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setAddError(data.error ?? 'Failed to add purchase.');
        return;
      }
      setAddOpen(false);
      resetAddForm();
      await load();
    } catch {
      setAddError('Network error.');
    } finally {
      setAdding(false);
    }
  }

  // Burn rate: total tubes used ÷ recent sessions.
  const burnPerSession = useMemo(() => {
    if (recentSessionCount === 0) return 0;
    const total = Array.from(usedByPurchase.values()).reduce((sum, v) => sum + v, 0);
    return total / recentSessionCount;
  }, [usedByPurchase, recentSessionCount]);

  const weeksRunway = burnPerSession > 0 ? currentStock / burnPerSession : null;

  // Brand summaries.
  const brands = useMemo<BrandSummary[]>(() => {
    const map = new Map<string, BrandSummary & { speedSum: number; speedCount: number; qualitySum: number; qualityCount: number }>();
    for (const p of purchases) {
      const { brand } = parseBirdName(p.name);
      const key = brand || p.name || '—';
      const used = usedByPurchase.get(p.id) ?? 0;
      const remaining = Math.max(0, p.tubes - used);
      const existing = map.get(key) ?? {
        brand: key,
        remaining: 0,
        bought: 0,
        speed: null,
        quality: null,
        weeksLeft: null,
        speedSum: 0,
        speedCount: 0,
        qualitySum: 0,
        qualityCount: 0,
      };
      existing.remaining += remaining;
      existing.bought += p.tubes;
      if (typeof p.speed === 'number') { existing.speedSum += p.speed; existing.speedCount++; }
      if (typeof p.qualityRating === 'number') { existing.qualitySum += p.qualityRating; existing.qualityCount++; }
      map.set(key, existing);
    }
    const out: BrandSummary[] = Array.from(map.values()).map((v) => {
      const speed = v.speedCount > 0 ? Math.round(v.speedSum / v.speedCount) : null;
      const quality = v.qualityCount > 0 ? Math.round(v.qualitySum / v.qualityCount) : null;
      const weeksLeft = burnPerSession > 0 ? Math.max(0, Math.round((v.remaining / burnPerSession) * 10) / 10) : null;
      return { brand: v.brand, remaining: v.remaining, bought: v.bought, speed, quality, weeksLeft };
    });
    return out.sort((a, b) => b.remaining - a.remaining);
  }, [purchases, usedByPurchase, burnPerSession]);

  // Last 60d purchase history.
  const recentPurchases = useMemo(() => {
    const sixtyDaysAgo = Date.now() - 60 * 86_400_000;
    return purchases
      .filter((p) => {
        const t = new Date(p.date).getTime();
        return Number.isFinite(t) && t >= sixtyDaysAgo;
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [purchases]);

  // Runway timeline math: clamp at 8 weeks for the bar; "empty" marker
  // sits at runway/8 of the bar width.
  const runwayPct = useMemo(() => {
    if (weeksRunway === null) return 100;
    return Math.max(0, Math.min(100, (weeksRunway / 8) * 100));
  }, [weeksRunway]);

  const heroLabelColor = weeksRunway === null
    ? 'var(--text-muted)'
    : weeksRunway < 2 ? 'var(--orange)' : weeksRunway < 4 ? 'var(--amber)' : 'var(--accent)';
  const reorderPill = weeksRunway === null
    ? null
    : weeksRunway < 2
      ? { tone: 'orange', label: 'Reorder now' }
      : weeksRunway < 4
        ? { tone: 'amber', label: 'Reorder soon' }
        : { tone: 'green', label: 'Healthy' };

  if (loading) return null;

  return (
    <div className="animate-slideInRight space-y-3">
      <AdminBackHeader onBack={onBack} title="Birds" />

      {/* Runway hero */}
      <div
        className="glass-card"
        style={{
          padding: 18,
          overflow: 'hidden',
          position: 'relative',
          background: 'linear-gradient(160deg, rgba(74,222,128,0.08), rgba(255,255,255,0.02))',
        }}
      >
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0 }}>Runs out in</p>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 2 }}>
          <span
            style={{
              fontFamily: 'var(--font-display, "Space Grotesk")',
              fontSize: 54,
              fontWeight: 700,
              letterSpacing: '-0.035em',
              lineHeight: 1,
              color: heroLabelColor,
            }}
          >
            {weeksRunway === null ? '—' : weeksRunway.toFixed(1)}
          </span>
          <span style={{ fontFamily: 'var(--font-display, "Space Grotesk")', fontSize: 18, color: 'var(--text-secondary)', fontWeight: 600 }}>
            {weeksRunway === null ? 'no data' : 'weeks'}
          </span>
          {reorderPill && (
            <span
              style={{
                marginLeft: 'auto',
                display: 'inline-flex',
                alignItems: 'center',
                padding: '3px 9px',
                borderRadius: 999,
                fontSize: 10.5,
                fontWeight: 600,
                fontFamily: 'var(--font-display, "Space Grotesk")',
                letterSpacing: '0.02em',
                background: reorderPill.tone === 'green' ? 'rgba(74,222,128,0.13)' : reorderPill.tone === 'amber' ? 'rgba(251,191,36,0.12)' : 'rgba(251,146,60,0.13)',
                color: reorderPill.tone === 'green' ? '#86efac' : reorderPill.tone === 'amber' ? 'var(--amber)' : 'var(--orange)',
                border: `1px solid ${reorderPill.tone === 'green' ? 'rgba(74,222,128,0.25)' : reorderPill.tone === 'amber' ? 'rgba(251,191,36,0.25)' : 'rgba(251,146,60,0.28)'}`,
              }}
            >
              {reorderPill.label}
            </span>
          )}
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '6px 0 0' }}>
          <strong style={{ color: 'var(--text-primary)' }}>{currentStock} tubes</strong> on hand
          {burnPerSession > 0 && (
            <>
              {' '}· burning <strong style={{ color: 'var(--text-primary)' }}>{burnPerSession.toFixed(1)}/session</strong>
            </>
          )}
        </p>

        {/* Timeline */}
        <div style={{ marginTop: 18, position: 'relative' }}>
          <div
            style={{
              height: 32,
              position: 'relative',
              borderRadius: 8,
              background: 'linear-gradient(to right, rgba(74,222,128,0.4) 0%, rgba(251,191,36,0.4) 60%, rgba(248,113,113,0.4) 100%)',
              overflow: 'hidden',
            }}
          >
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: `${(i / 8) * 100}%`,
                  top: 0,
                  bottom: 0,
                  width: 1,
                  background: 'rgba(0,0,0,0.18)',
                }}
              />
            ))}
            {/* "now" marker — white, left edge */}
            <div
              style={{
                position: 'absolute',
                left: '0%',
                top: -6,
                bottom: -6,
                width: 3,
                background: 'var(--text-primary)',
                borderRadius: 2,
                boxShadow: '0 0 0 2px rgba(0,0,0,0.4)',
              }}
              aria-label="now"
            />
            {/* "empty" marker — red, at runway position */}
            {weeksRunway !== null && (
              <div
                style={{
                  position: 'absolute',
                  left: `${runwayPct}%`,
                  top: -10,
                  bottom: -10,
                  width: 2,
                  background: 'var(--red-soft)',
                }}
                aria-label="empty"
              >
                <span
                  style={{
                    position: 'absolute',
                    top: -14,
                    left: -22,
                    fontFamily: 'var(--font-mono, "JetBrains Mono")',
                    fontSize: 10,
                    color: 'var(--red-soft)',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  empty
                </span>
              </div>
            )}
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: 6,
              fontFamily: 'var(--font-mono, "JetBrains Mono")',
              fontSize: 10,
              color: 'var(--ink-faint)',
            }}
          >
            <span>now</span>
            <span>2 wks</span>
            <span>4 wks</span>
            <span>6 wks</span>
            <span>8 wks</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button
            type="button"
            className="btn-primary"
            style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            onClick={() => { resetAddForm(); setAddOpen(true); }}
          >
            <span className="material-icons" style={{ fontSize: 18 }}>add_shopping_cart</span>
            Log purchase
          </button>
        </div>
      </div>

      {/* In stock */}
      <p
        style={{
          fontFamily: 'var(--font-display, "Space Grotesk")',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--ink-faint)',
          margin: '14px 4px 6px',
        }}
      >
        In stock
      </p>
      {brands.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 4px' }}>No active inventory.</p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {brands.map((b) => {
          const pct = b.bought > 0 ? (b.remaining / b.bought) * 100 : 0;
          return (
            <div key={b.brand} className="glass-card" style={{ padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <p style={{ fontFamily: 'var(--font-display, "Space Grotesk")', fontSize: 14, fontWeight: 600, margin: 0 }}>{b.brand}</p>
                  <p style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', gap: 6, alignItems: 'center', margin: 0 }}>
                    {b.speed !== null && <>spd {b.speed}</>}
                    {b.speed !== null && b.quality !== null && ' · '}
                    {b.quality !== null && <Stars n={b.quality} />}
                  </p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                  <span style={{ fontFamily: 'var(--font-display, "Space Grotesk")', fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>
                    {b.remaining}
                    <span style={{ color: 'var(--ink-faint)', fontSize: 12, fontWeight: 500 }}>/{b.bought}</span>
                  </span>
                  {b.weeksLeft !== null && (
                    <span style={{ fontFamily: 'var(--font-mono, "JetBrains Mono")', fontSize: 10, color: 'var(--ink-faint)' }}>
                      ~{b.weeksLeft}w
                    </span>
                  )}
                </div>
              </div>
              <div className="pbar" style={{ marginTop: 8, height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${pct}%`,
                    background: pct < 50 ? 'var(--amber)' : 'var(--accent)',
                    borderRadius: 999,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Purchase history */}
      <p
        style={{
          fontFamily: 'var(--font-display, "Space Grotesk")',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--ink-faint)',
          margin: '14px 4px 6px',
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
        }}
      >
        Purchase history
        <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--text-secondary)', fontWeight: 500, fontSize: 11 }}>
          last 60d
        </span>
      </p>
      {recentPurchases.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 4px' }}>No purchases in the last 60 days.</p>
      ) : (
        <div className="glass-card" style={{ padding: '4px 0' }}>
          {recentPurchases.map((p, i) => {
            const used = usedByPurchase.get(p.id) ?? 0;
            const left = Math.max(0, p.tubes - used);
            const { brand } = parseBirdName(p.name);
            return (
              <div
                key={p.id}
                style={{
                  padding: '12px 16px',
                  borderTop: i ? '1px solid rgba(255,255,255,0.05)' : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
                    <p style={{ fontFamily: 'var(--font-display, "Space Grotesk")', fontSize: 13.5, fontWeight: 600, margin: 0 }}>
                      {brand || p.name}
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: 0 }}>
                      {fmtDate(p.date)} · {p.tubes} tube{p.tubes === 1 ? '' : 's'}
                      {typeof p.speed === 'number' && ` · spd ${p.speed}`}
                    </p>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                    <span style={{ fontFamily: 'var(--font-mono, "JetBrains Mono")', fontSize: 13, fontWeight: 600 }}>
                      ${p.totalCost.toFixed(2)}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono, "JetBrains Mono")', fontSize: 10, color: 'var(--ink-faint)' }}>
                      ${p.costPerTube.toFixed(2)}/t
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', marginTop: 8, gap: 10 }}>
                  {typeof p.qualityRating === 'number' && <Stars n={p.qualityRating} />}
                  <span
                    style={{
                      display: 'inline-flex',
                      padding: '3px 9px',
                      borderRadius: 999,
                      fontSize: 10,
                      fontWeight: 600,
                      fontFamily: 'var(--font-display, "Space Grotesk")',
                      background: 'rgba(255,255,255,0.06)',
                      color: 'var(--text-muted)',
                      border: '1px solid rgba(255,255,255,0.1)',
                    }}
                  >
                    {left} left
                  </span>
                  {p.notes && (
                    <span
                      style={{
                        fontSize: 11,
                        color: 'var(--ink-faint)',
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {p.notes}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add purchase sheet */}
      <BottomSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        ariaLabel="Log purchase"
        maxHeight="80vh"
        className="max-w-sm mx-auto"
      >
        <BottomSheetHeader className="flex items-center justify-between p-4">
          <span style={{ fontSize: 16, fontWeight: 600 }}>Log purchase</span>
          <button
            type="button"
            onClick={() => setAddOpen(false)}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              minWidth: 44,
              minHeight: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span className="material-icons" style={{ fontSize: 20 }}>close</span>
          </button>
        </BottomSheetHeader>
        <BottomSheetBody className="p-5 pb-8">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Brand / model">
              <input
                type="text"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="e.g. Ling-Mei 60"
                maxLength={120}
              />
            </Field>
            <div style={{ display: 'flex', gap: 10 }}>
              <Field label="Tubes" style={{ flex: 1 }}>
                <input
                  type="number"
                  inputMode="decimal"
                  step={0.5}
                  value={addTubes}
                  onChange={(e) => setAddTubes(e.target.value === '' ? '' : Number(e.target.value))}
                />
              </Field>
              <Field label="Total cost" style={{ flex: 1 }}>
                <input
                  type="number"
                  inputMode="decimal"
                  step={0.01}
                  value={addCost}
                  onChange={(e) => setAddCost(e.target.value === '' ? '' : Number(e.target.value))}
                />
              </Field>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <Field label="Date" style={{ flex: 1 }}>
                <input
                  type="date"
                  value={addDate}
                  onChange={(e) => setAddDate(e.target.value)}
                />
              </Field>
              <Field label="Speed" style={{ flex: 1 }}>
                <input
                  type="number"
                  inputMode="numeric"
                  value={addSpeed}
                  onChange={(e) => setAddSpeed(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="e.g. 76"
                />
              </Field>
            </div>
            <Field label="Quality (1–5)">
              <div style={{ display: 'inline-flex', gap: 4 }}>
                {[1, 2, 3, 4, 5].map((i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setAddQuality(addQuality === i ? 0 : i)}
                    aria-label={`${i} stars`}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 0,
                      lineHeight: 0,
                    }}
                  >
                    <span
                      className="material-icons"
                      style={{
                        fontSize: 24,
                        color: i <= addQuality ? 'var(--amber)' : 'rgba(255,255,255,0.18)',
                      }}
                    >
                      star
                    </span>
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Notes (optional)">
              <input
                type="text"
                value={addNotes}
                onChange={(e) => setAddNotes(e.target.value)}
                placeholder="e.g. Same as last batch"
                maxLength={200}
              />
            </Field>

            {addError && (
              <p role="alert" style={{ fontSize: 13, color: 'var(--color-red, #ef4444)', margin: 0 }}>
                {addError}
              </p>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="cc-btn cc-btn-ghost"
                disabled={adding}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAdd}
                className="btn-primary"
                disabled={adding}
                style={{ minWidth: 100 }}
              >
                {adding ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </BottomSheetBody>
      </BottomSheet>
    </div>
  );
}

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</label>
      {children}
    </div>
  );
}
