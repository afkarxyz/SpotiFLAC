import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Download, FolderOpen, ImageDown, FileText } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SearchAndSort } from "./SearchAndSort";
import { TrackList } from "./TrackList";
import { DownloadProgress } from "./DownloadProgress";
import type { TrackMetadata, TrackAvailability } from "@/types/api";

interface ArtistInfoProps {
  artistInfo: {
    name: string;
    images: string;
    followers: number;
    genres: string[];
  };
  albumList: Array<{
    id: string;
    name: string;
    images: string;
    release_date: string;
    album_type: string;
    external_urls: string;
  }>;
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
  currentDownloadInfo: { name: string; artists: string } | null;
  currentPage: number;
  itemsPerPage: number;
  // Lyrics props
  downloadedLyrics?: Set<string>;
  failedLyrics?: Set<string>;
  skippedLyrics?: Set<string>;
  downloadingLyricsTrack?: string | null;
  // Availability props
  checkingAvailabilityTrack?: string | null;
  availabilityMap?: Map<string, TrackAvailability>;
  // Cover props
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
  onDownloadTrack: (isrc: string, name: string, artists: string, albumName: string, spotifyId?: string, folderName?: string, durationMs?: number, position?: number, albumArtist?: string, releaseDate?: string, coverUrl?: string, spotifyTrackNumber?: number, spotifyDiscNumber?: number, spotifyTotalTracks?: number) => void;
  onDownloadLyrics?: (spotifyId: string, name: string, artists: string, albumName: string, folderName?: string, isArtistDiscography?: boolean, position?: number, albumArtist?: string, releaseDate?: string, discNumber?: number) => void;
  onDownloadCover?: (coverUrl: string, trackName: string, artistName: string, albumName: string, folderName?: string, isArtistDiscography?: boolean, position?: number, trackId?: string, albumArtist?: string, releaseDate?: string, discNumber?: number) => void;
  onCheckAvailability?: (spotifyId: string) => void;
  onDownloadAllLyrics?: () => void;
  onDownloadAllCovers?: () => void;
  onDownloadAll: () => void;
  onDownloadSelected: () => void;
  onStopDownload: () => void;
  onOpenFolder: () => void;
  onAlbumClick: (album: { id: string; name: string; external_urls: string }) => void;
  onArtistClick: (artist: { id: string; name: string; external_urls: string }) => void;
  onPageChange: (page: number) => void;
  onTrackClick?: (track: TrackMetadata) => void;
}

export function ArtistInfo({
  artistInfo,
  albumList,
  trackList,
  searchQuery,
  sortBy,
  selectedTracks,
  downloadedTracks,
  failedTracks,
  skippedTracks,
  downloadingTrack,
  isDownloading,
  bulkDownloadType,
  downloadProgress,
  currentDownloadInfo,
  currentPage,
  itemsPerPage,
  downloadedLyrics,
  failedLyrics,
  skippedLyrics,
  downloadingLyricsTrack,
  checkingAvailabilityTrack,
  availabilityMap,
  downloadedCovers,
  failedCovers,
  skippedCovers,
  downloadingCoverTrack,
  isBulkDownloadingCovers,
  isBulkDownloadingLyrics,
  onSearchChange,
  onSortChange,
  onToggleTrack,
  onToggleSelectAll,
  onDownloadTrack,
  onDownloadLyrics,
  onDownloadCover,
  onCheckAvailability,
  onDownloadAllLyrics,
  onDownloadAllCovers,
  onDownloadAll,
  onDownloadSelected,
  onStopDownload,
  onOpenFolder,
  onAlbumClick,
  onArtistClick,
  onPageChange,
  onTrackClick,
}: ArtistInfoProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="px-6">
          <div className="flex gap-6 items-start">
            {artistInfo.images && (
              <img
                src={artistInfo.images}
                alt={artistInfo.name}
                className="w-48 h-48 rounded-full shadow-lg object-cover"
              />
            )}
            <div className="flex-1 space-y-2">
              <p className="text-sm font-medium">Artist</p>
              <h2 className="text-4xl font-bold">{artistInfo.name}</h2>
              <div className="flex items-center gap-2 text-sm flex-wrap">
                <span>{artistInfo.followers.toLocaleString()} followers</span>
                <span>•</span>
                <span>{albumList.length} albums</span>
                <span>•</span>
                <span>{trackList.length} tracks</span>
                {artistInfo.genres.length > 0 && (
                  <>
                    <span>•</span>
                    <span>{artistInfo.genres.join(", ")}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {albumList.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-2xl font-bold">Discography</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {albumList.map((album) => (
              <div
                key={album.id}
                className="group cursor-pointer"
                onClick={() =>
                  onAlbumClick({
                    id: album.id,
                    name: album.name,
                    external_urls: album.external_urls,
                  })
                }
              >
                <div className="relative mb-4">
                  {album.images && (
                    <img
                      src={album.images}
                      alt={album.name}
                      className="w-full aspect-square object-cover rounded-md shadow-md transition-shadow group-hover:shadow-xl"
                    />
                  )}
                </div>
                <h4 className="font-semibold truncate">{album.name}</h4>
                <p className="text-sm text-muted-foreground">
                  {album.release_date?.split("-")[0]} • {album.album_type}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {trackList.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-2xl font-bold">Popular Tracks</h3>
            <div className="flex gap-2 flex-wrap">
              <Button onClick={onDownloadAll} size="sm" disabled={isDownloading}>
                {isDownloading && bulkDownloadType === "all" ? (
                  <Spinner />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Download All
              </Button>
              {selectedTracks.length > 0 && (
                <Button
                  onClick={onDownloadSelected}
                  size="sm"
                  variant="secondary"
                  disabled={isDownloading}
                >
                  {isDownloading && bulkDownloadType === "selected" ? (
                    <Spinner />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  Download Selected ({selectedTracks.length})
                </Button>
              )}
              {onDownloadAllLyrics && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={onDownloadAllLyrics}
                      size="sm"
                      variant="outline"
                      disabled={isBulkDownloadingLyrics}
                    >
                      {isBulkDownloadingLyrics ? <Spinner /> : <FileText className="h-4 w-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Download All Lyrics</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {onDownloadAllCovers && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={onDownloadAllCovers}
                      size="sm"
                      variant="outline"
                      disabled={isBulkDownloadingCovers}
                    >
                      {isBulkDownloadingCovers ? <Spinner /> : <ImageDown className="h-4 w-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Download All Covers</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {downloadedTracks.size > 0 && (
                <Button onClick={onOpenFolder} size="sm" variant="outline">
                  <FolderOpen className="h-4 w-4" />
                  Open Folder
                </Button>
              )}
            </div>
          </div>
          {isDownloading && (
            <DownloadProgress
              progress={downloadProgress}
              currentTrack={currentDownloadInfo}
              onStop={onStopDownload}
            />
          )}
          <SearchAndSort
            searchQuery={searchQuery}
            sortBy={sortBy}
            onSearchChange={onSearchChange}
            onSortChange={onSortChange}
          />
          <TrackList
            tracks={trackList}
            searchQuery={searchQuery}
            sortBy={sortBy}
            selectedTracks={selectedTracks}
            downloadedTracks={downloadedTracks}
            failedTracks={failedTracks}
            skippedTracks={skippedTracks}
            downloadingTrack={downloadingTrack}
            isDownloading={isDownloading}
            currentPage={currentPage}
            itemsPerPage={itemsPerPage}
            showCheckboxes={true}
            hideAlbumColumn={false}
            folderName={artistInfo.name}
            isArtistDiscography={true}
            downloadedLyrics={downloadedLyrics}
            failedLyrics={failedLyrics}
            skippedLyrics={skippedLyrics}
            downloadingLyricsTrack={downloadingLyricsTrack}
            checkingAvailabilityTrack={checkingAvailabilityTrack}
            availabilityMap={availabilityMap}
            onToggleTrack={onToggleTrack}
            onToggleSelectAll={onToggleSelectAll}
            onDownloadTrack={onDownloadTrack}
            onDownloadLyrics={onDownloadLyrics}
            onDownloadCover={onDownloadCover}
            downloadedCovers={downloadedCovers}
            failedCovers={failedCovers}
            skippedCovers={skippedCovers}
            downloadingCoverTrack={downloadingCoverTrack}
            onCheckAvailability={onCheckAvailability}
            onPageChange={onPageChange}
            onAlbumClick={onAlbumClick}
            onArtistClick={onArtistClick}
            onTrackClick={onTrackClick}
          />
        </div>
      )}
    </div>
  );
}
