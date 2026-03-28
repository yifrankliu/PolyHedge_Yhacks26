import numpy as np
from typing import List, Dict


def compute_payoff_curve(
    entry_price: float,
    position_size: float,
    num_points: int = 101,
) -> List[Dict[str, float]]:
    """
    Generate payoff curve for a YES position on a binary prediction market.

    entry_price: market price (0–1, e.g. 0.65 for 65¢)
    position_size: dollars risked (cost basis)
    Returns list of {probability, pnl} across 0–100%.
    """
    contracts = position_size / entry_price
    curve = []
    for i in range(num_points):
        p = i / (num_points - 1)  # 0.0 → 1.0
        pnl = contracts * (p - entry_price)
        curve.append({"probability": round(p * 100, 1), "pnl": round(pnl, 4)})
    return curve


def kelly_fraction(user_prob: float, market_price: float) -> float:
    """f* = (p_user - p_market) / (1 - p_market)"""
    if market_price >= 1.0:
        return 0.0
    return (user_prob - market_price) / (1.0 - market_price)


def annualized_return(entry_price: float, days: int) -> float:
    """((1 / entry_price)^(365 / days) - 1) * 100"""
    if entry_price <= 0 or days <= 0:
        return 0.0
    return ((1.0 / entry_price) ** (365.0 / days) - 1.0) * 100.0


def max_profit(entry_price: float, position_size: float) -> float:
    """position_size * (1/entry_price - 1)"""
    return position_size * (1.0 / entry_price - 1.0)


def breakeven_probability(entry_price: float) -> float:
    """Breakeven = entry_price (in %)"""
    return entry_price * 100.0
