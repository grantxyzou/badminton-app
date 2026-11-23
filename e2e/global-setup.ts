/**
 * One fresh folder per run for the personas' signed-in cookies, so each
 * persona signs in ONCE per run rather than once per spec. Every persona
 * signs in from the same address, and the per-address limits (sign-in, the
 * club list) were answering 429 by the third spec.
 *
 * The folder is in the system's temp space, never under `e2e-results/`:
 * that folder is uploaded as the run's artifact, and these files are live
 * sessions. `global-teardown.ts` deletes it.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default function globalSetup(): void {
  process.env.E2E_AUTH_DIR = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'bpm-e2e-auth-'));
}
