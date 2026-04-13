import { describe, it, expect } from 'vitest';
import { resolveLocale, SUPPORTED_LOCALES, DEFAULT_LOCALE } from '../../i18n/request';

describe('resolveLocale', () => {
  it('returns the cookie value when it is supported', () => {
    expect(resolveLocale('zh-CN', undefined)).toBe('zh-CN');
    expect(resolveLocale('en', undefined)).toBe('en');
  });

  it('coerces unsupported cookie values to the default locale', () => {
    expect(resolveLocale('fr', undefined)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale('', undefined)).toBe(DEFAULT_LOCALE);
  });

  it('falls back to Accept-Language when cookie is absent', () => {
    expect(resolveLocale(undefined, 'zh-CN,zh;q=0.9,en;q=0.8')).toBe('zh-CN');
    expect(resolveLocale(undefined, 'en-US,en;q=0.9')).toBe('en');
  });

  it('downgrades unknown accept-language to the default locale', () => {
    expect(resolveLocale(undefined, 'fr-FR,fr;q=0.9')).toBe(DEFAULT_LOCALE);
  });

  it('returns the default locale when both inputs are absent', () => {
    expect(resolveLocale(undefined, undefined)).toBe(DEFAULT_LOCALE);
  });

  it('exposes a frozen list of supported locales', () => {
    expect(SUPPORTED_LOCALES).toEqual(['en', 'zh-CN']);
  });
});
