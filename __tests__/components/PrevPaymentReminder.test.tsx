// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import PrevPaymentReminder from '../../components/PrevPaymentReminder';
import enMessages from '../../messages/en.json';
import zhMessages from '../../messages/zh-CN.json';

describe('PrevPaymentReminder', () => {
  afterEach(() => {
    cleanup();
  });

  const baseProps = {
    showCostBreakdown: true,
    prevCostPerPerson: 11.25,
    prevSessionDate: '2026-04-11T19:00:00-04:00',
    hasIdentity: true,
    etransferEmail: 'pay@example.com',
  };

  it('renders cost and e-transfer line when identity exists and prev cost > 0', () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <PrevPaymentReminder {...baseProps} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(/\$11\.25\/person/)).toBeTruthy();
    expect(screen.getByText(/E-transfer to pay@example\.com/)).toBeTruthy();
  });

  it('renders nothing when hasIdentity is false', () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <PrevPaymentReminder {...baseProps} hasIdentity={false} />
      </NextIntlClientProvider>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when showCostBreakdown is false', () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <PrevPaymentReminder {...baseProps} showCostBreakdown={false} />
      </NextIntlClientProvider>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when prevCostPerPerson is undefined', () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <PrevPaymentReminder {...baseProps} prevCostPerPerson={undefined} />
      </NextIntlClientProvider>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when prevCostPerPerson is zero', () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <PrevPaymentReminder {...baseProps} prevCostPerPerson={0} />
      </NextIntlClientProvider>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('still shows cost line even if etransferEmail is null', () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <PrevPaymentReminder {...baseProps} etransferEmail={null} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(/\$11\.25\/person/)).toBeTruthy();
    expect(screen.queryByText(/E-transfer to/)).toBeNull();
  });

  it('renders zh-CN reminder and e-transfer lines when locale is zh-CN', () => {
    render(
      <NextIntlClientProvider locale="zh-CN" messages={zhMessages}>
        <PrevPaymentReminder
          showCostBreakdown={true}
          prevCostPerPerson={11.25}
          prevSessionDate="2026-04-11"
          hasIdentity={true}
          etransferEmail="pay@example.com"
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(/上次活动/)).toBeTruthy();
    expect(screen.getByText(/\/人/)).toBeTruthy();
    expect(screen.getByText(/转账至 pay@example\.com/)).toBeTruthy();
  });
});
