'use client';

import Link from 'next/link';

/* ────────────────────────────────────────────────────────────────────────
   Stats playground — three narrative arcs, mocked, so we can pick an arc
   to ship rather than cherry-picking isolated cards.

   Arc 1 — Per-person "Your season so far"
   Arc 2 — Per-group "The club pulse"
   Arc 3 — Per-session "Anatomy of Thursday"

   All data is fabricated. Charts are inline SVG — no recharts dep on this
   route, so load is cheap.
──────────────────────────────────────────────────────────────────────── */

const ACCENT = 'var(--accent, #22c55e)';
const MUTED = 'var(--text-muted)';
const PRIMARY = 'var(--text-primary)';
const DANGER = '#ef4444';
const WARN = '#fbbf24';

/* ═══════════════════════════════ PRIMITIVES ═══════════════════════════ */

function Chip({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 10,
        padding: '3px 8px',
        borderRadius: 100,
        whiteSpace: 'nowrap',
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        border: `1px solid ${color}`,
        color,
        background: 'transparent',
      }}
    >
      {children}
    </span>
  );
}

function Card({
  icon, title, beat, children,
}: { icon: string; title: string; beat: string; children: React.ReactNode }) {
  return (
    <div className="glass-card p-5 space-y-3">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <span className="material-icons" aria-hidden="true" style={{ fontSize: 22, color: ACCENT, marginTop: 2 }}>
          {icon}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: PRIMARY, margin: 0, lineHeight: 1.25 }}>{title}</h3>
          <p style={{ fontSize: 12, color: MUTED, margin: 0, marginTop: 2, fontStyle: 'italic' }}>&ldquo;{beat}&rdquo;</p>
        </div>
      </div>
      <div>{children}</div>
    </div>
  );
}

function Arc({
  index, title, intro, audience, shipOrder, children,
}: {
  index: number;
  title: string;
  intro: string;
  audience: string;
  shipOrder: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ display: 'grid', gap: 14 }}>
      <div
        style={{
          padding: '16px 18px',
          borderLeft: `3px solid ${ACCENT}`,
          background: 'color-mix(in oklab, var(--accent, #22c55e) 8%, transparent)',
          borderRadius: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span
            style={{
              width: 24, height: 24, borderRadius: '50%',
              background: ACCENT, color: '#0a0a0a',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 12,
              fontFamily: 'var(--font-mono)',
            }}
          >
            {index}
          </span>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: PRIMARY, margin: 0 }}>{title}</h2>
        </div>
        <p style={{ fontSize: 13, color: PRIMARY, margin: 0, marginBottom: 4 }}>{intro}</p>
        <p style={{ fontSize: 11, color: MUTED, margin: 0 }}>
          <strong>Audience:</strong> {audience} &nbsp;·&nbsp; <strong>Ship order:</strong> {shipOrder}
        </p>
      </div>
      <div style={{ display: 'grid', gap: 12 }}>{children}</div>
    </section>
  );
}

/* ═══════════════════════════════ VIZ — SHARED ═══════════════════════════ */

function AttendanceStrip({ weeks, label }: { weeks: number[]; label?: string }) {
  const total = weeks.filter((w) => w === 1).length;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 26, fontWeight: 700, color: PRIMARY }}>
        {total}<span style={{ fontSize: 13, fontWeight: 500, color: MUTED, marginLeft: 6 }}>of {weeks.length} weeks</span>
      </p>
      <div style={{ display: 'flex', gap: 3 }}>
        {weeks.map((w, i) => (
          <div
            key={i}
            title={`Week ${i + 1}: ${w ? 'played' : 'missed'}`}
            style={{
              flex: 1,
              height: 24,
              borderRadius: 4,
              background: w ? ACCENT : 'var(--inner-card-bg)',
              opacity: w ? 1 : 0.6,
              border: `1px solid ${w ? 'transparent' : 'var(--inner-card-border)'}`,
            }}
          />
        ))}
      </div>
      {label && <p style={{ margin: 0, fontSize: 11, color: MUTED }}>{label}</p>}
    </div>
  );
}

function PartnerBars({ data }: { data: { name: string; count: number }[] }) {
  const max = Math.max(...data.map((d) => d.count));
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {data.map((d) => (
        <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 64, fontSize: 12, color: PRIMARY }}>{d.name}</span>
          <div style={{ flex: 1, height: 10, borderRadius: 100, background: 'var(--inner-card-bg)', overflow: 'hidden' }}>
            <div style={{ width: `${(d.count / max) * 100}%`, height: '100%', background: ACCENT, borderRadius: 100 }} />
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: MUTED, minWidth: 24, textAlign: 'right' }}>
            {d.count}
          </span>
        </div>
      ))}
    </div>
  );
}

function Sparkline({ points, suffix, label }: { points: number[]; suffix?: string; label?: string }) {
  const W = 260, H = 60, pad = 10;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const stride = (W - pad * 2) / (points.length - 1);
  const scale = (v: number) => H - pad - ((v - min) / (max - min || 1)) * (H - pad * 2);
  const pts = points.map((v, i) => `${pad + i * stride},${scale(v)}`).join(' ');
  const last = points[points.length - 1];
  const avg = Math.round((points.reduce((a, b) => a + b, 0) / points.length) * 100) / 100;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
        <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 24, fontWeight: 700, color: PRIMARY }}>
          {suffix === '$' ? '$' : ''}{last.toFixed(suffix === '$' ? 2 : 0)}{suffix && suffix !== '$' ? ` ${suffix}` : ''}
        </p>
        <p style={{ margin: 0, fontSize: 11, color: MUTED }}>
          latest · avg <span style={{ fontFamily: 'var(--font-mono)' }}>{suffix === '$' ? '$' : ''}{avg.toFixed(suffix === '$' ? 2 : 0)}</span>
        </p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label ?? 'Trend'}>
        <polyline points={pts} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {points.map((v, i) => (
          <circle key={i} cx={pad + i * stride} cy={scale(v)} r={i === points.length - 1 ? 4 : 2.5} fill={ACCENT} />
        ))}
      </svg>
    </div>
  );
}

function CircleProgress({ pct, label, context }: { pct: number; label: string; context: string }) {
  const R = 26;
  const C = 2 * Math.PI * R;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <svg width={64} height={64} viewBox="0 0 64 64">
        <circle cx={32} cy={32} r={R} fill="none" stroke="var(--inner-card-bg)" strokeWidth={8} />
        <circle
          cx={32} cy={32} r={R}
          fill="none" stroke={ACCENT} strokeWidth={8} strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * C} ${C}`}
          transform="rotate(-90 32 32)"
        />
        <text x={32} y={37} textAnchor="middle" fontSize="13" fontWeight="700" fill={PRIMARY} fontFamily="var(--font-mono)">
          {pct}%
        </text>
      </svg>
      <div>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: PRIMARY }}>{label}</p>
        <p style={{ margin: 0, fontSize: 12, color: MUTED }}>{context}</p>
      </div>
    </div>
  );
}

function HeroNumber({ value, unit, caption }: { value: string; unit?: string; caption: string }) {
  return (
    <div>
      <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 30, fontWeight: 700, color: PRIMARY, lineHeight: 1 }}>
        {value}
        {unit && <span style={{ fontSize: 14, fontWeight: 500, color: MUTED, marginLeft: 6 }}>{unit}</span>}
      </p>
      <p style={{ margin: 0, marginTop: 6, fontSize: 12, color: MUTED }}>{caption}</p>
    </div>
  );
}

/* ═══════════════════════════════ ARC 1 — PER-PERSON ═══════════════════════════════ */

function StreakBadge() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div
        style={{
          width: 56, height: 56, borderRadius: '50%',
          background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: '#fff' }}>7</span>
      </div>
      <div>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: PRIMARY }}>7 weeks in a row</p>
        <p style={{ margin: 0, fontSize: 12, color: MUTED }}>Longest: 9 weeks (Feb–Apr). You&rsquo;re close to it.</p>
      </div>
    </div>
  );
}

function NextSession() {
  return (
    <div
      style={{
        background: 'color-mix(in oklab, var(--accent, #22c55e) 10%, transparent)',
        border: `1px solid ${ACCENT}`,
        borderRadius: 12,
        padding: 14,
        display: 'grid',
        gap: 4,
      }}
    >
      <p style={{ margin: 0, fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', color: ACCENT, textTransform: 'uppercase' }}>
        Next up
      </p>
      <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: PRIMARY }}>
        Thursday · Marpole · 7:30 pm
      </p>
      <p style={{ margin: 0, fontSize: 12, color: MUTED }}>
        8 signed up · 4 spots left · sign up before Wed 8pm
      </p>
    </div>
  );
}

/* ═══════════════════════════════ ARC 2 — PER-GROUP ═══════════════════════════════ */

function FillTimeTrend() {
  const times = [42, 28, 19, 15, 11, 8, 6];
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
        <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 26, fontWeight: 700, color: ACCENT }}>
          6<span style={{ fontSize: 13, fontWeight: 500, color: MUTED, marginLeft: 4 }}>min</span>
        </p>
        <Chip color={ACCENT}>Fastest ever</Chip>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 48 }}>
        {times.map((t, i) => {
          const h = Math.max(6, (t / Math.max(...times)) * 42);
          return (
            <div
              key={i}
              style={{
                flex: 1,
                height: h,
                background: ACCENT,
                opacity: 0.4 + (i / times.length) * 0.6,
                borderRadius: 3,
              }}
            />
          );
        })}
      </div>
      <p style={{ margin: 0, fontSize: 11, color: MUTED }}>
        Filling 6× faster than 7 weeks ago. Time to consider a 3rd court or split the night.
      </p>
    </div>
  );
}

function WaitlistPressure() {
  const names = [
    { name: 'Alex',  times: 4 },
    { name: 'Jamie', times: 3 },
    { name: 'Mina',  times: 3 },
    { name: 'Chen',  times: 2 },
  ];
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <HeroNumber value="4" caption="regulars repeatedly on the waitlist — might churn if we don't make room" />
      <div style={{ display: 'grid', gap: 4, marginTop: 4 }}>
        {names.map((n) => (
          <div key={n.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ color: PRIMARY }}>{n.name}</span>
            <span style={{ color: MUTED, fontFamily: 'var(--font-mono)' }}>
              waitlisted {n.times}×
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CostPulse() {
  return <Sparkline points={[9.5, 11.25, 10.75, 12, 10.5, 11.75, 13.25, 12]} suffix="$" label="Cost per person, last 8 sessions" />;
}

function BirdSupply() {
  const remaining = 52;
  const runway = 4;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <span className="material-icons" style={{ fontSize: 32, color: runway < 3 ? WARN : ACCENT }}>
          inventory_2
        </span>
      </div>
      <div>
        <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: PRIMARY }}>
          {remaining}<span style={{ fontSize: 12, fontWeight: 500, color: MUTED }}> tubes</span>
        </p>
        <p style={{ margin: 0, fontSize: 12, color: MUTED }}>
          ~{runway} weeks at current pace · reorder by mid-May
        </p>
      </div>
    </div>
  );
}

function AttendanceRoster() {
  const top = [
    { name: 'Grant',  count: 12, streak: 7 },
    { name: 'Kevin',  count: 11, streak: 5 },
    { name: 'Luna',   count: 10, streak: 3 },
    { name: 'James',  count: 9,  streak: 2 },
    { name: 'Anna',   count: 9,  streak: 2 },
  ];
  const inactive = [
    { name: 'Rob',   last: '4 weeks ago' },
    { name: 'Priya', last: '5 weeks ago' },
    { name: 'Omar',  last: '6 weeks ago' },
  ];
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div>
        <p style={{ margin: 0, fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', color: ACCENT, textTransform: 'uppercase' }}>
          Anchors
        </p>
        <div style={{ display: 'grid', gap: 4, marginTop: 4 }}>
          {top.map((p) => (
            <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: PRIMARY }}>{p.name}</span>
              <span style={{ color: MUTED, fontFamily: 'var(--font-mono)' }}>
                {p.count} sessions · {p.streak}-week streak
              </span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <p style={{ margin: 0, fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', color: WARN, textTransform: 'uppercase' }}>
          Drifting — send a nudge?
        </p>
        <div style={{ display: 'grid', gap: 4, marginTop: 4 }}>
          {inactive.map((p) => (
            <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: PRIMARY }}>{p.name}</span>
              <span style={{ color: MUTED }}>{p.last}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BirdValueScatter() {
  const points = [
    { name: 'Yonex AS-50',     x: 4.2, y: 9.5,  good: true },
    { name: 'Victor Master',   x: 3.8, y: 7.2,  good: true,  star: true },
    { name: 'RSL Classic',     x: 4.5, y: 5.1,  good: true },
    { name: 'No-brand',        x: 2.1, y: 3.2,  good: false },
    { name: 'Yonex Aerosensa', x: 4.8, y: 14.5, good: true },
  ];
  const W = 260, H = 120, pad = 24;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%">
        <line x1={pad} x2={W - pad} y1={H - pad} y2={H - pad} stroke={MUTED} strokeOpacity={0.2} />
        <line x1={pad} x2={pad} y1={pad} y2={H - pad} stroke={MUTED} strokeOpacity={0.2} />
        <text x={pad + 4} y={pad + 8} fontSize="9" fill={MUTED}>$/tube</text>
        <text x={W - pad - 28} y={H - pad + 12} fontSize="9" fill={MUTED}>Quality</text>
        {points.map((p, i) => {
          const cx = pad + (p.x / 5) * (W - pad * 2);
          const cy = H - pad - (p.y / 16) * (H - pad * 2);
          return (
            <g key={i}>
              <circle cx={cx} cy={cy} r={p.star ? 8 : 5} fill={p.good ? ACCENT : DANGER} fillOpacity={p.star ? 0.9 : 0.6} stroke={p.good ? ACCENT : DANGER} />
              {p.star && <circle cx={cx} cy={cy} r={12} fill="none" stroke={ACCENT} strokeOpacity={0.4} strokeDasharray="2 2" />}
            </g>
          );
        })}
      </svg>
      <p style={{ margin: 0, fontSize: 11, color: MUTED }}>
        Victor Master is the sweet spot — high quality at a reasonable $/tube. Buy more of those.
      </p>
    </div>
  );
}

/* ═══════════════════════════════ ARC 3 — PER-SESSION ═══════════════════════════════ */

function SessionSetting() {
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <p style={{ margin: 0, fontSize: 18, fontWeight: 700, color: PRIMARY }}>
        Thursday · April 24 · 7:30–9:30 pm
      </p>
      <p style={{ margin: 0, fontSize: 12, color: MUTED }}>
        Marpole Community Centre · 2 courts · 12 players
      </p>
    </div>
  );
}

function DemandSignal() {
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
      <div>
        <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: PRIMARY }}>14 min</p>
        <p style={{ margin: 0, fontSize: 11, color: MUTED }}>to fill</p>
      </div>
      <div style={{ width: 1, height: 36, background: 'var(--inner-card-border)' }} />
      <div>
        <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: WARN }}>3</p>
        <p style={{ margin: 0, fontSize: 11, color: MUTED }}>waitlisted at start</p>
      </div>
    </div>
  );
}

function SessionReceipt() {
  return (
    <div style={{ display: 'grid', gap: 4, fontSize: 13 }}>
      <Row k="Courts" v="2 × $45 = $90.00" />
      <Row k="Birds" v="2 tubes Yonex AS-50 · $28.00" />
      <Row k="Total" v="$118.00" strong />
      <div style={{ height: 1, background: 'var(--inner-card-border)', margin: '6px 0' }} />
      <Row k="Per person" v="$11.80 (10 paid)" strong accent />
    </div>
  );
}

function Row({ k, v, strong, accent }: { k: string; v: string; strong?: boolean; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: MUTED }}>{k}</span>
      <span
        style={{
          color: accent ? ACCENT : PRIMARY,
          fontWeight: strong ? 600 : 400,
          fontFamily: 'var(--font-mono)',
        }}
      >
        {v}
      </span>
    </div>
  );
}

function SessionRoster() {
  const played = ['Grant', 'Kevin', 'Luna', 'James', 'Anna', 'Daiyu', 'Min', 'Chen', 'Tara', 'Nate'];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {played.map((name) => (
        <span
          key={name}
          style={{
            fontSize: 11,
            padding: '4px 10px',
            borderRadius: 100,
            background: 'var(--inner-card-bg)',
            border: '1px solid var(--inner-card-border)',
            color: PRIMARY,
          }}
        >
          {name}
        </span>
      ))}
    </div>
  );
}

function PaymentLoopClose() {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', gap: 2, height: 8, borderRadius: 100, overflow: 'hidden' }}>
        <div style={{ flex: 10, background: ACCENT }} />
        <div style={{ flex: 2, background: 'var(--inner-card-border)' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
        <span style={{ color: ACCENT }}>10 paid</span>
        <span style={{ color: MUTED }}>2 still owe $11.80</span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════ PAGE ═══════════════════════════════ */

export default function StatsPlaygroundPage() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '2rem 1rem', display: 'grid', gap: 36 }}>
      <div>
        <Link
          href="/design"
          style={{ color: MUTED, fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <span className="material-icons" style={{ fontSize: 16 }}>arrow_back</span>
          Design index
        </Link>
        <h1 className="bpm-h1" style={{ marginTop: 12, marginBottom: 6 }}>Stats — three narratives</h1>
        <p className="bpm-body" style={{ color: MUTED, marginTop: 0 }}>
          Each arc is a sequence of cards with an emotional beat. Pick an arc to ship; cherry-picking single cards across
          arcs dilutes the story. All cards here are derivable today — no schema changes.
        </p>
      </div>

      {/* ── ARC 1 ────────────────────────────────────────────────────── */}
      <Arc
        index={1}
        title="Your season so far"
        intro="A self-portrait. Opens proud, lands practical. Works for any member, logged in or not."
        audience="Every player"
        shipOrder="First — biggest retention pull"
      >
        <Card icon="local_fire_department" title="7 weeks in a row" beat="I show up.">
          <StreakBadge />
        </Card>
        <Card icon="calendar_today" title="Played 9 of 12 weeks" beat="The club is part of my life.">
          <AttendanceStrip weeks={[1, 1, 0, 1, 1, 1, 0, 0, 1, 1, 1, 1]} label="2 misses in a row mid-March — travel week" />
        </Card>
        <Card icon="groups" title="Kevin, Luna, James" beat="These are my people.">
          <PartnerBars data={[
            { name: 'Kevin', count: 9 },
            { name: 'Luna',  count: 7 },
            { name: 'James', count: 5 },
            { name: 'Anna',  count: 3 },
            { name: 'Daiyu', count: 2 },
          ]} />
        </Card>
        <Card icon="schedule" title="24.5 hours on court" beat="I&rsquo;ve invested real time.">
          <HeroNumber value="24.5" unit="hrs" caption="This quarter · 11 sessions × 2.2h avg · ~1h/week" />
        </Card>
        <Card icon="verified" title="Paid on time 92%" beat="I&rsquo;m reliable.">
          <CircleProgress pct={92} label="11 of 12 cleared" context="before the next session started" />
        </Card>
        <Card icon="payments" title="$136.50 this quarter" beat="Here&rsquo;s what it costs.">
          <Sparkline points={[11, 12.5, 11.25, 13, 11.75, 12.25, 13.5, 11.80]} suffix="$" label="My $/session" />
        </Card>
        <Card icon="event" title="Thursday @ Marpole" beat="I know where I&rsquo;m going next.">
          <NextSession />
        </Card>
      </Arc>

      {/* ── ARC 2 ────────────────────────────────────────────────────── */}
      <Arc
        index={2}
        title="The club pulse"
        intro="Diagnostic. Ordered by decision urgency — each card sets up a &lsquo;so what should I do&rsquo; prompt for the admin."
        audience="Admin only"
        shipOrder="Third — highest-leverage, needs the most polish"
      >
        <Card icon="bolt" title="Filled in 6 minutes" beat="Demand is ahead of capacity. Open another court?">
          <FillTimeTrend />
        </Card>
        <Card icon="hourglass_empty" title="4 regulars keep hitting the waitlist" beat="These names may churn if we don&rsquo;t make room.">
          <WaitlistPressure />
        </Card>
        <Card icon="payments" title="$12.50 avg per session · stable" beat="Cost isn&rsquo;t drifting. Nothing to fix.">
          <CostPulse />
        </Card>
        <Card icon="inventory_2" title="52 tubes left · 4-week runway" beat="Time to reorder.">
          <BirdSupply />
        </Card>
        <Card icon="groups" title="Anchors and drifters" beat="Know who to thank and who to nudge back.">
          <AttendanceRoster />
        </Card>
        <Card icon="science" title="Bird value — Victor Master wins" beat="Next reorder should lean this way.">
          <BirdValueScatter />
        </Card>
      </Arc>

      {/* ── ARC 3 ────────────────────────────────────────────────────── */}
      <Arc
        index={3}
        title="Anatomy of Thursday"
        intro="A post-session recap. Works on the Home tab the morning after, or as an archive view. Short and shareable."
        audience="Everyone who played"
        shipOrder="Second — closes the loop on the week that just happened"
      >
        <Card icon="event" title="The setting" beat="Where and when we gathered.">
          <SessionSetting />
        </Card>
        <Card icon="bolt" title="Demand signal" beat="How badly people wanted in.">
          <DemandSignal />
        </Card>
        <Card icon="receipt_long" title="The receipt" beat="What the night actually cost.">
          <SessionReceipt />
        </Card>
        <Card icon="groups" title="Who showed up" beat="The people you shared a court with.">
          <SessionRoster />
        </Card>
        <Card icon="verified" title="Payment loop" beat="Closing the week.">
          <PaymentLoopClose />
        </Card>
      </Arc>

      {/* ── RECOMMENDATION ─────────────────────────────────────────────── */}
      <section
        className="glass-card"
        style={{ padding: 20, display: 'grid', gap: 10, borderLeft: `3px solid ${ACCENT}` }}
      >
        <p style={{ margin: 0, fontSize: 12, color: ACCENT, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          Proposed ship order
        </p>
        <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, fontSize: 13, color: PRIMARY }}>
          <li>
            <strong>Arc 1 · Your season so far</strong> — the Stats tab turns into a personal recap. Biggest retention pull,
            every member benefits, no admin gate.
          </li>
          <li>
            <strong>Arc 3 · Anatomy of Thursday</strong> — add a compact post-session recap card to the Home tab once the session ends.
            Closes the loop on the week. Shareable in WhatsApp.
          </li>
          <li>
            <strong>Arc 2 · The club pulse</strong> — land on the Admin dashboard last. Real decisions, but highest-polish bar,
            and it&rsquo;s fine without it for now.
          </li>
        </ol>
        <p style={{ margin: 0, fontSize: 12, color: MUTED }}>
          Every card on this page is derivable from what we already collect. Skill progression stays &ldquo;Coming soon&rdquo; until we
          start writing <code className="bpm-mono" style={{ color: ACCENT }}>skillsHistory</code> rows — bank that data now,
          ship the card later.
        </p>
      </section>
    </main>
  );
}
