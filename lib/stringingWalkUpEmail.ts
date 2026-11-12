/**
 * The two automatic emails a WALK-UP gets (docs/plans/stringing-walk-ups.md,
 * Decisions, 2026-11-12; Grant on the canvas: "automatically email", and "yes"
 * to a second one when it is ready).
 *
 * A walk-up has no app, so nothing in `lib/stringingNotifyDispatch.ts` reaches
 * them — that dispatcher still returns `walk_up` before any read, and it stays
 * that way: no push, no Notifications-page record. What they get instead is
 * mail to the contact they gave at the counter, and only when that contact is
 * shaped like an email (`walkUpEmailOf`). A phone number gets nothing sent; the
 * stringer shares the receipt image from the job page.
 *
 *   spec   — once, from `POST /api/stringing/jobs`, after the job is created.
 *   ready  — from `PATCH /api/stringing/jobs/[id]`, when the status first
 *            moves FORWARD to `ready` and no ready email has gone yet.
 *
 * SAME TRANSPORT AND SENDER AS THE MEMBER'S STRINGING EMAIL
 * (`lib/stringingNotifyEmail.ts`): `gmailTransport` with its timeouts, From the
 * product's name on the one mailbox, nothing sent when SMTP is not configured.
 * Kept as its own `send` rather than borrowing that module's, for the reason
 * that module gives: a shared private sender is how a subject line ends up on
 * the wrong template.
 *
 * NEVER THROWS. Every send runs AFTER the job's own write, and a dead mail
 * server must not turn saving a racket into a 503. The outcome is stamped on
 * the job (`walkUpEmails.spec` / `.ready`, `{ at, ok }`) so the job page can
 * say "Sent 3:04 PM", and so neither a "Send again" nor a second move to ready
 * repeats an email that went.
 *
 * MONEY IS ALLOWED HERE. An email is not a lock-screen banner: the member's
 * stringing email already quotes the figure, and so does this one. Only a PUSH
 * body carries no money, and nothing here pushes.
 *
 * ENGLISH, like the member's stringing email: the request that triggers it is
 * the stringer's, and a walk-up has no stored language at all.
 */
import { gmailTransport } from './mailTransport';
import { APP_NAME } from './brand';
import { fmtMoney } from './fmt';
import { formatReadyBy } from './stringingDue';
import { walkUpEmailOf } from './stringing';
import { readGroup } from './groups';
import type { GroupScope } from './groupScope';
import type { StringingJob, WalkUpEmailStamp } from './types';

export type WalkUpEmailKind = 'spec' | 'ready';

/** The box both emails carry: what the stringer wrote down at the counter. */
export function walkUpEmailRows(job: StringingJob): [string, string][] {
  const priced = typeof job.priceCents === 'number';
  const price = !priced
    ? 'Ask'
    : job.paidAt
      ? `${fmtMoney(job.priceCents! / 100)}, paid`
      : `${fmtMoney(job.priceCents! / 100)}, pay at pickup`;
  const rows: [string, string][] = [
    ['Job', job.jobNo],
    ['Racket', job.racketLabel],
    ['String', job.stringColor ? `${job.stringLabel} · ${job.stringColor}` : job.stringLabel],
    ['Tension', `${job.tensionMains} / ${job.tensionCrosses} lb`],
    ['Price', price],
  ];
  if (job.readyBy) rows.push(['Ready by', formatReadyBy(job.readyBy, 'en-US') ?? job.readyBy]);
  return rows;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Subject, plain text and HTML for one of the two emails. Pure. Every value
 * that came from a person (the name, the racket, the club) is escaped in the
 * HTML half; the text half is plain text and needs nothing.
 */
export function composeWalkUpEmail(
  kind: WalkUpEmailKind,
  job: StringingJob,
  clubName: string = APP_NAME,
): { subject: string; text: string; html: string } {
  const rows = walkUpEmailRows(job);
  const width = Math.max(...rows.map(([k]) => k.length));
  const box = rows.map(([k, v]) => `  ${k.padEnd(width)}   ${v}`).join('\n');
  const owes = typeof job.priceCents === 'number' && !job.paidAt;

  let subject: string;
  let lead: string;
  let after: string[];
  let footer: string;
  if (kind === 'spec') {
    subject = `Your racket is with ${clubName}'s stringer (${job.jobNo})`;
    lead = `${clubName}'s stringer has your racket. Here is what you asked for:`;
    after = ["We'll email you again when it's ready. If anything looks wrong, tell your stringer."];
    footer =
      "You got this email because you gave this address when you dropped off a racket. You'll get one more email when it's ready.";
  } else {
    subject = `Your racket is ready (${job.jobNo})`;
    lead = `Your racket is strung and ready to pick up at the next ${clubName} session.`;
    after = owes ? [`Bring ${fmtMoney(job.priceCents! / 100)} or pay your stringer at pickup.`] : [];
    footer = 'This is the last email about this racket.';
  }

  const text = [`Hi ${job.memberName},`, '', lead, '', box, '', ...after.flatMap((p) => [p, '']), '—', footer].join('\n');

  const e = escapeHtml;
  const tableRows = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 16px 4px 0;color:#6b7280">${e(k)}</td><td style="padding:4px 0;font-weight:600">${e(v)}</td></tr>`,
    )
    .join('');
  const html =
    `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#111827;max-width:480px">` +
    `<p>Hi ${e(job.memberName)},</p>` +
    `<p>${e(lead)}</p>` +
    `<table style="border-collapse:collapse;background:#f3f4f6;border-radius:12px;padding:12px 16px;display:block;margin:12px 0">${tableRows}</table>` +
    after.map((p) => `<p>${e(p)}</p>`).join('') +
    `<p style="font-size:12px;color:#6b7280;margin-top:24px">${e(footer)}</p>` +
    `</div>`;

  return { subject, text, html };
}

/**
 * Send one email. `false` for every non-send — no SMTP configured (local dev,
 * tests), or a transport error — because the caller records the outcome and
 * must never fail because of it.
 */
export async function sendWalkUpEmail(kind: WalkUpEmailKind, job: StringingJob, clubName?: string): Promise<boolean> {
  const to = walkUpEmailOf(job);
  if (!to) return false;
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return false;
  try {
    const copy = composeWalkUpEmail(kind, job, clubName ?? APP_NAME);
    const transport = await gmailTransport(user, pass);
    await transport.sendMail({ from: `${APP_NAME} <${user}>`, to, subject: copy.subject, text: copy.text, html: copy.html });
    return true;
  } catch (err) {
    console.error(`[stringing] walk-up ${kind} email failed (the job is saved):`, err);
    return false;
  }
}

/** The club's name for the copy; the product's when it cannot be read. */
async function clubNameOf(groupId: string): Promise<string> {
  try {
    return (await readGroup(groupId))?.name?.trim() || APP_NAME;
  } catch {
    return APP_NAME;
  }
}

/**
 * Send `kind` to the walk-up and stamp the outcome on the job. Returns the
 * stamp (also when the stamp could not be WRITTEN — the caller still answers
 * with what happened), or null when this job gets no email at all.
 *
 * The stamp is a read-modify-`replace`, retried once on "changed under you"
 * against a fresh read, so a bench tap landing between the send and the stamp
 * is kept rather than overwritten.
 */
export async function emailWalkUp(
  scope: GroupScope,
  job: StringingJob,
  kind: WalkUpEmailKind,
): Promise<WalkUpEmailStamp | null> {
  if (!walkUpEmailOf(job)) return null;
  let ok = false;
  try {
    ok = await sendWalkUpEmail(kind, job, await clubNameOf(scope.groupId));
  } catch {
    ok = false;
  }
  const stamp: WalkUpEmailStamp = { at: new Date().toISOString(), ok };
  try {
    let current: StringingJob | undefined = job;
    for (let attempt = 0; attempt < 2 && current; attempt++) {
      const written = await scope.replace<StringingJob>(
        'stringingJobs',
        { ...current, walkUpEmails: { ...current.walkUpEmails, [kind]: stamp } },
        job.memberId,
      );
      if (written) return stamp;
      current = await scope.read<StringingJob>('stringingJobs', job.id, job.memberId);
    }
    console.error(`[stringing] walk-up ${kind} email stamp not written for ${job.id}`);
  } catch (err) {
    console.error(`[stringing] walk-up ${kind} email stamp failed for ${job.id}:`, err);
  }
  return stamp;
}
