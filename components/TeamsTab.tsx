'use client';

import { useState } from 'react';

interface CourtAssignment {
  court: number;
  teamA: string[];
  teamB: string[];
}

function TeamCard({
  label,
  players,
  accent,
}: {
  label: string;
  players: string[];
  accent: { bg: string; border: string; text: string };
}) {
  return (
    <div
      className="rounded-lg p-3 space-y-1.5"
      style={{ background: accent.bg, border: `1px solid ${accent.border}` }}
    >
      <p className="text-xs font-bold" style={{ color: accent.text }}>
        {label}
      </p>
      {players.map((name, i) => (
        <p key={i} className="text-sm text-gray-200 font-medium">
          {name}
        </p>
      ))}
    </div>
  );
}

export default function TeamsTab() {
  const [loading, setLoading] = useState(false);
  const [courts, setCourts] = useState<CourtAssignment[]>([]);
  const [error, setError] = useState('');

  async function generateTeams() {
    setLoading(true);
    setError('');
    setCourts([]);

    try {
      const [pRes, sRes] = await Promise.all([
        fetch('/api/players'),
        fetch('/api/session'),
      ]);

      const players = await pRes.json();
      const session = await sRes.json();

      if (!Array.isArray(players) || players.length === 0) {
        setError('No players signed up yet.');
        setLoading(false);
        return;
      }

      const playerList = players
        .map((p: { name: string; skill: string }) => `- ${p.name} (${p.skill})`)
        .join('\n');

      const numCourts: number = session?.courts ?? 2;

      const prompt = `You are organising balanced badminton doubles matches for ${numCourts} court${numCourts !== 1 ? 's' : ''}.

Players:
${playerList}

Rules:
- Each court needs exactly 4 players: Team A (2 players) vs Team B (2 players).
- Distribute skill levels evenly — pair stronger and weaker players together where possible.
- If there are fewer players than courts need, use as many courts as possible with exactly 4 players each.
- Leave out any remaining players if the total is not a multiple of 4.

Respond with ONLY valid JSON, no markdown, no extra text:
{
  "courts": [
    {
      "court": 1,
      "teamA": ["Player Name 1", "Player Name 2"],
      "teamB": ["Player Name 3", "Player Name 4"]
    }
  ]
}`;

      const claudeRes = await fetch('/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });

      const { text, error: claudeError } = await claudeRes.json();

      if (claudeError) {
        setError(claudeError);
        return;
      }

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          setCourts(parsed.courts ?? []);
        } catch {
          setError('Could not parse AI response. Please try again.');
        }
      } else {
        setError('Unexpected AI response format. Please try again.');
      }
    } catch (e) {
      console.error(e);
      setError('Failed to generate teams. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const greenAccent = {
    bg: 'rgba(74, 222, 128, 0.08)',
    border: 'rgba(74, 222, 128, 0.2)',
    text: '#4ade80',
  };
  const blueAccent = {
    bg: 'rgba(96, 165, 250, 0.08)',
    border: 'rgba(96, 165, 250, 0.2)',
    text: '#60a5fa',
  };

  return (
    <div className="space-y-4">
      {/* Header card */}
      <div className="glass-card p-5">
        <div className="flex items-center gap-2 mb-1">
          <span className="material-icons text-green-400" style={{ fontSize: 20 }}>
            auto_awesome
          </span>
          <h2 className="font-semibold text-green-400">Smart Matchmaking</h2>
        </div>
        <p className="text-sm text-gray-400 mb-4">
          Claude AI balances skill levels to create fair doubles matches.
        </p>
        <button
          onClick={generateTeams}
          disabled={loading}
          className="btn-primary w-full"
        >
          {loading ? (
            <>
              <span className="material-icons animate-spin" style={{ fontSize: 18 }}>
                refresh
              </span>
              Generating…
            </>
          ) : (
            <>
              <span className="material-icons" style={{ fontSize: 18 }}>
                shuffle
              </span>
              Generate Teams
            </>
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div
          className="glass-card p-4"
          style={{ borderColor: 'rgba(239, 68, 68, 0.3)' }}
        >
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Court cards */}
      {courts.map((court) => (
        <div key={court.court} className="glass-card overflow-hidden">
          <div
            className="px-4 py-2 text-xs font-bold tracking-widest"
            style={{
              background: 'rgba(74, 222, 128, 0.06)',
              color: 'rgba(74, 222, 128, 0.65)',
              borderBottom: '1px solid rgba(74, 222, 128, 0.1)',
            }}
          >
            COURT {court.court}
          </div>
          <div className="p-4 grid grid-cols-2 gap-3">
            <TeamCard label="Team A" players={court.teamA} accent={greenAccent} />
            <TeamCard label="Team B" players={court.teamB} accent={blueAccent} />
          </div>
        </div>
      ))}
    </div>
  );
}
