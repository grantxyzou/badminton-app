/**
 * An Interac e-Transfer notification email → who sent how much, and whether
 * the email can be believed.
 *
 * The admin's Apps Script (`public/payments/apps-script.gs`) forwards the raw
 * subject, plain-text body, From header and Gmail's `Authentication-Results`.
 * Parsing lives HERE, not in the script, so a change in Interac's wording is
 * fixed by a deploy instead of by asking every club's admin to re-paste code.
 *
 * TWO FORMATS, TWO LANGUAGES. Without Autodeposit the email says "JOHN SMITH
 * sent you money" with a deposit link; with it, "...sent you $12.00 (CAD) and
 * the money has been automatically deposited". Both arrive in English or
 * French depending on the recipient's bank profile. The patterns below are
 * deliberately loose — and anything they cannot read comes back
 * `unrecognized`, which the inbox shows a person rather than dropping. A
 * parser that silently skips mail is the lying-empty-state rule in another
 * costume.
 *
 * REMINDERS ARE NOT PAYMENTS. Interac re-sends "Reminder: X sent you money"
 * for a transfer nobody has accepted yet. It is the SAME money under a new
 * message id, so reading it as a payment would mark a second session paid.
 */

export interface RawInteracEmail {
  messageId: string;
  /** The From header as Gmail reports it: `"Interac e-Transfer" <notify@payments.interac.ca>`. */
  from: string;
  subject: string;
  /** Plain-text body (`GmailMessage.getPlainBody()`). */
  body: string;
  /** ISO timestamp the message was received. */
  date: string;
  /** The TOPMOST `Authentication-Results` header, verbatim. Absent = unauthenticated. */
  authResults?: string;
}

export interface ParsedEtransfer {
  kind: 'received' | 'unrecognized';
  senderName: string | null;
  amountCents: number | null;
  memo: string | null;
  /** True only when Google verified the message really came from Interac. */
  authenticated: boolean;
}

const INTERAC_DOMAIN = /(^|\.)interac\.ca$/i;

/** The domain of the address inside a From header, lowercased; '' if none. */
function fromDomain(from: string): string {
  const m = /@([a-z0-9.-]+)>?\s*$/i.exec(from.trim());
  return m ? m[1].toLowerCase() : '';
}

/**
 * Did Google verify this message as Interac's?
 *
 * WHY THE TOPMOST HEADER ONLY. A sender can put any `Authentication-Results`
 * they like into their own message; Gmail does not strip them, it adds its own
 * ABOVE them. The script therefore forwards the first one, and this function
 * additionally refuses any header not stamped by `mx.google.com`, so a forged
 * one forwarded by mistake still fails.
 *
 * WHY DKIM *AND* THE FROM DOMAIN. `dkim=pass` proves some domain signed the
 * message, not that it is the domain in From. Requiring both to be Interac's
 * is the alignment DMARC would check, without depending on how Google happens
 * to word its DMARC clause.
 */
export function isInteracAuthenticated(authResults: string | undefined, from: string): boolean {
  if (!authResults) return false;
  const text = authResults.replace(/\s+/g, ' ').trim();
  if (!/^mx\.google\.com\s*;/i.test(text)) return false;
  if (!INTERAC_DOMAIN.test(fromDomain(from))) return false;
  for (const clause of text.split(';')) {
    const c = clause.trim();
    if (!/^dkim=pass\b/i.test(c)) continue;
    const d = /header\.(?:d|i)=@?([a-z0-9.-]+)/i.exec(c);
    if (d && INTERAC_DOMAIN.test(d[1])) return true;
  }
  return false;
}

/** `$1,234.56` / `$12.00 (CAD)` / `12,00 $` → cents. */
export function parseAmountCents(text: string): number | null {
  const en = /\$\s?(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})\b/.exec(text);
  if (en) return Number(en[1].replace(/,/g, '')) * 100 + Number(en[2]);
  const fr = /\b(\d{1,3}(?:[\s  ]\d{3})*|\d+),(\d{2})\s?\$/.exec(text);
  if (fr) return Number(fr[1].replace(/[\s  ]/g, '')) * 100 + Number(fr[2]);
  return null;
}

const SENDER_PATTERNS: RegExp[] = [
  // Subject, EN: "INTERAC e-Transfer: JOHN SMITH sent you money."
  /e-?transfer\s*:?\s*(.+?)\s+(?:has\s+)?sent you\b/i,
  // Subject, EN autodeposit: "...You've received $12.00 from JOHN SMITH and it has been automatically deposited."
  /received\s+\$[\d,.]+\s*(?:\(CAD\))?\s+from\s+(.+?)(?:\s+and\b|\.\s|\.$|$)/im,
  // Subject, FR: "Virement INTERAC : JOHN SMITH vous a envoyé de l'argent."
  /virement\s+interac\s*:?\s*(.+?)\s+vous a envoy/i,
  // Body, EN: "Hi GRANT, JOHN SMITH has sent you $12.00 (CAD)" — the name follows a greeting's comma or a line start.
  /(?:^|,)\s*([^,\n]+?)\s+(?:has\s+)?sent you\b/im,
  // Body, FR: "Bonjour GRANT, JOHN SMITH vous a envoyé 12,00 $"
  /(?:^|,)\s*([^,\n]+?)\s+vous a envoy/im,
];

const INCOMING = /sent you|you(?:'ve| have) received|vous a envoy|avez re[çc]u/i;
const NOT_A_PAYMENT = /^\s*(?:re:|fwd?:)?\s*(?:reminder|rappel)\b|\b(?:cancel+ed|expired|declined|annul[ée]|expir[ée]|refus[ée])\b/i;

function cleanName(raw: string): string | null {
  const name = raw
    .replace(/^(?:hi|hello|bonjour|dear)\b[^,]*,\s*/i, '')
    .replace(/[\s.:!]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  // A "name" made of the words around it means the pattern matched the wrong line.
  if (!name || /\b(?:interac|e-?transfer|virement|money|argent)\b/i.test(name)) return null;
  return name;
}

function findSender(subject: string, body: string): string | null {
  for (const text of [subject, body]) {
    for (const re of SENDER_PATTERNS) {
      const m = re.exec(text);
      if (m) {
        const name = cleanName(m[1]);
        if (name) return name;
      }
    }
  }
  return null;
}

function findMemo(body: string): string | null {
  const m = /^\s*(?:message|memo|note)\s*:\s*(.+)$/im.exec(body);
  const memo = m?.[1].trim().slice(0, 200);
  return memo ? memo : null;
}

export function parseInteracEmail(email: RawInteracEmail): ParsedEtransfer {
  const subject = email.subject ?? '';
  const body = email.body ?? '';
  const authenticated = isInteracAuthenticated(email.authResults, email.from ?? '');
  const unrecognized: ParsedEtransfer = {
    kind: 'unrecognized',
    senderName: null,
    amountCents: null,
    memo: null,
    authenticated,
  };

  if (NOT_A_PAYMENT.test(subject)) return unrecognized;
  if (!INCOMING.test(`${subject}\n${body}`)) return unrecognized;

  const senderName = findSender(subject, body);
  const amountCents = parseAmountCents(subject) ?? parseAmountCents(body);
  if (!senderName || amountCents === null || amountCents <= 0) {
    return { ...unrecognized, senderName, amountCents };
  }
  return { kind: 'received', senderName, amountCents, memo: findMemo(body), authenticated };
}
