'use client';

import { stageLook, type ToneStage } from '@/lib/stringingStatusTone';

/**
 * A stringing job's status as a pill: its own hue AND its own glyph, so it is
 * told apart by shape as well as colour (a colour-blind stringer, a dim gym).
 * One component for the stringer's list and the admin bench, so the two
 * cannot disagree about what "Received" looks like (Grant, 2026-11-12: "I am
 * having trouble telling the status apart").
 */
export default function StagePill({ stage, label, testId }: { stage: ToneStage; label: string; testId?: string }) {
  const look = stageLook(stage);
  return (
    <span
      className="fs-xs"
      data-testid={testId}
      data-stage={stage}
      style={{
        flex: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-1)',
        padding: 'var(--space-1) var(--space-4) var(--space-1) var(--space-3)',
        borderRadius: 'var(--radius-pill)',
        background: look.tint,
        color: look.tone,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      <span className="material-icons icon-xs" aria-hidden="true" style={{ color: look.tone }}>{look.icon}</span>
      {label}
    </span>
  );
}
