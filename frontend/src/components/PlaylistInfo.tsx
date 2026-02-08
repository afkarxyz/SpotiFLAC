import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Download, FolderOpen, ImageDown, FileText, XCircle } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SearchAndSort } from "./SearchAndSort";
import { TrackList } from "./TrackList";
import { DownloadProgress } from "./DownloadProgress";
import type { TrackMetadata, TrackAvailability } from "@/types/api";
interface PlaylistInfoProps {
    playlistInfo: {
        owner: {
            name: string;
            display_name: string;
            images: string;
        };
        tracks: {
            total: number;
        };
        followers: {
            total: number;
        };
        cover?: string;
        description?: string;
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
    onAlbumClick: (album: {
        id: string;
        name: string;
        external_urls: string;
    }) => void;
    onArtistClick: (artist: {
        id: string;
        name: string;
        external_urls: string;
    }) => void;
    onTrackClick: (track: TrackMetadata) => void;
    onBack?: () => void;
}
export function PlaylistInfo({ playlistInfo, trackList, searchQuery, sortBy, selectedTracks, downloadedTracks, failedTracks, skippedTracks, downloadingTrack, isDownloading, bulkDownloadType, downloadProgress, currentDownloadInfo, currentPage, itemsPerPage, downloadedLyrics, failedLyrics, skippedLyrics, downloadingLyricsTrack, checkingAvailabilityTrack, availabilityMap, downloadedCovers, failedCovers, skippedCovers, downloadingCoverTrack, isBulkDownloadingCovers, isBulkDownloadingLyrics, onSearchChange, onSortChange, onToggleTrack, onToggleSelectAll, onDownloadTrack, onDownloadLyrics, onDownloadCover, onCheckAvailability, onDownloadAllLyrics, onDownloadAllCovers, onDownloadAll, onDownloadSelected, onStopDownload, onOpenFolder, onPageChange, onAlbumClick, onArtistClick, onTrackClick, onBack, }: PlaylistInfoProps) {
    return (<div className="space-y-6">
      <Card className="relative">
      {onBack && (<div className="absolute top-4 right-4 z-10">
          <Button variant="ghost" size="icon" onClick={onBack}>
              <XCircle className="h-5 w-5"/>
          </Button>
      </div>)}
        <CardContent className="px-6">
          <div className="flex gap-6 items-start">
            {playlistInfo.cover && (<img src={playlistInfo.cover} alt={playlistInfo.owner.name} className="w-48 h-48 rounded-md shadow-lg object-cover"/>)}
            <div className="flex-1 space-y-4">
              <div className="space-y-2">
                <p className="text-sm font-medium">Playlist</p>
                <h2 className="text-4xl font-bold">{playlistInfo.owner.name}</h2>
                {playlistInfo.description && (<p className="text-sm text-muted-foreground">{playlistInfo.description}</p>)}
                <div className="flex items-center gap-2 text-sm">
                  <div className="flex items-center gap-2">
                    {playlistInfo.owner.images && (<img src={playlistInfo.owner.images} alt={playlistInfo.owner.display_name} className="w-5 h-5 rounded-full object-cover"/>)}
                    <span className="font-medium">{playlistInfo.owner.display_name}</span>
                  </div>
                  <span>•</span>
                  <span>
                    {playlistInfo.tracks.total.toLocaleString()} {playlistInfo.tracks.total === 1 ? "track" : "tracks"}
                  </span>
                  <span>•</span>
                  <span>{playlistInfo.followers.total.toLocaleString()} {playlistInfo.followers.total === 1 ? "follower" : "followers"}</span>
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
        <TrackList tracks={trackList} searchQuery={searchQuery} sortBy={sortBy} selectedTracks={selectedTracks} downloadedTracks={downloadedTracks} failedTracks={failedTracks} skippedTracks={skippedTracks} downloadingTrack={downloadingTrack} isDownloading={isDownloading} currentPage={currentPage} itemsPerPage={itemsPerPage} showCheckboxes={true} hideAlbumColumn={false} folderName={playlistInfo.owner.name} downloadedLyrics={downloadedLyrics} failedLyrics={failedLyrics} skippedLyrics={skippedLyrics} downloadingLyricsTrack={downloadingLyricsTrack} checkingAvailabilityTrack={checkingAvailabilityTrack} availabilityMap={availabilityMap} downloadedCovers={downloadedCovers} failedCovers={failedCovers} skippedCovers={skippedCovers} downloadingCoverTrack={downloadingCoverTrack} onToggleTrack={onToggleTrack} onToggleSelectAll={onToggleSelectAll} onDownloadTrack={onDownloadTrack} onDownloadLyrics={onDownloadLyrics} onDownloadCover={onDownloadCover} onCheckAvailability={onCheckAvailability} onPageChange={onPageChange} onAlbumClick={onAlbumClick} onArtistClick={onArtistClick} onTrackClick={onTrackClick}/>
      </div>
    </div>);
}
