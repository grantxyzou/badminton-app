/**
 * THE PRODUCT'S NAME, IN ONE PLACE.
 *
 * Multi-group makes "BPM Badminton" two different things that used to be one.
 * It is the name of a CLUB — group #1, Grant's Thursday night in Vancouver —
 * and it was also the name of the APP, because for a year those were the same
 * object. They stop being the same the moment a second club exists: a stranger
 * who joins their own club must not see someone else's club name on the splash
 * screen, in the manifest, or at the bottom of a password-reset email.
 *
 * So every string that names the PRODUCT resolves from here, and every string
 * that names a CLUB resolves from that club's `Group.name`. Deciding which of
 * the two a given string is, is the whole of this module's usefulness; see the
 * note on `APP_NAME` for how to tell them apart.
 *
 * `docs/plans/multi-group.md` records the decision: "A new product name; BPM is
 * a group inside it (2026-09-07) ... Name is Grant's, set in one constant."
 * This is that constant. Grant chose on 2026-10-22: the APP is "BPM", short for
 * Badminton Per Management, and his club — group #1 — is "BPM Core". The two
 * share three letters on purpose, so the expansion is what tells a reader the
 * app is the software and the club is the people; it lives in prose (the
 * legal pages, the store listing) rather than in a second constant nothing
 * renders.
 *
 * WHAT DOES NOT FOLLOW THIS CONSTANT, deliberately:
 *
 *   - The bundle id `com.motioncraft.bpm`, the `/bpm` basePath, the `bpm://`
 *     custom scheme and the `.bpm-*` CSS classes. Infrastructure, not brand —
 *     and the first Play upload fixed the package name for good.
 *   - `lib/cosmos.ts`'s dev seed and `lib/groupBackfill.ts`'s group creation,
 *     which write `name: 'BPM Core'` as the CLUB's own name for group #1.
 *     Renaming the product must never silently rename Grant's club; the live
 *     club is renamed from Admin → Club name, which writes `Group.name`.
 *   - The gift-code prefix `BPM-`, the `'BPM'` racket colourway and the two
 *     `/design` preview pages: a code format in issued cards, a paint named
 *     after the club, and specimens of the mark itself.
 */

/**
 * The product's full name, as it appears where there is room for it: the
 * document title, the manifest, the OG card, the splash screen, an email
 * signature.
 *
 * HOW TO TELL AN APP STRING FROM A CLUB STRING. Ask who the sentence is about.
 * "Add X to your home screen" is about the software, so it is the app. "You
 * owe X $12" and the memo line on an e-transfer are about the people you play
 * with, so they are the club, and they come from `Group.name`. When a string
 * could plausibly be either, prefer the club: a member has a relationship with
 * their club and merely uses the app.
 */
export const APP_NAME = 'BPM';

/**
 * The short form, for places where the full name would wrap or crowd: the
 * manifest's `short_name` (Android truncates a long one under the icon),
 * running UI copy, and push notification titles, which are clipped hard by
 * both platforms.
 *
 * Kept separate rather than derived by taking the first word, because that
 * only works for names shaped like this one. The same string as `APP_NAME`
 * since the name became one word; the two roles stay distinct so a longer
 * name later lands in the right places.
 */
export const APP_SHORT_NAME = 'BPM';

/**
 * The sentinels the message files carry in place of the name.
 *
 * WHY NOT next-intl's OWN `{appName}` PLACEHOLDER: ICU arguments are resolved
 * at the CALL SITE, so every `t('install.title')` in the app would have to
 * start passing `{ appName }`, and the one that forgot would render the raw
 * `{appName}` to a user — silently, because next-intl does not throw on a
 * missing argument any more than it throws on a missing key. The brand is a
 * property of the message TREE, not of any one render, so it is substituted
 * once when the tree is built (`brandMessages` in `i18n/request.ts`) and every
 * call site stays exactly as it was.
 *
 * The tokens are deliberately not valid ICU and not plausible prose, so a
 * leftover one is obvious on screen rather than looking like a word.
 */
export const BRAND_TOKEN = '%APP%';
export const BRAND_SHORT_TOKEN = '%APP_SHORT%';

/**
 * Substitute the brand tokens in one string.
 *
 * Longest token first: `%APP_SHORT%` starts with `%APP%`... it does not, but
 * only because of the trailing `%`. Replacing the short token first removes
 * the ambiguity entirely rather than relying on that, and costs nothing.
 */
export function applyBrand(value: string): string {
  return value.split(BRAND_SHORT_TOKEN).join(APP_SHORT_NAME).split(BRAND_TOKEN).join(APP_NAME);
}
