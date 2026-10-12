'use client';

import ProfileEyebrow from '@/components/primitives/ProfileEyebrow';
import SettingsList, { type SettingsRow } from '@/components/profile/SettingsList';
import { useAdminNeedsYou } from '@/lib/useAdminNeedsYou';
import { useRevealReady } from '@/components/primitives/Reveal';

/**
 * WHAT PROFILE'S "N NEED YOU" IS MADE OF, at the top of the Command Center
 * (admin audit, 2026-10-12). Profile counted unpaid players, low birds,
 * dormant members and the bench; the admin then landed on a screen of nine
 * cards and a nine-row list with no say in which three to look at. This lists
 * the same signals, from the same hook, each one a row that goes to the fix.
 *
 * Renders nothing when nothing needs anyone, and nothing while loading. A
 * failed check says so in one muted line — never a list of zero.
 */
export default function NeedsYouCard({
  refreshKey,
  onOpenPayments,
  onOpenBirds,
  onOpenDormant,
  onOpenBench,
}: {
  refreshKey: number;
  onOpenPayments: () => void;
  onOpenBirds: () => void;
  onOpenDormant: () => void;
  onOpenBench: () => void;
}) {
  const { needsYou, breakdown, stringing, loadError } = useAdminNeedsYou(true, refreshKey);
  const ready = loadError || needsYou !== null;
  const empty = !loadError && needsYou === 0;
  useRevealReady(ready, empty);
  if (!ready || empty) return null;

  if (loadError || !breakdown) {
    return (
      <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>
        Couldn&apos;t check what needs you. The cards below still work.
      </p>
    );
  }

  const rows: SettingsRow[] = [];
  if (breakdown.unpaid > 0) {
    rows.push({ icon: 'payments', label: `${breakdown.unpaid} unpaid this session`, accent: true, onClick: onOpenPayments });
  }
  if (breakdown.birds === 'now' || breakdown.birds === 'soon') {
    rows.push({ icon: 'inventory_2', label: breakdown.birds === 'now' ? 'Birds: reorder now' : 'Birds: reorder soon', accent: true, onClick: onOpenBirds });
  }
  if (stringing && stringing.waiting + stringing.late > 0) {
    const parts = [stringing.waiting > 0 ? `${stringing.waiting} waiting` : null, stringing.late > 0 ? `${stringing.late} late` : null].filter(Boolean);
    rows.push({ icon: 'sports_tennis', label: 'Stringing bench', meta: parts.join(' · '), accent: true, onClick: onOpenBench });
  }
  if (breakdown.dormant > 0) {
    rows.push({ icon: 'group', label: `${breakdown.dormant} dormant ${breakdown.dormant === 1 ? 'member' : 'members'}`, onClick: onOpenDormant });
  }

  return (
    <section aria-label="Needs you" className="flex flex-col gap-2">
      <ProfileEyebrow>Needs you</ProfileEyebrow>
      <SettingsList rows={rows} />
    </section>
  );
}
