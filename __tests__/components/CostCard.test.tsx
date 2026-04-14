// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import CostCard from '../../components/CostCard';
import enMessages from '../../messages/en.json';
import zhMessages from '../../messages/zh-CN.json';

describe('CostCard', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders cost and formatted date when all conditions met', () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <CostCard
          showCostBreakdown={true}
          perPersonCost={11.25}
          datetime="2026-04-18T19:00:00-04:00"
        />
      </NextIntlClientProvider>
    );
    expect(screen.getByText(/Estimated cost/i)).toBeTruthy();
    expect(screen.getByText('~$11.25')).toBeTruthy();
  });

  it('renders nothing when showCostBreakdown is false', () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <CostCard
          showCostBreakdown={false}
          perPersonCost={11.25}
          datetime="2026-04-18T19:00:00-04:00"
        />
      </NextIntlClientProvider>
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when perPersonCost is null', () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <CostCard
          showCostBreakdown={true}
          perPersonCost={null}
          datetime="2026-04-18T19:00:00-04:00"
        />
      </NextIntlClientProvider>
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when perPersonCost is zero', () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <CostCard
          showCostBreakdown={true}
          perPersonCost={0}
          datetime="2026-04-18T19:00:00-04:00"
        />
      </NextIntlClientProvider>
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when datetime is empty', () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <CostCard
          showCostBreakdown={true}
          perPersonCost={11.25}
          datetime=""
        />
      </NextIntlClientProvider>
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the zh-CN cost label when locale is zh-CN', () => {
    render(
      <NextIntlClientProvider locale="zh-CN" messages={zhMessages}>
        <CostCard showCostBreakdown={true} perPersonCost={10} datetime="2026-04-13T19:00:00-04:00" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('预估费用')).toBeTruthy();
  });
});
