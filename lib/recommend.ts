/**
 * Partner-frequency from co-attendance. For each session the viewer attended,
 * every OTHER attendee gets +1. Pure; case-insensitive on the viewer name;
 * preserves the first-seen display casing of each partner.
 */
export function topPartners(input: {
  me: string;
  sessions: { sessionId: string; names: string[] }[];
  limit?: number;
}): { name: string; count: number }[] {
  const meLower = input.me.trim().toLowerCase();
  const counts = new Map<string, { name: string; count: number }>();

  for (const session of input.sessions) {
    const attended = session.names.some((n) => n.trim().toLowerCase() === meLower);
    if (!attended) continue;
    for (const raw of session.names) {
      const lower = raw.trim().toLowerCase();
      if (lower === meLower) continue;
      const prior = counts.get(lower);
      if (prior) prior.count += 1;
      else counts.set(lower, { name: raw.trim(), count: 1 });
    }
  }

  const out = [...counts.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
  });
  return typeof input.limit === 'number' ? out.slice(0, input.limit) : out;
}
