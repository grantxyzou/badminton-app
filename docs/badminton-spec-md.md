# Badminton Skill Assessment — Framework Spec (P0)

This document defines the **logic and content** of a badminton skill self-assessment. It is intentionally **UI-agnostic**: it specifies what to measure, how to score, and what to output — but not how anything should look or where files should live.

> **For the implementing AI:** Do not assume layout, components, file locations, styling, or interaction patterns. Before building, ask the developer about: target file locations, framework/stack, component structure, input mechanism, and how results should be presented. This spec is the source of truth for *content and scoring only*.

---

## 1. Phased roadmap

The assessment is built in three phases. **This spec covers P0 only.** P1 and P2 are recorded so the data model can anticipate them.

- **P0 — Self-assessment.** The player rates their own skills.
- **P1 — Peer review.** Another player rates the same skills, for comparison against self-assessment.
- **P2 — AI analysis.** An AI interprets the combined data (e.g. self vs. peer gaps, trends, recommendations).

Implication for P0: store ratings in a structure that can later hold multiple rater sources (self, peer, ai) per skill.

---

## 2. Measurement framework

Skills are organized into **3 dimensions** (after Coach Frank's model: Technical/Tactical, Physical, Mental/Emotional), containing **14 skills total**.

| Dimension | Skills |
|---|---|
| Technical / Tactical | Serves & Returns, Net Play, Clears & Lifts, Drops, Drives, Smashes, Grip & Deception |
| Physical | Footwork & Split Step, Court Coverage & Positioning, Speed & Stamina |
| Mental / Emotional | Game Reading & Shot Selection, Consistency (margins), Rules/Etiquette/Strategy, Training Mindset (the Switch) |

---

## 3. Rating scale

Each skill is rated **1–5**. The number is for scoring; the player should choose based on the **descriptive anchor**, not the digit. Every level follows the same phase logic:

| Value | Phase meaning | Generic anchor logic |
|---|---|---|
| 1 | Foundation | Still learning; inconsistent or avoided |
| 2 | Exploration / Leisure | Works in easy rallies; breaks down under pressure |
| 3 | The Switch | Reliable in games; starting to train it deliberately |
| 4 | Commitment / Intermediate | Consistent and intentional; used tactically |
| 5 | Advanced | A weapon; varied, disguised, wins points |

Each skill has its **own specifically-worded anchors** (below) following this logic. All skills are **optional** — scoring uses only the skills that were rated.

---

## 4. Skill anchors (exact copy)

### Technical / Tactical

**Serves & Returns**
1. My serve is easily attacked; returns often go long or into the net.
2. I get serves in on easy points, but they sit up or get punished under pressure.
3. Reliable low/high serve in games — I'm starting to practice them on purpose.
4. Consistent serves I place intentionally; my returns put me on the front foot.
5. Serve & return are weapons — varied, disguised, and pressuring from shot one.

**Net Play (net shots & kills)**
1. I mostly avoid the net; my net shots pop up or go into the tape.
2. I can play a net shot in a slow rally but can't kill loose shuttles reliably.
3. Tight-ish net shots in games — I'm drilling spin and net kills deliberately.
4. Consistent tight net play; I kill loose lifts and control the front court.
5. I dominate the net — spinning, tumbling, killing, and dictating the rally.

**Clears & Lifts**
1. I can't reliably reach the back; clears land mid-court and get smashed.
2. I clear to the back on easy shots but lose depth when rushed.
3. Decent depth in games — I'm training to hit the back tramlines consistently.
4. Consistent deep clears/lifts that buy me time and reset the rally.
5. I clear with disguise and pinpoint depth to control tempo and force replies.

**Drops**
1. I rarely play drops; they land too short or sit up to be killed.
2. I attempt drops occasionally but they're loose and predictable.
3. Workable drops in games — I'm practicing tighter, deceptive ones.
4. Consistent tight drops I use tactically to move opponents and open the court.
5. Sharp, disguised slice/fast drops that win or set up points outright.

**Drives**
1. Flat exchanges overwhelm me; I can't keep the shuttle low.
2. I can drive in a slow exchange but lose flat-rally battles.
3. I hold my own in drives — starting to train flat-rally speed on purpose.
4. Consistent, fast, flat drives; I win most mid-court exchanges.
5. I control flat rallies — punishing, accurate, and varied in pace and angle.

**Smashes**
1. My smash has little power/placement; I rarely win points with it.
2. I can smash a sitter but it's slow and easily defended.
3. Decent smash in games — I'm training power, steepness, and placement.
4. Consistent, well-placed smashes I use to finish or pressure opponents.
5. A genuine weapon — steep, powerful, placed, and a real point-ender.

**Grip & Deception**
1. I hold one tight grip; I can't change grips or disguise shots.
2. I change grips slowly; opponents read my shots early.
3. I'm working on a loose grip and starting to disguise some shots.
4. Loose grip with quick changes; I disguise direction on several shots.
5. Loose-grip mastery — quick changes and consistent deception across the court.

### Physical

**Footwork & Split Step**
1. I run flat-footed and arrive late; no split step.
2. I move okay on easy shots but get caught flat-footed under pressure.
3. I use a split step in games and I'm drilling movement on purpose.
4. Efficient footwork, consistent split step, leading with the racket leg.
5. Explosive, economical movement — I appear 'light' and rarely get caught out.

**Court Coverage & Positioning**
1. I cover only what's near me; big gaps open across the court.
2. I reach most shots in slow rallies but get pulled out of position.
3. Decent coverage — I'm learning singles/doubles positioning roles.
4. Strong coverage; I understand and hold my role in doubles and singles.
5. I cover the court seamlessly and anticipate to be in position early.

**Speed & Stamina**
1. I tire quickly; pace and quality drop within a game.
2. I last a casual game but fade in longer or faster rallies.
3. Decent endurance — I'm adding conditioning to support harder play.
4. Good stamina; my movement quality holds across multiple games.
5. High-performance fitness — quality degrades only after sustained effort.

### Mental / Emotional

**Game Reading & Shot Selection**
1. I react late and hit whatever I can reach; no real plan.
2. I sometimes pick the right shot but mostly play reactively.
3. I'm starting to read opponents and choose shots with intent.
4. I anticipate from body/racket cues and select shots tactically.
5. I read the game several shots ahead and construct points deliberately.

**Consistency (margins)**
1. Lots of unforced errors; I go for lines and miss often.
2. Inconsistent — good shots mixed with frequent errors.
3. Fewer errors — I'm learning to 'bring margins in' on purpose.
4. Consistent and low-error; I aim with safe margins under pressure.
5. Rock-solid consistency; I force errors while making almost none.

**Rules, Etiquette & Strategy**
1. I'm unsure of rules, scoring, and court etiquette.
2. I know basic rules and scoring but little strategy.
3. Comfortable with rules/formats; starting to think tactically.
4. Solid grasp of strategy, formats, and assessing my level of play.
5. Deep tactical and format knowledge; I game-plan per opponent.

**Training Mindset — the Switch**
1. I just turn up and play; I don't think about improving.
2. I play often and want to get better, but don't train deliberately.
3. The switch: I'm starting to TRAIN for badminton, not just play it.
4. I train with structure — drills, conditioning, and self-assessment.
5. Full high-performance mindset: discipline, goals, recovery, the lot.

---

## 5. Scoring logic

- **Dimension score** = average of the rated skills within that dimension (ignore unrated).
- **Overall score** = average of all rated skills (ignore unrated).
- **Strengths** = the 3 highest-rated skills.
- **Work on next** = the 3 lowest-rated skills.
- All averages are on the 1–5 scale.

---

## 6. Phase placement (output)

The overall score maps to a development phase. **"The Switch"** is the key narrative moment — the crossover from *"I play badminton"* to *"I train for badminton."* It must be called out explicitly when a player lands in that band.

| Phase | Overall score (min) | Meaning |
|---|---|---|
| Foundation | 1.0 | Just starting out |
| Exploration (Leisure) | 1.8 | Playing for fun |
| **The Switch** | 2.6 | **Play → Train crossover (highlight this)** |
| Commitment (Intermediate) | 3.4 | Training with intent |
| Advanced | 4.3 | High-performance play |

(A player falls into the highest phase whose minimum they meet or exceed.)

**The Switch callout (suggested copy):** "You're right at the Switch — the crossover from 'I play badminton' to 'I train for badminton.' This is the make-or-break point. Deliberate practice now is what moves you into the Commitment phase."

---

## 7. Required outputs on the results view

Content the results must convey (presentation is the implementer's decision):

1. Overall phase placement + overall score, with the Switch highlighted when applicable.
2. A per-skill profile across all 14 skills (the radar/spider view tested well, but the format is the implementer's call).
3. Per-dimension scores (3 values).
4. Top 3 strengths and top 3 skills to work on.
5. Ability to drill into any single skill and read the exact anchor description the player selected.

---

## 8. Data model note (for P1/P2 readiness)

Store each rating as `{ skillKey, value (1–5), source: "self" | "peer" | "ai" }` so P1 peer reviews and P2 AI analysis can attach to the same skills without restructuring.

---

## 9. Source grounding

- 3-dimension model and the "play vs. train" Switch: Coach Frank's 12-level framework (Foundation 0–2, Exploration/Leisure 3–4, Commitment/Intermediate 5–6).
- Skill component breakdown and level indicators: Ace Badminton Club skills matrix (objective classification into playing/training categories).
- Anchors are calibrated for a **beginner → intermediate → some-advanced** club population.

---

*End of P0 spec. Implementer: please ask about file locations and all UI/interaction decisions before writing code.*
