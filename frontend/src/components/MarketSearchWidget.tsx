import { useState, useEffect, useRef } from 'react';
import {
  Market,
  PolymarketTag,
  listPolymarketTags,
  searchPolymarketUnified,
  marketsByTag,
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
  const [tags, setTags] = useState<PolymarketTag[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [activeTagId, setActiveTagId] = useState<number | null>(null);
  const urlDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load top tags once on mount
  useEffect(() => {
    setTagsLoading(true);
    listPolymarketTags()
      .then(data => {
        // Top 12 by count
        setTags([...data].sort((a, b) => b.count - a.count).slice(0, 12));
      })
      .catch(() => {})
      .finally(() => setTagsLoading(false));
  }, []);

  const handleQueryChange = (val: string) => {
    setQuery(val);
    setError('');

    // URL paste auto-detect: trigger slug lookup on 200ms debounce
    if (urlDebounceRef.current) clearTimeout(urlDebounceRef.current);
    if (isPolymarketUrl(val)) {
      urlDebounceRef.current = setTimeout(async () => {
        const slug = extractPolymarketSlug(val);
        if (!slug) return;
        setLoading(true);
        setResults([]);
        setActiveTagId(null);
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
    setActiveTagId(null);
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

  const handleTagClick = async (tag: PolymarketTag) => {
    setActiveTagId(tag.id);
    setQuery('');
    setResults([]);
    setError('');
    setLoading(true);
    try {
      const r = await marketsByTag(tag.id);
      setResults(r);
      if (r.length === 0) setError(`No open markets found for "${tag.label}"`);
    } catch {
      setError('Failed to load tag markets');
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (m: Market) => {
    onSelect(m);
    setResults([]);
    setQuery('');
    setActiveTagId(null);
    setError('');
  };

  const handleChange = () => {
    // Signal "cleared" to parent by passing a market with empty id
    onSelect({ ...(selected as Market), id: '' });
    setResults([]);
    setQuery('');
    setActiveTagId(null);
    setError('');
  };

  const isSelected = !!selected?.id;

  return (
    <div className="bg-gray-900 rounded-xl p-5 border border-gray-700">
      {/* Header label row */}
      {label && (
        <div className="flex items-center gap-2 mb-3">
          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: accentColor }} />
          <h3 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">{label}</h3>
        </div>
      )}

      {/* Selected market card */}
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

      {/* Search input */}
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

      {/* Tag chips — shown when no market selected */}
      {!isSelected && !tagsLoading && tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {tags.map(tag => (
            <button
              key={tag.id}
              onClick={() => handleTagClick(tag)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                activeTagId === tag.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200 border border-gray-700'
              }`}
            >
              {tag.label}
            </button>
          ))}
        </div>
      )}

      {/* Error message */}
      {error && !loading && (
        <p className="text-xs text-red-400 mb-2">{error}</p>
      )}

      {/* Loading indicator */}
      {loading && results.length === 0 && (
        <p className="text-xs text-gray-500 text-center py-2 animate-pulse">
          {activeTagId != null ? 'Loading markets…' : 'Searching…'}
        </p>
      )}

      {/* Results dropdown */}
      {results.length > 0 && (
        <div className="bg-gray-800 rounded-lg border border-gray-700 max-h-56 overflow-y-auto">
          {activeTagId != null && (
            <div className="px-4 py-2 border-b border-gray-700">
              <span className="text-xs text-gray-500">
                {tags.find(t => t.id === activeTagId)?.label} · {results.length} open markets
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
