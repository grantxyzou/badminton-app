/** Delete the run's signed-in cookies (see global-setup.ts). */
import { rmSync } from 'node:fs';

export default function globalTeardown(): void {
  const dir = process.env.E2E_AUTH_DIR;
  if (dir) rmSync(dir, { recursive: true, force: true });
}
