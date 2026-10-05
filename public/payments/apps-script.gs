/**
 * BPM — forward Interac e-Transfer emails to the app (docs/plans/payments.md).
 *
 * SETUP (once, about two minutes):
 *   1. In the app: Admin → Payments → "Auto-detect e-transfers" → Create key. Copy it.
 *   2. Go to https://script.google.com while signed in to the Gmail that receives
 *      your e-transfers → New project → paste this whole file over the sample.
 *   3. Project Settings (gear) → Script properties → add:
 *        BPM_KEY = the key from step 1
 *        BPM_URL = https://bpm.grantzou.com/bpm/api/payments/etransfer
 *   4. Back in the editor, choose `install` in the function menu → Run. Google asks
 *      for permission to read your Gmail and connect to an external service; this
 *      script is the only thing that gets it, and it only sends Interac emails.
 *
 * It then runs every 5 minutes. Once a day (about 10am) it also asks the app to
 * send payment reminders — that does nothing unless reminders are switched on
 * in the app. It looks only at mail from Interac's address in
 * the last 3 days, and sends each message once. The app decides what each one
 * is and whether it can be trusted — including whether Google verified it was
 * really sent by Interac — so nothing here needs updating when Interac changes
 * its wording.
 *
 * To stop: run `uninstall`, or delete the key in the app (every send then fails).
 */

const SEARCH = 'from:notify@payments.interac.ca newer_than:3d';
const SEEN_KEY = 'seenMessageIds';
const SEEN_MAX = 300;

const HANDLERS = ['forwardInteracEmails', 'sendPaymentReminders'];

function install() {
  uninstall();
  ScriptApp.newTrigger('forwardInteracEmails').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('sendPaymentReminders').timeBased().everyDays(1).atHour(10).create();
  forwardInteracEmails();
}

function uninstall() {
  ScriptApp.getProjectTriggers()
    .filter((t) => HANDLERS.indexOf(t.getHandlerFunction()) !== -1)
    .forEach((t) => ScriptApp.deleteTrigger(t));
}

/** Daily: ask the app to send any payment reminders that are due. */
function sendPaymentReminders() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('BPM_URL');
  const key = props.getProperty('BPM_KEY');
  if (!url || !key) throw new Error('Set BPM_URL and BPM_KEY in Project Settings → Script properties.');
  const res = UrlFetchApp.fetch(url.replace(/\/etransfer\/?$/, '/remind'), {
    method: 'post',
    headers: { 'x-payments-key': key },
    muteHttpExceptions: true,
  });
  console.log('BPM reminders: ' + res.getResponseCode() + ' ' + res.getContentText());
}

function forwardInteracEmails() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('BPM_URL');
  const key = props.getProperty('BPM_KEY');
  if (!url || !key) throw new Error('Set BPM_URL and BPM_KEY in Project Settings → Script properties.');

  // Per MESSAGE, not per thread: Gmail threads by subject, and Interac reuses
  // "X sent you money" every week, so next week's payment lands in an old thread.
  const seen = JSON.parse(props.getProperty(SEEN_KEY) || '[]');
  const seenSet = new Set(seen);

  for (const thread of GmailApp.search(SEARCH, 0, 50)) {
    for (const m of thread.getMessages()) {
      const id = m.getId();
      if (seenSet.has(id)) continue;
      if (!/payments\.interac\.ca/i.test(m.getFrom())) continue;

      const raw = m.getRawContent();
      const res = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-payments-key': key },
        muteHttpExceptions: true,
        payload: JSON.stringify({
          messageId: m.getHeader('Message-ID') || id,
          from: m.getFrom(),
          subject: m.getSubject(),
          body: m.getPlainBody(),
          date: m.getDate().toISOString(),
          authResults: firstHeader(raw, 'Authentication-Results'),
        }),
      });
      const code = res.getResponseCode();
      if (code === 401 || code === 404) {
        // Wrong/rotated key, or the feature is off. Stop; retrying changes nothing.
        console.error('BPM refused the key (' + code + '). Create a new key in the app.');
        return save(props, seen);
      }
      if (code >= 200 && code < 300) {
        seen.push(id);
        seenSet.add(id);
      } else {
        // 429 / 5xx: leave it unseen so the next run retries it.
        console.warn('BPM answered ' + code + ' for a message; will retry.');
      }
    }
  }
  save(props, seen);
}

function save(props, seen) {
  props.setProperty(SEEN_KEY, JSON.stringify(seen.slice(-SEEN_MAX)));
}

/**
 * The FIRST occurrence of a header in the raw message. Gmail adds its own
 * Authentication-Results at the TOP; any copy further down was written by the
 * sender and proves nothing, which is why only the first is sent.
 */
function firstHeader(raw, name) {
  const head = raw.split(/\r?\n\r?\n/)[0].replace(/\r?\n[ \t]+/g, ' ');
  const prefix = name.toLowerCase() + ':';
  for (const line of head.split(/\r?\n/)) {
    if (line.toLowerCase().startsWith(prefix)) return line.slice(prefix.length).trim();
  }
  return undefined;
}
