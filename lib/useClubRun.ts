'use client';

import { useEffect, useRef, useState } from 'react';
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
  // A save belongs to the club it was made in. Kept beside that club's id, it
  // is never read once the screen shows another club (a switch keeps the
  // shell mounted, so a bare value outlived the club it described).
  const [saved, setSaved] = useState<{ groupId: string | null; run: ClubRun } | null>(null);
  const groupIdRef = useRef<string | null>(null);
  useEffect(() => { groupIdRef.current = group?.id ?? null; }, [group?.id]);

  useEffect(() => {
    const onChange = (e: Event) => setSaved({ groupId: groupIdRef.current, run: (e as CustomEvent<ClubRun>).detail });
    window.addEventListener(CLUB_RUN_EVENT, onChange);
    return () => window.removeEventListener(CLUB_RUN_EVENT, onChange);
  }, []);

  const mine = saved !== null && saved.groupId === (group?.id ?? null) ? saved.run : null;
  return {
    run: mine ?? clubRunOf(group?.settings),
    known: mine !== null || (!loading && !error),
  };
}

/**
 * Has this club switched its stringing service OFF (docs/plans/stringing-add-on.md)?
 * True only on a KNOWN "off", so a club that strings never loses its tab
 * while the club is still being read (unknown is not "off"). The deployment
 * flag keeps its own handling where it always had it (the Stringing tab's
 * "not available" state); this is the club's switch alone.
 */
export function useStringingHidden(): boolean {
  const { run, known } = useClubRun();
  return known && run.stringing === 'off';
}
