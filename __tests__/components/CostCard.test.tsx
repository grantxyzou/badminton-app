// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CostCard from '../../components/CostCard';

describe('CostCard', () => {
  it('renders cost and formatted date when all conditions met', () => {
    render(
      <CostCard
        showCostBreakdown={true}
        perPersonCost={11.25}
        datetime="2026-04-18T19:00:00-04:00"
      />
    );
    expect(screen.getByText(/Cost per person on/i)).toBeTruthy();
    expect(screen.getByText('$11.25')).toBeTruthy();
  });

  it('renders nothing when showCostBreakdown is false', () => {
    const { container } = render(
      <CostCard
        showCostBreakdown={false}
        perPersonCost={11.25}
        datetime="2026-04-18T19:00:00-04:00"
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when perPersonCost is null', () => {
    const { container } = render(
      <CostCard
        showCostBreakdown={true}
        perPersonCost={null}
        datetime="2026-04-18T19:00:00-04:00"
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when perPersonCost is zero', () => {
    const { container } = render(
      <CostCard
        showCostBreakdown={true}
        perPersonCost={0}
        datetime="2026-04-18T19:00:00-04:00"
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when datetime is empty', () => {
    const { container } = render(
      <CostCard
        showCostBreakdown={true}
        perPersonCost={11.25}
        datetime=""
      />
    );
    expect(container.firstChild).toBeNull();
  });
});
