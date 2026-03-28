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

export const searchKalshi = (search: string) =>
  api.get<Market[]>('/markets/kalshi', { params: { search } }).then((r) => r.data);
