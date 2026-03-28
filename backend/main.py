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
from bl_pipeline import bl_pipeline

load_dotenv()

app = FastAPI(title="Prediction Market Analytics API")

ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "https://yhacks-mu.vercel.app",
    os.getenv("FRONTEND_URL", ""),
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o for o in ALLOWED_ORIGINS if o],
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


@app.get("/bl-comparison")
async def bl_comparison(
    asset: str = Query(..., description="BTC or ETH"),
    threshold: float = Query(..., description="Price threshold in USD"),
    expiry: str = Query(..., description="Expiry date YYYY-MM-DD"),
    polymarket_id: str = Query(None, description="Optional Polymarket market ID"),
    kalshi_ticker: str = Query(None, description="Optional Kalshi ticker"),
):
    errors = {}

    # ── Deribit BL pipeline ───────────────────────────────────────────────────
    deribit_result = None
    try:
        deribit_result = await bl_pipeline(asset, threshold, expiry)
    except Exception as e:
        errors["deribit"] = str(e)

    # ── Polymarket probability ────────────────────────────────────────────────
    polymarket_prob = None
    polymarket_market = None
    try:
        if polymarket_id:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(f"{POLYMARKET_GAMMA}/markets/{polymarket_id}")
            if resp.status_code == 200:
                m = resp.json()
                polymarket_prob = float(m.get("lastTradePrice", 0))
                polymarket_market = m.get("question")
        else:
            # Auto-search for matching market
            query = f"{asset} {int(threshold)}"
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    f"{POLYMARKET_GAMMA}/markets",
                    params={"search": query, "limit": 5, "active": True},
                )
            if resp.status_code == 200:
                markets = resp.json()
                if isinstance(markets, list) and markets:
                    m = markets[0]
                    polymarket_prob = float(m.get("lastTradePrice", 0))
                    polymarket_market = m.get("question")
    except Exception as e:
        errors["polymarket"] = str(e)

    # ── Kalshi probability ────────────────────────────────────────────────────
    kalshi_prob = None
    kalshi_market = None
    try:
        headers = {}
        if KALSHI_API_KEY:
            headers["Authorization"] = f"Token {KALSHI_API_KEY}"
        if kalshi_ticker:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    f"{KALSHI_BASE}/markets/{kalshi_ticker}", headers=headers
                )
            if resp.status_code == 200:
                m = resp.json().get("market", {})
                last = m.get("last_price")
                kalshi_prob = last / 100 if last else None
                kalshi_market = m.get("title")
        else:
            query = f"{asset} {int(threshold)}"
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    f"{KALSHI_BASE}/markets",
                    params={"search": query, "limit": 5, "status": "open"},
                    headers=headers,
                )
            if resp.status_code == 200:
                markets = resp.json().get("markets", [])
                if markets:
                    m = markets[0]
                    last = m.get("last_price")
                    kalshi_prob = last / 100 if last else None
                    kalshi_market = m.get("title")
    except Exception as e:
        errors["kalshi"] = str(e)

    # ── Divergence signals ────────────────────────────────────────────────────
    divergences = []
    deribit_prob = deribit_result["prob"] if deribit_result else None

    probs = {k: v for k, v in {
        "Polymarket": polymarket_prob,
        "Kalshi": kalshi_prob,
        "Deribit": deribit_prob,
    }.items() if v is not None}

    if len(probs) >= 2:
        vals = list(probs.values())
        spread = max(vals) - min(vals)
        if spread >= 0.10:
            high = max(probs, key=probs.get)
            low = min(probs, key=probs.get)
            divergences.append({
                "type": "large_spread",
                "message": f"{high} ({probs[high]*100:.1f}%) is {spread*100:.1f}pp above {low} ({probs[low]*100:.1f}%)",
                "severity": "high" if spread >= 0.15 else "medium",
            })
        if deribit_prob and polymarket_prob:
            diff = polymarket_prob - deribit_prob
            if diff > 0.05:
                divergences.append({
                    "type": "one_touch_premium",
                    "message": f"Polymarket is {diff*100:.1f}pp above Deribit — consistent with one-touch vs European structure",
                    "severity": "info",
                })

    return {
        "deribit_prob": deribit_prob,
        "polymarket_prob": polymarket_prob,
        "kalshi_prob": kalshi_prob,
        "polymarket_market": polymarket_market,
        "kalshi_market": kalshi_market,
        "rnd_curve": deribit_result["rnd_curve"] if deribit_result else [],
        "spot": deribit_result["spot"] if deribit_result else None,
        "strikes_used": deribit_result["strikes_used"] if deribit_result else 0,
        "strike_range": deribit_result["strike_range"] if deribit_result else [],
        "divergences": divergences,
        "errors": errors,
    }


@app.get("/health")
async def health():
    return {"status": "ok"}
