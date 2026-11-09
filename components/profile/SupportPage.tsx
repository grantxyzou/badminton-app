'use client';

import { useTranslations } from 'next-intl';
import TopBar from '@/components/primitives/TopBar';
import ProfileEyebrow from '@/components/primitives/ProfileEyebrow';
import { GUIDES } from '@/lib/helpGuides';
import { rawList } from '@/lib/rawList';
import SettingsList from './SettingsList';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  /** Organisers and admins also see the guide written for them. */
  isAdmin: boolean;
  onReport: () => void;
  onBack: () => void;
}

/**
 * "Support" (docs/superpowers/specs/2026-11-09-profile-reorg-design.md §7):
 * the guides, three common questions, the ways to reach a person, and the
 * privacy pages.
 *
 * A guide opens as a full navigation to its public page (`/legal/help/<slug>`),
 * as Privacy policy does: the guides are server-rendered so they can be read
 * before sign-in and linked from the store listings, and one copy of each is
 * the only copy. "Contact" opens `/legal/support`, which shows the operator's
 * address — it is server configuration (`SUPPORT_EMAIL`), never in the app's
 * bundle.
 */
export default function SupportPage({ isAdmin, onReport, onBack }: Props) {
  const t = useTranslations('profile.support');
  const tHelp = useTranslations('legal.help');
  const go = (path: string) => window.location.assign(`${BASE}${path}`);
  const questions = rawList<{ q: string; a: string }>(t.raw('questions'));

  return (
    // NOT a header-only wrapper: TopBar is sticky (StatsPrivacyScreen says why).
    <div className="animate-slideInRight flex flex-col gap-4" data-support-page>
      <TopBar title={t('title')} onBack={onBack} backLabel={t('back')} />

      <ProfileEyebrow>{t('guidesGroup')}</ProfileEyebrow>
      <ul className="help-list">
        {GUIDES.filter((g) => !('organisersOnly' in g) || isAdmin).map((g) => (
          <li key={g.key}>
            <button type="button" className="help-row" onClick={() => go(`/legal/help/${g.slug}`)}>
              <span className="help-row__icon" aria-hidden="true"><span className="material-icons">{g.icon}</span></span>
              <span className="help-row__text">
                <span className="help-row__title">{tHelp(`guides.${g.key}.title`)}</span>
                <span className="help-row__sub">{tHelp(`guides.${g.key}.sub`)}</span>
              </span>
              <span className="material-icons help-row__chev" aria-hidden="true">chevron_right</span>
            </button>
          </li>
        ))}
      </ul>

      <ProfileEyebrow>{t('questionsGroup')}</ProfileEyebrow>
      <div className="glass-card is-flush" style={{ overflow: 'hidden' }}>
        <ul style={{ listStyle: 'none', margin: '0', padding: '0' }}>
          {questions.map((qa, i) => (
            <li key={qa.q} className="help-qa" style={{ borderTop: i === 0 ? 'none' : '1px solid var(--divider)' }}>
              <span className="help-qa__q">{qa.q}</span>
              <span className="help-qa__a">{qa.a}</span>
            </li>
          ))}
        </ul>
      </div>

      <ProfileEyebrow>{t('contactGroup')}</ProfileEyebrow>
      <SettingsList
        rows={[
          { icon: 'flag', label: t('report'), onClick: onReport },
          { icon: 'send', label: t('contact'), onClick: () => go('/legal/support') },
        ]}
      />

      <ProfileEyebrow>{t('legalGroup')}</ProfileEyebrow>
      <SettingsList
        rows={[
          { icon: 'shield', label: t('privacy'), onClick: () => go('/legal/privacy') },
          { icon: 'delete_outline', label: t('deleteAccount'), onClick: () => go('/legal/delete-account') },
        ]}
      />
    </div>
  );
}
