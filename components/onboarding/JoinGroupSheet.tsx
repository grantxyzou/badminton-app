'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import { setIdentity } from '@/lib/identity';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  /** Prefilled from `?join=` when a link brought them here. */
  initialToken?: string | null;
  /** The name this device already goes by. */
  defaultName?: string;
  /** True when the caller is already in another club — changes the copy, not the action. */
  hasOtherGroup?: boolean;
  onJoined?: () => void;
}

/**
 * The "Join with a link or code" door.
 *
 * IT CONFIRMS BEFORE IT JOINS, even when a link brought the person straight
 * here. Joining puts your name on somebody else's roster, and the club sees it;
 * that is not a thing to do to someone because they tapped a URL in a group
 * chat. So the link is resolved to a NAME first (`GET /api/groups/preview`, the
 * one unauthenticated route, which returns the club's name and nothing else),
 * and the actual join waits for a deliberate second tap.
 *
 * ALREADY IN ANOTHER CLUB? It joins and switches, and says so. Both memberships
 * stay; "Your groups" on Profile is the way back. Refusing would be worse —
 * people belong to two clubs, and that is the entire premise here.
 *
 * ONE INPUT FOR BOTH FORMS. A pasted link and a typed code go in the same box
 * and are told apart here, because nobody holding an invite thinks of
 * themselves as holding one of two kinds of invite.
 */
export default function JoinGroupSheet({
  open,
  onClose,
  sessionId,
  initialToken,
  defaultName,
  hasOtherGroup,
  onJoined,
}: Props) {
  const t = useTranslations('onboarding.join');
  const [entry, setEntry] = useState('');
  const [rosterName, setRosterName] = useState(defaultName ?? '');
  const [found, setFound] = useState<{ name: string; token?: string; code?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A `?join=` landing resolves the club immediately, so the sheet opens
  // already saying whose it is rather than asking for something the person is
  // holding in the URL bar.
  useEffect(() => {
    if (!open || !initialToken) return;
    void resolve(initialToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialToken]);

  /**
   * A link or a code, out of one box. A link's token is the `?join=` parameter;
   * anything else is treated as a code, with separators stripped the way the
   * server strips them.
   */
  function parse(raw: string): { token?: string; code?: string } {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    if (/^https?:\/\//i.test(trimmed) || trimmed.includes('?join=')) {
      try {
        const url = new URL(trimmed, window.location.origin);
        const token = url.searchParams.get('join');
        if (token) return { token };
      } catch {
        // Not a URL after all — fall through and try it as a code.
      }
    }
    if (/^[0-9a-f]{32}$/i.test(trimmed)) return { token: trimmed };
    return { code: trimmed };
  }

  async function resolve(raw: string) {
    const parsed = parse(raw);
    if (!parsed.token && !parsed.code) return;
    setBusy(true);
    setError(null);
    try {
      const query = parsed.token
        ? `token=${encodeURIComponent(parsed.token)}`
        : `code=${encodeURIComponent(parsed.code!)}`;
      const res = await fetch(`${BASE}/api/groups/preview?${query}`, { cache: 'no-store' });
      if (!res.ok) {
        setError(t('notFound'));
        return;
      }
      const data = (await res.json()) as { name: string };
      setFound({ name: data.name, ...parsed });
    } catch {
      setError(t('failed'));
    } finally {
      setBusy(false);
    }
  }

  async function join() {
    if (!found || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/groups/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(found.token ? { token: found.token } : { code: found.code }),
          ...(rosterName.trim() ? { name: rosterName.trim() } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Not a failure of this sheet: joining needs an ACCOUNT, and the PIN
        // path is invite-list gated so a stranger cannot get one that way. The
        // token rides through the signup terminals (PR #376), so they do not
        // have to come back and re-open the link — say where to go, and name
        // the club they will land in.
        if (res.status === 401) setError(t('needsAccount', { name: found.name }));
        else if (data.error === 'roster_name_taken') setError(t('nameTaken'));
        else if (data.error === 'invite_not_found') setError(t('notFound'));
        else setError(t('failed'));
        setBusy(false);
        return;
      }
      setIdentity({ name: data.rosterName ?? rosterName.trim(), sessionId });
      onJoined?.();
      onClose();
    } catch {
      setError(t('failed'));
      setBusy(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('title')}>
      <BottomSheetHeader>{found ? t('foundTitle', { name: found.name }) : t('title')}</BottomSheetHeader>
      <BottomSheetBody>
        {found ? (
          <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
            <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-secondary)', margin: 0 }}>{t('foundHint')}</p>
            {hasOtherGroup && (
              <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: 0 }}>
                {t('switchNote', { name: found.name })}
              </p>
            )}

            <label style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <span className="section-label">{t('yourNameLabel')}</span>
              <input
                type="text"
                value={rosterName}
                onChange={(e) => {
                  setRosterName(e.target.value);
                  setError(null);
                }}
                maxLength={40}
                aria-label={t('yourNameLabel')}
                autoComplete="nickname"
              />
            </label>

            {error && <p className="field-error">{error}</p>}

            <button
              type="button"
              onClick={join}
              disabled={busy || !rosterName.trim()}
              className="cc-btn cc-btn-primary cc-btn-lg"
              style={{ width: '100%' }}
            >
              {busy ? t('joining') : t('confirm', { name: found.name })}
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void resolve(entry);
            }}
            style={{ display: 'grid', gap: 'var(--space-5)' }}
          >
            <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-secondary)', margin: 0 }}>{t('subtitle')}</p>

            <label style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <span className="section-label">{t('codeLabel')}</span>
              <input
                type="text"
                value={entry}
                onChange={(e) => {
                  setEntry(e.target.value);
                  setError(null);
                }}
                placeholder={t('codePlaceholder')}
                maxLength={200}
                autoFocus
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                aria-label={t('codeLabel')}
              />
            </label>

            {error && <p className="field-error">{error}</p>}

            <button
              type="submit"
              disabled={busy || !entry.trim()}
              className="cc-btn cc-btn-primary cc-btn-lg"
              style={{ width: '100%' }}
            >
              {busy ? t('checking') : t('check')}
            </button>
          </form>
        )}
      </BottomSheetBody>
    </BottomSheet>
  );
}
