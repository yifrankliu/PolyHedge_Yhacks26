import React, { useState, useRef } from 'react';
import {
  HedgeRecommendation,
  BLSignalOut,
  FailedHedgeCandidate,
} from '../api/client';
import { PortfolioPosition } from './PortfolioInputPage';

const BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

// ── Tooltip ────────────────────────────────────────────────────────────────────

function Tooltip({ text }: { text: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="relative inline-flex items-center">
      <button
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        className="text-gray-600 hover:text-gray-400 transition-colors leading-none"
        tabIndex={-1}
        type="button"
      >
        ⓘ
      </button>
      {visible && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 bg-gray-800 border border-gray-600 text-gray-200 text-xs rounded-lg px-3 py-2 shadow-lg z-50 pointer-events-none">
          {text}
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-600" />
        </span>
      )}
    </span>
  );
}

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

function FailedCandidatesBlock({ failed }: { failed: FailedHedgeCandidate[] }) {
  const [expanded, setExpanded] = useState(false);
  if (failed.length === 0) return null;

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full px-5 py-3 border-b border-gray-700 flex items-center justify-between hover:bg-gray-800/50 transition-colors"
      >
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          {failed.length} considered but excluded
        </h3>
        <span className="text-xs text-gray-600">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left px-5 py-2.5 text-xs text-gray-500 font-medium w-8">#</th>
                <th className="text-left px-3 py-2.5 text-xs text-gray-500 font-medium">Market</th>
                <th className="text-right px-3 py-2.5 text-xs text-gray-500 font-medium">Price</th>
                <th className="text-right px-3 py-2.5 text-xs text-gray-500 font-medium">Shared days</th>
                <th className="text-right px-3 py-2.5 text-xs text-gray-500 font-medium">Spike events</th>
                <th className="text-left px-3 py-2.5 text-xs text-gray-500 font-medium">Excluded reason</th>
              </tr>
            </thead>
            <tbody>
              {failed.map((c, i) => (
                <tr key={c.candidate_market_id} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                  <td className="px-5 py-3 text-gray-500 text-xs">{i + 1}</td>
                  <td className="px-3 py-3 max-w-xs">
                    <p className="text-white text-xs leading-snug line-clamp-2">{c.question}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{c.platform}</p>
                  </td>
                  <td className="px-3 py-3 text-right text-gray-300 text-xs font-mono">{fmtPct(c.current_price)}</td>
                  <td className="px-3 py-3 text-right text-xs text-gray-400">
                    {c.shared_history_days != null ? `${c.shared_history_days}d` : '—'}
                  </td>
                  <td className="px-3 py-3 text-right text-xs text-gray-400">
                    {c.n_events != null ? c.n_events : '—'}
                  </td>
                  <td className="px-3 py-3">
                    <span className="text-xs text-red-400 bg-red-900/30 border border-red-800 rounded px-2 py-1 whitespace-nowrap">
                      {c.fail_reason}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

const DEFAULT_MIN_EVENTS = 8;
const DEFAULT_MIN_SHARED_DAYS = 32;
const DEFAULT_TOP_N = 75;

export default function HedgeScanner({ initialPositions = [] }: { initialPositions?: PortfolioPosition[] }) {
  const [scanning, setScanning] = useState(false);
  const [done, setDone] = useState(false);
  const [scanned, setScanned] = useState(0);
  const [total, setTotal] = useState(0);
  const [foundCount, setFoundCount] = useState(0);
  const [recommendations, setRecommendations] = useState<HedgeRecommendation[]>([]);
  const [failedCandidates, setFailedCandidates] = useState<FailedHedgeCandidate[]>([]);
  const [error, setError] = useState('');
  const [minEvents, setMinEvents] = useState(DEFAULT_MIN_EVENTS);
  const [minSharedDays, setMinSharedDays] = useState(DEFAULT_MIN_SHARED_DAYS);
  const [topN, setTopN] = useState(DEFAULT_TOP_N);
  const esRef = useRef<EventSource | null>(null);

  const stopScan = () => {
    esRef.current?.close();
    setScanning(false);
  };

  const scanPosition = (pos: PortfolioPosition) => {
    if (pos.source !== 'polymarket') {
      setError('Hedge scanning only supports Polymarket positions (requires price history).');
      return;
    }
    esRef.current?.close();
    setScanning(true);
    setDone(false);
    setRecommendations([]);
    setFailedCandidates([]);
    setScanned(0);
    setTotal(0);
    setFoundCount(0);
    setError('');

    const params = new URLSearchParams({
      market_id: pos.market_id,
      direction: pos.side,
      position_size: String(pos.stake_usd),
      min_events: String(minEvents),
      min_shared_days: String(minSharedDays),
      top_n: String(topN),
    });

    const es = new EventSource(`${BASE_URL}/hedge/scan/stream?${params}`);
    esRef.current = es;

    es.onmessage = (e) => {
      const d = JSON.parse(e.data);
      if (d.type === 'init') {
        setTotal(d.total);
      } else if (d.type === 'progress') {
        setScanned(d.scanned);
        setFoundCount(d.found);
      } else if (d.type === 'result') {
        setRecommendations(prev =>
          [...prev, d as HedgeRecommendation].sort((a, b) => b.hedge_confidence - a.hedge_confidence)
        );
      } else if (d.type === 'done') {
        setScanned(d.scanned);
        setFoundCount(d.found);
        setFailedCandidates((d.failed_candidates || []).slice(0, 8));
        setDone(true);
        setScanning(false);
        es.close();
      } else if (d.type === 'error') {
        setError(d.message);
        setScanning(false);
        es.close();
      }
    };
    es.onerror = () => {
      setError('Connection lost — try again.');
      setScanning(false);
      es.close();
    };
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">Hedge Scanner</h2>
        <p className="text-gray-400 text-sm mt-1">
          Scans the top 1,000 Polymarket markets — pre-filtered by semantic similarity to your position — and runs an event-study hedge analysis on the most relevant candidates. Uses Huber robust regression on spike events to estimate a blended hedge ratio, with bootstrap confidence intervals to measure reliability.
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
                <div key={pos.id} className="flex items-center gap-3 bg-gray-800 rounded-lg px-4 py-3">
                  {/* Market info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white">{pos.market_question}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {pos.source} · {pos.side} · {pos.entry_price_cents.toFixed(1)}¢ · ${pos.stake_usd}
                    </p>
                  </div>

                  {/* Threshold controls */}
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center gap-2 bg-gray-900 border border-gray-700 rounded-lg px-3 h-[38px]">
                      <span className="text-xs text-gray-400 whitespace-nowrap">min spikes =</span>
                      <input
                        type="number"
                        min={3}
                        max={50}
                        value={minEvents}
                        onChange={(e) => setMinEvents(Math.max(3, Math.min(50, Number(e.target.value))))}
                        className="w-10 bg-transparent text-white text-xs font-semibold text-center outline-none"
                      />
                      <Tooltip text={`Minimum spike events for Huber IRLS regression (default ${DEFAULT_MIN_EVENTS}). Below this the robust estimate is unreliable.`} />
                    </div>
                    <div className="flex items-center gap-2 bg-gray-900 border border-gray-700 rounded-lg px-3 h-[38px]">
                      <span className="text-xs text-gray-400 whitespace-nowrap">min days =</span>
                      <input
                        type="number"
                        min={5}
                        max={90}
                        value={minSharedDays}
                        onChange={(e) => setMinSharedDays(Math.max(5, Math.min(90, Number(e.target.value))))}
                        className="w-10 bg-transparent text-white text-xs font-semibold text-center outline-none"
                      />
                      <Tooltip text={`Minimum overlapping price history between markets (default ${DEFAULT_MIN_SHARED_DAYS}). Below this, correlation estimates are unreliable.`} />
                    </div>
                    <div className="flex items-center gap-2 bg-gray-900 border border-gray-700 rounded-lg px-3 h-[38px]">
                      <span className="text-xs text-gray-400 whitespace-nowrap">top N =</span>
                      <input
                        type="number"
                        min={10}
                        max={1000}
                        value={topN}
                        onChange={(e) => setTopN(Math.max(10, Math.min(1000, Number(e.target.value))))}
                        className="w-12 bg-transparent text-white text-xs font-semibold text-center outline-none"
                      />
                      <Tooltip text={`How many of the 1,000 universe markets to run rigorous hedge on, ranked by semantic similarity (default ${DEFAULT_TOP_N}). Raise toward 1,000 for exhaustive search.`} />
                    </div>
                  </div>

                  {/* Scan button */}
                  <button
                    onClick={() => scanning ? stopScan() : scanPosition(pos)}
                    className={`shrink-0 text-white px-4 h-[38px] rounded text-sm font-medium whitespace-nowrap flex items-center transition-colors ${
                      scanning
                        ? 'bg-red-700 hover:bg-red-600'
                        : 'bg-indigo-700 hover:bg-indigo-600'
                    }`}
                  >
                    {scanning ? 'Stop' : done ? 'Rescan' : 'Scan'}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            {/* Progress bar */}
            {(scanning || done) && total > 0 && (
              <div className="bg-gray-900 rounded-xl border border-gray-700 px-5 py-4">
                <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
                  <span>
                    {done ? 'Complete' : 'Scanning'} — {scanned.toLocaleString()} / {total.toLocaleString()} markets
                    {' · '}<span className="text-indigo-300 font-medium">{foundCount} found</span>
                  </span>
                  <span>{total > 0 ? Math.round((scanned / total) * 100) : 0}%</span>
                </div>
                <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                    style={{ width: `${total > 0 ? Math.round((scanned / total) * 100) : 0}%` }}
                  />
                </div>
              </div>
            )}

            {error && (
              <div className="bg-red-900/30 border border-red-700 rounded-xl p-4">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            {recommendations.length > 0 && (
              <>
                <p className="text-xs text-gray-500 uppercase tracking-wider">
                  {recommendations.length} hedge candidate{recommendations.length !== 1 ? 's' : ''} — ranked by confidence
                  {scanning && <span className="text-indigo-400 animate-pulse ml-2">· live</span>}
                </p>
                {recommendations.map((rec, i) => (
                  <RecommendationCard key={rec.candidate_market_id} rec={rec} index={i} />
                ))}
              </>
            )}

            {done && recommendations.length === 0 && (
              <div className="bg-gray-900 rounded-xl border border-gray-700 flex items-center justify-center h-32">
                <p className="text-gray-500 text-sm">No hedge candidates passed the quality threshold.</p>
              </div>
            )}

            {failedCandidates.length > 0 && done && (
              <FailedCandidatesBlock failed={failedCandidates} />
            )}

            {!scanning && !done && !error && (
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
