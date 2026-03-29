import { useState, useCallback, useEffect } from 'react';
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
import { searchPolymarket, lookupPolymarketBySlug, getPolymarketHistory, correlateMarkets, Market, MarketHistory, CorrelationResult } from '../api/client';

function extractPolymarketSlug(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (!url.hostname.includes('polymarket.com')) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    // pathname: /event/{event-slug}/{market-slug}
    return parts.length >= 3 ? parts[2] : null;
  } catch {
    return null;
  }
}

const INTERVALS = [
  { label: '1W', value: '1w' },
  { label: '1M', value: '1m' },
  { label: '3M', value: '3m' },
  { label: 'All', value: 'max' },
];

function MarketPicker({
  label,
  color,
  selected,
  onSelect,
}: {
  label: string;
  color: string;
  selected: Market | null;
  onSelect: (m: Market) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Market[]>([]);
  const [loading, setLoading] = useState(false);

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const slug = extractPolymarketSlug(query);
      setResults(slug
        ? await lookupPolymarketBySlug(slug)
        : await searchPolymarket(query));
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gray-900 rounded-xl p-5 border border-gray-700">
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-3 h-3 rounded-full`} style={{ backgroundColor: color }} />
        <h3 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">{label}</h3>
      </div>

      {selected && (
        <div className="mb-3 p-3 rounded-lg bg-gray-800 border border-gray-600">
          <p className="text-sm text-white font-medium leading-snug">{selected.question}</p>
          <p className="text-xs text-gray-400 mt-1">
            {selected.price != null ? `${(selected.price * 100).toFixed(1)}¢` : 'N/A'} ·{' '}
            {selected.end_date ? new Date(selected.end_date).toLocaleDateString() : '?'}
          </p>
          <button
            onClick={() => onSelect({ ...selected, id: '' } as any)}
            className="text-xs text-gray-500 hover:text-gray-300 mt-1"
          >
            Change market
          </button>
        </div>
      )}

      <div className="flex gap-2 mb-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder="Search or paste a Polymarket URL..."
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
        <div className="bg-gray-800 rounded-lg border border-gray-700 max-h-52 overflow-y-auto">
          {results.map((m) => (
            <button
              key={m.id}
              onClick={() => { onSelect(m); setResults([]); setQuery(''); }}
              className="w-full text-left px-4 py-3 hover:bg-gray-700 border-b border-gray-700 last:border-0"
            >
              <p className="text-sm text-white truncate">{m.question}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {m.price != null ? `${(m.price * 100).toFixed(1)}¢` : 'N/A'} ·{' '}
                ends {m.end_date ? new Date(m.end_date).toLocaleDateString() : '?'}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const date = new Date(label * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const price = payload[0]?.value;
  return (
    <div className="bg-gray-900 border border-gray-600 rounded p-3 text-sm">
      <p className="text-gray-400">{date}</p>
      <p className="text-white font-bold">{price != null ? `${(price * 100).toFixed(1)}¢` : '—'}</p>
    </div>
  );
};

function PriceChart({
  history,
  question,
  color,
  loading,
  error,
}: {
  history: MarketHistory | null;
  question: string;
  color: string;
  loading: boolean;
  error: string;
}) {
  const [autoscale, setAutoscale] = useState(false);
  const data = history?.history ?? [];
  const currentPrice = history?.current_price;

  const yDomain: [number | string, number | string] = autoscale
    ? ['auto', 'auto']
    : [0, 1];

  return (
    <div className="bg-gray-900 rounded-xl p-6 border border-gray-700">
      <div className="flex items-start justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
          <p className="text-sm font-medium text-white leading-snug">{question}</p>
        </div>
        <div className="flex items-center gap-3 ml-4 flex-shrink-0">
          {currentPrice != null && (
            <span className="text-sm font-bold text-white">
              {(currentPrice * 100).toFixed(1)}¢
            </span>
          )}
          <button
            onClick={() => setAutoscale(a => !a)}
            className={`text-xs px-2 py-0.5 rounded border transition-colors ${
              autoscale
                ? 'bg-indigo-600 border-indigo-500 text-white'
                : 'bg-gray-800 border-gray-600 text-gray-400 hover:text-gray-200'
            }`}
          >
            Autoscale
          </button>
        </div>
      </div>

      <div className="h-56 mt-4">
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            Loading price history...
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-red-400 text-sm">{error}</div>
        ) : data.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            No price history available
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="t"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(v) =>
                  new Date(v * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                }
                stroke="#6b7280"
                tick={{ fill: '#9ca3af', fontSize: 10 }}
                tickCount={6}
              />
              <YAxis
                domain={yDomain}
                tickFormatter={(v) => `${(v * 100).toFixed(0)}¢`}
                stroke="#6b7280"
                tick={{ fill: '#9ca3af', fontSize: 10 }}
                width={36}
              />
              <Tooltip content={<ChartTooltip />} />
              {!autoscale && <ReferenceLine y={0.5} stroke="#4b5563" strokeDasharray="4 3" strokeWidth={1} />}
              <Line
                type="monotone"
                dataKey="p"
                stroke={color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: color }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

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
      <div className="bg-gray-900 rounded-xl border border-gray-700 p-6 flex items-center justify-center h-40">
        <p className="text-gray-500 text-sm animate-pulse">Computing correlation…</p>
      </div>
    );
  }
  if (!result) return null;
  if (result.error) {
    return (
      <div className="bg-gray-900 rounded-xl border border-gray-700 p-6">
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
    <div className="bg-gray-900 rounded-xl border border-gray-700 p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">Correlation Analysis</h3>
        <div className="flex items-center gap-3">
          {result.short_history_warning && (
            <span className="text-xs bg-yellow-900 text-yellow-300 px-2 py-0.5 rounded">Short history</span>
          )}
          {result.break_detected && (
            <span className="text-xs bg-orange-900 text-orange-300 px-2 py-0.5 rounded">Regime break detected</span>
          )}
          <span className="text-xs text-gray-500">{result.shared_history_days}d shared · {result.n_observations} obs</span>
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-gray-800 rounded-lg p-3">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Pearson (logit)</p>
          <p className="text-2xl font-bold" style={{ color: rColor }}>{r >= 0 ? '+' : ''}{r.toFixed(3)}</p>
          <p className="text-xs text-gray-500 mt-0.5">on returns: {result.full_pearson_returns >= 0 ? '+' : ''}{result.full_pearson_returns.toFixed(3)}</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-3">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Rolling Stability</p>
          <p className="text-xl font-bold text-white">{result.rolling_mean >= 0 ? '+' : ''}{result.rolling_mean.toFixed(3)}</p>
          <p className="text-xs text-gray-500 mt-0.5">±{result.rolling_std.toFixed(3)} · {(result.rolling_pct_positive * 100).toFixed(0)}% positive</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-3">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Lead / Lag</p>
          <p className="text-sm font-bold text-white leading-tight mt-1">{lagLabel()}</p>
          <p className="text-xs text-gray-500 mt-0.5">r={result.lag_correlation.toFixed(3)}</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-3">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Granger Causality</p>
          <p className="text-sm font-bold text-white leading-tight mt-1">{grangerLabel()}</p>
          <p className="text-xs text-gray-500 mt-0.5">Composite: {score.toFixed(2)}</p>
        </div>
      </div>

      {/* Structural break info */}
      {result.break_detected && result.pre_break_pearson !== null && (
        <div className="flex gap-4 text-sm">
          <span className="text-gray-400">Pre-break Pearson: <span className="text-white font-medium">{result.pre_break_pearson!.toFixed(3)}</span></span>
          <span className="text-gray-400">Post-break Pearson: <span className="text-white font-medium">{result.post_break_pearson!.toFixed(3)}</span></span>
        </div>
      )}

      {/* Rolling correlation chart */}
      {result.rolling_series.length > 2 && (
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Rolling Correlation (logit prices)</p>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={result.rolling_series} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(v) => new Date(v * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  stroke="#6b7280"
                  tick={{ fill: '#9ca3af', fontSize: 10 }}
                  tickCount={6}
                />
                <YAxis domain={[-1, 1]} stroke="#6b7280" tick={{ fill: '#9ca3af', fontSize: 10 }} width={28} tickFormatter={(v) => v.toFixed(1)} />
                <Tooltip
                  formatter={(v) => [Number(v).toFixed(3), 'Correlation']}
                  labelFormatter={(t) => new Date((t as number) * 1000).toLocaleDateString()}
                  contentStyle={{ background: '#111827', border: '1px solid #374151' }}
                  labelStyle={{ color: '#9ca3af' }}
                />
                <ReferenceLine y={0} stroke="#4b5563" strokeDasharray="4 3" />
                <Line type="monotone" dataKey="r" stroke="#818cf8" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* CCF bar chart */}
      {result.lag_series.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Cross-Correlation Function (logit returns)</p>
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={result.lag_series} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="lag" stroke="#6b7280" tick={{ fill: '#9ca3af', fontSize: 10 }} />
                <YAxis domain={[-1, 1]} stroke="#6b7280" tick={{ fill: '#9ca3af', fontSize: 10 }} width={28} tickFormatter={(v) => v.toFixed(1)} />
                <Tooltip
                  formatter={(v) => [Number(v).toFixed(3), 'r']}
                  labelFormatter={(l) => `Lag ${l} days`}
                  contentStyle={{ background: '#111827', border: '1px solid #374151' }}
                  labelStyle={{ color: '#9ca3af' }}
                />
                <ReferenceLine y={0} stroke="#4b5563" />
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

export default function MarketCompare({ initialMarketB }: { initialMarketB?: Market }) {
  const [marketA, setMarketA] = useState<Market | null>(null);
  const [marketB, setMarketB] = useState<Market | null>(null);
  const [historyA, setHistoryA] = useState<MarketHistory | null>(null);
  const [historyB, setHistoryB] = useState<MarketHistory | null>(null);
  const [loadingA, setLoadingA] = useState(false);
  const [loadingB, setLoadingB] = useState(false);
  const [errorA, setErrorA] = useState('');
  const [errorB, setErrorB] = useState('');
  const [interval, setInterval] = useState('1m');
  const [correlation, setCorrelation] = useState<CorrelationResult | null>(null);
  const [corrLoading, setCorrLoading] = useState(false);

  useEffect(() => {
    if (!marketA?.id || !marketB?.id) { setCorrelation(null); return; }
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
      const setLoading = slot === 'A' ? setLoadingA : setLoadingB;
      const setHistory = slot === 'A' ? setHistoryA : setHistoryB;
      const setError = slot === 'A' ? setErrorA : setErrorB;
      setLoading(true);
      setError('');
      try {
        setHistory(await getPolymarketHistory(market.id, iv));
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

  // Pre-populate Market B when navigating from Correlation Scanner
  useEffect(() => {
    if (initialMarketB?.id) {
      handleSelectB(initialMarketB);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMarketB?.id]);

  const handleIntervalChange = (iv: string) => {
    setInterval(iv);
    if (marketA?.id) fetchHistory(marketA, 'A', iv);
    if (marketB?.id) fetchHistory(marketB, 'B', iv);
  };

  const hasCharts = (marketA && (historyA || loadingA || errorA)) ||
                    (marketB && (historyB || loadingB || errorB));

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">Market Comparator</h2>
        <p className="text-gray-400 text-sm mt-1">
          Pick any two Polymarket markets and compare their price histories.
        </p>
      </div>

      {/* Market pickers */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <MarketPicker label="Market A" color={MARKET_A_COLOR} selected={marketA} onSelect={handleSelectA} />
        <MarketPicker label="Market B" color={MARKET_B_COLOR} selected={marketB} onSelect={handleSelectB} />
      </div>

      {/* Time range selector */}
      {hasCharts && (
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs text-gray-500 uppercase tracking-wider">Range:</span>
          {INTERVALS.map((iv) => (
            <button
              key={iv.value}
              onClick={() => handleIntervalChange(iv.value)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                interval === iv.value
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-gray-200'
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
          />
        )}
        {marketB && (
          <PriceChart
            history={historyB}
            question={marketB.question}
            color={MARKET_B_COLOR}
            loading={loadingB}
            error={errorB}
          />
        )}
        {!marketA && !marketB && (
          <div className="bg-gray-900 rounded-xl border border-gray-700 flex items-center justify-center h-48">
            <p className="text-gray-500 text-sm">Search and select markets above to see their charts.</p>
          </div>
        )}
      </div>

      {/* Correlation panel — shown once both markets are selected */}
      {marketA && marketB && (
        <div className="mt-4">
          <CorrelationPanel
            result={correlation}
            marketA={marketA}
            marketB={marketB}
            loading={corrLoading}
          />
        </div>
      )}
    </div>
  );
}
