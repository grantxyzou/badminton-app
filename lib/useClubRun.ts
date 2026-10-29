'use client';

import { useEffect, useState } from 'react';
import { clubRunOf, type ClubRun } from '@/lib/clubRun';
import { useCurrentGroup } from '@/lib/useCurrentGroup';

/** Fired by the "How your club runs" page after a save, carrying the stored settings. */
export const CLUB_RUN_EVENT = 'badminton:club-run-changed';

export function announceClubRun(run: ClubRun) {
  window.dispatchEvent(new CustomEvent<ClubRun>(CLUB_RUN_EVENT, { detail: run }));
}

/**
 * How the current club runs (lib/clubRun.ts), for a screen that follows it.
 *
 * `known` is false until the club has been read. A screen hides something only
 * on a KNOWN answer, never on the default it shows while loading — unknown is
 * not "off" (CLAUDE.md, "Unknown ≠ known-false"). With groups off there is no
 * club to read, so the answer is BPM's, known at once.
 *
 * A save on the settings page reaches screens that are already mounted (the
 * Command Center stays mounted under its sub-pages) through `CLUB_RUN_EVENT`,
 * not a re-read: the page holds the stored answer, so asking again would only
 * add a request.
 */
export function useClubRun(): { run: ClubRun; known: boolean } {
  const { group, loading, error } = useCurrentGroup();
  const [saved, setSaved] = useState<ClubRun | null>(null);

  useEffect(() => {
    const onChange = (e: Event) => setSaved((e as CustomEvent<ClubRun>).detail);
    window.addEventListener(CLUB_RUN_EVENT, onChange);
    return () => window.removeEventListener(CLUB_RUN_EVENT, onChange);
  }, []);

  return {
    run: saved ?? clubRunOf(group?.settings),
    known: saved !== null || (!loading && !error),
  };
}
