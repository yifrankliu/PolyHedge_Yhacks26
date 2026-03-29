import { HedgeRecommendation, FailedHedgeCandidate, BacktestResponse, CorrelationResult, Market } from '../api/client';
import { PortfolioPosition } from '../components/PortfolioInputPage';

export const DEMO_POSITION: PortfolioPosition = {
  id: 'demo-position-btc',
  market_id: 'demo-btc-100k',
  market_question: 'Will Bitcoin exceed $100,000 before 2025?',
  source: 'polymarket',
  side: 'YES',
  status: 'current',
  entry_price_cents: 65,
  stake_usd: 500,
  notes: 'Demo position — BTC $100k',
};

export const DEMO_MARKET_A: Market = {
  id: 'demo-btc-100k',
  question: 'Will Bitcoin exceed $100,000 before 2025?',
  price: 0.65,
  volume: 22400000,
  end_date: '2024-12-31T00:00:00Z',
  source: 'polymarket',
};

export const DEMO_MARKET_B: Market = {
  id: 'demo-eth-4k',
  question: 'Will Ethereum exceed $4,000 before 2025?',
  price: 0.55,
  volume: 8700000,
  end_date: '2024-12-31T00:00:00Z',
  source: 'polymarket',
};

export const DEMO_RECOMMENDATIONS: HedgeRecommendation[] = [
  {
    candidate_market_id: 'demo-eth-4k',
    question: 'Will Ethereum exceed $4,000 before 2025?',
    current_price: 0.55,
    platform: 'polymarket',
    hedge_direction: 'YES',
    hedge_ratio: 0.29,
    recommended_size: 145,
    correlation: 0.847,
    full_pearson: 0.831,
    rolling_std: 0.048,
    lead_direction: 'A_leads_B',
    shared_history_days: 298,
    n_observations: 298,
    composite_score: 0.78,
    bl_divergence: 0.08,
    bl_confidence: 0.72,
    hedge_confidence: 0.84,
    confidence_label: 'High confidence',
    caveats: [],
    stability_discounted: false,
  },
  {
    candidate_market_id: 'demo-btc-etf',
    question: 'Will a spot Bitcoin ETF be approved in the US by end of 2024?',
    current_price: 0.82,
    platform: 'polymarket',
    hedge_direction: 'YES',
    hedge_ratio: 0.17,
    recommended_size: 87,
    correlation: 0.631,
    full_pearson: 0.619,
    rolling_std: 0.071,
    lead_direction: 'B_leads_A',
    shared_history_days: 241,
    n_observations: 241,
    composite_score: 0.61,
    bl_divergence: 0.12,
    bl_confidence: 0.64,
    hedge_confidence: 0.67,
    confidence_label: 'Moderate confidence',
    caveats: ['High current price reduces hedge effectiveness'],
    stability_discounted: false,
  },
  {
    candidate_market_id: 'demo-fed-cuts',
    question: 'Will the Federal Reserve cut rates at least twice in 2024?',
    current_price: 0.67,
    platform: 'polymarket',
    hedge_direction: 'YES',
    hedge_ratio: 0.12,
    recommended_size: 62,
    correlation: 0.512,
    full_pearson: 0.498,
    rolling_std: 0.094,
    lead_direction: 'sync',
    shared_history_days: 185,
    n_observations: 185,
    composite_score: 0.51,
    bl_divergence: -0.03,
    bl_confidence: 0.51,
    hedge_confidence: 0.58,
    confidence_label: 'Moderate confidence',
    caveats: ['Short shared history (185 days)', 'Rolling correlation is unstable'],
    stability_discounted: false,
  },
  {
    candidate_market_id: 'demo-mstr',
    question: 'Will MicroStrategy (MSTR) stock exceed $300 in 2024?',
    current_price: 0.71,
    platform: 'polymarket',
    hedge_direction: 'YES',
    hedge_ratio: 0.10,
    recommended_size: 48,
    correlation: 0.731,
    full_pearson: 0.718,
    rolling_std: 0.082,
    lead_direction: 'B_leads_A',
    shared_history_days: 156,
    n_observations: 156,
    composite_score: 0.55,
    bl_divergence: null,
    bl_confidence: null,
    hedge_confidence: 0.63,
    confidence_label: 'Moderate confidence',
    caveats: ['Insufficient data for BL signal', 'Short shared history (156 days)'],
    stability_discounted: false,
  },
  {
    candidate_market_id: 'demo-nasdaq',
    question: 'Will the Nasdaq Composite close above 20,000 in 2024?',
    current_price: 0.58,
    platform: 'polymarket',
    hedge_direction: 'YES',
    hedge_ratio: 0.08,
    recommended_size: 38,
    correlation: 0.441,
    full_pearson: 0.428,
    rolling_std: 0.109,
    lead_direction: 'B_leads_A',
    shared_history_days: 210,
    n_observations: 210,
    composite_score: 0.44,
    bl_divergence: null,
    bl_confidence: null,
    hedge_confidence: 0.51,
    confidence_label: 'Low confidence',
    caveats: ['Weak correlation', 'Equity-crypto correlation unstable'],
    stability_discounted: true,
  },
];

export const DEMO_FAILED_CANDIDATES: FailedHedgeCandidate[] = [
  {
    candidate_market_id: 'demo-fail-1',
    question: 'Will Solana reach $300 in 2024?',
    platform: 'polymarket',
    current_price: 0.42,
    fail_reason: 'Insufficient shared history (28 days < 32 min)',
    shared_history_days: 28,
    n_events: 3,
  },
  {
    candidate_market_id: 'demo-fail-2',
    question: 'Will the US enter a recession in 2024?',
    platform: 'polymarket',
    current_price: 0.18,
    fail_reason: 'Fewer than 8 spike events (5 found)',
    shared_history_days: 145,
    n_events: 5,
  },
  {
    candidate_market_id: 'demo-fail-3',
    question: 'Will Dogecoin reach $1.00 in 2024?',
    platform: 'polymarket',
    current_price: 0.31,
    fail_reason: 'Absolute correlation too low (|r| = 0.14 < threshold)',
    shared_history_days: 88,
    n_events: 9,
  },
];

export const DEMO_CORRELATION: CorrelationResult = {
  market_a: 'demo-btc-100k',
  market_b: 'demo-eth-4k',
  shared_history_days: 298,
  n_observations: 298,
  full_pearson: 0.831,
  full_pearson_returns: 0.789,
  rolling_mean: 0.81,
  rolling_std: 0.048,
  rolling_pct_positive: 0.84,
  rolling_series: Array.from({ length: 60 }, (_, i) => ({
    t: Math.floor(Date.now() / 1000) - (60 - i) * 86400 * 5,
    r: parseFloat((0.81 + 0.08 * Math.sin(i / 8) + (i > 45 ? 0.05 : 0)).toFixed(4)),
  })),
  break_detected: false,
  cusum_pval: 0.28,
  pre_break_pearson: null,
  post_break_pearson: null,
  best_lag_days: 1,
  lag_correlation: 0.842,
  lead_direction: 'A_leads_B',
  lag_series: Array.from({ length: 11 }, (_, i) => ({
    lag: i - 5,
    r: parseFloat((0.831 * Math.exp(-0.08 * (i - 6) ** 2)).toFixed(4)),
  })),
  a_causes_b_pval: 0.031,
  b_causes_a_pval: 0.148,
  granger_dominant_direction: 'A_causes_B',
  low_volume_warning: false,
  short_history_warning: false,
  resolution_convergence: true,
  semantic_similarity: 0.72,
  end_date_proximity: 0.98,
  composite_score: 0.78,
};

function seededRand(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

export function generateDemoBacktestData(): BacktestResponse {
  const rand = seededRand(42);
  const HORIZON = 90;
  const N_SIM = 2000;

  const OUTCOMES = [387.41, 124.23, -381.82, -645];
  const WEIGHTS  = [0.3575, 0.2925, 0.1925, 0.1575];
  const cumW = WEIGHTS.reduce((acc, w, i) => { acc.push((acc[i - 1] ?? 0) + w); return acc; }, [] as number[]);

  const MU_FINAL = 8;
  const SIGMA_FINAL = 340;
  const QUANTILES: Record<string, number> = {
    '5': -1.645, '10': -1.282, '25': -0.674,
    '50': 0, '75': 0.674, '90': 1.282, '95': 1.645
  };

  const fan: Record<string, number[]> = {};
  const fan_unhedged: Record<string, number[]> = {};
  for (const q of ['5','10','25','50','75','90','95']) {
    fan[q] = [];
    fan_unhedged[q] = [];
  }

  for (let t = 0; t < HORIZON; t++) {
    const frac = (t + 1) / HORIZON;
    const sigma_t = SIGMA_FINAL * Math.sqrt(frac);
    const mu_t = MU_FINAL * frac;
    const sigma_uh = 420 * Math.sqrt(frac);
    const mu_uh = -18 * frac;
    for (const q of ['5','10','25','50','75','90','95']) {
      fan[q].push(parseFloat((mu_t + QUANTILES[q] * sigma_t).toFixed(2)));
      fan_unhedged[q].push(parseFloat((mu_uh + QUANTILES[q] * sigma_uh).toFixed(2)));
    }
  }

  const sample_paths: number[][] = [];
  for (let s = 0; s < 10; s++) {
    const path: number[] = [];
    let val = 0;
    for (let t = 0; t < HORIZON; t++) {
      val += (rand() - 0.5) * 60 + MU_FINAL / HORIZON;
      path.push(parseFloat(val.toFixed(2)));
    }
    sample_paths.push(path);
  }

  const terminal_pnl: number[] = [];
  for (let i = 0; i < N_SIM; i++) {
    const u = rand();
    let idx = cumW.findIndex(c => u <= c);
    if (idx < 0) idx = 3;
    terminal_pnl.push(parseFloat((OUTCOMES[idx] + (rand() - 0.5) * 60).toFixed(2)));
  }

  const BIN_COUNT = 30, BIN_MIN = -700, BIN_MAX = 500;
  const BIN_W = (BIN_MAX - BIN_MIN) / BIN_COUNT;
  const bins = new Array(BIN_COUNT).fill(0);
  terminal_pnl.forEach(v => {
    bins[Math.min(BIN_COUNT - 1, Math.max(0, Math.floor((v - BIN_MIN) / BIN_W)))]++;
  });
  const centers = bins.map((_, i) => parseFloat((BIN_MIN + (i + 0.5) * BIN_W).toFixed(1)));
  const density  = bins.map(c => parseFloat((c / (N_SIM * BIN_W)).toFixed(6)));

  const KDE_N = 80, BW = 40;
  const kde_x = Array.from({ length: KDE_N }, (_, i) =>
    parseFloat((BIN_MIN + (i / (KDE_N - 1)) * (BIN_MAX - BIN_MIN)).toFixed(1))
  );
  const kde_y = kde_x.map(x => {
    const sum = terminal_pnl.reduce((s, v) => s + Math.exp(-0.5 * ((x - v) / BW) ** 2), 0);
    return parseFloat((sum / (N_SIM * BW * Math.sqrt(2 * Math.PI))).toFixed(6));
  });

  const prob_loss_at_t = Array.from({ length: HORIZON }, (_, t) => {
    const frac = (t + 1) / HORIZON;
    return parseFloat((0.5 - (0.5 - (WEIGHTS[2] + WEIGHTS[3])) * frac).toFixed(4));
  });

  const var_5pct  = parseFloat((MU_FINAL + QUANTILES['5']  * SIGMA_FINAL).toFixed(2));
  const es_5pct   = parseFloat((var_5pct - 80).toFixed(2));

  const DS_T = [0, 12, 24, 36, 49, 62, 75, 89];
  const DS_PGRID = Array.from({ length: 30 }, (_, i) =>
    parseFloat((BIN_MIN + (i / 29) * (BIN_MAX - BIN_MIN)).toFixed(1))
  );
  const ds_z: number[][] = DS_T.map(t => {
    const frac = Math.max(0.01, (t + 1) / HORIZON);
    const sigma_t = SIGMA_FINAL * Math.sqrt(frac) * 0.6;
    return DS_PGRID.map(x => {
      const s1 = sigma_t + 30, mu1 = 270 * frac;
      const s2 = sigma_t + 20, mu2 = -500 * frac;
      const g1 = Math.exp(-0.5 * ((x - mu1) / s1) ** 2) / (s1 * Math.sqrt(2 * Math.PI));
      const g2 = Math.exp(-0.5 * ((x - mu2) / s2) ** 2) / (s2 * Math.sqrt(2 * Math.PI));
      return parseFloat(Math.max(0, (0.65 * g1 + 0.35 * g2) * 0.95).toFixed(6));
    });
  });

  const spike_scenarios = Array.from({ length: 15 }, (_, i) => {
    const pos_pnl = (rand() - 0.45) * 120;
    const eff = 0.4 + rand() * 0.5;
    const hedge_pnl = -pos_pnl * eff * (145 / 500);
    return {
      day: Math.floor(i * 19 + rand() * 10),
      da: parseFloat(((rand() - 0.5) * 0.12).toFixed(4)),
      db: parseFloat(((rand() - 0.5) * 0.10).toFixed(4)),
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
    const shock = (rand() - 0.5) * 0.08;
    wfH += shock * 0.62; wfU += shock;
    wf_hedged.push(parseFloat(wfH.toFixed(4)));
    wf_unhedged.push(parseFloat(wfU.toFixed(4)));
    rolling_beta.push(parseFloat((0.78 + (rand() - 0.5) * 0.2).toFixed(4)));
  }

  return {
    simulation: {
      n_sim: N_SIM, horizon_days: HORIZON,
      fan, fan_unhedged, sample_paths, terminal_pnl,
      terminal_histogram: { centers, density },
      terminal_kde: { x: kde_x, y: kde_y },
      prob_loss_at_t, var_5pct,
      expected_shortfall_5pct: es_5pct,
      prob_profit: parseFloat((WEIGHTS[0] + WEIGHTS[1]).toFixed(4)),
      density_surface: { time_steps: DS_T, pnl_grid: DS_PGRID, z: ds_z },
    },
    scenario_replay: {
      all_scenarios: spike_scenarios, spike_scenarios,
      conditional_hedge_effectiveness: 0.624,
      pct_events_hedged: 0.587,
      cvar_net: -298.41, cvar_unhedged: -443.17,
    },
    walk_forward: {
      hedged_cum: wf_hedged, unhedged_cum: wf_unhedged, rolling_beta,
      oos_variance_reduction: 0.341, n_oos_points: WF_N,
    },
    meta: {
      n_shared_days: 298, n_returns: 297, warnings: [],
      market_a_id: 'demo-btc-100k', market_b_id: 'demo-eth-4k',
    },
  };
}
