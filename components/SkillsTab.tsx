'use client';

import dynamic from 'next/dynamic';
import StatsV2Shell from '@/components/stats/StatsV2Shell';
import WhereYouSitCard from '@/components/stats/WhereYouSitCard';
import ClubConsentSheet from '@/components/stats/ClubConsentSheet';
import YourRecordCard from '@/components/stats/YourRecordCard';
import WhoYouPlayWithCard from '@/components/stats/WhoYouPlayWithCard';
import LearnRegister from '@/components/stats/LearnRegister';
import GearRegister from '@/components/stats/GearRegister';
import SummaryGreeting from '@/components/stats/SummaryGreeting';
import StatsSignedOut from '@/components/stats/StatsSignedOut';
import { useStatsPrivacy, shouldPromptForComparison } from '@/lib/useStatsPrivacy';
import { isFlagOn } from '@/lib/flags';
import { useActiveName } from '@/lib/useActiveName';

// Client-only (reads localStorage identity) — these three resolve an active
// name at mount, so server-rendering them just produces markup the client
// immediately replaces.
const SkillTrendCard = dynamic(() => import('@/components/stats/SkillTrendCard'), { ssr: false });
const KudosReceivedCard = dynamic(() => import('@/components/stats/KudosReceivedCard'), { ssr: false });
const GiveKudosCard = dynamic(() => import('@/components/stats/GiveKudosCard'), { ssr: false });

/**
 * The Stats tab: the You / Play / Learn / Gear registers.
 *
 * Stage 8 (2026-08-20) deleted the v1 arrangement wholesale. Until then this
 * file carried five mutually-exclusive layouts selected by
 * `NEXT_PUBLIC_FLAG_STATS_V2` / `_SKILL_ASSESS` / `isAdmin`, including an
 * admin-only recharts radar and every surface that counted sessions you
 * MISSED (streak hero, live attendance card, recent-form dots). Those are
 * gone by product decision, not deferred: see the flag entry in `lib/flags.ts`.
 *
 * `NEXT_PUBLIC_FLAG_STATS_V2` is no longer read here — it is `'true'` in all
 * three build configs and now only guards the v2-only API routes until it
 * retires. There is no v1 to fall back to.
 */
export default function SkillsTab({ onTabChange }: { onTabChange?: (tab: 'home' | 'players' | 'skills' | 'admin' | 'profile') => void }) {
  // Identity for the signed-out empty state, from the module that owns the
  // chain. `resolved` carries "not known yet" so the first paint doesn't flash
  // the signed-out state at a signed-in member — unknown is not known-absent.
  const { name: activeName, resolved: identResolved } = useActiveName();

  // Distributed AI insights: a plain-language greeting leads the You register.
  const insightCardsOn = isFlagOn('NEXT_PUBLIC_FLAG_INSIGHT_CARDS');
  // Kudos — positive-only peer recognition (received in You; give in Play).
  const kudosOn = isFlagOn('NEXT_PUBLIC_FLAG_KUDOS');
  // Equipment register follows the Value-Hub flag; its kill-criterion gate is
  // still open, so Gear can still be withdrawn without touching the shell.
  const valueHubOn = isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE');

  const privacyState = useStatsPrivacy(activeName);
  const promptOpen = shouldPromptForComparison(privacyState);
  const comparisonKey = `${privacyState.privacy?.promptedAt ?? 'unasked'}:${privacyState.privacy?.clubComparison ?? 'unknown'}`;

  if (!identResolved) return null;
  if (!activeName) {
    return <StatsSignedOut onSignIn={onTabChange ? () => onTabChange('profile') : undefined} />;
  }

  return (
    <StatsV2Shell
      activeName={activeName}
      // No LevelCard: the overview strip above owns the level, and showing the
      // same number twice on one screen reads as two different facts.
      youSlot={
        <>
          {insightCardsOn && <SummaryGreeting />}
          {/* Both comparison-dependent cards are keyed on the answer, so
              saying yes remounts them and they re-read the bands endpoint
              — which only returns bands once the prompt is answered.
              Without this the member would answer and see nothing change
              until a reload. */}
          <SkillTrendCard key={`trend-${comparisonKey}`} />
          <WhereYouSitCard
            key={`sit-${comparisonKey}`}
            activeName={activeName}
            promptOpen={promptOpen}
          />
          {kudosOn && <KudosReceivedCard />}
          <ClubConsentSheet
            open={promptOpen}
            saving={privacyState.saving}
            onAnswer={(clubComparison) => privacyState.save(clubComparison)}
          />
        </>
      }
      playSlot={
        <>
          <YourRecordCard activeName={activeName} />
          <WhoYouPlayWithCard activeName={activeName} />
          {kudosOn && <GiveKudosCard />}
        </>
      }
      learnSlot={<LearnRegister activeName={activeName} />}
      gearSlot={valueHubOn ? <GearRegister activeName={activeName} /> : undefined}
    />
  );
}
