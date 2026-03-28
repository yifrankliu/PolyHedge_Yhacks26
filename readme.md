# PredictionAnalytics

TradFi-grade analytics dashboard bridging crypto derivatives (Deribit) and prediction markets (Polymarket + Kalshi). Prediction market contracts are mathematically identical to binary options — this is the analytical infrastructure that options traders use daily, built for prediction markets.

## Tech Stack

**Backend**
- Python 3.11 + FastAPI (port 8000)
- numpy + scipy for quantitative math
- httpx for async API calls to Polymarket, Kalshi, Deribit
- python-dotenv for secrets management

**Frontend**
- React 19 + TypeScript (port 3000)
- Recharts for 2D payoff curves
- Plotly / react-plotly.js for 3D volatility surfaces
- TailwindCSS v3 for styling
- axios for API calls

**Deployment**
- Frontend: Vercel (auto-deploy from GitHub)
- Backend: Railway (auto-deploy from GitHub)

---

## Features

### Feature 1 — What-If Trade Analyzer ✅
OptionStrat for prediction markets. Input a market price, your probability estimate, position size, and days to resolution. Outputs:
- Interactive payoff curve (P&L across 0–100% resolution probability)
- Kelly-optimal position sizing: `f* = (p_user - p_market) / (1 - p_market)`
- Half-Kelly recommendation (conservative sizing)
- Annualized return: `((1 / entry_price)^(365 / days) - 1) × 100`
- Max profit, max loss, breakeven probability, expected value
- Live market search (Polymarket + Kalshi)

### Feature 2 — Three-Way Probability Comparison (Breeden-Litzenberger) 🔜
For crypto price threshold markets on Polymarket and Kalshi, extract the risk-neutral probability density from Deribit options using the Breeden-Litzenberger formula and display all three probabilities side by side. Surfaces divergences as potential trading signals.

### Feature 3 — Portfolio Input + Aggregated View 🔜
Input multiple positions (crypto spot + prediction market contracts). Aggregates into unified expected value, correlation warnings, and a combined portfolio payoff chart.

### Feature 4 — Hedging Recommendation Scanner 🔜
Given a portfolio, scans Polymarket/Kalshi for contracts that offset the dominant risk. Shows cost of protection, hedge ratio, and the key insight: prediction market hedges are 20–40x cheaper than put options but provide binary (not linear) protection.

---

## Project Structure

```
Yhacks/
├── backend/
│   ├── main.py          — FastAPI app, all routes
│   ├── kelly.py         — Kelly criterion + payoff calculations
│   ├── bl_pipeline.py   — Breeden-Litzenberger math (Feature 2)
│   ├── portfolio.py     — Portfolio aggregation (Feature 3)
│   ├── hedge.py         — Hedging scanner (Feature 4)
│   ├── requirements.txt
│   └── .env             — API keys (never committed)
└── frontend/
    └── src/
        ├── App.tsx              — Main app with tab navigation
        ├── api/
        │   └── client.ts        — Typed axios wrappers
        └── components/
            ├── WhatIfAnalyzer.tsx
            ├── BLComparison.tsx
            ├── PortfolioInput.tsx
            └── HedgeScanner.tsx
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/whatif` | Payoff curve, Kelly sizing, annualized return |
| GET | `/markets/polymarket?search=` | Search Polymarket markets |
| GET | `/markets/kalshi?search=` | Search Kalshi markets |
| GET | `/bl-comparison` | Breeden-Litzenberger 3-way comparison |
| POST | `/portfolio/analyze` | Portfolio aggregation + EV |
| GET | `/hedge/scan` | Hedging contract scanner |
| GET | `/health` | Health check |

---

## Running Locally

```bash
# Backend
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm start
```

Add your API keys to `backend/.env`:
```
KALSHI_API_KEY=your_key_here
POLYMARKET_API_KEY=your_key_here
```

---

## Key Caveats

- Deribit RND is **risk-neutral**, not real-world probability — it overweights tail risk due to hedging demand
- BTC markets on Polymarket are **one-touch** (price touches threshold anytime); Deribit options are **European** (price at expiry) — Polymarket implied probability is structurally higher
- Kalshi fees peak at **1.75%** at 50% probability; Polymarket US charges flat **0.10%**
- Kelly sizing assumes your probability estimate is correct — always use half-Kelly as the conservative size
