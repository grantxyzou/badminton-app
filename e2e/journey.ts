/**
 * What every spec shares: open the app as a persona, move around it, and
 * record each screen (docs/plans/e2e-test-club.md).
 *
 * An Actor is one persona in its own browser context — its own cookies, so
 * several people can be signed in at once, the way a real week has a player
 * on one phone and the organiser on another.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type APIResponse, type Browser, type Page, type TestInfo } from '@playwright/test';
import type { Persona } from './personas';
import { baseUrl } from './target';
import { clubGuard, pinEnglish, signIn, type SignedIn } from './session';
import { Recorder } from './capture';

const SCREENS_DIR = join(__dirname, '..', 'e2e-results', 'screens');
/** A full-page capture stitches fixed elements into the middle of the image. */
const FULL_PAGE_STYLE = '.rail-bar, nextjs-portal { visibility: hidden !important; }';

export interface Actor {
  persona: Persona;
  page: Page;
  rec: Recorder;
  who: SignedIn;
  close: () => Promise<void>;
}

/** Where this run keeps a persona's signed-in cookies (global-setup.ts). */
function authFile(label: string): string | null {
  const dir = process.env.E2E_AUTH_DIR;
  return dir ? join(dir, `${label.replace(/[^\w-]/g, '_')}.json`) : null;
}

/**
 * Sign a persona in, pass the club guard, and open the app on Home.
 *
 * A persona signed in earlier in the run reuses its cookies; the club guard
 * runs either way. Only a 401 from the guard (the session ended) falls back to
 * a fresh sign-in — a guard REFUSAL is never retried around.
 */
export async function openAs(browser: Browser, persona: Persona): Promise<Actor> {
  const file = authFile(persona.label);
  const cached = !!file && existsSync(file);
  const context = await browser.newContext(cached ? { storageState: file! } : {});
  await pinEnglish(context);
  const page = await context.newPage();
  const rec = new Recorder(page);
  rec.at(`${persona.label}:sign-in`);
  let who: SignedIn | null = null;
  if (cached) {
    who = await clubGuard(page, persona).catch((err: Error) => {
      if (/answered 401/.test(err.message)) return null;
      throw err;
    });
  }
  if (!who) {
    await signIn(page, persona);
    who = await clubGuard(page, persona);
  }
  if (file) await context.storageState({ path: file });
  rec.at(`${persona.label}:launch`);
  await openApp(page);
  return { persona, page, rec, who, close: () => context.close() };
}

/** Load the app and wait for the launch screen to hand over. */
export async function openApp(page: Page): Promise<void> {
  await page.goto(`${baseUrl()}/`);
  await page.waitForFunction(
    () => {
      const s = document.documentElement.getAttribute('data-launch');
      return !s || s === 'done' || s === 'lifted' || s === 'welcome';
    },
    undefined,
    { timeout: 20_000 },
  );
  // A signed-out welcome here means the sign-in did not hold.
  await expect(page.locator('[data-signed-out-welcome]'), 'the app showed the signed-out welcome').toHaveCount(0);
  await expect(nav(page)).toBeVisible();
}

export function nav(page: Page) {
  return page.getByRole('navigation', { name: 'Main tabs' });
}

/** Tap a bottom-nav tab. Returns false when the club does not show it. */
export async function tapTab(page: Page, tab: 'Home' | 'Stringing' | 'Stats' | 'Profile'): Promise<boolean> {
  const button = nav(page).getByRole('button', { name: tab, exact: true });
  if ((await button.count()) === 0) return false;
  await button.tap();
  return true;
}

/** Network quiet, then no skeleton left on screen. Each wait is bounded. */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page
    .waitForFunction(
      () =>
        !Array.from(document.querySelectorAll('.shimmer-line')).some((el) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }),
      undefined,
      { timeout: 10_000 },
    )
    .catch(() => {});
  // The tab crossfade and any reveal stagger.
  await page.waitForTimeout(400);
}

/**
 * Settle, check and photograph the screen the actor is on. The screenshot is
 * named `<persona>-<screen>` and attached to the test.
 */
export async function shot(actor: Actor, screen: string, testInfo: TestInfo): Promise<void> {
  const { page, rec, persona } = actor;
  rec.at(`${persona.label}:${screen}`);
  await settle(page);
  await rec.inspect();
  mkdirSync(SCREENS_DIR, { recursive: true });
  const file = join(SCREENS_DIR, `${persona.label}-${screen}.png`);
  await page.screenshot({ path: file, fullPage: true, style: FULL_PAGE_STYLE });
  await testInfo.attach(`${persona.label}-${screen}`, { path: file, contentType: 'image/png' });
}

/**
 * A sheet that opens by itself on arrival (Stats asks once whether to compare
 * you with the club) covers the tab bar. Close it the way a person would. For
 * the Stats ask, closing IS an answer — "Keep it private", the persona's own
 * setting, asked once (docs/plans/e2e-test-club.md, Safety rules).
 */
export async function dismissArrivalSheet(page: Page): Promise<void> {
  const sheet = page.locator('[role="dialog"][aria-modal="true"]');
  if ((await sheet.count()) === 0 || !(await sheet.first().isVisible())) return;
  await page.keyboard.press('Escape');
  await expect(sheet, 'an arrival sheet would not close').toHaveCount(0, { timeout: 10_000 });
}

/**
 * Call the app's API as this actor, with its cookies and the same-site
 * `Origin` the app's own requests carry (proxy.ts refuses a write without one
 * that matches). Throws on a status outside `ok`, naming the call.
 */
export async function api<T = unknown>(
  actor: Actor,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  ok: (status: number) => boolean = (s) => s < 300,
): Promise<{ status: number; data: T }> {
  const res: APIResponse = await actor.page.request.fetch(`${baseUrl()}${path}`, {
    method,
    headers: { origin: new URL(baseUrl()).origin, 'content-type': 'application/json' },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* an empty body */
  }
  if (!ok(res.status())) {
    // The error code only: a body can carry a name or an address.
    const code = data && typeof data === 'object' && 'error' in data ? String((data as { error: unknown }).error) : '';
    throw new Error(`${actor.persona.label}: ${method} ${path} answered ${res.status()} ${code}`.trim());
  }
  return { status: res.status(), data: data as T };
}

/** Attach every actor's findings, then fail the test on any error among them. */
export async function finish(actors: Actor[], testInfo: TestInfo): Promise<void> {
  const errors = [];
  for (const a of actors) {
    await a.rec.attach(testInfo);
    errors.push(...a.rec.errors());
  }
  expect(errors, errors.map((e) => `[${e.screen}] ${e.kind}: ${e.detail}`).join('\n')).toEqual([]);
}
