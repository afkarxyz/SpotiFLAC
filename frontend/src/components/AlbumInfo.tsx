import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Download, FolderOpen, ImageDown, FileText, XCircle } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SearchAndSort } from "./SearchAndSort";
import { TrackList } from "./TrackList";
import { DownloadProgress } from "./DownloadProgress";
import type { TrackMetadata, TrackAvailability } from "@/types/api";
interface AlbumInfoProps {
    albumInfo: {
        name: string;
        artists: string;
        images: string;
        release_date: string;
        total_tracks: number;
        artist_id?: string;
        artist_url?: string;
    };
    trackList: TrackMetadata[];
    searchQuery: string;
    sortBy: string;
    selectedTracks: string[];
    downloadedTracks: Set<string>;
    failedTracks: Set<string>;
    skippedTracks: Set<string>;
    downloadingTrack: string | null;
    isDownloading: boolean;
    bulkDownloadType: "all" | "selected" | null;
    downloadProgress: number;
    currentDownloadInfo: {
        name: string;
        artists: string;
    } | null;
    currentPage: number;
    itemsPerPage: number;
    downloadedLyrics?: Set<string>;
    failedLyrics?: Set<string>;
    skippedLyrics?: Set<string>;
    downloadingLyricsTrack?: string | null;
    checkingAvailabilityTrack?: string | null;
    availabilityMap?: Map<string, TrackAvailability>;
    downloadedCovers?: Set<string>;
    failedCovers?: Set<string>;
    skippedCovers?: Set<string>;
    downloadingCoverTrack?: string | null;
    isBulkDownloadingCovers?: boolean;
    isBulkDownloadingLyrics?: boolean;
    onSearchChange: (value: string) => void;
    onSortChange: (value: string) => void;
    onToggleTrack: (isrc: string) => void;
    onToggleSelectAll: (tracks: TrackMetadata[]) => void;
    onDownloadTrack: (isrc: string, name: string, artists: string, albumName: string, spotifyId?: string, folderName?: string, durationMs?: number, position?: number, albumArtist?: string, releaseDate?: string, coverUrl?: string, spotifyTrackNumber?: number, spotifyDiscNumber?: number, spotifyTotalTracks?: number, spotifyTotalDiscs?: number, copyright?: string, publisher?: string) => void;
    onDownloadLyrics?: (spotifyId: string, name: string, artists: string, albumName: string, folderName?: string, isArtistDiscography?: boolean, position?: number, albumArtist?: string, releaseDate?: string, discNumber?: number) => void;
    onDownloadCover?: (coverUrl: string, trackName: string, artistName: string, albumName: string, folderName?: string, isArtistDiscography?: boolean, position?: number, trackId?: string, albumArtist?: string, releaseDate?: string, discNumber?: number) => void;
    onCheckAvailability?: (spotifyId: string) => void;
    onDownloadAllLyrics?: () => void;
    onDownloadAllCovers?: () => void;
    onDownloadAll: () => void;
    onDownloadSelected: () => void;
    onStopDownload: () => void;
    onOpenFolder: () => void;
    onPageChange: (page: number) => void;
    onArtistClick?: (artist: {
        id: string;
        name: string;
        external_urls: string;
    }) => void;
    onTrackClick?: (track: TrackMetadata) => void;
    onBack?: () => void;
}
export function AlbumInfo({ albumInfo, trackList, searchQuery, sortBy, selectedTracks, downloadedTracks, failedTracks, skippedTracks, downloadingTrack, isDownloading, bulkDownloadType, downloadProgress, currentDownloadInfo, currentPage, itemsPerPage, downloadedLyrics, failedLyrics, skippedLyrics, downloadingLyricsTrack, checkingAvailabilityTrack, availabilityMap, downloadedCovers, failedCovers, skippedCovers, downloadingCoverTrack, isBulkDownloadingCovers, isBulkDownloadingLyrics, onSearchChange, onSortChange, onToggleTrack, onToggleSelectAll, onDownloadTrack, onDownloadLyrics, onDownloadCover, onCheckAvailability, onDownloadAllLyrics, onDownloadAllCovers, onDownloadAll, onDownloadSelected, onStopDownload, onOpenFolder, onPageChange, onArtistClick, onTrackClick, onBack, }: AlbumInfoProps) {
    return (<div className="space-y-6">
      <Card className="relative">
      {onBack && (<div className="absolute top-4 right-4 z-10">
          <Button variant="ghost" size="icon" onClick={onBack}>
              <XCircle className="h-5 w-5"/>
          </Button>
      </div>)}
        <CardContent className="px-6">
          <div className="flex gap-6 items-start">
            {albumInfo.images && (<img src={albumInfo.images} alt={albumInfo.name} className="w-48 h-48 rounded-md shadow-lg object-cover"/>)}
            <div className="flex-1 space-y-4">
              <div className="space-y-2">
                <p className="text-sm font-medium">Album</p>
                <h2 className="text-4xl font-bold">{albumInfo.name}</h2>
                <div className="flex items-center gap-2 text-sm">
                  {onArtistClick && albumInfo.artist_id && albumInfo.artist_url ? (<span className="font-medium cursor-pointer hover:underline" onClick={() => onArtistClick({
                id: albumInfo.artist_id!,
                name: albumInfo.artists,
                external_urls: albumInfo.artist_url!,
            })}>
                      {albumInfo.artists}
                    </span>) : (<span className="font-medium">{albumInfo.artists}</span>)}
                  <span>•</span>
                  <span>{albumInfo.release_date}</span>
                  <span>•</span>
                  <span>
                    {albumInfo.total_tracks.toLocaleString()} {albumInfo.total_tracks === 1 ? "track" : "tracks"}
                  </span>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button onClick={onDownloadAll} disabled={isDownloading}>
                  {isDownloading && bulkDownloadType === "all" ? (<Spinner />) : (<Download className="h-4 w-4"/>)}
                  Download All
                </Button>
                {selectedTracks.length > 0 && (<Button onClick={onDownloadSelected} variant="secondary" disabled={isDownloading}>
                    {isDownloading && bulkDownloadType === "selected" ? (<Spinner />) : (<Download className="h-4 w-4"/>)}
                    Download Selected ({selectedTracks.length.toLocaleString()})
                  </Button>)}
                {onDownloadAllLyrics && (<Tooltip>
                    <TooltipTrigger asChild>
                      <Button onClick={onDownloadAllLyrics} variant="outline" disabled={isBulkDownloadingLyrics}>
                        {isBulkDownloadingLyrics ? <Spinner /> : <FileText className="h-4 w-4"/>}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Download All Lyrics</p>
                    </TooltipContent>
                  </Tooltip>)}
                {onDownloadAllCovers && (<Tooltip>
                    <TooltipTrigger asChild>
                      <Button onClick={onDownloadAllCovers} variant="outline" disabled={isBulkDownloadingCovers}>
                        {isBulkDownloadingCovers ? <Spinner /> : <ImageDown className="h-4 w-4"/>}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Download All Covers</p>
                    </TooltipContent>
                  </Tooltip>)}
                {downloadedTracks.size > 0 && (<Button onClick={onOpenFolder} variant="outline">
                    <FolderOpen className="h-4 w-4"/>
                    Open Folder
                  </Button>)}
              </div>
              {isDownloading && (<DownloadProgress progress={downloadProgress} currentTrack={currentDownloadInfo} onStop={onStopDownload}/>)}
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="space-y-4">
        <SearchAndSort searchQuery={searchQuery} sortBy={sortBy} onSearchChange={onSearchChange} onSortChange={onSortChange}/>
        <TrackList tracks={trackList} searchQuery={searchQuery} sortBy={sortBy} selectedTracks={selectedTracks} downloadedTracks={downloadedTracks} failedTracks={failedTracks} skippedTracks={skippedTracks} downloadingTrack={downloadingTrack} isDownloading={isDownloading} currentPage={currentPage} itemsPerPage={itemsPerPage} showCheckboxes={true} hideAlbumColumn={true} folderName={albumInfo.name} downloadedLyrics={downloadedLyrics} failedLyrics={failedLyrics} skippedLyrics={skippedLyrics} downloadingLyricsTrack={downloadingLyricsTrack} checkingAvailabilityTrack={checkingAvailabilityTrack} availabilityMap={availabilityMap} onToggleTrack={onToggleTrack} onToggleSelectAll={onToggleSelectAll} onDownloadTrack={onDownloadTrack} onDownloadLyrics={onDownloadLyrics} onDownloadCover={onDownloadCover} downloadedCovers={downloadedCovers} failedCovers={failedCovers} skippedCovers={skippedCovers} downloadingCoverTrack={downloadingCoverTrack} onCheckAvailability={onCheckAvailability} onPageChange={onPageChange} onArtistClick={onArtistClick} onTrackClick={onTrackClick}/>
      </div>
    </div>);
}
