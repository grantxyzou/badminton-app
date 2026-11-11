/**
 * The length rules for a club name and a roster name, with no imports, so a
 * browser component can read them. They lived in `lib/groupRoutes.ts`, which
 * imports `next/server`, and `ClubNameEditor` importing two numbers from it put
 * ~70 KB of server code into the admin chunk (audit, 2026-11-05).
 */
export const GROUP_NAME_MIN = 2;
export const GROUP_NAME_MAX = 40;
export const ROSTER_NAME_MIN = 1;
export const ROSTER_NAME_MAX = 40;
