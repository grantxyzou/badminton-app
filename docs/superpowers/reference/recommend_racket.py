"""
Racket recommendation engine for BPM.

Takes a player profile (the 14 skill scores from the check-in, plus format and
budget) and returns ranked racket recommendations with human-readable reasoning.

Design philosophy: AMPLIFY STRENGTHS, don't patch weaknesses.
Equipment is a poor tool for fixing technique — a racket that fights a player's
natural game gets abandoned. Weakness-fixing belongs in drills, not gear.

Usage:
    from recommend_racket import PlayerProfile, recommend

    profile = PlayerProfile(
        serves=3, net_play=3, clears=3, drops=2, drives=3, smashes=3, grip=3,
        footwork=2, court_coverage=4, stamina=3,
        game_reading=3, consistency=3, rules=3, mindset=2,
        format="doubles",
        budget_max_usd=180,
        current_racket_id="li-ning-halbertec-5000",   # optional
    )
    for rec in recommend(profile, top_n=5):
        print(rec.model, rec.score, rec.reasons)

Run directly for a demo:
    python3 recommend_racket.py
"""

from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
import json
import os

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "racket_database.json")


# ---------------------------------------------------------------------------
# Player profile
# ---------------------------------------------------------------------------

@dataclass
class PlayerProfile:
    """All skill scores are 1-5, matching the BPM check-in scale."""

    # Technical
    serves: int = 3
    net_play: int = 3
    clears: int = 3
    drops: int = 3
    drives: int = 3
    smashes: int = 3
    grip: int = 3

    # Physical
    footwork: int = 3
    court_coverage: int = 3
    stamina: int = 3

    # Mental
    game_reading: int = 3
    consistency: int = 3
    rules: int = 3
    mindset: int = 3

    # Context (NOT inferable from skill scores — must be asked)
    format: str = "both"              # "singles" | "doubles" | "both"
    budget_max_usd: Optional[float] = None
    budget_min_usd: Optional[float] = None
    current_racket_id: Optional[str] = None
    grip_size_pref: Optional[str] = None   # e.g. "G5"

    # ---- derived category averages ----
    @property
    def technical(self) -> float:
        return (self.serves + self.net_play + self.clears + self.drops
                + self.drives + self.smashes + self.grip) / 7

    @property
    def physical(self) -> float:
        return (self.footwork + self.court_coverage + self.stamina) / 3

    @property
    def mental(self) -> float:
        return (self.game_reading + self.consistency + self.rules + self.mindset) / 4

    @property
    def overall(self) -> float:
        return (self.technical + self.physical + self.mental) / 3

    @property
    def skill_level(self) -> str:
        """Maps overall score to the tier a player can actually handle."""
        o = self.overall
        if o < 2.5:
            return "Beginner"
        if o < 3.75:
            return "Intermediate"
        return "Advanced"

    @property
    def power_bias(self) -> float:
        """
        How much this player's game leans on power vs. speed/touch.
        Positive = power-oriented, negative = speed-oriented.
        """
        power_side = (self.smashes + self.clears) / 2
        speed_side = (self.drives + self.net_play) / 2
        return power_side - speed_side

    @property
    def control_bias(self) -> float:
        """How much the player's game rewards touch/placement."""
        touch = (self.drops + self.grip + self.game_reading) / 3
        raw = (self.smashes + self.drives) / 2
        return touch - raw


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

@dataclass
class Recommendation:
    id: str
    brand: str
    model: str
    score: float
    reasons: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    racket: Dict[str, Any] = field(default_factory=dict)


# How demanding each flex rating is — a player needs the technique to load it.
FLEX_DEMAND = {
    "Flexible": 1,
    "Medium": 2,
    "Medium-Stiff": 3,
    "Stiff": 4,
    "Extra Stiff": 5,
}

# Consistency + grip technique determine how much stiffness a player can use.
def _max_flex_demand(profile: PlayerProfile) -> int:
    technique = (profile.consistency + profile.grip + profile.smashes) / 3
    if technique <= 2.0:
        return 2      # Medium at most
    if technique <= 3.0:
        return 3      # Medium-Stiff at most
    if technique <= 4.0:
        return 4      # Stiff at most
    return 5          # anything


def _score_flex(racket: dict, profile: PlayerProfile) -> tuple:
    """Stiffer shafts need faster, more consistent swings to load properly."""
    demand = FLEX_DEMAND.get(racket["flex"], 3)
    ceiling = _max_flex_demand(profile)
    reasons, warnings = [], []

    if demand > ceiling:
        # Too demanding — heavily penalised, and flagged (injury/frustration risk)
        gap = demand - ceiling
        warnings.append(
            f"{racket['flex']} shaft is demanding for your current consistency "
            f"({profile.consistency}/5) — mishits will feel harsh"
        )
        return -8.0 * gap, reasons, warnings

    if demand == ceiling:
        reasons.append(f"{racket['flex']} shaft matches your technique level")
        return 10.0, reasons, warnings

    if demand == ceiling - 1:
        reasons.append(f"{racket['flex']} shaft gives you comfortable headroom")
        return 7.0, reasons, warnings

    # Much softer than the player can handle — usable but they'll outgrow it
    return 3.0, reasons, warnings


def _score_balance(racket: dict, profile: PlayerProfile) -> tuple:
    """Match head weight to whether the player's game is power- or speed-led."""
    bal = racket["balance"]
    bias = profile.power_bias
    reasons, warnings = [], []

    if bias >= 0.5:  # power-oriented player
        if bal == "Head-heavy":
            reasons.append(
                f"Head-heavy suits your power game (smash {profile.smashes}/5, "
                f"clears {profile.clears}/5)"
            )
            return 10.0, reasons, warnings
        if bal == "Even":
            return 5.0, reasons, warnings
        return 1.0, reasons, warnings

    if bias <= -0.5:  # speed-oriented player
        if bal == "Head-light":
            reasons.append(
                f"Head-light suits your fast game (drives {profile.drives}/5, "
                f"net {profile.net_play}/5)"
            )
            return 10.0, reasons, warnings
        if bal == "Even":
            return 5.0, reasons, warnings
        return 1.0, reasons, warnings

    # balanced player
    if bal == "Even":
        reasons.append("Even balance suits your all-round game")
        return 10.0, reasons, warnings
    return 6.0, reasons, warnings


def _score_weight(racket: dict, profile: PlayerProfile) -> tuple:
    """Low stamina/footwork means a heavy frame will fatigue the player."""
    wmax = racket.get("weightMaxG") or 85
    endurance = (profile.stamina + profile.footwork) / 2
    reasons, warnings = [], []

    if endurance <= 2.5:
        if wmax <= 84:
            reasons.append("Lighter frame won't fatigue you over long sessions")
            return 10.0, reasons, warnings
        warnings.append(
            f"At up to {int(wmax)}g this may tire your arm "
            f"(stamina {profile.stamina}/5, footwork {profile.footwork}/5)"
        )
        return -3.0, reasons, warnings

    if endurance >= 4.0:
        # strong player can handle anything; slight nod to heavier for power
        return 8.0 if wmax >= 85 else 6.0, reasons, warnings

    return 7.0 if wmax <= 88 else 4.0, reasons, warnings


def _score_category(racket: dict, profile: PlayerProfile) -> tuple:
    """Amplify the player's strongest dimension."""
    cat = racket["category"]
    reasons, warnings = [], []

    scores = {
        "Power": (profile.smashes + profile.clears) / 2,
        "Speed": (profile.drives + profile.net_play) / 2,
        "Control": (profile.drops + profile.grip + profile.game_reading) / 3,
        "All-round": profile.technical,
    }
    best = max(scores, key=scores.get)
    spread = max(scores.values()) - min(scores.values())

    if spread < 0.6:
        # No clear strength — all-round is the safe call
        if cat == "All-round":
            reasons.append("All-round frame fits your balanced skill profile")
            return 10.0, reasons, warnings
        return 6.0, reasons, warnings

    if cat == best:
        reasons.append(f"{cat} frame amplifies your strongest area ({scores[best]:.1f}/5)")
        return 10.0, reasons, warnings
    if cat == "All-round":
        return 6.0, reasons, warnings
    return 3.0, reasons, warnings


def _score_format(racket: dict, profile: PlayerProfile) -> tuple:
    """Singles vs doubles is one of the biggest determinants of racket choice."""
    sub = racket.get("subType")
    bal = racket["balance"]
    reasons, warnings = [], []

    if profile.format == "doubles":
        if sub == "doubles":
            reasons.append("Purpose-built for doubles")
            return 10.0, reasons, warnings
        if bal == "Head-light":
            reasons.append("Head-light frames excel in doubles' fast exchanges")
            return 8.0, reasons, warnings
        if bal == "Even":
            return 5.0, reasons, warnings
        return 2.0, reasons, warnings

    if profile.format == "singles":
        if bal == "Head-heavy":
            reasons.append("Head-heavy suits singles' rear-court rallies")
            return 9.0, reasons, warnings
        if bal == "Even":
            reasons.append("Even balance handles singles' varied court positions")
            return 7.0, reasons, warnings
        return 4.0, reasons, warnings

    # "both" — reward versatility
    if bal == "Even" or sub == "all-round" or racket["category"] == "All-round":
        reasons.append("Versatile enough for both singles and doubles")
        return 9.0, reasons, warnings
    return 6.0, reasons, warnings


def _score_skill_tier(racket: dict, profile: PlayerProfile) -> tuple:
    """Don't recommend a pro frame to a beginner, or a beginner frame to a pro."""
    tier = racket["tier"]
    level = profile.skill_level
    reasons, warnings = [], []

    fit = {
        ("Beginner", "Entry-level"): 10.0,
        ("Beginner", "Mid-range"): 5.0,
        ("Beginner", "Premium"): -5.0,
        ("Intermediate", "Entry-level"): 4.0,
        ("Intermediate", "Mid-range"): 10.0,
        ("Intermediate", "Premium"): 7.0,
        ("Advanced", "Entry-level"): 0.0,
        ("Advanced", "Mid-range"): 6.0,
        ("Advanced", "Premium"): 10.0,
    }
    score = fit.get((level, tier), 5.0)

    if score >= 10.0:
        reasons.append(f"{tier} tier matches your {level.lower()} skill level")
    elif score < 0:
        warnings.append(f"{tier} frames are unforgiving at {level.lower()} level")

    return score, reasons, warnings


def _score_budget(racket: dict, profile: PlayerProfile) -> tuple:
    """Hard filter is applied separately; this rewards good value within budget."""
    reasons, warnings = [], []
    if profile.budget_max_usd is None:
        return 5.0, reasons, warnings

    pmin = racket.get("priceMinUSD")
    if pmin is None:
        return 5.0, reasons, warnings

    budget = profile.budget_max_usd
    # Reward rackets using 60-100% of budget (getting value without overspending)
    ratio = pmin / budget
    if ratio > 1.0:
        return -20.0, reasons, warnings   # over budget, effectively excluded
    if ratio >= 0.6:
        reasons.append(f"Good use of your ${int(budget)} budget")
        return 10.0, reasons, warnings
    if ratio >= 0.35:
        return 7.0, reasons, warnings
    return 4.0, reasons, warnings         # very cheap relative to budget


# Weights control how much each dimension matters in the final score.
WEIGHTS = {
    "flex": 1.4,        # highest — wrong flex causes injury/frustration
    "balance": 1.3,
    "category": 1.2,
    "format": 1.2,
    "skill_tier": 1.1,
    "weight": 1.0,
    "budget": 0.9,
}


def score_racket(racket: dict, profile: PlayerProfile) -> Recommendation:
    """Score a single racket against a profile. Returns a Recommendation."""
    total = 0.0
    all_reasons, all_warnings = [], []

    scorers = {
        "flex": _score_flex,
        "balance": _score_balance,
        "weight": _score_weight,
        "category": _score_category,
        "format": _score_format,
        "skill_tier": _score_skill_tier,
        "budget": _score_budget,
    }

    for name, fn in scorers.items():
        s, reasons, warnings = fn(racket, profile)
        total += s * WEIGHTS[name]
        all_reasons.extend(reasons)
        all_warnings.extend(warnings)

    # Normalise to a rough 0-100 scale for readability
    max_possible = sum(10.0 * w for w in WEIGHTS.values())
    normalised = round(max(0.0, total) / max_possible * 100, 1)

    return Recommendation(
        id=racket["id"],
        brand=racket["brand"],
        model=racket["model"],
        score=normalised,
        reasons=all_reasons,
        warnings=all_warnings,
        racket=racket,
    )


def recommend(
    profile: PlayerProfile,
    top_n: int = 5,
    db_path: str = DB_PATH,
    exclude_current: bool = True,
) -> List[Recommendation]:
    """Return the top_n rackets for this player, best first."""
    with open(db_path) as f:
        rackets = json.load(f)

    results = []
    for r in rackets:
        # Hard filters
        if exclude_current and profile.current_racket_id and r["id"] == profile.current_racket_id:
            continue
        if profile.budget_max_usd is not None:
            pmin = r.get("priceMinUSD")
            if pmin is not None and pmin > profile.budget_max_usd:
                continue
        if profile.budget_min_usd is not None:
            pmax = r.get("priceMaxUSD")
            if pmax is not None and pmax < profile.budget_min_usd:
                continue

        results.append(score_racket(r, profile))

    results.sort(key=lambda x: x.score, reverse=True)
    return results[:top_n]


# ---------------------------------------------------------------------------
# Demo
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # Profile taken from the BPM check-in screenshots
    profile = PlayerProfile(
        serves=3, net_play=3, clears=3, drops=2, drives=3, smashes=3, grip=3,
        footwork=2, court_coverage=4, stamina=3,
        game_reading=3, consistency=3, rules=3, mindset=2,
        format="doubles",
        budget_max_usd=180,
        current_racket_id="li-ning-halbertec-5000",
    )

    print("=" * 68)
    print("PLAYER PROFILE")
    print("=" * 68)
    print(f"  Technical {profile.technical:.1f} | Physical {profile.physical:.1f} "
          f"| Mental {profile.mental:.1f}  ->  Overall {profile.overall:.1f}")
    print(f"  Skill level : {profile.skill_level}")
    print(f"  Power bias  : {profile.power_bias:+.1f}  "
          f"(positive = power-led, negative = speed-led)")
    print(f"  Format      : {profile.format}   Budget: ${profile.budget_max_usd:.0f}")
    print()

    print("=" * 68)
    print("TOP RECOMMENDATIONS")
    print("=" * 68)
    for i, rec in enumerate(recommend(profile, top_n=5), 1):
        price = rec.racket.get("priceMinUSD")
        pmax = rec.racket.get("priceMaxUSD")
        price_str = f"${price:.0f}-{pmax:.0f}" if price else "n/a"
        print(f"\n{i}. {rec.brand} {rec.model}  —  {rec.score}/100   {price_str}")
        print(f"   {rec.racket['category']} | {rec.racket['balance']} | "
              f"{rec.racket['flex']} | {rec.racket['tier']}")
        for reason in rec.reasons:
            print(f"   + {reason}")
        for warning in rec.warnings:
            print(f"   ! {warning}")
