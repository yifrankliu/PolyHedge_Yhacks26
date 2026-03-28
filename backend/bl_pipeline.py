"""
Breeden-Litzenberger pipeline: extract risk-neutral density from Deribit options.

Pipeline:
  1. Fetch OTM options with mark_iv from Deribit for given expiry
  2. Fit smoothing spline to (strike, IV) curve
  3. Evaluate spline on dense strike grid → IV(K)
  4. Convert IV(K) → call price C(K) via Black-Scholes
  5. d²C/dK² × e^(rT) = Risk-Neutral Density
  6. Normalize RND
  7. Integrate RND above threshold → P(S_T > threshold)
"""

import asyncio
import numpy as np
from scipy.stats import norm
from scipy.interpolate import UnivariateSpline
from scipy.optimize import brentq
from datetime import datetime
from typing import Optional
import httpx


DERIBIT_BASE = "https://www.deribit.com/api/v2/public"
RISK_FREE_RATE = 0.045  # approximate USD risk-free rate


# ── Black-Scholes ──────────────────────────────────────────────────────────────

def bs_call(S: float, K: float, T: float, r: float, sigma: float) -> float:
    if sigma <= 0 or T <= 0:
        return max(S - K, 0.0)
    d1 = (np.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * np.sqrt(T))
    d2 = d1 - sigma * np.sqrt(T)
    return float(S * norm.cdf(d1) - K * np.exp(-r * T) * norm.cdf(d2))


def implied_vol(price: float, S: float, K: float, T: float, r: float) -> Optional[float]:
    intrinsic = max(S - K, 0.0)
    if price <= intrinsic + 1e-6:
        return None
    try:
        return brentq(lambda s: bs_call(S, K, T, r, s) - price, 1e-4, 10.0, maxiter=200)
    except Exception:
        return None


# ── Deribit helpers ────────────────────────────────────────────────────────────

def date_to_deribit_expiry(date_str: str) -> str:
    """'2026-06-26' → '26JUN26' (Deribit uses non-zero-padded days: '1APR26' not '01APR26')"""
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    return f"{dt.day}{dt.strftime('%b').upper()}{dt.strftime('%y')}"


async def fetch_spot(asset: str) -> float:
    index = f"{asset.lower()}_usd"
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{DERIBIT_BASE}/get_index_price",
            params={"index_name": index},
        )
    resp.raise_for_status()
    return float(resp.json()["result"]["index_price"])


async def fetch_options_for_expiry(asset: str, expiry_str: str) -> list[dict]:
    """
    Fetch all options for given expiry from Deribit book summary.
    Returns list of dicts with keys: strike, iv, option_type, instrument_name.
    expiry_str: Deribit format e.g. '27JUN25'
    """
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{DERIBIT_BASE}/get_book_summary_by_currency",
            params={"currency": asset.upper(), "kind": "option"},
        )
    resp.raise_for_status()
    summaries = resp.json()["result"]

    results = []
    for s in summaries:
        name = s.get("instrument_name", "")
        parts = name.split("-")
        # format: BTC-27JUN25-90000-C
        if len(parts) != 4:
            continue
        if parts[1] != expiry_str:
            continue
        mark_iv = s.get("mark_iv")
        if mark_iv is None or mark_iv <= 0:
            continue
        try:
            strike = float(parts[2])
        except ValueError:
            continue
        option_type = parts[3]  # "C" or "P"
        results.append({
            "strike": strike,
            "iv": mark_iv / 100.0,  # Deribit returns %, convert to decimal
            "option_type": option_type,
            "instrument_name": name,
        })

    return sorted(results, key=lambda x: x["strike"])


# ── BL Core ────────────────────────────────────────────────────────────────────

def run_bl(
    options: list[dict],
    spot: float,
    T: float,
    threshold: float,
    r: float = RISK_FREE_RATE,
    n_grid: int = 500,
) -> dict:
    """
    Run Breeden-Litzenberger pipeline.
    Returns: prob, rnd_curve [{strike, density}], strikes used, any warnings.
    """
    # Prefer OTM options for cleaner IV smile; fall back to all options if too few
    otm = [
        o for o in options
        if (o["option_type"] == "C" and o["strike"] >= spot * 0.8) or
           (o["option_type"] == "P" and o["strike"] <= spot * 1.2)
    ]
    working_set = otm if len(otm) >= 5 else options

    if len(working_set) < 5:
        raise ValueError(f"Not enough options ({len(options)}) for expiry — try a different date.")

    strikes_raw = np.array([o["strike"] for o in working_set])
    ivs_raw = np.array([o["iv"] for o in working_set])

    # Deduplicate: if both C and P at same strike, average IVs
    unique_strikes, indices = np.unique(strikes_raw, return_inverse=True)
    unique_ivs = np.array([ivs_raw[indices == i].mean() for i in range(len(unique_strikes))])

    if len(unique_strikes) < 5:
        raise ValueError("Not enough unique strikes for spline fit.")

    # Fit smoothing spline to IV smile
    try:
        spline = UnivariateSpline(unique_strikes, unique_ivs, k=3, s=len(unique_strikes))
    except Exception as e:
        raise ValueError(f"Spline fit failed: {e}")

    # Generate dense strike grid covering the smile range with padding
    K_min = max(unique_strikes.min() * 0.9, spot * 0.3)
    K_max = min(unique_strikes.max() * 1.1, spot * 3.0)
    K_grid = np.linspace(K_min, K_max, n_grid)

    # Evaluate IV at each grid point (clip to reasonable range)
    iv_grid = np.clip(spline(K_grid), 0.01, 5.0)

    # Convert to call prices via Black-Scholes
    call_prices = np.array([bs_call(spot, K, T, r, iv) for K, iv in zip(K_grid, iv_grid)])

    # Second derivative of call price w.r.t. strike = RND * e^(-rT)
    # Use central differences on uniform grid
    dK = K_grid[1] - K_grid[0]
    d2C = np.gradient(np.gradient(call_prices, dK), dK)

    # RND = e^(rT) * d²C/dK²
    rnd = np.exp(r * T) * d2C

    # Clip negatives (numerical noise) and normalize
    rnd = np.clip(rnd, 0, None)
    total = np.trapezoid(rnd, K_grid)
    if total < 1e-10:
        raise ValueError("RND normalization failed (near-zero integral).")
    rnd_normalized = rnd / total

    # P(S_T > threshold) = ∫[threshold→∞] RND(K) dK
    mask = K_grid >= threshold
    if not mask.any():
        prob = 0.0
    elif mask.all():
        prob = 1.0
    else:
        prob = float(np.trapezoid(rnd_normalized[mask], K_grid[mask]))

    # Return RND curve (sampled at ~100 points for frontend)
    sample_idx = np.linspace(0, n_grid - 1, min(100, n_grid), dtype=int)
    rnd_curve = [
        {"strike": round(float(K_grid[i]), 0), "density": round(float(rnd_normalized[i]), 8)}
        for i in sample_idx
    ]

    return {
        "prob": round(prob, 4),
        "rnd_curve": rnd_curve,
        "strikes_used": len(unique_strikes),
        "strike_range": [round(float(unique_strikes.min()), 0), round(float(unique_strikes.max()), 0)],
    }


# ── Main entry point ──────────────────────────────────────────────────────────

async def bl_pipeline(asset: str, threshold: float, expiry: str) -> dict:
    """
    Full BL pipeline: fetch Deribit options → RND → probability above threshold.
    expiry: 'YYYY-MM-DD'
    """
    deribit_expiry = date_to_deribit_expiry(expiry)

    expiry_dt = datetime.strptime(expiry, "%Y-%m-%d")
    T = max((expiry_dt - datetime.utcnow()).days / 365.0, 1 / 365.0)

    spot, options = await asyncio.gather(
        fetch_spot(asset),
        fetch_options_for_expiry(asset, deribit_expiry),
    )

    result = run_bl(options, spot, T, threshold)
    result["spot"] = round(spot, 0)
    result["expiry_deribit"] = deribit_expiry
    result["T_years"] = round(T, 4)
    return result
