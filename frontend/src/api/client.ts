import axios from 'axios';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:8000',
});

export interface Market {
  id: string;
  question: string;
  price: number | null;
  volume: number | null;
  end_date: string | null;
  source: 'polymarket' | 'kalshi';
}

export const searchPolymarket = (search: string) =>
  api.get<Market[]>('/markets/polymarket', { params: { search } }).then((r) => r.data);

export const searchKalshi = (search: string) =>
  api.get<Market[]>('/markets/kalshi', { params: { search } }).then((r) => r.data);

export const getPolymarketMarket = (marketId: string) =>
  api.get<Market>(`/markets/polymarket/${marketId}`).then((r) => r.data);

export const getKalshiMarket = (ticker: string) =>
  api.get<Market>(`/markets/kalshi/${ticker}`).then((r) => r.data);

export interface RndPoint {
  strike: number;
  density: number;
}

export interface Divergence {
  type: string;
  message: string;
  severity: 'high' | 'medium' | 'info';
}

export interface BLResponse {
  deribit_prob: number | null;
  polymarket_prob: number | null;
  kalshi_prob: number | null;
  polymarket_market: string | null;
  kalshi_market: string | null;
  rnd_curve: RndPoint[];
  spot: number | null;
  strikes_used: number;
  strike_range: number[];
  divergences: Divergence[];
  errors: Record<string, string>;
}

export interface PricePoint {
  t: number;
  p: number;
}

export interface MarketHistory {
  question: string;
  current_price: number;
  end_date: string | null;
  history: PricePoint[];
}

export const lookupPolymarketBySlug = (slug: string) =>
  api.get<Market[]>('/markets/polymarket/by-slug', { params: { slug } }).then(r => r.data);

export const getPolymarketHistory = (marketId: string, interval = '1m') =>
  api.get<MarketHistory>(`/markets/polymarket/${marketId}/history`, { params: { interval } }).then(r => r.data);

export interface RollingPoint { t: number; r: number; }
export interface LagPoint    { lag: number; r: number; }

export interface CorrelationResult {
  market_a: string;
  market_b: string;
  shared_history_days: number;
  n_observations: number;
  full_pearson: number;
  full_pearson_returns: number;
  rolling_mean: number;
  rolling_std: number;
  rolling_pct_positive: number;
  rolling_series: RollingPoint[];
  break_detected: boolean;
  cusum_pval: number;
  pre_break_pearson: number | null;
  post_break_pearson: number | null;
  best_lag_days: number;
  lag_correlation: number;
  lead_direction: string;
  lag_series: LagPoint[];
  a_causes_b_pval: number;
  b_causes_a_pval: number;
  granger_dominant_direction: string | null;
  low_volume_warning: boolean;
  short_history_warning: boolean;
  resolution_convergence: boolean;
  semantic_similarity: number;
  end_date_proximity: number;
  composite_score: number;
  error?: string;
}

export const correlateMarkets = (marketA: string, marketB: string) =>
  api.get<CorrelationResult>('/correlate', { params: { market_a: marketA, market_b: marketB } }).then(r => r.data);

export const searchPolymarketUnified = (q: string) =>
  api.get<Market[]>('/markets/polymarket/search', { params: { q } }).then(r => r.data);

export const blComparison = (params: {
  asset: string;
  threshold: number;
  expiry: string;
  polymarket_id?: string;
  kalshi_ticker?: string;
}) => api.get<BLResponse>('/bl-comparison', { params }).then((r) => r.data);

export interface VolSurfaceRow {
  expiry: string;
  dte: number;
  strike: number;
  iv: number;
}

export interface VolSurfaceResponse {
  expiries: string[];
  surface: VolSurfaceRow[];
}

export const getVolSurface = (asset: string) =>
  api.get<VolSurfaceResponse>('/vol-surface', { params: { asset } }).then((r) => r.data);

// ── Hedge Scanner ──────────────────────────────────────────────────────────────

export interface HedgeRequest {
  market_id: string;
  direction: 'YES' | 'NO';
  entry_price: number;
  current_price: number;
  position_size: number;
  search_query: string;
  asset?: string;
  threshold?: number;
  expiry?: string;
  min_events?: number;
  min_shared_days?: number;
}

export interface HedgeRecommendation {
  candidate_market_id: string;
  question: string;
  current_price: number;
  platform: string;
  hedge_direction: 'YES' | 'NO';
  hedge_ratio: number;
  recommended_size: number;
  correlation: number;
  full_pearson: number;
  rolling_std: number;
  lead_direction: string;
  shared_history_days: number;
  n_observations: number;
  composite_score: number;
  bl_divergence: number | null;
  bl_confidence: number | null;
  hedge_confidence: number;
  confidence_label: string;
  caveats: string[];
  stability_discounted: boolean;
}

export interface BLSignalOut {
  bl_prob: number;
  bl_divergence: number;
  bl_confidence: number;
  bl_direction: string;
  spot: number | null;
  strikes_used: number;
  strike_range: number[];
}

export interface FailedHedgeCandidate {
  candidate_market_id: string;
  question: string;
  platform: string;
  current_price: number;
  fail_reason: string;
  shared_history_days: number | null;
  n_events: number | null;
}

export interface HedgeResponse {
  position_market_id: string;
  recommendations: HedgeRecommendation[];
  failed_candidates: FailedHedgeCandidate[];
  bl_signal: BLSignalOut | null;
  errors: Record<string, string>;
}

export const scanHedges = (req: HedgeRequest) =>
  api.post<HedgeResponse>('/hedge', req).then((r) => r.data);
