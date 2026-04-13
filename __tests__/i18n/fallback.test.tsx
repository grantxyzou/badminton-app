// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider, useTranslations } from 'next-intl';
import enMessages from '../../messages/en.json';
import zhMessages from '../../messages/zh-CN.json';

// Simulate the deep-merge behavior that i18n/request.ts applies server-side:
// zh-CN messages override English, but missing keys fall through to English.
function mergedZh() {
  const base = JSON.parse(JSON.stringify(enMessages));
  // Delete a key from the zh-CN branch to simulate a missing translation.
  const partialZh = JSON.parse(JSON.stringify(zhMessages));
  delete (partialZh as { home: { signup: { button?: string } } }).home.signup.button;
  function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...a };
    for (const k of Object.keys(b)) {
      const av = out[k];
      const bv = b[k];
      if (av && bv && typeof av === 'object' && typeof bv === 'object' && !Array.isArray(bv)) {
        out[k] = deepMerge(av as Record<string, unknown>, bv as Record<string, unknown>);
      } else {
        out[k] = bv;
      }
    }
    return out;
  }
  return deepMerge(base, partialZh);
}

function SignupLabel() {
  const t = useTranslations('home.signup');
  return <span data-testid="label">{t('button')}</span>;
}

describe('locale fallback — missing zh-CN key falls back to English', () => {
  afterEach(cleanup);

  it('renders the English string when zh-CN key is absent', () => {
    render(
      <NextIntlClientProvider locale="zh-CN" messages={mergedZh()}>
        <SignupLabel />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId('label').textContent).toBe('Sign Up');
  });

  it('renders the zh-CN string when present (sanity check)', () => {
    render(
      <NextIntlClientProvider locale="zh-CN" messages={zhMessages}>
        <SignupLabel />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId('label').textContent).toBe('报名');
  });
});
