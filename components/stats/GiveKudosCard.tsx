'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import ErrorState from '@/components/primitives/ErrorState';
import GiveKudosSheet from '@/components/stats/GiveKudosSheet';
import { useOnline } from '@/lib/useOnline';
import { useActiveName } from '@/lib/useActiveName';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * The Stats-side door to giving kudos.
 *
 * THIS CARD MUST NEVER RETURN null, and that is the whole point of the rewrite.
 *
 * It used to render only within 48h of the ACTIVE session and only for people
 * on that session's roster — then return `null` when neither held. Both keyed
 * off the ACTIVE session, which the owner advances minutes after play, so in
 * practice the card was invisible almost always. A real player asked "how do I
 * give kudos to other people?" and could not find it; the owner's own answer
 * ("log a game with them first") was wrong, because eligibility was roster-based
 * the whole time. Nobody could see the rule, so everyone invented one.
 *
 * An absent card is indistinguishable from a feature that does not exist. So
 * the card always renders and always says which of the three states it is in:
 * loading, broken, or "here is who you can thank" — including the honest empty
 * one, which explains itself rather than vanishing.
 *
 * Eligibility is NOT computed here. `GET /api/kudos/eligible` owns it, shared
 * with the POST that enforces it — the previous split is how the list and the
 * rule drifted apart.
 */
export default function GiveKudosCard() {
  const t = useTranslations('stats.kudos');
  const online = useOnline();
  /* Eligibility is resolved from the member COOKIE server-side, so this name is
     not sent anywhere — it is here as the SUBSCRIPTION. Without it the card
     fetches once on mount and then never again, so signing in while sitting on
     Stats leaves it stuck on the signed-out empty state until a reload.
     `__tests__/active-name-canary.test.ts` pins this. */
  const { name: activeName, resolved } = useActiveName();
  const [names, setNames] = useState<string[]>([]);
  const [load, setLoad] = useState<'loading' | 'ready' | 'error' | 'needsSignIn'>('loading');
  const [sheetOpen, setSheetOpen] = useState(false);

  const refresh = useCallback(async () => {
    // Unknown is not known-absent. Until the identity lookup has actually run,
    // this is still loading — rendering "play a session and people will show
    // up here" at a signed-in member on the first paint is the same class of
    // lie as an empty state built from a failed read.
    if (!resolved) { setLoad('loading'); return; }
    // Signed out: the honest empty state, without spending a 401 to learn it.
    if (!activeName) { setNames([]); setLoad('ready'); return; }
    setLoad('loading');
    try {
      const res = await fetch(`${BASE}/api/kudos/eligible`, { cache: 'no-store' });
      // A 401 here is NOT "signed out" — that case returned above without
      // fetching. The only way to reach this line is a `member_session` cookie
      // that expired past its 30-day TTL while `badminton_identity` persisted,
      // which is a state CLAUDE.md documents as live. Rendering the empty
      // state would tell someone who looks signed in that they have played
      // with nobody — the lying empty state again. Say what is actually wrong.
      if (res.status === 401) { setNames([]); setLoad('needsSignIn'); return; }
      if (!res.ok) { setLoad('error'); return; }
      const data = (await res.json()) as { names?: unknown };
      setNames(Array.isArray(data.names) ? data.names.filter((n): n is string => typeof n === 'string') : []);
      setLoad('ready');
    } catch {
      setLoad('error');
    }
  }, [activeName, resolved]);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="glass-card p-5 space-y-3">
      <CardHeader icon="volunteer_activism" title={t('giveTitle')} subtitle={t('giveHint')} />

      {load === 'error' ? (
        <ErrorState message={t('error')} />
      ) : load === 'needsSignIn' ? (
        <p className="fs-sm m-0" style={{ color: 'var(--text-muted)' }}>{t('needsSignIn')}</p>
      ) : load === 'loading' ? (
        <p className="fs-sm m-0" style={{ color: 'var(--text-muted)' }}>{t('loading')}</p>
      ) : names.length === 0 ? (
        /* The honest empty state. Says WHY there is nobody rather than
           disappearing, which is what made this unfindable. */
        <p className="fs-sm m-0" style={{ color: 'var(--text-muted)' }}>{t('emptyHint')}</p>
      ) : (
        <>
          <p className="fs-sm m-0" style={{ color: 'var(--text-muted)' }}>
            {t('candidateCount', { count: names.length })}
          </p>
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            disabled={!online}
            className="cc-btn cc-btn-primary cc-btn-lg"
            style={{ width: '100%', ...(online ? null : { opacity: 0.5 }) }}
          >
            {t('giveCta')}
          </button>
          {!online && (
            <p className="fs-sm m-0" style={{ color: 'var(--text-muted)' }}>{t('offline')}</p>
          )}
        </>
      )}

      <GiveKudosSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        candidates={names}
      />
    </div>
  );
}
