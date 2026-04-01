import { ImageResponse } from 'next/og';
import { getContainer, getActiveSessionId, POINTER_ID, DEFAULT_SESSION } from '@/lib/cosmos';

export const dynamic = 'force-dynamic';
export const alt = 'BPM Badminton';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OGImage() {
  let session = { ...DEFAULT_SESSION };
  let playerCount = 0;

  try {
    const sessionId = await getActiveSessionId();
    const container = getContainer('sessions');
    const { resources } = await container.items
      .query({
        query: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: sessionId }],
      })
      .fetchAll();
    const found = resources.find((r: { id: string }) => r.id !== POINTER_ID);
    if (found) session = found;

    const playersContainer = getContainer('players');
    const { resources: countRes } = await playersContainer.items
      .query({
        query:
          'SELECT VALUE COUNT(1) FROM c WHERE c.sessionId = @sid AND (NOT IS_DEFINED(c.removed) OR c.removed = false) AND (NOT IS_DEFINED(c.waitlisted) OR c.waitlisted = false)',
        parameters: [{ name: '@sid', value: sessionId }],
      })
      .fetchAll();
    playerCount = countRes[0] ?? 0;
  } catch {
    // fall back to defaults
  }

  const dateStr = session.datetime
    ? new Date(session.datetime).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
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
