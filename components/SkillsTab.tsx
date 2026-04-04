'use client';

import dynamic from 'next/dynamic';
import type { PlayerSkills } from '@/components/SkillsRadar';

const SkillsRadar = dynamic(() => import('@/components/SkillsRadar'), { ssr: false });

/* Mock players for development — replace with API data later */
const MOCK_PLAYERS: PlayerSkills[] = [
  {
    id: '1', name: 'Grant',
    scores: {
      'grip-stroke': 3, 'movement': 4, 'serve-return': 3,
      'offense': 3, 'defense': 2, 'strategy': 3, 'knowledge': 4,
    },
  },
  {
    id: '2', name: 'Zack',
    scores: {
      'grip-stroke': 2, 'movement': 3, 'serve-return': 2,
      'offense': 4, 'defense': 3, 'strategy': 2, 'knowledge': 3,
    },
  },
  {
    id: '3', name: 'Desmond',
    scores: {
      'grip-stroke': 4, 'movement': 3, 'serve-return': 4,
      'offense': 3, 'defense': 4, 'strategy': 3, 'knowledge': 3,
    },
  },
];

export default function SkillsTab({ isAdmin }: { isAdmin?: boolean }) {
  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center" style={{ minHeight: 'calc(100vh - 12rem)' }}>
        <p className="text-2xl font-semibold text-center" style={{ color: 'var(--text-muted)' }}>
          Progress together?
        </p>
      </div>
    );
  }

  return <SkillsRadar players={MOCK_PLAYERS} />;
}
