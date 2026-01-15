import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Trash2, ExternalLink, Search, ArrowUpDown, History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, } from "@/components/ui/dialog";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious, } from "@/components/ui/pagination";
import { GetDownloadHistory, ClearDownloadHistory } from "../../wailsjs/go/main/App";
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
interface HistoryItem {
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
export function HistoryPage() {
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [filteredHistory, setFilteredHistory] = useState<HistoryItem[]>([]);
    const [showClearConfirm, setShowClearConfirm] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [sortBy, setSortBy] = useState("default");
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 50;
    const fetchHistory = async () => {
        try {
            const items = await GetDownloadHistory();
            setHistory(items || []);
        }
        catch (err) {
            console.error("Failed to fetch history:", err);
        }
    };
    useEffect(() => {
        fetchHistory();
        const interval = setInterval(fetchHistory, 5000);
        return () => clearInterval(interval);
    }, []);
    useEffect(() => {
        let result = [...history];
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
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
            switch (sortBy) {
                case "default":
                case "date_desc":
                    return b.timestamp - a.timestamp;
                case "date_asc":
                    return a.timestamp - b.timestamp;
                case "title_asc":
                    return a.title.localeCompare(b.title);
                case "title_desc":
                    return b.title.localeCompare(a.title);
                case "artist_asc":
                    return a.artists.localeCompare(b.artists);
                case "artist_desc":
                    return b.artists.localeCompare(a.artists);
                case "duration_asc":
                    return parseDuration(a.duration_str) - parseDuration(b.duration_str);
                case "duration_desc":
                    return parseDuration(b.duration_str) - parseDuration(a.duration_str);
                default:
                    return 0;
            }
        });
        setFilteredHistory(result);
        setCurrentPage(1);
    }, [history, searchQuery, sortBy]);
    const totalPages = Math.ceil(filteredHistory.length / ITEMS_PER_PAGE);
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const paginatedHistory = filteredHistory.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    const getPaginationPages = (current: number, total: number): (number | 'ellipsis')[] => {
        if (total <= 10) {
            return Array.from({ length: total }, (_, i) => i + 1);
        }
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
    const handleClearHistory = async () => {
        await ClearDownloadHistory();
        fetchHistory();
        setShowClearConfirm(false);
    };
    return (<div className="space-y-6">
            <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <h2 className="text-2xl font-bold tracking-tight">Download History</h2>
                        {history.length > 0 && (<Badge variant="secondary" className="font-mono">
                                {history.length.toLocaleString('en-US')}
                            </Badge>)}
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setShowClearConfirm(true)} disabled={history.length === 0} className="cursor-pointer gap-2">
                        <Trash2 className="h-4 w-4"/> Clear
                    </Button>
                </div>

                <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground"/>
                        <Input placeholder="Search history..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-8 h-9"/>
                    </div>
                    <Select value={sortBy} onValueChange={setSortBy}>
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
                {paginatedHistory.length === 0 ? (<div className="flex flex-col items-center justify-center p-16 text-center text-muted-foreground gap-3">
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
                                <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground hidden md:table-cell w-40 text-xs uppercase text-nowrap">Downloaded At</th>
                                <th className="h-10 px-4 text-center align-middle font-medium text-muted-foreground w-16 text-xs uppercase text-nowrap">Link</th>
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedHistory.map((item, index) => (<tr key={item.id} className="border-b transition-colors hover:bg-muted/50">
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
                                            <span className="text-[10px] font-bold text-foreground">{item.format}</span>
                                            {item.quality && <span className="text-[9px] text-muted-foreground leading-none whitespace-nowrap">{item.quality}</span>}
                                        </div>
                                    </td>
                                    <td className="p-3 align-middle text-sm text-muted-foreground text-left hidden xl:table-cell font-mono">
                                        {item.duration_str}
                                    </td>
                                    <td className="p-3 align-middle text-xs text-muted-foreground hidden md:table-cell whitespace-nowrap">
                                        {formatDate(item.timestamp)}
                                    </td>
                                    <td className="p-3 align-middle text-center">
                                        <Button variant="ghost" size="icon" className="h-8 w-8 cursor-pointer" onClick={() => openExternal(`https://open.spotify.com/track/${item.spotify_id}`)}>
                                            <ExternalLink className="h-4 w-4"/>
                                        </Button>
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
                if (currentPage > 1)
                    setCurrentPage(currentPage - 1);
            }} className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}/>
                        </PaginationItem>

                        {getPaginationPages(currentPage, totalPages).map((page, index) => (page === 'ellipsis' ? (<PaginationItem key={`ellipsis-${index}`}>
                                    <PaginationEllipsis />
                                </PaginationItem>) : (<PaginationItem key={page}>
                                    <PaginationLink href="#" onClick={(e) => {
                    e.preventDefault();
                    setCurrentPage(page);
                }} isActive={currentPage === page} className="cursor-pointer">
                                        {page}
                                    </PaginationLink>
                                </PaginationItem>)))}

                        <PaginationItem>
                            <PaginationNext href="#" onClick={(e) => {
                e.preventDefault();
                if (currentPage < totalPages)
                    setCurrentPage(currentPage + 1);
            }} className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}/>
                        </PaginationItem>
                    </PaginationContent>
                </Pagination>)}

            <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
                <DialogContent className="max-w-md [&>button]:hidden">
                    <DialogHeader>
                        <DialogTitle>Clear Download History?</DialogTitle>
                        <DialogDescription>
                            This will remove all entries from your download history. This action cannot be undone.
                            Note: The actual downloaded files will NOT be deleted.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowClearConfirm(false)} className="cursor-pointer">Cancel</Button>
                        <Button variant="destructive" onClick={handleClearHistory} className="cursor-pointer">
                            Clear History
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>);
}
