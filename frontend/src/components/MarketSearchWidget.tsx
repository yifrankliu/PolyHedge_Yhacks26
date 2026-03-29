import { useState, useRef } from 'react';
import {
  Market,
  searchPolymarketUnified,
  lookupPolymarketBySlug,
} from '../api/client';
import { extractPolymarketSlug, isPolymarketUrl } from '../utils/polymarket';

interface MarketSearchWidgetProps {
  onSelect: (m: Market) => void;
  selected?: Market | null;
  label?: string;
  accentColor?: string;
  placeholder?: string;
}

const CATEGORIES = [
  { label: 'Crypto', query: 'bitcoin crypto BTC ETH' },
  { label: 'Politics', query: 'election president congress senate' },
  { label: 'Economics', query: 'GDP inflation Fed interest rate' },
  { label: 'Sports', query: 'NBA NFL soccer championship' },
  { label: 'AI', query: 'AI GPT OpenAI artificial intelligence' },
  { label: 'Geopolitics', query: 'war ceasefire sanctions Ukraine Russia' },
  { label: 'Science', query: 'NASA SpaceX climate temperature' },
  { label: 'Entertainment', query: 'Oscar Emmy Grammy box office' },
];

export default function MarketSearchWidget({
  onSelect,
  selected = null,
  label,
  accentColor = '#818cf8',
  placeholder = 'Search or paste a Polymarket URL...',
}: MarketSearchWidgetProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Market[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const urlDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleQueryChange = (val: string) => {
    setQuery(val);
    setError('');

    if (urlDebounceRef.current) clearTimeout(urlDebounceRef.current);
    if (isPolymarketUrl(val)) {
      urlDebounceRef.current = setTimeout(async () => {
        const slug = extractPolymarketSlug(val);
        if (!slug) return;
        setLoading(true);
        setResults([]);
        setActiveCategory(null);
        try {
          const r = await lookupPolymarketBySlug(slug);
          setResults(r);
          if (r.length === 0) setError('No market found for that URL');
        } catch {
          setError('Could not load market from URL');
        } finally {
          setLoading(false);
        }
      }, 200);
    }
  };

  const search = async () => {
    if (!query.trim()) return;
    setActiveCategory(null);
    setLoading(true);
    setResults([]);
    setError('');
    try {
      const slug = extractPolymarketSlug(query);
      const r = slug
        ? await lookupPolymarketBySlug(slug)
        : await searchPolymarketUnified(query);
      setResults(r);
      if (r.length === 0) setError('No markets found — try different keywords or a URL');
    } catch {
      setError('Search failed — check your connection');
    } finally {
      setLoading(false);
    }
  };

  const handleCategoryClick = async (cat: typeof CATEGORIES[0]) => {
    setActiveCategory(cat.label);
    setQuery('');
    setResults([]);
    setError('');
    setLoading(true);
    try {
      const r = await searchPolymarketUnified(cat.query);
      setResults(r);
      if (r.length === 0) setError(`No open markets found for "${cat.label}"`);
    } catch {
      setError('Failed to load category markets');
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (m: Market) => {
    onSelect(m);
    setResults([]);
    setQuery('');
    setActiveCategory(null);
    setError('');
  };

  const handleChange = () => {
    onSelect({ ...(selected as Market), id: '' });
    setResults([]);
    setQuery('');
    setActiveCategory(null);
    setError('');
  };

  const isSelected = !!selected?.id;

  return (
    <div className="bg-gray-900 rounded-xl p-5 border border-gray-700">
      {label && (
        <div className="flex items-center gap-2 mb-3">
          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: accentColor }} />
          <h3 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">{label}</h3>
        </div>
      )}

      {isSelected && (
        <div className="mb-3 p-3 rounded-lg bg-gray-800 border border-gray-600">
          <p className="text-sm text-white font-medium leading-snug">{selected!.question}</p>
          <p className="text-xs text-gray-400 mt-1">
            {selected!.price != null ? `${(selected!.price * 100).toFixed(1)}¢` : 'N/A'} ·{' '}
            {selected!.end_date ? new Date(selected!.end_date).toLocaleDateString() : '?'}
          </p>
          <button
            onClick={handleChange}
            className="text-xs text-gray-500 hover:text-gray-300 mt-1 transition-colors"
          >
            Change market
          </button>
        </div>
      )}

      <div className="flex gap-2 mb-3">
        <input
          value={query}
          onChange={e => handleQueryChange(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
          placeholder={placeholder}
          className="flex-1 bg-gray-700 text-white rounded px-3 py-2 text-sm border border-gray-600 focus:outline-none focus:border-indigo-500"
        />
        <button
          onClick={search}
          disabled={loading || !query.trim()}
          className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50 transition-colors"
        >
          {loading ? '...' : 'Search'}
        </button>
      </div>

      {/* Category chips */}
      {!isSelected && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {CATEGORIES.map(cat => (
            <button
              key={cat.label}
              onClick={() => handleCategoryClick(cat)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                activeCategory === cat.label
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200 border border-gray-700'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      )}

      {error && !loading && (
        <p className="text-xs text-red-400 mb-2">{error}</p>
      )}

      {loading && results.length === 0 && (
        <p className="text-xs text-gray-500 text-center py-2 animate-pulse">
          {activeCategory ? `Loading ${activeCategory} markets…` : 'Searching…'}
        </p>
      )}

      {results.length > 0 && (
        <div className="bg-gray-800 rounded-lg border border-gray-700 max-h-56 overflow-y-auto">
          {activeCategory && (
            <div className="px-4 py-2 border-b border-gray-700">
              <span className="text-xs text-gray-500">
                {activeCategory} · {results.length} markets
              </span>
            </div>
          )}
          {results.map(m => (
            <button
              key={m.id}
              onClick={() => handleSelect(m)}
              className="w-full text-left px-4 py-3 hover:bg-gray-700 border-b border-gray-700 last:border-0 transition-colors"
            >
              <p className="text-sm text-white truncate">{m.question}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {m.price != null ? `${(m.price * 100).toFixed(1)}¢` : 'N/A'} ·{' '}
                ends {m.end_date ? new Date(m.end_date).toLocaleDateString() : '?'}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
