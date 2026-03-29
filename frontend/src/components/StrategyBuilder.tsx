import React, { useState, useMemo, lazy, Suspense } from 'react';
const BacktestPanel = lazy(() => import('./BacktestPanel'));
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ReTooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { HedgeRecommendation } from '../api/client';
import { PortfolioPosition } from './PortfolioInputPage';

// ── Palette ────────────────────────────────────────────────────────────────────
const PALETTE = [
  { line: '#60a5fa', label: 'blue' },
  { line: '#34d399', label: 'emerald' },
  { line: '#f59e0b', label: 'amber' },
  { line: '#f87171', label: 'red' },
  { line: '#a78bfa', label: 'violet' },
];
const UNHEDGED_LINE = '#52525b';
const MAX_STRATEGIES = 5;

// ── Math helpers ───────────────────────────────────────────────────────────────
function clamp(p: number) { return Math.max(0.001, Math.min(0.999, p)); }
function logit(p: number) { const c = clamp(p); return Math.log(c / (1 - c)); }
function sigmoid(x: number) { return 1 / (1 + Math.exp(-x)); }

/**
 * Predict p_B given a hypothetical p_A, anchored at pA0/pB0 with Pearson corr.
 * Uses logit-space linear extrapolation — keeps predictions in (0,1).
 */
function predictedPB(pA: number, pA0: number, pB0: number, corr: number) {
  return sigmoid(logit(pB0) + corr * (logit(pA) - logit(pA0)));
}

/** P&L from the primary position when A resolves. */
function posPnL(pos: PortfolioPosition, aYes: boolean): number {
  const ep = clamp(pos.entry_price_cents / 100);
  return pos.side === 'YES'
    ? aYes ? pos.stake_usd * (1 - ep) / ep : -pos.stake_usd
    : !aYes ? pos.stake_usd * ep / (1 - ep) : -pos.stake_usd;
}

/** P&L from a single hedge when B resolves. */
function hPnL(rec: HedgeRecommendation, bYes: boolean): number {
  const bp = clamp(rec.current_price);
  return rec.hedge_direction === 'YES'
    ? bYes ? rec.recommended_size * (1 - bp) / bp : -rec.recommended_size
    : !bYes ? rec.recommended_size * bp / (1 - bp) : -rec.recommended_size;
}

// ── Types ──────────────────────────────────────────────────────────────────────
interface Strategy {
  id: string;
  label: string;
  hedges: HedgeRecommendation[];
}

// ── Formatting ─────────────────────────────────────────────────────────────────
const fmt$ = (n: number) => `${n >= 0 ? '+' : '−'}$${Math.abs(n).toFixed(2)}`;
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

// ── Sub-components ─────────────────────────────────────────────────────────────
function PnLCell({ value, prob, label }: { value: number; prob: number; label?: string }) {
  const isPos = value >= 0;
  const intensity = Math.min(1, Math.abs(value) / 200);
  const bgColor = isPos
    ? `rgba(16,185,129,${0.08 + intensity * 0.28})`
    : `rgba(239,68,68,${0.08 + intensity * 0.28})`;
  const borderColor = isPos ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)';

  return (
    <div
      className="rounded-xl flex flex-col items-center justify-center gap-0.5 py-4"
      style={{ background: bgColor, border: `1px solid ${borderColor}` }}
    >
      {label && <p className="text-[10px] text-zinc-500 uppercase tracking-wide">{label}</p>}
      <span className={`text-lg font-bold tabular-nums ${isPos ? 'text-emerald-300' : 'text-red-300'}`}>
        {fmt$(value)}
      </span>
      <span className="text-[10px] text-zinc-600">p = {fmtPct(prob)}</span>
    </div>
  );
}

function KpiCard({
  label, value, sub, color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="bg-zinc-950 rounded-xl border border-zinc-800 px-4 py-3">
      <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-lg font-bold tabular-nums leading-none ${color ?? 'text-white'}`}>{value}</p>
      {sub && <p className="text-[10px] text-zinc-600 mt-1">{sub}</p>}
    </div>
  );
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2.5 text-xs shadow-2xl">
      <p className="text-zinc-400 mb-2 font-medium">P(YES) = {label}%</p>
      {payload.map((p: any) => (
        <p key={p.name} className="tabular-nums mb-0.5" style={{ color: p.color }}>
          {p.name}: {p.value >= 0 ? '+' : ''}${(p.value as number).toFixed(2)}
        </p>
      ))}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
interface Props {
  positions: PortfolioPosition[];
  recommendations: HedgeRecommendation[];
}

export default function StrategyBuilder({ positions, recommendations }: Props) {
  const pos = positions[0] ?? null;

  const [strategies, setStrategies] = useState<Strategy[]>([
    { id: 'S1', label: 'Strategy 1', hedges: [] },
  ]);
  const [activeId, setActiveId] = useState('S1');
  const [backtestHedgeId, setBacktestHedgeId] = useState<string | null>(null);

  const activeStrategy = strategies.find(s => s.id === activeId) ?? strategies[0];
  // Use entry price as a proxy for current market price of A
  const pA0 = pos ? clamp(pos.entry_price_cents / 100) : 0.5;

  // ── Strategy management ────────────────────────────────────────────────────
  const toggleHedge = (rec: HedgeRecommendation) => {
    setStrategies(prev =>
      prev.map(s => {
        if (s.id !== activeId) return s;
        const has = s.hedges.some(h => h.candidate_market_id === rec.candidate_market_id);
        return {
          ...s,
          hedges: has
            ? s.hedges.filter(h => h.candidate_market_id !== rec.candidate_market_id)
            : [...s.hedges, rec],
        };
      }),
    );
  };

  const addStrategy = () => {
    if (strategies.length >= MAX_STRATEGIES) return;
    const id = `S${Date.now()}`;
    setStrategies(prev => [
      ...prev,
      { id, label: `Strategy ${prev.length + 1}`, hedges: [] },
    ]);
    setActiveId(id);
  };

  const removeStrategy = (id: string) => {
    if (strategies.length === 1) return;
    const remaining = strategies.filter(s => s.id !== id);
    setStrategies(remaining);
    if (activeId === id) setActiveId(remaining[0].id);
  };

  // ── EV curve (corr-adjusted p_B) ───────────────────────────────────────────
  const evData = useMemo(() => {
    if (!pos) return [];
    return Array.from({ length: 51 }, (_, i) => {
      const pA = i / 50;
      const pt: Record<string, number> = { pct: Math.round(pA * 100) };

      const posY = posPnL(pos, true);
      const posN = posPnL(pos, false);
      pt['Unhedged'] = pA * posY + (1 - pA) * posN;

      strategies.forEach(s => {
        let ev = pA * posY + (1 - pA) * posN;
        for (const h of s.hedges) {
          const pB = predictedPB(pA, pA0, h.current_price, h.correlation);
          ev += pB * hPnL(h, true) + (1 - pB) * hPnL(h, false);
        }
        pt[s.label] = parseFloat(ev.toFixed(3));
      });

      return pt;
    });
  }, [pos, strategies, pA0]);

  // ── Scenario matrix ────────────────────────────────────────────────────────
  const scenarios = useMemo(() => {
    if (!pos) return null;
    const posY = posPnL(pos, true);
    const posN = posPnL(pos, false);
    const hs = activeStrategy.hedges;

    // "All hedges pay out" = each resolves in its hedge_direction
    const hBest = hs.reduce((sum, h) => sum + hPnL(h, h.hedge_direction === 'YES'), 0);
    // "All hedges lose" = each resolves against its hedge_direction
    const hWorst = hs.reduce((sum, h) => sum + hPnL(h, h.hedge_direction !== 'YES'), 0);
    // P(all hedges pay) — assumes independence
    const pHPay = hs.length === 0 ? 1 : hs.reduce((p, h) => {
      return p * (h.hedge_direction === 'YES' ? h.current_price : 1 - h.current_price);
    }, 1);

    return {
      AyHp: posY + hBest,
      AyHw: posY + hWorst,
      AnHp: posN + hBest,
      AnHw: posN + hWorst,
      pHPay: clamp(pHPay),
      pHWorst: 1 - clamp(pHPay),
    };
  }, [pos, activeStrategy]);

  // ── KPIs for active strategy ───────────────────────────────────────────────
  const kpis = useMemo(() => {
    if (!pos || !scenarios) return null;
    const { AyHp, AyHw, AnHp, AnHw } = scenarios;
    const best = Math.max(AyHp, AyHw, AnHp, AnHw);
    const worst = Math.min(AyHp, AyHw, AnHp, AnHw);

    // EV at current market prices
    let ev = pA0 * posPnL(pos, true) + (1 - pA0) * posPnL(pos, false);
    for (const h of activeStrategy.hedges) {
      ev += h.current_price * hPnL(h, true) + (1 - h.current_price) * hPnL(h, false);
    }

    // Break-even: find lowest p_A where EV(p_A) >= 0 (using corr model)
    const points = Array.from({ length: 1001 }, (_, i) => {
      const pA = i / 1000;
      let e = pA * posPnL(pos, true) + (1 - pA) * posPnL(pos, false);
      for (const h of activeStrategy.hedges) {
        const pB = predictedPB(pA, pA0, h.current_price, h.correlation);
        e += pB * hPnL(h, true) + (1 - pB) * hPnL(h, false);
      }
      return e;
    });

    let breakeven: number | null = null;
    for (let i = 0; i < points.length - 1; i++) {
      if (points[i] <= 0 && points[i + 1] > 0) { breakeven = i / 1000; break; }
    }
    if (breakeven === null && points[0] > 0) breakeven = 0;

    return { best, worst, ev, breakeven };
  }, [pos, activeStrategy, scenarios, pA0]);

  // ── Empty states ───────────────────────────────────────────────────────────
  if (!pos) {
    return (
      <div className="max-w-5xl mx-auto">
        <Header />
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 flex items-center justify-center h-48 mt-6">
          <p className="text-zinc-500 text-sm">Add a position in the Position Input tab first.</p>
        </div>
      </div>
    );
  }

  if (recommendations.length === 0) {
    return (
      <div className="max-w-5xl mx-auto">
        <Header />
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 flex items-center justify-center h-48 mt-6">
          <p className="text-zinc-500 text-sm">
            Run the Hedge Scanner to find candidates, then return here to build strategies.
          </p>
        </div>
      </div>
    );
  }

  const activeIdx = strategies.findIndex(s => s.id === activeId);
  const activePalette = PALETTE[activeIdx % PALETTE.length];

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <Header />

      {/* Position summary bar */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 px-5 py-3 flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white font-medium leading-snug truncate">{pos.market_question}</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            {pos.source} ·{' '}
            <span className={pos.side === 'YES' ? 'text-emerald-400' : 'text-red-400'}>
              {pos.side}
            </span>
            {' '}@ {pos.entry_price_cents.toFixed(1)}¢ · ${pos.stake_usd} staked
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Max gain</p>
          <p className="text-sm font-bold text-emerald-400">
            {fmt$(posPnL(pos, pos.side === 'YES'))}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Max loss</p>
          <p className="text-sm font-bold text-red-400">
            {fmt$(posPnL(pos, pos.side === 'NO'))}
          </p>
        </div>
      </div>

      {/* Strategy tab row */}
      <div className="flex items-center gap-2 flex-wrap">
        {strategies.map((s, i) => {
          const pal = PALETTE[i % PALETTE.length];
          const isActive = s.id === activeId;
          return (
            <button
              key={s.id}
              onClick={() => setActiveId(s.id)}
              className={`group relative flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium border transition-all ${
                isActive
                  ? 'text-white border-transparent shadow-lg'
                  : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500'
              }`}
              style={isActive ? { backgroundColor: pal.line + '20', borderColor: pal.line + '60', color: pal.line } : {}}
            >
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: pal.line }}
              />
              {s.label}
              {s.hedges.length > 0 && (
                <span className="opacity-60">({s.hedges.length})</span>
              )}
              {strategies.length > 1 && isActive && (
                <span
                  onClick={e => { e.stopPropagation(); removeStrategy(s.id); }}
                  className="ml-0.5 opacity-50 hover:opacity-100 transition-opacity cursor-pointer leading-none"
                >
                  ×
                </span>
              )}
            </button>
          );
        })}
        {strategies.length < MAX_STRATEGIES && (
          <button
            onClick={addStrategy}
            className="px-3.5 py-1.5 rounded-full text-xs font-medium bg-zinc-900 border border-dashed border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-500 transition-colors"
          >
            + New Strategy
          </button>
        )}
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-5 gap-5 items-start">
        {/* ── Left: candidate picker ── */}
        <div className="col-span-2 space-y-3">
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                  Add to{' '}
                  <span style={{ color: activePalette.line }}>{activeStrategy.label}</span>
                </h3>
                <p className="text-[10px] text-zinc-600 mt-0.5">
                  {recommendations.length} candidates · {activeStrategy.hedges.length} selected
                </p>
              </div>
            </div>

            <div className="max-h-[26rem] overflow-y-auto divide-y divide-zinc-800/60">
              {recommendations.map((rec, i) => {
                const added = activeStrategy.hedges.some(
                  h => h.candidate_market_id === rec.candidate_market_id,
                );
                return (
                  <div
                    key={rec.candidate_market_id}
                    className={`px-4 py-3 transition-colors ${added ? 'bg-zinc-800/50' : 'hover:bg-zinc-800/30'}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-zinc-600 font-mono w-5 flex-shrink-0">
                        #{i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-zinc-200 leading-snug line-clamp-2">
                          {rec.question}
                        </p>
                        <p className="text-[10px] text-zinc-500 mt-0.5">
                          <span
                            className={
                              rec.hedge_direction === 'YES'
                                ? 'text-emerald-400'
                                : 'text-red-400'
                            }
                          >
                            {rec.hedge_direction}
                          </span>
                          {' '}${rec.recommended_size.toFixed(0)} · r=
                          {rec.correlation >= 0 ? '+' : ''}{rec.correlation.toFixed(2)} ·{' '}
                          {rec.confidence_label}
                        </p>
                      </div>
                      <button
                        onClick={() => toggleHedge(rec)}
                        className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold transition-all hover:scale-110 ${
                          added
                            ? 'bg-zinc-700 text-zinc-400 hover:bg-red-950 hover:text-red-400'
                            : 'text-white'
                        }`}
                        style={!added ? { backgroundColor: activePalette.line } : {}}
                        title={added ? 'Remove from strategy' : 'Add to strategy'}
                      >
                        {added ? '×' : '+'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Active strategy hedges */}
          {activeStrategy.hedges.length > 0 && (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
              <h3 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                {activeStrategy.label} — {activeStrategy.hedges.length} hedge
                {activeStrategy.hedges.length > 1 ? 's' : ''}
              </h3>
              <div className="space-y-2">
                {activeStrategy.hedges.map(h => (
                  <div
                    key={h.candidate_market_id}
                    className="flex items-center gap-2 bg-zinc-950 rounded-lg px-3 py-2"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-zinc-200 leading-snug line-clamp-1">
                        {h.question}
                      </p>
                      <p className="text-[10px] text-zinc-500 mt-0.5">
                        <span
                          className={
                            h.hedge_direction === 'YES' ? 'text-emerald-400' : 'text-red-400'
                          }
                        >
                          {h.hedge_direction}
                        </span>
                        {' '}${h.recommended_size.toFixed(0)} @ {fmtPct(h.current_price)}
                      </p>
                    </div>
                    <button
                      onClick={() => toggleHedge(h)}
                      className="text-zinc-600 hover:text-red-400 transition-colors text-base leading-none"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>

              {/* Total cost */}
              <div className="mt-3 pt-3 border-t border-zinc-800 flex justify-between text-xs">
                <span className="text-zinc-500">Total hedge cost</span>
                <span className="text-white font-semibold tabular-nums">
                  ${activeStrategy.hedges.reduce((s, h) => s + h.recommended_size, 0).toFixed(2)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* ── Right: charts ── */}
        <div className="col-span-3 space-y-4">
          {/* KPI row */}
          {kpis && (
            <div className="grid grid-cols-4 gap-2.5">
              <KpiCard
                label="Best Case"
                value={fmt$(kpis.best)}
                color={kpis.best >= 0 ? 'text-emerald-400' : 'text-red-400'}
              />
              <KpiCard
                label="Worst Case"
                value={fmt$(kpis.worst)}
                color={kpis.worst >= 0 ? 'text-emerald-400' : 'text-red-400'}
              />
              <KpiCard
                label="EV @ market"
                value={fmt$(kpis.ev)}
                sub={`p(A) = ${fmtPct(pA0)}`}
                color={kpis.ev >= 0 ? 'text-emerald-400' : 'text-red-400'}
              />
              <KpiCard
                label="Break-even"
                value={kpis.breakeven !== null ? fmtPct(kpis.breakeven) : '—'}
                sub="P(A = YES)"
                color="text-white"
              />
            </div>
          )}

          {/* EV Curve */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                  Expected P&amp;L Curve
                </h3>
                <p className="text-[10px] text-zinc-600 mt-0.5">
                  Corr-adjusted — hedge market prices shift with your probability estimate
                </p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={210}>
              <LineChart data={evData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis
                  dataKey="pct"
                  tickFormatter={v => `${v}%`}
                  tick={{ fill: '#71717a', fontSize: 10 }}
                  axisLine={{ stroke: '#3f3f46' }}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={v => `$${(v as number).toFixed(0)}`}
                  tick={{ fill: '#71717a', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={52}
                />
                <ReTooltip content={<ChartTooltip />} />
                <ReferenceLine y={0} stroke="#3f3f46" strokeDasharray="4 2" />
                <Line
                  type="monotone"
                  dataKey="Unhedged"
                  stroke={UNHEDGED_LINE}
                  strokeWidth={1.5}
                  dot={false}
                  strokeDasharray="5 3"
                />
                {strategies.map((s, i) => (
                  <Line
                    key={s.id}
                    type="monotone"
                    dataKey={s.label}
                    stroke={PALETTE[i % PALETTE.length].line}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>

            {/* Legend */}
            <div className="flex items-center gap-4 mt-1 flex-wrap">
              <div className="flex items-center gap-1.5">
                <svg width="16" height="8">
                  <line x1="0" y1="4" x2="16" y2="4" stroke={UNHEDGED_LINE} strokeWidth="1.5" strokeDasharray="4 2" />
                </svg>
                <span className="text-[10px] text-zinc-500">Unhedged</span>
              </div>
              {strategies.map((s, i) => (
                <div key={s.id} className="flex items-center gap-1.5">
                  <div className="w-4 h-0.5 rounded-full" style={{ backgroundColor: PALETTE[i % PALETTE.length].line }} />
                  <span className="text-[10px] text-zinc-500">{s.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Scenario matrix */}
          {scenarios && (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
              <div className="mb-3">
                <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                  Outcome Matrix —{' '}
                  <span style={{ color: activePalette.line }}>{activeStrategy.label}</span>
                </h3>
                <p className="text-[10px] text-zinc-600 mt-0.5">
                  {activeStrategy.hedges.length === 0
                    ? 'Add hedges to see how outcomes change'
                    : `${activeStrategy.hedges.length} hedge${activeStrategy.hedges.length > 1 ? 's' : ''} · assumes independent resolutions`}
                </p>
              </div>

              {activeStrategy.hedges.length === 0 ? (
                /* Unhedged 2-scenario view */
                <div className="grid grid-cols-2 gap-3">
                  <PnLCell
                    value={posPnL(pos, true)}
                    prob={pA0}
                    label={`A = YES (p=${fmtPct(pA0)})`}
                  />
                  <PnLCell
                    value={posPnL(pos, false)}
                    prob={1 - pA0}
                    label={`A = NO (p=${fmtPct(1 - pA0)})`}
                  />
                </div>
              ) : (
                /* Full 2×2 matrix */
                <div>
                  {/* Column headers */}
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    <div />
                    <div className="text-center">
                      <p className="text-[10px] text-zinc-400 font-medium">Hedges Pay Out</p>
                      <p className="text-[10px] text-zinc-600">p = {fmtPct(scenarios.pHPay)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] text-zinc-400 font-medium">Hedges Lose</p>
                      <p className="text-[10px] text-zinc-600">p = {fmtPct(scenarios.pHWorst)}</p>
                    </div>
                  </div>

                  {/* Row: A = YES */}
                  <div className="grid grid-cols-3 gap-2 mb-2 items-center">
                    <div className="text-right pr-2">
                      <p className="text-[10px] text-zinc-400 font-medium">A = YES</p>
                      <p className="text-[10px] text-zinc-600">p = {fmtPct(pA0)}</p>
                    </div>
                    <PnLCell
                      value={scenarios.AyHp}
                      prob={pA0 * scenarios.pHPay}
                    />
                    <PnLCell
                      value={scenarios.AyHw}
                      prob={pA0 * scenarios.pHWorst}
                    />
                  </div>

                  {/* Row: A = NO */}
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <div className="text-right pr-2">
                      <p className="text-[10px] text-zinc-400 font-medium">A = NO</p>
                      <p className="text-[10px] text-zinc-600">p = {fmtPct(1 - pA0)}</p>
                    </div>
                    <PnLCell
                      value={scenarios.AnHp}
                      prob={(1 - pA0) * scenarios.pHPay}
                    />
                    <PnLCell
                      value={scenarios.AnHw}
                      prob={(1 - pA0) * scenarios.pHWorst}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Stress Test section ── */}
      {activeStrategy.hedges.length > 0 && pos && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                Monte Carlo Stress Test
              </h3>
              <p className="text-[10px] text-zinc-600 mt-0.5">
                Select a hedge from {activeStrategy.label} to run a full backtest
              </p>
            </div>
          </div>

          {/* Hedge selector chips */}
          <div className="flex flex-wrap gap-2 mb-5">
            {activeStrategy.hedges.map(h => {
              const active = backtestHedgeId === h.candidate_market_id;
              return (
                <button
                  key={h.candidate_market_id}
                  onClick={() => setBacktestHedgeId(active ? null : h.candidate_market_id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    active
                      ? 'bg-indigo-900/50 border-indigo-600 text-indigo-300'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <span className={`mr-1 ${h.hedge_direction === 'YES' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {h.hedge_direction}
                  </span>
                  {h.question.length > 45 ? h.question.slice(0, 45) + '…' : h.question}
                </button>
              );
            })}
          </div>

          {/* BacktestPanel */}
          {backtestHedgeId && (() => {
            const h = activeStrategy.hedges.find(h => h.candidate_market_id === backtestHedgeId);
            if (!h) return null;
            return (
              <Suspense fallback={
                <div className="flex items-center justify-center py-10 text-zinc-500 text-sm">
                  Loading stress test…
                </div>
              }>
                <BacktestPanel
                  marketAId={pos.market_id}
                  marketBId={h.candidate_market_id}
                  direction={pos.side}
                  entryPrice={pos.entry_price_cents / 100}
                  positionSize={pos.stake_usd}
                  hedgeDirection={h.hedge_direction}
                  hedgeSize={h.recommended_size}
                  questionB={h.question}
                />
              </Suspense>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function Header() {
  return (
    <div>
      <h2 className="text-2xl font-bold text-white">Strategy Builder</h2>
      <p className="text-zinc-400 text-sm mt-1">
        Assemble hedge strategies from scan results. Compare expected P&amp;L curves and outcome
        scenarios side-by-side across multiple strategy configurations.
      </p>
    </div>
  );
}
