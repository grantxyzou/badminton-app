/**
 * The write-up: what a run records about every screen it visits.
 *
 * ERRORS fail the test:
 *   - an uncaught exception in the page
 *   - a 5xx from our own server
 *   - an i18n key path drawn on screen (next-intl prints the key instead of
 *     throwing, so nothing else notices)
 *   - the page scrolling sideways at phone width
 *
 * WARNINGS are reported but do not fail, until a few runs show which are
 * noise: console errors, 4xx answers, a "Couldn't load" state, a skeleton
 * still showing after the screen should have settled, and an accessibility
 * problem axe rates serious or critical against WCAG 2 A/AA (one finding per
 * rule per screen, `a11y:<rule>`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { baseUrl, target } from './target';

/**
 * 5xx answers that are the MOCK STORE's environment, not a bug: it runs with
 * no Anthropic key, so the AI read answers `service_unavailable`. On
 * production the same answer is a real failure and stays an error.
 */
const MOCK_ONLY_5XX: RegExp[] = [/\/api\/stats\/insight$/];

export type Severity = 'error' | 'warning';
export interface Finding {
  severity: Severity;
  kind: string;
  screen: string;
  detail: string;
}

/** Top-level namespaces of the message tree: a drawn key path starts with one. */
const NAMESPACES = new Set(
  Object.keys(JSON.parse(readFileSync(join(__dirname, '..', 'messages', 'en.json'), 'utf8')) as object),
);

/** Query strings and fragments can carry tokens; a report keeps the path. */
function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname;
  } catch {
    return url.split('?')[0];
  }
}

export class Recorder {
  readonly findings: Finding[] = [];
  private screen = 'start';
  private readonly origin = new URL(baseUrl()).origin;

  constructor(private readonly page: Page) {
    page.on('pageerror', (err) => this.add('error', 'page-error', err.message.slice(0, 300)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') this.add('warning', 'console-error', msg.text().slice(0, 300));
    });
    page.on('response', (res) => {
      const url = res.url();
      if (!url.startsWith(this.origin)) return;
      const status = res.status();
      const what = `${res.request().method()} ${pathOf(url)} → ${status}`;
      if (status >= 500) {
        const offline = target() === 'mock' && MOCK_ONLY_5XX.some((re) => re.test(pathOf(url)));
        this.add(offline ? 'warning' : 'error', offline ? 'http-5xx-mock-env' : 'http-5xx', what);
      }
      // Its own kind: every persona shares one address, as a club on one gym
      // Wi-Fi does, so a limit tripped by ordinary browsing is worth seeing.
      else if (status === 429) this.add('warning', 'rate-limited', what);
      else if (status >= 400) this.add('warning', 'http-4xx', what);
    });
  }

  at(screen: string): void {
    this.screen = screen;
  }

  add(severity: Severity, kind: string, detail: string): void {
    this.findings.push({ severity, kind, screen: this.screen, detail });
  }

  /** The checks a screen gets once it has settled. */
  async inspect(): Promise<void> {
    const seen = await this.page.evaluate((namespaces: string[]) => {
      const ns = new Set(namespaces);
      const isVisible = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      const keys: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = (n.textContent ?? '').trim();
        if (!/^[a-zA-Z][\w-]*(\.[\w-]+)+$/.test(text)) continue;
        if (!ns.has(text.split('.')[0])) continue;
        const parent = n.parentElement;
        if (parent && isVisible(parent)) keys.push(text);
      }
      const loadFailures = Array.from(document.querySelectorAll('.error-state, [role="alert"]'))
        .filter(isVisible)
        .map((el) => (el.textContent ?? '').trim().slice(0, 120))
        .filter((t) => t.length > 0);
      const skeletons = Array.from(document.querySelectorAll('.shimmer-line')).filter(isVisible).length;
      const overflow = document.documentElement.scrollWidth - window.innerWidth;
      return { keys, loadFailures, skeletons, overflow };
    }, Array.from(NAMESPACES));

    await this.accessibility();
    for (const k of new Set(seen.keys)) this.add('error', 'i18n-key-on-screen', k);
    if (seen.overflow > 1) this.add('error', 'horizontal-overflow', `page is ${seen.overflow}px wider than the screen`);
    for (const t of new Set(seen.loadFailures)) this.add('warning', 'error-state', t);
    if (seen.skeletons > 0) this.add('warning', 'still-loading', `${seen.skeletons} skeleton line(s) still showing`);
  }

  /**
   * axe on the screen as it stands. Serious and critical only: the moderate
   * and minor rules are mostly best-practice, and a list nobody acts on
   * teaches people to skip the section. A failure to RUN axe is itself a
   * warning, never a silent pass.
   */
  private async accessibility(): Promise<void> {
    try {
      const result = await new AxeBuilder({ page: this.page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      for (const v of result.violations) {
        if (v.impact !== 'serious' && v.impact !== 'critical') continue;
        const first = v.nodes[0]?.target?.join(' ') ?? '';
        const more = v.nodes.length > 1 ? ` (+${v.nodes.length - 1} more)` : '';
        this.add('warning', `a11y:${v.id}`, `${v.help} — ${first}${more}`.slice(0, 300));
      }
    } catch (err) {
      this.add('warning', 'a11y:not-run', String(err).slice(0, 200));
    }
  }

  async attach(testInfo: TestInfo): Promise<void> {
    await testInfo.attach('findings.json', {
      body: JSON.stringify(this.findings, null, 2),
      contentType: 'application/json',
    });
    for (const f of this.findings) {
      testInfo.annotations.push({ type: `${f.severity}:${f.kind}`, description: `[${f.screen}] ${f.detail}` });
    }
  }

  errors(): Finding[] {
    return this.findings.filter((f) => f.severity === 'error');
  }
}
