/**
 * Stringing list limits, in a module with NO imports.
 *
 * The admin card that edits the offered-strings list is a client component and
 * needs `MAX_OFFERED`. It used to import it from `lib/stringingStrings.ts`,
 * which reaches `groupScope` → `cosmos` → Node `crypto` and so dragged
 * `crypto-browserify` into every visitor's bundle. Keep this file import-free;
 * `__tests__/client-server-import-canary.test.ts` holds the line.
 */
export const MAX_OFFERED = 24;
export const MAX_LABEL_LEN = 60;
