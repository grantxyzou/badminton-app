import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sendVerificationEmail, sendPasswordResetEmail } from '../lib/authEmail';

/**
 * These tests run with the SMTP env vars UNSET and assert the env-gate holds.
 * The suite must never attempt a real send: `lib/reportEmail.ts` established
 * that contract (a report must not depend on SMTP being configured) and the
 * auth mails follow it, so a developer without Gmail credentials can still run
 * the whole flow locally.
 */
const saved = {
  user: process.env.GMAIL_USER,
  pass: process.env.GMAIL_APP_PASSWORD,
};

beforeEach(() => {
  delete process.env.GMAIL_USER;
  delete process.env.GMAIL_APP_PASSWORD;
});

afterEach(() => {
  if (saved.user === undefined) delete process.env.GMAIL_USER;
  else process.env.GMAIL_USER = saved.user;
  if (saved.pass === undefined) delete process.env.GMAIL_APP_PASSWORD;
  else process.env.GMAIL_APP_PASSWORD = saved.pass;
});

describe('authEmail', () => {
  it('reports not-sent instead of throwing when SMTP is unconfigured', async () => {
    await expect(
      sendVerificationEmail('lin@example.com', 'Lin', 'https://example.test/verify'),
    ).resolves.toEqual({ sent: false });
  });

  it('does the same for the reset mail', async () => {
    await expect(
      sendPasswordResetEmail('lin@example.com', 'Lin', 'https://example.test/reset'),
    ).resolves.toEqual({ sent: false });
  });

  it('stays not-sent when only one half of the credential pair is present', async () => {
    process.env.GMAIL_USER = 'someone@gmail.com';
    await expect(
      sendVerificationEmail('lin@example.com', 'Lin', 'https://example.test/verify'),
    ).resolves.toEqual({ sent: false });
  });
});
