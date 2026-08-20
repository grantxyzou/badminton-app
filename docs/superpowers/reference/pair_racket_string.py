"""
pair_racket_string.py
=====================

Pairs a racket (from racket_database.json) with strings (from
badminton_string_database.json) and returns ranked, explained recommendations.

DESIGN PHILOSOPHY
-----------------
The racket recommender used "amplify strengths, don't patch weaknesses" — correct
there, because the racket is chosen to fit the *player*.

String pairing inverts that. The frame is already fixed, and the string is the
smaller lever (~15-20% of felt performance vs the frame's ~80%). So the string's
job is to COMPENSATE, not amplify:

    head-heavy power frame  ->  the system already has power; the string should
                                give back durability and control
    head-light speed frame  ->  the system is power-deficient; the string should
                                give back repulsion

Think of it like tyres on a car. You don't put drag slicks on a car that already
oversteers — you fit the tyre that brings the whole system back into balance.

Five scorers, weighted to 100:

  tension_fit        20   Do the two rated tension windows overlap usefully?
  system_power       30   Does racket-power + string-power land near the target?
  feel_balance       20   Stiff shaft + hard string = harsh. Inverse-match feel.
  durability_demand  20   Will this player break this string on this frame?
  value_fit          10   Is string spend proportionate to frame spend?

Plus a HARD GATE: if the tension windows don't overlap at all, the pair is
rejected outright rather than scored low.

USAGE
-----
    from pair_racket_string import load, pair, PlayerContext

    rackets, strings = load("racket_database.json",
                            "badminton_string_database.json")
    me = PlayerContext(offense=4, defence=3, grip=4, movement=3,
                       strategy=4, serve=3, sessions_per_week=1.5)

    for rec in pair(rackets["li-ning-halbertec-5000"], strings, me, top_n=5):
        print(rec.pretty())

No third-party dependencies. Deterministic — same inputs, same ranking.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Optional

# --------------------------------------------------------------------------
# Normalization: turn each brand's free-text descriptors into ordinal scales.
# Unknown values fall back to the middle rather than raising, so a new racket
# with an unseen flex label degrades gracefully instead of crashing the feed.
# --------------------------------------------------------------------------

FLEX_SCALE = {
    "flexible": 1, "medium flexible": 2, "medium flex": 2,
    "medium": 3, "medium stiff": 4, "medium-stiff": 4,
    "stiff": 5, "extra stiff": 6, "extra-stiff": 6,
}

BALANCE_SCALE = {
    "extra head-light": 1, "head-light": 2, "slightly head-light": 2.5,
    "even": 3, "even balance": 3, "balanced": 3,
    "slightly head-heavy": 3.5, "head-heavy": 4, "extra head-heavy": 5,
}

RACKET_CATEGORY_POWER = {"Power": 1.5, "All-round": 0.0, "Control": -0.5, "Speed": -1.0}

# String category contribution to system power (before gauge adjustment)
STRING_CATEGORY_POWER = {
    "Repulsion": 1.5, "All-round": 0.0, "Hybrid": -0.3,
    "Control": -0.5, "Durability": -1.0,
}

SKILL_RANK = {"Beginner": 1, "Intermediate": 2, "Advanced": 3}


def _norm(value: Optional[str], table: dict, default: float) -> float:
    if not value:
        return default
    return table.get(str(value).strip().lower(), default)


# --------------------------------------------------------------------------
# Player context — ACE Badminton Club Skills Matrix, 6 dimensions, 1-6 each.
# All fields optional; omitting the player yields a frame-only pairing.
# --------------------------------------------------------------------------

@dataclass
class PlayerContext:
    grip: int = 3
    movement: int = 3
    serve: int = 3
    offense: int = 3
    defence: int = 3
    strategy: int = 3
    sessions_per_week: float = 1.0
    hours_per_session: float = 2.0
    budget_sensitivity: str = "normal"      # "low" | "normal" | "high"
    known_string_breaker: bool = False
    # How much a player MINDS restringing. Competitive players knowingly run
    # fragile strings and restring weekly; treating breakage as a flat cost
    # for everyone pushed serious players toward training strings.
    restring_tolerance: str = "normal"      # "low" | "normal" | "high"

    @property
    def overall(self) -> float:
        """Mean ACE score, 1-6."""
        return (self.grip + self.movement + self.serve
                + self.offense + self.defence + self.strategy) / 6.0

    @property
    def skill_rank(self) -> int:
        """Collapse ACE 1-6 onto the string DB's Beginner/Intermediate/Advanced."""
        o = self.overall
        return 1 if o < 2.5 else (2 if o < 4.5 else 3)

    @property
    def hours_per_week(self) -> float:
        return self.sessions_per_week * self.hours_per_session


DEFAULT_PLAYER = PlayerContext()


# --------------------------------------------------------------------------
# Derived indices
# --------------------------------------------------------------------------

def racket_power_index(racket: dict) -> float:
    """
    0-10, centred on 5. How much power the FRAME contributes before stringing.

    CALIBRATION NOTE: the usable band is deliberately 2.5-8.5, not 0-10. A
    head-light speed frame is not a zero-power racket, and an early version
    that let the ends hit 0 and 10 clamped — every extreme frame produced
    identical scores and the ranking lost all resolution at the top.
    """
    bal = _norm(racket.get("balance"), BALANCE_SCALE, 3.0)      # 1-5
    cat = RACKET_CATEGORY_POWER.get(racket.get("category"), 0.0)
    # Heavier frames carry more momentum into the shuttle.
    wmax = racket.get("weightMaxG") or 84
    weight_bonus = max(-0.4, min(0.8, (wmax - 84) / 8.0))
    raw = 5.0 + (bal - 3.0) * 1.15 + cat * 0.7 + weight_bonus
    return max(2.0, min(9.0, raw))


def string_power_index(s: dict, tension: Optional[float] = None) -> float:
    """
    0-10, centred on 5. How much power the STRING adds.

    CALIBRATION NOTE — gauge's effect on power is TENSION-DEPENDENT, and an
    earlier version missed this. A thin string at 22 lbs is a trampoline; the
    same string at 28 lbs is a precision instrument with a tiny sweet spot.
    Treating thin as unconditionally powerful made the engine recommend thick
    durability strings to advanced players on flagship frames — the exact
    opposite of what they actually use.

    So the thinness term decays as tension rises, and high tension applies a
    flat power reduction on top.
    """
    gauge = s.get("gaugeMm") or 0.66
    # Thinner = more repulsion. 0.58mm -> +1.0, 0.72mm -> -1.0
    thinness = max(-1.0, min(1.0, (0.655 - gauge) / 0.065))
    cat = STRING_CATEGORY_POWER.get(s.get("category"), 0.0)
    rep = ((s.get("repulsion") or 7) - 7) / 3.0                 # -1.3 .. +1.0

    t = 24.0 if tension is None else tension
    over = max(0.0, t - 24.0)
    thin_gain = max(0.6, 2.2 - over * 0.20)     # thin loses trampoline as tension climbs
    flat = -over * 0.26 + max(0.0, 24.0 - t) * 0.20

    raw = 5.0 + thinness * thin_gain + cat * 0.9 + rep * 1.1 + flat
    return max(2.0, min(9.0, raw))


SYSTEM_STRING_WEIGHT = 0.35     # the string's share of felt system power
SYSTEM_FRAME_WEIGHT = 0.65


def achievable_power_band(racket: dict):
    """The system-power range this frame can reach across the whole string DB."""
    rp = racket_power_index(racket) * SYSTEM_FRAME_WEIGHT
    return rp + 2.0 * SYSTEM_STRING_WEIGHT, rp + 9.0 * SYSTEM_STRING_WEIGHT


def target_power_fraction(p: PlayerContext) -> float:
    """
    Where in the frame's ACHIEVABLE band to aim, 0-1.

    CALIBRATION NOTE — two errors were corrected here.

    First, the target used to be an absolute 0-10 value. On a head-heavy
    flagship the frame alone contributes ~5.0 of system power, so any target
    below that was unreachable and every string clipped to the low end — the
    engine recommended 0.70mm training strings to advanced players. A target
    expressed as a fraction of what the frame can actually reach cannot
    saturate.

    Second, the original assumed power need FALLS with skill ("strong attacker
    wants less assist"). That's true of a club player and false of an advanced
    one: elite players run thin, lively strings and control them with tension
    and technique, not by de-tuning the string bed. Responsiveness now rises
    mildly with skill, and control is expressed through recommend_tension().
    """
    frac = 0.40 + (p.overall - 3.5) * 0.07
    frac += (3 - p.offense) * 0.03      # power-deficient players want more assist
    frac += (3 - p.strategy) * 0.015
    return max(0.15, min(0.90, frac))


def target_system_power(racket: dict, p: PlayerContext) -> float:
    """
    Blend of an ABSOLUTE target (what a balanced string bed should feel like,
    regardless of frame) and a FRAME-RELATIVE one (where in this frame's
    reachable band to sit).

    CALIBRATION NOTE: neither works alone. Pure absolute saturates on extreme
    frames. Pure frame-relative saturates nothing but erases the compensate
    logic entirely — a head-heavy power frame and a head-light speed frame
    returned the same top three, because both were aiming at the same relative
    position in their own band. The blend is then clamped INSIDE the band, so
    it differentiates by frame while staying reachable.
    """
    lo, hi = achievable_power_band(racket)
    span = hi - lo

    absolute = 5.6 - (p.offense - 3) * 0.25 - (p.grip - 3) * 0.10
    relative = lo + span * target_power_fraction(p)
    blended = absolute * 0.55 + relative * 0.45

    return max(lo + span * 0.15, min(hi - span * 0.05, blended))


# --------------------------------------------------------------------------
# Scorers — each returns (0..1 score, reason or None, warning or None)
# --------------------------------------------------------------------------

def score_tension(racket: dict, s: dict):
    r_lo = racket.get("tensionMinLbs") or 20
    r_hi = racket.get("tensionMaxLbs")
    s_lo = s.get("tensionMinLbs") or 20
    s_hi = s.get("tensionMaxLbs") or 26

    if r_hi is None:
        return 0.6, "Racket tension ceiling unpublished — verify before stringing.", None

    lo, hi = max(r_lo, s_lo), min(r_hi, s_hi)
    if hi < lo:
        return None, None, (f"INCOMPATIBLE: racket {r_lo}-{r_hi} lbs and string "
                            f"{s_lo}-{s_hi} lbs have no overlapping range.")

    width = hi - lo
    if width >= 5:
        return 1.0, f"Wide usable tension window ({lo:.0f}-{hi:.0f} lbs).", None
    if width >= 2:
        return 0.75, f"Workable tension window ({lo:.0f}-{hi:.0f} lbs).", None
    return 0.4, None, (f"Very narrow tension window ({lo:.0f}-{hi:.0f} lbs) — "
                       f"little room for a stringer to adjust.")


def score_system_power(racket: dict, s: dict, p: PlayerContext,
                       tension: Optional[float] = None):
    rp, sp = racket_power_index(racket), string_power_index(s, tension)
    system = rp * SYSTEM_FRAME_WEIGHT + sp * SYSTEM_STRING_WEIGHT
    target = target_system_power(racket, p)
    gap = abs(system - target)
    score = max(0.0, 1.0 - gap / 2.2)       # band is ~2.45 wide, so scale to it

    reason = warning = None
    if gap <= 1.0:
        reason = (f"System power {system:.1f}/10 sits on target {target:.1f} — "
                  f"the string balances this frame rather than over-driving it.")
    elif system > target + 2.0:
        warning = (f"Over-powered pairing (system {system:.1f} vs target "
                   f"{target:.1f}): expect shuttles running long on clears.")
    elif system < target - 2.0:
        warning = (f"Under-powered pairing (system {system:.1f} vs target "
                   f"{target:.1f}): you'll be working hard for depth.")
    return score, reason, warning


def score_feel_balance(racket: dict, s: dict, p: PlayerContext):
    """
    Stiff shaft + hard string = a harsh, unforgiving string bed and the classic
    tennis-elbow combination. Flexible shaft + soft string = mush with no
    feedback. The comfortable pairings sit on the diagonal: flex + feel ~= 7
    on a 1-6 / 1-5 pair of scales.

    Advanced players tolerate harsh combos deliberately, so the penalty is
    scaled down as skill rises.
    """
    flex = _norm(racket.get("flex"), FLEX_SCALE, 3.0)     # 1-6
    feel = s.get("feelScale") or 3                        # 1-5 (1 soft, 5 hard)
    ideal = 7.0
    deviation = abs((flex + feel) - ideal)
    tolerance = 1.0 + (p.skill_rank - 1) * 0.6
    score = max(0.0, 1.0 - max(0.0, deviation - tolerance) / 3.0)

    reason = warning = None
    if deviation <= 1.0:
        reason = f"Feel is well matched ({racket.get('flex')} shaft + {s.get('feel').lower()} string)."
    elif flex >= 5 and feel >= 4:
        warning = ("Stiff shaft plus a hard string — harsh on off-centre hits "
                   "and the highest-risk combination for elbow and shoulder strain.")
    elif flex <= 2 and feel <= 2:
        warning = "Flexible shaft plus a soft string — likely to feel vague, with little feedback."
    return score, reason, warning


def score_durability(racket: dict, s: dict, p: PlayerContext):
    """
    Demand side: frame power, attacking intent, and court hours.
    Supply side: the string's durability rating and gauge.
    """
    rp = racket_power_index(racket)
    demand = (rp / 10.0) * 3.0 + ((p.offense - 1) / 5.0) * 4.0 + min(3.0, p.hours_per_week / 2.0)
    if p.known_string_breaker:
        demand += 1.5
    supply = (s.get("durability") or 6) + ((s.get("gaugeMm") or 0.66) - 0.63) * 10.0

    penalty_scale = {"low": 1.4, "normal": 1.0, "high": 0.45}.get(p.restring_tolerance, 1.0)
    score = max(0.0, min(1.0, 1.0 - (demand - supply) * penalty_scale / 6.0))
    hours = estimate_restring_hours(s, demand)

    reason = warning = None
    if score >= 0.75:
        reason = f"Durability holds up: roughly {hours:.0f} hours of play per restring."
    elif score >= 0.45:
        reason = f"Moderate lifespan — roughly {hours:.0f} hours per restring."
    else:
        warning = (f"High breakage risk: roughly {hours:.0f} hours per restring "
                   f"(about {hours / max(p.hours_per_week, 0.5):.1f} weeks at your play rate).")
    return score, reason, warning


def estimate_restring_hours(s: dict, demand: float) -> float:
    """Rough playing-hours-to-breakage. Calibrated so BG65 under average demand
    lands near 35h and Aerosonic near 6h — matches club-stringer rules of thumb."""
    base = 4.0 + (s.get("durability") or 6) * 3.6
    return max(3.0, base * (1.0 - (demand - 5.0) * 0.07))


TIER_STRING_BUDGET = {          # (floor, ideal, ceiling) USD per 10m set
    "Premium": (12, 17, 24),
    "Mid-range": (9, 13, 19),
    "Entry-level": (6, 10, 15),
}


def score_value(racket: dict, s: dict, p: PlayerContext):
    """
    Spend fit, keyed to frame TIER rather than a raw price ratio.

    CALIBRATION NOTE: a pure percentage-of-frame-price rule rated a $12
    training string on a $235 flagship as "proportionate". It isn't — thick
    budget strings flatten exactly the feel a premium frame was bought for.
    Under-spending on a premium frame is now penalised as hard as over-spending
    on an entry one.
    """
    tier = racket.get("tier") or "Mid-range"
    lo, ideal, hi = TIER_STRING_BUDGET.get(tier, TIER_STRING_BUDGET["Mid-range"])
    if p.budget_sensitivity == "high":
        lo, ideal, hi = lo * 0.75, ideal * 0.78, hi * 0.85
    elif p.budget_sensitivity == "low":
        ideal, hi = ideal * 1.15, hi * 1.25

    s_price = ((s.get("priceSetUsdMin") or 12) + (s.get("priceSetUsdMax") or 12)) / 2
    span = max(hi - lo, 1)
    score = max(0.0, 1.0 - abs(s_price - ideal) / span)

    reason = warning = None
    if s_price < lo * 0.85 and tier == "Premium":
        warning = (f"Under-strung for the frame: a ${s_price:.0f} set on a {tier.lower()} "
                   f"racket flattens the feel you paid for.")
    elif s_price > hi * 1.15:
        warning = (f"Premium string (${s_price:.0f}/set) on a {tier.lower()} frame — "
                   f"the frame is the bigger lever.")
    elif score >= 0.65:
        reason = f"Spend fits a {tier.lower()} frame (${s_price:.0f}/set)."
    return score, reason, warning


def score_skill(s: dict, p: PlayerContext):
    diff = SKILL_RANK.get(s.get("skillLevel"), 2) - p.skill_rank
    if diff <= 0:
        return 1.0, None, None
    if diff == 1:
        return 0.6, None, f"Rated for {s.get('skillLevel').lower()} players — a step up from your current level."
    return 0.25, None, (f"Rated for {s.get('skillLevel').lower()} players — likely to break fast "
                        f"and give little back at your current level.")


# --------------------------------------------------------------------------
# Tension recommendation
# --------------------------------------------------------------------------

def recommend_tension(racket: dict, s: dict, p: PlayerContext) -> Optional[float]:
    """Place the player inside the overlapping window. Consistency of contact —
    grip mechanics plus movement — is what earns higher tension, because high
    tension shrinks the sweet spot."""
    r_hi = racket.get("tensionMaxLbs")
    if r_hi is None:
        return None
    lo = max(racket.get("tensionMinLbs") or 20, s.get("tensionMinLbs") or 20)
    hi = min(r_hi, s.get("tensionMaxLbs") or 26)
    if hi < lo:
        return None
    consistency = ((p.grip + p.movement) / 2.0 - 1) / 5.0   # 0..1
    return round((lo + (hi - lo) * min(1.0, consistency * 0.9 + 0.1)) * 2) / 2


# --------------------------------------------------------------------------
# Orchestration
# --------------------------------------------------------------------------

WEIGHTS = {
    "tension_fit": 20,
    "system_power": 30,
    "feel_balance": 20,
    "durability_demand": 20,
    "value_fit": 10,
}
SKILL_MULTIPLIER_FLOOR = 0.25   # skill gate multiplies the total, it doesn't add


@dataclass
class Pairing:
    racket: dict
    string: dict
    score: float
    recommended_tension: Optional[float]
    reasons: list = field(default_factory=list)
    warnings: list = field(default_factory=list)
    breakdown: dict = field(default_factory=dict)

    def pretty(self) -> str:
        head = (f"{self.score:5.1f}  {self.string['brand']:<8} {self.string['model']:<20} "
                f"{self.string['gaugeMm']:.2f}mm  {self.string['category']:<11}")
        t = f"@ {self.recommended_tension:.1f} lbs" if self.recommended_tension else "@ tension TBC"
        lines = [f"{head} {t}"]
        lines += [f"        + {r}" for r in self.reasons]
        lines += [f"        ! {w}" for w in self.warnings]
        return "\n".join(lines)


def pair(racket: dict, strings, player: PlayerContext = DEFAULT_PLAYER,
         top_n: int = 5, brand_match: bool = False) -> list:
    """Rank strings for one racket. brand_match=True restricts to same-brand
    strings (some clubs and pro shops stock one brand)."""
    pool = strings.values() if isinstance(strings, dict) else strings
    results = []

    for s in pool:
        if brand_match and s.get("brand") != racket.get("brand"):
            continue

        parts, reasons, warnings = {}, [], []

        t_score, t_reason, t_warn = score_tension(racket, s)
        if t_score is None:                       # hard gate
            continue
        parts["tension_fit"] = t_score

        # Tension is resolved BEFORE the power scorer, because a string's power
        # contribution depends on the tension it will actually be strung at.
        tension = recommend_tension(racket, s, player)

        for name, (sc, rs, wn) in {
            "system_power": score_system_power(racket, s, player, tension),
            "feel_balance": score_feel_balance(racket, s, player),
            "durability_demand": score_durability(racket, s, player),
            "value_fit": score_value(racket, s, player),
        }.items():
            parts[name] = sc
            if rs:
                reasons.append(rs)
            if wn:
                warnings.append(wn)

        for msg, bucket in ((t_reason, reasons), (t_warn, warnings)):
            if msg:
                bucket.append(msg)

        sk_score, _, sk_warn = score_skill(s, player)
        if sk_warn:
            warnings.append(sk_warn)

        total = sum(parts[k] * w for k, w in WEIGHTS.items())
        total *= max(SKILL_MULTIPLIER_FLOOR, sk_score)

        if s.get("ratingSource") == "Consensus estimate":
            warnings.append("Performance ratings are community consensus, not manufacturer-published.")

        results.append(Pairing(
            racket=racket, string=s, score=round(total, 1),
            recommended_tension=tension,
            reasons=reasons, warnings=warnings,
            breakdown={k: round(v, 3) for k, v in parts.items()} | {"skill_multiplier": sk_score},
        ))

    results.sort(key=lambda r: (-r.score, r.string["model"]))
    return results[:top_n]


def load(racket_path: str, string_path: str):
    with open(racket_path) as f:
        rackets = {r["id"]: r for r in json.load(f)}
    with open(string_path) as f:
        strings = {s["id"]: s for s in json.load(f)}
    return rackets, strings


if __name__ == "__main__":
    import sys
    rp = sys.argv[1] if len(sys.argv) > 1 else "racket_database.json"
    sp = sys.argv[2] if len(sys.argv) > 2 else "badminton_string_database.json"
    rackets, strings = load(rp, sp)
    me = PlayerContext(grip=4, movement=3, serve=3, offense=4, defence=3,
                       strategy=4, sessions_per_week=1.5)
    for rid, racket in rackets.items():
        print(f"\n=== {racket['brand']} {racket['model']} "
              f"({racket['balance']}, {racket['flex']}) ===")
        for rec in pair(racket, strings, me, top_n=3):
            print(rec.pretty())
