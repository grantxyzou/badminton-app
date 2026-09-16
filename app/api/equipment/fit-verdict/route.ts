import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getContainer, ensureContainer } from '@/lib/cosmos';
import { verifyMemberAuth, requireMember, isAdminAuthedWithMember } from '@/lib/auth';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { isFlagOn } from '@/lib/flags';
import { resolveGroupId } from '@/lib/groupContext';
import { groupScope, groupDocId } from '@/lib/groupScope';
import { resolveActiveMemberId } from '@/lib/memberResolve';
import { readGearOrNull } from '@/lib/racketFitInput';
import { ensureCatalogSeeded } from '@/lib/catalogSeed';
import { activeRacket } from '@/lib/activeRacket';
import { buildProfile } from '@/lib/racketProfile';
import { getCanonicalLevel } from '@/lib/levelStore';
import { computeFitFacts, type FitFacts } from '@/lib/fitVerdict';
import { buildCopyPrompt, checkCopy, copyKey, type CopyLocale, type FitVerdictCopy } from '@/lib/fitVerdictCopy';
import { INSIGHT_MODEL } from '@/lib/aiModels';
import type { Rating } from '@/lib/assessment';
import type { CatalogItem, PlayerGear } from '@/lib/types';

/**
 * The fit verdict for one frame: the FACTS, always, and the WORDS when an AI
 * may write them (`lib/fitVerdict.ts`, `lib/fitVerdictCopy.ts`).
 *
 * OWNER ONLY — deliberately no admin-on-behalf branch, unlike the share card.
 * The facts are built from the soreness answer the gear GET strips from
 * everyone but its owner, and prose written from them would carry it past that
 * guard. An admin's cookie counts only as the admin THEMSELVES: the admin login
 * mints no member session, and refusing someone their own verdict for how they
 * signed in would be a lock, not a guard.
 *
 * `?frame=<catalogId>` judges a frame the member might play (the frame page);
 * without it, the racket in play. `checkInLevel` rides along so the page can
 * pre-fill its level row without a second read (null once they set their own).
 *
 * Words: with NEXT_PUBLIC_FLAG_FIT_VERDICT on and a key configured, the model
 * phrases the decided state, cached per member per frame in `insights` and
 * keyed on the facts, the language and the prompt version — a changed answer
 * writes new words, an unchanged one never calls the model again. Flag off, no
 * key, a failure, or a reply off the contract: `copy: null`, and the page words
 * the same facts from its own strings. Nothing to judge (`insufficient`) never
 * calls the model at all.
 *
 * A reply off the contract is ASKED ONCE MORE straight away, and only a second
 * miss is CACHED, as a rejection, for `REJECTION_RETRY_MS`. Production showed
 * misses are one-offs: the 2026-09-15 rejection was followed two seconds later
 * by a reply that passed. So a lone miss must not hold a member on the
 * templates, and a pair of them must not re-ask on every view either (the words
 * were once cached only on success, and failing facts asked on every load).
 * Changed facts still make a new key and ask at once. A THROWN call
 * (overloaded, timeout) is neither retried nor cached: that is the service, not
 * these facts. The log names the rule that broke and never the reply.
 */

export const dynamic = 'force-dynamic';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MAX_OUTPUT_TOKENS = 400;
/** Replies asked for per view before falling back: the first, and one retry. */
const COPY_ATTEMPTS = 2;
/** How long a twice-rejected verdict stands before the same facts ask again. */
const REJECTION_RETRY_MS = 60 * 60 * 1000;

let insightsReady: Promise<void> | null = null;
function ensureInsights(): Promise<void> {
  if (!insightsReady) {
    insightsReady = ensureContainer('insights', '/memberId').catch((err) => {
      insightsReady = null;
      throw err;
    });
  }
  return insightsReady;
}

interface VerdictCopyDoc {
  id: string;
  memberId: string;
  kind: 'fitverdict';
  key: string;
  /** Null when the reply was off the contract: a cached rejection. */
  copy: FitVerdictCopy | null;
  /** The rule a rejected reply broke (`CopyRejection.rule`). */
  rejected?: string;
  generatedAt: string;
}

async function catalogRow(id: string, category: 'racket' | 'string'): Promise<CatalogItem | null> {
  try {
    await ensureCatalogSeeded();
    const { resource } = await getContainer('equipmentCatalog').item(id, category).read();
    return (resource as CatalogItem | undefined) ?? null;
  } catch {
    return null;
  }
}

async function latestRatings(memberId: string): Promise<Rating[]> {
  try {
    await ensureContainer('assessments', '/memberId');
    const { resources } = await getContainer('assessments').items
      .query({
        query: 'SELECT c.memberId, c.takenAt, c.ratings FROM c WHERE c.memberId = @memberId',
        parameters: [{ name: '@memberId', value: memberId }],
      })
      .fetchAll();
    const latest = (resources as { memberId?: string; takenAt?: string; ratings?: unknown }[])
      .filter((a) => a && a.memberId === memberId && typeof a.takenAt === 'string')
      .sort((a, b) => (a.takenAt! < b.takenAt! ? 1 : -1))[0];
    return (latest?.ratings as Rating[]) ?? [];
  } catch {
    // The pairing falls back to the level's starting point; the verdict stands.
    return [];
  }
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`fit-verdict:${ip}`, 60, 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const gate = await requireMember(req);
  if (!gate.ok) return gate.response;

  const url = new URL(req.url);
  const name = url.searchParams.get('name')?.trim().slice(0, 50) ?? '';
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 });
  const frameParam = url.searchParams.get('frame')?.trim().slice(0, 120) || null;

  try {
    const member = verifyMemberAuth(req);
    const admin = member ? null : await isAdminAuthedWithMember(req);
    const callerId = member?.memberId ?? (admin?.authed ? admin.memberId : null);
    if (!callerId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    const groupId = resolveGroupId(req);
    const memberId = await resolveActiveMemberId(groupId, name);
    if (!memberId || callerId !== memberId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const gear: PlayerGear | null = await readGearOrNull(memberId);
    const racket = activeRacket(gear);
    const prospective = !!frameParam && frameParam !== racket?.catalogId;
    const frameId = frameParam ?? racket?.catalogId ?? null;
    const frameRow = frameId ? await catalogRow(frameId, 'racket') : null;
    if (prospective && !frameRow) return NextResponse.json({ error: 'frame_not_found' }, { status: 404 });

    const newest = prospective ? null : [...(gear?.items ?? [])].reverse().find((i) => i && !i.retiredAt && i.category === 'string');
    const stringRow = newest?.catalogId ? await catalogRow(newest.catalogId, 'string') : null;
    const profile = buildProfile({ ratings: await latestRatings(memberId), gear });

    // The canonical level is two unbounded scans (lib/levelStore.ts). It feeds
    // the tension range, which the cache key is built from, so it cannot wait
    // for a cache hit the way the insight route's can — but a member who set
    // their own level never needs it.
    const checkInLevel = gear?.fitLevelOverride
      ? null
      : await getCanonicalLevel({ memberId, name }, groupId).then((l) => l?.level ?? null).catch(() => null);

    const facts: FitFacts = computeFitFacts({ gear, frameRow, stringRow, profile, checkInLevel, prospective });

    if (facts.state === 'insufficient' || !isFlagOn('NEXT_PUBLIC_FLAG_FIT_VERDICT') || !process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ facts, checkInLevel, copy: null });
    }

    const locale: CopyLocale = req.cookies.get('NEXT_LOCALE')?.value === 'zh-CN' ? 'zh-CN' : 'en';
    const key = copyKey(facts, locale);
    const scope = groupScope(groupId);
    // One cached doc per member per frame, overwritten when the facts move, so
    // answering a question does not leave a trail of stale verdicts behind.
    const id = groupDocId(groupId, `fitverdict:${memberId}:${frameId ?? 'typed'}`);

    try {
      await ensureInsights();
      const cached = await scope.read<VerdictCopyDoc>('insights', id, memberId);
      if (cached && cached.key === key) {
        if (cached.copy) return NextResponse.json({ facts, checkInLevel, copy: cached.copy, cached: true });
        const age = Date.now() - Date.parse(cached.generatedAt);
        if (cached.rejected && age >= 0 && age < REJECTION_RETRY_MS) {
          return NextResponse.json({ facts, checkInLevel, copy: null, cached: true });
        }
      }
    } catch (err) {
      console.warn('fit-verdict cache read failed (non-fatal):', err);
    }

    let copy: FitVerdictCopy | null = null;
    let rejected: string | undefined;
    try {
      for (let attempt = 1; attempt <= COPY_ATTEMPTS && !copy; attempt++) {
        const message = await anthropic.messages.create({
          model: INSIGHT_MODEL,
          max_tokens: MAX_OUTPUT_TOKENS,
          messages: [{ role: 'user', content: buildCopyPrompt(facts, locale) }],
        });
        const text = message.content[0]?.type === 'text' ? message.content[0].text : '';
        const check = checkCopy(text, facts);
        copy = check.copy;
        rejected = check.rejection?.rule;
        if (check.rejection) {
          // The rule always; the reply itself only outside production, because it
          // is written from arm-history facts. Constant messages, values in the
          // payload. Both start "fit-verdict copy off contract" for one grep.
          const last = attempt === COPY_ATTEMPTS;
          console.warn(last ? 'fit-verdict copy off contract; using templated copy' : 'fit-verdict copy off contract; asking once more', {
            ...check.rejection,
            attempt,
            state: facts.state,
            reasons: facts.reasons.length,
            locale,
            ...(process.env.NODE_ENV === 'production' ? {} : { reply: text.slice(0, 600) }),
          });
        }
      }
    } catch (err) {
      console.error('fit-verdict generation failed:', err);
      return NextResponse.json({ facts, checkInLevel, copy: null });
    }

    if (copy || rejected) {
      const doc: VerdictCopyDoc = { id, memberId, kind: 'fitverdict', key, copy, ...(rejected ? { rejected } : {}), generatedAt: new Date().toISOString() };
      try {
        await scope.upsert('insights', doc);
      } catch (err) {
        console.warn('fit-verdict cache write failed (non-fatal):', err);
      }
    }
    return NextResponse.json({ facts, checkInLevel, copy, cached: false });
  } catch (error) {
    console.error('GET equipment/fit-verdict error:', error);
    return NextResponse.json({ error: 'load_failed' }, { status: 500 });
  }
}
