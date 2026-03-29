# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PolyHedge is a TradFi-grade analytics dashboard for prediction markets (Polymarket + Kalshi), treating prediction market contracts as binary options. Feature 1 (What-If Trade Analyzer) is complete; Features 2–4 are planned stubs.

## Commands

### Backend (Python 3.11 + FastAPI)
```bash
cd backend
source venv/bin/activate          # activate virtualenv
uvicorn main:app --reload --port 8000  # dev server
```

### Frontend (React 19 + TypeScript)
```bash
cd frontend
npm start          # dev server on port 3000
npm run build      # production build
npm test           # run tests (jest + react-testing-library)
```

### Environment
Copy keys into `backend/.env`:
```
KALSHI_API_KEY=
POLYMARKET_API_KEY=
```
CORS is configured for `localhost:3000` and the `FRONTEND_URL` env var (set for production deployments).

## Architecture

**Backend** (`backend/`)
- `main.py` — FastAPI app; all route definitions and Pydantic request/response models
- `kelly.py` — Pure math module: Kelly criterion, payoff curve generation, annualized return, breakeven probability. No I/O.
- Planned stubs: `bl_pipeline.py` (Breeden-Litzenberger), `portfolio.py`, `hedge.py`

**Frontend** (`frontend/src/`)
- `App.tsx` — Tab shell; only the "What-If" tab is active (others disabled with "soon" label)
- `api/client.ts` — Typed axios wrappers (`whatif()`, `searchPolymarket()`, `searchKalshi()`); base URL defaults to `localhost:8000`, overridable via `REACT_APP_API_URL`
- `components/WhatIfAnalyzer.tsx` — The only active component; handles market search, form inputs, Recharts payoff curve, and statistics grid

**Data flow:** Frontend calls `api/client.ts` → FastAPI routes in `main.py` → `kelly.py` for math + httpx for external APIs (Polymarket Gamma API, Kalshi trade API)

## Key Domain Rules

- All prices are decimal fractions `(0, 1)`, not percentages
- Kelly formula: `f* = (p_user - p_market) / (1 - p_market)`; always present half-Kelly as the conservative recommendation
- Annualized return: `((1 / entry_price)^(365 / days) - 1) × 100`
- Polymarket uses Gamma API (`gamma-api.polymarket.com`); Kalshi uses `api.elections.kalshi.com/trade-api/v2` with `Token` auth header
- Kalshi prices come back as integers (0–100); divide by 100 to normalize
- Deribit-derived probabilities are risk-neutral (overweight tails); Polymarket BTC markets are one-touch vs. Deribit's European-style — these are not directly comparable

## Deployment

- **Backend**: Railway — `Procfile` runs `uvicorn main:app --host 0.0.0.0 --port $PORT`; `runtime.txt` pins Python 3.11
- **Frontend**: Vercel — auto-deploys from GitHub main branch
