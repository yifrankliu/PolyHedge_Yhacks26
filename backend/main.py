import asyncio
import json
import os
import time
from datetime import datetime, timezone
import httpx
import numpy as np
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
CACHE_TTL = 3600       # 1 hour  (universe + history)
TAG_CACHE_TTL = 86_400 # 24 hours (tags rarely change)
_universe_cache: dict = {"markets": [], "fetched_at": 0.0}
_history_cache: dict[str, tuple[list, float]] = {}  # conditionId → (history, timestamp)
_tag_cache: dict = {"tags": [], "fetched_at": 0.0}

# ── Semantic embedding helpers ───────────────────────────────────────────────
_embed_model = None
_embed_model_attempted = False


def _get_embed_model():
    """Lazy-load sentence-transformers model; returns None if unavailable."""
    global _embed_model, _embed_model_attempted
    if _embed_model_attempted:
        return _embed_model
    _embed_model_attempted = True
    try:
        from sentence_transformers import SentenceTransformer
        _embed_model = SentenceTransformer("all-MiniLM-L6-v2")
    except Exception:
        _embed_model = None
    return _embed_model


def compute_semantic_similarity(q_a: str, q_b: str) -> float:
    """Cosine similarity between two market question embeddings. Returns 0.0 on failure."""
    if not q_a or not q_b:
        return 0.0
    model = _get_embed_model()
    if model is None:
        return 0.0
    try:
        embs = model.encode([q_a, q_b], normalize_embeddings=True, show_progress_bar=False)
        return float(np.clip(np.dot(embs[0], embs[1]), 0.0, 1.0))
    except Exception:
        return 0.0


def batch_semantic_similarities(target_question: str, candidate_questions: list[str]) -> list[float]:
    """Encode target + all candidates in one pass; returns per-candidate cosine similarities."""
    if not target_question or not candidate_questions:
        return [0.0] * len(candidate_questions)
    model = _get_embed_model()
    if model is None:
        return [0.0] * len(candidate_questions)
    try:
        all_q = [target_question] + candidate_questions
        embs = model.encode(all_q, normalize_embeddings=True, batch_size=256, show_progress_bar=False)
        target_emb = embs[0]
        sims = np.clip(np.dot(embs[1:], target_emb), 0.0, 1.0).tolist()
        return sims
    except Exception:
        return [0.0] * len(candidate_questions)


def compute_end_date_proximity(end_a: str | None, end_b: str | None) -> float:
    """Returns 1.0 if same day, linear decay to 0.0 at 60 days apart."""
    if not end_a or not end_b:
        return 0.0
    try:
        def parse(s: str):
            s = s.replace("Z", "+00:00")
            return datetime.fromisoformat(s)
        days_apart = abs((parse(end_a) - parse(end_b)).days)
        return float(max(0.0, 1.0 - days_apart / 60.0))
    except Exception:
        return 0.0


async def fetch_market_universe(size: int = 1000) -> list[dict]:
    """Fetch top `size` genuinely open Polymarket markets by volume from Gamma API (cached 1h).

    Filters applied:
    - closed=false  (excludes resolved markets; active=True alone does NOT mean open)
    - 0.04 <= lastTradePrice <= 0.96  (excludes effectively resolved markets)
    - Fetches extra pages to account for the filter reducing the raw count
    """
    global _universe_cache
    if time.time() - _universe_cache["fetched_at"] < CACHE_TTL and len(_universe_cache["markets"]) >= size:
        return _universe_cache["markets"][:size]

    # Fetch 2× pages to compensate for filtering; dedup by conditionId
    pages = (size * 2) // 100
    async with httpx.AsyncClient(timeout=15) as client:
        resps = await asyncio.gather(*[
            client.get(f"{POLYMARKET_GAMMA}/markets", params={
                "limit": 100,
                "active": "true",
                "closed": "false",        # exclude resolved/closed markets
                "order": "volumeNum",
                "ascending": "false",
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
            # Exclude effectively resolved markets (price near 0 or 1)
            price = float(m.get("lastTradePrice") or 0)
            if price < 0.04 or price > 0.96:
                continue
            seen.add(cid)
            markets.append({
                "conditionId": cid,
                "question": m.get("question", ""),
                "lastTradePrice": price,
                "endDate": m.get("endDateIso") or m.get("endDate"),
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
        if not history:
            return None
        # Reject stale markets: last price point must be within 75 days
        last_ts = history[-1].get("t", 0)
        if time.time() - last_ts > 75 * 86400:
            return None
        _history_cache[condition_id] = (history, time.time())
        return ("", history)
    except Exception:
        return None


# ── Tag helpers ───────────────────────────────────────────────────────────────

async def fetch_tags_cached() -> list[dict]:
    """Fetch all Gamma tags, cached 24h. Returns [{id, slug, label, count}]."""
    global _tag_cache
    if time.time() - _tag_cache["fetched_at"] < TAG_CACHE_TTL and _tag_cache["tags"]:
        print(f"[TAGS] fetch_tags_cached: serving {len(_tag_cache['tags'])} tags from cache")
        return _tag_cache["tags"]
    url = f"{POLYMARKET_GAMMA}/tags"
    print(f"[TAGS] fetch_tags_cached → GET {url} params={{limit: 200}}")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, params={"limit": 200})
        print(f"[TAGS] fetch_tags_cached ← status={resp.status_code} body[:200]={resp.text[:200]!r}")
        if resp.status_code == 200:
            tags = resp.json() if isinstance(resp.json(), list) else []
            print(f"[TAGS] fetch_tags_cached: fetched {len(tags)} tags, caching")
            _tag_cache = {"tags": tags, "fetched_at": time.time()}
            return tags
    except Exception as e:
        print(f"[TAGS] fetch_tags_cached EXCEPTION: {type(e).__name__}: {e}")
    print(f"[TAGS] fetch_tags_cached: returning stale ({len(_tag_cache['tags'])} tags)")
    return _tag_cache["tags"]  # serve stale on failure


# ── Unified search helpers ─────────────────────────────────────────────────────

def _tag_fuzzy_score(query: str, label: str, slug: str) -> float:
    """Returns 0.0–1.0 similarity between query and a tag. Exact=1.0, substring=0.8, word-overlap proportional."""
    if query == label or query == slug:
        return 1.0
    if query in label or query in slug:
        return 0.8
    query_words = set(query.split())
    label_words = set(label.split())
    if not query_words:
        return 0.0
    return len(query_words & label_words) / len(query_words) * 0.7


async def _gamma_public_search(q: str) -> list[dict]:
    """Hit Gamma /public-search — the same engine polymarket.com uses."""
    try:
        # Note: keep_closed_markets omitted — Gamma rejects Python False ("False" != "false")
        # events_status=active already filters to open markets
        params = {"q": q, "limit_per_type": 20, "events_status": "active"}
        url = f"{POLYMARKET_GAMMA}/public-search"
        print(f"[SEARCH] _gamma_public_search → GET {url} params={params}")
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.get(url, params=params)
        print(f"[SEARCH] _gamma_public_search ← status={resp.status_code} body[:200]={resp.text[:200]!r}")
        if resp.status_code != 200:
            return []
        data = resp.json()
        # public-search returns {events: [{..., markets: [...]}, ...], pagination: {...}}
        # markets can also appear at the top level in some API versions — check both
        print(f"[SEARCH] _gamma_public_search parsed: top-level keys={list(data.keys() if isinstance(data, dict) else [])}")
        results = []

        def _extract_market(m: dict, source_label: str):
            cid = m.get("conditionId") or str(m.get("id", ""))
            if not cid:
                return
            results.append({
                "id": cid,
                "question": m.get("question", ""),
                "price": float(m.get("lastTradePrice") or 0),
                "volume": m.get("volumeNum") or m.get("volume"),
                "end_date": m.get("endDateIso") or m.get("endDate"),
                "source": "polymarket",
                "_rank_source": source_label,
            })

        if isinstance(data, dict):
            # Markets nested inside events
            for event in data.get("events", []):
                for m in event.get("markets", []):
                    _extract_market(m, "gamma_search")
                # Some events are themselves binary markets
                if event.get("conditionId"):
                    _extract_market(event, "gamma_search")
            # Top-level markets array (older API versions)
            for m in data.get("markets", []):
                _extract_market(m, "gamma_search")
        elif isinstance(data, list):
            for m in data:
                _extract_market(m, "gamma_search")

        # Dedup by conditionId within this source
        seen, deduped = set(), []
        for r in results:
            if r["id"] not in seen:
                seen.add(r["id"])
                deduped.append(r)

        print(f"[SEARCH] _gamma_public_search returning {len(deduped)} markets (raw={len(results)})")
        return deduped
    except Exception as e:
        print(f"[SEARCH] _gamma_public_search EXCEPTION: {type(e).__name__}: {e}")
        return []


async def _gamma_tag_search(q: str) -> list[dict]:
    """Fuzzy-match query against cached tag list; fetch top markets for best-matching tag."""
    try:
        tags = await fetch_tags_cached()
        print(f"[SEARCH] _gamma_tag_search: tags_loaded={len(tags)} query={q!r}")
        if not tags:
            return []
        q_lower = q.lower()
        best_tag, best_score = None, 0.0
        for tag in tags:
            score = _tag_fuzzy_score(q_lower, (tag.get("label") or "").lower(), (tag.get("slug") or "").lower())
            if score > best_score:
                best_score, best_tag = score, tag
        print(f"[SEARCH] _gamma_tag_search: best_tag={best_tag and best_tag.get('label')!r} score={best_score:.3f} threshold=0.4")
        if not best_tag or best_score < 0.4:
            print(f"[SEARCH] _gamma_tag_search: score below threshold, returning []")
            return []
        # Use lowercase string "false" — httpx serializes Python False as "False" which Gamma rejects
        params = {"tag_id": best_tag["id"], "closed": "false", "order": "volumeNum", "ascending": "false", "limit": 15}
        url = f"{POLYMARKET_GAMMA}/markets"
        print(f"[SEARCH] _gamma_tag_search → GET {url} params={params}")
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.get(url, params=params)
        print(f"[SEARCH] _gamma_tag_search ← status={resp.status_code} body[:200]={resp.text[:200]!r}")
        if resp.status_code != 200:
            return []
        raw = resp.json()
        markets = raw if isinstance(raw, list) else raw.get("markets", [])
        results = [
            {
                "id": m.get("conditionId") or str(m.get("id", "")),
                "question": m.get("question", ""),
                "price": float(m.get("lastTradePrice") or 0),
                "volume": m.get("volumeNum") or m.get("volume"),
                "end_date": m.get("endDateIso") or m.get("endDate"),
                "source": "polymarket",
                "_rank_source": "gamma_tag",
            }
            for m in markets if m.get("conditionId") or m.get("id")
        ]
        print(f"[SEARCH] _gamma_tag_search returning {len(results)} markets")
        return results
    except Exception as e:
        print(f"[SEARCH] _gamma_tag_search EXCEPTION: {type(e).__name__}: {e}")
        return []


async def _oddpool_search_supplement(q: str) -> list[dict]:
    """Oddpool search capped at 2 events (~2.2s max). Supplement only."""
    if not ODDPOOL_API_KEY:
        print(f"[SEARCH] _oddpool_search_supplement: skipped (no API key)")
        return []
    headers = {"X-API-Key": ODDPOOL_API_KEY}
    try:
        url = f"{ODDPOOL_BASE}/search/events"
        params = {"q": q, "limit": 20}
        print(f"[SEARCH] _oddpool_search_supplement → GET {url} params={params}")
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, params=params, headers=headers)
        print(f"[SEARCH] _oddpool_search_supplement ← status={resp.status_code} body[:200]={resp.text[:200]!r}")
        if resp.status_code != 200:
            return []
        events = resp.json() if isinstance(resp.json(), list) else []
        poly_events = [e for e in events if e.get("exchange") == "polymarket"][:2]
        print(f"[SEARCH] _oddpool_search_supplement: total_events={len(events)} poly_events={len(poly_events)}")
        results, seen = [], set()
        for event in poly_events:
            await asyncio.sleep(1.1)
            event_id = event.get("event_id")
            murl = f"{ODDPOOL_BASE}/search/events/{event_id}/markets"
            print(f"[SEARCH] _oddpool_search_supplement → GET {murl}")
            async with httpx.AsyncClient(timeout=10) as client:
                mresp = await client.get(murl, headers=headers)
            print(f"[SEARCH] _oddpool_search_supplement ← markets status={mresp.status_code} body[:200]={mresp.text[:200]!r}")
            if mresp.status_code != 200:
                continue
            for m in (mresp.json() if isinstance(mresp.json(), list) else []):
                mid = m.get("market_id")
                if mid and mid not in seen:
                    seen.add(mid)
                    results.append({
                        "id": mid,
                        "question": m.get("question", ""),
                        "price": float(m.get("last_yes_price") or 0),
                        "volume": m.get("volume"),
                        "end_date": None,
                        "source": "polymarket",
                        "_rank_source": "oddpool",
                    })
        print(f"[SEARCH] _oddpool_search_supplement returning {len(results)} markets")
        return results
    except Exception as e:
        print(f"[SEARCH] _oddpool_search_supplement EXCEPTION: {type(e).__name__}: {e}")
        return []


def _merge_search_results(
    gamma_results: list[dict],
    tag_results: list[dict],
    oddpool_results: list[dict],
) -> list[dict]:
    """Merge, deduplicate, and rank results. Priority: Gamma search > tag > Oddpool."""
    seen_ids: set[str] = set()
    seen_questions: list[str] = []
    merged: list[dict] = []

    def _q_is_dupe(q: str) -> bool:
        q_w = set(q.lower().split())
        for existing in seen_questions:
            if q_w and len(q_w & set(existing.split())) / len(q_w) > 0.70:
                return True
        return False

    def _add(item: dict):
        cid = item.get("id", "")
        if cid and cid in seen_ids:
            return
        if cid:
            seen_ids.add(cid)
        seen_questions.append((item.get("question") or "").lower())
        merged.append({k: v for k, v in item.items() if not k.startswith("_")})

    for item in gamma_results:
        _add(item)
    for item in tag_results:
        if item.get("id", "") not in seen_ids:
            _add(item)
    for item in oddpool_results:
        if not _q_is_dupe((item.get("question") or "").lower()):
            _add(item)

    return merged[:25]


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
                    params={"limit": 300, "active": "true", "order": "volume24hr", "ascending": "false"},
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


@app.get("/markets/tags")
async def list_tags():
    """Return all Polymarket tags (cached 24h). Used by the tag-chip UI in MarketSearchWidget."""
    tags = await fetch_tags_cached()
    return [
        {"id": t.get("id"), "slug": t.get("slug"), "label": t.get("label"), "count": t.get("count", 0)}
        for t in tags if t.get("id") and t.get("label")
    ]


@app.get("/markets/polymarket/by-tag")
async def markets_by_tag(tag_id: int = Query(...), limit: int = Query(20, le=50)):
    """Fetch open Polymarket markets for a specific tag_id, ordered by volume."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{POLYMARKET_GAMMA}/markets",
            params={"tag_id": tag_id, "closed": "false", "order": "volumeNum", "ascending": "false", "limit": limit},
        )
    if resp.status_code != 200:
        raise HTTPException(502, f"Gamma API error: {resp.status_code}")
    raw = resp.json()
    markets = raw if isinstance(raw, list) else raw.get("markets", [])
    return [
        {
            "id": m.get("conditionId") or str(m.get("id")),
            "question": m.get("question"),
            "price": float(m.get("lastTradePrice") or 0),
            "volume": m.get("volumeNum") or m.get("volume"),
            "end_date": m.get("endDateIso") or m.get("endDate"),
            "source": "polymarket",
        }
        for m in markets if m.get("conditionId") or m.get("id")
    ]


@app.get("/markets/polymarket/search")
async def search_polymarket_unified(q: str = Query(..., min_length=1)):
    """
    Unified Polymarket search: Gamma /public-search + tag fuzzy-match + Oddpool supplement,
    all run in parallel. Results deduplicated and merged (max 25).
    """
    print(f"\n[SEARCH] ── /markets/polymarket/search q={q!r} ──────────────────────")

    async def _empty() -> list:
        return []

    gamma_task   = _gamma_public_search(q)
    tag_task     = _gamma_tag_search(q)
    oddpool_task = _oddpool_search_supplement(q) if ODDPOOL_API_KEY else _empty()

    gamma_results, tag_results, oddpool_results = await asyncio.gather(
        gamma_task, tag_task, oddpool_task, return_exceptions=True
    )

    print(f"[SEARCH] gather results: gamma={repr(gamma_results)[:120]} tag={repr(tag_results)[:80]} oddpool={repr(oddpool_results)[:80]}")

    gamma_list   = gamma_results   if isinstance(gamma_results, list)   else []
    tag_list     = tag_results     if isinstance(tag_results, list)     else []
    oddpool_list = oddpool_results if isinstance(oddpool_results, list) else []

    print(f"[SEARCH] counts before merge: gamma={len(gamma_list)} tag={len(tag_list)} oddpool={len(oddpool_list)}")
    if not isinstance(gamma_results, list):
        print(f"[SEARCH] gamma EXCEPTION: {gamma_results}")
    if not isinstance(tag_results, list):
        print(f"[SEARCH] tag EXCEPTION: {tag_results}")
    if not isinstance(oddpool_results, list):
        print(f"[SEARCH] oddpool EXCEPTION: {oddpool_results}")

    merged = _merge_search_results(gamma_list, tag_list, oddpool_list)
    print(f"[SEARCH] merged total={len(merged)} returning to client")
    return merged


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

    async def _fetch_history(iv: str) -> list:
        fidelity = 1440 if iv in ("max", "3m") else 60
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                "https://clob.polymarket.com/prices-history",
                params={"market": token_id, "interval": iv, "fidelity": fidelity},
            )
        return r.json().get("history", []) if r.status_code == 200 else []

    history = await _fetch_history(interval)

    # Auto-widen if the requested interval returned too little data (e.g. resolved market
    # opened in comparator via the scanner which used max-range data)
    FALLBACK_CHAIN = ["3m", "max"]
    for fallback in FALLBACK_CHAIN:
        if len(history) >= 10 or interval == "max":
            break
        history = await _fetch_history(fallback)
        interval = fallback  # update so we don't loop needlessly

    if not history:
        raise HTTPException(502, "Polymarket CLOB returned no price history for this market")

    return {
        "question": clob_market.get("question"),
        "current_price": float(yes_token.get("price") or 0),
        "end_date": clob_market.get("end_date_iso"),
        "history": [{"t": pt["t"], "p": pt["p"]} for pt in history],
    }


@app.get("/correlate")
async def correlate_markets(market_a: str = Query(...), market_b: str = Query(...)):
    """Fetch daily price histories for two Polymarket markets and run the full correlation pipeline."""

    async def fetch_history(condition_id: str) -> tuple[str, list, str | None]:
        """Returns (question, history_points, end_date_iso)."""
        async with httpx.AsyncClient(timeout=10) as client:
            clob_resp = await client.get(f"https://clob.polymarket.com/markets/{condition_id}")
        if clob_resp.status_code != 200:
            raise HTTPException(502, f"CLOB lookup failed for {condition_id}: {clob_resp.status_code}")
        clob_data = clob_resp.json()
        tokens = clob_data.get("tokens") or []
        yes_token = next((t for t in tokens if t.get("outcome", "").lower() == "yes"), tokens[0] if tokens else None)
        if not yes_token:
            raise HTTPException(404, f"No YES token for {condition_id}")
        token_id = yes_token["token_id"]
        question = clob_data.get("question", "")
        end_date = clob_data.get("end_date_iso") or clob_data.get("end_date")
        async with httpx.AsyncClient(timeout=15) as client:
            hist_resp = await client.get(
                "https://clob.polymarket.com/prices-history",
                params={"market": token_id, "interval": "max", "fidelity": 1440},
            )
        if hist_resp.status_code != 200:
            raise HTTPException(502, f"CLOB history failed for {condition_id}: {hist_resp.status_code}")
        return question, hist_resp.json().get("history", []), end_date

    (q_a, hist_a, end_a), (q_b, hist_b, end_b) = await asyncio.gather(
        fetch_history(market_a), fetch_history(market_b)
    )

    sem_sim   = compute_semantic_similarity(q_a, q_b)
    end_prox  = compute_end_date_proximity(end_a, end_b)

    result = correlate(market_a, market_b, hist_a, hist_b,
                       semantic_similarity=sem_sim,
                       end_date_proximity=end_prox)
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

        # Phase 2 — fetch target history + resolve target question/end-date
        target = await fetch_clob_history_cached(market_id)
        if target is None:
            yield sse({"type": "error", "message": "Could not fetch target market history"})
            return
        _, hist_a = target

        # Resolve target question & end-date (may already be in universe)
        target_meta = next((m for m in universe if m["conditionId"] == market_id), None)
        target_question = target_meta["question"] if target_meta else ""
        target_end_date = target_meta.get("endDate") if target_meta else None

        # Pre-compute all candidate embeddings in one batch (fast: ~0.1s for 1000 items)
        candidate_questions = [m["question"] for m in candidates]
        semantic_sims = batch_semantic_similarities(target_question, candidate_questions)

        # Phase 3 — batch scan
        BATCH = 30
        scanned = 0
        found = 0

        for i in range(0, total, BATCH):
            batch = candidates[i : i + BATCH]
            results = await asyncio.gather(*[
                fetch_clob_history_cached(m["conditionId"]) for m in batch
            ], return_exceptions=True)

            for j, (m, res) in enumerate(zip(batch, results)):
                scanned += 1
                if isinstance(res, Exception) or res is None:
                    continue
                _, hist_b = res
                sem_sim  = semantic_sims[i + j]
                end_prox = compute_end_date_proximity(target_end_date, m.get("endDate"))
                try:
                    corr = correlate(market_id, m["conditionId"], hist_a, hist_b,
                                     semantic_similarity=sem_sim,
                                     end_date_proximity=end_prox)
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
                        "semantic_similarity": corr["semantic_similarity"],
                        "end_date_proximity": corr["end_date_proximity"],
                        "resolution_convergence": corr.get("resolution_convergence", False),
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
