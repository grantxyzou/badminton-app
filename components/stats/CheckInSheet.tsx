'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import { SKILLS } from '@/lib/assessment';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface GameDoc {
  teamA?: string[];
  teamB?: string[];
  scoreA?: number;
  scoreB?: number;
}

interface Mirror {
  played: number;
  won: number;
  topPartner: string | null;
}

/** The check-in flow: a game-results mirror, then a one-skill-per-screen
 *  anchor quiz, then save. `previous` pre-selects last check-in's values so a
 *  re-rate is a quick adjust. */
export default function CheckInSheet({
  name, open, onClose, onSaved, previous,
}: {
  name: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  previous?: Map<string, number>;
}) {
  const t = useTranslations('stats');
  const total = SKILLS.length;
  // step: -1 = mirror/intro, 0..total-1 = a skill, total = review/save
  const [step, setStep] = useState(-1);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [mirror, setMirror] = useState<Mirror | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Reset + seed from previous each time the sheet opens.
  useEffect(() => {
    if (!open) return;
    setStep(-1);
    setError('');
    setRatings(previous ? Object.fromEntries(previous) : {});
  }, [open, previous]);

  // Pull recent games for the reconciliation mirror.
  useEffect(() => {
    if (!open || !name) return;
    let cancelled = false;
    fetch(`${BASE}/api/games`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (cancelled) return;
        const lower = name.toLowerCase();
        const games = (d.games ?? []) as GameDoc[];
        let played = 0;
        let won = 0;
        const partnerCounts = new Map<string, number>();
        for (const g of games) {
          const a = (g.teamA ?? []).map((n) => n.toLowerCase());
          const b = (g.teamB ?? []).map((n) => n.toLowerCase());
          const inA = a.includes(lower);
          const inB = b.includes(lower);
          if (!inA && !inB) continue;
          played++;
          const myScore = inA ? g.scoreA ?? 0 : g.scoreB ?? 0;
          const oppScore = inA ? g.scoreB ?? 0 : g.scoreA ?? 0;
          if (myScore > oppScore) won++;
          const mates = (inA ? g.teamA ?? [] : g.teamB ?? []).filter((n) => n.toLowerCase() !== lower);
          for (const mate of mates) partnerCounts.set(mate, (partnerCounts.get(mate) ?? 0) + 1);
        }
        const topPartner = [...partnerCounts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
        setMirror({ played, won, topPartner });
      })
      .catch(() => { if (!cancelled) setMirror(null); });
    return () => { cancelled = true; };
  }, [open, name]);

  const ratedCount = Object.keys(ratings).length;

  // Select sets the rating and STAYS on the skill so the choice is visibly
  // confirmed; the footer Next button advances. (Auto-advancing on tap read as
  // "nothing happened" because the screen jumped before you saw the selection.)
  const select = (level: number) => {
    setRatings((r) => ({ ...r, [SKILLS[step].key]: level }));
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    const payload = Object.entries(ratings).map(([skillKey, value]) => ({ skillKey, value }));
    try {
      const res = await fetch(`${BASE}/api/assessments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, ratings: payload }),
      });
      if (!res.ok) throw new Error(String(res.status));
      onSaved();
      onClose();
    } catch {
      setError(t('assess.saveError'));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const skill = step >= 0 && step < total ? SKILLS[step] : null;

  return (
    <BottomSheet open onClose={onClose} ariaLabel={t('assess.checkInTitle')} maxHeight="85vh" className="max-w-lg mx-auto">
      <div
        style={{
          background: 'var(--glass-bg)',
          WebkitBackdropFilter: 'blur(var(--glass-blur)) saturate(140%)',
          backdropFilter: 'blur(var(--glass-blur)) saturate(140%)',
          border: '1px solid var(--glass-border)',
          borderBottom: 'none',
          boxShadow: 'var(--glass-shadow)',
          display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0,
        }}
      >
        <BottomSheetHeader className="px-5 pt-4 pb-3">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <h2 className="text-lg font-bold m-0" style={{ color: 'var(--text-primary)' }}>{t('assess.checkInTitle')}</h2>
            <button
              onClick={onClose}
              aria-label={t('assess.close')}
              className="flex items-center justify-center rounded-full"
              style={{ width: 32, height: 32, background: 'var(--inner-card-bg)', border: '1px solid var(--inner-card-border)' }}
            >
              <span className="material-icons" style={{ fontSize: 18, color: 'var(--text-muted)' }}>close</span>
            </button>
          </div>
          {/* Progress track — only during the quiz steps. */}
          {skill && (
            <div style={{ marginTop: 12 }}>
              <div className="cc-progress-track" style={{ height: 4, borderRadius: 100, overflow: 'hidden' }}>
                <div style={{ width: `${((step + 1) / total) * 100}%`, height: '100%', background: 'var(--accent)', transition: 'width 180ms var(--ease-out-quart, ease-out)' }} />
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 0' }}>{t('assess.step', { n: step + 1, total })}</p>
            </div>
          )}
        </BottomSheetHeader>

        <BottomSheetBody className="px-5 pb-8" style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}>
          {/* Intro + reconciliation mirror */}
          {step === -1 && (
            <div className="space-y-4">
              {mirror && mirror.played > 0 ? (
                <div className="p-4 rounded-xl" style={{ background: 'var(--inner-card-bg)', border: '1px solid var(--inner-card-border)' }}>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t('assess.mirrorTitle')}</p>
                  <p style={{ fontSize: 15, color: 'var(--text-primary)', margin: '6px 0 0', lineHeight: 1.4 }}>
                    {t('assess.mirrorRecord', { won: mirror.won, played: mirror.played })}
                    {mirror.topPartner ? ` ${t('assess.mirrorPartner', { name: mirror.topPartner })}` : ''}
                  </p>
                </div>
              ) : (
                <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('assess.noGames')}</p>
              )}
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>{t('assess.ratePrompt')}</p>
              <button type="button" onClick={() => setStep(0)} className="cc-btn cc-btn-primary cc-btn-lg" style={{ width: '100%' }}>
                {t('assess.start')}
              </button>
            </div>
          )}

          {/* One skill per screen */}
          {skill && (
            <div className="space-y-3">
              <div>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {t(`assess.dim.${skill.dimension}`)}
                </p>
                <h3 className="bpm-h3 m-0" style={{ marginTop: 2 }}>{skill.label}</h3>
              </div>
              {skill.anchors.map((anchor, i) => {
                const level = i + 1;
                const isActive = ratings[skill.key] === level;
                return (
                  <button
                    key={level}
                    type="button"
                    onClick={() => select(level)}
                    className="w-full text-left rounded-xl transition-all active:scale-[0.98]"
                    style={{
                      padding: 14,
                      minHeight: 44,
                      background: isActive ? 'var(--inner-card-green-bg)' : 'var(--inner-card-bg)',
                      border: `1.5px solid ${isActive ? 'var(--inner-card-green-border)' : 'var(--inner-card-border)'}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: isActive ? 'var(--accent)' : 'var(--text-muted)' }}>{level}</span>
                      {isActive && <span className="material-icons" style={{ fontSize: 15, color: 'var(--accent)' }}>check_circle</span>}
                    </div>
                    <p style={{ fontSize: 13, lineHeight: 1.45, color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)', margin: 0 }}>{anchor}</p>
                  </button>
                );
              })}
              <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
                <button type="button" onClick={() => setStep((s) => Math.max(s - 1, -1))} className="cc-btn cc-btn-ghost" style={{ flex: 1 }}>
                  {t('assess.back')}
                </button>
                <button type="button" onClick={() => setStep((s) => Math.min(s + 1, total))} className="cc-btn cc-btn-primary" style={{ flex: 1 }}>
                  {ratings[skill.key] !== undefined ? t('assess.next') : t('assess.skip')}
                </button>
              </div>
            </div>
          )}

          {/* Review + save */}
          {step === total && (
            <div className="space-y-4">
              <p style={{ fontSize: 15, color: 'var(--text-primary)', margin: 0, lineHeight: 1.4 }}>{t('assess.reviewCount', { rated: ratedCount, total })}</p>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('assess.reviewPrompt')}</p>
              {error && <p className="text-red-400 text-xs" role="alert">{error}</p>}
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" onClick={() => setStep(total - 1)} className="cc-btn cc-btn-ghost" style={{ flex: 1 }}>
                  {t('assess.back')}
                </button>
                <button type="button" onClick={submit} disabled={busy || ratedCount === 0} className="cc-btn cc-btn-primary" style={{ flex: 2 }}>
                  {busy ? t('assess.saving') : t('assess.save')}
                </button>
              </div>
            </div>
          )}
        </BottomSheetBody>
      </div>
    </BottomSheet>
  );
}
