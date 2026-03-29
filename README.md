# PolyHedge

> TradFi-grade risk management infrastructure for prediction markets — hedge scanning, strategy construction, and Monte Carlo stress testing.
> Made for Yhacks 2026.

[![Backend](https://img.shields.io/badge/backend-FastAPI-009688?style=flat-square)](https://fastapi.tiangolo.com)
[![Frontend](https://img.shields.io/badge/frontend-React%2019-61DAFB?style=flat-square)](https://react.dev)
[![Deploy](https://img.shields.io/badge/deploy-Vercel%20%2B%20Railway-black?style=flat-square)](https://vercel.com)

**[Live Demo →](https://yhacks.vercel.app)**

---

## The Problem

Prediction market traders have no risk infrastructure. Options traders rely on decades of tooling — hedge scanners, scenario analysis, Monte Carlo simulation — none of which exists for binary markets. Yet prediction market contracts are mathematically identical to binary options: a YES at $0.60 is a binary call with a $1 payoff.

This project applies the full derivatives risk management stack to prediction markets.

---

## What It Does

A six-tab analytics pipeline, designed to be used left to right:

| Tab | Purpose |
|-----|---------|
| **Position Input** | Enter Polymarket positions with side, stake, and entry price |
| **Correlation Scanner** | Find markets with statistically significant co-movement |
| **Market Comparator** | Side-by-side price history with spike investigation |
| **Hedge Scanner** | Scan 1,000 markets for viable hedge candidates using event-study regression |
| **Strategy Builder** | Compose multi-hedge strategies; visualize corr-adjusted EV curves and outcome matrices |
| **Stress Test** | Monte Carlo simulation, historical scenario replay, and walk-forward OOS validation |

---

## Technical Highlights

### Hedge Scanner
- Embeds all 1,000 Polymarket market questions with **MiniLM-L6-v2**, pre-filters to top 75 by cosine similarity before running any statistics — O(n) embedding vs O(n × T) correlation
- Full correlation pipeline per candidate: Pearson on logit returns, 20%-window rolling correlation, ±10-day CCF lead-lag, Granger causality (lags 1–5), CUSUM structural break detection
- **Resolution convergence penalty**: discounts correlation arising purely from both markets simultaneously converging to resolution — a major source of spurious signals that naive Pearson misses
- Fits **Huber IRLS** on spike events (top 25% by `|logit_return|`) for a minimum-variance hedge ratio that ignores flat periods and resists outliers; 250-round bootstrap gives confidence intervals on beta
- Results stream live via **SSE** — no waiting for the full scan to complete

### Strategy Builder
- EV curves use logit-space corr-adjusted extrapolation: `p_B = sigmoid(logit(p_B0) + ρ × (logit(p_A) − logit(p_A0)))` — genuinely curved lines that respect the [0,1] boundary
- Supports up to 5 named strategies on the same chart
- 2×2 outcome matrix with probability-weighted cell intensities

### Stress Tester — Three Methods

**1. Bootstrap Monte Carlo (2,000 paths)**
- Paired resampling of `(r_A, r_B)` preserves the empirical joint distribution; independent resampling would destroy the correlation structure
- Mark-to-market via exact binary option formula: `MtM = size × (p(t)/p_0 − 1)` where `p(t) = sigmoid(logit(p_0) + Σr)`
- Outputs: 7-percentile fan chart, terminal P&L histogram + KDE, VaR 5%, Expected Shortfall, P(loss at t), optional 3D density surface

**2. Historical Scenario Replay**
- Replays every spike day from shared price history with exact per-day P&L
- **Conditional Hedge Effectiveness (CHE)**: `1 − |CVaR_5%(net)| / |CVaR_5%(unhedged)|` — measured on the worst 5% of adverse-position days only

**3. Walk-Forward OOS Validation**
- Expanding-window Huber beta applied to each next out-of-sample day — zero lookahead
- Reports variance reduction: `1 − var(hedged_returns) / var(unhedged_returns)`

### Why Logit Space

Raw price differences on bounded [0,1] processes are non-stationary near resolution. The logit transform maps prices to ℝ, making correlations, regressions, and cumulative returns well-behaved across the full price range. Applied universally across all statistical methods.

---

## Stack

```
Backend:  Python 3.11 · FastAPI · NumPy · SciPy · pandas · sentence-transformers · httpx
Frontend: React 19 · TypeScript · Recharts · Plotly · TailwindCSS · axios
Deploy:   Vercel (frontend) · Railway (backend)
Data:     Polymarket Gamma API · Polymarket CLOB API
```

---

## Running Locally

**Backend**
```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**Frontend** (separate terminal)
```bash
cd frontend
npm install
npm start
```

No API keys required for core functionality. Runs fully against public Polymarket APIs.

---

## Key API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/hedge/scan/stream` | SSE: live hedge scan across 1,000 markets |
| `POST` | `/backtest` | Bootstrap sim + scenario replay + walk-forward |
| `GET` | `/correlate` | Full correlation pipeline between two markets |
| `GET` | `/markets/polymarket` | Search Polymarket universe |
| `GET` | `/markets/polymarket/{id}/history` | CLOB price history |
| `GET` | `/health` | Health check |

---

## Caveats

- **Stationarity**: bootstrap resampling assumes a time-invariant return distribution; most reliable for markets in the 20–80% probability range
- **History length**: 30–180 daily observations per market; confidence intervals are intentionally wide and surfaced in the UI
- **No liquidity model**: hedge sizes are computed from return correlations, not order book depth
- **Single pair**: stress tester validates one position + one hedge; portfolio-level joint simulation is not yet implemented

---

## Project Structure

```
Yhacks/
├── backend/
│   ├── main.py           — FastAPI routes and Pydantic models
│   ├── correlation.py    — Pearson, rolling, CCF, Granger, CUSUM
│   ├── rigorous_hedge.py — Huber IRLS, bootstrap CI, hedge ratio
│   ├── backtest.py       — Monte Carlo, scenario replay, walk-forward
│   └── requirements.txt
└── frontend/src/
    ├── App.tsx
    ├── api/client.ts
    └── components/
        ├── HedgeScanner.tsx
        ├── StrategyBuilder.tsx
        ├── BacktestPanel.tsx
        ├── StressTestDashboard.tsx
        ├── CorrelationScanner.tsx
        └── MarketCompare.tsx
```

For design decisions, algorithm derivations, and critical self-assessment: [`DESIGN.md`](./DESIGN.md)
