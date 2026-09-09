import { ImageResponse } from 'next/og';
import { getActiveSessionId, DEFAULT_SESSION } from '@/lib/cosmos';
import { BPM_GROUP_ID, groupScope } from '@/lib/groupScope';
import { ACTIVE_PLAYERS_WHERE } from '@/lib/capacity';

export const dynamic = 'force-dynamic';
export const alt = 'BPM Badminton';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OGImage() {
  let session = { ...DEFAULT_SESSION };
  let playerCount = 0;

  try {
    // The share card for the app's one public URL, which is BPM's. A
    // per-group card needs a per-group URL and is a later phase.
    const scope = groupScope(BPM_GROUP_ID);
    const sessionId = await getActiveSessionId(scope.groupId);
    if (!sessionId) throw new Error('no active session');
    const found = await scope.read<typeof DEFAULT_SESSION>('sessions', sessionId, sessionId);
    if (found) session = found;

    playerCount = await scope.count('players', ACTIVE_PLAYERS_WHERE, [{ name: '@sessionId', value: sessionId }]);
  } catch {
    // fall back to defaults
  }

  const dateStr = session.datetime
    ? new Date(session.datetime.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
      })
    : 'TBD';

  const spotsLeft = Math.max(0, (session.maxPlayers || 12) - playerCount);
  const locationName = session.locationName || '';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          background: 'linear-gradient(135deg, #0a1a0f 0%, #0f2918 40%, #0a1a0f 100%)',
          fontFamily: 'system-ui, sans-serif',
          color: 'white',
          padding: '60px',
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: '0.2em',
            color: '#4ade80',
            marginBottom: 16,
          }}
        >
          BPM BADMINTON
        </div>

        <div
          style={{
            display: 'flex',
            fontSize: 52,
            fontWeight: 700,
            marginBottom: 12,
            textAlign: 'center',
          }}
        >
          {session.title || 'Weekly Session'}
        </div>

        <div
          style={{
            display: 'flex',
            fontSize: 32,
            color: 'rgba(255,255,255,0.7)',
            marginBottom: 40,
          }}
        >
          {dateStr}
        </div>

        <div
          style={{
            display: 'flex',
            gap: 60,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <div style={{ display: 'flex', fontSize: 56, fontWeight: 700, color: '#4ade80' }}>
              {playerCount}/{session.maxPlayers || 12}
            </div>
            <div
              style={{
                display: 'flex',
                fontSize: 20,
                color: 'rgba(255,255,255,0.5)',
                letterSpacing: '0.1em',
              }}
            >
              SIGNED UP
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                display: 'flex',
                fontSize: 56,
                fontWeight: 700,
                color: spotsLeft > 0 ? '#4ade80' : '#f59e0b',
              }}
            >
              {spotsLeft}
            </div>
            <div
              style={{
                display: 'flex',
                fontSize: 20,
                color: 'rgba(255,255,255,0.5)',
                letterSpacing: '0.1em',
              }}
            >
              {spotsLeft === 0 ? 'FULL' : 'SPOTS LEFT'}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <div style={{ display: 'flex', fontSize: 56, fontWeight: 700, color: '#4ade80' }}>
              {session.courts || 2}
            </div>
            <div
              style={{
                display: 'flex',
                fontSize: 20,
                color: 'rgba(255,255,255,0.5)',
                letterSpacing: '0.1em',
              }}
            >
              COURTS
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            fontSize: 22,
            color: locationName ? 'rgba(255,255,255,0.4)' : 'transparent',
            marginTop: 40,
          }}
        >
          {locationName || ' '}
        </div>
      </div>
    ),
    { ...size },
  );
}
