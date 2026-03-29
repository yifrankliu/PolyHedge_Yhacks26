"""
Hedge strategy engine.

Given a user's single prediction market position and a set of correlated
candidate markets (from the correlation pipeline), computes:
  - Minimum-variance hedge ratio (h*)
  - BL-adjusted hedge ratio (crypto positions only)
  - Composite hedge confidence score
"""
import numpy as np


def bl_confidence(bl_result: dict, threshold: float, T_days: float, bl_divergence: float) -> float:
    """
    0–1 quality gate for the BL signal.
    Returns 0.0 if the signal is unusable; higher = more trustworthy.
    """
    lo, hi = bl_result.get("strike_range", [0, 0])

    # Critical gates — unusable if failed
    if not (lo < threshold < hi):
        return 0.0
    if bl_result.get("strikes_used", 0) < 10:
        return 0.0

    # Time-to-expiry factor (optimal 14–180 days)
    if T_days < 7:
        t_factor = 0.1
    elif T_days < 14:
        t_factor = 0.5
    elif T_days <= 180:
        t_factor = 1.0
    else:
        t_factor = max(0.4, 1.0 - (T_days - 180) / 360)

    # Strike density factor
    range_width = max(hi - lo, 1.0)
    density = bl_result.get("strikes_used", 0) / (range_width / 1000)
    density_factor = min(1.0, density / 10.0)

    # Signal strength (full score at 10pp divergence)
    signal_factor = min(1.0, abs(bl_divergence) / 0.10)

    return round(t_factor * 0.35 + density_factor * 0.35 + signal_factor * 0.30, 3)


def compute_hedge_ratio(
    full_pearson_returns: float,
    sigma_a: float,
    sigma_b: float,
    rolling_std: float,
    break_detected: bool,
    position_size: float,
    direction: str,
    bl_divergence: float | None = None,
    bl_conf: float | None = None,
) -> dict:
    """
    Minimum-variance hedge ratio: h* = -rho * (sigma_A / sigma_B)

    direction: "YES" or "NO" — the side the user is holding
    bl_divergence: P_BL - P_current_market_price (positive = PM underpriced vs Deribit)
    bl_conf: BL confidence score (0–1); adjustment only applied if > 0.3
    """
    if sigma_b < 1e-8 or sigma_a < 1e-8:
        # Can't compute ratio if either market is flat
        hedge_dir = "NO" if direction == "YES" else "YES"
        return {
            "hedge_ratio": 0.0,
            "recommended_size": 0.0,
            "hedge_direction": hedge_dir,
            "bl_adjustment": 1.0,
            "stability_discounted": False,
        }

    rho = full_pearson_returns
    raw_h = -rho * (sigma_a / sigma_b)

    # Stability discount: halve the hedge if correlation is unstable
    stability_discounted = rolling_std > 0.3 or break_detected
    stability_discount = 0.5 if stability_discounted else 1.0
    h = float(np.clip(raw_h * stability_discount, -1.0, 1.0))

    # BL adjustment: reduce hedge if position has more edge, increase if overpriced
    bl_adjustment = 1.0
    if bl_divergence is not None and bl_conf is not None and bl_conf > 0.3:
        direction_sign = 1 if direction == "YES" else -1
        # If long YES and BL > PM (bl_div > 0): position has more edge → reduce hedge
        # If long YES and BL < PM (bl_div < 0): market overpriced → increase hedge
        adj = float(np.clip(-bl_divergence * direction_sign * 2.0, -0.3, 0.3))
        bl_adjustment = 1.0 + adj
        h = float(np.clip(h * bl_adjustment, -1.0, 1.0))

    # Hedge direction: h*position_sign < 0 means take opposite side
    position_sign = 1 if direction == "YES" else -1
    hedge_direction = "NO" if (h * position_sign) < 0 else "YES"

    return {
        "hedge_ratio": round(abs(h), 4),
        "recommended_size": round(abs(h) * position_size, 2),
        "hedge_direction": hedge_direction,
        "bl_adjustment": round(bl_adjustment, 4),
        "stability_discounted": stability_discounted,
    }


def composite_hedge_score(
    corr_composite: float,
    shared_history_days: float,
    bl_confidence_score: float | None = None,
    bl_divergence: float | None = None,
) -> tuple[float, str, list[str]]:
    """
    Returns (score 0–1, confidence_label, caveats list).

    Weights:
      With BL:    correlation 50%, history 20%, BL 30%
      Without BL: correlation 65%, history 35%
    """
    history_component = min(1.0, shared_history_days / 60.0)
    has_bl = bl_confidence_score is not None and bl_confidence_score > 0

    if has_bl:
        bl_component = bl_confidence_score * min(1.0, abs(bl_divergence or 0.0) / 0.10)
        score = corr_composite * 0.50 + history_component * 0.20 + bl_component * 0.30
    else:
        score = corr_composite * 0.65 + history_component * 0.35

    score = round(float(np.clip(score, 0.0, 1.0)), 3)

    if score > 0.70:
        label = "High confidence"
    elif score > 0.45:
        label = "Moderate confidence"
    else:
        label = "Weak signal"

    caveats: list[str] = []
    if shared_history_days < 21:
        caveats.append("Short shared history — correlation may not be reliable")
    if has_bl and bl_confidence_score < 0.4:
        caveats.append("BL signal weak — options data thin for this expiry/strike")

    return score, label, caveats
