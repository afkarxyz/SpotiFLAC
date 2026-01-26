import { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Trash2, ExternalLink, Search, ArrowUpDown, History, Play, Pause, Database, CloudUpload, Music2, Disc3, ListMusic, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { GetDownloadHistory, ClearDownloadHistory, GetPreviewURL, GetFetchHistory, DeleteDownloadHistoryItem, DeleteFetchHistoryItem, ClearFetchHistoryByType } from "../../wailsjs/go/main/App";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { openExternal } from "@/lib/utils";
const formatDate = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};
interface DownloadHistoryItem {
    id: string;
    spotify_id: string;
    title: string;
    artists: string;
    album: string;
    duration_str: string;
    cover_url: string;
    quality: string;
    format: string;
    path: string;
    timestamp: number;
}
interface FetchHistoryItem {
    id: string;
    url: string;
    type: string;
    name: string;
    info: string;
    image: string;
    data: string;
    timestamp: number;
}
interface HistoryPageProps {
    onHistorySelect?: (cachedData: string) => void;
}
export function HistoryPage({ onHistorySelect }: HistoryPageProps) {
    const [activeTab, setActiveTab] = useState("downloads");
    const [downloadHistory, setDownloadHistory] = useState<DownloadHistoryItem[]>([]);
    const [filteredDownloadHistory, setFilteredDownloadHistory] = useState<DownloadHistoryItem[]>([]);
    const [showClearDownloadConfirm, setShowClearDownloadConfirm] = useState(false);
    const [downloadSearchQuery, setDownloadSearchQuery] = useState("");
    const [downloadSortBy, setDownloadSortBy] = useState("default");
    const [downloadCurrentPage, setDownloadCurrentPage] = useState(1);
    const [playingPreviewId, setPlayingPreviewId] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [fetchHistory, setFetchHistory] = useState<FetchHistoryItem[]>([]);
    const [filteredFetchHistory, setFilteredFetchHistory] = useState<FetchHistoryItem[]>([]);
    const [activeFetchTab, setActiveFetchTab] = useState("track");
    const [showClearFetchConfirm, setShowClearFetchConfirm] = useState(false);
    const [fetchSearchQuery, setFetchSearchQuery] = useState("");
    const [fetchCurrentPage, setFetchCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 50;
    const fetchDownloadHistory = async () => {
        try {
            const items = await GetDownloadHistory();
            setDownloadHistory(items || []);
        }
        catch (err) {
            console.error("Failed to fetch download history:", err);
        }
    };
    const fetchFetchHistory = async () => {
        try {
            const items = await GetFetchHistory();
            setFetchHistory(items || []);
        }
        catch (err) {
            console.error("Failed to fetch fetch history:", err);
        }
    };
    useEffect(() => {
        if (activeTab === "downloads") {
            fetchDownloadHistory();
            const interval = setInterval(fetchDownloadHistory, 5000);
            return () => clearInterval(interval);
        }
        else {
            fetchFetchHistory();
            const interval = setInterval(fetchFetchHistory, 5000);
            return () => clearInterval(interval);
        }
    }, [activeTab]);
    useEffect(() => {
        return () => {
            if (audioRef.current) {
                audioRef.current.pause();
            }
        };
    }, []);
    useEffect(() => {
        let result = [...downloadHistory];
        if (downloadSearchQuery) {
            const query = downloadSearchQuery.toLowerCase();
            result = result.filter(item => item.title.toLowerCase().includes(query) ||
                item.artists.toLowerCase().includes(query) ||
                item.album.toLowerCase().includes(query));
        }
        const parseDuration = (str: string) => {
            const parts = str.split(':').map(Number);
            if (parts.length === 2)
                return parts[0] * 60 + parts[1];
            if (parts.length === 3)
                return parts[0] * 3600 + parts[1] * 60 + parts[2];
            return 0;
        };
        result.sort((a, b) => {
            switch (downloadSortBy) {
                case "default":
                case "date_desc": return b.timestamp - a.timestamp;
                case "date_asc": return a.timestamp - b.timestamp;
                case "title_asc": return a.title.localeCompare(b.title);
                case "title_desc": return b.title.localeCompare(a.title);
                case "artist_asc": return a.artists.localeCompare(b.artists);
                case "artist_desc": return b.artists.localeCompare(a.artists);
                case "duration_asc": return parseDuration(a.duration_str) - parseDuration(b.duration_str);
                case "duration_desc": return parseDuration(b.duration_str) - parseDuration(a.duration_str);
                default: return 0;
            }
        });
        setFilteredDownloadHistory(result);
        setDownloadCurrentPage(1);
    }, [downloadHistory, downloadSearchQuery, downloadSortBy]);
    useEffect(() => {
        let result = [...fetchHistory];
        if (activeFetchTab !== "all") {
            result = result.filter(item => item.type.toLowerCase() === activeFetchTab.toLowerCase());
        }
        if (fetchSearchQuery) {
            const query = fetchSearchQuery.toLowerCase();
            result = result.filter(item => item.name.toLowerCase().includes(query) ||
                item.info.toLowerCase().includes(query));
        }
        result.sort((a, b) => b.timestamp - a.timestamp);
        setFilteredFetchHistory(result);
        setFetchCurrentPage(1);
    }, [fetchHistory, fetchSearchQuery, activeFetchTab]);
    const handlePreview = async (id: string, spotifyId: string) => {
        if (playingPreviewId === id) {
            audioRef.current?.pause();
            setPlayingPreviewId(null);
            return;
        }
        if (audioRef.current) {
            audioRef.current.pause();
        }
        try {
            const url = await GetPreviewURL(spotifyId);
            if (url) {
                const audio = new Audio(url);
                audioRef.current = audio;
                audio.volume = 0.5;
                audio.onended = () => setPlayingPreviewId(null);
                audio.play();
                setPlayingPreviewId(id);
            }
        }
        catch (e) {
            console.error("Failed to play preview:", e);
        }
    };
    const handleClearDownloadHistory = async () => {
        await ClearDownloadHistory();
        fetchDownloadHistory();
        setShowClearDownloadConfirm(false);
    };
    const handleDeleteDownloadItem = async (id: string) => {
        await DeleteDownloadHistoryItem(id);
        setDownloadHistory(prev => prev.filter(item => item.id !== id));
    };
    const handleClearFetchHistory = async () => {
        await ClearFetchHistoryByType(activeFetchTab);
        fetchFetchHistory();
        setShowClearFetchConfirm(false);
    };
    const handleDeleteFetchItem = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        await DeleteFetchHistoryItem(id);
        setFetchHistory(prev => prev.filter(item => item.id !== id));
    };
    const getPaginationPages = (current: number, total: number): (number | 'ellipsis')[] => {
        if (total <= 10)
            return Array.from({ length: total }, (_, i) => i + 1);
        const pages: (number | 'ellipsis')[] = [];
        pages.push(1);
        if (current <= 7) {
            for (let i = 2; i <= 10; i++)
                pages.push(i);
            pages.push('ellipsis');
            pages.push(total);
        }
        else if (current >= total - 7) {
            pages.push('ellipsis');
            for (let i = total - 9; i <= total; i++)
                pages.push(i);
        }
        else {
            pages.push('ellipsis');
            pages.push(current - 1);
            pages.push(current);
            pages.push(current + 1);
            pages.push('ellipsis');
            pages.push(total);
        }
        return pages;
    };
    const renderDownloadHistory = () => {
        const totalPages = Math.ceil(filteredDownloadHistory.length / ITEMS_PER_PAGE);
        const startIndex = (downloadCurrentPage - 1) * ITEMS_PER_PAGE;
        const paginated = filteredDownloadHistory.slice(startIndex, startIndex + ITEMS_PER_PAGE);
        return (<div className="space-y-6">
                <div className="flex flex-col gap-4">
                     <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                             <h2 className="text-xl font-bold tracking-tight">Downloads</h2>
                             {downloadHistory.length > 0 && (<Badge variant="secondary" className="font-mono">
                                    {downloadHistory.length.toLocaleString('en-US')}
                                </Badge>)}
                        </div>
                        <Button variant="outline" size="sm" onClick={() => setShowClearDownloadConfirm(true)} disabled={downloadHistory.length === 0} className="cursor-pointer gap-2">
                             <Trash2 className="h-4 w-4"/> Clear All
                        </Button>
                    </div>

                     <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground"/>
                            <Input placeholder="Search downloads..." value={downloadSearchQuery} onChange={(e) => setDownloadSearchQuery(e.target.value)} className="pl-8 h-9"/>
                        </div>
                        <Select value={downloadSortBy} onValueChange={setDownloadSortBy}>
                            <SelectTrigger className="w-[180px] h-9">
                                <ArrowUpDown className="mr-2 h-4 w-4"/>
                                <SelectValue placeholder="Sort by"/>
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="default">Default</SelectItem>
                                <SelectItem value="date_desc">Date (Newest)</SelectItem>
                                <SelectItem value="date_asc">Date (Oldest)</SelectItem>
                                <SelectItem value="title_asc">Title (A-Z)</SelectItem>
                                <SelectItem value="title_desc">Title (Z-A)</SelectItem>
                                <SelectItem value="artist_asc">Artist (A-Z)</SelectItem>
                                <SelectItem value="artist_desc">Artist (Z-A)</SelectItem>
                                <SelectItem value="duration_asc">Duration (Short)</SelectItem>
                                <SelectItem value="duration_desc">Duration (Long)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                 <div className="rounded-md border overflow-hidden">
                    {paginated.length === 0 ? (<div className="flex flex-col items-center justify-center p-16 text-center text-muted-foreground gap-3">
                            <div className="rounded-full bg-muted/50 p-4 ring-8 ring-muted/20">
                                <History className="h-10 w-10 opacity-40"/>
                            </div>
                            <div className="space-y-1">
                                <p className="font-medium text-foreground/80">No download history</p>
                                <p className="text-sm">Your downloaded tracks will appear here.</p>
                            </div>
                        </div>) : (<table className="w-full table-fixed">
                             <thead>
                                <tr className="border-b bg-muted/50">
                                    <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground w-12 text-xs uppercase">#</th>
                                    <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground text-xs uppercase">Title</th>
                                    <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground hidden md:table-cell text-xs uppercase w-1/4">Album</th>
                                    <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground hidden lg:table-cell w-32 text-xs uppercase">Format</th>
                                    <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground hidden xl:table-cell w-16 text-xs uppercase text-nowrap">Dur</th>
                                    <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground hidden md:table-cell w-36 text-xs uppercase text-nowrap">Downloaded At</th>
                                    <th className="h-10 px-4 text-center align-middle font-medium text-muted-foreground w-32 text-xs uppercase text-nowrap">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paginated.map((item, index) => (<tr key={item.id} className="border-b transition-colors hover:bg-muted/50">
                                        <td className="p-3 align-middle text-sm text-muted-foreground text-left font-mono">
                                            {startIndex + index + 1}
                                        </td>
                                        <td className="p-3 align-middle min-w-0">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <img src={item.cover_url || "https://placehold.co/300?text=No+Cover"} alt={item.album} className="h-10 w-10 rounded shrink-0 bg-secondary object-cover" onError={(e) => { (e.target as HTMLImageElement).src = "https://placehold.co/300?text=No+Cover"; }}/>
                                                <div className="flex flex-col min-w-0 flex-1">
                                                    <span className="font-medium text-sm truncate">{item.title}</span>
                                                    <span className="text-xs text-muted-foreground truncate">{item.artists}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-3 align-middle text-sm text-muted-foreground hidden md:table-cell">
                                            <div className="truncate">{item.album}</div>
                                        </td>
                                         <td className="p-3 align-middle text-left hidden lg:table-cell">
                                            <div className="flex flex-col items-start gap-1">
                                                <span className="text-xs font-bold text-foreground">
                                                    {['HI_RES_LOSSLESS', 'LOSSLESS'].includes(item.format) ? 'FLAC' : item.format}
                                                </span>
                                                {item.quality && <span className="text-[11px] text-muted-foreground leading-none whitespace-nowrap">{item.quality}</span>}
                                            </div>
                                        </td>
                                        <td className="p-3 align-middle text-sm text-muted-foreground text-left hidden xl:table-cell font-mono">
                                            {item.duration_str}
                                        </td>
                                         <td className="p-3 align-middle text-xs text-muted-foreground hidden md:table-cell whitespace-nowrap">
                                            <div className="flex flex-col">
                                                <span>{formatDate(item.timestamp).split(' ')[0]}</span>
                                                <span className="text-[10px] text-muted-foreground">{formatDate(item.timestamp).split(' ')[1]}</span>
                                            </div>
                                        </td>
                                        <td className="p-3 align-middle text-center">
                                            <div className="flex items-center justify-center gap-1">
                                                <TooltipProvider>
                                                    <Tooltip delayDuration={0}>
                                                        <TooltipTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="h-8 w-8 cursor-pointer" onClick={() => handlePreview(item.id, item.spotify_id)} disabled={!item.spotify_id}>
                                                                {playingPreviewId === item.id ? <Pause className="h-4 w-4"/> : <Play className="h-4 w-4"/>}
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            <p>{playingPreviewId === item.id ? "Pause Preview" : "Play Preview"}</p>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>

                                                <TooltipProvider>
                                                    <Tooltip delayDuration={0}>
                                                        <TooltipTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="h-8 w-8 cursor-pointer" onClick={() => openExternal(`https://open.spotify.com/track/${item.spotify_id}`)}>
                                                                <ExternalLink className="h-4 w-4"/>
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            <p>Open in Spotify</p>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>

                                                <TooltipProvider>
                                                    <Tooltip delayDuration={0}>
                                                        <TooltipTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="h-8 w-8 cursor-pointer text-destructive hover:text-destructive" onClick={() => handleDeleteDownloadItem(item.id)}>
                                                                <Trash2 className="h-4 w-4"/>
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            <p>Delete</p>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            </div>
                                        </td>
                                    </tr>))}
                            </tbody>
                        </table>)}
                 </div>

                 {totalPages > 1 && (<Pagination>
                        <PaginationContent>
                            <PaginationItem>
                                <PaginationPrevious href="#" onClick={(e) => {
                    e.preventDefault();
                    if (downloadCurrentPage > 1)
                        setDownloadCurrentPage(downloadCurrentPage - 1);
                }} className={downloadCurrentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}/>
                            </PaginationItem>
                            
                            {getPaginationPages(downloadCurrentPage, totalPages).map((page, index) => (page === 'ellipsis' ? (<PaginationItem key={`ellipsis-${index}`}>
                                        <PaginationEllipsis />
                                    </PaginationItem>) : (<PaginationItem key={page}>
                                        <PaginationLink href="#" onClick={(e) => {
                        e.preventDefault();
                        setDownloadCurrentPage(page as number);
                    }} isActive={downloadCurrentPage === page} className="cursor-pointer">
                                            {page}
                                        </PaginationLink>
                                    </PaginationItem>)))}

                            <PaginationItem>
                                <PaginationNext href="#" onClick={(e) => {
                    e.preventDefault();
                    if (downloadCurrentPage < totalPages)
                        setDownloadCurrentPage(downloadCurrentPage + 1);
                }} className={downloadCurrentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}/>
                            </PaginationItem>
                        </PaginationContent>
                    </Pagination>)}
            </div>);
    };
    const renderFetchHistory = () => {
        const totalPages = Math.ceil(filteredFetchHistory.length / ITEMS_PER_PAGE);
        const startIndex = (fetchCurrentPage - 1) * ITEMS_PER_PAGE;
        const paginated = filteredFetchHistory.slice(startIndex, startIndex + ITEMS_PER_PAGE);
        return (<div className="space-y-6">
                <div className="flex flex-col gap-4">
                     <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                             <h2 className="text-xl font-bold tracking-tight">Fetches</h2>
                             {fetchHistory.length > 0 && (<Badge variant="secondary" className="font-mono">
                                    {fetchHistory.length.toLocaleString('en-US')}
                                </Badge>)}
                        </div>
                        <Button variant="outline" size="sm" onClick={() => setShowClearFetchConfirm(true)} disabled={fetchHistory.length === 0} className="cursor-pointer gap-2">
                             <Trash2 className="h-4 w-4"/> Clear All
                        </Button>
                    </div>

                    
                    <div className="flex flex-col gap-4">
                        <div className="flex gap-2 border-b shrink-0">
                            <Button variant={activeFetchTab === "track" ? "default" : "ghost"} size="sm" onClick={() => setActiveFetchTab("track")} className="rounded-b-none">
                                <Music2 className="h-4 w-4"/>
                                Tracks
                            </Button>
                            <Button variant={activeFetchTab === "album" ? "default" : "ghost"} size="sm" onClick={() => setActiveFetchTab("album")} className="rounded-b-none">
                                <Disc3 className="h-4 w-4"/>
                                Albums
                            </Button>
                            <Button variant={activeFetchTab === "playlist" ? "default" : "ghost"} size="sm" onClick={() => setActiveFetchTab("playlist")} className="rounded-b-none">
                                <ListMusic className="h-4 w-4"/>
                                Playlists
                            </Button>
                            <Button variant={activeFetchTab === "artist" ? "default" : "ghost"} size="sm" onClick={() => setActiveFetchTab("artist")} className="rounded-b-none">
                                <UserRound className="h-4 w-4"/>
                                Artists
                            </Button>
                        </div>

                        <div className="flex items-center gap-2">
                            <div className="relative flex-1">
                                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground"/>
                                <Input placeholder="Search fetch history..." value={fetchSearchQuery} onChange={(e) => setFetchSearchQuery(e.target.value)} className="pl-8 h-9"/>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="rounded-md border overflow-hidden">
                   {paginated.length === 0 ? (<div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground gap-3"> 
                            <Database className="h-10 w-10 opacity-40"/>
                            <div className="space-y-1">
                                <p className="font-medium text-foreground/80">No fetch history</p>
                                <p className="text-sm">Fetched metadata will appear here.</p>
                            </div>
                       </div>) : (<table className="w-full table-fixed">
                            <thead>
                                <tr className="border-b bg-muted/50">
                                    <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground w-12 text-xs uppercase">#</th>
                                    <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground text-xs uppercase w-1/3">
                                        {activeFetchTab === 'artist' ? 'Name' : 'Title'}
                                    </th>
                                    <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground hidden md:table-cell text-xs uppercase">Details</th>
                                    <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground hidden lg:table-cell w-40 text-xs uppercase text-nowrap">Fetched At</th>
                                    <th className="h-10 px-4 text-center align-middle font-medium text-muted-foreground w-32 text-xs uppercase text-nowrap">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paginated.map((item, index) => (<tr key={item.id} className="border-b transition-colors hover:bg-muted/50">
                                        <td className="p-3 align-middle text-sm text-muted-foreground text-left font-mono">
                                            {startIndex + index + 1}
                                        </td>
                                        <td className="p-3 align-middle min-w-0">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className="h-10 w-10 rounded shrink-0 bg-secondary overflow-hidden">
                                                    {item.image ? (<img src={item.image} alt={item.name} className="h-full w-full object-cover"/>) : (<div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground font-medium bg-muted">
                                                            {item.type.slice(0, 2).toUpperCase()}
                                                        </div>)}
                                                </div>
                                                <span className="font-medium text-sm truncate">{item.name}</span>
                                            </div>
                                        </td>
                                        <td className="p-3 align-middle text-sm text-muted-foreground hidden md:table-cell">
                                            <div className="truncate">{item.info}</div>
                                        </td>
                                        <td className="p-3 align-middle text-xs text-muted-foreground hidden lg:table-cell whitespace-nowrap">
                                            <div className="flex flex-col">
                                                <span>{formatDate(item.timestamp).split(' ')[0]}</span>
                                                <span className="text-[10px] text-muted-foreground">{formatDate(item.timestamp).split(' ')[1]}</span>
                                            </div>
                                        </td>
                                        <td className="p-3 align-middle text-center">
                                            <div className="flex items-center justify-center gap-1">
                                                <TooltipProvider>
                                                    <Tooltip delayDuration={0}>
                                                        <TooltipTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="h-8 w-8 cursor-pointer" onClick={() => onHistorySelect?.(item.data)}>
                                                                <CloudUpload className="h-4 w-4"/>
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            <p>Load</p>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>

                                                <TooltipProvider>
                                                    <Tooltip delayDuration={0}>
                                                        <TooltipTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="h-8 w-8 cursor-pointer text-destructive hover:text-destructive" onClick={(e) => handleDeleteFetchItem(item.id, e)}>
                                                                <Trash2 className="h-4 w-4"/>
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            <p>Delete</p>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            </div>
                                        </td>
                                    </tr>))}
                            </tbody>
                       </table>)}
                </div>

                 {totalPages > 1 && (<Pagination>
                        <PaginationContent>
                            <PaginationItem>
                                <PaginationPrevious href="#" onClick={(e) => {
                    e.preventDefault();
                    if (fetchCurrentPage > 1)
                        setFetchCurrentPage(fetchCurrentPage - 1);
                }} className={fetchCurrentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}/>
                            </PaginationItem>
                            
                            {getPaginationPages(fetchCurrentPage, totalPages).map((page, index) => (page === 'ellipsis' ? (<PaginationItem key={`ellipsis-${index}`}>
                                        <PaginationEllipsis />
                                    </PaginationItem>) : (<PaginationItem key={page}>
                                        <PaginationLink href="#" onClick={(e) => {
                        e.preventDefault();
                        setFetchCurrentPage(page as number);
                    }} isActive={fetchCurrentPage === page} className="cursor-pointer">
                                            {page}
                                        </PaginationLink>
                                    </PaginationItem>)))}

                            <PaginationItem>
                                <PaginationNext href="#" onClick={(e) => {
                    e.preventDefault();
                    if (fetchCurrentPage < totalPages)
                        setFetchCurrentPage(fetchCurrentPage + 1);
                }} className={fetchCurrentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}/>
                            </PaginationItem>
                        </PaginationContent>
                    </Pagination>)}
            </div>);
    };
    return (<div className="space-y-6">
            <div className="flex items-center gap-4">
                <h1 className="text-2xl font-bold">History</h1>
            </div>

            <div className="border-b">
                <div className="flex gap-6">
                    <button onClick={() => setActiveTab("downloads")} className={`pb-3 text-sm font-medium transition-colors border-b-2 -mb-px hover:text-foreground ${activeTab === "downloads" ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}>
                        Downloads
                    </button>
                    <button onClick={() => setActiveTab("fetches")} className={`pb-3 text-sm font-medium transition-colors border-b-2 -mb-px hover:text-foreground ${activeTab === "fetches" ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}>
                        Fetches
                    </button>
                </div>
            </div>

            {activeTab === "downloads" && (<div className="mt-6">
                    {renderDownloadHistory()}
                </div>)}

            {activeTab === "fetches" && (<div className="mt-6">
                    {renderFetchHistory()}
                </div>)}

            <Dialog open={showClearDownloadConfirm} onOpenChange={setShowClearDownloadConfirm}>
                <DialogContent className="max-w-md [&>button]:hidden">
                    <DialogHeader>
                        <DialogTitle>Clear Download History?</DialogTitle>
                        <DialogDescription>
                            This will remove all entries from your download history. This action cannot be undone.
                            Note: The actual downloaded files will NOT be deleted.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowClearDownloadConfirm(false)} className="cursor-pointer">Cancel</Button>
                        <Button variant="destructive" onClick={handleClearDownloadHistory} className="cursor-pointer">
                            Clear History
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={showClearFetchConfirm} onOpenChange={setShowClearFetchConfirm}>
                <DialogContent className="max-w-md [&>button]:hidden">
                    <DialogHeader>
                        <DialogTitle>Clear {activeFetchTab.charAt(0).toUpperCase() + activeFetchTab.slice(1)} History?</DialogTitle>
                        <DialogDescription>
                            This will remove all {activeFetchTab} entries from your fetch history cache.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowClearFetchConfirm(false)} className="cursor-pointer">Cancel</Button>
                        <Button variant="destructive" onClick={handleClearFetchHistory} className="cursor-pointer">
                            Clear History
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>);
}
