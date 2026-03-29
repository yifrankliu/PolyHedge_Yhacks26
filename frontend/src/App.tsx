import { useState } from 'react';
import Logo from './components/Logo';
import MarketCompare from './components/MarketCompare';
import CorrelationScanner from './components/CorrelationScanner';
import { Market, HedgeRecommendation } from './api/client';
import PortfolioInputPage, { PortfolioPosition } from './components/PortfolioInputPage';
import HedgeScanner from './components/HedgeScanner';
import StrategyBuilder from './components/StrategyBuilder';
import StressTestDashboard from './components/StressTestDashboard';

// ── Tab icons (16×16 stroke SVGs) ─────────────────────────────────────────────

function IconPortfolio() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="3.5" width="13" height="10" rx="1.5" />
      <path d="M5 3.5V2.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
      <path d="M1.5 7.5h13" />
      <path d="M5.5 7.5v4M8 7.5v4M10.5 7.5v4" />
    </svg>
  );
}

function IconCorrelation() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="3.5" cy="12" r="1.5" />
      <circle cx="8" cy="4.5" r="1.5" />
      <circle cx="12.5" cy="9" r="1.5" />
      <path d="M4.9 11.1 6.7 5.8M9.4 4.9l1.7 2.8" />
    </svg>
  );
}

function IconCompare() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 4.5h13M1.5 8h6M1.5 11.5h4" />
      <path d="M11 6l3 2-3 2" />
    </svg>
  );
}

function IconHedge() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1.5 L13.5 3.5 V8 C13.5 11.5 8 14.5 8 14.5 C8 14.5 2.5 11.5 2.5 8 V3.5 Z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}

function IconStrategy() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="9.5" width="4" height="5" rx="0.75" />
      <rect x="6.5" y="6" width="4" height="8.5" rx="0.75" />
      <rect x="11" y="2.5" width="4" height="12" rx="0.75" />
    </svg>
  );
}

function IconStress() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 8.5h2l2-5 2.5 8 2-6 1.5 4 1.5-2.5H15" />
    </svg>
  );
}

// ── Tab definitions ───────────────────────────────────────────────────────────

const TABS = [
  { id: 'portfolio', label: 'Position Input',      Icon: IconPortfolio   },
  { id: 'scanner',   label: 'Correlation Scanner', Icon: IconCorrelation },
  { id: 'compare',   label: 'Market Comparator',   Icon: IconCompare     },
  { id: 'hedge',     label: 'Hedge Scanner',        Icon: IconHedge       },
  { id: 'strategy',  label: 'Strategy Builder',     Icon: IconStrategy    },
  { id: 'stress',    label: 'Stress Test',          Icon: IconStress      },
];

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [activeTab, setActiveTab] = useState('portfolio');
  const [hedgePositions, setHedgePositions]           = useState<PortfolioPosition[]>([]);
  const [hedgeRecommendations, setHedgeRecommendations] = useState<HedgeRecommendation[]>([]);
  const [strategyPositions, setStrategyPositions]     = useState<PortfolioPosition[]>([]);
  const [stressTarget, setStressTarget]               = useState<{ position: PortfolioPosition; hedge: HedgeRecommendation } | null>(null);
  const [pendingMarketA, setPendingMarketA]           = useState<Market | null>(null);
  const [pendingMarketB, setPendingMarketB]           = useState<Market | null>(null);

  const handleCompare = (target: Market, correlated: Market) => {
    setPendingMarketA(target);
    setPendingMarketB(correlated);
    setActiveTab('compare');
  };

  const handleScanHedges = (positions: PortfolioPosition[]) => {
    setHedgePositions(positions);
    setStrategyPositions(positions);
    setActiveTab('hedge');
  };

  const handleRecommendationsUpdate = (recs: HedgeRecommendation[], pos: PortfolioPosition) => {
    setHedgeRecommendations(recs);
    setStrategyPositions(prev => (prev.length ? prev : [pos]));
  };

  const handleTestStrategy = (pos: PortfolioPosition, hedge: HedgeRecommendation) => {
    setStressTarget({ position: pos, hedge });
    setActiveTab('stress');
  };

  return (
    <div className="flex min-h-screen bg-zinc-950 text-white">

      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside className="w-56 shrink-0 bg-zinc-900 border-r border-zinc-800 flex flex-col sticky top-0 h-screen">

        {/* Brand */}
        <div className="px-5 pt-5 pb-4 flex items-center gap-2.5 border-b border-zinc-800/60">
          <Logo size={26} />
          <div>
            <p className="text-sm font-bold text-white tracking-tight leading-tight">PolyHedge</p>
            <p className="text-[10px] text-zinc-500 leading-tight mt-0.5">TradFi-grade tools</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          <p className="text-[9px] font-semibold text-zinc-600 uppercase tracking-widest px-3 pb-2">
            Pipeline
          </p>
          {TABS.map(({ id, label, Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all text-left group relative ${
                  active
                    ? 'bg-indigo-500/10 text-indigo-300'
                    : 'text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-200'
                }`}
              >
                {/* Left accent bar */}
                <span
                  className={`absolute left-0 top-1 bottom-1 w-0.5 rounded-full transition-all ${
                    active ? 'bg-indigo-500 opacity-100' : 'opacity-0'
                  }`}
                />
                <Icon />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </nav>

        {/* Footer status */}
        <div className="px-5 py-4 border-t border-zinc-800/60">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
            </span>
            Live · Polymarket
          </div>
        </div>
      </aside>

      {/* ── Main content ────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto px-8 py-8">
          {activeTab === 'portfolio' && <PortfolioInputPage onScanHedges={handleScanHedges} />}
          {activeTab === 'compare' && (
            <MarketCompare
              initialMarketA={pendingMarketA ?? undefined}
              initialMarketB={pendingMarketB ?? undefined}
            />
          )}
          <div style={{ display: activeTab === 'scanner'  ? 'block' : 'none' }}>
            <CorrelationScanner onCompare={handleCompare} />
          </div>
          <div style={{ display: activeTab === 'hedge'    ? 'block' : 'none' }}>
            <HedgeScanner
              initialPositions={hedgePositions}
              onRecommendationsUpdate={handleRecommendationsUpdate}
              onNavigateToStrategy={() => setActiveTab('strategy')}
            />
          </div>
          <div style={{ display: activeTab === 'strategy' ? 'block' : 'none' }}>
            <StrategyBuilder
              positions={strategyPositions}
              recommendations={hedgeRecommendations}
              onTestStrategy={handleTestStrategy}
            />
          </div>
          <div style={{ display: activeTab === 'stress'   ? 'block' : 'none' }}>
            <StressTestDashboard
              position={stressTarget?.position ?? null}
              hedge={stressTarget?.hedge ?? null}
            />
          </div>
        </div>
      </main>

    </div>
  );
}
