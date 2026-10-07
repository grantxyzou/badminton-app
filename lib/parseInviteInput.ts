/**
 * A link or a code, out of ONE box.
 *
 * Nobody holding an invite thinks of themselves as holding one of two kinds of
 * invite, so the sign-up field and the join page both take whatever was pasted
 * and tell the forms apart here. A link's token is its `?join=` parameter; a
 * bare 32-hex string is a token someone copied out of a link; anything else is
 * a typed code, which the server normalises itself.
 *
 * Pure, so it runs under node and the two screens that used to carry their own
 * copy (`SignedOutShell`'s sign-up view and `JoinGroupPage`) cannot drift —
 * pass `window.location.origin` as `origin` so a relative `?join=` resolves.
 */
export interface InviteInput {
  token?: string;
  code?: string;
}

const TOKEN = /^[0-9a-f]{32}$/i;

export function parseInviteInput(raw: string, origin = 'http://localhost'): InviteInput {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  if (/^https?:\/\//i.test(trimmed) || trimmed.includes('?join=')) {
    try {
      const token = new URL(trimmed, origin).searchParams.get('join');
      if (token) return { token };
    } catch {
      // Not a URL after all — fall through and try it as a token or a code.
    }
  }
  if (TOKEN.test(trimmed)) return { token: trimmed };
  return { code: trimmed };
}
