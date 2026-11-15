/**
 * A 6-digit sign-in code sent to a member's email (docs/plans/one-way-in.md,
 * step 3). The sibling of `lib/memberRecoveryCode.ts`, and the same shape on
 * purpose: a short code stored as a scrypt hash ON THE MEMBER DOC
 * (`Member.emailCode`), a short life, a cap on wrong tries counted under an
 * etag, and single use.
 *
 * WHY A CODE, NOT A LINK: a link opens in the mail app's own browser, or on a
 * laptop when the app is on a phone, and the sign-in lands in a browser that
 * is not the one asking. Inside the store app that is a different cookie jar
 * altogether. A typed code is finished where it was asked for.
 *
 * WHY SCRYPT FOR SIX DIGITS: a million codes is nothing to an offline guesser
 * holding a plain SHA-256, so a leaked member doc would hand over the live
 * code. The PIN hash (`lib/recoveryHash.ts`) is salted and slow; a code gets
 * the same.
 *
 * EVERY VERIFY COSTS ONE SCRYPT, live code or not. Returning early for an
 * expired, used-up or absent code would answer faster, and the difference says
 * whether the address has an account with a code waiting.
 */
import { createHash, randomInt } from 'crypto';
import { hashPin, verifyPin, FAKE_HASH } from './recoveryHash';
import { ensureContainer, getContainer } from './cosmos';

/** Ten minutes: long enough to switch to the mail app and back, short enough to be stale soon. */
export const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
/** Wrong codes tried against one code before it stops working; a new code starts again. */
export const MAX_EMAIL_CODE_ATTEMPTS = 5;

export interface StoredEmailCode {
  hash: string;
  expiresAt: number;
  /** Wrong codes tried against this one (absent = 0). */
  attempts?: number;
}

export async function issueEmailCode(now = Date.now()): Promise<{ code: string; stored: StoredEmailCode }> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  return { code, stored: { hash: await hashPin(code), expiresAt: now + EMAIL_CODE_TTL_MS } };
}

/** Is there a code worth checking against: present, unexpired, not tried out? */
export function emailCodeLive(stored: StoredEmailCode | undefined | null, now = Date.now()): stored is StoredEmailCode {
  return (
    !!stored &&
    typeof stored.hash === 'string' &&
    typeof stored.expiresAt === 'number' &&
    now <= stored.expiresAt &&
    (stored.attempts ?? 0) < MAX_EMAIL_CODE_ATTEMPTS
  );
}

/** Constant cost: one scrypt whether or not there is a live code to check. */
export async function verifyEmailCode(
  stored: StoredEmailCode | undefined | null,
  candidate: string,
  now = Date.now(),
): Promise<boolean> {
  if (!/^[0-9]{6}$/.test(candidate)) {
    await verifyPin('000000', FAKE_HASH);
    return false;
  }
  if (!emailCodeLive(stored, now)) {
    await verifyPin(candidate, FAKE_HASH);
    return false;
  }
  return verifyPin(candidate, stored.hash);
}

/**
 * Count one wrong code against the member's live code, under an etag so two
 * wrong guesses racing each other both count. Best-effort: a failure to
 * record is logged, never a different answer to the guesser.
 */
export async function noteEmailCodeFailure(memberId: string): Promise<void> {
  const container = getContainer('members');
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const { resource: fresh } = await container
        .item(memberId, memberId)
        .read<{ id: string; _etag?: string; emailCode?: StoredEmailCode }>();
      if (!fresh || !emailCodeLive(fresh.emailCode)) return;
      const next = { ...fresh, emailCode: { ...fresh.emailCode, attempts: (fresh.emailCode.attempts ?? 0) + 1 } };
      if (typeof fresh._etag === 'string') {
        await container.item(memberId, memberId).replace(next, { accessCondition: { type: 'IfMatch', condition: fresh._etag } });
      } else {
        await container.items.upsert(next);
      }
      return;
    } catch (err) {
      const status = (err as { code?: number; statusCode?: number })?.code ?? (err as { statusCode?: number })?.statusCode;
      if (status === 412) continue;
      console.error('[email-code] could not record a wrong code:', err);
      return;
    }
  }
}

/*
 * ── A code for an address with NO account yet (docs/plans/one-way-in.md, step 4) ──
 *
 * Through a club's link a new person proves an address before an account
 * exists, so the code cannot live on a Member doc. It lives in `authhandoff`
 * (global, keyed by id; the OAuth and app-move stashes are its other kinds),
 * under the sha256 of the address so the doc names nobody, and it carries the
 * club whose link asked for it. Same rules as an account's code: scrypt, ten
 * minutes, five wrong tries, a new one replaces it, used once.
 */
export const SIGNUP_CODE_KIND = 'emailSignupCode';

export interface SignupCodeDoc extends StoredEmailCode {
  id: string;
  kind: typeof SIGNUP_CODE_KIND;
  /** The club whose link asked for this code. */
  groupId: string;
  createdAt: string;
  _etag?: string;
}

function signupDocId(email: string): string {
  return `emailsignup:${createHash('sha256').update(email).digest('hex')}`;
}

async function stash() {
  await ensureContainer('authhandoff', '/id');
  return getContainer('authhandoff');
}

export async function storeSignupCode(email: string, stored: StoredEmailCode, groupId: string, now = Date.now()): Promise<void> {
  const doc: SignupCodeDoc = {
    id: signupDocId(email),
    kind: SIGNUP_CODE_KIND,
    hash: stored.hash,
    expiresAt: stored.expiresAt,
    attempts: 0,
    groupId,
    createdAt: new Date(now).toISOString(),
  };
  await (await stash()).items.upsert(doc);
}

/** The live-or-not doc for this address, checked to be the right KIND (a shared cabinet). */
export async function readSignupCode(email: string): Promise<SignupCodeDoc | null> {
  const id = signupDocId(email);
  try {
    const { resource } = await (await stash()).item(id, id).read<SignupCodeDoc>();
    return resource && resource.kind === SIGNUP_CODE_KIND ? resource : null;
  } catch (err) {
    if ((err as { code?: number })?.code === 404) return null;
    throw err;
  }
}

/** One wrong code against this address's sign-up code, under the etag. Best-effort. */
export async function noteSignupCodeFailure(email: string): Promise<void> {
  const id = signupDocId(email);
  const container = await stash();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const doc = await readSignupCode(email);
      if (!doc || !emailCodeLive(doc)) return;
      const next = { ...doc, attempts: (doc.attempts ?? 0) + 1 };
      if (typeof doc._etag === 'string') {
        await container.item(id, id).replace(next, { accessCondition: { type: 'IfMatch', condition: doc._etag } });
      } else {
        await container.items.upsert(next);
      }
      return;
    } catch (err) {
      if ((err as { code?: number })?.code === 412) continue;
      console.error('[email-code] could not record a wrong sign-up code:', err);
      return;
    }
  }
}

/** Use it up: deleted only if unchanged since it was checked. False when someone else used it first. */
export async function consumeSignupCode(doc: SignupCodeDoc): Promise<boolean> {
  const container = await stash();
  try {
    await container
      .item(doc.id, doc.id)
      .delete(typeof doc._etag === 'string' ? { accessCondition: { type: 'IfMatch', condition: doc._etag } } : undefined);
    return true;
  } catch (err) {
    const code = (err as { code?: number })?.code;
    if (code === 412 || code === 404) return false;
    throw err;
  }
}
