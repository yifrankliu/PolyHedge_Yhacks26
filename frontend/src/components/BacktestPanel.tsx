import React, { useState, useEffect, useMemo, Suspense, lazy } from 'react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as ReTooltip, ResponsiveContainer, ReferenceLine,
  ScatterChart, Scatter, ZAxis, LineChart, Bar,
} from 'recharts';
import { runBacktest, BacktestResponse, ScenarioItem } from '../api/client';
import { generateDemoBacktestData } from '../demo/demoData';

// ── Plotly lazy-loaded on demand (3.5 MB) ────────────────────────────────────
const Plot = lazy(() => import('react-plotly.js'));

// ── Types ──────────────────────────────────────────────────────────────────────
interface Props {
  marketAId: string;
  marketBId: string;
  direction: 'YES' | 'NO';
  entryPrice: number;      // fraction (0-1)
  positionSize: number;
  hedgeDirection: 'YES' | 'NO';
  hedgeSize: number;
  questionB: string;
  demoMode?: boolean;
}

// ── Formatting ─────────────────────────────────────────────────────────────────
const fmt$ = (n: number) =>
  `${n >= 0 ? '+' : '−'}$${Math.abs(n).toFixed(2)}`;
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

// ── Design tokens ──────────────────────────────────────────────────────────────
const INDIGO   = '#6366f1';
const IND_MED  = '#818cf8';
const EMERALD  = '#34d399';
const RED      = '#f87171';
const AMBER    = '#f59e0b';
const ZINC_600 = '#52525b';

// ── Shared KPI card ────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color }: {
  label: string; value: string; sub?: string; color?: string;
}) {
  return (
    <div className="bg-zinc-950 rounded-xl border border-zinc-800 px-4 py-3">
      <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-lg font-bold tabular-nums leading-none ${color ?? 'text-white'}`}>{value}</p>
      {sub && <p className="text-[10px] text-zinc-600 mt-1">{sub}</p>}
    </div>
  );
}

// ── Shared section header ──────────────────────────────────────────────────────
function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-3">
      <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">{title}</h4>
      {sub && <p className="text-[10px] text-zinc-600 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Fan chart custom tooltip ───────────────────────────────────────────────────
function FanTooltip({ active, payload, label, probLossAtT }: any) {
  if (!active || !payload?.length) return null;
  const byKey = Object.fromEntries(payload.map((p: any) => [p.dataKey, p.value as number]));
  const t = label as number;
  const probLoss = probLossAtT?.[t] ?? 0;
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-3 text-xs shadow-2xl min-w-[170px]">
      <p className="text-zinc-400 mb-2 font-medium">Day {t + 1}</p>
      <div className="space-y-1">
        {[['95th', 'p95', EMERALD], ['Median', 'p50', IND_MED], ['5th', 'p5', RED]].map(([lbl, key, col]) => (
          byKey[key] !== undefined && (
            <div key={key} className="flex justify-between gap-4">
              <span className="text-zinc-500">{lbl}</span>
              <span className="tabular-nums font-semibold" style={{ color: col as string }}>
                {fmt$(byKey[key])}
              </span>
            </div>
          )
        ))}
        <div className="flex justify-between gap-4 pt-1.5 border-t border-zinc-800 mt-1">
          <span className="text-zinc-500">P(loss)</span>
          <span className={`tabular-nums font-semibold ${probLoss > 0.5 ? 'text-red-400' : 'text-zinc-300'}`}>
            {fmtPct(probLoss)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Scatter tooltip ────────────────────────────────────────────────────────────
function ScatterTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d: ScenarioItem = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-3 text-xs shadow-2xl">
      <p className="text-zinc-400 mb-1.5 font-medium">Spike event — Day {d.day + 1}</p>
      <div className="space-y-0.5">
        <div className="flex justify-between gap-4">
          <span className="text-zinc-500">Position ΔP&L</span>
          <span className={`tabular-nums ${d.pos_pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt$(d.pos_pnl)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-zinc-500">Hedge ΔP&L</span>
          <span className={`tabular-nums ${d.hedge_pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt$(d.hedge_pnl)}</span>
        </div>
        <div className="flex justify-between gap-4 pt-1 border-t border-zinc-800">
          <span className="text-zinc-500">Net P&L</span>
          <span className={`tabular-nums font-bold ${d.net_pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt$(d.net_pnl)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-zinc-500">Effectiveness</span>
          <span className="tabular-nums text-white">{fmtPct(d.effectiveness)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Effectiveness dot (scatter) ────────────────────────────────────────────────
function EffDot(props: any) {
  const { cx, cy, payload } = props;
  const eff = payload?.effectiveness ?? 0;
  const color = eff > 0.5 ? EMERALD : eff > 0 ? AMBER : RED;
  return <circle cx={cx} cy={cy} r={5} fill={color} fillOpacity={0.85} stroke="none" />;
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function BacktestPanel({
  marketAId, marketBId, direction, entryPrice,
  positionSize, hedgeDirection, hedgeSize, questionB, demoMode,
}: Props) {
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [show3D, setShow3D] = useState(false);

  useEffect(() => {
    if (demoMode) {
      setResult(generateDemoBacktestData());
      setLoading(false);
      setError('');
      setShow3D(false);
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    setShow3D(false);
    runBacktest({
      market_a_id: marketAId,
      market_b_id: marketBId,
      direction,
      entry_price: entryPrice,
      position_size: positionSize,
      hedge_direction: hedgeDirection,
      hedge_size: hedgeSize,
      n_sim: 2000,
    })
      .then(setResult)
      .catch(e => {
        const detail = e?.response?.data?.detail ?? e?.message ?? 'Stress test failed';
        console.error('[BacktestPanel]', e?.response?.status, detail, e);
        setError(detail);
      })
      .finally(() => setLoading(false));
  }, [marketAId, marketBId, direction, entryPrice, positionSize, hedgeDirection, hedgeSize, demoMode]);

  // ── Fan chart data ─────────────────────────────────────────────────────────
  const fanData = useMemo(() => {
    if (!result) return [];
    const { fan } = result.simulation;
    return fan['50'].map((_, t) => ({
      t,
      p5:  fan['5'][t],
      p10: fan['10'][t],
      p25: fan['25'][t],
      p50: fan['50'][t],
      p75: fan['75'][t],
      p90: fan['90'][t],
      p95: fan['95'][t],
    }));
  }, [result]);

  // ── Terminal histogram + KDE merged into one dataset ─────────────────────
  // Recharts v3 doesn't allow per-series `data` props inside ComposedChart.
  // Interpolate KDE at each histogram bin center so both share the same x-axis.
  const termData = useMemo(() => {
    if (!result) return [];
    const h = result.simulation.terminal_histogram;
    const k = result.simulation.terminal_kde;
    return h.centers.map((x, i) => {
      // Binary-search for nearest KDE index
      let lo = 0, hi = k.x.length - 1, ki = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (k.x[mid] < x) { lo = mid + 1; ki = mid; } else { hi = mid - 1; }
      }
      const x0 = k.x[ki], x1 = k.x[ki + 1] ?? x0;
      const y0 = k.y[ki], y1 = k.y[ki + 1] ?? y0;
      const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
      const kde = Math.max(0, y0 + t * (y1 - y0));
      return { x: parseFloat(x.toFixed(2)), density: h.density[i], kde };
    });
  }, [result]);

  // ── Walk-forward data ──────────────────────────────────────────────────────
  const wfData = useMemo(() => {
    if (!result?.walk_forward?.hedged_cum?.length) return [];
    const wf = result.walk_forward;
    return wf.hedged_cum.map((h, i) => ({
      t: i,
      hedged: parseFloat(h.toFixed(3)),
      unhedged: parseFloat((wf.unhedged_cum[i] ?? 0).toFixed(3)),
    }));
  }, [result]);

  // ── Empty / loading states ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 flex flex-col items-center justify-center py-14 gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
        <p className="text-zinc-400 text-sm">Running 2,000 simulations…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-800 bg-red-950/30 px-5 py-4">
        <p className="text-red-400 text-sm">{error}</p>
      </div>
    );
  }

  if (!result) return null;

  const sim  = result.simulation;
  const scen = result.scenario_replay;
  const wf   = result.walk_forward;
  const meta = result.meta;
  const ds   = sim.density_surface;

  const cheColor  = scen.conditional_hedge_effectiveness > 0.5 ? 'text-emerald-400'
    : scen.conditional_hedge_effectiveness > 0 ? 'text-amber-400' : 'text-red-400';
  const wfVarColor = (wf.oos_variance_reduction ?? 0) > 0.2 ? 'text-emerald-400'
    : (wf.oos_variance_reduction ?? 0) > 0 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="space-y-5">
      {/* Stats bar */}
      <div className="flex items-center gap-3 flex-wrap">
        {[
          [`${meta.n_shared_days}d`, 'shared history'],
          [`${meta.n_returns}`, 'returns'],
          [`${sim.n_sim.toLocaleString()}`, 'simulations'],
        ].map(([val, lbl]) => (
          <div key={lbl} className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 flex items-baseline gap-1.5">
            <span className="text-sm font-bold text-white tabular-nums">{val}</span>
            <span className="text-[10px] text-zinc-500">{lbl}</span>
          </div>
        ))}
      </div>

      {demoMode && (
        <div className="bg-amber-950/30 border border-amber-800/50 rounded-lg px-4 py-2.5 flex items-center gap-3">
          <span className="text-amber-400 text-xs font-medium">★ Demo Mode</span>
          <span className="text-amber-600 text-xs">Synthetic Monte Carlo — Iran regime fall YES 18¢ $500 hedged with regime fall Jun 30 YES 8¢ $68</span>
        </div>
      )}

      {/* Warnings */}
      {meta.warnings.length > 0 && (
        <div className="flex flex-col gap-1">
          {meta.warnings.map((w, i) => (
            <p key={i} className="text-[10px] text-amber-400 bg-amber-950/30 border border-amber-800/50 rounded-lg px-3 py-1.5">
              ⚠ {w}
            </p>
          ))}
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-4 gap-2.5">
        <KpiCard
          label="VaR 5%"
          value={fmt$(sim.var_5pct)}
          sub="Worst 5% outcome"
          color={sim.var_5pct >= 0 ? 'text-emerald-400' : 'text-red-400'}
        />
        <KpiCard
          label="Exp. Shortfall"
          value={fmt$(sim.expected_shortfall_5pct)}
          sub="Avg of worst 5%"
          color={sim.expected_shortfall_5pct >= 0 ? 'text-emerald-400' : 'text-red-400'}
        />
        <KpiCard
          label="P(Profit)"
          value={fmtPct(sim.prob_profit)}
          sub={`${sim.n_sim.toLocaleString()} paths`}
          color={sim.prob_profit > 0.5 ? 'text-emerald-400' : 'text-amber-400'}
        />
        <KpiCard
          label="Hedge Effectiveness"
          value={fmtPct(scen.conditional_hedge_effectiveness)}
          sub="CVaR reduction"
          color={cheColor}
        />
      </div>

      {/* ── Monte Carlo Fan Chart ── */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <SectionHeader
              title="Monte Carlo P&L Distribution"
              sub={`${sim.n_sim.toLocaleString()} bootstrapped paths · 5 / 25 / 50 / 75 / 95th percentile bands`}
            />
          </div>
          <button
            onClick={() => setShow3D(v => !v)}
            className={`text-[10px] font-medium px-3 py-1.5 rounded-lg border transition-colors ${
              show3D
                ? 'bg-indigo-900/50 border-indigo-700 text-indigo-300'
                : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {show3D ? 'Hide' : 'Show'} 3D Surface ↗
          </button>
        </div>

        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={fanData} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
            <XAxis
              dataKey="t"
              tickFormatter={v => `D${(v as number) + 1}`}
              tick={{ fill: '#71717a', fontSize: 10 }}
              axisLine={{ stroke: '#3f3f46' }}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={v => `$${(v as number).toFixed(0)}`}
              tick={{ fill: '#71717a', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={55}
            />
            <ReTooltip content={<FanTooltip probLossAtT={sim.prob_loss_at_t} />} />
            <ReferenceLine y={0} stroke={ZINC_600} strokeDasharray="4 2" />

            {/* Fan bands: draw outer→inner, accumulating opacity */}
            <Area type="monotone" dataKey="p95" fill={INDIGO} fillOpacity={0.06} stroke="none" dot={false} isAnimationActive={false} />
            <Area type="monotone" dataKey="p90" fill={INDIGO} fillOpacity={0.06} stroke="none" dot={false} isAnimationActive={false} />
            <Area type="monotone" dataKey="p75" fill={INDIGO} fillOpacity={0.08} stroke="none" dot={false} isAnimationActive={false} />
            <Area type="monotone" dataKey="p50" fill={INDIGO} fillOpacity={0.10} stroke="none" dot={false} isAnimationActive={false} />
            <Area type="monotone" dataKey="p25" fill={INDIGO} fillOpacity={0.08} stroke="none" dot={false} isAnimationActive={false} />
            <Area type="monotone" dataKey="p10" fill={INDIGO} fillOpacity={0.06} stroke="none" dot={false} isAnimationActive={false} />
            <Area type="monotone" dataKey="p5"  fill={INDIGO} fillOpacity={0.06} stroke="none" dot={false} isAnimationActive={false} />

            {/* Median — bright line */}
            <Line type="monotone" dataKey="p50" stroke={IND_MED} strokeWidth={2.5} dot={false} isAnimationActive={false} />

            {/* VaR reference */}
            <ReferenceLine y={sim.var_5pct} stroke={RED} strokeDasharray="3 2"
              label={{ value: `VaR 5%: ${fmt$(sim.var_5pct)}`, position: 'insideTopLeft', fill: RED, fontSize: 9 }} />
            <ReferenceLine y={sim.expected_shortfall_5pct} stroke={AMBER} strokeDasharray="3 2"
              label={{ value: `ES: ${fmt$(sim.expected_shortfall_5pct)}`, position: 'insideBottomLeft', fill: AMBER, fontSize: 9 }} />
          </ComposedChart>
        </ResponsiveContainer>

        {/* Legend */}
        <div className="flex items-center gap-5 mt-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-0.5 rounded" style={{ backgroundColor: IND_MED }} />
            <span className="text-[10px] text-zinc-500">Median path</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-3 rounded" style={{ backgroundColor: INDIGO, opacity: 0.35 }} />
            <span className="text-[10px] text-zinc-500">5–95th percentile</span>
          </div>
          <div className="flex items-center gap-1.5">
            <svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke={RED} strokeWidth="1.5" strokeDasharray="3 2" /></svg>
            <span className="text-[10px] text-zinc-500">VaR 5%</span>
          </div>
          <div className="flex items-center gap-1.5">
            <svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke={AMBER} strokeWidth="1.5" strokeDasharray="3 2" /></svg>
            <span className="text-[10px] text-zinc-500">Expected Shortfall</span>
          </div>
        </div>
      </div>

      {/* 3D Density Surface */}
      {show3D && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
          <SectionHeader
            title="3D P&L Density Surface"
            sub="Path density over time — ridges show where simulated outcomes cluster"
          />
          <Suspense fallback={
            <div className="flex items-center justify-center h-64 text-zinc-500 text-sm">Loading 3D engine…</div>
          }>
            <Plot
              data={[{
                type: 'surface' as any,
                x: ds.time_steps.map(t => `D${t + 1}`),
                y: ds.pnl_grid,
                z: ds.z,
                colorscale: [
                  [0,   '#09090b'],
                  [0.2, '#1e1b4b'],
                  [0.5, '#3730a3'],
                  [0.8, '#6366f1'],
                  [1,   '#a5b4fc'],
                ],
                showscale: false,
                opacity: 0.9,
                contours: {
                  z: { show: true, usecolormap: true, project: { z: true } },
                },
              } as any]}
              layout={{
                paper_bgcolor: '#18181b',
                plot_bgcolor: '#18181b',
                scene: {
                  bgcolor: '#18181b',
                  xaxis: { title: 'Day', color: '#71717a', gridcolor: '#3f3f46', showbackground: false },
                  yaxis: { title: 'P&L ($)', color: '#71717a', gridcolor: '#3f3f46', showbackground: false },
                  zaxis: { title: 'Density', color: '#71717a', gridcolor: '#3f3f46', showbackground: false },
                  camera: { eye: { x: 1.6, y: -1.6, z: 0.9 } },
                } as any,
                margin: { l: 0, r: 0, b: 0, t: 0 },
                height: 380,
                font: { family: 'ui-monospace, monospace', size: 10, color: '#71717a' },
              } as any}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: '100%' }}
            />
          </Suspense>
        </div>
      )}

      {/* ── Terminal Distribution ── */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
        <SectionHeader
          title="Terminal P&L Distribution"
          sub="Histogram of final P&L across all simulated paths with KDE overlay"
        />
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={termData} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
            <XAxis
              dataKey="x"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={v => `$${(v as number).toFixed(0)}`}
              tick={{ fill: '#71717a', fontSize: 10 }}
              axisLine={{ stroke: '#3f3f46' }}
              tickLine={false}
            />
            <YAxis tick={false} axisLine={false} tickLine={false} width={0} />
            <ReTooltip
              formatter={(v: any, name: any) => [(v as number).toFixed(4), name ?? '']}
              contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 11 }}
            />
            <ReferenceLine x={0} stroke={ZINC_600} strokeDasharray="4 2" />
            <ReferenceLine x={sim.var_5pct} stroke={RED} strokeDasharray="3 2"
              label={{ value: 'VaR', position: 'top', fill: RED, fontSize: 9 }} />
            <ReferenceLine x={sim.expected_shortfall_5pct} stroke={AMBER} strokeDasharray="3 2"
              label={{ value: 'ES', position: 'top', fill: AMBER, fontSize: 9 }} />
            <Bar dataKey="density" fill={INDIGO} fillOpacity={0.45} radius={[2, 2, 0, 0]} isAnimationActive={false} />
            <Line dataKey="kde" stroke={IND_MED} strokeWidth={2} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* ── Bottom row: Scenario Replay + Walk-Forward ── */}
      <div className="grid grid-cols-2 gap-5">
        {/* Scenario Replay */}
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
          <SectionHeader
            title="Spike Event Stress Test"
            sub="How the hedge performed on each historical shock"
          />
          <div className="grid grid-cols-2 gap-2 mb-4">
            <div className="bg-zinc-950 rounded-lg px-3 py-2">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">CHE</p>
              <p className={`text-base font-bold tabular-nums ${cheColor}`}>
                {fmtPct(scen.conditional_hedge_effectiveness)}
              </p>
              <p className="text-[10px] text-zinc-600">tail-risk reduction</p>
            </div>
            <div className="bg-zinc-950 rounded-lg px-3 py-2">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Hedged events</p>
              <p className="text-base font-bold tabular-nums text-white">
                {fmtPct(scen.pct_events_hedged)}
              </p>
              <p className="text-[10px] text-zinc-600">of all days</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <ScatterChart margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis
                dataKey="pos_pnl"
                name="Position P&L"
                tickFormatter={v => `$${(v as number).toFixed(0)}`}
                tick={{ fill: '#71717a', fontSize: 9 }}
                axisLine={{ stroke: '#3f3f46' }}
                tickLine={false}
                label={{ value: 'Position P&L', position: 'insideBottom', offset: -2, fill: '#52525b', fontSize: 9 }}
              />
              <YAxis
                dataKey="net_pnl"
                name="Net P&L"
                tickFormatter={v => `$${(v as number).toFixed(0)}`}
                tick={{ fill: '#71717a', fontSize: 9 }}
                axisLine={false}
                tickLine={false}
                width={45}
                label={{ value: 'Net P&L', angle: -90, position: 'insideLeft', fill: '#52525b', fontSize: 9 }}
              />
              <ZAxis range={[40, 40]} />
              <ReTooltip content={<ScatterTooltip />} />
              <ReferenceLine y={0} stroke={ZINC_600} strokeDasharray="4 2" />
              {/* Unhedged reference (y=x line approximated via data) */}
              <Scatter
                data={scen.spike_scenarios}
                shape={<EffDot />}
                isAnimationActive={false}
              />
            </ScatterChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-4 mt-2">
            {[['Effective (>50%)', EMERALD], ['Partial', AMBER], ['Ineffective', RED]].map(([l, c]) => (
              <div key={l} className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: c }} />
                <span className="text-[10px] text-zinc-600">{l}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Walk-Forward OOS */}
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
          <SectionHeader
            title="Walk-Forward Validation"
            sub="Expanding-window OOS: hedged vs unhedged cumulative P&L"
          />
          {wf.error ? (
            <p className="text-zinc-500 text-xs">{wf.error}</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 mb-4">
                <div className="bg-zinc-950 rounded-lg px-3 py-2">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Variance reduction</p>
                  <p className={`text-base font-bold tabular-nums ${wfVarColor}`}>
                    {fmtPct(wf.oos_variance_reduction ?? 0)}
                  </p>
                  <p className="text-[10px] text-zinc-600">{wf.n_oos_points} OOS points</p>
                </div>
                <div className="bg-zinc-950 rounded-lg px-3 py-2">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider">CVaR diff</p>
                  <p className={`text-base font-bold tabular-nums ${
                    scen.cvar_net > scen.cvar_unhedged ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {fmt$(scen.cvar_net - scen.cvar_unhedged)}
                  </p>
                  <p className="text-[10px] text-zinc-600">net vs unhedged</p>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={wfData} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis
                    dataKey="t"
                    tick={{ fill: '#71717a', fontSize: 9 }}
                    axisLine={{ stroke: '#3f3f46' }}
                    tickLine={false}
                    tickFormatter={v => `${v}`}
                  />
                  <YAxis
                    tick={{ fill: '#71717a', fontSize: 9 }}
                    axisLine={false}
                    tickLine={false}
                    width={38}
                    tickFormatter={v => `${(v as number).toFixed(1)}`}
                  />
                  <ReTooltip
                    contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 11 }}
                    formatter={(v: any, name: any) => [(v as number).toFixed(3), name ?? '']}
                  />
                  <ReferenceLine y={0} stroke={ZINC_600} strokeDasharray="4 2" />
                  <Line type="monotone" dataKey="hedged" stroke={IND_MED} strokeWidth={2} dot={false} name="Hedged" isAnimationActive={false} />
                  <Line type="monotone" dataKey="unhedged" stroke={ZINC_600} strokeWidth={1.5} dot={false} strokeDasharray="4 2" name="Unhedged" isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
              <div className="flex items-center gap-4 mt-2">
                <div className="flex items-center gap-1.5"><div className="w-4 h-0.5" style={{ backgroundColor: IND_MED }} /><span className="text-[10px] text-zinc-500">Hedged</span></div>
                <div className="flex items-center gap-1.5">
                  <svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke={ZINC_600} strokeWidth="1.5" strokeDasharray="4 2" /></svg>
                  <span className="text-[10px] text-zinc-500">Unhedged</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
