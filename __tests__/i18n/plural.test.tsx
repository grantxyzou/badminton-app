// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider, useTranslations } from 'next-intl';
import enMessages from '../../messages/en.json';
import zhMessages from '../../messages/zh-CN.json';

function Roster({ count }: { count: number }) {
  const t = useTranslations('home.roster');
  return <span data-testid="roster">{t('count', { count })}</span>;
}

describe('home.roster.count — plural rules per locale', () => {
  afterEach(cleanup);

  it.each([
    [0, 'No players yet'],
    [1, '1 player signed up'],
    [5, '5 players signed up'],
  ])('en count=%i renders "%s"', (count, expected) => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <Roster count={count} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId('roster').textContent).toBe(expected);
  });

  it.each([
    [1, '1 人已报名'],
    [5, '5 人已报名'],
  ])('zh-CN count=%i renders "%s" (no plural variation)', (count, expected) => {
    render(
      <NextIntlClientProvider locale="zh-CN" messages={zhMessages}>
        <Roster count={count} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId('roster').textContent).toBe(expected);
  });
});
