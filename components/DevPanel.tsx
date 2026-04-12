'use client';

import { useState } from 'react';

export type DevOverrides = {
  showCostBreakdown?: boolean;
  costPerCourt?: number | null;
  courts?: number;
  hasAnnouncement?: boolean;
  announcementText?: string;
  paidStatus?: 'none' | 'selfReported' | 'confirmed';
  isSignedUp?: boolean;
  activePlayerCount?: number;
  prevCostPerPerson?: number | null;
};

const PRESETS: { label: string; overrides: DevOverrides }[] = [
  {
    label: 'Cost visible',
    overrides: { showCostBreakdown: true, costPerCourt: 20, courts: 2, hasAnnouncement: true, isSignedUp: true, activePlayerCount: 8, prevCostPerPerson: 4.5 },
  },
  {
    label: 'Cost hidden',
    overrides: { showCostBreakdown: false, costPerCourt: 20, courts: 2, hasAnnouncement: true, isSignedUp: true, activePlayerCount: 8, prevCostPerPerson: null },
  },
  {
    label: 'No announcement',
    overrides: { showCostBreakdown: true, costPerCourt: 20, courts: 2, hasAnnouncement: false, isSignedUp: true, activePlayerCount: 8, prevCostPerPerson: 4.5 },
  },
  {
    label: 'Payment reminder',
    overrides: { showCostBreakdown: true, costPerCourt: 20, courts: 2, hasAnnouncement: true, isSignedUp: true, activePlayerCount: 8, prevCostPerPerson: 4.5 },
  },
  {
    label: 'No prev cost',
    overrides: { showCostBreakdown: true, costPerCourt: 20, courts: 2, hasAnnouncement: true, isSignedUp: true, activePlayerCount: 8, prevCostPerPerson: null },
  },
  {
    label: 'Not signed up',
    overrides: { showCostBreakdown: true, costPerCourt: 20, courts: 2, hasAnnouncement: true, isSignedUp: false, activePlayerCount: 8, prevCostPerPerson: 4.5 },
  },
];

export default function DevPanel({
  overrides,
  onChange,
}: {
  overrides: DevOverrides;
  onChange: (o: DevOverrides) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  function set<K extends keyof DevOverrides>(key: K, value: DevOverrides[K]) {
    onChange({ ...overrides, [key]: value });
  }

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        style={{
          position: 'fixed',
          bottom: 100,
          right: 12,
          zIndex: 9999,
          background: '#7c3aed',
          color: '#fff',
          border: 'none',
          borderRadius: 9999,
          width: 40,
          height: 40,
          fontSize: 18,
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        title="Open dev panel"
      >
        <span className="material-icons" style={{ fontSize: 20 }}>science</span>
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 100,
        right: 12,
        zIndex: 9999,
        width: 260,
        maxHeight: 'calc(100vh - 140px)',
        overflowY: 'auto',
        background: 'rgba(30, 20, 50, 0.95)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(124, 58, 237, 0.4)',
        borderRadius: 16,
        padding: 16,
        color: '#e2e8f0',
        fontSize: 12,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#a78bfa' }}>
          Dev Panel
        </span>
        <button
          onClick={() => setCollapsed(true)}
          style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 2 }}
        >
          <span className="material-icons" style={{ fontSize: 16 }}>close</span>
        </button>
      </div>

      {/* Presets */}
      <div style={{ marginBottom: 12 }}>
        <p style={{ fontSize: 10, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Presets</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {PRESETS.map(p => (
            <button
              key={p.label}
              onClick={() => onChange({ ...overrides, ...p.overrides })}
              style={{
                background: 'rgba(124, 58, 237, 0.15)',
                border: '1px solid rgba(124, 58, 237, 0.3)',
                borderRadius: 8,
                padding: '3px 8px',
                color: '#c4b5fd',
                fontSize: 10,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.08)', margin: '8px 0' }} />

      {/* Controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* showCostBreakdown */}
        <ToggleRow
          label="Show cost to players"
          value={overrides.showCostBreakdown ?? false}
          onChange={v => set('showCostBreakdown', v)}
        />

        {/* costPerCourt */}
        <div>
          <label style={{ display: 'block', fontSize: 10, color: '#94a3b8', marginBottom: 3 }}>
            Cost per court: {overrides.costPerCourt ? `$${overrides.costPerCourt}` : 'None'}
          </label>
          <input
            type="range"
            min={0}
            max={50}
            step={0.5}
            value={overrides.costPerCourt ?? 0}
            onChange={e => set('costPerCourt', parseFloat(e.target.value) || null)}
            style={{ width: '100%', accentColor: '#7c3aed' }}
          />
        </div>

        {/* courts */}
        <div>
          <label style={{ display: 'block', fontSize: 10, color: '#94a3b8', marginBottom: 3 }}>
            Courts: {overrides.courts ?? 2}
          </label>
          <input
            type="range"
            min={1}
            max={6}
            step={1}
            value={overrides.courts ?? 2}
            onChange={e => set('courts', parseInt(e.target.value))}
            style={{ width: '100%', accentColor: '#7c3aed' }}
          />
        </div>

        {/* Announcement */}
        <ToggleRow
          label="Has announcement"
          value={overrides.hasAnnouncement ?? true}
          onChange={v => set('hasAnnouncement', v)}
        />

        {/* Signed up */}
        <ToggleRow
          label="Player signed up"
          value={overrides.isSignedUp ?? true}
          onChange={v => set('isSignedUp', v)}
        />

        {/* Paid status */}
        <div>
          <label style={{ display: 'block', fontSize: 10, color: '#94a3b8', marginBottom: 3 }}>Paid status</label>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['none', 'selfReported', 'confirmed'] as const).map(s => (
              <button
                key={s}
                onClick={() => set('paidStatus', s)}
                style={{
                  flex: 1,
                  padding: '4px 0',
                  fontSize: 10,
                  borderRadius: 6,
                  border: 'none',
                  cursor: 'pointer',
                  background: overrides.paidStatus === s ? '#7c3aed' : 'rgba(255,255,255,0.06)',
                  color: overrides.paidStatus === s ? '#fff' : '#94a3b8',
                  fontWeight: overrides.paidStatus === s ? 600 : 400,
                }}
              >
                {s === 'none' ? 'Unpaid' : s === 'selfReported' ? 'Reported' : 'Confirmed'}
              </button>
            ))}
          </div>
        </div>

        {/* Active player count */}
        <div>
          <label style={{ display: 'block', fontSize: 10, color: '#94a3b8', marginBottom: 3 }}>
            Active players: {overrides.activePlayerCount ?? 8}
          </label>
          <input
            type="range"
            min={0}
            max={20}
            step={1}
            value={overrides.activePlayerCount ?? 8}
            onChange={e => set('activePlayerCount', parseInt(e.target.value))}
            style={{ width: '100%', accentColor: '#7c3aed' }}
          />
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.08)', margin: '4px 0' }} />

        {/* Previous session cost (payment reminder) */}
        <div>
          <label style={{ display: 'block', fontSize: 10, color: '#94a3b8', marginBottom: 3 }}>
            Prev session cost: {overrides.prevCostPerPerson ? `$${overrides.prevCostPerPerson}` : 'None'}
          </label>
          <input
            type="range"
            min={0}
            max={20}
            step={0.5}
            value={overrides.prevCostPerPerson ?? 0}
            onChange={e => set('prevCostPerPerson', parseFloat(e.target.value) || null)}
            style={{ width: '100%', accentColor: '#7c3aed' }}
          />
        </div>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.08)', margin: '10px 0 6px' }} />

      {/* Live calculation preview */}
      <CostPreview overrides={overrides} />
    </div>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 11 }}>{label}</span>
      <button
        onClick={() => onChange(!value)}
        style={{
          width: 36,
          height: 20,
          borderRadius: 10,
          border: 'none',
          background: value ? '#22c55e' : 'rgba(255,255,255,0.15)',
          position: 'relative',
          cursor: 'pointer',
          transition: 'background 0.2s',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: value ? 18 : 2,
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: '#fff',
            transition: 'left 0.2s',
          }}
        />
      </button>
    </div>
  );
}

function CostPreview({ overrides }: { overrides: DevOverrides }) {
  const cost = (overrides.costPerCourt ?? 0) * (overrides.courts ?? 2);
  const players = overrides.activePlayerCount ?? 8;
  const perPerson = cost > 0 && players > 0 ? cost / players : 0;
  const visible = overrides.showCostBreakdown && perPerson > 0;

  return (
    <div style={{ fontSize: 10, color: '#94a3b8' }}>
      <p style={{ marginBottom: 2 }}>
        Court total: <span style={{ color: '#e2e8f0' }}>${cost.toFixed(2)}</span>
        {' '} / {players} players = <span style={{ color: visible ? '#22c55e' : '#ef4444' }}>${perPerson.toFixed(2)}</span>
      </p>
      <p>
        Will show: {visible ? (overrides.hasAnnouncement ? '✓ In announcement' : '✗ No announcement card') : '✗ Toggle off or $0'}
      </p>
    </div>
  );
}
