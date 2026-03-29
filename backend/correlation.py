"""
Polymarket Market Correlation Pipeline
Statistical correlation between two Polymarket price history series.
"""
import warnings
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")


# ── Transforms ────────────────────────────────────────────────────────────────

def logit(p: np.ndarray) -> np.ndarray:
    p = np.clip(p, 0.001, 0.999)
    return np.log(p / (1 - p))


def logit_returns(p: np.ndarray) -> np.ndarray:
    return np.diff(logit(p))


# ── Alignment ─────────────────────────────────────────────────────────────────

def align_series(
    history_a: list[dict],  # [{t, p}]
    history_b: list[dict],
) -> tuple[pd.Series, pd.Series]:
    """
    Resample both histories to a common daily grid using LOCF.
    Returns two aligned pd.Series indexed by date.
    """
    def to_series(h):
        df = pd.DataFrame(h)
        df["date"] = pd.to_datetime(df["t"], unit="s").dt.normalize()
        return df.groupby("date")["p"].last()

    sa = to_series(history_a)
    sb = to_series(history_b)

    # Common date range
    start = max(sa.index.min(), sb.index.min())
    end   = min(sa.index.max(), sb.index.max())
    if start >= end:
        return pd.Series(dtype=float), pd.Series(dtype=float)

    grid = pd.date_range(start, end, freq="D")
    sa = sa.reindex(grid).ffill()
    sb = sb.reindex(grid).ffill()

    # Drop rows where either is NaN
    mask = sa.notna() & sb.notna()
    return sa[mask], sb[mask]


# ── Weighted Pearson ───────────────────────────────────────────────────────────

def weighted_pearson(x: np.ndarray, y: np.ndarray, w: np.ndarray | None = None) -> float:
    if w is None:
        w = np.ones(len(x))
    w = w / w.sum()
    mx = np.average(x, weights=w)
    my = np.average(y, weights=w)
    num   = np.sum(w * (x - mx) * (y - my))
    denom = np.sqrt(np.sum(w * (x - mx) ** 2) * np.sum(w * (y - my) ** 2))
    return float(num / denom) if denom > 1e-10 else 0.0


# ── Rolling Correlation ────────────────────────────────────────────────────────

def rolling_correlation(
    lx: np.ndarray,
    ly: np.ndarray,
    dates: pd.DatetimeIndex,
    window: int,
) -> list[dict]:
    """Returns [{t (unix), r, n_eff}] for each window position."""
    results = []
    n = len(lx)
    for i in range(window - 1, n):
        sl_x = lx[i - window + 1 : i + 1]
        sl_y = ly[i - window + 1 : i + 1]
        mask = np.isfinite(sl_x) & np.isfinite(sl_y)
        if mask.sum() < 5:
            continue
        r = weighted_pearson(sl_x[mask], sl_y[mask])
        results.append({
            "t": int(dates[i].timestamp()),
            "r": round(r, 4),
        })
    return results


# ── Cross-Correlation Function ─────────────────────────────────────────────────

def ccf(ra: np.ndarray, rb: np.ndarray, max_lag: int = 10) -> dict:
    sig_threshold = 1.96 / np.sqrt(len(ra))
    best_lag, best_r = 0, 0.0
    lag_results = []
    for lag in range(-max_lag, max_lag + 1):
        if lag >= 0:
            x, y = ra[: len(ra) - lag or None], rb[lag:]
        else:
            x, y = ra[-lag:], rb[: len(rb) + lag]
        if len(x) < 5:
            continue
        r = float(np.corrcoef(x, y)[0, 1])
        if not np.isfinite(r):
            r = 0.0
        lag_results.append({"lag": lag, "r": round(r, 4)})
        if abs(r) > abs(best_r) and abs(r) > sig_threshold:
            best_lag, best_r = lag, r

    if best_lag < 0:
        lead = "B_leads_A"
    elif best_lag > 0:
        lead = "A_leads_B"
    else:
        lead = "contemporaneous"

    return {
        "best_lag_days": best_lag,
        "lag_correlation": round(best_r, 4),
        "lead_direction": lead,
        "lag_series": lag_results,
    }


# ── Granger Causality ─────────────────────────────────────────────────────────

def granger_pair(ra: np.ndarray, rb: np.ndarray, max_lag: int) -> dict:
    try:
        from statsmodels.tsa.stattools import grangercausalitytests
        df = pd.DataFrame({"b": rb, "a": ra})
        res = grangercausalitytests(df[["b", "a"]], maxlag=max_lag, verbose=False)
        pvals = {lag: res[lag][0]["ssr_ftest"][1] for lag in res}
        best_lag = min(pvals, key=pvals.get)
        return {"best_pval": float(pvals[best_lag]), "best_lag": best_lag}
    except Exception:
        return {"best_pval": 1.0, "best_lag": 0}


# ── Structural Break ───────────────────────────────────────────────────────────

def structural_break(ra: np.ndarray, rb: np.ndarray) -> dict:
    try:
        import statsmodels.api as sm
        from statsmodels.stats.diagnostic import breaks_cusumolsresid
        X = sm.add_constant(ra)
        model = sm.OLS(rb, X).fit()
        stat, pval, _, _ = breaks_cusumolsresid(model.resid)
        return {"cusum_pval": float(pval), "break_detected": pval < 0.05}
    except Exception:
        return {"cusum_pval": 1.0, "break_detected": False}


# ── Main Pipeline ─────────────────────────────────────────────────────────────

def correlate(
    market_a_id: str,
    market_b_id: str,
    history_a: list[dict],
    history_b: list[dict],
    semantic_similarity: float = 0.0,
    end_date_proximity: float = 0.0,
) -> dict | None:
    sa, sb = align_series(history_a, history_b)

    if len(sa) < 14:
        return {
            "market_a": market_a_id,
            "market_b": market_b_id,
            "short_history_warning": True,
            "n_observations": len(sa),
            "error": "Insufficient shared history (< 14 days)",
        }

    dates = sa.index
    pa, pb = sa.values, sb.values

    # ── Data quality guards ────────────────────────────────────────────────────
    # Reject series with too little price variation (constant or near-constant =
    # LOCF-filled sparse markets or newly created markets with 1–2 trades)
    if np.std(pa) < 0.005 or np.std(pb) < 0.005:
        return {
            "market_a": market_a_id,
            "market_b": market_b_id,
            "short_history_warning": True,
            "n_observations": len(pa),
            "error": "Insufficient price variation (likely sparse or constant series)",
        }

    # Detect resolution convergence: both markets effectively resolved near 0 or 1
    # This causes spurious Pearson correlation (both moved 0.5→1 or 0.5→0 together)
    final_a, final_b = float(pa[-1]), float(pb[-1])
    resolution_convergence = (
        (final_a > 0.92 and final_b > 0.92) or
        (final_a < 0.08 and final_b < 0.08) or
        (final_a > 0.92 and final_b < 0.08) or
        (final_a < 0.08 and final_b > 0.92)
    )

    # Logit levels and returns
    lx = logit(pa)
    ly = logit(pb)
    rx = logit_returns(pa)
    ry = logit_returns(pb)

    shared_days = float((dates[-1] - dates[0]).days)
    n = len(pa)

    # ── Full-period Pearson ────────────────────────────────────────────────────
    full_pearson = weighted_pearson(lx, ly)
    mask_r = np.isfinite(rx) & np.isfinite(ry)
    full_pearson_returns = weighted_pearson(rx[mask_r], ry[mask_r]) if mask_r.sum() > 5 else 0.0

    # ── Rolling correlation ────────────────────────────────────────────────────
    window = max(14, int(n * 0.20))
    roll = rolling_correlation(lx, ly, dates, window)
    roll_vals = np.array([r["r"] for r in roll]) if roll else np.array([full_pearson])
    rolling_mean = float(np.mean(roll_vals))
    rolling_std  = float(np.std(roll_vals))
    rolling_pct_positive = float(np.mean(roll_vals > 0))

    # ── CCF ───────────────────────────────────────────────────────────────────
    max_lag = min(10, n // 5)
    ccf_result = ccf(rx[mask_r], ry[mask_r], max_lag=max_lag) if mask_r.sum() > 10 else {
        "best_lag_days": 0, "lag_correlation": 0.0,
        "lead_direction": "contemporaneous", "lag_series": [],
    }

    # ── Granger ───────────────────────────────────────────────────────────────
    granger_lag = min(5, n // 10)
    if len(rx[mask_r]) > granger_lag * 3:
        g_ab = granger_pair(rx[mask_r], ry[mask_r], granger_lag)
        g_ba = granger_pair(ry[mask_r], rx[mask_r], granger_lag)
    else:
        g_ab = g_ba = {"best_pval": 1.0, "best_lag": 0}

    a_causes_b = g_ab["best_pval"]
    b_causes_a = g_ba["best_pval"]
    if a_causes_b < 0.05 and a_causes_b <= b_causes_a:
        granger_dir = "A_causes_B"
    elif b_causes_a < 0.05:
        granger_dir = "B_causes_A"
    else:
        granger_dir = None

    # ── Structural break ──────────────────────────────────────────────────────
    sb_result = structural_break(rx[mask_r], ry[mask_r]) if mask_r.sum() > 20 else {"break_detected": False, "cusum_pval": 1.0}
    pre_break_pearson = post_break_pearson = None
    if sb_result["break_detected"]:
        mid = n // 2
        pre_break_pearson  = weighted_pearson(lx[:mid], ly[:mid])
        post_break_pearson = weighted_pearson(lx[mid:], ly[mid:])

    # ── Data quality ──────────────────────────────────────────────────────────
    low_volume_warning  = False   # no volume data from CLOB; flag conservatively False
    short_history_warning = shared_days < 14

    # ── Composite score ───────────────────────────────────────────────────────
    base = abs(full_pearson)
    stability_bonus  = max(0, 0.2 - rolling_std) / 0.2 * 0.2
    granger_bonus    = 0.15 if min(a_causes_b, b_causes_a) < 0.05 else 0
    # Semantic similarity: MiniLM cosine scores are ~0.1 floor for random pairs,
    # ~0.8+ for near-identical questions. Normalise that range to a 0→0.15 bonus.
    sem_sim_clamped  = float(np.clip(semantic_similarity, 0.0, 1.0))
    semantic_bonus   = max(0.0, (sem_sim_clamped - 0.10) / 0.70) * 0.15
    # End-date proximity: markets resolving close together are more likely related.
    end_date_bonus   = float(np.clip(end_date_proximity, 0.0, 1.0)) * 0.08
    history_penalty  = 0.3 if short_history_warning else 0
    # Resolution convergence: both markets converged to 0/1 — correlation is likely
    # spurious (driven by shared resolution direction, not shared information flow)
    convergence_penalty = 0.35 if resolution_convergence else 0
    composite = float(np.clip(
        base + stability_bonus + granger_bonus + semantic_bonus + end_date_bonus
        - history_penalty - convergence_penalty,
        0, 1,
    ))

    sigma_a = float(np.std(rx[mask_r])) if mask_r.sum() > 1 else 0.0
    sigma_b = float(np.std(ry[mask_r])) if mask_r.sum() > 1 else 0.0

    return {
        "market_a": market_a_id,
        "market_b": market_b_id,
        "shared_history_days": round(shared_days, 1),
        "n_observations": n,
        # Core
        "full_pearson": round(full_pearson, 4),
        "full_pearson_returns": round(full_pearson_returns, 4),
        "sigma_logit_returns_a": round(sigma_a, 6),
        "sigma_logit_returns_b": round(sigma_b, 6),
        # Stability
        "rolling_mean": round(rolling_mean, 4),
        "rolling_std": round(rolling_std, 4),
        "rolling_pct_positive": round(rolling_pct_positive, 4),
        "rolling_series": roll,
        "break_detected": sb_result["break_detected"],
        "cusum_pval": round(sb_result["cusum_pval"], 4),
        "pre_break_pearson": round(pre_break_pearson, 4) if pre_break_pearson is not None else None,
        "post_break_pearson": round(post_break_pearson, 4) if post_break_pearson is not None else None,
        # Lead-lag
        "best_lag_days": ccf_result["best_lag_days"],
        "lag_correlation": ccf_result["lag_correlation"],
        "lead_direction": ccf_result["lead_direction"],
        "lag_series": ccf_result["lag_series"],
        # Granger
        "a_causes_b_pval": round(a_causes_b, 4),
        "b_causes_a_pval": round(b_causes_a, 4),
        "granger_dominant_direction": granger_dir,
        # Data quality
        "low_volume_warning": low_volume_warning,
        "short_history_warning": short_history_warning,
        "resolution_convergence": resolution_convergence,
        # Semantic
        "semantic_similarity": round(sem_sim_clamped, 4),
        "end_date_proximity": round(float(np.clip(end_date_proximity, 0.0, 1.0)), 4),
        # Composite
        "composite_score": round(composite, 4),
    }
