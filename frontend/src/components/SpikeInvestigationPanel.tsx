import { useState, useEffect } from 'react';
import { investigateSpike, SpikeInvestigationResponse, Market } from '../api/client';

const CONFIDENCE_META = {
  high:   { label: 'High confidence',   color: '#34d399', bg: '#065f46' },
  medium: { label: 'Medium confidence', color: '#fbbf24', bg: '#78350f' },
  low:    { label: 'Low confidence',    color: '#9ca3af', bg: '#374151' },
};

export interface SpikePoint {
  t: number;   // Unix timestamp
  p: number;   // Price (0–1)
}

interface Props {
  market: Market | null;
  selectedPoint: SpikePoint | null;
  marketLabel?: string;   // e.g. "Market A" or "Market B"
  accentColor?: string;
  onClear?: () => void;
}

export default function SpikeInvestigationPanel({
  market,
  selectedPoint,
  marketLabel = 'Market',
  accentColor = '#818cf8',
  onClear,
}: Props) {
  const [result, setResult] = useState<SpikeInvestigationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showDebug, setShowDebug] = useState(false);

  // Auto-run whenever selectedPoint changes
  useEffect(() => {
    if (!market || !selectedPoint) {
      setResult(null);
      setError('');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setResult(null);
    setError('');

    investigateSpike({
      question: market.question,
      spike_timestamp: selectedPoint.t,
      spike_price: selectedPoint.p,
      market_id: market.id,
    })
      .then((r) => { if (!cancelled) setResult(r); })
      .catch(() => { if (!cancelled) setError('Investigation failed — check that ANTHROPIC_API_KEY is configured.'); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market?.id, selectedPoint?.t]);

  // Don't render when no market selected
  if (!market) return null;

  const confidenceMeta = result ? (CONFIDENCE_META[result.confidence] ?? CONFIDENCE_META.low) : null;

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-700 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: accentColor }} />
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Spike Investigation — {marketLabel}
          </span>
          <span className="text-[10px] bg-indigo-900 text-indigo-300 px-1.5 py-0.5 rounded font-medium">
            AI + Web
          </span>
        </div>
        {selectedPoint && onClear && (
          <button
            onClick={onClear}
            className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Empty state */}
      {!selectedPoint && !loading && (
        <p className="text-gray-500 text-xs">
          Click any point on the <span style={{ color: accentColor }}>{marketLabel}</span> chart
          above to investigate what news drove that price level.
        </p>
      )}

      {/* Loading */}
      {loading && selectedPoint && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-gray-500 text-xs animate-pulse">
            <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
            Searching news from {new Date(selectedPoint.t * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}…
          </div>
          <div className="text-[10px] text-gray-600">Claude Haiku is searching for relevant news events</div>
        </div>
      )}

      {/* Error */}
      {error && <p className="text-red-400 text-xs">{error}</p>}

      {/* Result */}
      {result && confidenceMeta && (
        <div className="space-y-3">
          {/* Date + price + confidence row */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="bg-gray-800 rounded-lg px-3 py-1.5">
              <span className="text-xs text-gray-400">Date: </span>
              <span className="text-xs font-semibold text-white">{result.date}</span>
            </div>
            <div className="bg-gray-800 rounded-lg px-3 py-1.5">
              <span className="text-xs text-gray-400">Price: </span>
              <span className="text-xs font-semibold text-white">{(result.price * 100).toFixed(1)}¢</span>
            </div>
            <div
              className="text-[11px] font-semibold px-2.5 py-1 rounded-lg"
              style={{ color: confidenceMeta.color, backgroundColor: confidenceMeta.bg + '66' }}
            >
              {confidenceMeta.label}
            </div>
          </div>

          {/* Events */}
          {result.events.length > 0 && (
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Key Events</p>
              <ul className="space-y-1">
                {result.events.map((ev, i) => (
                  <li key={i} className="flex gap-2 text-xs text-gray-300">
                    <span className="text-amber-500 flex-shrink-0">•</span>
                    <span>{ev}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Explanation */}
          <div className="border-t border-gray-800 pt-3">
            <p className="text-sm text-gray-300 leading-relaxed">{result.explanation}</p>
          </div>

          {/* Debug: search query + raw context */}
          {(result.search_query || result.raw_context) && (
            <div className="border-t border-gray-800 pt-2">
              <button
                onClick={() => setShowDebug(d => !d)}
                className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors flex items-center gap-1"
              >
                <span>{showDebug ? '▾' : '▸'}</span>
                <span>Search debug</span>
              </button>
              {showDebug && (
                <div className="mt-2 space-y-2">
                  {result.search_query && (
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Query sent to Claude</p>
                      <pre className="text-[10px] text-gray-400 bg-gray-800 rounded p-2 whitespace-pre-wrap leading-relaxed">
                        {result.search_query}
                      </pre>
                    </div>
                  )}
                  {result.raw_context && (
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Raw web search context</p>
                      <pre className="text-[10px] text-gray-400 bg-gray-800 rounded p-2 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                        {result.raw_context}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

