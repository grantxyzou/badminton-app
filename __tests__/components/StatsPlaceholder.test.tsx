// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import StatsPlaceholder from '../../components/stats/StatsPlaceholder';
import enMessages from '../../messages/en.json';
import zhMessages from '../../messages/zh-CN.json';

function renderWithLocale(locale: 'en' | 'zh-CN') {
  const messages = locale === 'en' ? enMessages : zhMessages;
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <StatsPlaceholder />
    </NextIntlClientProvider>,
  );
}

describe('StatsPlaceholder', () => {
  afterEach(cleanup);

  it('renders four skeleton cards with titles in English', () => {
    renderWithLocale('en');
    expect(screen.getByText('Skill progression')).toBeTruthy();
    expect(screen.getByText('Your Attendance')).toBeTruthy();
    expect(screen.getByText('Cost trend')).toBeTruthy();
    expect(screen.getByText('Partner frequency')).toBeTruthy();
  });

  it('renders one "Coming soon" pill per card (4 total)', () => {
    renderWithLocale('en');
    const pills = screen.getAllByText(/Coming soon/i);
    expect(pills.length).toBe(4);
  });

  it('renders the page heading', () => {
    renderWithLocale('en');
    expect(screen.getByRole('heading', { level: 1, name: 'Your stats' })).toBeTruthy();
  });

  it('renders Chinese titles when locale is zh-CN', () => {
    renderWithLocale('zh-CN');
    expect(screen.getByText('技能进展')).toBeTruthy();
    expect(screen.getByText('您的出勤记录')).toBeTruthy();
    expect(screen.getByText('费用趋势')).toBeTruthy();
    expect(screen.getByText('搭档频率')).toBeTruthy();
  });
});
