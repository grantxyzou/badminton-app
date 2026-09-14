'use client';

import { createContext, useContext, type ReactNode } from 'react';
import StateCard from '@/components/primitives/StateCard';

/**
 * Where "Sign in" goes. Provided once by SkillsTab (which knows how to reach
 * Profile) so nine cards nested inside four registers do not each thread a
 * callback. Absent (a card rendered on its own, as in tests), the card still
 * locks — it just has no button to offer.
 */
export const StatsSignInContext = createContext<(() => void) | null>(null);

interface LockedCardProps {
  icon?: string;
  /** Omitted for the headerless cards (the greeting, the pick rail) that never had one. */
  title?: string;
  subtitle?: string;
  /**
   * What signing in would show, in one sentence, with "Sign in" as the link:
   * `t.rich('locked', { link: signInLink })` using `useSignInLink()` below.
   */
  message: ReactNode;
  /** The card's own layout with no values in it: dashes and empty bars, never invented numbers. */
  children: ReactNode;
}

/**
 * The rich-text renderer for a locked sentence's `<link>` chunk: the words
 * "Sign in" become the control. With no destination (a card rendered on its
 * own) the words stay plain text rather than a link that goes nowhere.
 */
export function useSignInLink() {
  const onSignIn = useContext(StatsSignInContext);
  return function SignInLink(chunks: ReactNode) {
    return onSignIn ? (
      <button type="button" className="state-link" onClick={onSignIn}>
        {chunks}
      </button>
    ) : (
      <>{chunks}</>
    );
  };
}

/**
 * A Stats card this device is not allowed to fill (the server answered 403:
 * no session for the name). Grant, 2026-09-14: keep the card and show what a
 * populated one would look like.
 *
 * Rendered as a `StateCard` with no tone: plain glass. Colour in that
 * material is reserved for real problems (a failed load is red, a session
 * that needs attention amber); see components/primitives/StateCard.tsx.
 * The preview is `aria-hidden`: it is shape, not content, and a screen reader
 * gets the sentence and its link.
 *
 * The way in is the words "Sign in" inside the sentence, as a link. Two louder
 * versions came first and were both too much down a whole tab: a full-width
 * button per card ("too many sign in all over the page"), then a chip in each
 * header ("take those tags out. Hyperlink the text instead").
 */
export default function LockedCard({ icon, title, subtitle, message, children }: LockedCardProps) {
  // Plain glass, no tone. Amber was tried and read as a stained card across a
  // whole tab of signed-out cards; signed out is not a problem, and the Sign in
  // link already says what to do. Grant, 2026-09-14: "plain glass for stats".
  return (
    <StateCard icon={icon} title={title} subtitle={subtitle} message={message}>
      {children}
    </StateCard>
  );
}

// The preview pieces are shared with the tinted StateCard, so the two cannot drift.
export { PreviewRow, PreviewMeter } from '@/components/primitives/StateCard';
