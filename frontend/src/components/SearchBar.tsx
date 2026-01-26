import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { InputWithContext } from "@/components/ui/input-with-context";
import { CloudDownload, XCircle, Link, Search, X, ChevronDown } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger, } from "@/components/ui/tooltip";
import { FetchHistory } from "@/components/FetchHistory";
import type { HistoryItem } from "@/components/FetchHistory";
import { SearchSpotify, SearchSpotifyByType } from "../../wailsjs/go/main/App";
import { backend } from "../../wailsjs/go/models";
import { cn } from "@/lib/utils";
import { useTypingEffect } from "@/hooks/useTypingEffect";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
const FETCH_PLACEHOLDERS = [
    "https://open.spotify.com/track/...",
    "https://open.spotify.com/album/...",
    "https://open.spotify.com/playlist/...",
    "https://open.spotify.com/artist/..."
];
const SEARCH_PLACEHOLDERS = [
    "Golden",
    "Taylor Swift",
    "The Weeknd",
    "Starboy",
    "Joji",
    "Die For You"
];
const REGIONS = ["AD", "AE", "AG", "AL", "AM", "AO", "AR", "AT", "AU", "AZ", "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BN", "BO", "BR", "BS", "BT", "BW", "BZ", "CA", "CD", "CG", "CH", "CI", "CL", "CM", "CO", "CR", "CV", "CW", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ", "EC", "EE", "EG", "ES", "ET", "FI", "FJ", "FM", "FR", "GA", "GB", "GD", "GE", "GH", "GM", "GN", "GQ", "GR", "GT", "GW", "GY", "HK", "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IN", "IQ", "IS", "IT", "JM", "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN", "KR", "KW", "KZ", "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MG", "MH", "MK", "ML", "MN", "MO", "MR", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA", "NE", "NG", "NI", "NL", "NO", "NP", "NR", "NZ", "OM", "PA", "PE", "PG", "PH", "PK", "PL", "PS", "PT", "PW", "PY", "QA", "RO", "RS", "RW", "SA", "SB", "SC", "SE", "SG", "SI", "SK", "SL", "SM", "SN", "SR", "ST", "SV", "SZ", "TD", "TG", "TH", "TJ", "TL", "TN", "TO", "TR", "TT", "TV", "TW", "TZ", "UA", "UG", "US", "UY", "UZ", "VC", "VE", "VN", "VU", "WS", "XK", "ZA", "ZM", "ZW"];
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const getRegionName = (code: string) => {
    try {
        if (code === "XK")
            return "Kosovo";
        return regionNames.of(code) || code;
    }
    catch (e) {
        return code;
    }
};
type ResultTab = "tracks" | "albums" | "artists" | "playlists";
const RECENT_SEARCHES_KEY = "spotiflac_recent_searches";
const MAX_RECENT_SEARCHES = 8;
const SEARCH_LIMIT = 50;
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
    searchMode: boolean;
    onSearchModeChange: (isSearch: boolean) => void;
    region: string;
    onRegionChange: (region: string) => void;
}
export function SearchBar({ url, loading, onUrlChange, onFetch, onFetchUrl, history, onHistorySelect, onHistoryRemove, hasResult, searchMode, onSearchModeChange, region, onRegionChange }: SearchBarProps) {
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
    const placeholders = searchMode ? SEARCH_PLACEHOLDERS : FETCH_PLACEHOLDERS;
    const placeholderText = useTypingEffect(placeholders);
    useEffect(() => {
        try {
            const saved = localStorage.getItem(RECENT_SEARCHES_KEY);
            if (saved) {
                setRecentSearches(JSON.parse(saved));
            }
        }
        catch (error) {
            console.error("Failed to load recent searches:", error);
        }
    }, []);
    const saveRecentSearch = (query: string) => {
        const trimmed = query.trim();
        if (!trimmed)
            return;
        setRecentSearches((prev) => {
            const filtered = prev.filter((s) => s.toLowerCase() !== trimmed.toLowerCase());
            const updated = [trimmed, ...filtered].slice(0, MAX_RECENT_SEARCHES);
            try {
                localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
            }
            catch (error) {
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
            }
            catch (error) {
                console.error("Failed to save recent searches:", error);
            }
            return updated;
        });
    };
    useEffect(() => {
        if (!searchMode || !searchQuery.trim()) {
            return;
        }
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
                setHasMore({
                    tracks: results.tracks.length === SEARCH_LIMIT,
                    albums: results.albums.length === SEARCH_LIMIT,
                    artists: results.artists.length === SEARCH_LIMIT,
                    playlists: results.playlists.length === SEARCH_LIMIT,
                });
                if (results.tracks.length > 0)
                    setActiveTab("tracks");
                else if (results.albums.length > 0)
                    setActiveTab("albums");
                else if (results.artists.length > 0)
                    setActiveTab("artists");
                else if (results.playlists.length > 0)
                    setActiveTab("playlists");
            }
            catch (error) {
                console.error("Search failed:", error);
                setSearchResults(null);
            }
            finally {
                setIsSearching(false);
            }
        }, 400);
        return () => {
            if (searchTimeoutRef.current) {
                clearTimeout(searchTimeoutRef.current);
            }
        };
    }, [searchQuery, searchMode, lastSearchedQuery]);
    const handleLoadMore = async () => {
        if (!searchResults || !lastSearchedQuery || isLoadingMore)
            return;
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
                    if (!prev)
                        return prev;
                    const updated = new backend.SearchResponse({
                        tracks: activeTab === "tracks" ? [...prev.tracks, ...moreResults] : prev.tracks,
                        albums: activeTab === "albums" ? [...prev.albums, ...moreResults] : prev.albums,
                        artists: activeTab === "artists" ? [...prev.artists, ...moreResults] : prev.artists,
                        playlists: activeTab === "playlists" ? [...prev.playlists, ...moreResults] : prev.playlists,
                    });
                    return updated;
                });
            }
            setHasMore((prev) => ({
                ...prev,
                [activeTab]: moreResults.length === SEARCH_LIMIT,
            }));
        }
        catch (error) {
            console.error("Load more failed:", error);
        }
        finally {
            setIsLoadingMore(false);
        }
    };
    const handleResultClick = (externalUrl: string) => {
        onSearchModeChange(false);
        onFetchUrl(externalUrl);
    };
    const formatDuration = (ms: number) => {
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        return `${minutes}:${seconds.toString().padStart(2, "0")}`;
    };
    const hasAnyResults = searchResults && (searchResults.tracks.length > 0 ||
        searchResults.albums.length > 0 ||
        searchResults.artists.length > 0 ||
        searchResults.playlists.length > 0);
    const getTabCount = (tab: ResultTab): number => {
        if (!searchResults)
            return 0;
        switch (tab) {
            case "tracks": return searchResults.tracks.length;
            case "albums": return searchResults.albums.length;
            case "artists": return searchResults.artists.length;
            case "playlists": return searchResults.playlists.length;
        }
    };
    const tabs: {
        key: ResultTab;
        label: string;
    }[] = [
        { key: "tracks", label: "Tracks" },
        { key: "albums", label: "Albums" },
        { key: "artists", label: "Artists" },
        { key: "playlists", label: "Playlists" },
    ];
    return (<div className="space-y-4">
            <div className="flex gap-2">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="outline" size="icon" className="shrink-0" onClick={() => onSearchModeChange(!searchMode)}>
                            {searchMode ? <Link className="h-4 w-4"/> : <Search className="h-4 w-4"/>}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>{searchMode ? "Fetch Mode" : "Search Mode"}</p>
                    </TooltipContent>
                </Tooltip>

                <div className="relative flex-1">
                    {!searchMode ? (<>
                            <InputWithContext id="spotify-url" placeholder={placeholderText} value={url} onChange={(e) => onUrlChange(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onFetch()} className="pr-8"/>
                            {url && (<button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer" onClick={() => onUrlChange("")}>
                                    <XCircle className="h-4 w-4"/>
                                </button>)}
                        </>) : (<>
                            <InputWithContext id="spotify-search" placeholder={placeholderText} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pr-8"/>
                            {searchQuery && (<button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer" onClick={() => {
                    setSearchQuery("");
                    setSearchResults(null);
                    setLastSearchedQuery("");
                }}>
                                    <XCircle className="h-4 w-4"/>
                                </button>)}
                        </>)}
                </div>

                {!searchMode && (<>
                        <Select value={region} onValueChange={onRegionChange}>
                            <SelectTrigger className="w-[70px] shrink-0">
                                <SelectValue placeholder="Region"/>
                            </SelectTrigger>
                            <SelectContent className="max-h-[300px]">
                                {REGIONS.map((r) => (<SelectItem key={r} value={r} textValue={r}>
                                        {r} <span className="text-muted-foreground">({getRegionName(r)})</span>
                                    </SelectItem>))}
                            </SelectContent>
                        </Select>
                        <Button onClick={onFetch} disabled={loading}>
                            {loading ? (<>
                                    <Spinner />
                                    Fetching...
                                </>) : (<>
                                    <CloudDownload className="h-4 w-4"/>
                                    Fetch
                                </>)}
                        </Button>
                    </>)}
            </div>

            {!searchMode && !hasResult && (<FetchHistory history={history} onSelect={onHistorySelect} onRemove={onHistoryRemove}/>)}

            {searchMode && (<div className="space-y-4">
                    {!searchQuery && !searchResults && recentSearches.length > 0 && (<div className="space-y-2">
                            <p className="text-sm text-muted-foreground">Recent Searches</p>
                            <div className="flex flex-wrap gap-2">
                                {recentSearches.map((query) => (<div key={query} className="group relative flex items-center px-3 py-1.5 bg-muted hover:bg-accent rounded-full text-sm cursor-pointer transition-colors" onClick={() => setSearchQuery(query)}>
                                        <span>{query}</span>
                                        <button type="button" className="absolute -top-1.5 -right-1.5 z-10 w-5 h-5 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all cursor-pointer shadow-sm" onClick={(e) => {
                        e.stopPropagation();
                        removeRecentSearch(query);
                    }}>
                                            <X className="h-3 w-3 text-red-900" strokeWidth={3}/>
                                        </button>
                                    </div>))}
                            </div>
                        </div>)}

                    {isSearching && (<div className="flex items-center justify-center py-8">
                            <Spinner />
                            <span className="ml-2 text-muted-foreground">Searching...</span>
                        </div>)}

                    {!isSearching && searchQuery && !hasAnyResults && (<div className="text-center py-8 text-muted-foreground">
                            No results found for "{searchQuery}"
                        </div>)}

                    {!isSearching && hasAnyResults && (<>
                            <div className="flex gap-1 border-b">
                                {tabs.map((tab) => {
                    const count = getTabCount(tab.key);
                    if (count === 0)
                        return null;
                    return (<button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)} className={cn("px-4 py-2 text-sm font-medium transition-colors cursor-pointer border-b-2 -mb-px", activeTab === tab.key
                            ? "border-primary text-foreground"
                            : "border-transparent text-muted-foreground hover:text-foreground")}>
                                            {tab.label} ({count})
                                        </button>);
                })}
                            </div>

                            <div className="grid gap-2">
                                {activeTab === "tracks" &&
                    searchResults?.tracks.map((track) => (<button key={track.id} type="button" className="flex items-center gap-3 p-3 rounded-lg bg-card hover:bg-accent border cursor-pointer text-left transition-colors" onClick={() => handleResultClick(track.external_urls)}>
                                            {track.images ? (<img src={track.images} alt="" className="w-12 h-12 rounded object-cover shrink-0"/>) : (<div className="w-12 h-12 rounded bg-muted shrink-0"/>)}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-1.5 min-w-0">
                                                    <p className="font-medium truncate">{track.name}</p>
                                                    {track.is_explicit && (<span className="flex items-center justify-center min-w-[16px] h-[16px] rounded bg-red-600 text-[10px] font-bold text-white leading-none shrink-0" title="Explicit">
                                                            E
                                                        </span>)}
                                                </div>
                                                <p className="text-sm text-muted-foreground truncate">
                                                    {track.artists}
                                                </p>
                                            </div>
                                            <span className="text-sm text-muted-foreground shrink-0">
                                                {formatDuration(track.duration_ms || 0)}
                                            </span>
                                        </button>))}

                                {activeTab === "albums" &&
                    searchResults?.albums.map((album) => (<button key={album.id} type="button" className="flex items-center gap-3 p-3 rounded-lg bg-card hover:bg-accent border cursor-pointer text-left transition-colors" onClick={() => handleResultClick(album.external_urls)}>
                                            {album.images ? (<img src={album.images} alt="" className="w-12 h-12 rounded object-cover shrink-0"/>) : (<div className="w-12 h-12 rounded bg-muted shrink-0"/>)}
                                            <div className="flex-1 min-w-0">
                                                <p className="font-medium truncate">{album.name}</p>
                                                <p className="text-sm text-muted-foreground truncate">
                                                    {album.artists}
                                                </p>
                                            </div>
                                            <span className="text-sm text-muted-foreground shrink-0">
                                                {album.release_date || ""}
                                            </span>
                                        </button>))}

                                {activeTab === "artists" &&
                    searchResults?.artists.map((artist) => (<button key={artist.id} type="button" className="flex items-center gap-3 p-3 rounded-lg bg-card hover:bg-accent border cursor-pointer text-left transition-colors" onClick={() => handleResultClick(artist.external_urls)}>
                                            {artist.images ? (<img src={artist.images} alt="" className="w-12 h-12 rounded-full object-cover shrink-0"/>) : (<div className="w-12 h-12 rounded-full bg-muted shrink-0"/>)}
                                            <div className="flex-1 min-w-0">
                                                <p className="font-medium truncate">{artist.name}</p>
                                                <p className="text-sm text-muted-foreground">Artist</p>
                                            </div>
                                        </button>))}

                                {activeTab === "playlists" &&
                    searchResults?.playlists.map((playlist) => (<button key={playlist.id} type="button" className="flex items-center gap-3 p-3 rounded-lg bg-card hover:bg-accent border cursor-pointer text-left transition-colors" onClick={() => handleResultClick(playlist.external_urls)}>
                                            {playlist.images ? (<img src={playlist.images} alt="" className="w-12 h-12 rounded object-cover shrink-0"/>) : (<div className="w-12 h-12 rounded bg-muted shrink-0"/>)}
                                            <div className="flex-1 min-w-0">
                                                <p className="font-medium truncate">{playlist.name}</p>
                                                <p className="text-sm text-muted-foreground truncate">
                                                    {playlist.owner || ""}
                                                </p>
                                            </div>
                                        </button>))}
                            </div>

                            {hasMore[activeTab] && (<div className="flex justify-center pt-2">
                                    <Button variant="outline" onClick={handleLoadMore} disabled={isLoadingMore}>
                                        {isLoadingMore ? (<>
                                                <Spinner />
                                                Loading...
                                            </>) : (<>
                                                <ChevronDown className="h-4 w-4"/>
                                                Load More
                                            </>)}
                                    </Button>
                                </div>)}
                        </>)}
                </div>)}
        </div>);
}
