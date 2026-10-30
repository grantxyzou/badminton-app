'use client';

import { useCallback, useEffect, useState } from 'react';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import Collapse from '@/components/primitives/Collapse';
import EmptyState from '@/components/primitives/EmptyState';
import StateCard, { StateLink } from '@/components/primitives/StateCard';
import Switch from '@/components/primitives/Switch';
import ProfileEyebrow from '@/components/primitives/ProfileEyebrow';
import SettingsList from '@/components/profile/SettingsList';
import { isRefused } from '@/lib/apiFetch';
import { useOnline } from '@/lib/useOnline';
import { announceClubRun } from '@/lib/useClubRun';
import { applyStyle, clubRunOf, CLUB_STYLES, withSetting, type ClubRun } from '@/lib/clubRun';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Spots per court offered. The server accepts 2–12; these are how clubs actually play. */
export const PLAYERS_PER_COURT_PRESETS = [4, 6, 8] as const;
const DEFAULT_PER_COURT = 8;

/**
 * The page's loading frame, card by card, so nothing moves when the settings
 * arrive. Measured at 430px (2026-10-29) in the state most clubs are in — BPM's
 * "First come, first served", where spots do not follow the courts and the
 * per-court choice is closed.
 */
export const CLUB_RUN_HEIGHTS = { style: 238, spots: 64, money: 64 } as const;

const STYLE_ORDER = ['first_come', 'members_first'] as const;

/**
 * "How your club runs" (docs/plans/six-feathers-onboarding.md).
 *
 * A style is a starting point: picking one writes its settings, and changing
 * any single setting afterwards makes the club "Custom". Only settings that
 * already do something are shown, because a switch that changes nothing would
 * be lying to the admin (lib/clubRun.ts).
 *
 * English only, like every admin screen (CLAUDE.md, Q10). Saves on each
 * change and rolls back to the server's answer on a refusal, the way
 * `LateCancelEditor` does.
 */
export default function ClubRunPage({ onOpenLateCancel }: { onOpenLateCancel?: () => void }) {
  const online = useOnline();
  const [run, setRun] = useState<ClubRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  /* 'failed' and 'refused' are not BPM's defaults: rendering the settings off
     a dead fetch would let the next tap overwrite what the club has set. */
  const [loadState, setLoadState] = useState<'ok' | 'failed' | 'refused'>('ok');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/admin/settings`, { cache: 'no-store' });
      if (isRefused(res)) { setLoadState('refused'); return; }
      if (!res.ok) { setLoadState('failed'); return; }
      const data = (await res.json()) as { run?: unknown };
      setRun(clubRunOf({ run: data.run }));
      setLoadState('ok');
    } catch {
      setLoadState('failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function persist(next: ClubRun) {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/api/admin/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run: { playersPerCourt: next.playersPerCourt, money: next.money } }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error === 'no_group'
          ? 'This club has no settings record yet, so this can’t be saved.'
          : 'Couldn’t save. Try again.');
        await load();
        return;
      }
      setRun(next);
      announceClubRun(next);
    } catch {
      setError('Couldn’t save. Try again.');
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-5" aria-busy="true">
        <section className="flex flex-col gap-2">
          <ProfileEyebrow>Style</ProfileEyebrow>
          <CardSkeleton height={CLUB_RUN_HEIGHTS.style} />
        </section>
        <section className="flex flex-col gap-2">
          <ProfileEyebrow>Rules</ProfileEyebrow>
          <CardSkeleton height={CLUB_RUN_HEIGHTS.spots} />
          <CardSkeleton height={CLUB_RUN_HEIGHTS.money} />
        </section>
      </div>
    );
  }

  if (loadState === 'failed') {
    return (
      <StateCard
        tone="danger"
        icon="tune"
        title="How your club runs"
        subtitle="Sign-ups, spots and money."
        message={
          <>
            Couldn&apos;t load the settings. <StateLink onClick={() => void load()}>Try again</StateLink>
          </>
        }
      >
        <span className="state-line" style={{ width: '60%', height: 'var(--space-6)' }} />
      </StateCard>
    );
  }

  if (loadState === 'refused' || !run) {
    return (
      <section className="glass-card p-4">
        <EmptyState
          action={
            <button type="button" className="cc-btn cc-btn-ghost" onClick={() => void load()}>
              Try again
            </button>
          }
        >
          Sign in as an admin to see these settings.
        </EmptyState>
      </section>
    );
  }

  const busy = saving || !online;
  const perCourtOn = run.playersPerCourt !== null;
  const moneyOn = run.money === 'split';

  return (
    <div className="flex flex-col gap-5 motion-fade">
      {/* Grouped the way the Command Center groups its settings: an eyebrow
          over each kind of thing, a choice first and the rules it fills in
          below it. */}
      <section className="flex flex-col gap-2" aria-label="Style">
        <ProfileEyebrow>Style</ProfileEyebrow>
        <div className="glass-card space-y-3">
          <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>
            Start from the style closest to how your club plays. You can change any rule below afterwards.
          </p>
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Club style">
            {STYLE_ORDER.map((key) => {
              const style = CLUB_STYLES[key];
              const selected = run.style === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={busy}
                  onClick={() => { if (!selected) void persist(applyStyle(key)); }}
                  className="cc-choice"
                >
                  <span
                    className="material-icons icon-md"
                    aria-hidden="true"
                    style={{ flex: 'none', color: selected ? 'var(--accent)' : 'var(--text-muted)', marginTop: 'var(--space-05)' }}
                  >
                    {selected ? 'radio_button_checked' : 'radio_button_unchecked'}
                  </span>
                  <span className="flex flex-col" style={{ gap: 'var(--space-05)', minWidth: 0 }}>
                    <span className="fs-md" style={{ fontWeight: 600 }}>{style.label}</span>
                    <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{style.summary}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {/* Opens when a hand edit leaves both styles (the motion system's Open). */}
          <Collapse open={run.style === 'custom'} spaceAbove="var(--space-3)">
            <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>
              Custom: your rules below no longer match either style.
            </p>
          </Collapse>
        </div>
      </section>

      <section className="flex flex-col gap-2" aria-label="Rules">
        <ProfileEyebrow>Rules</ProfileEyebrow>
        <section className="glass-card space-y-3" aria-label="Spots">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="fs-md" style={{ margin: 0, color: 'var(--text-primary)', fontWeight: 600 }}>
                Spots follow the courts
              </p>
              <p id="club-run-per-court" className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>
                {perCourtOn ? `${run.playersPerCourt} players per court` : 'Off · you type the max players each week'}
              </p>
            </div>
            <Switch
              checked={perCourtOn}
              onChange={(next) => void persist(withSetting(run, 'playersPerCourt', next ? DEFAULT_PER_COURT : null))}
              ariaLabel="Spots follow the courts"
              ariaDescribedBy="club-run-per-court"
              disabled={busy}
            />
          </div>
          <Collapse open={perCourtOn} spaceAbove="var(--space-3)">
            <div className="segment-control flex" role="radiogroup" aria-label="Players per court">
              {PLAYERS_PER_COURT_PRESETS.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={run.playersPerCourt === n}
                  onClick={() => { if (run.playersPerCourt !== n) void persist(withSetting(run, 'playersPerCourt', n)); }}
                  disabled={busy}
                  className={`flex-1 flex items-center justify-center fs-sm rounded-full ${run.playersPerCourt === n ? 'segment-tab-active' : 'segment-tab-inactive'}`}
                >
                  {n} per court
                </button>
              ))}
            </div>
          </Collapse>
        </section>

        <section className="glass-card" aria-label="Money">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="fs-md" style={{ margin: 0, color: 'var(--text-primary)', fontWeight: 600 }}>
                Collect money in the app
              </p>
              <p id="club-run-money" className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>
                {moneyOn
                  ? 'On · split the court cost and track who has paid'
                  : 'Off · you collect money outside the app, so Payments is hidden'}
              </p>
            </div>
            <Switch
              checked={moneyOn}
              onChange={(next) => void persist(withSetting(run, 'money', next ? 'split' : 'off'))}
              ariaLabel="Collect money in the app"
              ariaDescribedBy="club-run-money"
              disabled={busy}
            />
          </div>
        </section>

        {/* A way to another page is a settings row, as everywhere in admin —
            not a free-standing button. */}
        {onOpenLateCancel && (
          <SettingsList rows={[{ icon: 'schedule', label: 'Late cancellations', onClick: onOpenLateCancel }]} />
        )}
      </section>

      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}
