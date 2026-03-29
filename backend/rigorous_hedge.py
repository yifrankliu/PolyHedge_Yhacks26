"""
Rigorous(ish) hedge estimation for prediction markets.

This module intentionally avoids candidate-discovery logic so teams can
plug in their own search/ranking pipeline later.

Core idea:
1) Align two market histories
2) Compute logit returns
3) Select "spike" events in market A
4) Estimate robust event response in market B
5) Convert to a hedge ratio with uncertainty + stability metrics
"""
from __future__ import annotations

import numpy as np

try:
    from correlation import align_series, logit
except ImportError:  # Support package-style imports (e.g., backend.rigorous_hedge)
    from .correlation import align_series, logit


def _huber_beta(x: np.ndarray, y: np.ndarray, k: float = 1.345, max_iter: int = 25) -> float:
    """
    Robust slope estimate for y ~ beta * x (no intercept) using Huber IRLS.
    """
    denom = float(np.dot(x, x))
    if denom < 1e-12:
        return 0.0
    beta = float(np.dot(x, y) / denom)

    for _ in range(max_iter):
        resid = y - beta * x
        scale = float(1.4826 * np.median(np.abs(resid)) + 1e-8)
        u = resid / (k * scale)
        w = np.ones_like(u)
        mask = np.abs(u) > 1.0
        w[mask] = 1.0 / np.abs(u[mask])
        w_denom = float(np.sum(w * x * x))
        if w_denom < 1e-12:
            break
        beta_new = float(np.sum(w * x * y) / w_denom)
        if abs(beta_new - beta) < 1e-8:
            beta = beta_new
            break
        beta = beta_new
    return beta


def _bootstrap_beta_ci(x: np.ndarray, y: np.ndarray, n_boot: int = 250) -> tuple[float | None, float | None]:
    if len(x) < 15:
        return None, None
    n = len(x)
    betas = []
    for _ in range(n_boot):
        idx = np.random.randint(0, n, size=n)
        xb = x[idx]
        yb = y[idx]
        betas.append(_huber_beta(xb, yb))
    return float(np.percentile(betas, 2.5)), float(np.percentile(betas, 97.5))


def rigorous_event_hedge(
    history_a: list[dict],
    history_b: list[dict],
    *,
    spike_quantile: float = 0.75,
    max_events: int = 100,
    min_events: int = 8,
    min_shared_days: int = 20,
) -> dict:
    """
    Returns robust event-study hedge metrics for A hedged with B.

    Output includes:
      - event_beta_b_on_a: robust sensitivity of B moves to A moves
      - event_mean_ratio: E[dB / dA] on spikes
      - event_mad_ratio: mean abs dev around ratio mean (volatility proxy)
      - hedge_ratio: recommended B notional for 1x A notional
      - confidence: 0-1 quality indicator
    """
    sa, sb = align_series(history_a, history_b)
    if len(sa) < min_shared_days:
        return {"error": f"Insufficient shared history ({len(sa)}d, need {min_shared_days}d)", "n_shared_days": int(len(sa))}

    pa = sa.values.astype(float)
    pb = sb.values.astype(float)
    ra = np.diff(logit(pa))
    rb = np.diff(logit(pb))

    mask = np.isfinite(ra) & np.isfinite(rb)
    ra = ra[mask]
    rb = rb[mask]

    if len(ra) < min_shared_days:
        return {"error": "Insufficient clean returns", "n_shared_days": int(len(sa))}

    abs_ra = np.abs(ra)
    q = float(np.clip(spike_quantile, 0.5, 0.99))
    threshold = float(np.quantile(abs_ra, q))
    event_idx = np.where(abs_ra >= threshold)[0]

    # Keep strongest moves if we have too many.
    if len(event_idx) > max_events:
        strongest = np.argsort(abs_ra[event_idx])[-max_events:]
        event_idx = event_idx[strongest]

    x = ra[event_idx]
    y = rb[event_idx]
    nonzero = np.abs(x) > 1e-8
    x = x[nonzero]
    y = y[nonzero]

    if len(x) < min_events:
        return {"error": f"Not enough spike events ({len(x)}, need {min_events})", "n_shared_days": int(len(sa)), "n_events": int(len(x))}

    # Legacy-style normalized points from your idea.
    ratios = y / x
    mean_ratio = float(np.mean(ratios))
    mad_ratio = float(np.mean(np.abs(ratios - mean_ratio)))

    # Robust event beta.
    beta_event = float(_huber_beta(x, y))
    beta_ci_lo, beta_ci_hi = _bootstrap_beta_ci(x, y)

    # Minimum-variance hedge ratio h*: A + h*B
    # Event-based estimate + all-sample shrinkage for stability.
    var_b_event = float(np.var(y, ddof=1))
    cov_ab_event = float(np.cov(x, y, ddof=1)[0, 1]) if len(x) > 1 else 0.0
    h_event = 0.0 if var_b_event < 1e-12 else -cov_ab_event / var_b_event

    var_b_full = float(np.var(rb, ddof=1))
    cov_ab_full = float(np.cov(ra, rb, ddof=1)[0, 1]) if len(ra) > 1 else 0.0
    h_full = 0.0 if var_b_full < 1e-12 else -cov_ab_full / var_b_full

    hedge_ratio = float(np.clip(0.7 * h_event + 0.3 * h_full, -2.0, 2.0))

    # Risk reduction proxy
    unhedged_std = float(np.std(ra, ddof=1))
    hedged_std = float(np.std(ra + hedge_ratio * rb, ddof=1))
    risk_reduction = 0.0 if unhedged_std < 1e-12 else max(0.0, 1.0 - hedged_std / unhedged_std)

    # Confidence score (0-1)
    n_factor = min(1.0, len(x) / 40.0)
    residual = y - beta_event * x
    resid_scale = float(np.std(residual, ddof=1))
    y_scale = float(np.std(y, ddof=1)) + 1e-8
    fit_factor = float(np.clip(1.0 - resid_scale / y_scale, 0.0, 1.0))
    ci_factor = 0.5
    if beta_ci_lo is not None and beta_ci_hi is not None:
        width = abs(beta_ci_hi - beta_ci_lo)
        ref = abs(beta_event) + 0.2
        ci_factor = float(np.clip(1.0 - (width / ref), 0.0, 1.0))
    stability_factor = float(np.clip(1.0 - mad_ratio, 0.0, 1.0))
    confidence = float(np.clip(
        0.30 * n_factor + 0.30 * fit_factor + 0.20 * ci_factor + 0.20 * stability_factor,
        0.0,
        1.0,
    ))

    notes = []
    if confidence < 0.35:
        notes.append("Low confidence: unstable event relationship")
    if len(x) < 20:
        notes.append("Limited spike sample size")
    if beta_ci_lo is not None and beta_ci_hi is not None and beta_ci_lo <= 0 <= beta_ci_hi:
        notes.append("Beta CI crosses zero")

    return {
        "n_shared_days": int(len(sa)),
        "n_returns": int(len(ra)),
        "n_events": int(len(x)),
        "spike_threshold_abs_return": threshold,
        "event_beta_b_on_a": round(beta_event, 6),
        "event_beta_ci_low": round(beta_ci_lo, 6) if beta_ci_lo is not None else None,
        "event_beta_ci_high": round(beta_ci_hi, 6) if beta_ci_hi is not None else None,
        "event_mean_ratio": round(mean_ratio, 6),
        "event_mad_ratio": round(mad_ratio, 6),
        "hedge_ratio": round(hedge_ratio, 6),
        "risk_reduction_estimate": round(risk_reduction, 6),
        "confidence": round(confidence, 6),
        "notes": notes,
    }
