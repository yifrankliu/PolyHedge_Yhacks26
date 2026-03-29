import React from 'react';
import { HedgeRecommendation } from '../api/client';
import { PortfolioPosition } from './PortfolioInputPage';
import BacktestPanel from './BacktestPanel';

interface Props {
  position: PortfolioPosition | null;
  hedge: HedgeRecommendation | null;
  demoMode?: boolean;
}

function clamp(p: number) { return Math.max(0.001, Math.min(0.999, p)); }
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

export default function StressTestDashboard({ position, hedge, demoMode }: Props) {
  if (!position || !hedge) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-white">Stress Test</h2>
          <p className="text-zinc-400 text-sm mt-1">
            Monte Carlo simulation, scenario replay, and walk-forward OOS validation for a position + hedge pair.
          </p>
        </div>
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 flex flex-col items-center justify-center h-64 gap-3">
          <p className="text-zinc-400 text-sm">No strategy selected.</p>
          <p className="text-zinc-600 text-xs">
            Go to Strategy Builder, add hedges, select one, and click <span className="text-indigo-400">Test Strategy →</span>
          </p>
        </div>
      </div>
    );
  }

  const ep = clamp(position.entry_price_cents / 100);

  return (
    <div className="max-w-6xl mx-auto">

      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">Stress Test</h2>
        <p className="text-zinc-400 text-sm mt-1">
          Monte Carlo simulation, scenario replay, and walk-forward OOS validation for a position + hedge pair.
        </p>
      </div>

      {demoMode && (
        <div className="mb-4 bg-amber-950/30 border border-amber-800/50 rounded-lg px-4 py-2.5 flex items-center gap-3">
          <span className="text-amber-400 text-xs font-medium">★ Demo Mode</span>
          <span className="text-amber-600 text-xs">Pre-generated stress test for BTC $100k + ETH hedge</span>
        </div>
      )}

      {/* Strategy summary card */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 mb-6">
        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-3">Testing Strategy</p>
        <div className="grid grid-cols-2 gap-4">
          {/* Position */}
          <div className="bg-zinc-950 rounded-lg border border-zinc-800 p-4">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Position</p>
            <p className="text-sm text-white font-medium leading-snug line-clamp-2 mb-2">
              {position.market_question}
            </p>
            <div className="flex gap-3 text-xs">
              <span className={`font-semibold ${position.side === 'YES' ? 'text-emerald-400' : 'text-red-400'}`}>
                {position.side}
              </span>
              <span className="text-zinc-400">{fmtPct(ep)} entry</span>
              <span className="text-zinc-400">${position.stake_usd.toFixed(0)} stake</span>
            </div>
          </div>

          {/* Hedge */}
          <div className="bg-zinc-950 rounded-lg border border-zinc-800 p-4">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Hedge</p>
            <p className="text-sm text-white font-medium leading-snug line-clamp-2 mb-2">
              {hedge.question}
            </p>
            <div className="flex gap-3 text-xs">
              <span className={`font-semibold ${hedge.hedge_direction === 'YES' ? 'text-emerald-400' : 'text-red-400'}`}>
                {hedge.hedge_direction}
              </span>
              <span className="text-zinc-400">{fmtPct(hedge.current_price)} price</span>
              <span className="text-zinc-400">${hedge.recommended_size.toFixed(0)} size</span>
            </div>
          </div>
        </div>
      </div>

      <BacktestPanel
        marketAId={position.market_id}
        marketBId={hedge.candidate_market_id}
        direction={position.side}
        entryPrice={ep}
        positionSize={position.stake_usd}
        hedgeDirection={hedge.hedge_direction}
        hedgeSize={hedge.recommended_size}
        questionB={hedge.question}
        demoMode={demoMode}
      />
    </div>
  );
}
