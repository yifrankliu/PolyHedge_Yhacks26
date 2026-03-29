import { useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { MarketHistory } from '../api/client';

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

export default function PriceChart({
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

  const yDomain: [number | string, number | string] = autoscale ? ['auto', 'auto'] : [0, 1];

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
              {!autoscale && (
                <ReferenceLine y={0.5} stroke="#4b5563" strokeDasharray="4 3" strokeWidth={1} />
              )}
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
