'use client';

import { useState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import { SKILLS } from '@/lib/assessment';
import { useOnline } from '@/lib/useOnline';

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
  const online = useOnline();
  const total = SKILLS.length;
  // step: -1 = mirror/intro, 0..total-1 = a skill, total = review/save,
  // SAVED = the v2 post-save result screen (v1 closes instead).
  const SAVED = total + 1;
  const [step, setStep] = useState(-1);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [mirror, setMirror] = useState<Mirror | null>(null);
  // Tri-state, not `mirror === null`. A failed read and a true zero are
  // different facts, and this is the screen whose whole job is reconciling
  // self-rating against actual results — so telling a member with twelve
  // games that they logged none directly biases the ratings they then enter.
  const [mirrorStatus, setMirrorStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [savedLevel, setSavedLevel] = useState<{ level: number | null; phase: string | null } | null>(null);

  // Read through a ref so the seed value can't drive the reset below.
  // `previous` is a Map built fresh in the parent's render body
  // (SkillTrendCard's `ratingMap(latest)`), so it has a new identity on every
  // parent render. In the effect's dependency array that turned "reset when
  // the sheet opens" into "reset whenever the parent happens to re-render" —
  // discarding answers mid-quiz, and snapping the just-earned result screen
  // back to the intro the moment `onSaved` refreshed the card behind it.
  const previousRef = useRef(previous);
  previousRef.current = previous;

  // Reset + seed from previous each time the sheet opens.
  useEffect(() => {
    if (!open) return;
    setStep(-1);
    setError('');
    setSavedLevel(null);
    setRatings(previousRef.current ? Object.fromEntries(previousRef.current) : {});
  }, [open]);

  // Pull recent games for the reconciliation mirror.
  useEffect(() => {
    if (!open || !name) return;
    let cancelled = false;
    setMirrorStatus('loading'); // reopening must not inherit the last result
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
        setMirrorStatus('ready');
      })
      .catch(() => { if (!cancelled) { setMirror(null); setMirrorStatus('error'); } });
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
      if (res.status === 401) {
        // Distinguishable from a generic save failure: the member_session
        // cookie (30-day TTL) has expired or never existed for this name,
        // while the localStorage identity persists indefinitely — so this is
        // a confirmed "needs to sign in again," not an unknown/offline error.
        const body = await res.json().catch(() => null);
        if (body?.error === 'needs_signin') {
          setError(t('assess.saveErrorAuth'));
          return;
        }
      }
      if (!res.ok) throw new Error(String(res.status));
      // Tell the rest of the tab immediately, so the Level tile, dimension
      // bars, phase and weekly focus are already correct behind the sheet.
      onSaved();
      // v2 does NOT close on save. Fourteen screens of self-assessment ending
      // in the sheet vanishing gives the member no idea whether any of it
      // moved anything — which is the entire reason they did it.
      //
      // The canonical level (not this snapshot's raw average) is what the
      // Level tile shows, so read that: a different number here labelled
      // "your level now" would contradict the tile two seconds later.
      setStep(SAVED);
      try {
        const r = await fetch(`${BASE}/api/stats/level?name=${encodeURIComponent(name)}`, { cache: 'no-store' });
        if (r.ok) {
          const body = await r.json();
          setSavedLevel({
            level: typeof body?.level?.level === 'number' ? body.level.level : null,
            phase: typeof body?.level?.phase === 'string' ? body.level.phase : null,
          });
        } else {
          setSavedLevel({ level: null, phase: null });
        }
      } catch {
        // The save SUCCEEDED; only the read-back failed. Show the confirmation
        // without a number rather than an error that implies nothing saved.
        setSavedLevel({ level: null, phase: null });
      }
    } catch {
      setError(t('assess.saveError'));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const skill = step >= 0 && step < total ? SKILLS[step] : null;

  // What this check-in actually moves, against the stored ratings the sheet
  // was seeded from. A skill rated the SAME still appears (it was reviewed and
  // confirmed, which is information) — only untouched skills are absent.
  const changes = SKILLS.filter((s) => ratings[s.key] !== undefined).map((s) => {
    const value = ratings[s.key];
    const before = previous?.get(s.key);
    return {
      key: s.key,
      label: s.label,
      value,
      delta: typeof before === 'number' && before !== value ? value - before : null,
    };
  });

  return (
    <BottomSheet open onClose={onClose} ariaLabel={t('assess.checkInTitle')} maxHeight="85vh">
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
        <BottomSheetHeader bare className="px-5 pt-4 pb-3">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
            <h2 className="text-lg font-bold m-0" style={{ color: 'var(--text-primary)' }}>{t('assess.checkInTitle')}</h2>
            <button
              onClick={onClose}
              aria-label={t('assess.close')}
              className="flex items-center justify-center rounded-full"
              style={{ width: 32, height: 32, background: 'var(--inner-card-bg)', border: '1px solid var(--inner-card-border)' }}
            >
              <span className="material-icons" style={{ fontSize: 'var(--icon-md)', color: 'var(--text-muted)' }}>close</span>
            </button>
          </div>
          {/* Progress track — only during the quiz steps. */}
          {skill && (
            <div style={{ marginTop: 'var(--space-4)' }}>
              {/* Counter and dimension sit ABOVE the bar, on one line. The
                  bar alone answers how far along you are, but not how far is
                  left or what you are even rating right now — both of which
                  are the questions someone eleven skills deep is asking. */}
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
                  {t('assess.step', { n: step + 1, total })}
                </span>
                <span
                  style={{
                    fontSize: 'var(--fs-2xs)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    fontWeight: 700,
                    color: 'var(--accent)',
                  }}
                >
                  {t(`assess.dim.${skill.dimension}`)}
                </span>
              </div>
              <div className="cc-progress-track" style={{ height: 4, borderRadius: 'var(--radius-pill)', overflow: 'hidden' }}>
                <div style={{ width: `${((step + 1) / total) * 100}%`, height: '100%', background: 'var(--accent)', transition: 'width 180ms var(--ease-out-quart)' }} />
              </div>
            </div>
          )}
        </BottomSheetHeader>

        <BottomSheetBody bare className="px-5 pb-8" style={{ paddingBottom: 'max(var(--space-8), env(safe-area-inset-bottom))' }}>
          {/* Intro + reconciliation mirror */}
          {step === -1 && (
            <div className="space-y-4">
              {mirrorStatus === 'error' ? (
                <ErrorState message={t('assess.error')} />
              ) : mirror && mirror.played > 0 ? (
                <div className="p-4 rounded-xl" style={{ background: 'var(--inner-card-bg)', border: '1px solid var(--inner-card-border)' }}>
                  <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: '0', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t('assess.mirrorTitle')}</p>
                  <p style={{ fontSize: 'var(--fs-lg)', color: 'var(--text-primary)', margin: 'var(--space-2) 0 0', lineHeight: 1.4 }}>
                    {t('assess.mirrorRecord', { won: mirror.won, played: mirror.played })}
                    {mirror.topPartner ? ` ${t('assess.mirrorPartner', { name: mirror.topPartner })}` : ''}
                  </p>
                </div>
              ) : mirrorStatus === 'ready' ? (
                <EmptyState>{t('assess.noGames')}</EmptyState>
              ) : null}
              <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-secondary)', margin: '0', lineHeight: 1.5 }}>{t('assess.ratePrompt')}</p>
              <button type="button" onClick={() => setStep(0)} className="cc-btn cc-btn-primary cc-btn-lg" style={{ width: '100%' }}>
                {t('assess.start')}
              </button>
            </div>
          )}

          {/* One skill per screen */}
          {skill && (
            <div className="space-y-3">
              <div>
                {/* The dimension lives up beside the step counter — printing
                    it here too would show it twice on one screen. */}
                <h3 className="bpm-h3 m-0" style={{ marginTop: 'var(--space-05)' }}>{skill.label}</h3>
              </div>
              {skill.anchors.map((anchor, i) => {
                const level = i + 1;
                const isActive = ratings[skill.key] === level;
                return (
                  <button
                    key={level}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => select(level)}
                    className="w-full text-left rounded-xl transition-all active:scale-[0.98]"
                    style={{
                      padding: 'var(--space-4)',
                      minHeight: 44,
                      background: isActive ? 'var(--inner-card-green-bg)' : 'var(--inner-card-bg)',
                      border: `1.5px solid ${isActive ? 'var(--inner-card-green-border)' : 'var(--inner-card-border)'}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-05)' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-base)', fontWeight: 700, color: isActive ? 'var(--accent)' : 'var(--text-muted)' }}>{level}</span>
                      {isActive && <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-sm)', color: 'var(--accent)' }}>check_circle</span>}
                    </div>
                    <p style={{ fontSize: 'var(--fs-base)', lineHeight: 1.45, color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)', margin: '0' }}>{anchor}</p>
                  </button>
                );
              })}
                {/* Skip becomes its own control. It used to be the SAME
                    button as Next with a flipped label, so the only way to
                    skip was to not answer — and the label changed under your
                    finger the moment you did. Two controls, one meaning
                    each. */}
                <div style={{ display: 'flex', gap: 'var(--space-4)', paddingTop: 'var(--space-1)' }}>
                  <button
                    type="button"
                    onClick={() => setStep((s) => Math.max(s - 1, -1))}
                    className="cc-btn cc-btn-ghost"
                    style={{ flex: 1, minHeight: 44 }}
                  >
                    {t('assess.back')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      // Skipping clears any rating, so the control means what
                      // it says rather than "keep whatever was seeded".
                      setRatings((r) => {
                        const next = { ...r };
                        delete next[skill.key];
                        return next;
                      });
                      setStep((s) => Math.min(s + 1, total));
                    }}
                    className="cc-btn cc-btn-ghost"
                    style={{ flex: 1, minHeight: 44 }}
                  >
                    {t('assess.skip')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep((s) => Math.min(s + 1, total))}
                    className="cc-btn cc-btn-primary"
                    style={{ flex: 1.4, minHeight: 44 }}
                  >
                    {step === total - 1 ? t('assess.review') : t('assess.next')}
                  </button>
                </div>
                {/* An escape hatch for someone re-rating three skills who
                    does not want to tap through the other eleven. */}
                <button
                  type="button"
                  onClick={() => setStep(total)}
                  className="cc-btn cc-btn-ghost"
                  style={{ alignSelf: 'center', display: 'block', margin: '0 auto', minHeight: 44 }}
                >
                  {t('assess.stopHere')}
                </button>
            </div>
          )}

          {/* Review + save */}
          {step === total && (
            <div className="space-y-4">
              <p style={{ fontSize: 'var(--fs-lg)', color: 'var(--text-primary)', margin: '0', lineHeight: 1.4 }}>{t('assess.reviewCount', { rated: ratedCount, total })}</p>

              {changes.length > 0 ? (
                // A bare count ("3 of 14 rated") does not tell you WHAT you
                // changed, so there is nothing to sanity-check before saving.
                // List the moves with their deltas.
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {changes.map((c) => (
                    <div
                      key={c.key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 'var(--space-3)',
                        padding: 'var(--space-4)',
                        borderRadius: 'var(--radius-lg)',
                        background: 'var(--inner-card-bg)',
                        border: '1px solid var(--inner-card-border)',
                      }}
                    >
                      <span style={{ fontSize: 'var(--fs-base)', color: 'var(--text-primary)' }}>{c.label}</span>
                      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-primary)' }}>
                          {c.value}
                        </span>
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 'var(--fs-xs)',
                            fontWeight: 600,
                            color:
                              c.delta === null
                                ? 'var(--text-muted)'
                                : c.delta > 0
                                  ? 'var(--accent)'
                                  : 'var(--accent-amber)',
                          }}
                        >
                          {c.delta === null ? t('assess.same') : `${c.delta > 0 ? '▲' : '▼'} ${Math.abs(c.delta)}`}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState>{t('assess.reviewPrompt')}</EmptyState>
              )}

              {changes.length > 0 && (
                <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: '0' }}>{t('assess.reviewPrompt')}</p>
              )}

              {error && <ErrorState message={error} />}
              {!online && (
                <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: '0' }}>{t('offline')}</p>
              )}
              <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
                <button
                  type="button"
                  onClick={() => setStep(-1)}
                  className="cc-btn cc-btn-ghost"
                  style={{ flex: 1, minHeight: 44 }}
                >
                  {t('assess.startOver')}
                </button>
                <button type="button" onClick={submit} disabled={!online || busy || ratedCount === 0} className="cc-btn cc-btn-primary" style={{ flex: 1.6, minHeight: 44 }}>
                  {busy ? t('assess.saving') : t('assess.save')}
                </button>
              </div>
            </div>
          )}

          {/* v2 only — the result. The sheet stays open so the fourteen
              screens end in something, instead of in the sheet vanishing. */}
          {step === SAVED && (
            <div className="space-y-4">
              <div
                style={{
                  position: 'relative',
                  overflow: 'hidden',
                  borderRadius: 'var(--radius-xl)',
                  padding: 'var(--space-6)',
                  background:
                    'linear-gradient(140deg, color-mix(in srgb, var(--accent) 82%, black), color-mix(in srgb, var(--accent-dark) 92%, black))',
                }}
              >
                <span
                  className="material-icons"
                  aria-hidden="true"
                  style={{ position: 'absolute', top: -8, right: -6, fontSize: 110, color: 'color-mix(in srgb, white 14%, transparent)', lineHeight: 1 }}
                >
                  emoji_events
                </span>
                <div style={{ position: 'relative' }}>
                  <span style={{ fontSize: 'var(--fs-2xs)', color: 'color-mix(in srgb, white 86%, transparent)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
                    {t('assess.savedEyebrow')}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
                    {/* Same hero-number treatment as StatCard size="hero" —
                        responsive rather than a fixed 48, so it does not
                        crowd the sheet on a narrow phone. */}
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'clamp(40px, 13vw, 56px)', fontWeight: 700, color: 'white', lineHeight: 1 }}>
                      {savedLevel?.level !== null && savedLevel?.level !== undefined ? savedLevel.level.toFixed(1) : '—'}
                    </span>
                    <span style={{ fontSize: 'var(--fs-lg)', color: 'color-mix(in srgb, white 86%, transparent)', fontWeight: 600 }}>
                      {t('level.ofFive')}
                    </span>
                  </div>
                  {savedLevel?.phase && (
                    <p style={{ margin: 'var(--space-3) 0 0', fontSize: 'var(--fs-sm)', color: 'color-mix(in srgb, white 78%, transparent)' }}>
                      {t(`assess.phase.${savedLevel.phase}`)}
                    </p>
                  )}
                </div>
              </div>
              <p style={{ margin: '0', fontSize: 'var(--fs-base)', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
                {t('assess.savedBody')}
              </p>
              <button type="button" onClick={onClose} className="cc-btn cc-btn-primary cc-btn-lg" style={{ width: '100%' }}>
                {t('assess.done')}
              </button>
            </div>
          )}
        </BottomSheetBody>
      </div>
    </BottomSheet>
  );
}
