import { useState } from 'react';
import Logo from './components/Logo';
import MarketCompare from './components/MarketCompare';
import CorrelationScanner from './components/CorrelationScanner';
import { Market, HedgeRecommendation } from './api/client';
import PortfolioInputPage, { PortfolioPosition } from './components/PortfolioInputPage';
import HedgeScanner from './components/HedgeScanner';
import StrategyBuilder from './components/StrategyBuilder';
import StressTestDashboard from './components/StressTestDashboard';

const TABS: { id: string; label: string; disabled?: boolean }[] = [
  { id: 'portfolio', label: 'Position Input' },
  { id: 'scanner', label: 'Correlation Scanner' },
  { id: 'compare', label: 'Market Comparator' },
  { id: 'hedge', label: 'Hedge Scanner' },
  { id: 'strategy', label: 'Strategy Builder' },
  { id: 'stress', label: 'Stress Test' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('portfolio');
  const [hedgePositions, setHedgePositions] = useState<PortfolioPosition[]>([]);
  const [hedgeRecommendations, setHedgeRecommendations] = useState<HedgeRecommendation[]>([]);
  const [strategyPositions, setStrategyPositions] = useState<PortfolioPosition[]>([]);
  const [stressTarget, setStressTarget] = useState<{ position: PortfolioPosition; hedge: HedgeRecommendation } | null>(null);
  const [pendingMarketA, setPendingMarketA] = useState<Market | null>(null);
  const [pendingMarketB, setPendingMarketB] = useState<Market | null>(null);

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
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-900">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Logo size={28} />
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight">
                PolyHedge
              </h1>
              <p className="text-xs text-zinc-500">
                TradFi-grade tools for prediction markets
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
            Live data
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-6xl mx-auto px-6">
          <nav className="flex gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => !tab.disabled && setActiveTab(tab.id)}
                disabled={tab.disabled}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-indigo-500 text-indigo-400'
                    : tab.disabled
                    ? 'border-transparent text-zinc-600 cursor-not-allowed'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {tab.label}
                {tab.disabled && (
                  <span className="ml-1.5 text-xs bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded">
                    soon
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {activeTab === 'portfolio' && <PortfolioInputPage onScanHedges={handleScanHedges} />}
        {activeTab === 'compare' && (
          <MarketCompare
            initialMarketA={pendingMarketA ?? undefined}
            initialMarketB={pendingMarketB ?? undefined}
          />
        )}
        <div style={{ display: activeTab === 'scanner' ? 'block' : 'none' }}>
          <CorrelationScanner onCompare={handleCompare} />
        </div>
        <div style={{ display: activeTab === 'hedge' ? 'block' : 'none' }}>
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
        <div style={{ display: activeTab === 'stress' ? 'block' : 'none' }}>
          <StressTestDashboard
            position={stressTarget?.position ?? null}
            hedge={stressTarget?.hedge ?? null}
          />
        </div>
      </main>
    </div>
  );
}
