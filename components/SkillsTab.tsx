'use client';

import dynamic from 'next/dynamic';
import { useEffect } from 'react';
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
import { recordEngagement } from '@/lib/engagement';

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
 * file carried five mutually-exclusive layouts selected by a stats-v2 flag,
 * `_SKILL_ASSESS` and `isAdmin`, including an admin-only recharts radar and
 * every surface that counted sessions you MISSED (streak hero, live attendance
 * card, recent-form dots). Those are gone by product decision, not deferred.
 *
 * The stats-v2 flag was RETIRED on 2026-08-25: it had been inert-on since
 * Stage 8 (no UI read it, `'true'` in every build config, and turning it off
 * restored nothing — it only 404'd three API routes and left the tab showing
 * load errors). This layout is now simply the layout.
 */
export default function SkillsTab({ onTabChange }: { onTabChange?: (tab: 'home' | 'players' | 'skills' | 'admin' | 'profile') => void }) {
  // Identity for the signed-out empty state, from the module that owns the
  // chain. `resolved` carries "not known yet" so the first paint doesn't flash
  // the signed-out state at a signed-in member — unknown is not known-absent.
  const { name: activeName, resolved: identResolved } = useActiveName();

  // Equipment register follows the Value-Hub flag; its kill-criterion gate is
  // still open, so Gear can still be withdrawn without touching the shell.
  const valueHubOn = isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE');

  /**
   * "Did anyone open Stats at all?" — the question nothing in the app could
   * answer, and the one the whole skill readout rests on. Every other ratio in
   * `slice0.skill` is conditioned on this one.
   *
   * Keyed on the RESOLVED identity, not on mount. This component returns `null`
   * while `identResolved` is false, so a mount-time beacon would fire for an
   * unresolved viewer and then again for the real one.
   *
   * It counts MEMBERS, never events, on the reader side — `HomeShell` keys this
   * tab's wrapper on `refreshNonce`, so a pull-to-refresh remounts and fires
   * again. That is a property of the metric, not a caveat on it.
   *
   * Fire-and-forget by design: an anonymous viewer holds no `member_session`,
   * gets a 401, and is correctly uncounted. Nothing the member sees depends on
   * this call.
   */
  useEffect(() => {
    if (identResolved && activeName) void recordEngagement('stats_open');
  }, [identResolved, activeName]);

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
          {/* Distributed AI insight: a plain-language greeting leads You. */}
          <SummaryGreeting />
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
          <KudosReceivedCard />
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
          <GiveKudosCard />
        </>
      }
      learnSlot={<LearnRegister activeName={activeName} />}
      gearSlot={valueHubOn ? <GearRegister activeName={activeName} /> : undefined}
    />
  );
}
