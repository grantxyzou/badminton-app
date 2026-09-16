'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import PinInput from '@/components/PinInput';
import { useOnline } from '@/lib/useOnline';
import type { HandoffCollect } from '@/lib/useHandoffCollect';

/**
 * Typing the six digits a Google/Apple sign-in showed, into the app that
 * started it.
 *
 * This is the fallback, not the main road. From the installed iOS web app the
 * sign-in runs in a pop-up that posts its code back by itself; this sheet opens
 * only when nothing reported back — a blocked pop-up, the full-page Safari trip,
 * or a pop-up that lost its opener. The code is what proves the sign-in was
 * finished by the person holding this phone, not by whoever was sent a link
 * (lib/authHandoff.ts, guarantee 3), so there is no way round it.
 *
 * Rendered by both shells from `useHandoffCollect`, which owns every state.
 */
export default function HandoffCodeSheet({ prompt, submitCode, dismiss }: HandoffCollect) {
  const t = useTranslations('profile.auth');
  // `close` lives in the recovery namespace; every sheet reuses it.
  const tClose = useTranslations('recovery');
  const online = useOnline();
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true);
    try {
      await submitCode(code);
    } finally {
      setSubmitting(false);
      setCode('');
    }
  }

  return (
    <BottomSheet open={!!prompt} onClose={dismiss} ariaLabel={t('handoffEnterTitle')}>
      <BottomSheetHeader onClose={dismiss} closeLabel={tClose('close')}>
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>{t('handoffEnterTitle')}</span>
      </BottomSheetHeader>
      <BottomSheetBody>
        {prompt?.expired ? (
          <div className="motion-fade" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <p className="fs-md" style={{ color: 'var(--text-primary)', margin: '0', lineHeight: 'var(--lh-normal)' }}>
              {t('handoffEnterExpired')}
            </p>
            <button type="button" onClick={dismiss} className="cc-btn cc-btn-secondary cc-btn-lg">
              {t('handoffEnterClose')}
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <p className="fs-sm" style={{ color: 'var(--text-secondary)', margin: '0', lineHeight: 'var(--lh-normal)' }}>
              {t('handoffEnterBody')}
            </p>
            <PinInput
              value={code}
              onChange={setCode}
              digits={6}
              label={t('handoffEnterLabel')}
              autoFocus
              ariaInvalid={!!prompt?.wrong}
            />
            <button
              type="button"
              disabled={submitting || !online || code.length !== 6}
              onClick={submit}
              className="btn-primary"
            >
              {t('handoffEnterSubmit')}
            </button>
            {prompt?.wrong && <p role="alert" className="field-error">{t('handoffEnterWrong')}</p>}
            {prompt?.retry && <p role="alert" className="field-error">{t('handoffEnterRetry')}</p>}
            {prompt?.throttled && <p role="alert" className="field-error">{t('handoffEnterThrottled')}</p>}
            {!online && <p className="fs-sm" style={{ color: 'var(--text-muted)', margin: '0' }}>{t('offline')}</p>}
            <button type="button" onClick={dismiss} className="cc-btn cc-btn-ghost">
              {t('handoffEnterCancel')}
            </button>
          </div>
        )}
      </BottomSheetBody>
    </BottomSheet>
  );
}
