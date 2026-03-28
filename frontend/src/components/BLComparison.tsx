import { useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { blComparison, BLResponse } from '../api/client';

function ProbBar({
  label,
  prob,
  color,
  market,
}: {
  label: string;
  prob: number | null;
  color: string;
  market?: string | null;
}) {
  const pct = prob != null ? prob * 100 : null;
  return (
    <div className="bg-gray-800 rounded-xl p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-300">{label}</span>
        {pct != null ? (
          <span className={`text-2xl font-bold ${color}`}>{pct.toFixed(1)}%</span>
        ) : (
          <span className="text-gray-500 text-sm">N/A</span>
        )}
      </div>
      {pct != null && (
        <div className="w-full bg-gray-700 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all duration-700 ${color.replace('text-', 'bg-')}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {market && <p className="text-xs text-gray-500 truncate">{market}</p>}
    </div>
  );
}

function DivergenceAlert({ d }: { d: { type: string; message: string; severity: string } }) {
  const styles: Record<string, string> = {
    high: 'bg-red-900/30 border-red-700/50 text-red-300',
    medium: 'bg-amber-900/30 border-amber-700/50 text-amber-300',
    info: 'bg-blue-900/30 border-blue-700/50 text-blue-300',
  };
  const icons: Record<string, string> = { high: '⚠', medium: '△', info: 'ℹ' };
  return (
    <div className={`border rounded-lg px-4 py-3 text-sm flex gap-2 ${styles[d.severity] || styles.info}`}>
      <span>{icons[d.severity] || 'ℹ'}</span>
      <span>{d.message}</span>
    </div>
  );
}

const RndTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-600 rounded p-2 text-xs">
      <p className="text-gray-400">Strike: ${Number(label).toLocaleString()}</p>
      <p className="text-purple-400">Density: {Number(payload[0]?.value).toExponential(3)}</p>
    </div>
  );
};

export default function BLComparison() {
  const [asset, setAsset] = useState('BTC');
  const [threshold, setThreshold] = useState('');
  const [expiry, setExpiry] = useState('');
  const [polymarketId, setPolymarketId] = useState('');
  const [kalshiTicker, setKalshiTicker] = useState('');
  const [result, setResult] = useState<BLResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await blComparison({
        asset,
        threshold: parseFloat(threshold),
        expiry,
        ...(polymarketId && { polymarket_id: polymarketId }),
        ...(kalshiTicker && { kalshi_ticker: kalshiTicker }),
      });
      setResult(res);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Request failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">Three-Way Probability Comparison</h2>
        <p className="text-gray-400 text-sm mt-1">
          Breeden-Litzenberger: extract risk-neutral density from Deribit options and compare to Polymarket + Kalshi.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Input panel */}
        <div className="lg:col-span-1 bg-gray-900 rounded-xl p-6 border border-gray-700">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-gray-400 uppercase tracking-wider mb-1">Asset</label>
              <select
                value={asset}
                onChange={(e) => setAsset(e.target.value)}
                className="w-full bg-gray-700 text-white rounded px-3 py-2 border border-gray-600 focus:outline-none focus:border-indigo-500"
              >
                <option value="BTC">BTC</option>
                <option value="ETH">ETH</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-400 uppercase tracking-wider mb-1">
                Price Threshold ($)
              </label>
              <input
                type="number"
                min="1"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                placeholder="e.g. 90000"
                required
                className="w-full bg-gray-700 text-white rounded px-3 py-2 border border-gray-600 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 uppercase tracking-wider mb-1">
                Expiry Date
              </label>
              <input
                type="date"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                required
                className="w-full bg-gray-700 text-white rounded px-3 py-2 border border-gray-600 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="border-t border-gray-700 pt-4">
              <p className="text-xs text-gray-500 mb-3">Optional: pin specific markets</p>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Polymarket Market ID</label>
                  <input
                    type="text"
                    value={polymarketId}
                    onChange={(e) => setPolymarketId(e.target.value)}
                    placeholder="auto-search if blank"
                    className="w-full bg-gray-700 text-white rounded px-3 py-2 text-sm border border-gray-600 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Kalshi Ticker</label>
                  <input
                    type="text"
                    value={kalshiTicker}
                    onChange={(e) => setKalshiTicker(e.target.value)}
                    placeholder="auto-search if blank"
                    className="w-full bg-gray-700 text-white rounded px-3 py-2 text-sm border border-gray-600 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
            </div>

            {error && <p className="text-red-400 text-sm bg-red-900/30 rounded p-2">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-2.5 rounded-lg font-semibold text-sm disabled:opacity-50 transition-colors"
            >
              {loading ? 'Running BL Pipeline...' : 'Compare Probabilities'}
            </button>
          </form>
        </div>

        {/* Results panel */}
        <div className="lg:col-span-2 space-y-5">
          {result ? (
            <>
              {/* Three probability bars */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <ProbBar
                  label="Deribit (BL)"
                  prob={result.deribit_prob}
                  color="text-purple-400"
                  market={result.spot ? `Spot: $${result.spot.toLocaleString()}` : undefined}
                />
                <ProbBar
                  label="Polymarket"
                  prob={result.polymarket_prob}
                  color="text-blue-400"
                  market={result.polymarket_market}
                />
                <ProbBar
                  label="Kalshi"
                  prob={result.kalshi_prob}
                  color="text-green-400"
                  market={result.kalshi_market}
                />
              </div>

              {/* RND curve */}
              {result.rnd_curve.length > 0 && (
                <div className="bg-gray-900 rounded-xl p-6 border border-gray-700">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
                      Risk-Neutral Density (Deribit)
                    </h3>
                    <span className="text-xs text-gray-500">
                      {result.strikes_used} strikes · ${result.strike_range[0]?.toLocaleString()}–${result.strike_range[1]?.toLocaleString()}
                    </span>
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={result.rnd_curve} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                      <defs>
                        <linearGradient id="rndGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#a855f7" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#a855f7" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis
                        dataKey="strike"
                        tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                        stroke="#6b7280"
                        tick={{ fill: '#9ca3af', fontSize: 10 }}
                      />
                      <YAxis hide />
                      <Tooltip content={<RndTooltip />} />
                      <Area
                        type="monotone"
                        dataKey="density"
                        stroke="#a855f7"
                        strokeWidth={2}
                        fill="url(#rndGrad)"
                        dot={false}
                      />
                      {threshold && (
                        <ReferenceLine
                          x={parseFloat(threshold)}
                          stroke="#f59e0b"
                          strokeDasharray="4 3"
                          label={{ value: 'Threshold', position: 'top', fill: '#f59e0b', fontSize: 10 }}
                        />
                      )}
                    </AreaChart>
                  </ResponsiveContainer>
                  <p className="text-xs text-gray-600 mt-2 text-center">
                    Area to the right of threshold = Deribit-implied probability
                  </p>
                </div>
              )}

              {/* Divergence signals */}
              {result.divergences.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Divergence Signals</p>
                  {result.divergences.map((d, i) => <DivergenceAlert key={i} d={d} />)}
                </div>
              )}

              {/* Backend errors (non-fatal) */}
              {Object.keys(result.errors).length > 0 && (
                <div className="bg-gray-800 rounded-lg p-4 text-xs text-gray-500 space-y-1">
                  <p className="font-semibold text-gray-400">Partial data warnings</p>
                  {Object.entries(result.errors).map(([k, v]) => (
                    <p key={k}><span className="text-gray-400">{k}:</span> {v}</p>
                  ))}
                </div>
              )}

              {/* Caveats */}
              <div className="bg-amber-900/20 border border-amber-700/50 rounded-lg p-4 text-xs text-amber-300 space-y-1">
                <p className="font-semibold text-amber-200 mb-2">Interpretation caveats</p>
                <p>· Deribit RND is <strong>risk-neutral</strong>, not real-world probability — it overweights tail risk due to hedging demand.</p>
                <p>· Polymarket BTC markets are <strong>one-touch</strong> (price touches threshold anytime before expiry); Deribit options are <strong>European</strong> (price at expiry only) — Polymarket probability is structurally higher.</p>
                <p>· Kalshi fees peak at 1.75% at 50% probability, which compresses mid-market prices.</p>
                <p>· Large spreads between venues may reflect these structural differences rather than pure arbitrage.</p>
              </div>
            </>
          ) : (
            <div className="bg-gray-900 rounded-xl border border-gray-700 flex flex-col items-center justify-center h-64 gap-2">
              <p className="text-gray-500 text-sm">Enter an asset, price threshold, and expiry to run the BL pipeline.</p>
              <p className="text-gray-600 text-xs">Example: BTC · $90,000 · 2025-06-27</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
