import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import en from '../messages/en.json';
import zh from '../messages/zh-CN.json';

/**
 * The public legal pages (`/bpm/legal/*`) are the URLs pasted into App Store
 * Connect and Play Console, and the one place a privacy policy is readable
 * without signing in. Two things about them are load-bearing and invisible to
 * the rest of the suite:
 *
 *  1. They must render from HTML alone — no client state, no fetch. A store
 *     crawler, a reviewer on a locked-down network, and a member who has
 *     deleted the app all need them without JavaScript or a session.
 *  2. Their copy lives as ARRAYS under `legal.*` read via `t.raw`, which
 *     `scripts/check-i18n-keys.mjs` cannot see. So the shape is pinned here,
 *     in both locales.
 */
const LEGAL_DIR = join(process.cwd(), 'app', 'legal');
const DOCS = ['privacy', 'terms', 'support', 'deleteAccount'] as const;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

interface Section { h: string; p: string[] }
type LegalMessages = {
  common: { back: string; updated: string };
  privacy: { title: string; updated: string; sections: Section[] };
  terms: { title: string; updated: string; sections: Section[] };
  support: { title: string; updated: string; sections: Section[]; emailLabel: string; deleteLink: string; privacyLink: string };
  deleteAccount: {
    title: string; updated: string; intro: string; stepsTitle: string; steps: string[]; cta: string;
    whatTitle: string; what: string[]; keepsTitle: string; keeps: string[]; noAppTitle: string; noApp: string; emailLabel: string;
  };
};

describe('legal pages — server-only', () => {
  const files = walk(LEGAL_DIR).filter((f) => f.endsWith('.tsx'));

  it('exist for all four routes', () => {
    for (const route of ['privacy', 'terms', 'support', 'delete-account']) {
      expect(files.some((f) => f.endsWith(join(route, 'page.tsx'))), route).toBe(true);
    }
  });

  it.each(files)('%s has no client boundary and no fetch', (file) => {
    const src = readFileSync(file, 'utf8');
    expect(src).not.toMatch(/['"]use client['"]/);
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/\buseState\b|\buseEffect\b/);
  });

  it('layout is not flag-gated and is indexable', () => {
    const src = readFileSync(join(LEGAL_DIR, 'layout.tsx'), 'utf8');
    expect(src).not.toMatch(/notFound\(|isFlagOn/);
    expect(src).toMatch(/index:\s*true/);
  });

  it('delete-account links into the app with the delete intent', () => {
    // The in-app sheet is the ONLY deletion path; this page must reach it.
    const src = readFileSync(join(LEGAL_DIR, 'delete-account', 'page.tsx'), 'utf8');
    expect(src).toMatch(/tab=profile&intent=delete/);
  });

  it('never renders a placeholder when SUPPORT_EMAIL is unset', () => {
    for (const route of ['support', 'delete-account']) {
      const src = readFileSync(join(LEGAL_DIR, route, 'page.tsx'), 'utf8');
      expect(src).toMatch(/SUPPORT_EMAIL/);
      expect(src).toMatch(/\{email &&/);
    }
  });
});

describe('legal copy — both locales, same shape', () => {
  const locales = { en: (en as { legal: LegalMessages }).legal, 'zh-CN': (zh as { legal: LegalMessages }).legal };

  it.each(Object.entries(locales))('%s defines every document', (_name, legal) => {
    expect(legal).toBeDefined();
    for (const doc of DOCS) {
      const d = legal[doc];
      expect(typeof d.title, `${doc}.title`).toBe('string');
      expect(typeof d.updated, `${doc}.updated`).toBe('string');
    }
    expect(legal.common.updated).toContain('{date}');
  });

  it.each(Object.entries(locales))('%s sections are non-empty heading + paragraphs', (_name, legal) => {
    for (const doc of ['privacy', 'terms', 'support'] as const) {
      const sections = legal[doc].sections;
      expect(Array.isArray(sections)).toBe(true);
      expect(sections.length, `${doc}.sections`).toBeGreaterThan(0);
      for (const s of sections) {
        expect(s.h.trim().length, `${doc} heading`).toBeGreaterThan(0);
        expect(s.p.length, `${doc} "${s.h}" paragraphs`).toBeGreaterThan(0);
        for (const p of s.p) expect(p.trim().length).toBeGreaterThan(0);
      }
    }
    for (const list of ['steps', 'what', 'keeps'] as const) {
      expect(legal.deleteAccount[list].length, `deleteAccount.${list}`).toBeGreaterThan(0);
    }
  });

  it('both locales have the same number of sections per document', () => {
    // A section added in one language and not the other would render a
    // policy that says less to half the members.
    for (const doc of ['privacy', 'terms', 'support'] as const) {
      expect(locales['zh-CN'][doc].sections.length, doc).toBe(locales.en[doc].sections.length);
    }
    for (const list of ['steps', 'what', 'keeps'] as const) {
      expect(locales['zh-CN'].deleteAccount[list].length, list).toBe(locales.en.deleteAccount[list].length);
    }
  });

  it('the privacy policy names the data that is easy to under-declare', () => {
    // These are the store-label items reviewers audit; the policy must match.
    const text = locales.en.privacy.sections.flatMap((s) => s.p).join(' ');
    for (const needle of ['e-transfer', 'push token', 'PIN', 'Google', 'Apple', 'Azure', 'No ads']) {
      expect(text, needle).toContain(needle);
    }
  });
});
