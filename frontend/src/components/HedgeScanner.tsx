import React, { useState } from 'react';
import {
  scanHedges,
  HedgeRequest,
  HedgeResponse,
  HedgeRecommendation,
  BLSignalOut,
} from '../api/client';
import { PortfolioPosition } from './PortfolioInputPage';

// ── Helpers ────────────────────────────────────────────────────────────────────

const fmt2 = (n: number) => n.toFixed(2);
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fmtPp = (n: number) => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}pp`;

function confidenceColor(label: string) {
  if (label === 'High confidence') return 'text-green-400';
  if (label === 'Moderate confidence') return 'text-yellow-400';
  return 'text-gray-400';
}

function confidenceBadgeBg(label: string) {
  if (label === 'High confidence') return 'bg-green-900 text-green-300 border-green-700';
  if (label === 'Moderate confidence') return 'bg-yellow-900 text-yellow-300 border-yellow-700';
  return 'bg-gray-800 text-gray-400 border-gray-600';
}

function correlationColor(r: number) {
  if (r > 0.5) return 'text-green-400';
  if (r > 0.2) return 'text-green-300';
  if (r < -0.5) return 'text-red-400';
  if (r < -0.2) return 'text-red-300';
  return 'text-gray-400';
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function BLSignalCard({ signal }: { signal: BLSignalOut }) {
  const isUnder = signal.bl_direction === 'pm_underpriced';
  const confPct = Math.round(signal.bl_confidence * 100);

  return (
    <div className="bg-gray-900 rounded-xl border border-indigo-800 p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-indigo-300 uppercase tracking-wider">
          Breeden-Litzenberger Options Signal
        </h3>
        <span className={`text-xs px-2 py-0.5 rounded border ${
          signal.bl_confidence >= 0.6
            ? 'bg-green-900 text-green-300 border-green-700'
            : signal.bl_confidence >= 0.35
            ? 'bg-yellow-900 text-yellow-300 border-yellow-700'
            : 'bg-gray-800 text-gray-400 border-gray-600'
        }`}>
          BL confidence: {confPct}%
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-gray-800 rounded-lg p-3">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Deribit-implied P</p>
          <p className="text-xl font-bold text-white">{fmtPct(signal.bl_prob)}</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-3">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Divergence vs PM</p>
          <p className={`text-xl font-bold ${isUnder ? 'text-green-400' : 'text-red-400'}`}>
            {fmtPp(signal.bl_divergence)}
          </p>
        </div>
        <div className="bg-gray-800 rounded-lg p-3">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">BTC Spot</p>
          <p className="text-xl font-bold text-white">
            {signal.spot != null ? `$${signal.spot.toLocaleString()}` : '—'}
          </p>
        </div>
        <div className="bg-gray-800 rounded-lg p-3">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Strikes used</p>
          <p className="text-xl font-bold text-white">{signal.strikes_used}</p>
          {signal.strike_range.length === 2 && (
            <p className="text-xs text-gray-500 mt-0.5">
              ${signal.strike_range[0].toLocaleString()}–${signal.strike_range[1].toLocaleString()}
            </p>
          )}
        </div>
      </div>

      <p className={`text-xs mt-3 ${isUnder ? 'text-green-300' : 'text-red-300'}`}>
        {isUnder
          ? 'Deribit options traders think this event is MORE likely than Polymarket prices — hedge sizing reduced.'
          : 'Deribit options traders think this event is LESS likely than Polymarket prices — hedge sizing increased.'}
      </p>

      {signal.bl_confidence < 0.35 && (
        <p className="text-xs text-yellow-400 mt-1">
          Low BL confidence — options data may be thin at this strike/expiry. Signal not applied to hedge ratios.
        </p>
      )}
    </div>
  );
}

function RecommendationCard({ rec, index }: { rec: HedgeRecommendation; index: number }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
      {/* Header row */}
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-gray-500 font-mono">#{index + 1}</span>
              <span className={`text-xs px-2 py-0.5 rounded border font-medium ${confidenceBadgeBg(rec.confidence_label)}`}>
                {rec.confidence_label}
              </span>
              {rec.stability_discounted && (
                <span className="text-xs bg-orange-900 text-orange-300 border border-orange-700 px-2 py-0.5 rounded">
                  Stability discounted
                </span>
              )}
            </div>
            <p className="text-sm text-white font-medium leading-snug">{rec.question}</p>
            <p className="text-xs text-gray-400 mt-1">
              {rec.platform} · current price {fmtPct(rec.current_price)} ·{' '}
              {Math.round(rec.shared_history_days)}d shared history
            </p>
          </div>

          {/* Hedge action */}
          <div className="flex-shrink-0 text-right">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-0.5">Take</p>
            <p className={`text-lg font-bold ${rec.hedge_direction === 'YES' ? 'text-green-400' : 'text-red-400'}`}>
              {rec.hedge_direction}
            </p>
            <p className="text-xs text-gray-400">@ ${fmt2(rec.recommended_size)}</p>
          </div>
        </div>

        {/* Key stats */}
        <div className="grid grid-cols-4 gap-2 mt-4">
          <div className="bg-gray-800 rounded p-2.5">
            <p className="text-xs text-gray-500 mb-0.5">Correlation</p>
            <p className={`text-sm font-bold ${correlationColor(rec.correlation)}`}>
              {rec.correlation >= 0 ? '+' : ''}{rec.correlation.toFixed(3)}
            </p>
            <p className="text-xs text-gray-600">returns</p>
          </div>
          <div className="bg-gray-800 rounded p-2.5">
            <p className="text-xs text-gray-500 mb-0.5">Hedge ratio</p>
            <p className="text-sm font-bold text-white">{fmtPct(rec.hedge_ratio)}</p>
            <p className="text-xs text-gray-600">of position</p>
          </div>
          <div className="bg-gray-800 rounded p-2.5">
            <p className="text-xs text-gray-500 mb-0.5">Composite</p>
            <p className={`text-sm font-bold ${confidenceColor(rec.confidence_label)}`}>
              {rec.hedge_confidence.toFixed(2)}
            </p>
            <p className="text-xs text-gray-600">score</p>
          </div>
          <div className="bg-gray-800 rounded p-2.5">
            <p className="text-xs text-gray-500 mb-0.5">BL signal</p>
            {rec.bl_divergence != null ? (
              <>
                <p className={`text-sm font-bold ${rec.bl_divergence >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {fmtPp(rec.bl_divergence)}
                </p>
                <p className="text-xs text-gray-600">conf {Math.round((rec.bl_confidence ?? 0) * 100)}%</p>
              </>
            ) : (
              <p className="text-sm text-gray-600">—</p>
            )}
          </div>
        </div>

        {/* Caveats */}
        {rec.caveats.length > 0 && (
          <div className="mt-3 space-y-1">
            {rec.caveats.map((c, i) => (
              <p key={i} className="text-xs text-yellow-400">· {c}</p>
            ))}
          </div>
        )}

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(e => !e)}
          className="mt-3 text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          {expanded ? 'Hide details ▲' : 'Show details ▼'}
        </button>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-gray-800 px-5 py-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
          <div>
            <p className="text-gray-500 uppercase tracking-wider mb-0.5">Pearson (levels)</p>
            <p className="text-white">{rec.full_pearson >= 0 ? '+' : ''}{rec.full_pearson.toFixed(4)}</p>
          </div>
          <div>
            <p className="text-gray-500 uppercase tracking-wider mb-0.5">Rolling std</p>
            <p className="text-white">{rec.rolling_std.toFixed(4)}</p>
          </div>
          <div>
            <p className="text-gray-500 uppercase tracking-wider mb-0.5">Lead/Lag</p>
            <p className="text-white">{rec.lead_direction.replace(/_/g, ' ')}</p>
          </div>
          <div>
            <p className="text-gray-500 uppercase tracking-wider mb-0.5">Observations</p>
            <p className="text-white">{rec.n_observations}</p>
          </div>
          <div>
            <p className="text-gray-500 uppercase tracking-wider mb-0.5">Corr composite</p>
            <p className="text-white">{rec.composite_score.toFixed(3)}</p>
          </div>
          <div>
            <p className="text-gray-500 uppercase tracking-wider mb-0.5">Market ID</p>
            <p className="text-gray-400 font-mono truncate">{rec.candidate_market_id}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function HedgeScanner({ initialPositions = [] }: { initialPositions?: PortfolioPosition[] }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<HedgeResponse | null>(null);
  const [error, setError] = useState('');

  const handleSubmit = async (req: HedgeRequest) => {
    setError('');
    setLoading(true);
    setResult(null);
    try {
      setResult(await scanHedges(req));
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to connect to backend.');
    } finally {
      setLoading(false);
    }
  };

  const scanPosition = (pos: PortfolioPosition) => {
    if (pos.source !== 'polymarket') {
      setError('Hedge scanning only supports Polymarket positions (requires price history).');
      return;
    }
    const req: HedgeRequest = {
      market_id: pos.market_id,
      direction: pos.side,
      entry_price: pos.entry_price_cents / 100,
      current_price: pos.entry_price_cents / 100,
      position_size: pos.stake_usd,
      search_query: pos.market_question.split(' ').slice(0, 6).join(' '),
    };
    handleSubmit(req);
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">Hedge Scanner</h2>
        <p className="text-gray-400 text-sm mt-1">
          Finds correlated markets to hedge your positions. Uses minimum-variance sizing with
          optional Deribit options signal for crypto markets.
        </p>
      </div>

      {initialPositions.length === 0 ? (
        <div className="bg-gray-900 rounded-xl border border-gray-700 flex items-center justify-center h-48">
          <p className="text-gray-500 text-sm">Add positions in the Position Input tab, then click Scan for Hedges.</p>
        </div>
      ) : (
        <>
          <div className="bg-gray-900 rounded-xl border border-gray-700 p-5 mb-6">
            <p className="text-sm font-semibold text-gray-200 mb-3">
              Your Positions ({initialPositions.length})
            </p>
            <div className="space-y-2">
              {initialPositions.map((pos) => (
                <div key={pos.id} className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-3">
                  <div>
                    <p className="text-sm text-white">{pos.market_question}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {pos.source} · {pos.side} · {pos.entry_price_cents.toFixed(1)}¢ · ${pos.stake_usd}
                    </p>
                  </div>
                  <button
                    onClick={() => scanPosition(pos)}
                    disabled={loading}
                    className="ml-4 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white px-4 py-1.5 rounded text-sm font-medium whitespace-nowrap"
                  >
                    {loading ? '…' : 'Scan'}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            {loading && (
              <div className="bg-gray-900 rounded-xl border border-gray-700 flex items-center justify-center h-48">
                <div className="text-center">
                  <p className="text-gray-300 font-medium animate-pulse">Scanning markets…</p>
                  <p className="text-gray-500 text-xs mt-1">Fetching price histories and computing correlations</p>
                </div>
              </div>
            )}

            {error && (
              <div className="bg-red-900/30 border border-red-700 rounded-xl p-4">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            {result && !loading && (
              <>
                {Object.keys(result.errors).length > 0 && (
                  <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-4">
                    {Object.entries(result.errors).map(([k, v]) => (
                      <p key={k} className="text-xs text-yellow-300">· <span className="font-medium">{k}:</span> {v}</p>
                    ))}
                  </div>
                )}

                {result.bl_signal && <BLSignalCard signal={result.bl_signal} />}

                {result.recommendations.length === 0 ? (
                  <div className="bg-gray-900 rounded-xl border border-gray-700 flex items-center justify-center h-40">
                    <p className="text-gray-500 text-sm">No hedge candidates found. Try a position with more trading history.</p>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-gray-500 uppercase tracking-wider">
                      {result.recommendations.length} hedge candidate{result.recommendations.length !== 1 ? 's' : ''} — ranked by confidence
                    </p>
                    {result.recommendations.map((rec, i) => (
                      <RecommendationCard key={rec.candidate_market_id} rec={rec} index={i} />
                    ))}
                  </>
                )}
              </>
            )}

            {!result && !loading && !error && (
              <div className="bg-gray-900 rounded-xl border border-gray-700 flex items-center justify-center h-48">
                <p className="text-gray-500 text-sm">Select a position above to scan for hedges.</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
