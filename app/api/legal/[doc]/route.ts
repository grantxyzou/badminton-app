import { NextRequest, NextResponse } from 'next/server';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { deepMerge, brandMessages, type MessageTree } from '@/lib/messageTree';
import { rawList } from '@/lib/rawList';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

/**
 * The legal pages' COPY as data (privacy, terms, support), so the marketing
 * site can show them at its own address in its own design while the app keeps
 * the one copy (`messages/*.json`, `legal.<doc>`). Public by nature: it is the
 * same text `/legal/<doc>` renders to anyone, with no club data in it.
 *
 * `?locale=zh-CN` returns the Chinese copy (English under it, as the pages
 * merge it). Support carries the operator's address from `SUPPORT_EMAIL`, the
 * same App Setting the support page reads; absent → `null`.
 */
const DOCS = { privacy: 'privacy', terms: 'terms', support: 'support' } as const;
type Doc = keyof typeof DOCS;

interface Section { h: string; p: string[] }

function treeFor(locale: 'en' | 'zh-CN'): MessageTree {
  const base = en as unknown as MessageTree;
  return brandMessages(locale === 'zh-CN' ? deepMerge(base, zh as unknown as MessageTree) : base);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ doc: string }> }) {
  if (!checkRateLimit(`legal:${getClientIp(req)}`, 120, 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const { doc } = await ctx.params;
  if (!Object.prototype.hasOwnProperty.call(DOCS, doc)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const locale = req.nextUrl.searchParams.get('locale') === 'zh-CN' ? 'zh-CN' : 'en';
  const legal = treeFor(locale).legal as MessageTree;
  const node = legal[doc as Doc] as MessageTree;
  const common = legal.common as MessageTree;
  const sections = rawList<Section>(node.sections).map((s) => ({ h: String(s.h), p: rawList<string>(s.p).map(String) }));

  return NextResponse.json(
    {
      doc,
      locale,
      title: String(node.title),
      updated: String(node.updated),
      updatedLabel: String(common.updated).replace('{date}', String(node.updated)),
      sections,
      supportEmail: doc === 'support' ? process.env.SUPPORT_EMAIL?.trim() || null : null,
      emailLabel: doc === 'support' ? String(node.emailLabel) : null,
    },
    { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=3600' } },
  );
}
