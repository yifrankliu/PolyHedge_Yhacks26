import os
import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv

from kelly import (
    compute_payoff_curve,
    kelly_fraction,
    annualized_return,
    max_profit,
    breakeven_probability,
)

load_dotenv()

app = FastAPI(title="Prediction Market Analytics API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

KALSHI_API_KEY = os.getenv("KALSHI_API_KEY", "")
KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2"
POLYMARKET_GAMMA = "https://gamma-api.polymarket.com"


# ── Request / Response models ──────────────────────────────────────────────────

class WhatIfRequest(BaseModel):
    market_price: float = Field(..., gt=0, lt=1, description="Entry price 0–1")
    user_probability: float = Field(..., ge=0, le=1, description="Your prob estimate 0–1")
    position_size: float = Field(..., gt=0, description="Dollars to risk")
    days_to_resolution: int = Field(..., gt=0, description="Days until market resolves")


class WhatIfResponse(BaseModel):
    payoff_curve: list
    kelly_fraction: float
    half_kelly: float
    annualized_return: float
    max_profit: float
    max_loss: float
    breakeven_probability: float
    expected_value: float
    edge: float  # user_prob - market_price


# ── Feature 1: What-If Analyzer ───────────────────────────────────────────────

@app.post("/whatif", response_model=WhatIfResponse)
async def whatif(req: WhatIfRequest):
    kf = kelly_fraction(req.user_probability, req.market_price)
    ar = annualized_return(req.market_price, req.days_to_resolution)
    mp = max_profit(req.market_price, req.position_size)
    bp = breakeven_probability(req.market_price)
    contracts = req.position_size / req.market_price
    ev = contracts * (req.user_probability * (1 - req.market_price) - (1 - req.user_probability) * req.market_price)

    return WhatIfResponse(
        payoff_curve=compute_payoff_curve(req.market_price, req.position_size),
        kelly_fraction=round(kf, 4),
        half_kelly=round(kf / 2, 4),
        annualized_return=round(ar, 2),
        max_profit=round(mp, 2),
        max_loss=round(req.position_size, 2),
        breakeven_probability=round(bp, 2),
        expected_value=round(ev, 2),
        edge=round(req.user_probability - req.market_price, 4),
    )


# ── Market search endpoints ────────────────────────────────────────────────────

@app.get("/markets/polymarket")
async def search_polymarket(search: str = Query(..., min_length=1)):
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{POLYMARKET_GAMMA}/markets",
            params={"search": search, "limit": 10, "active": True},
        )
    if resp.status_code != 200:
        raise HTTPException(502, f"Polymarket error: {resp.status_code}")
    markets = resp.json()
    return [
        {
            "id": m.get("id"),
            "question": m.get("question"),
            "price": float(m.get("lastTradePrice", 0)),
            "volume": m.get("volume"),
            "end_date": m.get("endDate"),
            "source": "polymarket",
        }
        for m in (markets if isinstance(markets, list) else markets.get("markets", []))
    ]


@app.get("/markets/kalshi")
async def search_kalshi(search: str = Query(..., min_length=1)):
    headers = {}
    if KALSHI_API_KEY:
        headers["Authorization"] = f"Token {KALSHI_API_KEY}"
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{KALSHI_BASE}/markets",
            params={"search": search, "limit": 10, "status": "open"},
            headers=headers,
        )
    if resp.status_code != 200:
        raise HTTPException(502, f"Kalshi error: {resp.status_code}")
    data = resp.json()
    return [
        {
            "id": m.get("ticker"),
            "question": m.get("title"),
            "price": m.get("last_price", 0) / 100 if m.get("last_price") else None,
            "volume": m.get("volume"),
            "end_date": m.get("close_time"),
            "source": "kalshi",
        }
        for m in data.get("markets", [])
    ]


@app.get("/health")
async def health():
    return {"status": "ok"}
