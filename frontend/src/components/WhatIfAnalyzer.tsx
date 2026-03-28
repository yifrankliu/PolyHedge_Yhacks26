import React, { useState } from 'react';
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { whatif, searchPolymarket, searchKalshi, WhatIfResponse, Market } from '../api/client';

const fmt = (n: number, digits = 2) => n.toFixed(digits);
const fmtPct = (n: number) => `${fmt(n)}%`;
const fmtUsd = (n: number) => `$${fmt(Math.abs(n))}`;

function StatCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg p-4 ${highlight ? 'bg-indigo-900 border border-indigo-500' : 'bg-gray-800'}`}>
      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-xl font-bold ${highlight ? 'text-indigo-300' : 'text-white'}`}>{value}</p>
    </div>
  );
}

function MarketSearch({ onSelect }: { onSelect: (m: Market) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Market[]>([]);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<'polymarket' | 'kalshi'>('polymarket');

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const fn = source === 'polymarket' ? searchPolymarket : searchKalshi;
      setResults(await fn(query));
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mb-6">
      <p className="text-sm text-gray-400 mb-2">Search a live market (optional)</p>
      <div className="flex gap-2 mb-2">
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as 'polymarket' | 'kalshi')}
          className="bg-gray-700 text-white rounded px-3 py-2 text-sm border border-gray-600"
        >
          <option value="polymarket">Polymarket</option>
          <option value="kalshi">Kalshi</option>
        </select>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder="e.g. BTC, election, Fed rate..."
          className="flex-1 bg-gray-700 text-white rounded px-3 py-2 text-sm border border-gray-600 focus:outline-none focus:border-indigo-500"
        />
        <button
          onClick={search}
          disabled={loading}
          className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
        >
          {loading ? '...' : 'Search'}
        </button>
      </div>
      {results.length > 0 && (
        <div className="bg-gray-800 rounded-lg border border-gray-700 max-h-48 overflow-y-auto">
          {results.map((m) => (
            <button
              key={m.id}
              onClick={() => { onSelect(m); setResults([]); }}
              className="w-full text-left px-4 py-3 hover:bg-gray-700 border-b border-gray-700 last:border-0"
            >
              <p className="text-sm text-white truncate">{m.question}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {m.price != null ? `${(m.price * 100).toFixed(1)}¢` : 'N/A'} ·{' '}
                {m.source} · ends {m.end_date ? new Date(m.end_date).toLocaleDateString() : '?'}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const pnl = payload[0]?.value ?? payload[1]?.value ?? 0;
  return (
    <div className="bg-gray-900 border border-gray-600 rounded p-3 text-sm">
      <p className="text-gray-400">Prob: {label}%</p>
      <p className={pnl >= 0 ? 'text-green-400 font-bold' : 'text-red-400 font-bold'}>
        P&L: {pnl >= 0 ? '+' : ''}{fmtUsd(pnl)}
      </p>
    </div>
  );
};

export default function WhatIfAnalyzer() {
  const [marketPrice, setMarketPrice] = useState('');
  const [userProb, setUserProb] = useState('');
  const [positionSize, setPositionSize] = useState('');
  const [days, setDays] = useState('');
  const [result, setResult] = useState<WhatIfResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleMarketSelect = (m: Market) => {
    if (m.price != null) setMarketPrice((m.price * 100).toFixed(1));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await whatif({
        market_price: parseFloat(marketPrice) / 100,
        user_probability: parseFloat(userProb) / 100,
        position_size: parseFloat(positionSize),
        days_to_resolution: parseInt(days),
      });
      setResult(res);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to connect to backend.');
    } finally {
      setLoading(false);
    }
  };

  // Split payoff curve into positive/negative series for green/red coloring
  const chartData = result?.payoff_curve.map((pt) => ({
    probability: pt.probability,
    pnl_pos: pt.pnl >= 0 ? pt.pnl : 0,
    pnl_neg: pt.pnl < 0 ? pt.pnl : 0,
    pnl: pt.pnl,
  }));

  const kellyPct = result ? (result.kelly_fraction * 100).toFixed(1) : null;
  const halfKellyPct = result ? (result.half_kelly * 100).toFixed(1) : null;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">What-If Trade Analyzer</h2>
        <p className="text-gray-400 text-sm mt-1">
          OptionStrat for prediction markets — see your edge, optimal sizing, and full payoff curve.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Input panel */}
        <div className="lg:col-span-1 bg-gray-900 rounded-xl p-6 border border-gray-700">
          <MarketSearch onSelect={handleMarketSelect} />

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-gray-400 uppercase tracking-wider mb-1">
                Market Price (¢)
              </label>
              <input
                type="number"
                min="1" max="99" step="0.1"
                value={marketPrice}
                onChange={(e) => setMarketPrice(e.target.value)}
                placeholder="e.g. 65"
                required
                className="w-full bg-gray-700 text-white rounded px-3 py-2 border border-gray-600 focus:outline-none focus:border-indigo-500"
              />
              <p className="text-xs text-gray-500 mt-1">Current price in cents (1–99)</p>
            </div>

            <div>
              <label className="block text-xs text-gray-400 uppercase tracking-wider mb-1">
                Your Probability Estimate (%)
              </label>
              <input
                type="number"
                min="1" max="99" step="0.1"
                value={userProb}
                onChange={(e) => setUserProb(e.target.value)}
                placeholder="e.g. 75"
                required
                className="w-full bg-gray-700 text-white rounded px-3 py-2 border border-gray-600 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 uppercase tracking-wider mb-1">
                Position Size ($)
              </label>
              <input
                type="number"
                min="1" step="1"
                value={positionSize}
                onChange={(e) => setPositionSize(e.target.value)}
                placeholder="e.g. 500"
                required
                className="w-full bg-gray-700 text-white rounded px-3 py-2 border border-gray-600 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 uppercase tracking-wider mb-1">
                Days to Resolution
              </label>
              <input
                type="number"
                min="1"
                value={days}
                onChange={(e) => setDays(e.target.value)}
                placeholder="e.g. 30"
                required
                className="w-full bg-gray-700 text-white rounded px-3 py-2 border border-gray-600 focus:outline-none focus:border-indigo-500"
              />
            </div>

            {error && (
              <p className="text-red-400 text-sm bg-red-900/30 rounded p-2">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-2.5 rounded-lg font-semibold text-sm disabled:opacity-50 transition-colors"
            >
              {loading ? 'Calculating...' : 'Analyze Trade'}
            </button>
          </form>
        </div>

        {/* Results panel */}
        <div className="lg:col-span-2 space-y-6">
          {result ? (
            <>
              {/* Payoff chart */}
              <div className="bg-gray-900 rounded-xl p-6 border border-gray-700">
                <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">
                  Payoff at Resolution
                </h3>
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                    <defs>
                      <linearGradient id="gradGreen" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#22c55e" stopOpacity={0.05} />
                      </linearGradient>
                      <linearGradient id="gradRed" x1="0" y1="1" x2="0" y2="0">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis
                      dataKey="probability"
                      tickFormatter={(v) => `${v}%`}
                      stroke="#6b7280"
                      tick={{ fill: '#9ca3af', fontSize: 11 }}
                      label={{ value: 'Resolution Probability', position: 'insideBottom', offset: -2, fill: '#6b7280', fontSize: 11 }}
                    />
                    <YAxis
                      tickFormatter={(v) => `$${v}`}
                      stroke="#6b7280"
                      tick={{ fill: '#9ca3af', fontSize: 11 }}
                    />
                    <Tooltip content={<CustomTooltip />} />

                    <Area
                      type="monotone"
                      dataKey="pnl_pos"
                      stroke="#22c55e"
                      strokeWidth={2}
                      fill="url(#gradGreen)"
                      dot={false}
                      activeDot={false}
                      name="Profit"
                    />
                    <Area
                      type="monotone"
                      dataKey="pnl_neg"
                      stroke="#ef4444"
                      strokeWidth={2}
                      fill="url(#gradRed)"
                      dot={false}
                      activeDot={false}
                      name="Loss"
                    />

                    {/* Zero line */}
                    <ReferenceLine y={0} stroke="#4b5563" strokeWidth={1} />

                    {/* Market price line */}
                    <ReferenceLine
                      x={parseFloat(marketPrice)}
                      stroke="#f59e0b"
                      strokeDasharray="4 3"
                      strokeWidth={1.5}
                      label={{ value: 'Market', position: 'top', fill: '#f59e0b', fontSize: 10 }}
                    />

                    {/* User probability line */}
                    <ReferenceLine
                      x={parseFloat(userProb)}
                      stroke="#818cf8"
                      strokeDasharray="4 3"
                      strokeWidth={1.5}
                      label={{ value: 'Your Est.', position: 'top', fill: '#818cf8', fontSize: 10 }}
                    />

                    {/* Breakeven */}
                    <ReferenceLine
                      y={0}
                      x={result.breakeven_probability}
                      stroke="#6b7280"
                      strokeDasharray="2 4"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
                <div className="flex gap-4 mt-2 text-xs text-gray-500">
                  <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-amber-400 inline-block" /> Market price</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-indigo-400 inline-block" /> Your estimate</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-green-500 inline-block" /> Profit zone</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-red-500 inline-block" /> Loss zone</span>
                </div>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Max Profit" value={`+$${fmt(result.max_profit)}`} />
                <StatCard label="Max Loss" value={`-$${fmt(result.max_loss)}`} />
                <StatCard label="Breakeven" value={fmtPct(result.breakeven_probability)} />
                <StatCard
                  label="Expected Value"
                  value={`${result.expected_value >= 0 ? '+' : ''}$${fmt(result.expected_value)}`}
                  highlight
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Your Edge" value={`${result.edge >= 0 ? '+' : ''}${fmtPct(result.edge * 100)}`} />
                <StatCard label="Annlzd Return" value={`${fmt(result.annualized_return)}%`} />
                <StatCard label="Kelly Size" value={`${kellyPct}% of bankroll`} />
                <StatCard label="Half-Kelly (rec.)" value={`${halfKellyPct}% of bankroll`} highlight />
              </div>

              {/* Caveats */}
              <div className="bg-amber-900/20 border border-amber-700/50 rounded-lg p-4 text-xs text-amber-300 space-y-1">
                <p className="font-semibold text-amber-200 mb-2">Important caveats</p>
                <p>· Kelly sizing assumes your probability estimate is correct. Half-Kelly is the recommended conservative size.</p>
                <p>· Polymarket US charges 0.10% flat; Kalshi fees peak at 1.75% at 50% probability — these reduce your effective edge.</p>
                <p>· Expected value is calculated using your probability estimate, not the market's.</p>
              </div>
            </>
          ) : (
            <div className="bg-gray-900 rounded-xl border border-gray-700 flex items-center justify-center h-64">
              <p className="text-gray-500 text-sm">Fill in the form and click Analyze Trade to see results.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
