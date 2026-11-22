'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

type Field = 'email' | 'memo';
type CopyState = { field: Field; ok: boolean } | null;

/** How long "Copied" stays before the row reads "Copy" again. */
const COPIED_MS = 2000;

/**
 * Paying by Interac e-transfer, as rows a member taps: the club's address
 * and, when the server wrote one, the memo filled in for this member
 * (docs/plans/payment-order.md), each copied with one tap to paste into
 * their bank's app (docs/plans/etransfer-copy.md). No bank's send screen can
 * be opened from here, so this is the shortest way between the app and the
 * bank. The amount is not a row: it is the total the card already shows
 * (Grant, 2026-11-22: "we dont need the cost copy and past option").
 *
 * If the clipboard refuses, the row says so; the text stays selectable, so
 * press-and-hold still works.
 */
export default function EtransferCopy({ email, name, memo }: { email: string; name?: string | null; memo?: string | null }) {
  const t = useTranslations('etransferCopy');
  const [state, setState] = useState<CopyState>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  async function copy(field: Field, text: string) {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }
    setState({ field, ok });
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState(null), COPIED_MS);
  }

  const tag = (field: Field) => {
    const done = state?.field === field && state.ok;
    return (
      <span className={done ? 'copy-row__tag copy-row__tag--done' : 'copy-row__tag'} aria-hidden="true">
        <span className="material-icons">{done ? 'check' : 'content_copy'}</span>
        {done ? t('copied') : t('copy')}
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-2" data-testid="etransfer-copy">
      <p className="fs-sm" style={{ margin: '0', color: 'var(--text-muted)' }}>{t('howTo')}</p>
      <button type="button" className="copy-row" onClick={() => void copy('email', email)} aria-label={t('copyEmail', { email })}>
        <span className="copy-row__text">
          <span className="copy-row__label">{t('to')}</span>
          <span className="copy-row__value">{email}</span>
          {name ? <span className="copy-row__sub">{name}</span> : null}
        </span>
        {tag('email')}
      </button>
      {memo ? (
        <button type="button" className="copy-row" onClick={() => void copy('memo', memo)} aria-label={t('copyMemo', { memo })}>
          <span className="copy-row__text">
            <span className="copy-row__label">{t('memo')}</span>
            <span className="copy-row__value">{memo}</span>
          </span>
          {tag('memo')}
        </button>
      ) : null}
      {/* The row's own tag shows "Copied"; this says it to a screen reader. */}
      <p className="sr-only" role="status">
        {state?.ok ? t(state.field === 'email' ? 'copiedEmail' : 'copiedMemo') : ''}
      </p>
      {state && !state.ok && (
        <p className="field-warn" role="alert" style={{ margin: '0' }}>{t('copyFailed')}</p>
      )}
    </div>
  );
}
