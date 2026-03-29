import { useState, useCallback, useEffect } from 'react';
import { DEMO_CORRELATION, DEMO_MARKET_A, DEMO_MARKET_B } from '../demo/demoData';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';
import {
  getPolymarketHistory, correlateMarkets,
  analyzeLogicalCorrelation, getPolymarketVolumeHistory,
  Market, MarketHistory, CorrelationResult, LogicalCorrelation, VolumePoint,
} from '../api/client';
import MarketSearchWidget from './MarketSearchWidget';
import PriceChart from './PriceChart';
import SpikeInvestigationPanel, { SpikePoint } from './SpikeInvestigationPanel';

const INTERVALS = [
  { label: '1W', value: '1w' },
  { label: '1M', value: '1m' },
  { label: '3M', value: '3m' },
  { label: 'All', value: 'max' },
];

const MARKET_A_COLOR = '#818cf8'; // indigo
const MARKET_B_COLOR = '#34d399'; // green

function pearsonColor(r: number): string {
  if (r > 0.5) return '#34d399';
  if (r > 0.2) return '#86efac';
  if (r < -0.5) return '#f87171';
  if (r < -0.2) return '#fca5a5';
  return '#9ca3af';
}

function CorrelationPanel({ result, marketA, marketB, loading }: {
  result: CorrelationResult | null;
  marketA: Market;
  marketB: Market;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 flex items-center justify-center h-40">
        <p className="text-zinc-500 text-sm animate-pulse">Computing correlation…</p>
      </div>
    );
  }
  if (!result) return null;
  if (result.error) {
    return (
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
        <p className="text-red-400 text-sm">{result.error}</p>
      </div>
    );
  }

  const r = result.full_pearson;
  const score = result.composite_score;
  const rColor = pearsonColor(r);

  const lagLabel = () => {
    const d = result.best_lag_days;
    if (d === 0) return 'Contemporaneous';
    const abs = Math.abs(d);
    const dir = result.lead_direction === 'A_leads_B'
      ? `Market A leads B by ${abs}d`
      : `Market B leads A by ${abs}d`;
    return dir;
  };

  const grangerLabel = () => {
    if (!result.granger_dominant_direction) return 'None significant';
    if (result.granger_dominant_direction === 'A_causes_B')
      return `A → B (p=${result.a_causes_b_pval.toFixed(3)})`;
    return `B → A (p=${result.b_causes_a_pval.toFixed(3)})`;
  };

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">Correlation Analysis</h3>
        <div className="flex items-center gap-3">
          {result.short_history_warning && (
            <span className="text-xs bg-yellow-900/40 text-yellow-300 px-2 py-0.5 rounded border border-yellow-700/50">Short history</span>
          )}
          {result.break_detected && (
            <span className="text-xs bg-orange-900/40 text-orange-300 px-2 py-0.5 rounded border border-orange-700/50">Regime break detected</span>
          )}
          {result.resolution_convergence && (
            <span className="text-xs bg-yellow-900/40 text-yellow-300 px-2 py-0.5 rounded border border-yellow-700/50">⚠ Resolution convergence — correlation may be spurious</span>
          )}
          <span className="text-xs text-zinc-500 tabular-nums">{result.shared_history_days}d shared · {result.n_observations} obs</span>
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-zinc-800 rounded-lg p-3">
          <p className="text-xs text-zinc-400 uppercase tracking-wider mb-1">Pearson (logit)</p>
          <p className="text-2xl font-bold tabular-nums" style={{ color: rColor }}>{r >= 0 ? '+' : ''}{r.toFixed(3)}</p>
          <p className="text-xs text-zinc-500 mt-0.5 tabular-nums">on returns: {result.full_pearson_returns >= 0 ? '+' : ''}{result.full_pearson_returns.toFixed(3)}</p>
        </div>
        <div className="bg-zinc-800 rounded-lg p-3">
          <p className="text-xs text-zinc-400 uppercase tracking-wider mb-1">Rolling Stability</p>
          <p className="text-xl font-bold text-white tabular-nums">{result.rolling_mean >= 0 ? '+' : ''}{result.rolling_mean.toFixed(3)}</p>
          <p className="text-xs text-zinc-500 mt-0.5 tabular-nums">±{result.rolling_std.toFixed(3)} · {(result.rolling_pct_positive * 100).toFixed(0)}% positive</p>
        </div>
        <div className="bg-zinc-800 rounded-lg p-3">
          <p className="text-xs text-zinc-400 uppercase tracking-wider mb-1">Lead / Lag</p>
          <p className="text-sm font-bold text-white leading-tight mt-1">{lagLabel()}</p>
          <p className="text-xs text-zinc-500 mt-0.5 tabular-nums">r={result.lag_correlation.toFixed(3)}</p>
        </div>
        <div className="bg-zinc-800 rounded-lg p-3">
          <p className="text-xs text-zinc-400 uppercase tracking-wider mb-1">Granger Causality</p>
          <p className="text-sm font-bold text-white leading-tight mt-1">{grangerLabel()}</p>
          <p className="text-xs text-zinc-500 mt-0.5 tabular-nums">A→B: {result.a_causes_b_pval.toFixed(3)} · B→A: {result.b_causes_a_pval.toFixed(3)}</p>
        </div>
      </div>

      {/* Semantic + composite row */}
      {(result.semantic_similarity != null) && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="bg-zinc-800 rounded-lg p-3">
            <p className="text-xs text-zinc-400 uppercase tracking-wider mb-1">Semantic Similarity</p>
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 h-2 bg-zinc-700 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.round(Math.max(0, Math.min(1, (result.semantic_similarity - 0.1) / 0.7)) * 100)}%`,
                    backgroundColor: result.semantic_similarity > 0.55 ? '#818cf8' : result.semantic_similarity > 0.35 ? '#a78bfa' : '#6b7280',
                  }}
                />
              </div>
              <span className="text-sm font-bold text-white font-mono tabular-nums">{result.semantic_similarity.toFixed(2)}</span>
            </div>
            <p className="text-xs text-zinc-500 mt-1">
              {result.semantic_similarity > 0.55 ? 'Strongly related topic' :
               result.semantic_similarity > 0.35 ? 'Moderately related' : 'Topically dissimilar'}
            </p>
          </div>
          <div className="bg-zinc-800 rounded-lg p-3">
            <p className="text-xs text-zinc-400 uppercase tracking-wider mb-1">Resolution Proximity</p>
            <p className="text-xl font-bold text-white mt-1 tabular-nums">
              {result.end_date_proximity > 0
                ? `${Math.round(result.end_date_proximity * 100)}%`
                : '—'}
            </p>
            <p className="text-xs text-zinc-500 mt-0.5">
              {result.end_date_proximity > 0.9 ? 'Same resolution window' :
               result.end_date_proximity > 0.5 ? 'Close resolution dates' :
               result.end_date_proximity > 0 ? 'Divergent timelines' : 'No date data'}
            </p>
          </div>
          <div className="bg-zinc-800 rounded-lg p-3 md:col-span-1">
            <p className="text-xs text-zinc-400 uppercase tracking-wider mb-1">Composite Score</p>
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 h-2 bg-zinc-700 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.round(score * 100)}%`,
                    backgroundColor: score > 0.6 ? '#34d399' : score > 0.35 ? '#fbbf24' : '#9ca3af',
                  }}
                />
              </div>
              <span className="text-sm font-bold text-white font-mono tabular-nums">{score.toFixed(2)}</span>
            </div>
            <p className="text-xs text-zinc-500 mt-1">
              Pearson + stability + Granger + semantic + proximity
            </p>
          </div>
        </div>
      )}

      {/* Structural break info */}
      {result.break_detected && result.pre_break_pearson !== null && (
        <div className="flex gap-4 text-sm">
          <span className="text-zinc-400">Pre-break Pearson: <span className="text-white font-medium tabular-nums">{result.pre_break_pearson!.toFixed(3)}</span></span>
          <span className="text-zinc-400">Post-break Pearson: <span className="text-white font-medium tabular-nums">{result.post_break_pearson!.toFixed(3)}</span></span>
        </div>
      )}

      {/* Rolling correlation chart */}
      {result.rolling_series.length > 2 && (
        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-widest mb-2">Rolling Correlation (logit prices)</p>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={result.rolling_series} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(v) => new Date(v * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  stroke="#52525b"
                  tick={{ fill: '#71717a', fontSize: 10 }}
                  tickCount={6}
                />
                <YAxis domain={[-1, 1]} stroke="#52525b" tick={{ fill: '#71717a', fontSize: 10 }} width={28} tickFormatter={(v) => v.toFixed(1)} />
                <Tooltip
                  formatter={(v) => [Number(v).toFixed(3), 'Correlation']}
                  labelFormatter={(t) => new Date((t as number) * 1000).toLocaleDateString()}
                  contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8 }}
                  labelStyle={{ color: '#71717a' }}
                />
                <ReferenceLine y={0} stroke="#52525b" strokeDasharray="4 3" />
                <Line type="monotone" dataKey="r" stroke="#818cf8" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* CCF bar chart */}
      {result.lag_series.length > 0 && (
        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-widest mb-2">Cross-Correlation Function (logit returns)</p>
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={result.lag_series} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
                <XAxis dataKey="lag" stroke="#52525b" tick={{ fill: '#71717a', fontSize: 10 }} />
                <YAxis domain={[-1, 1]} stroke="#52525b" tick={{ fill: '#71717a', fontSize: 10 }} width={28} tickFormatter={(v) => v.toFixed(1)} />
                <Tooltip
                  formatter={(v) => [Number(v).toFixed(3), 'r']}
                  labelFormatter={(l) => `Lag ${l} days`}
                  contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8 }}
                  labelStyle={{ color: '#71717a' }}
                />
                <ReferenceLine y={0} stroke="#52525b" />
                <Bar dataKey="r">
                  {result.lag_series.map((entry, i) => (
                    <Cell key={i} fill={entry.r >= 0 ? '#818cf8' : '#f87171'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Relationship-type display helpers ──────────────────────────────────────────
const RELATIONSHIP_META: Record<string, { label: string; color: string; bg: string }> = {
  causal:        { label: 'Causal',        color: '#34d399', bg: '#065f46' },
  shared_driver: { label: 'Shared Driver', color: '#818cf8', bg: '#312e81' },
  thematic:      { label: 'Thematic',      color: '#a78bfa', bg: '#4c1d95' },
  inverse:       { label: 'Inverse',       color: '#f87171', bg: '#7f1d1d' },
  coincidental:  { label: 'Coincidental',  color: '#9ca3af', bg: '#374151' },
  none:          { label: 'None',          color: '#6b7280', bg: '#1f2937' },
};

function logicalScoreColor(s: number): string {
  if (s >= 0.6) return '#34d399';
  if (s >= 0.35) return '#fbbf24';
  return '#9ca3af';
}

function LogicalCorrelationPanel({
  marketA, marketB, corrResult,
}: {
  marketA: Market;
  marketB: Market;
  corrResult: CorrelationResult | null;
}) {
  const [result, setResult] = useState<LogicalCorrelation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const r = await analyzeLogicalCorrelation({
        market_a_question: marketA.question,
        market_b_question: marketB.question,
        pearson_r: corrResult?.full_pearson ?? 0,
        semantic_similarity: corrResult?.semantic_similarity ?? 0,
      });
      setResult(r);
    } catch {
      setError('Analysis failed — check that ANTHROPIC_API_KEY is configured.');
    } finally {
      setLoading(false);
    }
  };

  const meta = result ? (RELATIONSHIP_META[result.relationship_type] ?? RELATIONSHIP_META.none) : null;
  const pct  = result ? Math.round(result.logical_score * 100) : 0;

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">
            Logical Analysis
          </span>
          <span className="text-[10px] bg-indigo-900/60 text-indigo-300 px-1.5 py-0.5 rounded font-medium">
            AI
          </span>
        </div>
        {!result && (
          <button
            onClick={run}
            disabled={loading}
            className="text-xs bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
          >
            {loading ? 'Analyzing…' : 'Run LLM Analysis'}
          </button>
        )}
        {result && (
          <button
            onClick={run}
            disabled={loading}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {loading ? 'Analyzing…' : 'Re-run'}
          </button>
        )}
      </div>

      {/* Empty / error states */}
      {!result && !loading && !error && (
        <p className="text-zinc-500 text-xs">
          Click "Run LLM Analysis" to have Claude Haiku assess whether these
          markets have a logical or causal relationship — beyond what the
          statistics alone can tell you.
        </p>
      )}
      {error && <p className="text-red-400 text-xs">{error}</p>}
      {loading && (
        <div className="flex items-center gap-2 text-zinc-500 text-xs animate-pulse">
          <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block" />
          Claude Haiku is reasoning about these markets…
        </div>
      )}

      {/* Result */}
      {result && meta && (
        <div className="space-y-4">
          {/* Score + type badge */}
          <div className="flex items-center gap-4">
            {/* Score gauge */}
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-zinc-400">Logical Correlation Score</span>
                <span className="text-sm font-bold font-mono tabular-nums" style={{ color: logicalScoreColor(result.logical_score) }}>
                  {result.logical_score.toFixed(2)}
                </span>
              </div>
              <div className="h-2 bg-zinc-700 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: logicalScoreColor(result.logical_score),
                  }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-zinc-600 mt-0.5">
                <span>Coincidental</span>
                <span>Moderate</span>
                <span>Direct dependency</span>
              </div>
            </div>

            {/* Relationship type badge */}
            <div
              className="flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg"
              style={{ color: meta.color, backgroundColor: meta.bg + '66' }}
            >
              {meta.label}
            </div>
          </div>

          {/* Explanation */}
          <div className="border-t border-zinc-800 pt-3">
            <p className="text-sm text-zinc-300 leading-relaxed">{result.explanation}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MarketCompare({ initialMarketA, initialMarketB, demoMode }: { initialMarketA?: Market; initialMarketB?: Market; demoMode?: boolean }) {
  const [marketA, setMarketA] = useState<Market | null>(null);
  const [marketB, setMarketB] = useState<Market | null>(null);
  const [historyA, setHistoryA] = useState<MarketHistory | null>(null);
  const [historyB, setHistoryB] = useState<MarketHistory | null>(null);
  const [loadingA, setLoadingA] = useState(false);
  const [loadingB, setLoadingB] = useState(false);
  const [errorA, setErrorA] = useState('');
  const [errorB, setErrorB] = useState('');
  const [volumeA, setVolumeA] = useState<VolumePoint[] | null>(null);
  const [volumeB, setVolumeB] = useState<VolumePoint[] | null>(null);
  const [interval, setInterval] = useState('1m');
  const [correlation, setCorrelation] = useState<CorrelationResult | null>(null);
  const [corrLoading, setCorrLoading] = useState(false);
  const [spikeA, setSpikeA] = useState<SpikePoint | null>(null);
  const [spikeB, setSpikeB] = useState<SpikePoint | null>(null);

  useEffect(() => {
    if (!marketA?.id || !marketB?.id) { setCorrelation(null); return; }
    // Skip API call for demo markets — correlation is pre-loaded
    if (marketA.id.startsWith('demo-') || marketB.id.startsWith('demo-')) return;
    setCorrLoading(true);
    setCorrelation(null);
    correlateMarkets(marketA.id, marketB.id)
      .then(setCorrelation)
      .catch(() => setCorrelation(null))
      .finally(() => setCorrLoading(false));
  }, [marketA?.id, marketB?.id]);

  const fetchHistory = useCallback(
    async (market: Market, slot: 'A' | 'B', iv: string) => {
      if (!market.id) return;
      // Skip history fetch for demo markets (fake IDs would 404)
      if (market.id.startsWith('demo-')) return;
      const setLoading = slot === 'A' ? setLoadingA : setLoadingB;
      const setHistory = slot === 'A' ? setHistoryA : setHistoryB;
      const setError   = slot === 'A' ? setErrorA   : setErrorB;
      const setVolume  = slot === 'A' ? setVolumeA   : setVolumeB;
      setLoading(true);
      setError('');
      try {
        // Fetch price history and volume in parallel
        const [hist, vol] = await Promise.all([
          getPolymarketHistory(market.id, iv),
          getPolymarketVolumeHistory(market.id).catch(() => null),
        ]);
        setHistory(hist);
        setVolume(vol && vol.length > 0 ? vol : null);
      } catch (e: any) {
        setError(e?.response?.data?.detail || 'Failed to load price history');
        setHistory(null);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const handleSelectA = (m: Market) => {
    if (!m.id) { setMarketA(null); setHistoryA(null); return; }
    setMarketA(m);
    fetchHistory(m, 'A', interval);
  };

  const handleSelectB = (m: Market) => {
    if (!m.id) { setMarketB(null); setHistoryB(null); return; }
    setMarketB(m);
    fetchHistory(m, 'B', interval);
  };

  // Pre-load demo data when demo mode is enabled
  useEffect(() => {
    if (demoMode) {
      setMarketA(DEMO_MARKET_A);
      setMarketB(DEMO_MARKET_B);
      setCorrelation(DEMO_CORRELATION);
      setCorrLoading(false);
    }
  }, [demoMode]);

  // Pre-populate markets when navigating from Correlation Scanner
  useEffect(() => {
    if (initialMarketA?.id) handleSelectA(initialMarketA);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMarketA?.id]);

  useEffect(() => {
    if (initialMarketB?.id) handleSelectB(initialMarketB);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMarketB?.id]);

  const handleIntervalChange = (iv: string) => {
    setInterval(iv);
    if (marketA?.id) fetchHistory(marketA, 'A', iv);
    if (marketB?.id) fetchHistory(marketB, 'B', iv);
  };

  // Clear spike + volume when a new market is chosen
  const wrappedSelectA = (m: Market) => { setSpikeA(null); setVolumeA(null); handleSelectA(m); };
  const wrappedSelectB = (m: Market) => { setSpikeB(null); setVolumeB(null); handleSelectB(m); };

  const hasCharts = (marketA && (historyA || loadingA || errorA)) ||
                    (marketB && (historyB || loadingB || errorB));

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">Market Comparator</h2>
        <p className="text-zinc-400 text-sm mt-1">
          Pick any two Polymarket markets and compare their price histories.
        </p>
      </div>

      {demoMode && (
        <div className="mb-5 bg-amber-950/30 border border-amber-800/50 rounded-lg px-4 py-2.5 flex items-center gap-3">
          <span className="text-amber-400 text-xs font-medium">★ Demo Mode</span>
          <span className="text-amber-600 text-xs">Pre-loaded: BTC $100k vs ETH $4k correlation analysis (r = +0.831, A leads B by 1 day)</span>
        </div>
      )}

      {/* Market pickers */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <MarketSearchWidget label="Market A" accentColor={MARKET_A_COLOR} selected={marketA} onSelect={wrappedSelectA} />
        <MarketSearchWidget label="Market B" accentColor={MARKET_B_COLOR} selected={marketB} onSelect={wrappedSelectB} />
      </div>

      {/* Time range selector */}
      {hasCharts && (
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs text-zinc-500 uppercase tracking-wider">Range:</span>
          {INTERVALS.map((iv) => (
            <button
              key={iv.value}
              onClick={() => handleIntervalChange(iv.value)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                interval === iv.value
                  ? 'bg-indigo-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {iv.label}
            </button>
          ))}
        </div>
      )}

      {/* Charts stacked */}
      <div className="space-y-4">
        {marketA && (
          <PriceChart
            history={historyA}
            question={marketA.question}
            color={MARKET_A_COLOR}
            loading={loadingA}
            error={errorA}
            volumeData={volumeA}
            onPointClick={(pt) => { setSpikeA(pt); setSpikeB(null); }}
            selectedPoint={spikeA}
          />
        )}
        {marketB && (
          <PriceChart
            history={historyB}
            question={marketB.question}
            color={MARKET_B_COLOR}
            loading={loadingB}
            error={errorB}
            volumeData={volumeB}
            onPointClick={(pt) => { setSpikeB(pt); setSpikeA(null); }}
            selectedPoint={spikeB}
          />
        )}
        {!marketA && !marketB && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 flex items-center justify-center h-48">
            <p className="text-zinc-500 text-sm">Search and select markets above to see their charts.</p>
          </div>
        )}
      </div>

      {/* Spike investigation panels — one per market, always present when market is loaded */}
      {(marketA || marketB) && (
        <div className="mt-4 space-y-3">
          {marketA && (
            <SpikeInvestigationPanel
              market={marketA}
              selectedPoint={spikeA}
              marketLabel="Market A"
              accentColor={MARKET_A_COLOR}
              onClear={() => setSpikeA(null)}
            />
          )}
          {marketB && (
            <SpikeInvestigationPanel
              market={marketB}
              selectedPoint={spikeB}
              marketLabel="Market B"
              accentColor={MARKET_B_COLOR}
              onClear={() => setSpikeB(null)}
            />
          )}
        </div>
      )}

      {/* Correlation panel — shown once both markets are selected */}
      {marketA && marketB && (
        <div className="mt-4 space-y-4">
          <CorrelationPanel
            result={correlation}
            marketA={marketA}
            marketB={marketB}
            loading={corrLoading}
          />
          <LogicalCorrelationPanel
            marketA={marketA}
            marketB={marketB}
            corrResult={correlation}
          />
        </div>
      )}
    </div>
  );
}
