/**
 * Is this string safe to hand to the push sender as a destination?
 *
 * A Web Push endpoint is an arbitrary URL supplied by the CLIENT and stored
 * verbatim, and the server later issues an HTTPS POST to it from inside the App
 * Service's network position. The only check it used to get was `protocol ===
 * 'https:'`, under a comment claiming that "keeps the send path from being
 * pointed at an arbitrary internal host". It does not: `https://10.0.0.5/probe`
 * satisfies it exactly.
 *
 * That made the sender a blind SSRF with a readable side channel. The response
 * body never comes back, but `lib/push.ts` DELETES a subscription on 404/410
 * and keeps it on anything else, and re-posting the same endpoint to the
 * subscribe route answers `refreshed: true` if the doc survived versus 201 if
 * it had to be recreated. One bit per send, repeatable, across any host and
 * path the attacker names -- enough to map which internal services answer and
 * with what status class. The bar is an ordinary account, since anonymous
 * sign-up mints a `member_session`.
 *
 * WHAT THIS REJECTS, and why it is shaped as a denylist of destinations rather
 * than an allowlist of push services.
 *
 * An allowlist of known push origins (FCM, Mozilla, WNS, Apple) is the stronger
 * control and is the right eventual fix. It is not this change: those hostnames
 * move, a browser we have not seen yet uses one we have not listed, and
 * `lib/push.ts` never throws -- so an endpoint wrongly excluded does not fail
 * loudly, it just silently stops delivering to a real member's real device.
 * Getting that list wrong is invisible in exactly the way this codebase keeps
 * being bitten by. Establishing it wants the set of endpoints actually in the
 * `pushSubscriptions` container, which is a production read, not a guess.
 *
 * So this closes the attack rather than defining the legitimate set:
 *
 *   - **Any IP-literal host is refused.** No real push service is addressed by
 *     a bare address, and this alone removes the whole "point it at
 *     10.0.0.5 / 169.254.169.254 / [::1]" family the finding describes,
 *     without needing to know which ranges the deployment considers internal.
 *   - **Loopback and internal-looking names are refused** -- `localhost`, and
 *     the `.local` / `.internal` / `.localdomain` suffixes that resolve inside
 *     a private network.
 *   - **Non-https is refused**, as before.
 *   - Credentials in the URL (`https://user:pass@host`) are refused: nothing
 *     legitimate carries them and they are a classic parser-confusion lever.
 *
 * RESIDUAL, stated plainly: a hostname under the attacker's control that
 * RESOLVES to a private address still passes, because the name is checked and
 * the address is only known at connect time, which `web-push` does not expose.
 * Closing that needs either the allowlist above or a resolving agent. This
 * raises the cost from "type an IP" to "run authoritative DNS", and it is the
 * half that carries no risk of silently dropping real devices.
 */

/** Hosts that are never a push service, by name. */
const BLOCKED_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback']);

/** Suffixes that resolve inside a private network. */
const BLOCKED_SUFFIXES = ['.local', '.internal', '.localdomain', '.home.arpa'];

/**
 * True when `host` is a bare IP address rather than a name.
 *
 * `new URL()` gives IPv6 hosts wrapped in brackets, which is the reliable tell;
 * IPv4 is four dotted decimal groups. Both forms are refused outright, so there
 * is no need to enumerate private ranges here -- a PUBLIC address literal is
 * just as illegitimate for a push service and just as good an SSRF probe.
 */
function isIpLiteral(host: string): boolean {
  if (host.startsWith('[') && host.endsWith(']')) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  // A bare hexadecimal or decimal host (`https://2130706433/`) is another way
  // to write an address; no hostname is all digits.
  if (/^\d+$/.test(host)) return true;
  return false;
}

/** Longest endpoint we will store. Real ones are well under this. */
export const MAX_PUSH_ENDPOINT_LEN = 1000;

export function isSafePushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string') return false;
  const trimmed = endpoint.trim();
  if (!trimmed || trimmed.length > MAX_PUSH_ENDPOINT_LEN) return false;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;

  const host = url.hostname.toLowerCase();
  if (!host) return false;
  if (isIpLiteral(host)) return false;
  if (BLOCKED_HOSTNAMES.has(host)) return false;
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return false;

  return true;
}
