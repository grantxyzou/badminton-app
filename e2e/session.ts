/**
 * Sign a persona in, and — on production — prove it is standing in the E2E
 * test club and nowhere else before the tour touches anything.
 *
 * Sign-in goes through the API in the page's own cookie jar (`page.request`
 * shares it), once per persona per run: the email sign-in allows 20 an hour
 * per address (`app/api/auth/signin/route.ts`), and the run needs one.
 */
import type { BrowserContext, Page } from '@playwright/test';
import type { Persona } from './personas';
import { baseUrl, target } from './target';

export const E2E_CLUB_NAME = process.env.E2E_CLUB_NAME || 'E2E test';

export type ClubRole = 'owner' | 'admin' | 'member';

export interface SignedIn {
  groupId: string;
  role: ClubRole;
  /** Organiser or admin: sees Admin tools. */
  privileged: boolean;
  /** This persona's name on the club's list, which is how its sign-up row is found. */
  rosterName: string;
}

function origin(): string {
  return new URL(baseUrl()).origin;
}

/** Pin the language so a screenshot and the i18n check read the same words. */
export async function pinEnglish(context: BrowserContext): Promise<void> {
  const u = new URL(baseUrl());
  await context.addCookies([
    { name: 'NEXT_LOCALE', value: 'en', domain: u.hostname, path: '/bpm', secure: u.protocol === 'https:', sameSite: 'Lax' },
  ]);
}

export async function signIn(page: Page, persona: Persona): Promise<void> {
  const headers = { origin: origin(), 'content-type': 'application/json' };
  const res =
    persona.kind === 'password'
      ? await page.request.post(`${baseUrl()}/api/auth/signin`, {
          headers,
          data: { email: persona.email, password: persona.password },
        })
      : await page.request.post(`${baseUrl()}/api/players/recover`, {
          headers,
          data: { name: persona.name, pin: persona.pin },
        });
  if (!res.ok()) {
    // The status only: the body can echo an address.
    throw new Error(`sign-in failed for persona "${persona.label}": HTTP ${res.status()}`);
  }
}

/**
 * Production's hard stop. Passes only when the persona belongs to exactly one
 * club, that club is named E2E_CLUB_NAME (and has id E2E_GROUP_ID when that is
 * set), and the session cookie is pointed at it. Anything else throws before
 * the first screen loads, which ends the run.
 *
 * A fresh sign-in names BPM in the cookie (`groupForMember` in
 * `lib/authSession.ts`: no club was asked for), so a persona who is only in
 * the E2E test club arrives "in no club" — the person would see their club
 * list and tap it. The guard does that tap (`POST /api/groups/switch`) only
 * AFTER the club list has passed every check, so it can only ever move the
 * cookie into the one E2E test club.
 */
async function readMine(page: Page, persona: Persona) {
  const res = await page.request.get(`${baseUrl()}/api/groups/mine`);
  if (!res.ok()) throw new Error(`club guard: /api/groups/mine answered ${res.status()} for "${persona.label}"`);
  return (await res.json()) as { groups?: Array<{ id: string; name: string }>; currentGroupId?: string };
}

export async function clubGuard(page: Page, persona: Persona): Promise<SignedIn> {
  let mine = await readMine(page, persona);
  const groups = mine.groups ?? [];
  const prod = target() === 'prod';
  const refuse = (problems: string[]) => {
    throw new Error(`club guard refused persona "${persona.label}": ${problems.join('; ')}`);
  };

  if (prod) {
    const problems: string[] = [];
    if (groups.length !== 1) problems.push(`belongs to ${groups.length} clubs, must be exactly 1`);
    if (groups[0] && groups[0].name !== E2E_CLUB_NAME) problems.push(`club is "${groups[0].name}", not "${E2E_CLUB_NAME}"`);
    const pinned = process.env.E2E_GROUP_ID;
    if (pinned && groups[0] && groups[0].id !== pinned) problems.push('club id differs from E2E_GROUP_ID');
    if (problems.length) refuse(problems);

    if (mine.currentGroupId !== groups[0].id) {
      const sw = await page.request.post(`${baseUrl()}/api/groups/switch`, {
        headers: { origin: origin(), 'content-type': 'application/json' },
        data: { groupId: groups[0].id },
      });
      if (!sw.ok()) throw new Error(`club guard: switching "${persona.label}" into ${E2E_CLUB_NAME} answered ${sw.status()}`);
      mine = await readMine(page, persona);
    }
  }

  const currentRes = await page.request.get(`${baseUrl()}/api/groups/current`);
  if (!currentRes.ok()) throw new Error(`club guard: /api/groups/current answered ${currentRes.status()} for "${persona.label}"`);
  const current = (await currentRes.json()) as { id?: string; name?: string; role?: string; rosterName?: string };

  if (prod) {
    const problems: string[] = [];
    if (current.name !== E2E_CLUB_NAME) problems.push(`session points at "${current.name}"`);
    if (current.id !== groups[0].id) problems.push('session is not in the listed club');
    if (mine.currentGroupId !== current.id) problems.push('cookie club and current club differ');
    if (problems.length) refuse(problems);
  }

  const role: ClubRole = current.role === 'owner' || current.role === 'admin' ? current.role : 'member';
  return { groupId: String(current.id ?? ''), role, privileged: role !== 'member', rosterName: String(current.rosterName ?? '') };
}
