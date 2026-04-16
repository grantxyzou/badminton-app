'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Release } from '@/lib/types';

interface ReleaseNotesTriggerProps {
  releases: Release[];
  onOpen: () => void;
}

export default function ReleaseNotesTrigger({ releases, onOpen }: ReleaseNotesTriggerProps) {
  const t = useTranslations('home.releases');
  const [storedVersion, setStoredVersion] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setStoredVersion(localStorage.getItem('badminton_last_read_release'));
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) {
      setStoredVersion(localStorage.getItem('badminton_last_read_release'));
    }
  }, [releases, mounted]);

  if (releases.length === 0) return null;

  const latest = releases[0];
  const isUnread = storedVersion !== latest.version;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`text-xs px-2 transition-colors text-left ${
        isUnread ? 'terminal-accent-text font-semibold' : 'text-gray-400'
      }`}
    >
      {isUnread ? `✨ ${t('whatsNew', { version: latest.version })}` : latest.version}
    </button>
  );
}
