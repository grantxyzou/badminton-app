/**
 * Which sentence a refused sign-up shows, as a key under `home.signup.errors`.
 *
 * `POST /api/players` answers some refusals in English sentences and some in
 * snake_case codes, and the card used to print whichever came back — so a
 * Chinese reader saw "Sign-up deadline has passed", and anyone could see
 * `session_settled` (audit, 2026-11-05). The route's wording stays as it is
 * (the widget and older app versions read it); this is the one place that
 * turns it into a sentence in the reader's language. `null` means "say the
 * generic failure", never "print what the server said".
 */
export type SignupErrorKey =
  | 'notOpen'
  | 'deadlinePassed'
  | 'alreadyIn'
  | 'full'
  | 'settled'
  | 'noSession'
  | 'tooMany'
  | 'signedOut';

const BY_ERROR: Record<string, SignupErrorKey> = {
  'Sign-ups are not open yet': 'notOpen',
  'Sign-up deadline has passed': 'deadlinePassed',
  'Already signed up': 'alreadyIn',
  'Session is full': 'full',
  session_settled: 'settled',
  no_active_session: 'noSession',
};

export function signupErrorKey(status: number, error: unknown): SignupErrorKey | null {
  if (typeof error === 'string' && Object.prototype.hasOwnProperty.call(BY_ERROR, error)) return BY_ERROR[error];
  if (status === 429) return 'tooMany';
  if (status === 401) return 'signedOut';
  return null;
}
