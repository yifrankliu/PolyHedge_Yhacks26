# PredictionAnalytics — Design & Architecture Reference

> Hackathon preparation document. Covers design rationale, algorithms, visualizations, and a critical assessment of strengths and weaknesses.

---

## Table of Contents

1. [Problem Framing](#1-problem-framing)
2. [System Architecture](#2-system-architecture)
3. [Hedge Scanner](#3-hedge-scanner)
4. [Strategy Builder](#4-strategy-builder)
5. [Stress Tester](#5-stress-tester)
6. [Visualization Design](#6-visualization-design)
7. [Critical Assessment](#7-critical-assessment)

---

## 1. Problem Framing

Prediction markets are binary options. A YES position on a market priced at $0.60 is economically equivalent to buying a binary call with strike 0 that pays $1 if the event resolves YES. This framing unlocks the full toolkit of derivatives risk management — hedging, scenario analysis, and Monte Carlo simulation — applied to an asset class that has historically been treated as purely speculative.

The core thesis: **correlated prediction markets can be used to hedge each other**, in the same way a portfolio manager hedges sector exposure by taking an offsetting position in a correlated instrument. The challenge is that:

- There is no options chain to delta-hedge against
- Markets have varying depths of history (days to years)
- Resolution events are non-repeatable by construction
- Price processes are bounded [0, 1] and non-Gaussian

All three modules (Hedge Scanner, Strategy Builder, Stress Tester) are designed around these constraints.

---

## 2. System Architecture

```
User
  │
  ▼
React Frontend (TypeScript)
  ├─ HedgeScanner.tsx       — SSE streaming, live results
  ├─ StrategyBuilder.tsx    — EV curve, outcome matrix, strategy composition
  ├─ StressTestDashboard.tsx — wrapper + summary card
  └─ BacktestPanel.tsx      — Monte Carlo + scenario + walk-forward charts
  │
  ▼ HTTP / SSE
FastAPI Backend (Python 3.11)
  ├─ main.py                — routes, Pydantic models, CLOB API calls
  ├─ correlation.py         — Pearson, rolling, CCF, Granger, CUSUM
  ├─ rigorous_hedge.py      — Huber IRLS, bootstrap CI, hedge ratio
  └─ backtest.py            — bootstrap simulation, scenario replay, walk-forward OOS
  │
  ▼ HTTP
External APIs
  ├─ Polymarket Gamma API   — market universe, metadata
  └─ Polymarket CLOB API    — price history (daily, fidelity=1440)
```

**Key architectural choices:**

| Choice | Rationale |
|--------|-----------|
| Server-Sent Events (SSE) for scan | Scanning 1,000 markets takes 30–60s. SSE lets results appear live rather than waiting for a single slow response. |
| Logit-space for all returns | Prices are bounded [0,1]. Raw differences are non-stationary near resolution. Logit maps to ℝ, making correlations and regressions well-behaved. |
| LOCF alignment | Prediction markets trade sporadically. Forward-filling the last known price is the correct econometric choice — it represents the market's best estimate at each point in time. |
| Stateless backend | Each request is self-contained with a 1-hour in-memory cache for CLOB history. Railway's ephemeral environment makes persistence infeasible. |

---

## 3. Hedge Scanner

### 3.1 Universe Sourcing

The scanner fetches the top 1,000 Polymarket markets by volume (open, active only) and pre-filters by semantic similarity before running expensive statistical tests.

**Semantic pre-filter:** All market questions are embedded using **MiniLM-L6-v2** (via sentence-transformers). Cosine similarity is computed between the target question and all candidates. Only the top `N` (default 75) proceed to full analysis. This is a critical performance optimization — embedding + cosine similarity is O(n) and takes ~200ms; full historical correlation is O(n × history_length) and takes ~500ms per market.

**Why semantic filtering works:** Prediction markets about the same underlying event (e.g., two markets about the same election) will have correlated prices and similar text. Markets about completely unrelated events (e.g., sports vs. crypto) have near-zero embedding similarity and will never be good hedges.

### 3.2 Correlation Analysis (`correlation.py`)

For each candidate that passes semantic filtering:

**Logit returns:**
```
r_t = logit(p_t) − logit(p_{t-1})
    = log(p_t / (1-p_t)) − log(p_{t-1} / (1-p_{t-1}))
```

This transformation is applied universally before any statistical test.

**Metrics computed:**

| Metric | Method | Purpose |
|--------|--------|---------|
| Full Pearson (levels) | `corr(logit(pA), logit(pB))` | Overall co-movement |
| Full Pearson (returns) | `corr(rA, rB)` | Day-to-day price change correlation |
| Rolling correlation | 20%-window rolling Pearson on returns | Stability over time |
| Lead-lag (CCF) | Cross-correlation at lags ±10 days, significance at `1.96/√N` | Who leads whom |
| Granger causality | OLS F-test, lags 1–5, p < 0.05 | Causal direction |
| Structural break | CUSUM on OLS residuals | Regime change detection |

**Composite score** (0–1) used for ranking:
```
score = |full_pearson|
      + 0.20 × stability_bonus     (inverse of rolling_std)
      + 0.15 × granger_bonus       (if significant causal link)
      + 0.15 × semantic_bonus      (text embedding similarity)
      + 0.08 × end_date_bonus      (similar resolution date)
      − 0.30 × history_penalty     (if < 14 shared days)
      − 0.35 × convergence_penalty (if both converging to same extreme)
```
Clipped to [0, 1].

**Resolution convergence penalty:** If both markets are simultaneously converging toward 0 or 1 (both about to resolve the same way), their logit returns will be correlated entirely due to shared resolution dynamics, not genuine information linkage. This is a major source of spurious correlation that a naive Pearson measure would miss.

### 3.3 Rigorous Hedge Estimation (`rigorous_hedge.py`)

**Event-study design:** Rather than fitting a hedge ratio on all daily observations (which gives too much weight to flat periods), we isolate **spike events** — days where `|rA| ≥ quantile(|rA|, 0.75)`. These are the days that actually matter for hedging. A good hedge must work when the position moves, not when nothing happens.

**Huber IRLS regression:**
```
min Σ ρ_huber(rB_i − β × rA_i)
```
where `ρ_huber(u) = u²/2` if `|u| ≤ 1`, else `|u| − 0.5`.

Standard OLS would be dominated by outliers (extreme resolution-driven moves). Huber regression down-weights these, producing a stable estimate of the *typical* hedge relationship on spike days.

**Minimum-variance hedge ratio:**
```
h* = 0.7 × h_event + 0.3 × h_full

h_event = Huber beta on spike events
h_full  = −cov(rA, rB) / var(rB)  (full-sample MV hedge)
```
The 0.7/0.3 blend stabilizes the event estimate with full-sample information, reducing overfitting to a small number of spike events.

**Bootstrap confidence intervals:** 250 resamples of the spike event set, giving 2.5th–97.5th percentile CI on beta. A wide CI flags an unreliable hedge estimate.

**Confidence score (0–1):**
```
confidence = 0.30 × sample_size_factor   (min(1, n_events / 40))
           + 0.30 × fit_quality          (1 − residual_std / y_std)
           + 0.20 × ci_tightness         (1 − (CI_hi − CI_lo) / |beta|)
           + 0.20 × ratio_stability      (1 − MAD_ratio)
```

---

## 4. Strategy Builder

### 4.1 EV Curve

For a sweep of P(A=YES) from 0 to 1:

**Position P&L:**
```
pnl_pos(pA) = pA × [stake × (1-entry)/entry] + (1-pA) × [-stake]
```

**Hedge P&L** (per hedge h):
```
pB(pA) = sigmoid(logit(pB0) + corr × (logit(pA) − logit(pA0)))
```
This is a logit-space linear extrapolation — it keeps pB in (0,1) and produces genuinely curved lines, not linear approximations. The slope is controlled by the correlation coefficient.

```
pnl_hedge(pA) = pB(pA) × [size × (1-bp)/bp]   if hedge_direction = "YES"
              = (1−pB(pA)) × [size × bp/(1−bp)] if hedge_direction = "NO"
```

**Total EV:**
```
EV(pA) = pnl_pos(pA) + Σ pnl_hedge_i(pA)
```

### 4.2 Outcome Matrix

A 2×2 grid: A resolves YES/NO × All hedges pay out / All hedges lose.

Probabilities are assigned assuming **independence** (a simplification — in reality correlated markets have dependent resolutions). Cell intensities are color-coded by P&L magnitude.

### 4.3 Design Rationale

- **Multiple strategies (up to 5):** Lets the user compare "hedge with market X only" vs. "hedge with X and Y" on the same chart.
- **Live corr-adjusted curves:** Rather than flat EV lines, the logit-space extrapolation shows how hedge payoffs change non-linearly as the position market moves — this reflects the actual option-like payoff structure.
- **KPIs (best case / worst case / EV / break-even):** Condenses the full curve into actionable numbers for quick decision-making.

---

## 5. Stress Tester

### 5.1 Why Three Methods

No single method is sufficient:

| Method | What it tests | Limitation |
|--------|--------------|------------|
| Bootstrap simulation | Distribution of forward P&L paths | Assumes stationarity; can't capture regime shifts |
| Scenario replay | Behavior on actual historical spike events | Limited by history length; not forward-looking |
| Walk-forward OOS | Hedge ratio stability over time | Linear approximation of MtM; underestimates non-linearity |

Together they answer different questions: *What is the distribution of outcomes? How did it behave historically on bad days? Does the hedge ratio remain stable out-of-sample?*

### 5.2 Bootstrap Path Simulation (`backtest.py`)

**Algorithm:**
1. Sample logit return pairs `(rA, rB)` with replacement for `T` days, `n_sim=2000` times
2. Cumulative sum to build logit-space price paths
3. Convert to P&L via mark-to-market formula:
   ```
   p(t) = sigmoid(logit(p0) + Σ r_s)

   MtM_YES(t) = size × (p(t)/p0 − 1)
   MtM_NO(t)  = size × ((1−p(t))/(1−p0) − 1)
   ```
4. Net P&L = MtM_position + MtM_hedge

**Output statistics:**
- Fan chart: percentiles [5, 10, 25, 50, 75, 90, 95] at each day
- Terminal distribution: histogram (40 bins) + Gaussian KDE (200 points, Scott's rule)
- VaR 5%: `percentile(terminal, 5)`
- Expected Shortfall 5%: `mean(terminal[terminal < VaR])`
- P(profit): `mean(terminal > 0)`
- P(loss at t): fraction of paths below zero at each day
- 3D density surface: 50-bin P&L grid × T time steps

**Key design choice — paired bootstrap:** `rA` and `rB` are sampled from the same index `i`, preserving the empirical joint distribution. A naive independent bootstrap would destroy the correlation structure and produce meaningless results.

### 5.3 Historical Scenario Replay (`backtest.py`)

Identifies spike days (top 25% by `|rA|`) and replays each day's actual joint move:

**Effectiveness per event:**
```
effectiveness = 1 − |net_pnl| / (|pos_pnl| + ε)
```
- = 1: perfect hedge (net = 0)
- = 0: no effect
- < 0: hedge made things worse

**Conditional Hedge Effectiveness (CHE):**
```
CHE = 1 − |CVaR_5%(net)| / |CVaR_5%(unhedged)|
```
Computed on the worst 5% of *adverse position events* — i.e., days where the position lost money and the loss was in the extreme tail. This is the metric that matters: does the hedge protect when you need it most?

### 5.4 Walk-Forward OOS Validation (`backtest.py`)

Expanding window from day `min_train=20` to `N`:
- At each step `t`: fit Huber beta on `[0..t]`, apply to day `t+1`
- Track cumulative hedged vs. unhedged P&L

**Linear MtM approximation:**
```
ΔPNL_pos   ≈ rA × size × (1 − p0)    (YES position)
ΔPNL_hedge ≈ rB × beta × hedge_size × (1 − pB0)
```
This is a first-order Taylor expansion of the true MtM around current prices. It's accurate for small moves and degrades for large ones — which is why the scenario replay (with exact MtM) complements it.

**Variance reduction:**
```
VR = 1 − var(hedged_returns) / var(unhedged_returns)
```
Positive VR means the hedge reduced return volatility on a true OOS basis.

---

## 6. Visualization Design

### 6.1 Fan Chart

**Choice:** Stacked `<Area>` layers in Recharts, drawn outer-to-inner with accumulating opacity (6% → 10% toward median), rather than "stacked differences."

**Rationale:** Negative P&L makes stacking mathematically messy (you'd need to separate positive and negative bands). The overlap-opacity approach naturally creates a visual density gradient — darker center = higher probability mass — which maps intuitively to the underlying distribution without requiring the user to understand percentile stacking.

**Hover tooltip:** Shows all three key percentiles (5th, median, 95th) plus P(loss at that day) — this answers the question a trader actually asks: "What's my downside risk right now?"

### 6.2 Terminal Distribution

**Choice:** Unified `termData` array combining histogram bars and KDE curve, rendered in a single Recharts `ComposedChart`.

**Challenge:** Histogram has 40 bins; KDE has 200 points. Solution: interpolate KDE values at histogram bin centers using binary search, creating a unified dataset where each bar also has a KDE value.

**Why KDE overlay:** The histogram is blocky and sensitive to bin width. The KDE (Scott's rule bandwidth) shows the smooth underlying density, making the shape of the distribution clearer. Together they convey both the raw counts and the inferred distribution.

### 6.3 3D Density Surface

**Choice:** Plotly `surface` trace with a dark colorscale (black → dark blue → indigo → light blue), lazy-loaded behind a toggle button.

The Z-axis is `density[pnl_bin][time_step]` — how much probability mass is in each P&L bucket at each point in time. This shows how the distribution evolves: starting tight at day 0 (certainty about current price) and widening over time, with the median track visible as a ridge.

**Lazy loading:** Plotly bundles ~3.5MB. Loading it only when the user clicks "Show 3D Surface ↗" keeps initial page load fast.

### 6.4 Scenario Replay Scatter

**Choice:** `ScatterChart` with custom `EffDot` shape, colored by effectiveness.

X-axis = position P&L, Y-axis = net P&L. A perfect hedge would place all points on the X-axis (net = 0). A good hedge compresses the Y range. Points in Q2 (position loses, net recovers) are ideal; points in Q3 (both lose) are hedge failures.

Color coding — green/amber/red by effectiveness — lets the presenter immediately demonstrate how often the hedge "worked" on bad days.

### 6.5 Walk-Forward Lines

**Choice:** Two lines (solid hedged, dashed unhedged) on the same `LineChart`.

A widening gap between the two lines over time is the strongest visual argument for the hedge's value. Variance reduction (OOS) is printed as a KPI card.

---

## 7. Critical Assessment

### Strengths

**1. Architecturally sound treatment of the bounded price process**
Using logit-space for all statistics (correlation, regression, Monte Carlo returns) is the correct econometric choice. Raw-price correlation on bounded [0,1] variables is meaningless near resolution. This separates the project from naive approaches.

**2. Paired bootstrap preserves joint structure**
Resampling `(rA, rB)` pairs rather than independently is non-trivial and critical. An independent bootstrap would destroy the correlation structure and make the fan chart useless. This reflects genuine understanding of the methodology.

**3. Three complementary stress-test methods**
Bootstrap answers "what's the distribution of future P&L?" Scenario replay answers "how did this work historically on bad days?" Walk-forward answers "is the hedge ratio stable over time?" No single method suffices; having all three demonstrates rigor.

**4. Semantic pre-filtering scales the scan**
Scanning 1,000 markets requires pre-filtering. Using sentence-transformer embeddings rather than keyword matching finds genuinely similar markets (e.g., a market about "will X happen before Y date" and "will X happen by Z date" would match even with different wording).

**5. Resolution convergence penalty**
This is a subtle but important correction. Without it, two markets both resolving to 1 in their final week would show near-perfect correlation — but it's entirely spurious. The penalty prevents recommending "hedges" that are simply both about to expire.

**6. Live streaming results**
SSE streaming is user-experience-first design. A 30-second wait for a single JSON response would feel broken. Seeing results appear one by one demonstrates that the system is actively working and gives the user early signal.

---

### Weaknesses

**1. Independence assumption in the outcome matrix**
The 2×2 outcome matrix assigns probabilities assuming A and B resolve independently. This directly contradicts the premise of the entire system (that they are correlated). The correct calculation would use the joint distribution estimated from historical co-resolution patterns. As a quick approximation it's defensible, but it is technically inconsistent.

**2. Bootstrap stationarity assumption**
Resampling historical logit returns with replacement assumes the return distribution is stationary — that tomorrow's distribution looks like yesterday's. Prediction markets are fundamentally non-stationary: probabilities accelerate toward resolution, news events shift the distribution suddenly, and liquidity varies. The fan chart should be caveated as "conditional on similar price dynamics."

**3. Linear MtM in walk-forward is a rough approximation**
`ΔPNL ≈ r × size × (1 − p0)` is a first-order delta approximation. For prices near 0 or 1 (near resolution), the actual MtM is highly non-linear (gamma is large). The walk-forward results are less reliable for markets above 75% or below 25% — the code does flag this with a warning, but the underlying calculation is still biased.

**4. Hedge ratio assumes a single scalar relationship**
The minimum-variance hedge ratio `h*` assumes a linear, time-invariant relationship between rA and rB. In practice, the relationship may be asymmetric (correlated when A moves down but not up) or time-varying (correlation rises as resolution approaches). The structural break detection flags this but does not model it.

**5. Single hedge pair in the stress tester**
The BacktestPanel tests one position + one hedge at a time. A real strategy might have 2–3 hedges. The portfolio-level P&L would require computing the joint distribution of all hedge instruments simultaneously, which is not implemented. The multi-hedge strategy builder builds the EV curve correctly, but the stress test only validates one pair.

**6. No liquidity or slippage model**
Recommended hedge sizes are based purely on hedge ratios, with no regard for market depth. A $5,000 hedge on a market with $500 daily volume would move the market against you. Polymarket CLOB data includes order book depth but we don't incorporate it.

**7. CLOB history is daily at best**
The Polymarket CLOB returns prices at 1440-minute (daily) fidelity. With 30–180 days of history, most markets provide 30–180 observations. Statistical tests that are reliable at N=500+ are applied to N=40. The standard error of Pearson correlation at N=40 is ±0.16 — meaningful. Confidence intervals are wide and should be communicated more prominently.

**8. Kalshi integration is incomplete**
The architecture supports Kalshi market search and price lookup, but Kalshi price history is not available via the public API at the granularity needed for correlation analysis. All correlation and stress-testing is Polymarket-only. Cross-platform hedging (Polymarket position hedged with Kalshi) is not possible.

---

### Suggested Defenses at Presentation

| Likely challenge | Defense |
|-----------------|---------|
| "Your bootstrap assumes stationarity" | "Correct — we flag this in warnings when the position is >75% or <25%. The scenario replay provides a stationary-free historical complement." |
| "Your outcome matrix assumes independence" | "It's a simplification for the 2×2 summary. The EV curve uses logit-correlated hedge payoffs and is the more accurate representation." |
| "How do you know the hedge ratio is stable?" | "That's exactly what the walk-forward OOS validation tests — it shows the expanding-window beta and variance reduction on data the model never trained on." |
| "You only have 40 observations" | "True, and confidence intervals reflect this — a hedge with wide CI gets a lower confidence score and more caveats. We don't suppress uncertainty." |
| "Why not just hedge with the underlying?" | "Prediction markets have no underlying to trade. The correlated-market hedge is the only viable instrument." |
| "What's the edge over just looking at correlation?" | "Correlation alone doesn't tell you how much to trade or whether the relationship holds on the specific days that matter. The event-study Huber regression isolates spike events and gives a size-adjusted, robust estimate with bootstrap confidence bounds." |
