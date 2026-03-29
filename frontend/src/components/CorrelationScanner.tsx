import { useState, useRef } from 'react';
import { Market, LogicalCorrelation, analyzeLogicalCorrelation } from '../api/client';
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

// ── Demo data ──────────────────────────────────────────────────────────────────
// Seeded around "Will Donald Trump win the 2024 US presidential election?"
const DEMO_MARKET: Market = {
  id: 'demo-trump-2024',
  question: 'Will Donald Trump win the 2024 US presidential election?',
  price: 0.97,
  volume: 388000000,
  end_date: '2024-11-05T00:00:00Z',
  source: 'polymarket',
};

const DEMO_RESULTS: ScanResult[] = [
  {
    market_id: 'demo-1',
    question: 'Will Republicans win the 2024 US Senate majority?',
    last_price: 0.93,
    composite_score: 0.81,
    full_pearson: 0.872,
    full_pearson_returns: 0.741,
    best_lag_days: 1,
    lead_direction: 'A_leads_B',
    shared_history_days: 310,
    n_observations: 310,
    rolling_mean: 0.85,
    rolling_std: 0.06,
    break_detected: false,
    granger_dominant_direction: 'A_causes_B',
    semantic_similarity: 0.74,
    end_date_proximity: 0.95,
    resolution_convergence: true,
  },
  {
    market_id: 'demo-2',
    question: 'Will Republicans win the 2024 US House majority?',
    last_price: 0.89,
    composite_score: 0.76,
    full_pearson: 0.831,
    full_pearson_returns: 0.698,
    best_lag_days: 0,
    lead_direction: 'sync',
    shared_history_days: 295,
    n_observations: 295,
    rolling_mean: 0.78,
    rolling_std: 0.09,
    break_detected: false,
    granger_dominant_direction: null,
    semantic_similarity: 0.69,
    end_date_proximity: 0.94,
    resolution_convergence: true,
  },
  {
    market_id: 'demo-3',
    question: 'Will Kamala Harris win the 2024 US presidential election?',
    last_price: 0.03,
    composite_score: 0.73,
    full_pearson: -0.944,
    full_pearson_returns: -0.812,
    best_lag_days: 0,
    lead_direction: 'sync',
    shared_history_days: 320,
    n_observations: 320,
    rolling_mean: -0.91,
    rolling_std: 0.04,
    break_detected: false,
    granger_dominant_direction: null,
    semantic_similarity: 0.88,
    end_date_proximity: 0.98,
    resolution_convergence: true,
  },
  {
    market_id: 'demo-4',
    question: 'Will Trump win the popular vote in 2024?',
    last_price: 0.84,
    composite_score: 0.70,
    full_pearson: 0.791,
    full_pearson_returns: 0.663,
    best_lag_days: 2,
    lead_direction: 'A_leads_B',
    shared_history_days: 280,
    n_observations: 280,
    rolling_mean: 0.77,
    rolling_std: 0.11,
    break_detected: false,
    granger_dominant_direction: 'A_causes_B',
    semantic_similarity: 0.81,
    end_date_proximity: 0.96,
    resolution_convergence: false,
  },
  {
    market_id: 'demo-5',
    question: 'Will the Republican Party win the 2024 Electoral College?',
    last_price: 0.94,
    composite_score: 0.68,
    full_pearson: 0.763,
    full_pearson_returns: 0.621,
    best_lag_days: 1,
    lead_direction: 'A_leads_B',
    shared_history_days: 265,
    n_observations: 265,
    rolling_mean: 0.74,
    rolling_std: 0.13,
    break_detected: false,
    granger_dominant_direction: null,
    semantic_similarity: 0.77,
    end_date_proximity: 0.97,
    resolution_convergence: true,
  },
  {
    market_id: 'demo-6',
    question: 'Will Trump win Pennsylvania in 2024?',
    last_price: 0.88,
    composite_score: 0.61,
    full_pearson: 0.712,
    full_pearson_returns: 0.589,
    best_lag_days: 3,
    lead_direction: 'B_leads_A',
    shared_history_days: 240,
    n_observations: 240,
    rolling_mean: 0.68,
    rolling_std: 0.15,
    break_detected: true,
    granger_dominant_direction: 'B_causes_A',
    semantic_similarity: 0.63,
    end_date_proximity: 0.92,
    resolution_convergence: false,
  },
  {
    market_id: 'demo-7',
    question: 'Will Trump win Georgia in 2024?',
    last_price: 0.82,
    composite_score: 0.57,
    full_pearson: 0.681,
    full_pearson_returns: 0.544,
    best_lag_days: 3,
    lead_direction: 'B_leads_A',
    shared_history_days: 230,
    n_observations: 230,
    rolling_mean: 0.65,
    rolling_std: 0.17,
    break_detected: false,
    granger_dominant_direction: 'B_causes_A',
    semantic_similarity: 0.59,
    end_date_proximity: 0.91,
    resolution_convergence: false,
  },
  {
    market_id: 'demo-8',
    question: 'Will Trump win Michigan in 2024?',
    last_price: 0.79,
    composite_score: 0.54,
    full_pearson: 0.643,
    full_pearson_returns: 0.511,
    best_lag_days: 2,
    lead_direction: 'A_leads_B',
    shared_history_days: 220,
    n_observations: 220,
    rolling_mean: 0.61,
    rolling_std: 0.19,
    break_detected: false,
    granger_dominant_direction: null,
    semantic_similarity: 0.56,
    end_date_proximity: 0.90,
    resolution_convergence: false,
  },
  {
    market_id: 'demo-9',
    question: 'Will any third-party candidate win an Electoral College vote in 2024?',
    last_price: 0.04,
    composite_score: 0.38,
    full_pearson: -0.421,
    full_pearson_returns: -0.337,
    best_lag_days: 5,
    lead_direction: 'B_leads_A',
    shared_history_days: 180,
    n_observations: 180,
    rolling_mean: -0.38,
    rolling_std: 0.22,
    break_detected: true,
    granger_dominant_direction: null,
    semantic_similarity: 0.41,
    end_date_proximity: 0.88,
    resolution_convergence: false,
  },
  {
    market_id: 'demo-10',
    question: 'Will Trump be convicted of a felony before the 2024 election?',
    last_price: 0.72,
    composite_score: 0.33,
    full_pearson: -0.372,
    full_pearson_returns: -0.291,
    best_lag_days: 7,
    lead_direction: 'B_leads_A',
    shared_history_days: 195,
    n_observations: 195,
    rolling_mean: -0.31,
    rolling_std: 0.25,
    break_detected: true,
    granger_dominant_direction: 'B_causes_A',
    semantic_similarity: 0.48,
    end_date_proximity: 0.72,
    resolution_convergence: false,
  },
];

const DEMO_LOGIC_MAP: Record<string, LogicalCorrelation> = {
  'demo-1': { logical_score: 0.91, relationship_type: 'causal', explanation: 'Presidential coattails effect: Trump winning the presidency strongly increases the probability of Senate gains, as presidential and Senate elections are heavily correlated in partisan wave elections.' },
  'demo-3': { logical_score: 0.97, relationship_type: 'inverse', explanation: 'These are mutually exclusive outcomes of the same election. P(Trump wins) + P(Harris wins) ≈ 1, creating a near-perfect inverse correlation by construction.' },
  'demo-4': { logical_score: 0.85, relationship_type: 'causal', explanation: 'Winning the popular vote is a necessary but not sufficient condition for winning the presidency in most scenarios. Strong causal link through voter turnout and partisan enthusiasm.' },
  'demo-10': { logical_score: 0.62, relationship_type: 'shared_driver', explanation: 'Criminal conviction news moved both markets but in opposite directions — negative legal news suppressed Trump presidential odds while boosting conviction probability.' },
};

// ── Helpers ────────────────────────────────────────────────────────────────────
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
      <div className="w-20 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-mono text-zinc-300 tabular-nums">{score.toFixed(2)}</span>
    </div>
  );
}

function lagLabel(best_lag_days: number, lead_direction: string): string {
  if (best_lag_days === 0) return 'Sync';
  const abs = Math.abs(best_lag_days);
  return lead_direction === 'A_leads_B' ? `A+${abs}d` : `B+${abs}d`;
}

function semanticBar(sim: number) {
  const pct = Math.round(Math.max(0, Math.min(1, (sim - 0.1) / 0.7)) * 100);
  const color = sim > 0.55 ? '#818cf8' : sim > 0.35 ? '#a78bfa' : '#6b7280';
  return (
    <div className="flex items-center gap-2">
      <div className="w-12 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-mono tabular-nums" style={{ color }}>{sim.toFixed(2)}</span>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function CorrelationScanner({ onCompare }: { onCompare: (target: Market, correlated: Market) => void }) {
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [demoMode, setDemoMode]             = useState(false);

  const [scanning, setScanning] = useState(false);
  const [done, setDone]         = useState(false);
  const [scanned, setScanned]   = useState(0);
  const [total, setTotal]       = useState(0);
  const [found, setFound]       = useState(0);
  const [results, setResults]   = useState<ScanResult[]>([]);
  const [error, setError]       = useState('');
  const [logicMap, setLogicMap]         = useState<Record<string, LogicalCorrelation>>({});
  const [logicLoading, setLogicLoading] = useState<Record<string, boolean>>({});

  const esRef      = useRef<EventSource | null>(null);
  const demoTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const resetState = () => {
    setResults([]);
    setDone(false);
    setScanned(0);
    setTotal(0);
    setFound(0);
    setError('');
    setLogicMap({});
    setLogicLoading({});
  };

  const handleMarketSelect = (m: Market) => {
    if (!m.id) { setSelectedMarket(null); return; }
    setSelectedMarket(m);
    resetState();
  };

  // ── Toggle demo mode ──────────────────────────────────────────────────────
  const toggleDemo = () => {
    esRef.current?.close();
    demoTimers.current.forEach(clearTimeout);
    demoTimers.current = [];
    setScanning(false);
    setDemoMode(prev => {
      const next = !prev;
      if (next) {
        setSelectedMarket(DEMO_MARKET);
        resetState();
      }
      return next;
    });
  };

  // ── Demo scan simulation ──────────────────────────────────────────────────
  const startDemoScan = () => {
    resetState();
    setScanning(true);
    const TOTAL = 1000;
    setTotal(TOTAL);

    // Reveal results one-by-one with realistic delays
    let revealed = 0;
    DEMO_RESULTS.forEach((r, idx) => {
      const delay = 400 + idx * 280 + Math.random() * 150;
      const t = setTimeout(() => {
        setResults(prev => [...prev, r].sort((a, b) => b.composite_score - a.composite_score));
        revealed += 1;
        setFound(revealed);
        // Advance fake progress
        const fakeScanned = Math.min(TOTAL, Math.round(((idx + 1) / DEMO_RESULTS.length) * TOTAL));
        setScanned(fakeScanned);
      }, delay);
      demoTimers.current.push(t);
    });

    // Mark done after all results are in
    const doneDelay = 400 + DEMO_RESULTS.length * 280 + 500;
    const doneTimer = setTimeout(() => {
      setScanned(TOTAL);
      setFound(DEMO_RESULTS.length);
      setDone(true);
      setScanning(false);
      // Auto-populate logic analysis for a few entries
      setLogicMap(DEMO_LOGIC_MAP);
    }, doneDelay);
    demoTimers.current.push(doneTimer);
  };

  // ── Live scan ─────────────────────────────────────────────────────────────
  const startScan = () => {
    if (demoMode) { startDemoScan(); return; }
    if (!selectedMarket?.id) return;
    esRef.current?.close();
    setScanning(true);
    resetState();

    const params = new URLSearchParams({ market_id: selectedMarket.id });
    if (selectedMarket.question) params.set('target_question', selectedMarket.question);
    const es = new EventSource(`${BASE_URL}/correlate/scan/stream?${params.toString()}`);
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
    demoTimers.current.forEach(clearTimeout);
    demoTimers.current = [];
    setScanning(false);
  };

  const analyzeLogic = async (r: ScanResult) => {
    if (!selectedMarket) return;
    setLogicLoading(prev => ({ ...prev, [r.market_id]: true }));
    try {
      const res = await analyzeLogicalCorrelation({
        market_a_question: selectedMarket.question,
        market_b_question: r.question,
        pearson_r: r.full_pearson,
        semantic_similarity: r.semantic_similarity,
      });
      setLogicMap(prev => ({ ...prev, [r.market_id]: res }));
    } catch {
      setLogicMap(prev => ({
        ...prev,
        [r.market_id]: { logical_score: 0, relationship_type: 'none', explanation: 'Analysis failed.' },
      }));
    } finally {
      setLogicLoading(prev => ({ ...prev, [r.market_id]: false }));
    }
  };

  const LOGIC_COLORS: Record<string, string> = {
    causal: '#34d399', shared_driver: '#818cf8', thematic: '#a78bfa',
    inverse: '#f87171', coincidental: '#9ca3af', none: '#6b7280',
  };
  const LOGIC_LABELS: Record<string, string> = {
    causal: 'Causal', shared_driver: 'Shared Driver', thematic: 'Thematic',
    inverse: 'Inverse', coincidental: 'Coincidental', none: '—',
  };

  const progressPct = total > 0 ? Math.round((scanned / total) * 100) : 0;
  const activeMarket = demoMode ? DEMO_MARKET : selectedMarket;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Correlation Scanner</h2>
          <p className="text-zinc-400 text-sm mt-1">
            Pick any market and scan the top 1,000 Polymarket markets to find the most statistically correlated ones.
          </p>
        </div>

        {/* Demo toggle */}
        <button
          onClick={toggleDemo}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all flex-shrink-0 ml-4 ${
            demoMode
              ? 'bg-amber-900/40 border-amber-600/60 text-amber-300'
              : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${demoMode ? 'bg-amber-400' : 'bg-zinc-600'}`} />
          Demo Mode
        </button>
      </div>

      {/* Demo banner */}
      {demoMode && (
        <div className="mb-5 bg-amber-950/30 border border-amber-800/50 rounded-lg px-4 py-3 flex items-start gap-3">
          <span className="text-amber-400 text-sm mt-0.5">★</span>
          <div>
            <p className="text-amber-300 text-xs font-medium">Demo Mode — pre-loaded results</p>
            <p className="text-amber-600 text-xs mt-0.5">
              Showing a curated example: <span className="text-amber-400">2024 US Presidential Election</span> correlations with semantic similarity, Pearson r, lead/lag, and AI logic analysis pre-populated.
            </p>
          </div>
        </div>
      )}

      {/* Market selector */}
      {!demoMode && (
        <div className="mb-5">
          <MarketSearchWidget
            label="Target Market"
            selected={selectedMarket}
            onSelect={handleMarketSelect}
            placeholder="Search or paste a Polymarket URL..."
          />
        </div>
      )}

      {/* Demo market pill */}
      {demoMode && (
        <div className="mb-5 bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 flex items-center gap-3">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider flex-shrink-0">Target</span>
          <p className="text-sm text-white font-medium truncate">{DEMO_MARKET.question}</p>
          <span className="ml-auto text-sm font-bold text-white tabular-nums flex-shrink-0">
            {((DEMO_MARKET.price ?? 0) * 100).toFixed(1)}¢
          </span>
        </div>
      )}

      {/* Scan controls */}
      <div className="mb-5">
        <button
          onClick={scanning ? stopScan : startScan}
          disabled={!demoMode && !activeMarket}
          className={`w-full py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            scanning
              ? 'bg-red-700 hover:bg-red-600 text-white'
              : 'bg-indigo-600 hover:bg-indigo-500 text-white'
          }`}
        >
          {scanning ? 'Stop Scan' : done ? 'Scan Again' : demoMode ? 'Run Demo Scan' : 'Scan 1,000 Markets'}
        </button>

        {(scanning || done) && total > 0 && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
              <span>
                {done ? 'Complete' : 'Scanning'} — <span className="tabular-nums">{scanned.toLocaleString()} / {total.toLocaleString()}</span> markets · <span className="text-indigo-300 font-medium tabular-nums">{found} found</span>
                {demoMode && <span className="text-amber-500 ml-2">· demo</span>}
              </span>
              <span className="tabular-nums">{progressPct}%</span>
            </div>
            <div className="h-1.5 bg-zinc-700 rounded-full overflow-hidden">
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
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
          <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">
              Top Correlated Markets {!done && <span className="text-indigo-400 animate-pulse">· live</span>}
              {demoMode && done && <span className="text-amber-500 ml-1">· demo</span>}
            </h3>
            <span className="text-xs text-zinc-500 tabular-nums">{results.length} results</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-800/60">
                  <th className="text-left px-5 py-2.5 text-xs text-zinc-500 font-medium w-8">#</th>
                  <th className="text-left px-3 py-2.5 text-xs text-zinc-500 font-medium">Market</th>
                  <th className="text-right px-3 py-2.5 text-xs text-zinc-500 font-medium">Price</th>
                  <th className="text-left px-3 py-2.5 text-xs text-zinc-500 font-medium">Composite</th>
                  <th className="text-right px-3 py-2.5 text-xs text-zinc-500 font-medium">Pearson r</th>
                  <th className="text-left px-3 py-2.5 text-xs text-zinc-500 font-medium">Semantic</th>
                  <th className="text-left px-3 py-2.5 text-xs text-zinc-500 font-medium">
                    Logic
                    <span className="ml-1 text-[9px] bg-indigo-900 text-indigo-300 px-1 py-0.5 rounded">AI</span>
                  </th>
                  <th className="text-right px-3 py-2.5 text-xs text-zinc-500 font-medium">Lead/Lag</th>
                  <th className="text-right px-3 py-2.5 text-xs text-zinc-500 font-medium">Days</th>
                  <th className="px-3 py-2.5 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {results.slice(0, 25).map((r, i) => (
                  <tr key={r.market_id} className="border-b border-zinc-800 hover:bg-zinc-800/50 transition-colors">
                    <td className="px-5 py-3 text-zinc-500 text-xs tabular-nums">{i + 1}</td>
                    <td className="px-3 py-3 max-w-xs">
                      <p className="text-white text-xs leading-snug line-clamp-2">{r.question}</p>
                      {r.break_detected && (
                        <span className="text-xs text-orange-400 mt-0.5 block">⚠ regime break</span>
                      )}
                      {r.resolution_convergence && (
                        <span className="text-xs text-yellow-600 mt-0.5 block">⚠ resolution convergence</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right text-zinc-300 text-xs font-mono tabular-nums">
                      {(r.last_price * 100).toFixed(1)}¢
                    </td>
                    <td className="px-3 py-3">{compositeBar(r.composite_score)}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs font-bold tabular-nums" style={{ color: pearsonColor(r.full_pearson) }}>
                      {r.full_pearson >= 0 ? '+' : ''}{r.full_pearson.toFixed(3)}
                    </td>
                    <td className="px-3 py-3">
                      {semanticBar(r.semantic_similarity ?? 0)}
                    </td>
                    <td className="px-3 py-3 min-w-[120px]">
                      {logicLoading[r.market_id] ? (
                        <span className="text-xs text-indigo-400 animate-pulse">Analyzing…</span>
                      ) : logicMap[r.market_id] ? (
                        <div className="group relative">
                          <div className="flex items-center gap-1.5">
                            <div className="w-10 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${Math.round(logicMap[r.market_id].logical_score * 100)}%`,
                                  backgroundColor: LOGIC_COLORS[logicMap[r.market_id].relationship_type] ?? '#6b7280',
                                }}
                              />
                            </div>
                            <span
                              className="text-[10px] font-medium"
                              style={{ color: LOGIC_COLORS[logicMap[r.market_id].relationship_type] ?? '#6b7280' }}
                            >
                              {LOGIC_LABELS[logicMap[r.market_id].relationship_type] ?? '—'}
                            </span>
                          </div>
                          <div className="hidden group-hover:block absolute z-20 left-0 bottom-full mb-1 w-64 bg-zinc-800 border border-zinc-700 rounded-lg p-2.5 shadow-xl">
                            <p className="text-[10px] text-indigo-300 font-medium mb-1">
                              Logical score: <span className="tabular-nums">{logicMap[r.market_id].logical_score.toFixed(2)}</span>
                            </p>
                            <p className="text-xs text-zinc-300 leading-snug">
                              {logicMap[r.market_id].explanation}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => analyzeLogic(r)}
                          className="text-[10px] text-indigo-400 hover:text-indigo-300 underline underline-offset-2 transition-colors"
                          title="Ask Claude Haiku to assess logical relationship"
                        >
                          Analyze
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right text-xs text-zinc-400 tabular-nums">
                      {lagLabel(r.best_lag_days, r.lead_direction)}
                    </td>
                    <td className="px-3 py-3 text-right text-xs text-zinc-500 tabular-nums">
                      {Math.round(r.shared_history_days)}d
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button
                        onClick={() => onCompare(
                          activeMarket!,
                          {
                            id: r.market_id,
                            question: r.question,
                            price: r.last_price,
                            volume: null,
                            end_date: null,
                            source: 'polymarket',
                          }
                        )}
                        className="text-xs bg-indigo-900/60 hover:bg-indigo-800 text-indigo-300 px-2 py-1 rounded-lg transition-colors"
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
      {!scanning && !done && !results.length && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 flex items-center justify-center h-40">
          <p className="text-zinc-500 text-sm">
            {demoMode
              ? 'Click "Run Demo Scan" to see a pre-loaded example.'
              : selectedMarket
              ? 'Click "Scan 1,000 Markets" to find correlated markets.'
              : 'Search for a market above to get started.'}
          </p>
        </div>
      )}
    </div>
  );
}
