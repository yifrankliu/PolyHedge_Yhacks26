"""
Backtest and stress-testing for prediction market hedge strategies.

Three methods:
  1. Bootstrap path simulation   → Monte Carlo fan chart + terminal distribution + 3D density
  2. Historical scenario replay  → spike-event scatter + Conditional Hedge Effectiveness
  3. Walk-forward OOS validation → expanding-window beta, hedged vs unhedged cumulative P&L
"""
from __future__ import annotations
import numpy as np
from scipy.stats import gaussian_kde

try:
    from correlation import align_series, logit
    from rigorous_hedge import _huber_beta
except ImportError:
    from .correlation import align_series, logit
    from .rigorous_hedge import _huber_beta


# ── Helpers ────────────────────────────────────────────────────────────────────

def _c(p: float) -> float:
    return max(0.001, min(0.999, float(p)))


def _logit(p: float) -> float:
    p = _c(p)
    return float(np.log(p / (1 - p)))


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(x, -50, 50)))


def _mtm(cum_d: np.ndarray, p0: float, size: float, direction: str) -> np.ndarray:
    """
    Mark-to-market unrealised P&L along cumulative logit-return paths.
    cum_d: shape (n_sim, T) or (T,)
    """
    p0c = _c(p0)
    p = _sigmoid(_logit(p0c) + cum_d)
    if direction == "YES":
        return size * (p / p0c - 1.0)
    else:
        no0 = 1.0 - p0c
        return size * ((1.0 - p) / no0 - 1.0)


# ── Method 1: Bootstrap path simulation ───────────────────────────────────────

def bootstrap_simulation(
    ra: np.ndarray,
    rb: np.ndarray,
    *,
    p_a0: float,
    p_b0: float,
    position_size: float,
    hedge_size: float,
    direction: str,
    hedge_direction: str,
    n_sim: int = 2000,
    n_sample_paths: int = 30,
) -> dict:
    N = len(ra)
    T = N
    pairs = np.column_stack([ra, rb])

    # ── Vectorised bootstrap ───────────────────────────────────────────────────
    idx = np.random.randint(0, N, size=(n_sim, T))
    da_all = np.cumsum(pairs[idx, 0], axis=1)   # (n_sim, T)
    db_all = np.cumsum(pairs[idx, 1], axis=1)

    all_pnl = _mtm(da_all, p_a0, position_size, direction) + \
              _mtm(db_all, p_b0, hedge_size, hedge_direction)

    # Unhedged for comparison
    idx2 = np.random.randint(0, N, size=(n_sim, T))
    da_u = np.cumsum(pairs[idx2, 0], axis=1)
    all_unhedged = _mtm(da_u, p_a0, position_size, direction)

    # ── Percentile fan charts ──────────────────────────────────────────────────
    pctiles = [5, 10, 25, 50, 75, 90, 95]
    fan = {str(p): np.percentile(all_pnl, p, axis=0).round(4).tolist() for p in pctiles}
    fan_unhedged = {str(p): np.percentile(all_unhedged, p, axis=0).round(4).tolist()
                   for p in [5, 50, 95]}

    # ── Sample paths (spaghetti) ───────────────────────────────────────────────
    s_idx = np.random.choice(n_sim, size=min(n_sample_paths, n_sim), replace=False)
    sample_paths = all_pnl[s_idx].round(3).tolist()

    # ── Terminal distribution ──────────────────────────────────────────────────
    terminal = all_pnl[:, -1]
    t_lo, t_hi = float(np.percentile(terminal, 1)), float(np.percentile(terminal, 99))

    # KDE via scipy
    kde_x = np.linspace(t_lo, t_hi, 200)
    try:
        kde_y = gaussian_kde(terminal, bw_method="scott")(kde_x).tolist()
    except Exception:
        kde_y = [0.0] * 200

    # Histogram (40 bins, normalised density)
    counts, edges = np.histogram(terminal, bins=40, range=(t_lo, t_hi), density=True)
    hist_centers = ((edges[:-1] + edges[1:]) / 2).round(4).tolist()

    # ── Tail risk scalars ──────────────────────────────────────────────────────
    n_tail = max(1, int(n_sim * 0.05))
    sorted_t = np.sort(terminal)
    var_5   = float(np.percentile(terminal, 5))
    es_5    = float(np.mean(sorted_t[:n_tail]))
    prob_p  = float(np.mean(terminal > 0))

    # P(loss) at each time step
    prob_loss_t = np.mean(all_pnl < 0, axis=0).round(4).tolist()

    # ── 3-D density surface (for Plotly) ──────────────────────────────────────
    n_bins3 = 50
    d_lo = float(np.percentile(all_pnl, 2))
    d_hi = float(np.percentile(all_pnl, 98))
    edges3 = np.linspace(d_lo, d_hi, n_bins3 + 1)
    centers3 = ((edges3[:-1] + edges3[1:]) / 2).round(3).tolist()

    # density_z shape: [n_bins3][T]
    density_z = []
    for i in range(n_bins3):
        in_bin = (all_pnl >= edges3[i]) & (all_pnl < edges3[i + 1])
        density_z.append((np.sum(in_bin, axis=0) / n_sim).round(5).tolist())

    return {
        "n_sim": int(n_sim),
        "horizon_days": int(T),
        "fan": fan,
        "fan_unhedged": fan_unhedged,
        "sample_paths": sample_paths,
        "terminal_pnl": terminal.round(4).tolist(),
        "terminal_histogram": {"centers": hist_centers, "density": counts.round(5).tolist()},
        "terminal_kde": {"x": kde_x.round(4).tolist(), "y": kde_y},
        "prob_loss_at_t": prob_loss_t,
        "var_5pct": round(var_5, 4),
        "expected_shortfall_5pct": round(es_5, 4),
        "prob_profit": round(prob_p, 4),
        "density_surface": {
            "time_steps": list(range(T)),
            "pnl_grid": centers3,
            "z": density_z,
        },
    }


# ── Method 2: Historical scenario replay ──────────────────────────────────────

def scenario_replay(
    ra: np.ndarray,
    rb: np.ndarray,
    *,
    p_a0: float,
    p_b0: float,
    position_size: float,
    hedge_size: float,
    direction: str,
    hedge_direction: str,
    spike_quantile: float = 0.75,
) -> dict:
    N = len(ra)

    def _one(i: int) -> dict:
        da = np.array([ra[i]])
        db = np.array([rb[i]])
        pos   = float(_mtm(da, p_a0, position_size, direction)[0])
        hedge = float(_mtm(db, p_b0, hedge_size, hedge_direction)[0])
        net   = pos + hedge
        eff   = float(np.clip(1.0 - abs(net) / (abs(pos) + 1e-8), -2, 2))
        return {
            "day": int(i),
            "da": round(float(ra[i]), 5),
            "db": round(float(rb[i]), 5),
            "pos_pnl": round(pos, 4),
            "hedge_pnl": round(hedge, 4),
            "net_pnl": round(net, 4),
            "effectiveness": round(eff, 4),
        }

    all_sc = [_one(i) for i in range(N)]

    # Spike events (same quantile as rigorous_hedge default)
    abs_ra = np.abs(ra)
    thr = float(np.quantile(abs_ra, spike_quantile))
    spike_idx = list(np.where(abs_ra >= thr)[0])
    spike_sc = [_one(i) for i in spike_idx]

    # CHE — over all adverse-position events
    adverse = [s for s in all_sc if s["pos_pnl"] < 0]
    if len(adverse) >= 3:
        n_tail = max(1, int(len(adverse) * 0.05))
        worst = sorted(adverse, key=lambda s: s["net_pnl"])
        cvar_n  = float(np.mean([s["net_pnl"] for s in worst[:n_tail]]))
        cvar_u  = float(np.mean([s["pos_pnl"] for s in worst[:n_tail]]))
        che = float(np.clip(1.0 - abs(cvar_n) / (abs(cvar_u) + 1e-8), -1, 1))
    else:
        cvar_n = cvar_u = che = 0.0

    pct_hedged = float(np.mean(
        [s["hedge_pnl"] * s["pos_pnl"] < 0 for s in all_sc]
    )) if all_sc else 0.0

    return {
        "all_scenarios": all_sc,
        "spike_scenarios": spike_sc,
        "conditional_hedge_effectiveness": round(che, 4),
        "pct_events_hedged": round(pct_hedged, 4),
        "cvar_net": round(cvar_n, 4),
        "cvar_unhedged": round(cvar_u, 4),
    }


# ── Method 3: Walk-forward OOS ────────────────────────────────────────────────

def walk_forward_oos(
    ra: np.ndarray,
    rb: np.ndarray,
    *,
    p_a0: float,
    p_b0: float,
    position_size: float,
    hedge_size: float,
    direction: str,
    hedge_direction: str,
    min_train: int = 20,
) -> dict:
    N = len(ra)
    if N < min_train + 5:
        return {
            "error": f"Insufficient data ({N} obs, need {min_train + 5})",
            "hedged_cum": [], "unhedged_cum": [],
            "rolling_beta": [], "oos_variance_reduction": 0.0, "n_oos_points": 0,
        }

    # Linear MtM scaling (first-order approximation around current price)
    # ∂(YES_value)/∂(logit) ≈ (stake/p0) * p0*(1-p0) = stake*(1-p0)
    if direction == "YES":
        scale_pos = position_size * (1.0 - _c(p_a0))
    else:
        scale_pos = -position_size * _c(p_a0)

    if hedge_direction == "YES":
        scale_hedge = hedge_size * (1.0 - _c(p_b0))
    else:
        scale_hedge = -hedge_size * _c(p_b0)

    hedged_cum  = [0.0]
    unhedged_cum = [0.0]
    betas = []

    for t in range(min_train, N):
        beta_t = _huber_beta(ra[:t], rb[:t])
        hedged_pnl   = scale_pos * ra[t] + scale_hedge * beta_t * rb[t]
        unhedged_pnl = scale_pos * ra[t]
        hedged_cum.append(hedged_cum[-1] + hedged_pnl)
        unhedged_cum.append(unhedged_cum[-1] + unhedged_pnl)
        betas.append(round(float(beta_t), 5))

    h_ret = np.diff(hedged_cum)
    u_ret = np.diff(unhedged_cum)
    var_h = float(np.var(h_ret, ddof=1)) if len(h_ret) > 1 else 1.0
    var_u = float(np.var(u_ret, ddof=1)) if len(u_ret) > 1 else 1.0
    var_red = float(np.clip(1.0 - var_h / (var_u + 1e-12), -1.0, 1.0))

    return {
        "hedged_cum":  [round(v, 4) for v in hedged_cum],
        "unhedged_cum": [round(v, 4) for v in unhedged_cum],
        "rolling_beta": betas,
        "oos_variance_reduction": round(var_red, 4),
        "n_oos_points": int(N - min_train),
    }
