'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import ErrorState from '@/components/primitives/ErrorState';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '../BottomSheet';
import { useOnline } from '@/lib/useOnline';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  you: string;
  sessionId: string;
  open: boolean;
  onClose: () => void;
  onLogged: () => void;
}

/**
 * Slice-0 full-doubles game logger. You + partner vs two opponents, numeric
 * scores. Posts to /api/games. Three-input flow kept deliberately short.
 */
export default function GameLoggerSheet({ you, sessionId, open, onClose, onLogged }: Props) {
  const t = useTranslations('valueHub');
  const tRecovery = useTranslations('recovery');
  const tStats = useTranslations('stats');
  const online = useOnline();
  const [partner, setPartner] = useState('');
  const [opp1, setOpp1] = useState('');
  const [opp2, setOpp2] = useState('');
  const [scoreA, setScoreA] = useState('');
  const [scoreB, setScoreB] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [done, setDone] = useState(false);

  const valid = !!(partner.trim() && opp1.trim() && opp2.trim() && scoreA !== '' && scoreB !== '');

  async function submit() {
    if (!valid) return;
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(`${BASE}/api/games`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          teamA: [you, partner.trim()],
          teamB: [opp1.trim(), opp2.trim()],
          scoreA: Number(scoreA),
          scoreB: Number(scoreB),
          loggedBy: you,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setDone(true);
      onLogged();
      setTimeout(() => {
        onClose();
        setDone(false);
        setPartner(''); setOpp1(''); setOpp2(''); setScoreA(''); setScoreB('');
      }, 1000);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  const onlyDigits = (v: string) => v.replace(/\D/g, '').slice(0, 3);

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('logGameTitle')} maxHeight="80vh" className="max-w-lg mx-auto">
      <BottomSheetHeader className="flex items-center justify-between p-4">
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>{t('logGameTitle')}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={tRecovery('close')}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <span className="material-icons" style={{ fontSize: 'var(--fs-stat)' }}>close</span>
        </button>
      </BottomSheetHeader>
      <BottomSheetBody className="p-5 pb-8">
        {done ? (
          <p style={{ textAlign: 'center', fontSize: 'var(--fs-lg)', color: 'var(--text-primary)' }}>{t('logGameThanks')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 'var(--fs-base)', color: 'var(--text-secondary)', margin: 0 }}>{t('logGameHint')}</p>
            <div>
              <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', margin: '0 0 4px' }}>{t('partner')}</p>
              <input type="text" aria-label={t('partner')} value={partner} onChange={(e) => setPartner(e.target.value)} maxLength={50} />
            </div>
            <div>
              <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', margin: '0 0 4px' }}>{t('opponents')}</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="text" aria-label={`${t('opponents')} 1`} value={opp1} onChange={(e) => setOpp1(e.target.value)} maxLength={50} style={{ flex: 1 }} />
                <input type="text" aria-label={`${t('opponents')} 2`} value={opp2} onChange={(e) => setOpp2(e.target.value)} maxLength={50} style={{ flex: 1 }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', margin: '0 0 4px' }}>{t('yourScore')}</p>
                <input inputMode="numeric" aria-label={t('yourScore')} value={scoreA} onChange={(e) => setScoreA(onlyDigits(e.target.value))} />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', margin: '0 0 4px' }}>{t('theirScore')}</p>
                <input inputMode="numeric" aria-label={t('theirScore')} value={scoreB} onChange={(e) => setScoreB(onlyDigits(e.target.value))} />
              </div>
            </div>
            {error && <ErrorState message={t('recError')} />}
            {!online && (
              <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: 0 }}>{tStats('offline')}</p>
            )}
            <button type="button" disabled={!online || !valid || busy} onClick={submit} className="cc-btn cc-btn-primary cc-btn-lg" style={{ marginTop: 4 }}>
              {t('logGameSubmit')}
            </button>
          </div>
        )}
      </BottomSheetBody>
    </BottomSheet>
  );
}
