'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import { summarizeRecord, type GameRecord } from '@/lib/gameRecord';
import type { GameResult } from '@/lib/types';
import SteppedGameLoggerSheet from './SteppedGameLoggerSheet';
import LockedCard, { PreviewRow, useSignInLink } from './LockedCard';
import { sharedRead } from '@/lib/sharedRead';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Rows shown. The header count is always the FULL total, not this. */
const CAP = 8;

/**
 * "Your record" — games the member chose to log, newest first.
 *
 * This is the register's answer to what the streak hero used to do, and the
 * difference is the point: a streak counted sessions you MISSED, this counts
 * games you turned up for and logged. Nothing here can go down by not playing.
 */
export interface YourRecordCardProps {
  activeName: string | null;
}

export default function YourRecordCard({ activeName }: YourRecordCardProps) {
  const t = useTranslations('stats.record');
  const signInLink = useSignInLink();
  const tStats = useTranslations('stats');
  const [record, setRecord] = useState<GameRecord | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  const [loggerOpen, setLoggerOpen] = useState(false);
  // The logger writes into a session bucket, so it needs the active session id.
  // Resolved here rather than threaded through SkillsTab, matching how
  // GameLoggerCard has always done it. A missing id disables logging but must
  // NOT hide the record — reading and writing fail independently.
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`${BASE}/api/session`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      // Same field order as GameLoggerCard: session docs carry `sessionId`,
      // the DEFAULT_SESSION fallback carries `id`.
      .then((d) => live && setSessionId(d?.sessionId || d?.id || null))
      .catch(() => live && setSessionId(null));
    return () => {
      live = false;
    };
  }, []);

  const load = useCallback(() => {
    if (!activeName) return;
    // Shared with `OverviewStrip`'s games tile — same URL, same screen.
    sharedRead<{ games?: unknown }>(`/api/games?all=true&name=${encodeURIComponent(activeName)}`)
      .then((d) => {
        setRecord(summarizeRecord((d?.games ?? []) as GameResult[], activeName));
        setStatus('ready');
      })
      // Owner-gated: a 403 is this device not owning the name, not a failure.
      .catch((e: Error) => setStatus(e?.message === '403' ? 'forbidden' : 'error'));
  }, [activeName]);

  useEffect(() => {
    load();
  }, [load]);

  if (!activeName) return null;
  if (status === 'loading') return <CardSkeleton height={260} />;
  // Refused (this device holds no session for the name): the card stays, as
  // its own shape with nothing in it, and Sign in carries the weight.
  // No Add button: logging a game would be refused too.
  if (status === 'forbidden') {
    return (
      <LockedCard title={t('title')} message={t.rich('locked', { link: signInLink })}>
        <PreviewRow icon="sports_tennis" width="48%" value="— : —" />
        <PreviewRow icon="sports_tennis" width="40%" value="— : —" />
        <PreviewRow icon="sports_tennis" width="44%" value="— : —" />
      </LockedCard>
    );
  }

  const cta = (
    <>
      <button
        type="button"
        className="cc-btn cc-btn-primary cc-btn-lg"
        style={{ width: '100%' }}
        // No session id, no logger to open: the sheet below only mounts with
        // one. Enabled, this was a button that did nothing when tapped.
        disabled={!sessionId}
        onClick={() => setLoggerOpen(true)}
      >
        {t('add')}
      </button>
      {sessionId && (
        <SteppedGameLoggerSheet
          you={activeName}
          sessionId={sessionId}
          open={loggerOpen}
          onClose={() => setLoggerOpen(false)}
          onLogged={load}
        />
      )}
    </>
  );

  // A failed read must NOT render "0 of 0" — that is a confident, wrong answer
  // that looks exactly like a member who has never logged a game.
  if (status === 'error') {
    return (
      <div className="glass-card p-5 space-y-3">
        <Header t={t} fraction={null} />
        <ErrorState
          message={t('error')}
          action={
            <button type="button" className="cc-btn cc-btn-ghost" onClick={() => { setStatus('loading'); load(); }}>
              {tStats('retry')}
            </button>
          }
        />
        {cta}
      </div>
    );
  }

  const rec = record as GameRecord;

  return (
    <div className="glass-card p-5 space-y-3">
      {/* No fraction at zero: "0 of 0" restates what the empty state already
          says, and reads as a score rather than an absence. */}
      <Header t={t} fraction={rec.played === 0 ? null : t('fraction', { won: rec.won, played: rec.played })} />

      {rec.played === 0 ? (
        // The empty state must not hide the only action on the card.
        <EmptyState icon="sports_tennis">{t('empty')}</EmptyState>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {rec.rows.slice(0, CAP).map((g) => (
            <div
              key={g.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                padding: 'var(--space-4)',
                borderRadius: 'var(--radius-lg)',
                background: g.won ? 'var(--inner-card-green-bg)' : 'var(--inner-card-bg)',
                border: `1px solid ${g.won ? 'var(--inner-card-green-border)' : 'var(--inner-card-border)'}`,
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--fs-lg)',
                  fontWeight: 700,
                  color: g.won ? 'var(--accent)' : 'var(--text-secondary)',
                  minWidth: 56,
                }}
              >
                {g.mine}–{g.theirs}
              </span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-base)', color: 'var(--text-primary)' }}>
                {g.partners.length > 0 ? t('with', { partner: g.partners.join(' & ') }) : ''}
              </span>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                {g.won ? t('won') : t('lost')}
              </span>
            </div>
          ))}
        </div>
      )}

      {cta}
    </div>
  );
}

function Header({
  t,
  fraction,
}: {
  t: ReturnType<typeof useTranslations<'stats.record'>>;
  fraction: string | null;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
      <div>
        {/* Icon-less by design — the mono fraction is the card's own emblem. */}
        <h3 className="bpm-h3" style={{ margin: '0' }}>
          {t('title')}
        </h3>
        <p style={{ margin: 'var(--space-05) 0 0', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{t('subtitle')}</p>
      </div>
      {fraction && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--fs-stat)',
            fontWeight: 700,
            color: 'var(--accent)',
            whiteSpace: 'nowrap',
          }}
        >
          {fraction}
        </span>
      )}
    </div>
  );
}
