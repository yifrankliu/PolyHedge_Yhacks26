import { useState } from 'react';
import MarketCompare from './components/MarketCompare';
import CorrelationScanner from './components/CorrelationScanner';
import { Market } from './api/client';
import PortfolioInputPage, { PortfolioPosition } from './components/PortfolioInputPage';
import HedgeScanner from './components/HedgeScanner';

const TABS: { id: string; label: string; disabled?: boolean }[] = [
  { id: 'portfolio', label: 'Position Input' },
  { id: 'scanner', label: 'Correlation Scanner' },
  { id: 'compare', label: 'Market Comparator' },
  { id: 'hedge', label: 'Hedge Scanner' },
];


export default function App() {
  const [activeTab, setActiveTab] = useState('portfolio');
  const [hedgePositions, setHedgePositions] = useState<PortfolioPosition[]>([]);
  const [pendingMarketA, setPendingMarketA] = useState<Market | null>(null);
  const [pendingMarketB, setPendingMarketB] = useState<Market | null>(null);

  const handleCompare = (target: Market, correlated: Market) => {
    setPendingMarketA(target);
    setPendingMarketB(correlated);
    setActiveTab('compare');
  };

  const handleScanHedges = (positions: PortfolioPosition[]) => {
    setHedgePositions(positions);
    setActiveTab('hedge');
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-white tracking-tight">
              PredictionAnalytics
            </h1>
            <p className="text-xs text-gray-500">
              TradFi-grade tools for prediction markets
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
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
                    ? 'border-transparent text-gray-600 cursor-not-allowed'
                    : 'border-transparent text-gray-400 hover:text-gray-200'
                }`}
              >
                {tab.label}
                {tab.disabled && (
                  <span className="ml-1.5 text-xs bg-gray-800 text-gray-500 px-1.5 py-0.5 rounded">
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
        {/* Scanner and Hedge Scanner stay mounted to preserve results; hidden when inactive */}
        <div style={{ display: activeTab === 'scanner' ? 'block' : 'none' }}>
          <CorrelationScanner onCompare={handleCompare} />
        </div>
        <div style={{ display: activeTab === 'hedge' ? 'block' : 'none' }}>
          <HedgeScanner initialPositions={hedgePositions} />
        </div>
      </main>
    </div>
  );
}
