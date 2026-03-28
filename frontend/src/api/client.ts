import axios from 'axios';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'https://yhacks-production.up.railway.app',
});

export interface WhatIfRequest {
  market_price: number;
  user_probability: number;
  position_size: number;
  days_to_resolution: number;
}

export interface PayoffPoint {
  probability: number;
  pnl: number;
}

export interface WhatIfResponse {
  payoff_curve: PayoffPoint[];
  kelly_fraction: number;
  half_kelly: number;
  annualized_return: number;
  max_profit: number;
  max_loss: number;
  breakeven_probability: number;
  expected_value: number;
  edge: number;
}

export interface Market {
  id: string;
  question: string;
  price: number | null;
  volume: number | null;
  end_date: string | null;
  source: 'polymarket' | 'kalshi';
}

export const whatif = (req: WhatIfRequest) =>
  api.post<WhatIfResponse>('/whatif', req).then((r) => r.data);

export const searchPolymarket = (search: string) =>
  api.get<Market[]>('/markets/polymarket', { params: { search } }).then((r) => r.data);
  console.log("executed searchPolymarket");

export const searchKalshi = (search: string) =>
  api.get<Market[]>('/markets/kalshi', { params: { search } }).then((r) => r.data);

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

export const getPolymarketHistory = (marketId: string, interval = '1m') =>
  api.get<MarketHistory>(`/markets/polymarket/${marketId}/history`, { params: { interval } }).then(r => r.data);

export const blComparison = (params: {
  asset: string;
  threshold: number;
  expiry: string;
  polymarket_id?: string;
  kalshi_ticker?: string;
}) => api.get<BLResponse>('/bl-comparison', { params }).then((r) => r.data);
