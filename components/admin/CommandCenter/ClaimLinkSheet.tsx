'use client';

import { useCallback, useEffect, useState } from 'react';
import { BottomSheet, BottomSheetHeader, BottomSheetBody, BottomSheetFooter } from '@/components/BottomSheet';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import ErrorState from '@/components/primitives/ErrorState';
import ActionRow from '@/components/primitives/ActionRow';
import { useOnline } from '@/lib/useOnline';
import { isRefused } from '@/lib/apiFetch';
import { shareTextOrCopy } from '@/lib/shareText';
import { invitePath } from '@/lib/inviteLink';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * The link a token travels as, from the window's own origin (as invites are,
 * lib/useInvites.ts). It is the club's DOOR link on the one-link path,
 * `/bpm/j/<token>` (docs/plans/door-link.md), so it opens the app where it is
 * installed. Links already sent as `?claim=` keep working.
 */
export function claimUrl(token: string): string {
  const path = invitePath(token, BASE);
  return typeof window === 'undefined' ? path : `${window.location.origin}${path}`;
}

interface LinkState {
  link: { token: string; createdAt: string } | null;
  unclaimed: number;
}

/**
 * The club's claim link (docs/plans/claim-your-name.md). Posted in the club
 * chat, it lets a person the organiser put on the roster ASK to be let in
 * under their own name — the organiser still approves each one from the
 * Sign-in requests card. One link, no expiry; "New link" retires the old one
 * and cancels the asks waiting on it.
 *
 * English only, like every admin screen (CLAUDE.md, Q10).
 */
export default function ClaimLinkSheet({
  open,
  onClose,
  clubName,
}: {
  open: boolean;
  onClose: () => void;
  /** For the share text; absent, the line just says "our club". */
  clubName?: string | null;
}) {
  const online = useOnline();
  const [state, setState] = useState<LinkState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<boolean | null>(null);
  const [confirmingNew, setConfirmingNew] = useState(false);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const res = await fetch(`${BASE}/api/groups/claim-link`, { cache: 'no-store' });
      if (isRefused(res)) { setLoadError('Sign in as an admin to see the club link.'); return; }
      if (!res.ok) { setLoadError('Couldn’t load the club link.'); return; }
      setState((await res.json()) as LinkState);
    } catch {
      setLoadError('Couldn’t load the club link.');
    }
  }, []);

  useEffect(() => {
    if (open) void load();
    else {
      setConfirmingNew(false);
      setError('');
      setCopied(null);
    }
  }, [open, load]);

  async function makeNew() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/api/groups/claim-link`, { method: 'POST' });
      if (!res.ok) { setError('Couldn’t make a link. Try again.'); return; }
      const data = (await res.json()) as { link: LinkState['link'] };
      setState((s) => ({ link: data.link, unclaimed: s?.unclaimed ?? 0 }));
      setConfirmingNew(false);
      setCopied(null);
    } catch {
      setError('Couldn’t make a link. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    if (!state?.link) return;
    const club = clubName?.trim() || 'our club';
    const outcome = await shareTextOrCopy({
      title: `Join ${club}`,
      text: `You're on the ${club} list. Tap to sign in under your name:`,
      url: claimUrl(state.link.token),
    });
    if (outcome === 'copied') {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } else if (outcome === 'error') {
      setError('Couldn’t share. Copy the link below instead.');
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel="Club link">
      <BottomSheetHeader onClose={onClose} closeLabel="Close">
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>Club link</span>
      </BottomSheetHeader>
      <BottomSheetBody>
        {loadError ? (
          <div className="motion-fade">
            <ErrorState
              message={loadError}
              action={
                <button type="button" className="cc-btn cc-btn-ghost" onClick={() => void load()}>
                  Try again
                </button>
              }
            />
          </div>
        ) : !state ? (
          /* The loaded sheet with a link, measured at 430px (2026-11-04): every
             visit after the first has one. Before the first link it is 163. */
          <CardSkeleton height={335} />
        ) : (
          <div className="flex flex-col gap-4 motion-fade">
            <p className="fs-md" style={{ margin: 0, color: 'var(--text-primary)' }}>
              Post this in your club chat. Anyone on the roster who has never signed in can ask to be let in under their
              own name, and you approve each one from Sign-in requests.
            </p>
            <p className="fs-xs" style={{ margin: 0, color: 'var(--text-muted)' }}>
              {state.unclaimed === 1
                ? '1 person on the roster hasn’t signed in yet.'
                : `${state.unclaimed} people on the roster haven’t signed in yet.`}{' '}
              Let in only people you know asked — the link is in the whole chat.
            </p>

            {state.link && (
              <>
                <label className="flex flex-col gap-2">
                  <span className="section-label-muted">The link</span>
                  {/* Read-only and selectable: the fallback when sharing is refused. */}
                  <input
                    key={state.link.token}
                    className="motion-fade"
                    type="text"
                    readOnly
                    value={claimUrl(state.link.token)}
                    onFocus={(e) => e.currentTarget.select()}
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                </label>
                {/* Retiring a live link is a second, deliberate tap — an action
                    row then a confirm, as the bench's "Remove" is. */}
                {!confirmingNew && (
                  <ActionRow
                    icon="link"
                    label="New link"
                    hint="Retires this one at once"
                    onClick={() => setConfirmingNew(true)}
                    disabled={busy || !online}
                  />
                )}
              </>
            )}
          </div>
        )}
      </BottomSheetBody>
      {!loadError && state && (
        <BottomSheetFooter className="flex flex-col gap-3">
          {error && <p className="field-error" role="alert">{error}</p>}
          {state.link ? (
            <>
              <button type="button" className="cc-btn cc-btn-primary cc-btn-lg" onClick={() => void share()} disabled={busy}>
                <span key={String(copied)} className={copied === null ? undefined : 'motion-fade'}>
                  {copied ? 'Copied ✓' : 'Share the link'}
                </span>
              </button>
              {confirmingNew && (
                /* Two choices side by side, as in the bench's confirmations. */
                <div className="motion-fade flex flex-col gap-3">
                  <p className="fs-sm" style={{ margin: 0, color: 'var(--text-secondary)' }}>
                    The old link stops working at once, and anyone waiting with it will need to ask again.
                  </p>
                  <div className="flex gap-3">
                    <button type="button" className="cc-btn cc-btn-ghost" style={{ flex: 1 }} onClick={() => setConfirmingNew(false)}>
                      Keep this one
                    </button>
                    <button
                      type="button"
                      className="cc-btn cc-btn-primary"
                      style={{ flex: 1 }}
                      onClick={() => void makeNew()}
                      disabled={busy || !online}
                    >
                      {busy ? 'Making…' : 'Make a new link'}
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <button
              type="button"
              className="cc-btn cc-btn-primary cc-btn-lg"
              onClick={() => void makeNew()}
              disabled={busy || !online}
            >
              {busy ? 'Making…' : 'Make the club link'}
            </button>
          )}
        </BottomSheetFooter>
      )}
    </BottomSheet>
  );
}
