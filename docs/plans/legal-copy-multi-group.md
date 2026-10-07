# Legal copy once a second club exists

**Track:** Reach (ROADMAP track 4) — multi-group Phase 5 gate item "DECIDE WHAT THE LEGAL COPY SAYS ONCE A SECOND CLUB EXISTS" (`docs/superpowers/plans/2026-09-07-multi-group.md`).
**Status:** in-flight — wording PROPOSED and CONFIRMED by Grant 2026-10-07 ("yes" to D1–D9); both locales edited the same day. A lawyer's read of the four items under "Where a lawyer earns their fee" remains open.
**Review on:** 2026-10-21 — does the Play listing's developer name appear in the privacy policy, and has anyone with a legal eye read the four flagged items? If `NEXT_PUBLIC_FLAG_MULTI_GROUP` flipped first, check both were done.

## Problem

Three sentences in `messages/en.json` and `messages/zh-CN.json` under `legal.*`
are factual claims, true today and false the day a second club exists:

- Privacy "Who we are": "%APP% is a sign-up sheet for **one casual badminton
  group** in Vancouver, BC. It is run by **the group's organiser as an
  individual** — not a company."
- Terms "What this is": "%APP% is a **free tool one group uses** to organise
  weekly badminton. Using it means you're a member of **that group**…"
- Support and Delete-account: "email **the organiser**" — one mailbox
  (`SUPPORT_EMAIL`), one implied organiser. With many clubs, a member of
  another club reads this as "email my club's admin", who cannot delete an
  account or answer a privacy request.

Nobody has reported it: the flag is off and these screens are read by a handful
of people. It was deferred on purpose at Phase 4 (2026-09-12) because "who the
data controller is once strangers' clubs share a deployment is Grant's decision
and possibly a lawyer's". The native apps are live on both stores (#549), so the
copy is also what a store reviewer audits against the privacy label.

One more claim that is false TODAY, found while reading: privacy "Changes" says
"the app will say so on its Home tab". Nothing in `components/` or `lib/`
renders a policy-changed note. Either build it or stop promising it.

## Kill criterion

The rewrite is wasted if no second club ever exists — `docs/plans/pricing.md`
asks that on 2026-12-02 — but it is harmless: the old wording cannot be restored
anyway once strangers can install the app. The real failure would be a store
rejection over a policy that contradicts the privacy label, or a member of a
second club with nobody they can identify to ask about their data.

## Non-goals

- Not a GDPR policy. Canadian law has no "controller"/"processor" vocabulary
  (see research 1); borrowing it would make the text less true, not more.
- Not naming Grant in the copy. The role and the support mailbox are what a
  member needs; the store listing carries the developer's name (research 3).
- Not the pricing terms. One sentence keeps the door open; the plan is
  `docs/plans/pricing.md`.
- Not rewriting `PRODUCT.md` / `README.md` / `docs/OWNER-KB.md`, which carry the
  same "one group" claims — docs, not legal text; a follow-up.

## What the research found (2026-10-07)

1. **Canadian law has no controller/processor split; it has "organizations"
   that stay accountable.** PIPEDA Principle 4.1.3: an organization is
   "responsible for personal information in its possession or custody,
   including information that has been transferred to a third party for
   processing" and must use "contractual or other means to provide a comparable
   level of protection". BC PIPA s.4(2): accountable for information under its
   control even when it does not hold it; s.18(2) lets one organization disclose
   to another "to assist the other organization to carry out work on behalf of
   the first" without fresh consent; **s.4(3)–(5) requires every organization to
   designate a privacy contact and publish how to reach them.** PIPA's
   "organization" expressly includes "an unincorporated association … or a not
   for profit organization", so **each club is an organization under BC PIPA**,
   and so is the operator. PIPEDA itself usually does not reach a club
   (collecting membership fees, compiling member lists and organising club
   activities are non-commercial per the OPC) but WILL reach the operator the
   day a paid tier exists. Keeping both laws named is right; stating the two
   roles is what is missing.
   Sources: [Cassels on 4.1.3](https://cassels.com/insights/privacy-commissioner-confirms-original-outsourcing-guidance/),
   [BC PIPA text](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/03063_01),
   [OPC: PIPEDA and non-profits](https://priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/02_05_d_19),
   [Linklaters: no controller/processor concept in Canada](https://www.linklaters.com/en/insights/data-protected/data-protected---canada).

2. **The industry pattern is two roles plus a plain summary.** Spond (the
   closest analogue, a Norwegian club app) runs the consumer app as the party
   responsible and treats each group administrator as responsible for what they
   do with it: administrators agree to get consent from people they add, to use
   member data outside the app only with a proper basis, and to forward any
   privacy request to the platform "within three working days". Its policy opens
   with an "IN SHORT" bullet list and then numbered sections. TeamSnap and Heja
   publish no role split at all.
   Sources: [Spond administrator terms](https://www.spond.com/administrator-terms/),
   [Spond privacy policy](https://www.spond.com/privacy-policy/),
   [Spond club DPA](https://help.spond.com/club/en/articles/615646-spond-club-data-processing-agreement-dpa).

3. **What the stores check.** Apple 5.1.1(i): the policy must identify what is
   collected, how, and all uses; confirm third parties give equal protection;
   explain retention/deletion and how to revoke consent. 5.1.1(v): in-app account
   deletion (still in the live text today). Google Play User Data policy: the
   policy must name the developer entity shown on the listing and a privacy
   contact, state retention/deletion, disclose anything kept for security or
   fraud reasons, offer deletion in-app AND at a web URL, and the Data safety
   section must be "consistent with the disclosures made in the app's privacy
   policy". Our policy names the role, not the person — **check that the Play
   listing's developer name appears somewhere in the policy** (one line, e.g.
   "operated by <listing name>"), or Play's rule is unmet.
   Sources: [App Store Review Guidelines 5.1.1](https://developer.apple.com/app-store/review/guidelines/),
   [Play User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311).

4. **New OPC guidance on third-party providers** (draft, 2026-09-10, comments to
   2026-12-04): what an agreement with a provider should cover — purposes,
   subcontractors, access requests, breach handling, retention and return. It
   is about the operator's own vendors (Azure, Anthropic, Google, Apple), which
   the policy already covers, and is the shape a club-facing "organiser
   agreement" would take if clubs ever pay.
   Source: [OPC draft guidance](https://www.priv.gc.ca/en/privacy-topics/privacy-for-businesses/appropriate-handling-of-personal-information/gd_third-party_202609/).

## Decisions (proposed 2026-10-07; Grant: "yes" the same day)

- **D1. Two roles, named plainly, no GDPR words.** "The operator" (one person,
  runs the service and the database every club lives in) and "your club's
  organisers" (the admins of a club: who is on the roster, what is owed, who
  has paid). Beat: a single "we" (hides that admins of a club you join are
  strangers to the operator) and "controller/processor" (not Canadian law).
- **D2. One address for privacy requests: the operator's.** The operator
  answers for the service and brings in the club's organisers when the record
  is theirs (a payment they marked). Beat: "ask your club's organiser", who has
  no tool to delete an account or export a record and may be the person being
  asked about. This is Spond's forwarding rule, pointed the other way.
- **D3. Organisers accept duties when they create a club**, in the Terms:
  invite only people who have agreed; use what they see only to run the club;
  payments are between them and their members; they are responsible for their
  club's conduct; the operator can close a club that breaks the terms. Today
  nothing is agreed at "Create a club" — the terms page is where it lives, and a
  one-line "By creating a club you agree to the Terms" under the create button
  is a small follow-up.
- **D4. "Free" becomes "free today" with a one-sentence promise**: a paid plan
  would be announced in the app first and nothing already done becomes payable
  after the fact. Beat: deleting "free" (a reader notices) and promising it
  forever (`docs/plans/pricing.md`).
- **D5. Keep "not for children under 13".** Canada sets no fixed age; the OPC
  treats under-13 consent as meaningful only through a parent. Spond uses 15
  for guardian consent, but that is Norwegian law.
- **D6. Say what the operator can see.** The operator can reach any club's
  records to run and fix the service and answer requests, never to look at a
  club's business for its own sake. Omitting it would be the "lying empty
  state" of a privacy policy — true access left unstated.
- **D7. The Home "policy changed" note: build it or drop the promise.**
  Recommendation: drop the sentence now (the date is the record) and open a
  `later` issue for a one-line Home note keyed on `legal.privacy.updated`.
- **D8. Name the BC regulator too.** A BC club's members can complain to the
  OIPC for BC as well as the federal OPC; name both.
- **D9. Deleting an account leaves every club**, and closing the last
  organiser's account closes the club (`Group.closedAt`). The policy should say
  both; the code already does them.

## Wording — English (shipped; the Chinese is a translation of this, same section count)

Section counts per document must stay equal across locales
(`__tests__/legal-pages.test.ts`), and the needles `e-transfer`, `push token`,
`PIN`, `Google`, `Apple`, `Azure`, `No ads`, `Anthropic`, `arm or shoulder`
must survive. Only the sections listed change; all others stay word-for-word.

### Privacy policy

**Who we are** →
> %APP% is a sign-up sheet for casual badminton clubs. One person — the app's
> operator, in Vancouver, BC — runs the service and the database that every
> club's records live in. Each club is run by its own organisers, who decide
> who is on the roster and what each session costs. The operator is an
> individual, not a company. Canada's PIPEDA and BC's Personal Information
> Protection Act are the laws this policy follows. This app isn't intended for
> children under 13.

**Who admins are** → retitled **Your club's organisers, and the operator**
> • **Your club's organisers** are the person who created the club and anyone
> they have made an admin. They see payment status and e-transfer names for
> their club; other members cannot, and organisers see nothing of any club they
> don't run. When they create a club they agree to add only people who have
> agreed to join, and to use what they see only to run the club.
>
> • **The operator** runs the app for every club and can reach any club's
> records to keep the service working, answer a privacy request, or look into a
> problem report — never to follow a club's business for its own sake.

**Who can see what** → two bullets added
> • **Members of a club** see that club only: names, whether each spot is
> confirmed or waitlisted, and the per-person cost for a session. If you're in
> two clubs, each sees only its own roster.
> • **Your club's organisers** additionally see payment status and e-transfer
> names.
> • A **kudos note** is shown to the person who received it, signed by the giver.
> • **The operator** can see all of the above, for every club, when running or
> fixing the service.

**If something goes wrong** →
> If a breach happens that puts you at real risk of harm, we'll notify you and
> report it to the Office of the Privacy Commissioner of Canada, as PIPEDA
> requires, and to BC's Information and Privacy Commissioner.

**Deleting your account** → one sentence appended
> … that line no longer identifies you. Deleting your account removes you from
> every club you're in; if you're the only organiser of a club, that club closes
> with it.

**Your rights** →
> You can ask what we hold about you, ask for it to be corrected, or withdraw
> consent, using the email on the support page. It reaches the operator, who
> answers for the service and will bring in your club's organisers when the
> record is theirs — a payment they marked, for example. If you're not
> satisfied, you can complain to the Office of the Privacy Commissioner of
> Canada or to BC's Office of the Information and Privacy Commissioner.

**Changes** (D7, recommended) →
> If this policy changes in a way that matters, the date above changes.

### Terms of use

**What this is** →
> %APP% is a tool badminton clubs use to organise weekly sessions. It's run by
> one person, the operator, as a volunteer, and provided as-is: it can go down
> or change without notice. It's free today; if a paid plan is ever introduced
> it will be announced in the app first, and nothing you've already done becomes
> payable after the fact. Using it means you're a member of a club on it, were
> invited by one, or are starting your own.

**Signing up** → "The organiser" → "Your club's organisers".

**Running a club** (NEW section, after "Signing up"; D3)
> If you create a club, you're its organiser. You decide who joins, what
> sessions cost and who has paid, and you're responsible for those decisions and
> for your club's conduct. Invite only people who've agreed to be in the club.
> What you see about your members — names, sign-ups, what's owed, e-transfer
> names — is for running the club and nothing else: don't copy it elsewhere or
> share it. The operator can close a club that breaks these terms.

**Money** →
> The app records each person's share of a session and whether it has been
> paid. It does not take payments. Paying is arranged between you and your
> club's organisers, usually by e-transfer. Nothing in the app is a bill from
> anyone but your club's organisers, and none of it is financial advice or a
> financial service.

**Content** → "The organiser can remove" → "Your club's organisers, or the
operator, can remove".

**Liability** →
> Badminton is a sport; you play at your own risk. The app organises sessions
> and takes no responsibility for what happens on court, for a venue, for how a
> club's organisers run their club, or for another member's conduct. To the
> extent the law allows, the operator isn't liable for losses arising from use
> of the app.

**Ending** →
> You can delete your account at any time. Your club's organisers can remove
> people from their club. The operator can deactivate accounts, or close clubs,
> that break these terms.

### Support and Delete-account pages

- "the organiser" in **Lost your PIN?** and **Questions about money** → "your
  club's organiser" (they hold the one-time code and mark payments).
- `support.emailLabel` "Or email the organiser:" → "Or email the operator:".
- `deleteAccount.noApp` → "Email the operator with the name you signed up under
  and the club you're in, from an address we can reply to, and the account will
  be deleted for you."
- `deleteAccount.keeps` → add "You leave every club you're in. If you were a
  club's only organiser, the club closes."
- Bump `updated` on all four documents to the ship date.

## Where a lawyer earns their fee

Plain-language role statements, contact details and the regulators' names are
low-risk and standard. Worth a professional read before shipping:

1. The **Liability** clause now disclaiming responsibility for how organisers
   run their clubs — the one sentence most likely to be tested.
2. The **operator-can-see-everything** statement (D6): true, and the honest
   thing to say; a lawyer may want it narrower ("only as needed to…").
3. The **paid-plan** sentence (D4): a promise about future pricing.
4. Whether to **incorporate before charging**: PIPEDA attaches to commercial
   activity, and an individual operator carries the liability personally.

## Store checklist (do at ship, not before)

- [ ] Play listing's developer name appears in the privacy policy (research 3).
- [ ] App Store privacy label and Play Data safety re-read against the policy;
      nothing new is collected by this change, so no label edit is expected.
- [ ] Web deletion URL (`/legal/delete-account`) still linked in Play Console.

## Shape

| Piece | File |
|---|---|
| English copy (29 line edits, one new terms section) | `messages/en.json` → `legal.privacy`, `legal.terms`, `legal.support`, `legal.deleteAccount` |
| Chinese copy, same section count | `messages/zh-CN.json` → same keys |
| Shape + needle test | `__tests__/legal-pages.test.ts` (unchanged; every needle survived) |
| Phase 5 gate line ticked | `docs/superpowers/plans/2026-09-07-multi-group.md` |
| Home policy-changed note (D7: dropped from the copy; a Home note is a `later` issue) | GitHub issue, not this change |
| Still open | the Play listing's developer name in the policy (one line, at ship); `PRODUCT.md` / `README.md` / `docs/OWNER-KB.md` still say "one group" |
