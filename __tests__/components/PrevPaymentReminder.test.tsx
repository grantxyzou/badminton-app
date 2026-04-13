// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import PrevPaymentReminder from '../../components/PrevPaymentReminder';

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
    render(<PrevPaymentReminder {...baseProps} />);
    expect(screen.getByText(/\$11\.25\/person/)).toBeTruthy();
    expect(screen.getByText(/E-transfer to pay@example\.com/)).toBeTruthy();
  });

  it('renders nothing when hasIdentity is false', () => {
    const { container } = render(
      <PrevPaymentReminder {...baseProps} hasIdentity={false} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when showCostBreakdown is false', () => {
    const { container } = render(
      <PrevPaymentReminder {...baseProps} showCostBreakdown={false} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when prevCostPerPerson is undefined', () => {
    const { container } = render(
      <PrevPaymentReminder {...baseProps} prevCostPerPerson={undefined} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when prevCostPerPerson is zero', () => {
    const { container } = render(
      <PrevPaymentReminder {...baseProps} prevCostPerPerson={0} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('still shows cost line even if etransferEmail is null', () => {
    render(<PrevPaymentReminder {...baseProps} etransferEmail={null} />);
    expect(screen.getByText(/\$11\.25\/person/)).toBeTruthy();
    expect(screen.queryByText(/E-transfer to/)).toBeNull();
  });
});
