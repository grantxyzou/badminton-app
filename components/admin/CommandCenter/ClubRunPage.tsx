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
import { fmtSessionLabel, fmtTime } from '@/lib/fmt';
import { announceClubRun } from '@/lib/useClubRun';
import { applyStyle, clubRunOf, CLUB_STYLES, withSetting, type ClubRun } from '@/lib/clubRun';
import {
  DEFAULT_MEMBERS_FIRST,
  MEMBERS_FIRST_DAYS_MAX,
  MEMBERS_FIRST_DAYS_MIN,
  membersFirstEnd,
  sameMembersFirst,
  type MembersFirst,
} from '@/lib/membersFirst';

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
export const CLUB_RUN_HEIGHTS = { style: 238, spots: 64, money: 64, window: 64 } as const;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** The session's weekday on the club's clock (Vancouver, as every session time is shown). */
function weekdayOf(iso: string): number | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const name = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'America/Vancouver' }).format(new Date(ms));
  const i = WEEKDAYS.indexOf(name as (typeof WEEKDAYS)[number]);
  return i < 0 ? null : i;
}

/** "11:59 PM" for "23:59". */
function clockLabel(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "Monday 11:59 PM" when the session's day is known, else "5 days before, 11:59 PM". */
export function windowLabel(rule: MembersFirst, sessionDay: number | null): string {
  if (sessionDay === null) {
    return `${rule.daysBefore} day${rule.daysBefore === 1 ? '' : 's'} before, ${clockLabel(rule.time)}`;
  }
  return `${WEEKDAYS[(sessionDay - rule.daysBefore + 7) % 7]} ${clockLabel(rule.time)}`;
}

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
  /* What the members-first row says around its setting. Both are extras: a
     failed read hides the line, never the setting. */
  const [session, setSession] = useState<{ datetime?: string; membersFirst?: unknown } | null>(null);
  const [unmarked, setUnmarked] = useState<number | null>(null);
  const [timeDraft, setTimeDraft] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [sRes, mRes] = await Promise.all([
          fetch(`${BASE}/api/session`, { cache: 'no-store' }),
          fetch(`${BASE}/api/members`, { cache: 'no-store' }),
        ]);
        if (!live) return;
        if (sRes.ok) setSession((await sRes.json()) as { datetime?: string; membersFirst?: unknown });
        if (mRes.ok) {
          const rows = (await mRes.json()) as Array<{ active?: boolean; regular?: boolean }>;
          if (Array.isArray(rows)) setUnmarked(rows.filter((r) => r.active !== false && typeof r.regular !== 'boolean').length);
        }
      } catch {
        /* the extras stay hidden */
      }
    })();
    return () => { live = false; };
  }, []);

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
        body: JSON.stringify({ run: { playersPerCourt: next.playersPerCourt, money: next.money, membersFirst: next.membersFirst } }),
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
          <CardSkeleton height={CLUB_RUN_HEIGHTS.window} />
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
  const rule = run.membersFirst;
  const sessionDay = session?.datetime ? weekdayOf(session.datetime) : null;
  const sessionEnd = rule && session?.datetime ? membersFirstEnd(session.datetime, rule) : null;
  /* The rule is copied onto a session when it is created, so a change reaches
     the next one; say so whenever this week's differs from the setting. */
  const thisWeek = session && typeof session.membersFirst === 'object' ? (session.membersFirst as MembersFirst) : null;
  const startsNext = session?.datetime !== undefined && !sameMembersFirst(thisWeek, rule);
  const saveRule = (next: MembersFirst | null) => void persist(withSetting(run, 'membersFirst', next));

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
        <section className="glass-card" aria-label="Members first">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="fs-md" style={{ margin: 0, color: 'var(--text-primary)', fontWeight: 600 }}>
                Members first
              </p>
              <p id="club-run-members-first" className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>
                {rule
                  ? `On · members get first pick until ${windowLabel(rule, sessionDay)}`
                  : 'Off · whoever signs up first gets the spot'}
              </p>
            </div>
            <Switch
              checked={rule !== null}
              onChange={(next) => saveRule(next ? { ...DEFAULT_MEMBERS_FIRST } : null)}
              ariaLabel="Members first"
              ariaDescribedBy="club-run-members-first"
              disabled={busy}
            />
          </div>
          <Collapse open={rule !== null} spaceAbove="var(--space-3)">
            {rule && (
              <div className="flex flex-col gap-3">
                <div className="flex gap-3">
                  <label className="flex flex-col gap-2" style={{ flex: 1, minWidth: 0 }}>
                    <span className="section-label-muted">Until</span>
                    <select
                      className="fs-md"
                      value={rule.daysBefore}
                      disabled={busy}
                      onChange={(e) => saveRule({ ...rule, daysBefore: Number(e.target.value) })}
                    >
                      {Array.from({ length: MEMBERS_FIRST_DAYS_MAX - MEMBERS_FIRST_DAYS_MIN + 1 }, (_, i) => i + MEMBERS_FIRST_DAYS_MIN).map((d) => (
                        <option key={d} value={d}>
                          {sessionDay === null ? `${d} day${d === 1 ? '' : 's'} before` : WEEKDAYS[(sessionDay - d + 7) % 7]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-2" style={{ flex: 1, minWidth: 0 }}>
                    <span className="section-label-muted">At</span>
                    <input
                      type="time"
                      value={timeDraft ?? rule.time}
                      disabled={busy}
                      onChange={(e) => setTimeDraft(e.target.value)}
                      onBlur={() => {
                        const next = timeDraft;
                        setTimeDraft(null);
                        if (next && /^\d{2}:\d{2}$/.test(next) && next !== rule.time) saveRule({ ...rule, time: next });
                      }}
                      style={{ height: '42px' }}
                    />
                  </label>
                </div>
                <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>
                  Until then, only people marked member get a spot; everyone else waits. After it, the waitlist moves
                  up in sign-up order and each person gets a push.
                  {sessionEnd && session?.datetime
                    ? ` For ${fmtSessionLabel(session.datetime)}, that’s ${fmtSessionLabel(sessionEnd)} at ${fmtTime(sessionEnd)}.`
                    : ''}
                </p>
                {startsNext && (
                  <p key="starts-next" className="fs-sm motion-fade" style={{ margin: 0, color: 'var(--text-secondary)' }}>
                    Starts with the next session you create.
                  </p>
                )}
                {unmarked !== null && unmarked > 0 && (
                  <p className="fs-sm" style={{ margin: 0, color: 'var(--sev-warn)' }}>
                    {unmarked === 1
                      ? '1 person on the roster isn’t marked member or drop-in, so they wait with the drop-ins.'
                      : `${unmarked} people on the roster aren’t marked member or drop-in, so they wait with the drop-ins.`}
                  </p>
                )}
              </div>
            )}
          </Collapse>
        </section>

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
