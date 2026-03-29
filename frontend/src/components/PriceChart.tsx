import { useState, useMemo } from 'react';
import {
  ComposedChart,
  Line,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { MarketHistory, VolumePoint } from '../api/client';

function formatActivity(v: number): string {
  return `${v.toFixed(1)}¢ moved`;
}

// ── Custom tooltip ─────────────────────────────────────────────────────────────
// Payload carries both the price (dataKey "p") and raw activity (dataKey "rawV")
// so we can show the original ¢-moved value even though bars use normalised "vd".
const ChartTooltip = ({ active, payload, label, hasVolume, onPointClick }: any) => {
  if (!active || !payload?.length) return null;
  const date    = new Date(label * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const priceEntry = payload.find((p: any) => p.dataKey === 'p');
  const volEntry   = payload.find((p: any) => p.dataKey === 'rawV');
  const price = priceEntry?.value;
  const vol   = volEntry?.value;
  return (
    <div className="bg-gray-900 border border-gray-600 rounded p-3 text-sm space-y-1">
      <p className="text-gray-400">{date}</p>
      {price != null && (
        <p className="text-white font-bold">{(price * 100).toFixed(1)}¢</p>
      )}
      {hasVolume && vol != null && (
        <p className="text-amber-400 text-xs">Activity {formatActivity(vol)}</p>
      )}
      {onPointClick && (
        <p className="text-[10px] text-indigo-400">Click to investigate</p>
      )}
    </div>
  );
};

export default function PriceChart({
  history,
  question,
  color,
  loading,
  error,
  volumeData,
  onPointClick,
  selectedPoint,
}: {
  history: MarketHistory | null;
  question: string;
  color: string;
  loading: boolean;
  error: string;
  volumeData?: VolumePoint[] | null;
  onPointClick?: (point: { t: number; p: number }) => void;
  selectedPoint?: { t: number; p: number } | null;
}) {
  const [autoscale, setAutoscale] = useState(false);
  const [showVolume, setShowVolume] = useState(true);

  const data         = history?.history ?? [];
  const currentPrice = history?.current_price;
  const hasVolume    = showVolume && (volumeData?.length ?? 0) > 0;

  // ── Whale threshold (based on raw activity values) ─────────────────────────
  const { actMax, whaleThreshold } = useMemo(() => {
    if (!volumeData?.length) return { actMax: 1, whaleThreshold: Infinity };
    const vals = [...volumeData.map(v => v.v)].sort((a, b) => a - b);
    const median = vals[Math.floor(vals.length / 2)];
    return {
      actMax: Math.max(...vals, 1),
      whaleThreshold: median * 2.5,
    };
  }, [volumeData]);

  // ── Build merged dataset + compute Y domain ────────────────────────────────
  // Strategy: reserve the bottom 25 % of chart height for activity bars.
  // We achieve this by:
  //   1. Computing the actual price range in the dataset.
  //   2. Normalising raw activity → a value in [0, reservedHeight] where
  //      reservedHeight = priceRange * 0.30.
  //   3. Setting the Y-axis domain to [priceMin - reservedHeight * 1.15, priceMax + pad]
  //      so the reserved zone is always visible regardless of autoscale state.
  //   4. Adding a subtle separator ReferenceLine at priceMin.
  //   5. Using a SINGLE Y-axis — no dual-axis confusion.
  const { mergedData, yDomain, reservedFloor } = useMemo(() => {
    if (!data.length) return { mergedData: [], yDomain: [0, 1] as [number, number], reservedFloor: 0 };

    const prices  = data.map(pt => pt.p);
    const priceMin = Math.min(...prices);
    const priceMax = Math.max(...prices);
    const pRange   = Math.max(priceMax - priceMin, 0.01);

    const reserved = pRange * 0.30;           // 30 % of range reserved for bars
    const floor    = priceMin - reserved;      // bottom of reserved zone

    // Domain: from floor (with a little extra gap) to priceMax + small top pad
    const domainLow  = Math.max(0, floor - reserved * 0.15);
    const domainHigh = autoscale ? priceMax + pRange * 0.05 : priceMax + pRange * 0.05;

    // Map raw activity → normalised height within reserved zone
    const normalize = (rawV?: number): number | undefined => {
      if (rawV == null || !hasVolume) return undefined;
      return floor + (rawV / actMax) * reserved;
    };

    const volByDay = volumeData?.length
      ? new Map(volumeData.map(v => [v.t, v.v]))
      : new Map<number, number>();

    const merged = data.map(pt => {
      const day   = Math.floor(pt.t / 86400) * 86400;
      const rawV  = volByDay.get(day);
      return { ...pt, rawV, vd: normalize(rawV) };
    });

    return {
      mergedData: merged,
      yDomain: [autoscale ? 'auto' : domainLow, autoscale ? 'auto' : domainHigh] as [number | string, number | string],
      reservedFloor: floor,
    };
  }, [data, volumeData, actMax, hasVolume, autoscale]);

  // ── Click handler ──────────────────────────────────────────────────────────
  const handleChartClick = (chartData: any) => {
    if (!onPointClick) return;
    const pt =
      chartData?.activePayload?.find((p: any) => p.dataKey === 'p')?.payload ??
      (chartData?.activeTooltipIndex != null ? mergedData[chartData.activeTooltipIndex] : null);
    if (pt) onPointClick({ t: pt.t, p: pt.p });
  };

  return (
    <div className="bg-gray-900 rounded-xl p-6 border border-gray-700">
      {/* Header */}
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
          {onPointClick && (
            <span className="text-[10px] text-gray-500 italic">Click to investigate</span>
          )}
          {(volumeData?.length ?? 0) > 0 && (
            <button
              onClick={() => setShowVolume(v => !v)}
              className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                showVolume
                  ? 'bg-amber-900 border-amber-700 text-amber-300'
                  : 'bg-gray-800 border-gray-600 text-gray-400 hover:text-gray-200'
              }`}
            >
              Activity
            </button>
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

      {/* Legend */}
      {hasVolume && (
        <div className="flex items-center gap-3 mt-1 mb-0.5">
          <div className="flex items-center gap-1">
            <span className="w-2 h-3 rounded-sm inline-block bg-gray-600 opacity-70" />
            <span className="text-[10px] text-gray-500">Normal activity</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-3 rounded-sm inline-block bg-amber-500 opacity-80" />
            <span className="text-[10px] text-amber-500">High activity (&gt;2.5× median)</span>
          </div>
        </div>
      )}

      <div className="h-56 mt-3">
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            Loading price history…
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-red-400 text-sm">{error}</div>
        ) : data.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            No price history available
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={mergedData}
              margin={{ top: 5, right: 10, bottom: 5, left: 0 }}
              onClick={onPointClick ? handleChartClick : undefined}
              style={onPointClick ? { cursor: 'crosshair' } : undefined}
            >
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

              <Tooltip
                content={
                  <ChartTooltip
                    hasVolume={hasVolume}
                    onPointClick={onPointClick}
                  />
                }
              />

              {/* Separator between price zone and activity zone */}
              {hasVolume && reservedFloor > 0 && (
                <ReferenceLine
                  y={reservedFloor}
                  stroke="#374151"
                  strokeDasharray="3 2"
                  strokeWidth={1}
                />
              )}

              {/* 50 % midpoint reference */}
              {!autoscale && (
                <ReferenceLine y={0.5} stroke="#4b5563" strokeDasharray="4 3" strokeWidth={1} />
              )}

              {/* Spike investigation marker */}
              {selectedPoint && (
                <ReferenceLine
                  x={selectedPoint.t}
                  stroke="#f59e0b"
                  strokeWidth={2}
                  strokeDasharray="5 3"
                />
              )}

              {/* Activity bars — normalised into reserved zone, rendered behind price line */}
              {hasVolume && (
                <Bar dataKey="vd" maxBarSize={8} isAnimationActive={false}>
                  {mergedData.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={(entry.rawV ?? 0) >= whaleThreshold ? '#f59e0b' : '#4b5563'}
                      opacity={(entry.rawV ?? 0) >= whaleThreshold ? 0.85 : 0.60}
                    />
                  ))}
                </Bar>
              )}

              {/* Price line — on top */}
              <Line
                type="monotone"
                dataKey="p"
                stroke={color}
                strokeWidth={2}
                dot={false}
                activeDot={onPointClick ? {
                  r: 6,
                  fill: color,
                  stroke: '#fff',
                  strokeWidth: 2,
                  cursor: 'pointer',
                  onClick: (_e: any, dot: any) => {
                    if (dot?.payload) onPointClick({ t: dot.payload.t, p: dot.payload.p });
                  },
                } : { r: 4, fill: color }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
