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
const ChartTooltip = ({ active, payload, label, hasVolume, onPointClick }: any) => {
  if (!active || !payload?.length) return null;
  const date      = new Date(label * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const priceEntry = payload.find((p: any) => p.dataKey === 'p');
  const volEntry   = payload.find((p: any) => p.dataKey === 'rawV');
  const price = priceEntry?.value;
  const vol   = volEntry?.value;
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-sm space-y-1 shadow-xl">
      <p className="text-zinc-400 text-xs">{date}</p>
      {price != null && (
        <p className="text-white font-bold tabular-nums">{(price * 100).toFixed(1)}¢</p>
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
  const [autoscale, setAutoscale]   = useState(false);
  const [showVolume, setShowVolume] = useState(true);

  const data         = useMemo(() => history?.history ?? [], [history]);
  const currentPrice = history?.current_price;
  const hasVolume    = showVolume && (volumeData?.length ?? 0) > 0;

  // ── Whale threshold ────────────────────────────────────────────────────────
  const { actMax, whaleThreshold } = useMemo(() => {
    if (!volumeData?.length) return { actMax: 1, whaleThreshold: Infinity };
    const vals = [...volumeData.map(v => v.v)].sort((a, b) => a - b);
    const median = vals[Math.floor(vals.length / 2)];
    return { actMax: Math.max(...vals, 1), whaleThreshold: median * 2.5 };
  }, [volumeData]);

  // ── Merged dataset + Y domain ──────────────────────────────────────────────
  // Reserve bottom 30 % of chart height for activity bars.
  const { mergedData, yDomain, reservedFloor } = useMemo(() => {
    if (!data.length) return { mergedData: [], yDomain: [0, 1] as [number, number], reservedFloor: 0 };

    const prices    = data.map(pt => pt.p);
    const priceMin  = Math.min(...prices);
    const priceMax  = Math.max(...prices);
    const pRange    = Math.max(priceMax - priceMin, 0.01);
    const reserved  = pRange * 0.30;
    const floor     = priceMin - reserved;
    const domainLow = Math.max(0, floor - reserved * 0.15);
    const domainHigh = priceMax + pRange * 0.05;

    const normalize = (rawV?: number): number | undefined => {
      if (rawV == null || !hasVolume) return undefined;
      return floor + (rawV / actMax) * reserved;
    };

    const volByDay = volumeData?.length
      ? new Map(volumeData.map(v => [v.t, v.v]))
      : new Map<number, number>();

    const merged = data.map(pt => {
      const day  = Math.floor(pt.t / 86400) * 86400;
      const rawV = volByDay.get(day);
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
    <div className="bg-zinc-900 rounded-xl p-5 border border-zinc-800">
      {/* Header */}
      <div className="flex items-start justify-between mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
          <p className="text-sm font-medium text-white leading-snug truncate">{question}</p>
        </div>

        <div className="flex items-center gap-2 ml-4 flex-shrink-0">
          {currentPrice != null && (
            <span className="text-sm font-bold text-white tabular-nums">
              {(currentPrice * 100).toFixed(1)}¢
            </span>
          )}
          {onPointClick && (
            <span className="text-[10px] text-zinc-500 italic">Click to investigate</span>
          )}

          {/* Activity toggle */}
          {(volumeData?.length ?? 0) > 0 && (
            <button
              onClick={() => setShowVolume(v => !v)}
              className={`text-xs px-2.5 py-1 rounded-lg border font-medium transition-colors ${
                showVolume
                  ? 'bg-amber-900/40 border-amber-700/60 text-amber-300'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Activity
            </button>
          )}

          {/* Autoscale toggle */}
          <button
            onClick={() => setAutoscale(a => !a)}
            className={`text-xs px-2.5 py-1 rounded-lg border font-medium transition-colors ${
              autoscale
                ? 'bg-indigo-600/30 border-indigo-500/60 text-indigo-300'
                : 'bg-zinc-800 border-zinc-700 text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Autoscale
          </button>
        </div>
      </div>

      {/* Legend */}
      {hasVolume && (
        <div className="flex items-center gap-4 mt-1.5 mb-0.5">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2.5 rounded-sm inline-block bg-zinc-600 opacity-70" />
            <span className="text-[10px] text-zinc-500">Normal activity</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2.5 rounded-sm inline-block bg-amber-500 opacity-80" />
            <span className="text-[10px] text-amber-500">High activity (&gt;2.5× median)</span>
          </div>
        </div>
      )}

      <div className="h-56 mt-3">
        {loading ? (
          <div className="flex items-center justify-center h-full text-zinc-500 text-sm animate-pulse">
            Loading price history…
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-red-400 text-sm">{error}</div>
        ) : data.length === 0 ? (
          <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
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
              <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
              <XAxis
                dataKey="t"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(v) =>
                  new Date(v * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                }
                stroke="#52525b"
                tick={{ fill: '#71717a', fontSize: 10 }}
                tickCount={6}
              />
              <YAxis
                domain={yDomain}
                tickFormatter={(v) => `${(v * 100).toFixed(0)}¢`}
                stroke="#52525b"
                tick={{ fill: '#71717a', fontSize: 10 }}
                width={36}
              />
              <Tooltip
                content={<ChartTooltip hasVolume={hasVolume} onPointClick={onPointClick} />}
              />

              {/* Separator between price and activity zone */}
              {hasVolume && reservedFloor > 0 && (
                <ReferenceLine y={reservedFloor} stroke="#3f3f46" strokeDasharray="3 2" strokeWidth={1} />
              )}

              {/* 50 ¢ midpoint reference */}
              {!autoscale && (
                <ReferenceLine y={0.5} stroke="#52525b" strokeDasharray="4 3" strokeWidth={1} />
              )}

              {/* Spike investigation marker */}
              {selectedPoint && (
                <ReferenceLine x={selectedPoint.t} stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 3" />
              )}

              {/* Activity bars */}
              {hasVolume && (
                <Bar dataKey="vd" maxBarSize={8} isAnimationActive={false}>
                  {mergedData.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={(entry.rawV ?? 0) >= whaleThreshold ? '#f59e0b' : '#52525b'}
                      opacity={(entry.rawV ?? 0) >= whaleThreshold ? 0.85 : 0.55}
                    />
                  ))}
                </Bar>
              )}

              {/* Price line */}
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
