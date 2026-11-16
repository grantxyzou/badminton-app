/**
 * POST /api/stringing/stocktake/scan — read a photo of the string shelf
 * (docs/plans/string-photo-stocktake.md). Sends the one photo and this club's
 * shelf list to the model and answers what it saw: per item the shelf label
 * (or null when it could not tell), reel or packet, how many, how full a reel
 * looks, its colour. Nothing is SAVED here: the counter checks each line and
 * saves through `POST /api/stringing/stocktake`. The photo is never stored or
 * logged.
 *
 * Admins and the club's stringers, after a per-caller rate limit and a
 * per-person daily cap (it spends API budget). No key configured: 503
 * `ai_unavailable`, and the sheet offers counting by hand.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { isFlagOn } from '@/lib/flags';
import { stringingServiceOnFor } from '@/lib/stringingService';
import { readOfferedStringsWithLinks } from '@/lib/stringingStrings';
import { readStringCatalog } from '@/lib/stringStock';
import { stocktakeCaller } from '@/lib/stringStocktake';
import {
  MAX_PHOTO_BASE64, PHOTO_MEDIA_TYPES, ScanReplySchema, buildScanPrompt, checkScanReply, type PhotoMediaType,
} from '@/lib/stringStocktakeScan';
import { reelColourEnglish } from '@/lib/stringPalette';
import { STOCKTAKE_MODEL } from '@/lib/aiModels';
import { takeClubAiCall } from '@/lib/aiBudget';

export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!checkRateLimit(`stocktake-scan:${getClientIp(req)}`, 20, 60 * 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const groupId = resolveGroupId(req);
  const caller = await stocktakeCaller(req, groupId);
  if (!caller) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!(await stringingServiceOnFor(groupId))) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'ai_unavailable' }, { status: 503 });
  // A stocktake is a few photos a month; thirty a day is a runaway client.
  if (!checkRateLimit(`stocktake-scan-member:${caller.memberId}`, 30, DAY_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const image = typeof body.image === 'string' ? body.image : '';
  const mediaType = (PHOTO_MEDIA_TYPES as readonly string[]).includes(body.mediaType as string) ? (body.mediaType as PhotoMediaType) : null;
  if (!image || !mediaType || image.length > MAX_PHOTO_BASE64 || !BASE64.test(image)) {
    return NextResponse.json({ error: 'invalid_photo' }, { status: 400 });
  }

  try {
    const [offered, catalog] = await Promise.all([readOfferedStringsWithLinks(groupId), readStringCatalog()]);
    if (!offered) throw new Error('offered strings unreadable');
    if (offered.strings.length === 0) return NextResponse.json({ items: [] });
    const shelf = offered.strings.map((label) => {
      const item = offered.links[label] ? catalog.get(offered.links[label]) : undefined;
      const colours = (offered.colours[label] ?? [])
        .map((id) => reelColourEnglish(id, offered.customColours))
        .filter((c): c is string => !!c);
      return { label, ...(item ? { catalogName: `${item.brand} ${item.model}` } : {}), colours };
    });

    // The club's daily allowance on the shared key (lib/aiBudget.ts), taken
    // only now, just before a real call; over it, the sheet counts by hand.
    if (!takeClubAiCall(groupId, 'stocktake')) {
      console.warn('[club-ai-cap]', { feature: 'stocktake', groupId });
      return NextResponse.json({ error: 'club_ai_limit' }, { status: 429 });
    }
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await anthropic.beta.messages.parse({
      model: STOCKTAKE_MODEL,
      max_tokens: 4000,
      // If the model declines, the API retries on its default fallback in the same call.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(ScanReplySchema) },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
          { type: 'text', text: buildScanPrompt(shelf) },
        ],
      }],
    });
    if (message.stop_reason === 'refusal' || !message.parsed_output) {
      return NextResponse.json({ error: 'photo_unreadable' }, { status: 422 });
    }
    return NextResponse.json({ items: checkScanReply(message.parsed_output, offered.strings) });
  } catch (err) {
    // Never the photo: the status and message only.
    console.error('POST /api/stringing/stocktake/scan failed', err instanceof Anthropic.APIError ? { status: err.status, message: err.message } : err);
    return NextResponse.json({ error: 'scan_failed' }, { status: 503 });
  }
}
