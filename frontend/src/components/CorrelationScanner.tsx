import { useState, useRef } from 'react';
import { Market } from '../api/client';
import MarketSearchWidget from './MarketSearchWidget';

const BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

interface ScanResult {
  market_id: string;
  question: string;
  last_price: number;
  composite_score: number;
  full_pearson: number;
  full_pearson_returns: number;
  best_lag_days: number;
  lead_direction: string;
  shared_history_days: number;
  n_observations: number;
  rolling_mean: number;
  rolling_std: number;
  break_detected: boolean;
  granger_dominant_direction: string | null;
  semantic_similarity: number;
  end_date_proximity: number;
  resolution_convergence: boolean;
}

function pearsonColor(r: number): string {
  if (r > 0.5) return '#34d399';
  if (r > 0.2) return '#86efac';
  if (r < -0.5) return '#f87171';
  if (r < -0.2) return '#fca5a5';
  return '#9ca3af';
}

function compositeBar(score: number) {
  const pct = Math.round(score * 100);
  const color = score > 0.6 ? '#34d399' : score > 0.35 ? '#fbbf24' : '#9ca3af';
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-mono text-gray-300">{score.toFixed(2)}</span>
    </div>
  );
}

function lagLabel(best_lag_days: number, lead_direction: string): string {
  if (best_lag_days === 0) return 'Sync';
  const abs = Math.abs(best_lag_days);
  return lead_direction === 'A_leads_B' ? `A+${abs}d` : `B+${abs}d`;
}

function semanticBar(sim: number) {
  // MiniLM cosine sims: ~0.1 floor, ~0.8+ = very similar; normalize display to 0.1–0.8 range
  const pct = Math.round(Math.max(0, Math.min(1, (sim - 0.1) / 0.7)) * 100);
  const color = sim > 0.55 ? '#818cf8' : sim > 0.35 ? '#a78bfa' : '#6b7280';
  return (
    <div className="flex items-center gap-2">
      <div className="w-12 h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-mono" style={{ color }}>{sim.toFixed(2)}</span>
    </div>
  );
}

export default function CorrelationScanner({ onCompare }: { onCompare: (target: Market, correlated: Market) => void }) {
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);

  const [scanning, setScanning] = useState(false);
  const [done, setDone] = useState(false);
  const [scanned, setScanned] = useState(0);
  const [total, setTotal] = useState(0);
  const [found, setFound] = useState(0);
  const [results, setResults] = useState<ScanResult[]>([]);
  const [error, setError] = useState('');

  const esRef = useRef<EventSource | null>(null);

  const handleMarketSelect = (m: Market) => {
    if (!m.id) { setSelectedMarket(null); return; }
    setSelectedMarket(m);
    setResults([]);
    setDone(false);
    setScanned(0);
    setTotal(0);
    setFound(0);
    setError('');
  };

  const startScan = () => {
    if (!selectedMarket?.id) return;
    esRef.current?.close();
    setScanning(true);
    setDone(false);
    setResults([]);
    setScanned(0);
    setTotal(0);
    setFound(0);
    setError('');

    const es = new EventSource(
      `${BASE_URL}/correlate/scan/stream?market_id=${encodeURIComponent(selectedMarket.id)}`
    );
    esRef.current = es;

    es.onmessage = (e) => {
      const d = JSON.parse(e.data);
      if (d.type === 'init') {
        setTotal(d.total);
      } else if (d.type === 'progress') {
        setScanned(d.scanned);
        setFound(d.found);
      } else if (d.type === 'result') {
        setResults(prev =>
          [...prev, d as ScanResult].sort((a, b) => b.composite_score - a.composite_score)
        );
      } else if (d.type === 'done') {
        setScanned(d.scanned);
        setFound(d.found);
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
      setError('Connection lost — try again');
      setScanning(false);
      es.close();
    };
  };

  const stopScan = () => {
    esRef.current?.close();
    setScanning(false);
  };

  const progressPct = total > 0 ? Math.round((scanned / total) * 100) : 0;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">Correlation Scanner</h2>
        <p className="text-gray-400 text-sm mt-1">
          Pick any market and scan the top 1,000 Polymarket markets to find the most statistically correlated ones.
        </p>
      </div>

      {/* Market selector */}
      <div className="mb-5">
        <MarketSearchWidget
          label="Target Market"
          selected={selectedMarket}
          onSelect={handleMarketSelect}
          placeholder="Search or paste a Polymarket URL..."
        />
      </div>

      {/* Scan controls */}
      <div className="flex items-center gap-4 mb-5">
        <button
          onClick={scanning ? stopScan : startScan}
          disabled={!selectedMarket}
          className={`px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            scanning
              ? 'bg-red-700 hover:bg-red-600 text-white'
              : 'bg-indigo-600 hover:bg-indigo-500 text-white'
          }`}
        >
          {scanning ? 'Stop Scan' : done ? 'Scan Again' : 'Scan 1,000 Markets'}
        </button>

        {(scanning || done) && total > 0 && (
          <div className="flex-1">
            <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
              <span>
                {done ? 'Complete' : 'Scanning'} — {scanned.toLocaleString()} / {total.toLocaleString()} markets · <span className="text-indigo-300 font-medium">{found} found</span>
              </span>
              <span>{progressPct}%</span>
            </div>
            <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 mb-5 text-sm text-red-400">{error}</div>
      )}

      {/* Results table */}
      {results.length > 0 && (
        <div className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-700 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Top Correlated Markets {!done && <span className="text-indigo-400 animate-pulse">· live</span>}
            </h3>
            <span className="text-xs text-gray-500">{results.length} results</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left px-5 py-2.5 text-xs text-gray-500 font-medium w-8">#</th>
                  <th className="text-left px-3 py-2.5 text-xs text-gray-500 font-medium">Market</th>
                  <th className="text-right px-3 py-2.5 text-xs text-gray-500 font-medium">Price</th>
                  <th className="text-left px-3 py-2.5 text-xs text-gray-500 font-medium">Composite</th>
                  <th className="text-right px-3 py-2.5 text-xs text-gray-500 font-medium">Pearson r</th>
                  <th className="text-left px-3 py-2.5 text-xs text-gray-500 font-medium">Semantic</th>
                  <th className="text-right px-3 py-2.5 text-xs text-gray-500 font-medium">Lead/Lag</th>
                  <th className="text-right px-3 py-2.5 text-xs text-gray-500 font-medium">Days</th>
                  <th className="px-3 py-2.5 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {results.slice(0, 25).map((r, i) => (
                  <tr key={r.market_id} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                    <td className="px-5 py-3 text-gray-500 text-xs">{i + 1}</td>
                    <td className="px-3 py-3 max-w-xs">
                      <p className="text-white text-xs leading-snug line-clamp-2">{r.question}</p>
                      {r.break_detected && (
                        <span className="text-xs text-orange-400 mt-0.5 block">⚠ regime break</span>
                      )}
                      {r.resolution_convergence && (
                        <span className="text-xs text-yellow-600 mt-0.5 block">⚠ resolution convergence</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right text-gray-300 text-xs font-mono">
                      {(r.last_price * 100).toFixed(1)}¢
                    </td>
                    <td className="px-3 py-3">{compositeBar(r.composite_score)}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs font-bold" style={{ color: pearsonColor(r.full_pearson) }}>
                      {r.full_pearson >= 0 ? '+' : ''}{r.full_pearson.toFixed(3)}
                    </td>
                    <td className="px-3 py-3">
                      {semanticBar(r.semantic_similarity ?? 0)}
                    </td>
                    <td className="px-3 py-3 text-right text-xs text-gray-400">
                      {lagLabel(r.best_lag_days, r.lead_direction)}
                    </td>
                    <td className="px-3 py-3 text-right text-xs text-gray-500">
                      {Math.round(r.shared_history_days)}d
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button
                        onClick={() => onCompare(
                          selectedMarket!,
                          {
                            id: r.market_id,
                            question: r.question,
                            price: r.last_price,
                            volume: null,
                            end_date: null,
                            source: 'polymarket',
                          }
                        )}
                        className="text-xs bg-indigo-800 hover:bg-indigo-700 text-indigo-200 px-2 py-1 rounded transition-colors"
                        title="Open in Market Comparator"
                      >
                        Compare →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!scanning && !done && !results.length && selectedMarket && (
        <div className="bg-gray-900 rounded-xl border border-gray-700 flex items-center justify-center h-40">
          <p className="text-gray-500 text-sm">Click "Scan 1,000 Markets" to find correlated markets.</p>
        </div>
      )}
      {!selectedMarket && !scanning && (
        <div className="bg-gray-900 rounded-xl border border-gray-700 flex items-center justify-center h-40">
          <p className="text-gray-500 text-sm">Search for a market above to get started.</p>
        </div>
      )}
    </div>
  );
}
