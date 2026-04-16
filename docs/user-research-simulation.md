# BPM Badminton — User Research Report (AI-Simulated)

> **Date:** April 12, 2026
> **Method:** AI-simulated personas, usability testing, and needs analysis
> **Status:** Draft — findings should be validated with real players

---

## 1. Executive Summary

This report reconstructs lost user research notes through AI simulation. Using deep analysis of the BPM Badminton codebase, badminton player culture, and the demographics of a Chinese-Canadian recreational group, we generated 8 personas, simulated usability tests across 25+ task scenarios, and identified unmet needs cross-referenced against the P0-P4 product roadmap.

**Key finding:** 7 of the top 10 unmet needs have zero roadmap coverage. The single largest gap is **Chinese language support** — roughly half the player base reads Chinese primarily, yet every UI string, error message, and state banner is English-only. The roadmap (P1-P3) is heavily weighted toward skill/progress features while localization, payment, and accessibility for the actual user demographics remain unaddressed.

**Recommendation:** Insert a **P1.5 — Localization & Accessibility** tier before continuing with P2.

---

## 2. Methodology

| Phase | Activity | Output |
|-------|----------|--------|
| 1 | Persona creation from app feature inventory + casual badminton culture | 8 personas |
| 2 | Simulated usability testing (6 personas x 4-5 tasks each) | 25+ task walkthroughs |
| 3 | Unmet needs analysis cross-referenced against P0-P4 roadmap | Top 10 ranked needs |
| 4 | Report compilation and recommendations | This document |

**Limitations:**
- AI-simulated, not real user interviews — behavioral patterns are inferred, not observed
- Persona demographics extrapolated from app context (Chinese-Canadian badminton group, dim sum culture, WeChat/WhatsApp split)
- Usability "tests" are cognitive walkthroughs, not screen recordings
- Findings should be validated by asking 2-3 real players from each archetype

---

## 3. User Personas

### Persona 1: Kevin Tran — The Organizer

| | |
|---|---|
| **Age / Occupation** | 34, Software Developer |
| **Role** | Admin (built the app) |
| **Language** | Bilingual (English / Chinese) |
| **Tech Comfort** | Expert |
| **Sign-up** | First — creates the session |
| **Payment** | Collects from others |
| **Primary Need** | Reduce admin overhead |
| **Key Frustration** | People message him instead of using the app; chasing payments weekly |

Kevin has organized the weekly session for 3 years. He creates sessions Monday evening, monitors sign-ups through the week, manages bird inventory, chases 2-3 late payments via WhatsApp/WeChat after every session, and advances the session on Sunday. He spends more time managing badminton than playing it.

---

### Persona 2: Priya Sharma — The Core Regular

| | |
|---|---|
| **Age / Occupation** | 29, Physiotherapist |
| **Role** | Regular Player |
| **Language** | English-primary |
| **Tech Comfort** | Comfortable |
| **Sign-up** | Within hours of opening |
| **Payment** | Immediate (same day) |
| **Primary Need** | Quick info: when, where, who, how much |
| **Key Frustration** | Missing cost info when no announcement posted; no skill data visible |

Priya played competitively in India. She's one of the strongest players and never misses a week. Her app interaction is 15 seconds: open, sign up, done. She checks the roster once mid-week to anticipate doubles matchups. She pays on the drive home.

---

### Persona 3: Marcus Chen — The Flaky One

| | |
|---|---|
| **Age / Occupation** | 27, Marketing Coordinator |
| **Role** | Irregular Player |
| **Language** | English-primary |
| **Tech Comfort** | Savvy but careless |
| **Sign-up** | Last minute or not at all |
| **Payment** | 2-3 days late, needs reminding |
| **Primary Need** | Keep options open without committing |
| **Key Frustration** | Losing identity when browser data clears; feeling pressured to commit early |

Marcus decides Friday night whether he's going Saturday. He's cancelled 3 times in 2 months. He clears browser data periodically, which wipes his localStorage identity — he can see his name on the roster but can't cancel or interact. He texts Kevin to fix it.

---

### Persona 4: Emily Nguyen — The Beginner

| | |
|---|---|
| **Age / Occupation** | 24, Junior Accountant |
| **Role** | New Player (6 weeks) |
| **Language** | English-primary |
| **Tech Comfort** | Very comfortable |
| **Sign-up** | Early (prompted by Priya) |
| **Payment** | Prompt |
| **Primary Need** | Get better without embarrassment; feel included |
| **Key Frustration** | Skills tab is a dead-end; no group norms explained; no progress tracking |

Emily joined through Priya. She holds the racket with a frying pan grip and apologizes after missed shots. She checks the Skills tab every week hoping it'll have content. She watches YouTube tutorials after each session. She'd love a self-assessment to track her improvement.

---

### Persona 5: Jason Park — The Competitive One

| | |
|---|---|
| **Age / Occupation** | 31, Financial Analyst |
| **Role** | Regular Player |
| **Language** | Bilingual (English / Korean / Chinese) |
| **Tech Comfort** | Proficient |
| **Sign-up** | Immediate, every week |
| **Payment** | Immediate |
| **Primary Need** | Skill data, stats, balanced courts |
| **Key Frustration** | No skill info on roster; Skills tab admin-gated; no performance tracking |

Jason is the best player in the group — ex-competitive, provincial ranking. He mentally plans doubles combinations from the roster. He discovered the 5-tap admin easter egg but couldn't get past the PIN. He's asked Kevin twice about opening the Skills tab to players.

---

### Persona 6: Linda Wu — The Social Glue

| | |
|---|---|
| **Age / Occupation** | 38, HR Manager |
| **Role** | Regular-ish Player |
| **Language** | Bilingual (English / Chinese) |
| **Tech Comfort** | Comfortable |
| **Sign-up** | Mid-week |
| **Payment** | Within 24 hours |
| **Primary Need** | Community, social connection, group coordination |
| **Key Frustration** | No social features; supplements everything via WhatsApp/WeChat |

Linda organizes post-game dim sum, texts people who haven't shown up in weeks, and welcomes new players. She screenshots the app's sign-up list into WhatsApp every week. She calls the app "a spreadsheet with good skin" — functional but personality-free.

---

### Persona 7: Uncle Chen — The Chinese-Primary Elder

| | |
|---|---|
| **Age / Occupation** | 55, Semi-retired |
| **Role** | Regular Player |
| **Language** | Mandarin / Cantonese primary, minimal English |
| **Tech Comfort** | Low (phone is main device, uses WeChat) |
| **Sign-up** | Needs family member's help |
| **Payment** | Cash or late e-transfer (with help) |
| **Primary Need** | Chinese UI so he can use the app independently |
| **Key Frustration** | Entire app is in English; can't read error messages, buttons, or announcements |

Uncle Chen has played badminton recreationally for 30+ years. He's a strong player with excellent court sense. But the English-only UI means he can't sign up, check the roster, or understand announcements without asking his nephew to translate. He uses WeChat exclusively — WhatsApp links feel foreign.

---

### Persona 8: Amy Zhang — The Occasional Spouse

| | |
|---|---|
| **Age / Occupation** | 35, Office Manager |
| **Role** | Occasional Player |
| **Language** | Mandarin-primary, functional English |
| **Tech Comfort** | Moderate |
| **Sign-up** | Via husband (doesn't have link saved) |
| **Payment** | Via husband |
| **Primary Need** | Simple, one-tap sign-up when she decides to come |
| **Key Frustration** | Not on invite list; has to get the link fresh each time; English UI is friction |

Amy comes when her husband plays (~2x/month). She's a beginner and slightly intimidated by the group. She doesn't save the app link and gets it from her husband each time. If the invite list is active and she's not on it, she gets a confusing 403 error and gives up.

---

## 4. Usability Test Results

### Critical Issues (2)

#### 4.1 Cold Start Blank Screen (10-20s)

The app shows a **white screen** for 10-20 seconds during initial JavaScript hydration on B1 tier cold starts. The `ShuttleLoader` animation only renders after React hydrates — before that, nothing is visible. Users think the app is broken.

- **Affected:** All users on first visit or after 20min idle
- **Most impacted:** Uncle Chen (closes tab), Amy (gives up), Marcus ("your app is broken")

> *"I waited like 15 seconds staring at a white screen. I almost closed it."* — Marcus

#### 4.2 localStorage Identity Unrecoverable

Clearing browser data **permanently** destroys the `deleteToken`. Users can see their name on the roster but cannot self-cancel, self-identify, or regain control. Attempting to re-sign-up returns a 409 ("already signed up"). The only recovery is asking the admin.

- **Affected:** Anyone who clears browser data, switches phones, or uses incognito
- **Most impacted:** Marcus (clears data regularly), Uncle Chen (might use different browser)

> *"It says I'm already signed up but it won't let me do anything. The app literally forgot who I am but remembers my name."* — Marcus

---

### Major Issues (9)

#### 4.3 No Onboarding for First-Time Users

The app assumes you know what BPM is, how the group works, what the invite list means, and how payment works. Zero welcome, zero FAQ, zero "how this works" guidance.

> *"The app looks polished and I can sign up easily. But I still don't know basic stuff like 'should I bring my own shuttles?'"* — Emily

#### 4.4 Invite List Blocks with Unhelpful Error

When `approvedNames` is active, non-listed players get a 403: "Name not on the invite list." No guidance on what the list is, how to get on it, or who to contact.

> *"Nobody told me about a list. I had to text Kevin and wait for him to fix it. By then I almost just said forget it."* — Marcus

#### 4.5 Skills Tab Dead-End for Non-Admins

25-33% of nav real estate occupied by a tab that shows only "Progress together?" — no explanation, no timeline, no self-assessment, no value.

> *"I keep checking this tab every week hoping something appears. 'Progress together?' — how? When? Give me something."* — Emily

#### 4.6 Skill Data Entirely Admin-Gated

The admin has a full radar chart with 7 ACE dimensions for every player. Regular players have **zero** access to this data — not even their own profile.

> *"Just let me see my own skill chart, man. I don't need to edit anything."* — Jason

#### 4.7 Cost Visibility Coupled to Announcement

No announcement posted = no cost info visible to players. The coupling is non-obvious. Players have to ask on WhatsApp.

> *"Last week cost wasn't showing. Apparently Kevin hadn't posted an announcement yet. Why would the cost depend on whether there's an announcement?"* — Priya

#### 4.8 Payment Info Disappears After Session Ends

The e-transfer email and payment reminder only render during the "signed up" state. After the session finishes, payment details vanish — exactly when players need them most.

> *"I know I owe $11.25, but the e-transfer email vanished from the app."* — Linda

#### 4.9 No Payment Aggregate for Admin

Kevin manually scans each player row to count who has and hasn't paid. No counter, no filter, no cross-session report.

> *"I'm basically keeping a mental tally. A simple 'X of Y paid' counter would save me five minutes of squinting."* — Kevin

#### 4.10 No Social Features

Zero comments, reactions, profiles, photos, or messaging. Linda screenshots the sign-up list into WhatsApp weekly. The app handles transactions but not community.

> *"It's a beautiful app for signing up, but that's all it does. I still coordinate everything fun in WhatsApp."* — Linda

#### 4.11 "Next Week" Button Buried

Admin's most frequent action (advancing to next session) requires scrolling past the entire player list, waitlist, removed players, and quick-access buttons. With 12+ players, this is significant scroll distance.

> *"I set up next week's session every Sunday night and I always have to scroll past everyone just to hit that button."* — Kevin

---

### Minor Issues (11)

1. No cost breakdown visible to non-admins (just the final per-person number)
2. "Coming Soon" tab label nearly invisible (9px, 70% opacity, no icon)
3. No confirmation notification after sign-up (no email, no push)
4. "Reported" payment badge is 9px and easy to miss
5. No beginner guide or FAQ for new players
6. No player profiles or attendance history on roster
7. No payment history or "I already paid" self-check for players
8. Sign-up form provides no guidance on required name format for invite list
9. No preview of announcement appearance on Home tab before posting
10. 5-tap easter egg reveals Admin tab you can't use (false promise)
11. `signupOpen` defaults to closed on advance with no toggle in the advance form

### Cosmetic Issues (3)

1. No scheduling for announcements (post now or not at all)
2. No player disambiguation for common names
3. Theme preference (`badminton_theme`) lost when browser data cleared

---

## 5. Unmet Needs Analysis — Top 10

| Rank | Need | Category | Impact | In Roadmap? |
|------|------|----------|--------|-------------|
| 1 | Chinese language support (zh-CN + zh-TW) | Localization | HIGH | **No** |
| 2 | Cold start loading UX (static skeleton) | Accessibility | HIGH | **No** |
| 3 | Identity recovery (interim before Emoji PIN) | Identity | HIGH | P3 (distant) |
| 4 | First-time onboarding + invite list guidance | Onboarding | HIGH | **No** |
| 5 | Payment tracking aggregate (admin view) | Payment | HIGH | **No** |
| 6 | Text size accessibility for 50+ users | Accessibility | MED-HIGH | **No** |
| 7 | WeChat sharing & browser compatibility | Communication | MED-HIGH | **No** |
| 8 | Payment info persistence after session ends | Payment | MEDIUM | **No** |
| 9 | Skills tab value for non-admins | Skill/Progress | MEDIUM | P1-S2 (planned) |
| 10 | Proxy sign-up (on behalf of another player) | Social | MEDIUM | **No** |

---

### Need 1: Chinese Language Support

**"As Uncle Chen, I need the app in Chinese so I can sign up, read announcements, and understand errors without asking my nephew for help."**

- **Workaround:** Family member translates or signs up on their behalf
- **Affected:** Uncle Chen, Amy Zhang, Linda Wu, Jason Park (partially)
- **Impact:** HIGH — affects ~50% of users on every single visit

### Need 2: Cold Start Loading UX

**"As Amy Zhang, I need to see something loading during the 10-20s cold start so I know the app isn't broken."**

- **Workaround:** Refresh repeatedly or give up
- **Affected:** All users, especially first-time visitors and after idle periods
- **Impact:** HIGH — happens every cold start, causes abandonment

### Need 3: Identity Recovery

**"As Marcus, I need to reclaim my sign-up after clearing browser data so I don't have to bother Kevin every time."**

- **Workaround:** Text Kevin (admin) to remove/re-add manually
- **Affected:** Marcus, Uncle Chen, Amy, anyone switching phones
- **Impact:** HIGH — permanent lockout with no self-service recovery

### Need 4: First-Time Onboarding

**"As Amy Zhang, I need to understand what this app is, whether I can sign up, and what happens if I'm not on the invite list."**

- **Workaround:** Ask partner or another player to explain
- **Affected:** Emily, Amy, Uncle Chen, any new player
- **Impact:** HIGH — every new user hits this; 403 errors cause abandonment

### Need 5: Payment Tracking Aggregate

**"As Kevin (admin), I need a 'X/Y paid' counter and filter so I don't manually count paid status across 12 player rows."**

- **Workaround:** Visual scan + mental tally + cross-reference bank notifications
- **Affected:** Kevin (admin)
- **Impact:** HIGH — happens every session, significant admin time sink

### Need 6: Text Size for Older Users

**"As Uncle Chen, I need larger text so I can read session details and player names without pinch-to-zoom."**

- **Workaround:** Pinch-to-zoom or system accessibility settings
- **Affected:** Uncle Chen, Linda (38), older players
- **Impact:** MED-HIGH — base text 14px, errors/costs at 12px; difficult for 50+ on phone screens

### Need 7: WeChat Sharing & Browser Compatibility

**"As Linda Wu, I need to share the app link via WeChat with rich previews so the Chinese-speaking members can easily access it."**

- **Workaround:** Copy-paste raw URL into WeChat (no rich preview, in-app browser quirks)
- **Affected:** Linda, Uncle Chen, Amy, all WeChat users
- **Impact:** MED-HIGH — WeChat is primary messaging for ~50% of users

### Need 8: Payment Info Persistence

**"As Marcus, I need to see how much I owe and where to pay even after the session ends."**

- **Workaround:** Ask Kevin or scroll through banking app for previous transfer details
- **Affected:** Marcus, Linda, any player who pays after the session
- **Impact:** MEDIUM — payment details vanish at the moment they're most needed

### Need 9: Skills Tab for Non-Admins

**"As Emily (beginner), I need the Skills tab to show me something useful so I can track my improvement."**

- **Workaround:** None — tap once, see placeholder, never return
- **Affected:** Emily, Jason, Priya, all non-admin users
- **Impact:** MEDIUM — addressed in P1 Stage 2 (planned but not shipped)

### Need 10: Proxy Sign-Up

**"As Linda Wu, I need to sign up my husband or another player who doesn't have the app open."**

- **Workaround:** Ask Kevin (admin) to add the person, or use the other person's phone
- **Affected:** Linda, Uncle Chen's family, Amy's husband
- **Impact:** MEDIUM — common in family/social groups

---

## 6. Localization Deep-Dive

### Why It Matters

For a Chinese-Canadian badminton group where ~50% of players read Chinese primarily, English-only UI is not a cosmetic issue — it's an accessibility barrier. Uncle Chen cannot use the app independently. Amy struggles through functional English. Even bilingual players like Linda and Jason would prefer their primary language.

### Scope

- **~120 UI strings** need translation: buttons, labels, error messages, state banners, form placeholders, tab names, status text
- **Both Simplified (zh-CN) and Traditional (zh-TW)** Chinese needed to serve the full community
- **Player names** are already Unicode-safe — no code changes needed for Chinese names in the roster
- **Date/time formatting** already uses `toLocaleDateString(undefined, ...)` which respects browser locale
- **Admin-authored content** (announcements) stays in whatever language the admin writes

### Technical Approach

- **Framework:** `next-intl` or a simple JSON dictionary with `useTranslations()` hook
- **Detection:** Browser locale via `Accept-Language` header for initial language, with manual toggle in UI
- **Toggle placement:** Header or settings — visible but not intrusive
- **Fallback:** English for any untranslated strings
- **Build impact:** Minimal — string extraction, no layout changes needed (Chinese text is generally more compact than English)

### Cultural UX Considerations

| Aspect | Current | Needed |
|--------|---------|--------|
| **Messaging platform** | WhatsApp-centric | WeChat sharing with rich OG previews |
| **Confirmation patterns** | Single-tap cancel | Chinese UX norms expect more confirmation steps; especially important for older users |
| **Payment norms** | E-transfer assumed | Some older players prefer cash; payment method flexibility |
| **Link sharing** | Standard URL | WeChat in-app browser has localStorage quirks — test thoroughly |
| **Communication style** | Direct/informal English | More polite/formal tone in Chinese translations |

### Bilingual Announcements

The existing "Improve with AI" feature for announcements could be extended to auto-generate a Chinese translation alongside the English text. This would let Kevin write in English and automatically produce a bilingual announcement visible on the Home tab.

---

## 7. Roadmap Gap Analysis

### Current Roadmap Coverage

| Tier | Focus | Covers Research Needs? |
|------|-------|----------------------|
| P0 | Core app (invite list, identity, roster, admin) | N/A — complete |
| P1 | Skill framework (radar chart, persistence, admin tools) | Partially — Stage 2 (non-admin view) addresses Need #9 |
| P2 | Self-assessment, spider graph, attendance, cost splitting | Partially — attendance + cost features address some gaps |
| P3 | Emoji PIN identity, peer assessment, matchmaking | Partially — Emoji PIN addresses Need #3 (but distant) |
| P4 | Polish, multi-admin, subdomain | Minimal overlap with research needs |

### Gap Summary

| Need | Roadmap Status |
|------|---------------|
| 1. Chinese localization | **NOT IN ROADMAP** |
| 2. Cold start UX | **NOT IN ROADMAP** (noted as gotcha only) |
| 3. Identity recovery | P3 (2+ tiers away, no interim bridge) |
| 4. Onboarding | **NOT IN ROADMAP** |
| 5. Payment aggregate | **NOT IN ROADMAP** |
| 6. Text size accessibility | **NOT IN ROADMAP** |
| 7. WeChat sharing | **NOT IN ROADMAP** (WhatsApp only in P2) |
| 8. Payment persistence | **NOT IN ROADMAP** |
| 9. Skills for non-admins | P1-S2 (planned, not shipped) |
| 10. Proxy sign-up | **NOT IN ROADMAP** |

**7 of 10 top needs have zero roadmap coverage.**

### The Mismatch

The roadmap prioritizes **skill/progress features** (P1-P3) — radar charts, self-assessment, coaching, matchmaking. These serve Jason (competitive) and Emily (beginner wanting structure) well.

But the roadmap **misses the demographic reality**: half the users can't read the UI, older players struggle with text size, payment tracking is manual, and there's no onboarding. These aren't edge cases — they affect 50%+ of the user base on every visit.

### Recommendation: Insert P1.5

**P1.5 — Localization & Accessibility** (before P2):
1. Chinese i18n framework + first-pass translation (~120 strings)
2. Language toggle (auto-detect + manual)
3. Cold start static skeleton
4. Text size minimum increase (base 16px)
5. Payment info always visible (decouple from announcement)
6. Onboarding card for first-time users
7. Invite list error improvement (guidance text)
8. "X/Y paid" counter for admin view

---

## 8. Recommendations

### Immediate (Next 1-2 Sessions)

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| 1 | Set up i18n framework (`next-intl` or JSON dict) + translate ~120 strings to zh-CN and zh-TW | Medium | HIGH — unlocks app for ~50% of users |
| 2 | Add static HTML skeleton for cold start (before React hydrates) | Small | HIGH — prevents abandonment |
| 3 | Decouple payment info from announcement card — always show e-transfer details | Small | MEDIUM — fixes disappearing payment info |

### Short-Term (Next Month)

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| 4 | First-time onboarding overlay explaining BPM + sign-up flow + invite list | Small | HIGH — reduces confusion and admin support burden |
| 5 | Increase base text to 16px, minimum 14px for secondary content | Small | MED-HIGH — accessibility for older users |
| 6 | Payment aggregate admin view ("5/8 paid" counter + filter toggle) | Medium | HIGH — saves Kevin 5-10 min/session |
| 7 | Improve invite list error: explain what it is, who to contact | Small | MEDIUM — reduces 403 abandonment |
| 8 | Move "Next Week" button above player list (or pin it) | Small | MINOR — reduces admin scroll friction |

### Medium-Term

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| 9 | Test WeChat in-app browser + optimize OG meta tags for Chinese previews | Medium | MED-HIGH — WeChat is primary for ~50% |
| 10 | Identity recovery bridge (name + secret phrase reclaim) before P3 emoji PIN | Medium | HIGH — self-service recovery without full account system |
| 11 | Proxy sign-up flow (sign up on behalf of another player) | Medium | MEDIUM — helps families and social coordinators |
| 12 | Bilingual AI announcements (English + Chinese auto-translation) | Medium | MEDIUM — leverages existing AI improve feature |

### Continue As Planned

- **P1 Stage 2:** Non-admin read-only skills view (addresses Need #9)
- **P2:** Self-assessment across 7 ACE dimensions
- **P3:** Emoji PIN identity (addresses Need #3 fully)

---

## 9. Appendix: Persona Comparison Matrix

| Persona | Age | Language | Tech Comfort | Frequency | Sign-up Timing | Payment | Primary Need |
|---------|-----|----------|-------------|-----------|---------------|---------|-------------|
| Kevin (Admin) | 34 | EN / ZH | Expert | Every week | First (creates) | Collects | Reduce admin burden |
| Priya | 29 | EN | Comfortable | Every week | Within hours | Immediate | Info + reliability |
| Marcus | 27 | EN | Savvy / careless | 2-3x/month | Last minute | 2-3 days late | Flexibility |
| Emily | 24 | EN | Very comfortable | Most weeks | Early (prompted) | Prompt | Learning structure |
| Jason | 31 | EN / KR / ZH | Proficient | Every week | Immediate | Immediate | Skill data + stats |
| Linda | 38 | EN / ZH | Comfortable | Most weeks | Mid-week | Within 24h | Community + social |
| Uncle Chen | 55 | ZH primary | Low | Every week | Needs help | Cash / late | Chinese UI |
| Amy (Spouse) | 35 | ZH primary | Moderate | 2x/month | Via husband | Via husband | Simple sign-up |

---

*This report was AI-simulated on April 12, 2026. Findings are grounded in actual app architecture and badminton culture but have not been validated with real user interviews. Recommended next step: share key findings with 2-3 players from each archetype to confirm or adjust priorities.*
