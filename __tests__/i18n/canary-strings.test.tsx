// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider, useTranslations } from 'next-intl';
import enMessages from '../../messages/en.json';
import zhMessages from '../../messages/zh-CN.json';

const CANARY_KEYS = [
  'home.signup.button',
  'home.signup.waitlist',
  'home.signup.full',
  'home.signup.confirmed',
  'home.cost.label',
  'home.cost.emphasis',
  'home.session.date',
  'home.session.when',
  'home.roster.count',
  'home.payment.reminder',
  'home.payment.etransfer',
  'pages.signup.title',
  'pages.learn.title',
  'pages.admin.title',
] as const;

function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
}

describe('canary messages — all 14 keys exist in both locales', () => {
  it.each(CANARY_KEYS)('en.json defines %s', (key) => {
    expect(typeof getByPath(enMessages, key)).toBe('string');
  });

  it.each(CANARY_KEYS)('zh-CN.json defines %s', (key) => {
    expect(typeof getByPath(zhMessages, key)).toBe('string');
  });

  it('zh-CN strings differ from English (proves the pipe is swapping content)', () => {
    for (const key of CANARY_KEYS) {
      const en = getByPath(enMessages, key);
      const zh = getByPath(zhMessages, key);
      expect(zh, `key ${key}`).not.toBe(en);
    }
  });
});

// Render a minimal scratch consumer to prove useTranslations returns the right
// strings under both locales.
function Scratch({ k }: { k: string }) {
  const parts = k.split('.');
  const namespace = parts.slice(0, -1).join('.');
  const leaf = parts[parts.length - 1]!;
  const t = useTranslations(namespace);
  // Use default-safe args so interpolated keys still render non-empty text.
  const text = t(leaf, {
    name: 'Kevin',
    count: 3,
    amount: '$10.00',
    date: new Date('2026-04-13'),
    value: '40.00',
    email: 'pay@example.com',
  });
  return <span data-testid="out">{text}</span>;
}

describe('canary render in both locales', () => {
  afterEach(cleanup);

  it.each(CANARY_KEYS.filter((k) => k !== 'home.cost.emphasis'))(
    'renders %s in en',
    (key) => {
      render(
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <Scratch k={key} />
        </NextIntlClientProvider>,
      );
      const text = screen.getByTestId('out').textContent ?? '';
      expect(text.length).toBeGreaterThan(0);
    },
  );

  it.each(CANARY_KEYS.filter((k) => k !== 'home.cost.emphasis'))(
    'renders %s in zh-CN',
    (key) => {
      render(
        <NextIntlClientProvider locale="zh-CN" messages={zhMessages}>
          <Scratch k={key} />
        </NextIntlClientProvider>,
      );
      const text = screen.getByTestId('out').textContent ?? '';
      expect(text.length).toBeGreaterThan(0);
    },
  );
});

// home.cost.emphasis uses t.rich (JSX interpolation) — separate test.
function ScratchRich() {
  const t = useTranslations('home.cost');
  return (
    <span data-testid="rich">
      {t.rich('emphasis', {
        value: '40.00',
        amount: (chunks) => <strong>{chunks}</strong>,
      })}
    </span>
  );
}

describe('canary rich text (home.cost.emphasis)', () => {
  afterEach(cleanup);

  it('renders <amount> as a <strong> in en', () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ScratchRich />
      </NextIntlClientProvider>,
    );
    const strong = screen.getByTestId('rich').querySelector('strong');
    expect(strong?.textContent).toBe('40.00');
  });

  it('renders <amount> as a <strong> in zh-CN', () => {
    render(
      <NextIntlClientProvider locale="zh-CN" messages={zhMessages}>
        <ScratchRich />
      </NextIntlClientProvider>,
    );
    const strong = screen.getByTestId('rich').querySelector('strong');
    expect(strong?.textContent).toBe('40.00');
  });
});
