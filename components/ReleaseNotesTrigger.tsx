'use client';

import { memo } from 'react';
import { useTranslations } from 'next-intl';
import type { Release } from '@/lib/types';
import { readStored, useClientValue } from '@/lib/useClientValue';

const LAST_READ_KEY = 'badminton_last_read_release';

const readLastRead = () => readStored(LAST_READ_KEY);

interface ReleaseNotesTriggerProps {
  releases: Release[];
  onOpen: () => void;
}

function ReleaseNotesTrigger({ releases, onOpen }: ReleaseNotesTriggerProps) {
  const t = useTranslations('home.releases');
  // Re-read on every render, so the dot clears as soon as anything re-renders
  // this button after the sheet writes the key. That used to need a SECOND
  // effect keyed on `releases` and a `mounted` flag to stop it firing before
  // the first — two effects writing one state, racing on mount.
  //
  // `null` through hydration keeps the server and client markup identical; the
  // real value arrives on the post-hydration pass, exactly as the mount effect
  // used to deliver it.
  const storedVersion = useClientValue(readLastRead, null);

  if (releases.length === 0) return null;

  const latest = releases[0];
  const isUnread = storedVersion !== latest.version;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`fs-sm px-2 transition-colors text-left ${
        isUnread ? 'terminal-accent-text font-semibold' : 'text-gray-400'
      }`}
    >
      {isUnread ? `✨ ${t('whatsNew', { version: latest.version })}` : latest.version}
    </button>
  );
}

export default memo(ReleaseNotesTrigger);
