import Link from 'next/link';
import { Search } from 'lucide-react';

import { EmptyState, PageHeader, PublicPageLayout } from '@/components/public/Layout';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { db } from '@/db/client';
import { dramas, movies } from '@/modules/content/schema';
import { and, eq, ilike, sql, desc } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

type SearchFilter = 'all' | 'drama' | 'movie';
type SortOption = 'newest' | 'trending' | 'popular' | 'highest_rated' | 'most_viewed';
type StatusFilter = 'all' | 'ongoing' | 'completed';

interface SearchResult {
  id: string;
  title: string;
  poster: string;
  content_type: 'drama' | 'movie';
  href: string;
}

interface SearchFilters {
  query: string;
  filter: SearchFilter;
  sort: SortOption;
  status: StatusFilter;
}

export default function SearchPage() {
  // Get query from URL search params
  const url = new URL(self.location.href);
  const query = url.searchParams.get('q') || '';
  const filter = (url.searchParams.get('f') as SearchFilter) || 'all';
  const sort = (url.searchParams.get('s') as SortOption) || 'newest';
  const status = (url.searchParams.get('t') as StatusFilter) || 'all';

  // State for results - using URL-based state
  const [results, setResults] = (self as any).React.useState<SearchResult[]>([]);
  const [suggestions, setSuggestions] = (self as any).React.useState<Array<{ id: string; title: string; poster: string; content_type: 'drama' | 'movie' }>>([]);
  const [recentSearches, setRecentSearches] = (self as any).React.useState<string[]>([]);
  const [loading, setLoading] = (self as any).React.useState(false);
  const [error, setError] = (self as any).React.useState<string | null>(null);

  // Initialize results from URL query on mount
  useEffect(() => {
    if (query) {
      performSearchFromUrl(query, filter, sort, status);
    }
  }, [query, filter, sort, status]);

  // Perform search using server actions
  const performSearchFromUrl = useCallback(async (query: string, filter: SearchFilter, sort: SortOption, status: StatusFilter) => {
    setLoading(true);
    setError(null);

    try {
      const [dramaResults, movieResults] = await Promise.all([
        db
          .select({
            id: dramas.id,
            title: dramas.title,
            poster: dramas.poster,
            content_type: sql`'drama'::text`,
          })
          .from(dramas)
          .where(
            and(
              sql`${dramas.deleted_at} IS NULL`,
              sql`${dramas.publication_status} = 'published'`,
              sql`${dramas.isActive} = true`,
              ilike(dramas.title, `%${query}%`)
            )
          )
          .orderBy(desc(dramas.created_at))
          .limit(20),

        db
          .select({
            id: movies.id,
            title: movies.title,
            poster: movies.poster,
            content_type: sql`'movie'::text`,
          })
          .from(movies)
          .where(
            and(
              sql`${movies.deleted_at} IS NULL`,
              sql`${movies.publication_status} = 'published'`,
              sql`${movies.isActive} = true`,
              ilike(movies.title, `%${query}%`)
            )
          )
          .orderBy(desc(movies.created_at))
          .limit(20)
      ]);

      // Combine and deduplicate by ID
      const allResults = [...dramaResults, ...movieResults];
      const seen = new Set<string>();
      const deduped = allResults.filter(item => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });

      // Map to search result format
      const mappedResults = deduped.map(item => ({
        id: item.id,
        title: item.title,
        poster: item.poster || '',
        content_type: item.content_type as 'drama' | 'movie',
        href: item.content_type === 'drama' ? `/drama/${item.id}` : `/movie/${item.id}`,
      }));

      setResults(mappedResults);

      // Get autocomplete suggestions
      const autoSuggestions = await getAutocompleteSuggestions(query);
      setSuggestions(autoSuggestions);
    } catch (err) {
      console.error('Search error:', err);
      setError('Search failed. Please try again.');
      setResults([]);
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Get autocomplete suggestions
  const getAutocompleteSuggestions = useCallback(async (query: string) => {
    if (!query.trim() || query.length < 2) {
      return [];
    }

    try {
      // Get recent searches matching the query
      const recent = await db
        .select({ query_text: sql`NULL` })
        .from(sql`search_events`)
        .limit(0); // Placeholder - in production, query the actual table

      // Get popular suggestions based on content titles matching the query
      const [popularDramas, popularMovies] = await Promise.all([
        db
          .select({ id: dramas.id, title: dramas.title, poster: dramas.poster })
          .from(dramas)
          .where(
            and(
              sql`${dramas.deleted_at} IS NULL`,
              sql`${dramas.publication_status} = 'published'`,
              sql`${dramas.isActive} = true`,
              ilike(dramas.title, `${query}%`)
            )
          )
          .limit(5),

        db
          .select({ id: movies.id, title: movies.title, poster: movies.poster })
          .from(movies)
          .where(
            and(
              sql`${movies.deleted_at} IS NULL`,
              sql`${movies.publication_status} = 'published'`,
              sql`${movies.isActive} = true`,
              ilike(movies.title, `${query}%`)
            )
          )
          .limit(5)
      ]);

      const dramaSuggestions = popularDramas.map(d => ({
        id: d.id,
        title: d.title,
        poster: d.poster,
        content_type: 'drama' as const,
      }));

      const movieSuggestions = popularMovies.map(m => ({
        id: m.id,
        title: m.title,
        poster: m.poster,
        content_type: 'movie' as const,
      }));

      // Combine and deduplicate
      const all = [...dramaSuggestions, ...movieSuggestions];
      const seen = new Set<string>();
      return all.filter(item => {
        if (seen.has(item.title.toLowerCase())) return false;
        seen.add(item.title.toLowerCase());
        return true;
      });
    } catch (error) {
      console.error('Autocomplete error:', error);
      return [];
    }
  }, []);

  // Handle filter change - update URL
  const onFilterChange = useCallback((newFilter: SearchFilter) => {
    const params = new URLSearchParams();
    params.set('q', query);
    params.set('f', newFilter);
    params.set('s', sort);
    params.set('t', status);
    const newUrl = `${self.location.pathname}?${params.toString()}`;
    history.pushState({}, '', newUrl);
    performSearchFromUrl(query, newFilter, sort, status);
  }, [query, sort, status, performSearchFromUrl]);

  // Handle sort change - update URL
  const onSortChange = useCallback((newSort: SortOption) => {
    const params = new URLSearchParams();
    params.set('q', query);
    params.set('f', filter);
    params.set('s', newSort);
    params.set('t', status);
    const newUrl = `${self.location.pathname}?${params.toString()}`;
    history.pushState({}, '', newUrl);
    performSearchFromUrl(query, filter, newSort, status);
  }, [query, filter, status, performSearchFromUrl]);

  // Handle status change - update URL
  const onStatusChange = useCallback((newStatus: StatusFilter) => {
    const params = new URLSearchParams();
    params.set('q', query);
    params.set('f', filter);
    params.set('s', sort);
    params.set('t', newStatus);
    const newUrl = `${self.location.pathname}?${params.toString()}`;
    history.pushState({}, '', newUrl);
    performSearchFromUrl(query, filter, sort, newStatus);
  }, [query, filter, sort, performSearchFromUrl]);

  return (
    <PublicPageLayout title="Search">
      <div className="space-y-10">
        <PageHeader
          eyebrow="Discover"
          title="Search"
          description="Find dramas and movies by title, genre, or keyword"
        />

        <div className="mb-8">
          <form onSubmit={(e) => {
            e.preventDefault();
            const input = e.target.querySelector('input') as HTMLInputElement;
            const query = input?.value || '';
            if (!query) return;

            const params = new URLSearchParams();
            params.set('q', query);
            params.set('f', filter);
            params.set('s', sort);
            params.set('t', status);
            const newUrl = `${self.location.pathname}?${params.toString()}`;
            history.pushState({}, '', newUrl);
          }}
          className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-600 fade-in" />
              <input
                type="text"
                name="query"
                placeholder="Search for dramas, movies, genres, or actors..."
                className="w-full px-10 py-3 rounded-lg border border-border placeholder-gray-400 focus:ring-2 focus:ring-green-500 focus:border-transparent dark:bg-gray-800 dark:text-white"
                autoComplete="off"
                value={query}
                disabled={loading}
              />
            </div>
            
            <div className="flex items-center gap-2">
              <select
                onChange={(e) => onFilterChange(e.target.value as SearchFilter)}
                className="rounded-lg border border-border px-3 py-2 select-selectappearance-none focus:ring-2 focus:ring-green-500 focus:border-transparent dark:bg-gray-800 dark:text-white"
                disabled={loading}
              >
                <option value="all">All</option>
                <option value="drama">Drama</option>
                <option value="movie">Movie</option>
              </select>
            </div>
            
            <div className="flex items-center gap-2">
              <select
                onChange={(e) => onSortChange(e.target.value as SortOption)}
                className="rounded-lg border border-border px-3 py-2 select-selectappearance-none focus:ring-2 focus:ring-green-500 focus:border-transparent dark:bg-gray-800 dark:text-white"
                disabled={loading}
              >
                <option value="newest">Newest</option>
                <option value="trending">Trending</option>
                <option value="popular">Popular</option>
                <option value="highest_rated">Highest Rated</option>
                <option value="most_viewed">Most Viewed</option>
              </select>
            </div>
            
            <div className="flex items-center gap-2">
              <select
                onChange={(e) => onStatusChange(e.target.value as StatusFilter)}
                className="rounded-lg border border-border px-3 py-2 select-selectappearance-none focus:ring-2 focus:ring-green-500 focus:border-transparent dark:bg-gray-800 dark:text-white"
                disabled={loading}
              >
                <option value="all">All</option>
                <option value="ongoing">Ongoing</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          </form>
        </div>

        {/* Recent Searches - static, no fetch needed */}
        <div className="mb-6">
          <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Recent Searches</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {/* Static recent searches for demonstration */}
            <button className="rounded-lg border border-border px-3 py-1 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-900">
              Popular drama
            </button>
            <button className="rounded-lg border border-border px-3 py-1 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-900">
              Action movies
            </button>
            <button className="rounded-lg border border-border px-3 py-1 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-900">
              Romance series
            </button>
            <button className="rounded-lg border border-border px-3 py-1 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-900">
              Horror films
            </button>
          </div>
        </div>

        {/* Autocomplete Suggestions */}
        {suggestions.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Suggestions</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {suggestions.map((suggestion) => (
                <div
                  key={suggestion.id}
                  className="rounded-lg border border-border p-2 hover:bg-gray-100 dark:hover:bg-gray-900 cursor-pointer"
                >
                  {suggestion.poster ? (
                    <img
                      src={suggestion.poster}
                      alt={suggestion.title}
                      loading="lazy"
                      className="w-8 h-8 object-cover rounded"
                    />
                  ) : (
                    <div
                      className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded flex items-center justify-center text-xs text-gray-400"
                    >
                      {suggestion.title.charAt(0)}
                    </div>
                  )}
                  <span className="ml-2 text-sm text-gray-700 dark:text-gray-300 line-clamp-1">{suggestion.title}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* No results state */}
        {results.length === 0 && query.length > 0 && !loading && !error && (
          <EmptyState
            icon={Search}
            title="No results found"
            description="Try different keywords or check the spelling"
          >
            <Link
              href="/drama?search=true"
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            >
              Browse drama series
            </Link>
            <Link
              href="/movie?search=true"
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            >
              Browse movies
            </Link>
          </EmptyState>
        )}

        {/* Error state */}
        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200">
            <p>{error}</p>
          </div>
        )}

        {/* Results */}
        {results.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {results.map((item) => (
              <div
                key={item.id}
                className="rounded-lg border p-4 hover:shadow-lg transition-shadow cursor-pointer"
                onClick={() => window.location.href = item.href}
              >
                {item.poster ? (
                  <img
                    src={item.poster}
                    alt={item.title}
                    loading="lazy"
                    className="w-full h-48 object-cover rounded-lg mb-3"
                  />
                ) : (
                  <div
                    className="w-full h-48 bg-gray-200 dark:bg-gray-700 rounded-lg flex items-center justify-center text-sm text-gray-500 dark:text-gray-400"
                  >
                    {item.title.charAt(0)}
                  </div>
                )}

                <h3 className="font-medium text-gray-900 dark:text-gray-100 line-clamp-2">
                  {item.title}
                </h3>

                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {item.content_type === 'drama' ? 'Drama' : 'Movie'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PublicPageLayout>
  );
}