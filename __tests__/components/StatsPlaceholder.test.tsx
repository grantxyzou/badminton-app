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

  it('renders three skeleton cards in the grid in English', () => {
    renderWithLocale('en');
    expect(screen.getByText('Cost related')).toBeTruthy();
    expect(screen.getByText('Partner and play style')).toBeTruthy();
    expect(screen.getByText('Your equipment')).toBeTruthy();
  });

  it('renders one "Coming soon" pill per card (3 total)', () => {
    renderWithLocale('en');
    const pills = screen.getAllByText(/Coming soon/i);
    expect(pills.length).toBe(3);
  });

  it('renders the page heading', () => {
    renderWithLocale('en');
    expect(screen.getByRole('heading', { level: 1, name: 'Your stats' })).toBeTruthy();
  });

  it('renders the "more coming" section label', () => {
    renderWithLocale('en');
    expect(screen.getByText('other metrics in the making')).toBeTruthy();
  });

  it('renders Chinese titles when locale is zh-CN', () => {
    renderWithLocale('zh-CN');
    expect(screen.getByText('费用相关')).toBeTruthy();
    expect(screen.getByText('搭档与打法')).toBeTruthy();
    expect(screen.getByText('你的装备')).toBeTruthy();
  });
});
