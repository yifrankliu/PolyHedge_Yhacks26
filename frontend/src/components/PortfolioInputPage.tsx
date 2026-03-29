import { useEffect, useMemo, useState } from 'react';
import {
  Market,
  getPolymarketHistory,
  getKalshiMarket,
  getPolymarketMarket,
  searchKalshi,
  searchPolymarket,
} from '../api/client';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type Source = 'polymarket' | 'kalshi';
type Side = 'YES' | 'NO';
type Status = 'current' | 'proposed';
type MarketInputMode = 'search' | 'manual_id';

export type PortfolioPosition = {
  id: string;
  market_id: string;
  market_question: string;
  source: Source;
  side: Side;
  status: Status;
  entry_price_cents: number;
  stake_usd: number;
  notes: string;
};

type Position = PortfolioPosition;

function MarketLookup({
  title,
  hint,
  onSelect,
}: {
  title: string;
  hint: string;
  onSelect: (market: Market, source: Source) => void;
}) {
  const [source, setSource] = useState<Source>('polymarket');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Market[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const runSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    try {
      const fn = source === 'polymarket' ? searchPolymarket : searchKalshi;
      const data = await fn(query.trim());
      setResults(data.slice(0, 8));
      if (!data.length) {
        setError('No markets found for that query.');
      }
    } catch {
      setError('Unable to search markets right now.');
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
      <p className="text-sm font-semibold text-gray-200">{title}</p>
      <p className="text-xs text-gray-500 mt-1 mb-3">{hint}</p>

      <div className="flex gap-2">
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as Source)}
          className="bg-gray-700 text-white rounded px-3 py-2 text-sm border border-gray-600"
        >
          <option value="polymarket">Polymarket</option>
          <option value="kalshi">Kalshi</option>
        </select>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runSearch()}
          placeholder="Search market by keyword..."
          className="flex-1 bg-gray-700 text-white rounded px-3 py-2 text-sm border border-gray-600 focus:outline-none focus:border-indigo-500"
        />
        <button
          onClick={runSearch}
          disabled={loading}
          className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
        >
          {loading ? '...' : 'Search'}
        </button>
      </div>

      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}

      {results.length > 0 && (
        <div className="mt-3 bg-gray-800 rounded-lg border border-gray-700 max-h-56 overflow-y-auto">
          {results.map((market) => (
            <button
              key={market.id}
              onClick={() => {
                onSelect(market, source);
                setResults([]);
                setQuery(market.question);
              }}
              className="w-full text-left px-4 py-3 hover:bg-gray-700 border-b border-gray-700 last:border-0"
            >
              <p className="text-sm text-white truncate">{market.question}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {market.price != null ? `${(market.price * 100).toFixed(1)}¢` : 'N/A'} ·{' '}
                {market.end_date ? new Date(market.end_date).toLocaleDateString() : 'no date'}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const calcMaxProfit = (entryPriceCents: number, stakeUsd: number) => {
  const p = entryPriceCents / 100;
  if (p <= 0) return 0;
  return stakeUsd * (1 / p - 1);
};

const formatCents = (value: number) => value.toFixed(1);
const toMillis = (t: number) => (t < 1_000_000_000_000 ? t * 1000 : t);
const formatTime = (t: number) =>
  new Date(toMillis(t)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export default function PortfolioInputPage({ onScanHedges }: { onScanHedges?: (positions: PortfolioPosition[]) => void }) {
  const [positionInputMode, setPositionInputMode] = useState<MarketInputMode>('search');
  const [positionMarket, setPositionMarket] = useState<{
    market_id: string;
    question: string;
    source: Source;
    market_price_cents: number | null;
  } | null>(null);
  const [manualSource, setManualSource] = useState<Source>('polymarket');
  const [manualMarketId, setManualMarketId] = useState('');
  const [manualLoading, setManualLoading] = useState(false);
  const [manualError, setManualError] = useState('');

  const [status, setStatus] = useState<Status>('current');
  const [side, setSide] = useState<Side>('YES');
  const [entryPriceCents, setEntryPriceCents] = useState('');
  const [stakeUsd, setStakeUsd] = useState('');
  const [notes, setNotes] = useState('');
  const [positions, setPositions] = useState<Position[]>([]);

  const [goalHedge, setGoalHedge] = useState(true);
  const [goalArb, setGoalArb] = useState(false);
  const [goalDownside, setGoalDownside] = useState(true);
  const [goalPnL, setGoalPnL] = useState(true);
  const [maxNewPositions, setMaxNewPositions] = useState('3');
  const [hedgeBudgetUsd, setHedgeBudgetUsd] = useState('500');
  const [minCorrelation, setMinCorrelation] = useState('0.35');

  const [formError, setFormError] = useState('');
  const [graphMarketId, setGraphMarketId] = useState('');
  const [graphInterval, setGraphInterval] = useState<'1m' | '1w' | 'max'>('1w');
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphError, setGraphError] = useState('');
  const [graphSeries, setGraphSeries] = useState<Array<{ t: number; p: number }>>([]);
  const [graphCurrentPrice, setGraphCurrentPrice] = useState<number | null>(null);

  const liveEntryPriceCents = useMemo(() => {
    if (!positionMarket || positionMarket.market_price_cents == null) return null;
    const yesPrice = positionMarket.market_price_cents;
    return side === 'YES' ? yesPrice : Math.max(0, 100 - yesPrice);
  }, [positionMarket, side]);

  const graphCandidates = useMemo(() => {
    const map = new Map<string, string>();
    if (positionMarket?.source === 'polymarket') {
      map.set(positionMarket.market_id, positionMarket.question);
    }
    positions
      .filter((position) => position.source === 'polymarket')
      .forEach((position) => map.set(position.market_id, position.market_question));
    return Array.from(map.entries()).map(([id, question]) => ({ id, question }));
  }, [positionMarket, positions]);

  useEffect(() => {
    if (!graphCandidates.length) {
      setGraphMarketId('');
      setGraphSeries([]);
      setGraphCurrentPrice(null);
      setGraphError('');
      return;
    }
    const stillValid = graphCandidates.some((candidate) => candidate.id === graphMarketId);
    if (!graphMarketId || !stillValid) {
      setGraphMarketId(graphCandidates[0].id);
    }
  }, [graphCandidates, graphMarketId]);

  useEffect(() => {
    const load = async () => {
      if (!graphMarketId) return;
      setGraphLoading(true);
      setGraphError('');
      try {
        const res = await getPolymarketHistory(graphMarketId, graphInterval);
        const points = (res.history || [])
          .map((point) => ({ t: Number(point.t), p: Number(point.p) * 100 }))
          .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.p));
        setGraphSeries(points);
        setGraphCurrentPrice(
          res.current_price != null && Number.isFinite(Number(res.current_price))
            ? Number(res.current_price) * 100
            : null,
        );
      } catch {
        setGraphSeries([]);
        setGraphCurrentPrice(null);
        setGraphError('Could not load market history.');
      } finally {
        setGraphLoading(false);
      }
    };
    load();
  }, [graphInterval, graphMarketId]);

  const applySelectedMarket = (market: Market, source: Source) => {
    setPositionMarket({
      market_id: market.id,
      question: market.question,
      source,
      market_price_cents: market.price != null ? market.price * 100 : null,
    });
    setManualError('');
    setFormError('');
    setEntryPriceCents('');
  };

  const lookupManualMarket = async () => {
    const id = manualMarketId.trim();
    if (!id) {
      setManualError('Enter a market ID/ticker first.');
      return;
    }
    setManualLoading(true);
    setManualError('');
    try {
      const market = manualSource === 'polymarket' ? await getPolymarketMarket(id) : await getKalshiMarket(id);
      applySelectedMarket(market, manualSource);
    } catch {
      setManualError('Could not find a market with that ID/ticker.');
      setPositionMarket(null);
    } finally {
      setManualLoading(false);
    }
  };

  const addPosition = () => {
    setFormError('');
    const stake = parseFloat(stakeUsd);

    if (!positionMarket?.market_id) {
      setFormError('Select a real market before adding a position.');
      return;
    }
    if (Number.isNaN(stake) || stake <= 0) {
      setFormError('Stake must be greater than 0.');
      return;
    }

    const resolvedEntry =
      status === 'proposed' && liveEntryPriceCents != null
        ? liveEntryPriceCents
        : parseFloat(entryPriceCents);

    if (Number.isNaN(resolvedEntry) || resolvedEntry <= 0 || resolvedEntry >= 100) {
      setFormError('Entry price must be between 0 and 100 cents.');
      return;
    }

    const newPosition: Position = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      market_id: positionMarket.market_id,
      market_question: positionMarket.question,
      source: positionMarket.source,
      side,
      status,
      entry_price_cents: resolvedEntry,
      stake_usd: stake,
      notes: notes.trim(),
    };

    setPositions((prev) => [newPosition, ...prev]);
    setPositionMarket(null);
    setEntryPriceCents('');
    setStakeUsd('');
    setNotes('');
    setStatus('current');
    setSide('YES');
    setManualMarketId('');
    setManualError('');
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Portfolio Input Workbench</h2>
        <p className="text-sm text-gray-400 mt-1">
          Add the exact markets and positions you hold or are considering.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        <div className="xl:col-span-3 space-y-5">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-4">
            <p className="text-sm font-semibold text-gray-200">1. Add Position</p>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Market Input Method</label>
              <select
                value={positionInputMode}
                onChange={(e) => {
                  setPositionInputMode(e.target.value as MarketInputMode);
                  setPositionMarket(null);
                  setManualError('');
                  setFormError('');
                }}
                className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm border border-gray-600"
              >
                <option value="search">Search by keyword</option>
                <option value="manual_id">Enter exact market ID/ticker</option>
              </select>
            </div>

            {positionInputMode === 'search' ? (
              <MarketLookup
                title="Find Position Market"
                hint="Search and select the exact market for this position."
                onSelect={(market, source) => applySelectedMarket(market, source)}
              />
            ) : (
              <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Source</label>
                    <select
                      value={manualSource}
                      onChange={(e) => setManualSource(e.target.value as Source)}
                      className="w-full bg-gray-900 text-white rounded px-3 py-2 text-sm border border-gray-600"
                    >
                      <option value="polymarket">Polymarket</option>
                      <option value="kalshi">Kalshi</option>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs text-gray-400 mb-1">
                      {manualSource === 'polymarket' ? 'Polymarket Market ID' : 'Kalshi Ticker'}
                    </label>
                    <div className="flex gap-2">
                      <input
                        value={manualMarketId}
                        onChange={(e) => setManualMarketId(e.target.value)}
                        placeholder={manualSource === 'polymarket' ? 'e.g. 12345' : 'e.g. KXBTC-30APR26-B90000'}
                        className="flex-1 bg-gray-900 text-white rounded px-3 py-2 text-sm border border-gray-600 focus:outline-none focus:border-indigo-500"
                      />
                      <button
                        onClick={lookupManualMarket}
                        disabled={manualLoading}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
                      >
                        {manualLoading ? '...' : 'Load'}
                      </button>
                    </div>
                  </div>
                </div>
                {manualError && <p className="text-xs text-red-400">{manualError}</p>}
              </div>
            )}

            {positionMarket ? (
              <div className="text-xs bg-gray-800 border border-gray-600 rounded p-2 text-gray-300 flex justify-between items-center gap-3">
                <div>
                  Selected market: <span className="text-white">{positionMarket.question}</span>
                  <span className="text-gray-500"> ({positionMarket.source} · {positionMarket.market_id})</span>
                </div>
                <button
                  onClick={() => setPositionMarket(null)}
                  className="text-red-300 hover:text-red-200 whitespace-nowrap"
                >
                  Clear
                </button>
              </div>
            ) : (
              <p className="text-xs text-amber-300 bg-amber-900/20 border border-amber-700/40 rounded p-2">
                Choose a market first. Position details appear afterward.
              </p>
            )}

            {positionMarket && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Is this already taken or being considered?
                    </label>
                    <select
                      value={status}
                      onChange={(e) => {
                        setStatus(e.target.value as Status);
                        setFormError('');
                      }}
                      className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm border border-gray-600"
                    >
                      <option value="current">Already Taken</option>
                      <option value="proposed">Considering</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Side</label>
                    <select
                      value={side}
                      onChange={(e) => setSide(e.target.value as Side)}
                      className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm border border-gray-600"
                    >
                      <option value="YES">YES</option>
                      <option value="NO">NO</option>
                    </select>
                  </div>
                </div>

                {status === 'current' ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Your Entry Price (cents)</label>
                      <input
                        type="number"
                        min="0.1"
                        max="99.9"
                        step="0.1"
                        value={entryPriceCents}
                        onChange={(e) => setEntryPriceCents(e.target.value)}
                        placeholder="Manual input for existing position"
                        className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm border border-gray-600 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Stake ($)</label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={stakeUsd}
                        onChange={(e) => setStakeUsd(e.target.value)}
                        className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm border border-gray-600 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Live Entry Price (cents)</label>
                      <input
                        type="text"
                        readOnly
                        value={liveEntryPriceCents != null ? formatCents(liveEntryPriceCents) : 'Unavailable'}
                        className="w-full bg-gray-700 text-gray-200 rounded px-3 py-2 text-sm border border-gray-600"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Auto-filled from current market price for {side}.
                      </p>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Stake ($)</label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={stakeUsd}
                        onChange={(e) => setStakeUsd(e.target.value)}
                        className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm border border-gray-600 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    {liveEntryPriceCents == null && (
                      <div className="md:col-span-2">
                        <label className="block text-xs text-gray-400 mb-1">Fallback Entry Price (cents)</label>
                        <input
                          type="number"
                          min="0.1"
                          max="99.9"
                          step="0.1"
                          value={entryPriceCents}
                          onChange={(e) => setEntryPriceCents(e.target.value)}
                          placeholder="Only needed when live price is unavailable"
                          className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm border border-gray-600 focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-xs text-gray-400 mb-1">Notes</label>
                  <input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Optional context for this leg"
                    className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm border border-gray-600 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                {formError && <p className="text-xs text-red-400">{formError}</p>}

                <button
                  onClick={addPosition}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded text-sm font-semibold"
                >
                  Add Position
                </button>
              </>
            )}
          </div>

          <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
            <p className="text-sm font-semibold text-gray-200 mb-3">2. Recommendation Preferences</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <label className="flex items-center gap-2 text-gray-300">
                <input type="checkbox" checked={goalHedge} onChange={() => setGoalHedge((v) => !v)} />
                Hedge correlated risk
              </label>
              <label className="flex items-center gap-2 text-gray-300">
                <input type="checkbox" checked={goalArb} onChange={() => setGoalArb((v) => !v)} />
                Find arbitrage-like spreads
              </label>
              <label className="flex items-center gap-2 text-gray-300">
                <input type="checkbox" checked={goalDownside} onChange={() => setGoalDownside((v) => !v)} />
                Minimize downside
              </label>
              <label className="flex items-center gap-2 text-gray-300">
                <input type="checkbox" checked={goalPnL} onChange={() => setGoalPnL((v) => !v)} />
                Return PnL visual data
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Max New Positions</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={maxNewPositions}
                  onChange={(e) => setMaxNewPositions(e.target.value)}
                  className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm border border-gray-600"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Hedge Budget ($)</label>
                <input
                  type="number"
                  min="0"
                  value={hedgeBudgetUsd}
                  onChange={(e) => setHedgeBudgetUsd(e.target.value)}
                  className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm border border-gray-600"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Min Correlation Score</label>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={minCorrelation}
                  onChange={(e) => setMinCorrelation(e.target.value)}
                  className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm border border-gray-600"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="xl:col-span-2 space-y-5">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-gray-200">Positions Added ({positions.length})</p>
              <button
                onClick={() => setPositions([])}
                disabled={!positions.length}
                className="text-xs text-gray-400 hover:text-white disabled:opacity-40"
              >
                Clear
              </button>
            </div>
            {positions.length === 0 ? (
              <p className="text-sm text-gray-500">No positions yet. Add one from the form.</p>
            ) : (
              <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                {positions.map((position) => {
                  const maxProfit = calcMaxProfit(position.entry_price_cents, position.stake_usd);
                  return (
                    <div key={position.id} className="bg-gray-800 rounded-lg border border-gray-700 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm text-white">{position.market_question}</p>
                          <p className="text-xs text-gray-400 mt-1">
                            {position.source} · {position.side} · {position.status}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                            Entry {position.entry_price_cents.toFixed(1)}¢ · Stake $
                            {position.stake_usd.toFixed(0)} · Max loss ${position.stake_usd.toFixed(0)} · Max
                            profit ${maxProfit.toFixed(0)}
                          </p>
                          {position.notes && <p className="text-xs text-gray-500 mt-1">Note: {position.notes}</p>}
                        </div>
                        <button
                          onClick={() => setPositions((prev) => prev.filter((item) => item.id !== position.id))}
                          className="text-xs text-red-300 hover:text-red-200"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <p className="text-sm font-semibold text-gray-200">Market Graph</p>
              {graphCandidates.length > 0 && (
                <div className="flex items-center gap-2">
                  <select
                    value={graphMarketId}
                    onChange={(e) => setGraphMarketId(e.target.value)}
                    className="bg-gray-800 text-white rounded px-2 py-1.5 text-xs border border-gray-600 max-w-[220px]"
                  >
                    {graphCandidates.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.question}
                      </option>
                    ))}
                  </select>
                  <select
                    value={graphInterval}
                    onChange={(e) => setGraphInterval(e.target.value as '1m' | '1w' | 'max')}
                    className="bg-gray-800 text-white rounded px-2 py-1.5 text-xs border border-gray-600"
                  >
                    <option value="1m">1m</option>
                    <option value="1w">1w</option>
                    <option value="max">max</option>
                  </select>
                </div>
              )}
            </div>

            {graphCandidates.length === 0 ? (
              <p className="text-sm text-gray-500">
                Select a Polymarket market to view its price history.
              </p>
            ) : graphLoading ? (
              <p className="text-sm text-gray-400">Loading history...</p>
            ) : graphError ? (
              <p className="text-sm text-red-400">{graphError}</p>
            ) : graphSeries.length === 0 ? (
              <p className="text-sm text-gray-500">No history data available for this market.</p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={graphSeries} margin={{ top: 5, right: 15, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis
                      dataKey="t"
                      tickFormatter={formatTime}
                      stroke="#6b7280"
                      tick={{ fill: '#9ca3af', fontSize: 10 }}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tickFormatter={(v) => `${Number(v).toFixed(0)}¢`}
                      stroke="#6b7280"
                      tick={{ fill: '#9ca3af', fontSize: 10 }}
                    />
                    <Tooltip
                      formatter={(value: any) => [`${Number(value).toFixed(2)}¢`, 'YES price']}
                      labelFormatter={(label) => new Date(toMillis(Number(label))).toLocaleString()}
                      contentStyle={{ backgroundColor: '#111827', border: '1px solid #4b5563', borderRadius: 8 }}
                      labelStyle={{ color: '#9ca3af' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="p"
                      stroke="#818cf8"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
                <p className="text-xs text-gray-500 mt-2">
                  Current YES price: {graphCurrentPrice != null ? `${graphCurrentPrice.toFixed(2)}¢` : 'N/A'}
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {onScanHedges && (
        <button
          onClick={() => onScanHedges(positions)}
          disabled={positions.length === 0}
          className="w-full py-4 rounded-xl font-bold text-base tracking-wide transition-colors disabled:opacity-40 text-white"
          style={{ backgroundColor: positions.length === 0 ? undefined : '#0d1b3e', background: positions.length > 0 ? 'linear-gradient(135deg, #0d1b3e 0%, #1a2f6b 100%)' : undefined }}
        >
          Scan for Hedges →
        </button>
      )}
    </div>
  );
}
