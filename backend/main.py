import asyncio
import os
from typing import Optional
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
from bl_pipeline import bl_pipeline, fetch_vol_surface
from correlation import correlate
from hedge import (
    bl_confidence as compute_bl_confidence,
    compute_hedge_ratio,
    composite_hedge_score,
)

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
ODDPOOL_API_KEY = os.getenv("ODDPOOL_API_KEY", "")
ODDPOOL_BASE = "https://api.oddpool.com"


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


# ── Hedge models ──────────────────────────────────────────────────────────────

class HedgeRequest(BaseModel):
    market_id: str
    direction: str = Field(..., description="YES or NO")
    entry_price: float = Field(..., gt=0, lt=1)
    current_price: float = Field(..., ge=0, le=1)
    position_size: float = Field(..., gt=0)
    search_query: str = Field(..., min_length=1)
    asset: Optional[str] = None        # "BTC" or "ETH" — enables BL signal
    threshold: Optional[float] = None  # price threshold in USD
    expiry: Optional[str] = None       # YYYY-MM-DD


class HedgeRecommendation(BaseModel):
    candidate_market_id: str
    question: str
    current_price: float
    platform: str
    hedge_direction: str
    hedge_ratio: float
    recommended_size: float
    correlation: float
    full_pearson: float
    rolling_std: float
    lead_direction: str
    shared_history_days: float
    n_observations: int
    composite_score: float
    bl_divergence: Optional[float]
    bl_confidence: Optional[float]
    hedge_confidence: float
    confidence_label: str
    caveats: list
    stability_discounted: bool


class BLSignalOut(BaseModel):
    bl_prob: float
    bl_divergence: float
    bl_confidence: float
    bl_direction: str
    spot: Optional[float]
    strikes_used: int
    strike_range: list


class HedgeResponse(BaseModel):
    position_market_id: str
    recommendations: list
    bl_signal: Optional[BLSignalOut]
    errors: dict


# ── Shared CLOB helper ─────────────────────────────────────────────────────────

async def _fetch_clob_history(condition_id: str) -> list:
    async with httpx.AsyncClient(timeout=10) as client:
        clob_resp = await client.get(f"https://clob.polymarket.com/markets/{condition_id}")
    if clob_resp.status_code != 200:
        raise HTTPException(502, f"CLOB lookup failed for {condition_id}: {clob_resp.status_code}")
    tokens = clob_resp.json().get("tokens") or []
    yes_token = next((t for t in tokens if t.get("outcome", "").lower() == "yes"), tokens[0] if tokens else None)
    if not yes_token:
        raise HTTPException(404, f"No YES token for {condition_id}")
    token_id = yes_token["token_id"]
    async with httpx.AsyncClient(timeout=15) as client:
        hist_resp = await client.get(
            "https://clob.polymarket.com/prices-history",
            params={"market": token_id, "interval": "max", "fidelity": 1440},
        )
    if hist_resp.status_code != 200:
        raise HTTPException(502, f"CLOB history failed for {condition_id}: {hist_resp.status_code}")
    return hist_resp.json().get("history", [])


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

def _oddpool_headers() -> dict:
    if not ODDPOOL_API_KEY:
        raise HTTPException(503, "ODDPOOL_API_KEY not configured")
    return {"X-API-Key": ODDPOOL_API_KEY}


@app.get("/markets/polymarket")
async def search_polymarket(search: str = Query(..., min_length=1)):
    headers = _oddpool_headers()

    # Search events (titles) — broader match than searching market questions directly
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{ODDPOOL_BASE}/search/events",
            params={"q": search, "limit": 20},
            headers=headers,
        )
    if resp.status_code == 429:
        raise HTTPException(429, "Rate limit — wait a moment and try again")
    if resp.status_code != 200:
        raise HTTPException(502, f"Oddpool error: {resp.status_code}")

    events = resp.json() if isinstance(resp.json(), list) else []
    poly_events = [e for e in events if e.get("exchange") == "polymarket"][:5]

    seen: set[str] = set()
    results = []

    for event in poly_events:
        await asyncio.sleep(1.1)  # Oddpool burst limit: 1 req/sec
        event_id = event.get("event_id")
        async with httpx.AsyncClient(timeout=10) as client:
            mresp = await client.get(
                f"{ODDPOOL_BASE}/search/events/{event_id}/markets",
                headers=headers,
            )
        if mresp.status_code != 200:
            continue
        for m in (mresp.json() if isinstance(mresp.json(), list) else []):
            mid = m.get("market_id")
            if mid and mid not in seen:
                seen.add(mid)
                results.append({
                    "id": mid,
                    "question": m.get("question"),
                    "price": float(m.get("last_yes_price") or 0),
                    "volume": m.get("volume"),
                    "end_date": None,
                    "source": "polymarket",
                })

    return results


@app.get("/markets/kalshi")
async def search_kalshi(search: str = Query(..., min_length=1)):
    headers = _oddpool_headers()

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{ODDPOOL_BASE}/search/events",
            params={"q": search, "limit": 20},
            headers=headers,
        )
    if resp.status_code == 429:
        raise HTTPException(429, "Rate limit — wait a moment and try again")
    if resp.status_code != 200:
        raise HTTPException(502, f"Oddpool error: {resp.status_code}")

    events = resp.json() if isinstance(resp.json(), list) else []
    kalshi_events = [e for e in events if e.get("exchange") == "kalshi"][:5]

    seen: set[str] = set()
    results = []

    for event in kalshi_events:
        await asyncio.sleep(1.1)
        event_id = event.get("event_id")
        async with httpx.AsyncClient(timeout=10) as client:
            mresp = await client.get(
                f"{ODDPOOL_BASE}/search/events/{event_id}/markets",
                headers=headers,
            )
        if mresp.status_code != 200:
            continue
        for m in (mresp.json() if isinstance(mresp.json(), list) else []):
            mid = m.get("market_id")
            if mid and mid not in seen:
                seen.add(mid)
                results.append({
                    "id": mid,
                    "question": m.get("question"),
                    "price": float(m.get("last_yes_price") or 0),
                    "volume": m.get("volume"),
                    "end_date": None,
                    "source": "kalshi",
                })

    return results


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
            # Gamma API ignores text search; fetch top markets and filter locally
            terms = [t.lower() for t in f"{asset} {int(threshold)}".split() if t]
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    f"{POLYMARKET_GAMMA}/markets",
                    params={"limit": 300, "active": True, "order": "volume24hr", "ascending": False},
                )
            if resp.status_code == 200:
                raw = resp.json()
                all_markets = raw if isinstance(raw, list) else raw.get("markets", [])
                for m in all_markets:
                    q = (m.get("question") or "").lower()
                    if all(t in q for t in terms):
                        polymarket_prob = float(m.get("lastTradePrice") or 0)
                        polymarket_market = m.get("question")
                        break
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


@app.get("/markets/polymarket/{market_id}/history")
async def polymarket_history(market_id: str, interval: str = "1m"):
    # Resolve conditionId → YES token ID directly via CLOB API (no Gamma roundtrip)
    async with httpx.AsyncClient(timeout=10) as client:
        clob_resp = await client.get(f"https://clob.polymarket.com/markets/{market_id}")
    if clob_resp.status_code != 200:
        raise HTTPException(502, f"CLOB market lookup error: {clob_resp.status_code}")
    clob_market = clob_resp.json()

    tokens = clob_market.get("tokens") or []
    yes_token = next((t for t in tokens if t.get("outcome", "").lower() == "yes"), tokens[0] if tokens else None)
    if not yes_token:
        raise HTTPException(404, "No YES token found for this market")
    token_id = yes_token["token_id"]

    # Fetch price history from CLOB API
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            "https://clob.polymarket.com/prices-history",
            params={"market": token_id, "interval": interval, "fidelity": 60},
        )
    if resp.status_code != 200:
        raise HTTPException(502, f"Polymarket CLOB history error: {resp.status_code}")

    data = resp.json()
    return {
        "question": clob_market.get("question"),
        "current_price": float(yes_token.get("price") or 0),
        "end_date": clob_market.get("end_date_iso"),
        "history": [{"t": pt["t"], "p": pt["p"]} for pt in data.get("history", [])],
    }


@app.get("/correlate")
async def correlate_markets(market_a: str = Query(...), market_b: str = Query(...)):
    """Fetch daily price histories for two Polymarket markets and run the full correlation pipeline."""
    hist_a, hist_b = await asyncio.gather(_fetch_clob_history(market_a), _fetch_clob_history(market_b))

    result = correlate(market_a, market_b, hist_a, hist_b)
    if result is None:
        raise HTTPException(422, "Could not compute correlation — insufficient data")
    return result
@app.get("/vol-surface")
async def vol_surface(asset: str = Query("BTC")):
    try:
        return await fetch_vol_surface(asset)
    except Exception as e:
        raise HTTPException(502, str(e))


@app.post("/hedge", response_model=HedgeResponse)
async def hedge_scanner(req: HedgeRequest):
    """
    Given one prediction market position, find and rank hedge candidates.
    Searches Oddpool for correlated markets, computes minimum-variance hedge
    ratios, and optionally incorporates the BL options signal for crypto positions.
    """
    if req.direction not in ("YES", "NO"):
        raise HTTPException(422, "direction must be YES or NO")
    if not ODDPOOL_API_KEY:
        raise HTTPException(503, "ODDPOOL_API_KEY not configured")
    headers = {"X-API-Key": ODDPOOL_API_KEY}
    errors: dict = {}

    # ── Step 1: Fetch user's position market history ───────────────────────────
    try:
        user_history = await _fetch_clob_history(req.market_id)
    except Exception as e:
        raise HTTPException(502, f"Failed to fetch position market history: {e}")

    # ── Step 2: Run BL signal (crypto only) ───────────────────────────────────
    bl_div: Optional[float] = None
    bl_conf: Optional[float] = None
    bl_signal_out: Optional[BLSignalOut] = None

    if req.asset and req.threshold and req.expiry:
        try:
            bl_result = await bl_pipeline(req.asset, req.threshold, req.expiry)
            bl_div = bl_result["prob"] - req.current_price
            T_days = bl_result["T_years"] * 365
            bl_conf = compute_bl_confidence(bl_result, req.threshold, T_days, bl_div)
            bl_signal_out = BLSignalOut(
                bl_prob=bl_result["prob"],
                bl_divergence=round(bl_div, 4),
                bl_confidence=bl_conf,
                bl_direction="pm_underpriced" if bl_div > 0 else "pm_overpriced",
                spot=bl_result.get("spot"),
                strikes_used=bl_result.get("strikes_used", 0),
                strike_range=bl_result.get("strike_range", []),
            )
        except Exception as e:
            errors["bl"] = str(e)

    # ── Step 3: Search Oddpool for candidate markets ───────────────────────────
    candidates: list[dict] = []
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            search_resp = await client.get(
                f"{ODDPOOL_BASE}/search/events",
                params={"q": req.search_query, "limit": 20},
                headers=headers,
            )
        if search_resp.status_code == 200:
            events = search_resp.json() if isinstance(search_resp.json(), list) else []
            poly_events = [e for e in events if e.get("exchange") == "polymarket"][:4]
            seen: set[str] = set()
            for event in poly_events:
                await asyncio.sleep(1.1)
                event_id = event.get("event_id")
                async with httpx.AsyncClient(timeout=10) as client:
                    mresp = await client.get(
                        f"{ODDPOOL_BASE}/search/events/{event_id}/markets",
                        headers=headers,
                    )
                if mresp.status_code != 200:
                    continue
                for m in (mresp.json() if isinstance(mresp.json(), list) else []):
                    mid = m.get("market_id")
                    if mid and mid != req.market_id and mid not in seen:
                        seen.add(mid)
                        candidates.append({
                            "id": mid,
                            "question": m.get("question", ""),
                            "price": float(m.get("last_yes_price") or 0),
                        })
                if len(candidates) >= 8:
                    break
        else:
            errors["search"] = f"Oddpool search error: {search_resp.status_code}"
    except Exception as e:
        errors["search"] = str(e)

    if not candidates:
        return HedgeResponse(
            position_market_id=req.market_id,
            recommendations=[],
            bl_signal=bl_signal_out,
            errors={**errors, "candidates": "No candidates found — try a different search query"},
        )

    # ── Step 4: Fetch all candidate histories concurrently ─────────────────────
    hist_results = await asyncio.gather(
        *[_fetch_clob_history(c["id"]) for c in candidates],
        return_exceptions=True,
    )

    # ── Step 5: Correlate each candidate and compute hedge stats ───────────────
    recommendations: list[HedgeRecommendation] = []

    for candidate, hist in zip(candidates, hist_results):
        if isinstance(hist, Exception):
            continue
        corr = correlate(req.market_id, candidate["id"], user_history, hist)
        if corr is None or corr.get("error"):
            continue

        sigma_a = corr.get("sigma_logit_returns_a", 0.0)
        sigma_b = corr.get("sigma_logit_returns_b", 0.0)

        hedge_info = compute_hedge_ratio(
            full_pearson_returns=corr["full_pearson_returns"],
            sigma_a=sigma_a,
            sigma_b=sigma_b,
            rolling_std=corr["rolling_std"],
            break_detected=corr["break_detected"],
            position_size=req.position_size,
            direction=req.direction,
            bl_divergence=bl_div,
            bl_conf=bl_conf,
        )

        hedge_score, confidence_label, caveats = composite_hedge_score(
            corr_composite=corr["composite_score"],
            shared_history_days=corr["shared_history_days"],
            bl_confidence_score=bl_conf,
            bl_divergence=bl_div,
        )

        if corr["break_detected"]:
            caveats.append("Regime break detected — correlation may have shifted")
        if corr["rolling_std"] > 0.3:
            caveats.append("Unstable rolling correlation — stability discount applied")
        if bl_signal_out and bl_signal_out.bl_direction == "pm_overpriced":
            caveats.append("Polymarket > Deribit — may reflect one-touch vs European structure")

        recommendations.append(HedgeRecommendation(
            candidate_market_id=candidate["id"],
            question=candidate["question"],
            current_price=candidate["price"],
            platform="polymarket",
            hedge_direction=hedge_info["hedge_direction"],
            hedge_ratio=hedge_info["hedge_ratio"],
            recommended_size=hedge_info["recommended_size"],
            correlation=corr["full_pearson_returns"],
            full_pearson=corr["full_pearson"],
            rolling_std=corr["rolling_std"],
            lead_direction=corr["lead_direction"],
            shared_history_days=corr["shared_history_days"],
            n_observations=corr["n_observations"],
            composite_score=corr["composite_score"],
            bl_divergence=round(bl_div, 4) if bl_div is not None else None,
            bl_confidence=bl_conf,
            hedge_confidence=hedge_score,
            confidence_label=confidence_label,
            caveats=caveats,
            stability_discounted=hedge_info.get("stability_discounted", False),
        ))

    recommendations.sort(key=lambda x: -x.hedge_confidence)

    return HedgeResponse(
        position_market_id=req.market_id,
        recommendations=recommendations,
        bl_signal=bl_signal_out,
        errors=errors,
    )


@app.get("/health")
async def health():
    return {"status": "ok"}
