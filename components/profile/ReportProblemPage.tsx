'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import TopBar from '@/components/primitives/TopBar';
import { BottomSheet, BottomSheetBody, BottomSheetFooter, BottomSheetHeader } from '@/components/BottomSheet';
import { REPORT_CATEGORIES, type ReportCategory } from '@/lib/reportCategories';
import { useOnline } from '@/lib/useOnline';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
/** The server refuses longer (`MAX_MESSAGE` in app/api/report/route.ts). */
export const REPORT_MAX = 2000;
/** The counter shows from here, so it is there before it matters and not before. */
const COUNTER_FROM = 1800;

interface Props {
  /** The reporter's name when signed in, so a follow-up knows who to ask. */
  name?: string;
  onBack: () => void;
}

/**
 * "Report a problem" (docs/superpowers/specs/2026-11-09-profile-reorg-design.md §6),
 * a page in place of `ReportProblemSheet`.
 *
 * A row of starters above the box (Grant, 2026-11-09: "can we also have some
 * prefills?"): tapping one fills the box with the start of a sentence for the
 * member to finish, and tags the report with what it is about, so the reports
 * can be counted by kind without reading every one. "Something else" clears.
 * A chip never throws away words the member typed without asking first.
 */
export default function ReportProblemPage({ name, onBack }: Props) {
  const t = useTranslations('report');
  const online = useOnline();
  const box = useRef<HTMLTextAreaElement>(null);
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [message, setMessage] = useState('');
  const [asking, setAsking] = useState<ReportCategory | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<'server' | 'rateLimited' | null>(null);
  const [sent, setSent] = useState(false);

  const starter = (c: ReportCategory) => (c === 'other' ? '' : t(`chips.${c}.starter`));

  function apply(c: ReportCategory) {
    const text = starter(c);
    setCategory(c);
    setMessage(text);
    setAsking(null);
    // Straight into the box with the caret after the starter, ready to finish it.
    requestAnimationFrame(() => {
      const el = box.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(text.length, text.length);
    });
  }

  function choose(c: ReportCategory) {
    // Their own words are in the box (anything but empty or an untouched
    // starter): ask before replacing them.
    const own = message.trim() !== '' && !REPORT_CATEGORIES.some((k) => message === starter(k));
    if (own) setAsking(c);
    else apply(c);
  }

  async function send() {
    const text = message.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          name: name?.trim() || undefined,
          category: category ?? undefined,
          tab: typeof document !== 'undefined' ? document.documentElement.getAttribute('data-tab') || undefined : undefined,
          url: typeof window !== 'undefined' ? window.location.pathname : undefined,
        }),
      });
      if (res.status === 429) return setError('rateLimited');
      if (!res.ok) return setError('server');
      setSent(true);
    } catch {
      // A network failure is retryable and not the member's fault.
      setError('server');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // NOT a header-only wrapper: TopBar is sticky (StatsPrivacyScreen says why).
    <div className="animate-slideInRight flex flex-col gap-4" data-report-page>
      <TopBar title={t('title')} onBack={onBack} backLabel={t('back')} />

      {sent ? (
        <div className="glass-card p-5 flex flex-col gap-4 motion-fade" data-report-sent>
          <p className="fs-md" style={{ margin: '0', color: 'var(--text-primary)' }}>{t('success')}</p>
          <button type="button" className="btn-primary" onClick={onBack}>{t('done')}</button>
        </div>
      ) : (
        <>
          <p className="fs-base" style={{ margin: '0 var(--space-1)', color: 'var(--text-secondary)' }}>{t('help')}</p>
          <form
            className="glass-card p-5 flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (online) void send();
            }}
          >
            <p className="fs-sm" style={{ margin: '0', color: 'var(--text-muted)' }}>{t('chipsLabel')}</p>
            <div className="report-chips" role="group" aria-label={t('chipsLabel')}>
              {REPORT_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="report-chip"
                  aria-pressed={category === c}
                  onClick={() => choose(c)}
                >
                  {t(`chips.${c}.label`)}
                </button>
              ))}
            </div>
            <textarea
              ref={box}
              aria-label={t('placeholder')}
              placeholder={t('placeholder')}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={6}
              maxLength={REPORT_MAX}
              className="report-box"
            />
            {message.length >= COUNTER_FROM && (
              <p className="fs-sm" aria-live="polite" style={{ margin: '0', textAlign: 'right', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {t('counter', { count: message.length, max: REPORT_MAX })}
              </p>
            )}
            <p className="fs-sm" style={{ margin: '0', color: 'var(--text-muted)' }}>{t('whereNote')}</p>
            <button type="submit" className="btn-primary" disabled={!online || submitting || !message.trim()}>
              {submitting ? t('sending') : t('send')}
            </button>
            {!online && <p role="status" className="field-warn" style={{ margin: '0' }}>{t('offline')}</p>}
            {error && (
              <p role="alert" className="field-warn" style={{ margin: '0' }}>
                {t(error === 'rateLimited' ? 'errorRateLimited' : 'errorServer')}
              </p>
            )}
          </form>
        </>
      )}

      <BottomSheet open={asking !== null} onClose={() => setAsking(null)} ariaLabel={t('replaceTitle')}>
        <BottomSheetHeader onClose={() => setAsking(null)} closeLabel={t('keep')}>
          <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>{t('replaceTitle')}</span>
        </BottomSheetHeader>
        <BottomSheetBody>
          <p className="fs-md" style={{ margin: '0', color: 'var(--text-secondary)' }}>{t('replaceBody')}</p>
        </BottomSheetBody>
        <BottomSheetFooter>
          <div className="flex flex-col gap-3">
            <button type="button" className="btn-primary" onClick={() => asking && apply(asking)}>{t('replace')}</button>
            <button type="button" className="btn-ghost" onClick={() => setAsking(null)}>{t('keep')}</button>
          </div>
        </BottomSheetFooter>
      </BottomSheet>
    </div>
  );
}
