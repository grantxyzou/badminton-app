'use client';

import { useTranslations } from 'next-intl';
import { FEEL_BALANCES, FEEL_FLEXES, FEEL_WEIGHTS, type RacketFeel } from '@/lib/types';
import { FEEL_WORD_KEY } from '@/lib/gearSetup';

/**
 * "How does it feel?" — three optional questions about a racket the catalog
 * does not have. Controlled: the sheet holds the answers and writes them ONCE
 * (a tap per chip against the preference limiter would be a write per tap).
 *
 * Every row has "Don't know", and it is the resting state: a guess stored as
 * an answer would steer the member's picks, while an unanswered row simply
 * leaves that axis out.
 */
export default function RacketFeelChips({ value, onChange, disabled }: {
  value: RacketFeel;
  onChange: (next: RacketFeel) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('stats.gear.setup');
  const rows = [
    { key: 'balance', label: t('feelBalance'), options: FEEL_BALANCES },
    { key: 'flex', label: t('feelFlex'), options: FEEL_FLEXES },
    { key: 'weight', label: t('feelWeight'), options: FEEL_WEIGHTS },
  ] as const;

  return (
    <div className="setup-feel">
      {rows.map((row) => {
        const current = value[row.key];
        return (
          <div key={row.key} className="setup-feel-row" role="group" aria-label={row.label}>
            <span className="setup-feel-label">{row.label}</span>
            <span className="setup-feel-chips">
              {row.options.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className="setup-feel-chip"
                  aria-pressed={current === opt}
                  disabled={disabled}
                  onClick={() => onChange({ ...value, [row.key]: opt })}
                >
                  {FEEL_WORD_KEY[opt] ? t(FEEL_WORD_KEY[opt]) : opt}
                </button>
              ))}
              <button
                type="button"
                className="setup-feel-chip"
                aria-pressed={current === undefined}
                disabled={disabled}
                onClick={() => onChange({ ...value, [row.key]: undefined })}
              >
                {t('dontKnow')}
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}
