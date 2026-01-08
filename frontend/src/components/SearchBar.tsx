import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { InputWithContext } from "@/components/ui/input-with-context";
import {
  CloudDownload,
  Info,
  XCircle,
  Link,
  Search,
  X,
  ChevronDown,
  ListChecks,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Clock,
} from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { FetchHistory } from "@/components/FetchHistory";
import type { HistoryItem } from "@/components/FetchHistory";
import { SearchSpotify, SearchSpotifyByType } from "../../wailsjs/go/main/App";
import { backend } from "../../wailsjs/go/models";
import { cn } from "@/lib/utils";
import type { InputMode, BatchJobItem, BatchJobStatus } from "@/types/batch";

type ResultTab = "tracks" | "albums" | "artists" | "playlists";

const RECENT_SEARCHES_KEY = "spotiflac_recent_searches";
const MAX_RECENT_SEARCHES = 8;
const SEARCH_LIMIT = 50;

interface BatchStats {
  total: number;
  processed: number;
  current?: string;
}

interface SearchBarProps {
  url: string;
  loading: boolean;
  onUrlChange: (url: string) => void;
  onFetch: () => void;
  onFetchUrl: (url: string) => Promise<void>;
  history: HistoryItem[];
  onHistorySelect: (item: HistoryItem) => void;
  onHistoryRemove: (id: string) => void;
  hasResult: boolean;
  mode: InputMode;
  onModeChange: (mode: InputMode) => void;
  batchInput: string;
  onBatchInputChange: (value: string) => void;
  onBatchStart: () => void;
  onBatchStop: () => void;
  batchItems: BatchJobItem[];
  isBatchRunning: boolean;
  batchStats: BatchStats;
}

export function SearchBar({
  url,
  loading,
  onUrlChange,
  onFetch,
  onFetchUrl,
  history,
  onHistorySelect,
  onHistoryRemove,
  hasResult,
  mode,
  onModeChange,
  batchInput,
  onBatchInputChange,
  onBatchStart,
  onBatchStop,
  batchItems,
  isBatchRunning,
  batchStats,
}: SearchBarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<backend.SearchResponse | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [lastSearchedQuery, setLastSearchedQuery] = useState("");
  const [activeTab, setActiveTab] = useState<ResultTab>("tracks");
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [hasMore, setHasMore] = useState<Record<ResultTab, boolean>>({
    tracks: false,
    albums: false,
    artists: false,
    playlists: false,
  });
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isUrlMode = mode === "url";
  const isSearchMode = mode === "search";
  const isBatchMode = mode === "batch";

  // Load recent searches from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RECENT_SEARCHES_KEY);
      if (saved) {
        setRecentSearches(JSON.parse(saved));
      }
    } catch (error) {
      console.error("Failed to load recent searches:", error);
    }
  }, []);

  const saveRecentSearch = (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    
    setRecentSearches((prev) => {
      const filtered = prev.filter((s) => s.toLowerCase() !== trimmed.toLowerCase());
      const updated = [trimmed, ...filtered].slice(0, MAX_RECENT_SEARCHES);
      try {
        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
      } catch (error) {
        console.error("Failed to save recent searches:", error);
      }
      return updated;
    });
  };

  const removeRecentSearch = (query: string) => {
    setRecentSearches((prev) => {
      const updated = prev.filter((s) => s !== query);
      try {
        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
      } catch (error) {
        console.error("Failed to save recent searches:", error);
      }
      return updated;
    });
  };

  // Debounced search - only search if query changed
  useEffect(() => {
    if (!isSearchMode || !searchQuery.trim()) {
      return;
    }

    // Don't search again if query is the same
    if (searchQuery.trim() === lastSearchedQuery) {
      return;
    }

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await SearchSpotify({ query: searchQuery, limit: SEARCH_LIMIT });
        setSearchResults(results);
        setLastSearchedQuery(searchQuery.trim());
        saveRecentSearch(searchQuery.trim());
        
        // Check if there might be more results
        setHasMore({
          tracks: results.tracks.length === SEARCH_LIMIT,
          albums: results.albums.length === SEARCH_LIMIT,
          artists: results.artists.length === SEARCH_LIMIT,
          playlists: results.playlists.length === SEARCH_LIMIT,
        });
        
        // Auto-select first tab with results
        if (results.tracks.length > 0) setActiveTab("tracks");
        else if (results.albums.length > 0) setActiveTab("albums");
        else if (results.artists.length > 0) setActiveTab("artists");
        else if (results.playlists.length > 0) setActiveTab("playlists");
      } catch (error) {
        console.error("Search failed:", error);
        setSearchResults(null);
      } finally {
        setIsSearching(false);
      }
    }, 400);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, isSearchMode, lastSearchedQuery]);

  const handleLoadMore = async () => {
    if (!searchResults || !lastSearchedQuery || isLoadingMore) return;

    const typeMap: Record<ResultTab, string> = {
      tracks: "track",
      albums: "album",
      artists: "artist",
      playlists: "playlist",
    };

    const currentCount = getTabCount(activeTab);
    
    setIsLoadingMore(true);
    try {
      const moreResults = await SearchSpotifyByType({
        query: lastSearchedQuery,
        search_type: typeMap[activeTab],
        limit: SEARCH_LIMIT,
        offset: currentCount,
      });

      if (moreResults.length > 0) {
        setSearchResults((prev) => {
          if (!prev) return prev;
          // Create new SearchResponse with updated array for the active tab
          const updated = new backend.SearchResponse({
            tracks: activeTab === "tracks" ? [...prev.tracks, ...moreResults] : prev.tracks,
            albums: activeTab === "albums" ? [...prev.albums, ...moreResults] : prev.albums,
            artists: activeTab === "artists" ? [...prev.artists, ...moreResults] : prev.artists,
            playlists: activeTab === "playlists" ? [...prev.playlists, ...moreResults] : prev.playlists,
          });
          return updated;
        });
      }

      // Update hasMore for this tab
      setHasMore((prev) => ({
        ...prev,
        [activeTab]: moreResults.length === SEARCH_LIMIT,
      }));
    } catch (error) {
      console.error("Load more failed:", error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleResultClick = (externalUrl: string) => {
    onModeChange("url");
    onFetchUrl(externalUrl);
  };

  const formatDuration = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const hasAnyResults = searchResults && (
    searchResults.tracks.length > 0 ||
    searchResults.albums.length > 0 ||
    searchResults.artists.length > 0 ||
    searchResults.playlists.length > 0
  );

  const getTabCount = (tab: ResultTab): number => {
    if (!searchResults) return 0;
    switch (tab) {
      case "tracks": return searchResults.tracks.length;
      case "albums": return searchResults.albums.length;
      case "artists": return searchResults.artists.length;
      case "playlists": return searchResults.playlists.length;
    }
  };

  const tabs: { key: ResultTab; label: string }[] = [
    { key: "tracks", label: "Tracks" },
    { key: "albums", label: "Albums" },
    { key: "artists", label: "Artists" },
    { key: "playlists", label: "Playlists" },
  ];
  const batchStatusMeta: Record<BatchJobStatus, { label: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
    pending: { label: "Pending", color: "text-muted-foreground", icon: Clock },
    processing: { label: "Processing", color: "text-primary", icon: Loader2 },
    success: { label: "Done", color: "text-emerald-500", icon: CheckCircle2 },
    error: { label: "Error", color: "text-destructive", icon: AlertTriangle },
  };
  const totalSuccess = batchItems.filter((item) => item.status === "success").length;
  const totalErrors = batchItems.filter((item) => item.status === "error").length;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          {/* Mode Toggle */}
          <div className="flex items-center bg-muted rounded-md p-1">
            <button
              type="button"
              onClick={() => onModeChange("url")}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded text-sm font-medium transition-colors cursor-pointer",
                isUrlMode
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Link className="h-3.5 w-3.5" />
              URL
            </button>
            <button
              type="button"
              onClick={() => onModeChange("search")}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded text-sm font-medium transition-colors cursor-pointer",
                isSearchMode
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Search className="h-3.5 w-3.5" />
              Search
            </button>
            <button
              type="button"
              onClick={() => onModeChange("batch")}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded text-sm font-medium transition-colors cursor-pointer",
                isBatchMode
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <ListChecks className="h-3.5 w-3.5" />
              Batch
            </button>
          </div>
          
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-4 w-4 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="right">
              {isUrlMode && (
                <>
                  <p>Supports track, album, playlist, and artist URLs</p>
                  <p className="mt-1">Note: Playlist must be public (not private)</p>
                </>
              )}
              {isSearchMode && <p>Search for tracks, albums, artists, or playlists</p>}
              {isBatchMode && (
                <>
                  <p>Paste multiple Spotify album links, one per line.</p>
                  <p className="mt-1">Each entry fetches metadata, downloads tracks, then covers.</p>
                </>
              )}
            </TooltipContent>
          </Tooltip>
        </div>

        {(isUrlMode || isSearchMode) && (
          <div className="flex gap-2">
            <div className="relative flex-1">
              {isUrlMode ? (
                <>
                  <InputWithContext
                    id="spotify-url"
                    placeholder="https://open.spotify.com/..."
                    value={url}
                    onChange={(e) => onUrlChange(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && onFetch()}
                    className="pr-8"
                  />
                  {url && (
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      onClick={() => onUrlChange("")}
                    >
                      <XCircle className="h-4 w-4" />
                    </button>
                  )}
                </>
              ) : (
                <>
                  <InputWithContext
                    id="spotify-search"
                    placeholder="Search tracks, albums, artists..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pr-8"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      onClick={() => {
                        setSearchQuery("");
                        setSearchResults(null);
                        setLastSearchedQuery("");
                      }}
                    >
                      <XCircle className="h-4 w-4" />
                    </button>
                  )}
                </>
              )}
            </div>

            {isUrlMode && (
              <Button onClick={onFetch} disabled={loading}>
                {loading ? (
                  <>
                    <Spinner />
                    Fetching...
                  </>
                ) : (
                  <>
                    <CloudDownload className="h-4 w-4" />
                    Fetch
                  </>
                )}
              </Button>
            )}
          </div>
        )}
      </div>

      {isUrlMode && !hasResult && (
        <FetchHistory
          history={history}
          onSelect={onHistorySelect}
          onRemove={onHistoryRemove}
        />
      )}

      {isBatchMode && (
        <div className="space-y-4">
          <div>
            <p className="text-sm text-muted-foreground mb-2">
              Paste one Spotify album URL per line. Blank lines are ignored.
            </p>
            <textarea
              className="w-full min-h-[220px] rounded-md border bg-background/70 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="https://open.spotify.com/album/..."
              value={batchInput}
              onChange={(e) => onBatchInputChange(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={onBatchStart}
              disabled={isBatchRunning || !batchInput.trim()}
            >
              {isBatchRunning ? (
                <>
                  <Spinner />
                  Processing...
                </>
              ) : (
                <>
                  <ListChecks className="h-4 w-4" />
                  Start Batch
                </>
              )}
            </Button>
            {isBatchRunning && (
              <Button variant="outline" onClick={onBatchStop}>
                <X className="h-4 w-4" />
                Stop Batch
              </Button>
            )}
            <div className="text-sm text-muted-foreground ml-auto flex flex-wrap gap-4">
              {batchStats.total > 0 && (
                <>
                  <span>
                    {batchStats.processed}/{batchStats.total} processed
                  </span>
                  {batchStats.current && <span>Current: {batchStats.current}</span>}
                </>
              )}
              {totalSuccess > 0 && <span>{totalSuccess} done</span>}
              {totalErrors > 0 && <span>{totalErrors} failed</span>}
            </div>
          </div>
          <div className="border rounded-md divide-y max-h-72 overflow-y-auto">
            {batchItems.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Batch queue is empty. Paste links above to get started.
              </p>
            ) : (
              batchItems.map((item) => {
                const meta = batchStatusMeta[item.status];
                const StatusIcon = meta.icon;
                return (
                  <div
                    key={item.id}
                    className="flex items-start justify-between gap-3 px-3 py-3"
                  >
                    <div>
                      <p className="font-medium">
                        {item.title || `Entry ${item.id + 1}`}
                      </p>
                      <p className="text-xs text-muted-foreground break-all">
                        {item.url}
                      </p>
                      {item.message && (
                        <p className="text-xs text-muted-foreground mt-1">{item.message}</p>
                      )}
                    </div>
                    <div className={cn("flex items-center gap-1 text-sm", meta.color)}>
                      <StatusIcon
                        className={cn(
                          "h-4 w-4",
                          item.status === "processing" ? "animate-spin" : ""
                        )}
                      />
                      {meta.label}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Search Results with Tabs */}
      {isSearchMode && (
        <div className="space-y-4">
          {/* Recent Searches - show when no query or no results yet */}
          {!searchQuery && !searchResults && recentSearches.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Recent Searches</p>
              <div className="flex flex-wrap gap-2">
                {recentSearches.map((query) => (
                  <div
                    key={query}
                    className="group relative flex items-center px-3 py-1.5 bg-muted hover:bg-accent rounded-full text-sm cursor-pointer transition-colors"
                    onClick={() => setSearchQuery(query)}
                  >
                    <span>{query}</span>
                    <button
                      type="button"
                      className="absolute -top-1.5 -right-1.5 z-10 w-5 h-5 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all cursor-pointer shadow-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeRecentSearch(query);
                      }}
                    >
                      <X className="h-3 w-3 text-red-900" strokeWidth={3} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isSearching && (
            <div className="flex items-center justify-center py-8">
              <Spinner />
              <span className="ml-2 text-muted-foreground">Searching...</span>
            </div>
          )}

          {!isSearching && searchQuery && !hasAnyResults && (
            <div className="text-center py-8 text-muted-foreground">
              No results found for "{searchQuery}"
            </div>
          )}

          {!isSearching && hasAnyResults && (
            <>
              {/* Tabs */}
              <div className="flex gap-1 border-b">
                {tabs.map((tab) => {
                  const count = getTabCount(tab.key);
                  if (count === 0) return null;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActiveTab(tab.key)}
                      className={cn(
                        "px-4 py-2 text-sm font-medium transition-colors cursor-pointer border-b-2 -mb-px",
                        activeTab === tab.key
                          ? "border-primary text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {tab.label} ({count})
                    </button>
                  );
                })}
              </div>

              {/* Tab Content */}
              <div className="grid gap-2">
                {/* Tracks */}
                {activeTab === "tracks" && searchResults?.tracks.map((track) => (
                  <button
                    key={track.id}
                    type="button"
                    className="flex items-center gap-3 p-3 rounded-lg bg-card hover:bg-accent border cursor-pointer text-left transition-colors"
                    onClick={() => handleResultClick(track.external_urls)}
                  >
                    {track.images ? (
                      <img src={track.images} alt="" className="w-12 h-12 rounded object-cover shrink-0" />
                    ) : (
                      <div className="w-12 h-12 rounded bg-muted shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{track.name}</p>
                      <p className="text-sm text-muted-foreground truncate">{track.artists}</p>
                    </div>
                    <span className="text-sm text-muted-foreground shrink-0">
                      {formatDuration(track.duration_ms || 0)}
                    </span>
                  </button>
                ))}

                {/* Albums */}
                {activeTab === "albums" && searchResults?.albums.map((album) => (
                  <button
                    key={album.id}
                    type="button"
                    className="flex items-center gap-3 p-3 rounded-lg bg-card hover:bg-accent border cursor-pointer text-left transition-colors"
                    onClick={() => handleResultClick(album.external_urls)}
                  >
                    {album.images ? (
                      <img src={album.images} alt="" className="w-12 h-12 rounded object-cover shrink-0" />
                    ) : (
                      <div className="w-12 h-12 rounded bg-muted shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{album.name}</p>
                      <p className="text-sm text-muted-foreground truncate">{album.artists}</p>
                    </div>
                    <span className="text-sm text-muted-foreground shrink-0">
                      {album.total_tracks} tracks
                    </span>
                  </button>
                ))}

                {/* Artists */}
                {activeTab === "artists" && searchResults?.artists.map((artist) => (
                  <button
                    key={artist.id}
                    type="button"
                    className="flex items-center gap-3 p-3 rounded-lg bg-card hover:bg-accent border cursor-pointer text-left transition-colors"
                    onClick={() => handleResultClick(artist.external_urls)}
                  >
                    {artist.images ? (
                      <img src={artist.images} alt="" className="w-12 h-12 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-muted shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{artist.name}</p>
                      <p className="text-sm text-muted-foreground">Artist</p>
                    </div>
                  </button>
                ))}

                {/* Playlists */}
                {activeTab === "playlists" && searchResults?.playlists.map((playlist) => (
                  <button
                    key={playlist.id}
                    type="button"
                    className="flex items-center gap-3 p-3 rounded-lg bg-card hover:bg-accent border cursor-pointer text-left transition-colors"
                    onClick={() => handleResultClick(playlist.external_urls)}
                  >
                    {playlist.images ? (
                      <img src={playlist.images} alt="" className="w-12 h-12 rounded object-cover shrink-0" />
                    ) : (
                      <div className="w-12 h-12 rounded bg-muted shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{playlist.name}</p>
                      <p className="text-sm text-muted-foreground truncate">
                        {playlist.owner} • {playlist.total_tracks} tracks
                      </p>
                    </div>
                  </button>
                ))}
              </div>

              {/* Load More Button */}
              {hasMore[activeTab] && (
                <div className="flex justify-center pt-2">
                  <Button
                    variant="outline"
                    onClick={handleLoadMore}
                    disabled={isLoadingMore}
                  >
                    {isLoadingMore ? (
                      <>
                        <Spinner />
                        Loading...
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-4 w-4" />
                        Load More
                      </>
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
