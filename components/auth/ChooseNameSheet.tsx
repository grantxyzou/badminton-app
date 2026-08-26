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
}

/**
 * The "pick a display name" step for a brand-new provider account.
 *
 * Resolution rule 4 cannot finish inside the OAuth callback: it needs a name,
 * and must refuse names that already belong to someone. The callback therefore
 * parks the verified provider identity in a signed 10-minute cookie and
 * redirects here with `?authFlow=name`.
 *
 * The name is the ONLY thing this posts. The provider identity travels in the
 * cookie, signed, so the client cannot assert an identity the provider never
 * vouched for.
 *
 * `name_taken` is a real outcome with a real instruction, not a generic error:
 * an existing member hitting it is almost certainly THEMSELVES, arriving on a
 * new device — and the correct move is to sign in with their PIN first and
 * connect the provider from Profile, which routes them into rule 2.
 */
export default function ChooseNameSheet({ open, onClose, sessionId }: Props) {
  const t = useTranslations('profile.auth');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Apple sends a name on the FIRST authorization only, and the callback parks
  // it in a signed HttpOnly cookie this component cannot read. Asking the
  // server for it is the only way to prefill; Google never sends one, so this
  // usually resolves to empty.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`${BASE}/api/auth/complete-signup`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.suggestedName) setName(String(d.suggestedName).slice(0, 50));
      })
      .catch(() => {
        // No prefill is a fine outcome -- the user types their name.
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/auth/complete-signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (data.error === 'name_taken') setError(t('nameTaken'));
        else if (data.error === 'no_pending_signup') setError(t('pendingExpired'));
        else if (data.error === 'already_linked') setError(t('alreadyLinked'));
        else if (data.error === 'email_taken') setError(t('emailTaken'));
        else setError(t('genericError'));
        setBusy(false);
        return;
      }

      // The server already set member_session; mirror the name into
      // localStorage so the rest of the app (which reads `badminton_identity`)
      // sees the same person. No deleteToken: this is an account, not a session
      // signup — that arrives when they join a week.
      setIdentity({ name: data.name, sessionId });
      onClose();
    } catch {
      setError(t('genericError'));
      setBusy(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('chooseNameTitle')}>
      <BottomSheetHeader>{t('chooseNameTitle')}</BottomSheetHeader>
      <BottomSheetBody>
        <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-primary)', margin: 0 }}>
          {t('chooseNameBody')}
          </p>
          <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('chooseNamePlaceholder')}
          maxLength={50}
          autoFocus
          aria-label={t('chooseNameTitle')}
          autoComplete="nickname"
          />
          {error && <p className="field-error">{error}</p>}
          <button
          type="submit"
          disabled={busy || !name.trim()}
          className="cc-btn cc-btn-primary cc-btn-lg"
          style={{ width: '100%' }}
        >
          {busy ? t('chooseNameSaving') : t('chooseNameCta')}
          </button>
        </form>
      </BottomSheetBody>
    </BottomSheet>
  );
}
