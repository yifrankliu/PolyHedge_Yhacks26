import asyncio
import json
import os
import time
import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
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

# ── In-memory caches ────────────────────────────────────────────────────────────
CACHE_TTL = 3600  # 1 hour
_universe_cache: dict = {"markets": [], "fetched_at": 0.0}
_history_cache: dict[str, tuple[list, float]] = {}  # conditionId → (history, timestamp)


async def fetch_market_universe(size: int = 1000) -> list[dict]:
    """Fetch top `size` active Polymarket markets by volume from Gamma API (cached 1h)."""
    global _universe_cache
    if time.time() - _universe_cache["fetched_at"] < CACHE_TTL and len(_universe_cache["markets"]) >= size:
        return _universe_cache["markets"][:size]

    pages = size // 100
    async with httpx.AsyncClient(timeout=15) as client:
        resps = await asyncio.gather(*[
            client.get(f"{POLYMARKET_GAMMA}/markets", params={
                "limit": 100, "active": True,
                "order": "volumeNum", "ascending": False,
                "offset": i * 100,
            })
            for i in range(pages)
        ], return_exceptions=True)

    markets = []
    seen: set[str] = set()
    for resp in resps:
        if isinstance(resp, Exception) or resp.status_code != 200:
            continue
        raw = resp.json()
        page = raw if isinstance(raw, list) else raw.get("markets", [])
        for m in page:
            cid = m.get("conditionId")
            if not cid or cid in seen:
                continue
            if not m.get("clobTokenIds"):
                continue
            seen.add(cid)
            markets.append({
                "conditionId": cid,
                "question": m.get("question", ""),
                "lastTradePrice": float(m.get("lastTradePrice") or 0),
            })

    _universe_cache = {"markets": markets, "fetched_at": time.time()}
    return markets[:size]


async def fetch_clob_history_cached(condition_id: str) -> tuple[str, list] | None:
    """Fetch CLOB daily history for a conditionId, with 1h in-memory cache."""
    if condition_id in _history_cache:
        history, ts = _history_cache[condition_id]
        if time.time() - ts < CACHE_TTL:
            return ("", history)  # question not cached, but history is

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            clob_resp = await client.get(f"https://clob.polymarket.com/markets/{condition_id}")
        if clob_resp.status_code != 200:
            return None
        tokens = clob_resp.json().get("tokens") or []
        yes_token = next((t for t in tokens if t.get("outcome", "").lower() == "yes"), tokens[0] if tokens else None)
        if not yes_token:
            return None

        async with httpx.AsyncClient(timeout=15) as client:
            hist_resp = await client.get(
                "https://clob.polymarket.com/prices-history",
                params={"market": yes_token["token_id"], "interval": "max", "fidelity": 1440},
            )
        if hist_resp.status_code != 200:
            return None

        history = hist_resp.json().get("history", [])
        _history_cache[condition_id] = (history, time.time())
        return ("", history)
    except Exception:
        return None


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


@app.get("/markets/polymarket/by-slug")
async def polymarket_by_slug(slug: str = Query(..., min_length=1)):
    """Look up a single Polymarket market by its URL slug via Gamma API (bypasses Oddpool)."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{POLYMARKET_GAMMA}/markets",
            params={"slug": slug, "limit": 1},
        )
    if resp.status_code != 200:
        raise HTTPException(502, f"Gamma API error: {resp.status_code}")
    raw = resp.json()
    markets = raw if isinstance(raw, list) else raw.get("markets", [])
    if not markets:
        raise HTTPException(404, "No market found for that slug")
    m = markets[0]
    return [{
        "id": m.get("conditionId") or str(m.get("id")),
        "question": m.get("question"),
        "price": float(m.get("lastTradePrice") or 0),
        "volume": m.get("volumeNum") or m.get("volume"),
        "end_date": m.get("endDateIso") or m.get("endDate"),
        "source": "polymarket",
    }]


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

    # Fidelity (minutes per candle): use daily for long ranges to avoid point caps
    fidelity = 1440 if interval in ("max", "3m") else 60

    # Fetch price history from CLOB API
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            "https://clob.polymarket.com/prices-history",
            params={"market": token_id, "interval": interval, "fidelity": fidelity},
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

    async def fetch_history(condition_id: str) -> list[dict]:
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

    hist_a, hist_b = await asyncio.gather(fetch_history(market_a), fetch_history(market_b))

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


@app.get("/correlate/scan/stream")
async def correlate_scan_stream(market_id: str = Query(...)):
    """SSE stream: scan the Polymarket universe for markets correlated with market_id."""

    async def event_gen():
        def sse(payload: dict) -> str:
            return f"data: {json.dumps(payload)}\n\n"

        # Phase 1 — fetch universe
        try:
            universe = await fetch_market_universe(1000)
        except Exception as e:
            yield sse({"type": "error", "message": f"Universe fetch failed: {e}"})
            return

        candidates = [m for m in universe if m["conditionId"] != market_id]
        total = len(candidates)
        yield sse({"type": "init", "total": total})

        # Phase 2 — fetch target history
        target = await fetch_clob_history_cached(market_id)
        if target is None:
            yield sse({"type": "error", "message": "Could not fetch target market history"})
            return
        _, hist_a = target

        # Phase 3 — batch scan
        BATCH = 30
        scanned = 0
        found = 0

        for i in range(0, total, BATCH):
            batch = candidates[i : i + BATCH]
            results = await asyncio.gather(*[
                fetch_clob_history_cached(m["conditionId"]) for m in batch
            ], return_exceptions=True)

            for m, res in zip(batch, results):
                scanned += 1
                if isinstance(res, Exception) or res is None:
                    continue
                _, hist_b = res
                try:
                    corr = correlate(market_id, m["conditionId"], hist_a, hist_b)
                except Exception:
                    continue
                if corr is None or corr.get("error"):
                    continue
                if corr.get("composite_score", 0) > 0.1:
                    found += 1
                    yield sse({
                        "type": "result",
                        "market_id": m["conditionId"],
                        "question": m["question"],
                        "last_price": m["lastTradePrice"],
                        "composite_score": corr["composite_score"],
                        "full_pearson": corr["full_pearson"],
                        "full_pearson_returns": corr["full_pearson_returns"],
                        "best_lag_days": corr["best_lag_days"],
                        "lead_direction": corr["lead_direction"],
                        "shared_history_days": corr["shared_history_days"],
                        "n_observations": corr["n_observations"],
                        "rolling_mean": corr["rolling_mean"],
                        "rolling_std": corr["rolling_std"],
                        "break_detected": corr["break_detected"],
                        "granger_dominant_direction": corr.get("granger_dominant_direction"),
                    })

            yield sse({"type": "progress", "scanned": scanned, "total": total, "found": found})

        yield sse({"type": "done", "scanned": scanned, "found": found})

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/health")
async def health():
    return {"status": "ok"}
