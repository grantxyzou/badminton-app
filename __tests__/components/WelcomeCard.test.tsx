// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import WelcomeCard from '../../components/WelcomeCard';
import enMessages from '../../messages/en.json';
import zhMessages from '../../messages/zh-CN.json';

function renderWithLocale(locale: 'en' | 'zh-CN', onDismiss = vi.fn()) {
  const messages = locale === 'en' ? enMessages : zhMessages;
  render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <WelcomeCard onDismiss={onDismiss} />
    </NextIntlClientProvider>,
  );
  return onDismiss;
}

describe('WelcomeCard', () => {
  afterEach(cleanup);

  it('renders title and three bullet items in EN', () => {
    renderWithLocale('en');
    expect(screen.getByText('Welcome to BPM Badminton')).toBeTruthy();
    expect(screen.getByText(/Weekly sessions on Thursdays/)).toBeTruthy();
    expect(screen.getByText(/Invite-only/)).toBeTruthy();
    expect(screen.getByText(/Pay your share/)).toBeTruthy();
    expect(screen.getByText(/Ask the player who shared/)).toBeTruthy();
  });

  it('renders zh-CN content', () => {
    renderWithLocale('zh-CN');
    expect(screen.getByText('欢迎来到 BPM 羽毛球')).toBeTruthy();
    expect(screen.getByText(/每周四活动/)).toBeTruthy();
    expect(screen.getByText(/仅限邀请/)).toBeTruthy();
  });

  it('calls onDismiss when dismiss button is clicked', () => {
    const onDismiss = renderWithLocale('en');
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismiss button has accessible label', () => {
    renderWithLocale('en');
    expect(screen.getByRole('button', { name: 'Got it' })).toBeTruthy();
  });
});
