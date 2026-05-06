/**
 * Deterministic avatar colors keyed by name's first character. Used by
 * RosterPage rows and ProfileTab's identity card so the same person shows
 * the same color across screens.
 */

const PALETTE: Array<readonly [string, string]> = [
  ['#1f3b5c', '#86b4e6'],
  ['#2c4a2c', '#9ee6a4'],
  ['#5c3a1f', '#f4c089'],
  ['#4a2a4a', '#e29ee2'],
  ['#1f4a4a', '#86d4d4'],
  ['#5c1f3b', '#f487a9'],
  ['#3a3a1f', '#e2e289'],
  ['#3b2c4a', '#b89ee2'],
];

export function avatarColors(name: string): { bg: string; fg: string } {
  const i = (name.charCodeAt(0) || 0) % PALETTE.length;
  const [bg, fg] = PALETTE[i];
  return { bg, fg };
}
