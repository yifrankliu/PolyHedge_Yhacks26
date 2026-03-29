import { HedgeRecommendation, FailedHedgeCandidate, BacktestResponse, CorrelationResult, Market } from '../api/client';
import { PortfolioPosition } from '../components/PortfolioInputPage';

// ── Core demo scenario: Iranian regime falls before 2027 ──────────────────────

export const DEMO_POSITION: PortfolioPosition = {
  id: 'demo-position-iran-regime',
  market_id: 'demo-iran-regime-fall',
  market_question: 'Will the Iranian regime fall before 2027?',
  source: 'polymarket',
  side: 'YES',
  status: 'current',
  entry_price_cents: 18,
  stake_usd: 500,
  notes: 'Demo position — Iranian regime change by 2027',
};

export const DEMO_MARKET_A: Market = {
  id: 'demo-iran-regime-fall',
  question: 'Will the Iranian regime fall before 2027?',
  price: 0.18,
  volume: 6200000,
  end_date: '2026-12-31T00:00:00Z',
  source: 'polymarket',
};

export const DEMO_MARKET_B: Market = {
  id: 'demo-iran-civil-unrest',
  question: 'Will Iran experience major civil unrest or uprising in 2025?',
  price: 0.44,
  volume: 3800000,
  end_date: '2025-12-31T00:00:00Z',
  source: 'polymarket',
};

export const DEMO_RECOMMENDATIONS: HedgeRecommendation[] = [
  {
    candidate_market_id: 'demo-iran-civil-unrest',
    question: 'Will Iran experience major civil unrest or uprising in 2025?',
    current_price: 0.44,
    platform: 'polymarket',
    hedge_direction: 'YES',
    hedge_ratio: 0.31,
    recommended_size: 96,
    correlation: 0.861,
    full_pearson: 0.844,
    rolling_std: 0.039,
    lead_direction: 'B_leads_A',
    shared_history_days: 328,
    n_observations: 328,
    composite_score: 0.83,
    bl_divergence: 0.11,
    bl_confidence: 0.76,
    hedge_confidence: 0.88,
    confidence_label: 'High confidence',
    caveats: [],
    stability_discounted: false,
  },
  {
    candidate_market_id: 'demo-iran-coup',
    question: 'Will a military coup or leadership transition occur in Iran by 2027?',
    current_price: 0.26,
    platform: 'polymarket',
    hedge_direction: 'YES',
    hedge_ratio: 0.22,
    recommended_size: 71,
    correlation: 0.794,
    full_pearson: 0.778,
    rolling_std: 0.058,
    lead_direction: 'A_leads_B',
    shared_history_days: 261,
    n_observations: 261,
    composite_score: 0.72,
    bl_divergence: 0.08,
    bl_confidence: 0.63,
    hedge_confidence: 0.74,
    confidence_label: 'High confidence',
    caveats: [],
    stability_discounted: false,
  },
  {
    candidate_market_id: 'demo-khamenei-death',
    question: 'Will Supreme Leader Ali Khamenei die or leave office before 2027?',
    current_price: 0.31,
    platform: 'polymarket',
    hedge_direction: 'YES',
    hedge_ratio: 0.18,
    recommended_size: 55,
    correlation: 0.712,
    full_pearson: 0.695,
    rolling_std: 0.071,
    lead_direction: 'A_leads_B',
    shared_history_days: 219,
    n_observations: 219,
    composite_score: 0.64,
    bl_divergence: null,
    bl_confidence: null,
    hedge_confidence: 0.68,
    confidence_label: 'Moderate confidence',
    caveats: ['Leadership transition ≠ regime fall — may understate correlation'],
    stability_discounted: false,
  },
  {
    candidate_market_id: 'demo-iran-nuclear-deal',
    question: 'Will Iran agree to a nuclear deal with the West by 2027?',
    current_price: 0.22,
    platform: 'polymarket',
    hedge_direction: 'YES',
    hedge_ratio: 0.11,
    recommended_size: 39,
    correlation: -0.542,
    full_pearson: -0.528,
    rolling_std: 0.089,
    lead_direction: 'sync',
    shared_history_days: 174,
    n_observations: 174,
    composite_score: 0.49,
    bl_divergence: -0.05,
    bl_confidence: 0.48,
    hedge_confidence: 0.55,
    confidence_label: 'Moderate confidence',
    caveats: ['Inverse correlation — regime reform may enable deal without falling', 'Short shared history (174 days)'],
    stability_discounted: false,
  },
  {
    candidate_market_id: 'demo-israel-iran-war',
    question: 'Will Israel and Iran engage in direct full-scale war by 2027?',
    current_price: 0.19,
    platform: 'polymarket',
    hedge_direction: 'YES',
    hedge_ratio: 0.09,
    recommended_size: 28,
    correlation: 0.463,
    full_pearson: 0.448,
    rolling_std: 0.112,
    lead_direction: 'B_leads_A',
    shared_history_days: 138,
    n_observations: 138,
    composite_score: 0.41,
    bl_divergence: null,
    bl_confidence: null,
    hedge_confidence: 0.48,
    confidence_label: 'Low confidence',
    caveats: ['War could destabilize regime but also rally it', 'Short shared history (138 days)'],
    stability_discounted: true,
  },
];

export const DEMO_FAILED_CANDIDATES: FailedHedgeCandidate[] = [
  {
    candidate_market_id: 'demo-fail-1',
    question: 'Will Iran hold free elections before 2027?',
    platform: 'polymarket',
    current_price: 0.12,
    fail_reason: 'Insufficient shared history (22 days < 32 min)',
    shared_history_days: 22,
    n_events: 2,
  },
  {
    candidate_market_id: 'demo-fail-2',
    question: 'Will the Iranian rial collapse 50%+ by end of 2025?',
    platform: 'polymarket',
    current_price: 0.37,
    fail_reason: 'Fewer than 8 spike events (5 found)',
    shared_history_days: 131,
    n_events: 5,
  },
  {
    candidate_market_id: 'demo-fail-3',
    question: 'Will Iran join the BRICS economic bloc by 2026?',
    platform: 'polymarket',
    current_price: 0.53,
    fail_reason: 'Absolute correlation too low (|r| = 0.09 < threshold)',
    shared_history_days: 187,
    n_events: 10,
  },
];

// ── Demo correlation (MarketCompare: regime fall vs civil unrest) ─────────────

export const DEMO_CORRELATION: CorrelationResult = {
  market_a: 'demo-iran-regime-fall',
  market_b: 'demo-iran-civil-unrest',
  shared_history_days: 328,
  n_observations: 328,
  full_pearson: 0.844,
  full_pearson_returns: 0.809,
  rolling_mean: 0.83,
  rolling_std: 0.039,
  rolling_pct_positive: 0.89,
  rolling_series: Array.from({ length: 60 }, (_, i) => ({
    t: Math.floor(Date.now() / 1000) - (60 - i) * 86400 * 5,
    r: parseFloat((0.83 + 0.05 * Math.sin(i / 7) + (i > 50 ? 0.03 : 0)).toFixed(4)),
  })),
  break_detected: false,
  cusum_pval: 0.22,
  pre_break_pearson: null,
  post_break_pearson: null,
  best_lag_days: 2,
  lag_correlation: 0.871,
  lead_direction: 'B_leads_A',
  lag_series: Array.from({ length: 11 }, (_, i) => ({
    lag: i - 5,
    r: parseFloat((0.844 * Math.exp(-0.07 * (i - 7) ** 2)).toFixed(4)),
  })),
  a_causes_b_pval: 0.204,
  b_causes_a_pval: 0.018,
  granger_dominant_direction: 'B_causes_A',
  low_volume_warning: false,
  short_history_warning: false,
  resolution_convergence: false,
  semantic_similarity: 0.79,
  end_date_proximity: 0.54,
  composite_score: 0.83,
};

// ── Demo backtest data ────────────────────────────────────────────────────────
// Position: Iran regime fall YES @18¢ $500 | Hedge: civil unrest YES @44¢ $96
// Regime YES profit = 500 × (1/0.18 − 1) = $2,277.78
// Regime NO  loss   = −$500
// Unrest YES profit = 96 × (1/0.44 − 1) = $122.18
// Unrest NO  loss   = −$96

function seededRand(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

export function generateDemoBacktestData(): BacktestResponse {
  const rand = seededRand(77);
  const HORIZON = 90;
  const N_SIM = 2000;

  // P(regime fall)=0.18, P(unrest|regime fall)=0.72, P(unrest|no fall)=0.36
  const OUTCOMES = [2399.96, 2277.78, -377.82, -596.0];
  // regime+unrest  regime+~unrest  ~regime+unrest  both NO
  const WEIGHTS  = [0.1296, 0.0504, 0.2952, 0.5248];
  const cumW = WEIGHTS.reduce((acc, w, i) => { acc.push((acc[i - 1] ?? 0) + w); return acc; }, [] as number[]);

  const W_WIN  = WEIGHTS[0] + WEIGHTS[1]; // 0.18
  const W_LOSS = WEIGHTS[2] + WEIGHTS[3]; // 0.82

  const MIX_MU  = W_LOSS * -500 + W_WIN * 2310;
  const MIX_VAR = W_LOSS * (60**2 + (-500 - MIX_MU)**2) + W_WIN * (180**2 + (2310 - MIX_MU)**2);
  const MIX_STD = Math.sqrt(MIX_VAR);

  const QUANTILES: Record<string, number> = {
    '5': -1.645, '10': -1.282, '25': -0.674,
    '50': 0, '75': 0.674, '90': 1.282, '95': 1.645
  };

  const fan: Record<string, number[]> = {};
  const fan_unhedged: Record<string, number[]> = {};
  for (const q of ['5','10','25','50','75','90','95']) { fan[q] = []; fan_unhedged[q] = []; }

  for (let t = 0; t < HORIZON; t++) {
    const frac = (t + 1) / HORIZON;
    const sigma_t = MIX_STD * Math.sqrt(frac);
    const mu_t    = MIX_MU  * frac;
    const sigma_uh = MIX_STD * 1.18 * Math.sqrt(frac);
    const mu_uh    = MIX_MU  * frac * 1.04;
    for (const q of ['5','10','25','50','75','90','95']) {
      fan[q].push(parseFloat((mu_t + QUANTILES[q] * sigma_t).toFixed(2)));
      fan_unhedged[q].push(parseFloat((mu_uh + QUANTILES[q] * sigma_uh).toFixed(2)));
    }
  }

  const sample_paths: number[][] = [];
  for (let s = 0; s < 10; s++) {
    const path: number[] = []; let val = 0;
    for (let t = 0; t < HORIZON; t++) {
      val += (rand() - 0.5) * 240 + MIX_MU / HORIZON;
      path.push(parseFloat(val.toFixed(2)));
    }
    sample_paths.push(path);
  }

  const terminal_pnl: number[] = [];
  for (let i = 0; i < N_SIM; i++) {
    const u = rand();
    let idx = cumW.findIndex(c => u <= c); if (idx < 0) idx = 3;
    terminal_pnl.push(parseFloat((OUTCOMES[idx] + (rand() - 0.5) * 90).toFixed(2)));
  }

  const BIN_COUNT = 35, BIN_MIN = -750, BIN_MAX = 2800;
  const BIN_W = (BIN_MAX - BIN_MIN) / BIN_COUNT;
  const bins = new Array(BIN_COUNT).fill(0);
  terminal_pnl.forEach(v => {
    bins[Math.min(BIN_COUNT - 1, Math.max(0, Math.floor((v - BIN_MIN) / BIN_W)))]++;
  });
  const centers = bins.map((_, i) => parseFloat((BIN_MIN + (i + 0.5) * BIN_W).toFixed(1)));
  const density  = bins.map(c  => parseFloat((c / (N_SIM * BIN_W)).toFixed(6)));

  const KDE_N = 80, BW = 70;
  const kde_x = Array.from({ length: KDE_N }, (_, i) =>
    parseFloat((BIN_MIN + (i / (KDE_N - 1)) * (BIN_MAX - BIN_MIN)).toFixed(1))
  );
  const kde_y = kde_x.map(x => {
    const sum = terminal_pnl.reduce((s, v) => s + Math.exp(-0.5 * ((x - v) / BW) ** 2), 0);
    return parseFloat((sum / (N_SIM * BW * Math.sqrt(2 * Math.PI))).toFixed(6));
  });

  const prob_loss_at_t = Array.from({ length: HORIZON }, (_, t) => {
    const frac = (t + 1) / HORIZON;
    return parseFloat((0.5 - (0.5 - W_LOSS) * frac).toFixed(4));
  });

  const var_5pct = parseFloat((MIX_MU + QUANTILES['5'] * MIX_STD).toFixed(2));
  const es_5pct  = parseFloat((var_5pct - 65).toFixed(2));

  const DS_T = [0, 12, 24, 36, 49, 62, 75, 89];
  const DS_PGRID = Array.from({ length: 30 }, (_, i) =>
    parseFloat((BIN_MIN + (i / 29) * (BIN_MAX - BIN_MIN)).toFixed(1))
  );
  const ds_z: number[][] = DS_T.map(t => {
    const frac = Math.max(0.01, (t + 1) / HORIZON);
    const s1 = 55  + 35 * (1 - frac), mu1 = -490 * frac;
    const s2 = 170 + 80 * (1 - frac), mu2 = 2300 * frac;
    return DS_PGRID.map(x => {
      const g1 = Math.exp(-0.5 * ((x - mu1) / s1) ** 2) / (s1 * Math.sqrt(2 * Math.PI));
      const g2 = Math.exp(-0.5 * ((x - mu2) / s2) ** 2) / (s2 * Math.sqrt(2 * Math.PI));
      return parseFloat(Math.max(0, W_LOSS * g1 + W_WIN * g2).toFixed(6));
    });
  });

  const spike_scenarios = Array.from({ length: 15 }, (_, i) => {
    const pos_pnl = (rand() - 0.45) * 160;
    const eff = 0.41 + rand() * 0.48;
    const hedge_pnl = -pos_pnl * eff * (96 / 500);
    return {
      day: Math.floor(i * 18 + rand() * 10),
      da: parseFloat(((rand() - 0.5) * 0.06).toFixed(4)),
      db: parseFloat(((rand() - 0.5) * 0.05).toFixed(4)),
      pos_pnl: parseFloat(pos_pnl.toFixed(2)),
      hedge_pnl: parseFloat(hedge_pnl.toFixed(2)),
      net_pnl: parseFloat((pos_pnl + hedge_pnl).toFixed(2)),
      effectiveness: parseFloat(Math.max(-0.2, Math.min(1, eff)).toFixed(4)),
    };
  });

  const WF_N = 40;
  let wfH = 0, wfU = 0;
  const wf_hedged: number[] = [], wf_unhedged: number[] = [], rolling_beta: number[] = [];
  for (let i = 0; i < WF_N; i++) {
    const shock = (rand() - 0.5) * 0.09;
    wfH += shock * 0.61; wfU += shock;
    wf_hedged.push(parseFloat(wfH.toFixed(4)));
    wf_unhedged.push(parseFloat(wfU.toFixed(4)));
    rolling_beta.push(parseFloat((0.79 + (rand() - 0.5) * 0.21).toFixed(4)));
  }

  return {
    simulation: {
      n_sim: N_SIM, horizon_days: HORIZON,
      fan, fan_unhedged, sample_paths, terminal_pnl,
      terminal_histogram: { centers, density },
      terminal_kde: { x: kde_x, y: kde_y },
      prob_loss_at_t, var_5pct,
      expected_shortfall_5pct: es_5pct,
      prob_profit: parseFloat(W_WIN.toFixed(4)),
      density_surface: { time_steps: DS_T, pnl_grid: DS_PGRID, z: ds_z },
    },
    scenario_replay: {
      all_scenarios: spike_scenarios, spike_scenarios,
      conditional_hedge_effectiveness: 0.608,
      pct_events_hedged: 0.571,
      cvar_net: -558.14, cvar_unhedged: -596.0,
    },
    walk_forward: {
      hedged_cum: wf_hedged, unhedged_cum: wf_unhedged, rolling_beta,
      oos_variance_reduction: 0.312, n_oos_points: WF_N,
    },
    meta: {
      n_shared_days: 328, n_returns: 327, warnings: [],
      market_a_id: 'demo-iran-regime-fall', market_b_id: 'demo-iran-civil-unrest',
    },
  };
}
