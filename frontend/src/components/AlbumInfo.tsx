import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Download, FolderOpen } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { SearchAndSort } from "./SearchAndSort";
import { TrackList } from "./TrackList";
import { DownloadProgress } from "./DownloadProgress";
import type { TrackMetadata } from "@/types/api";

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
  currentDownloadInfo: { name: string; artists: string } | null;
  currentPage: number;
  itemsPerPage: number;
  // Lyrics props
  downloadedLyrics?: Set<string>;
  failedLyrics?: Set<string>;
  skippedLyrics?: Set<string>;
  downloadingLyricsTrack?: string | null;
  onSearchChange: (value: string) => void;
  onSortChange: (value: string) => void;
  onToggleTrack: (isrc: string) => void;
  onToggleSelectAll: (tracks: TrackMetadata[]) => void;
  onDownloadTrack: (isrc: string, name: string, artists: string, albumName: string, spotifyId?: string) => void;
  onDownloadLyrics?: (spotifyId: string, name: string, artists: string, albumName: string, folderName?: string, isArtistDiscography?: boolean) => void;
  onDownloadAll: () => void;
  onDownloadSelected: () => void;
  onStopDownload: () => void;
  onOpenFolder: () => void;
  onPageChange: (page: number) => void;
  onArtistClick?: (artist: { id: string; name: string; external_urls: string }) => void;
  onTrackClick?: (track: TrackMetadata) => void;
}

export function AlbumInfo({
  albumInfo,
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
  onSearchChange,
  onSortChange,
  onToggleTrack,
  onToggleSelectAll,
  onDownloadTrack,
  onDownloadLyrics,
  onDownloadAll,
  onDownloadSelected,
  onStopDownload,
  onOpenFolder,
  onPageChange,
  onArtistClick,
  onTrackClick,
}: AlbumInfoProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="px-6">
          <div className="flex gap-6 items-start">
            {albumInfo.images && (
              <img
                src={albumInfo.images}
                alt={albumInfo.name}
                className="w-48 h-48 rounded-md shadow-lg object-cover"
              />
            )}
            <div className="flex-1 space-y-4">
              <div className="space-y-2">
                <p className="text-sm font-medium">Album</p>
                <h2 className="text-4xl font-bold">{albumInfo.name}</h2>
                <div className="flex items-center gap-2 text-sm">
                  {onArtistClick && albumInfo.artist_id && albumInfo.artist_url ? (
                    <span
                      className="font-medium cursor-pointer hover:underline"
                      onClick={() =>
                        onArtistClick({
                          id: albumInfo.artist_id!,
                          name: albumInfo.artists,
                          external_urls: albumInfo.artist_url!,
                        })
                      }
                    >
                      {albumInfo.artists}
                    </span>
                  ) : (
                    <span className="font-medium">{albumInfo.artists}</span>
                  )}
                  <span>•</span>
                  <span>{albumInfo.release_date}</span>
                  <span>•</span>
                  <span>{albumInfo.total_tracks} songs</span>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button onClick={onDownloadAll} disabled={isDownloading}>
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
                {downloadedTracks.size > 0 && (
                  <Button onClick={onOpenFolder} variant="outline">
                    <FolderOpen className="h-4 w-4" />
                    Open Folder
                  </Button>
                )}
              </div>
              {isDownloading && (
                <DownloadProgress
                  progress={downloadProgress}
                  currentTrack={currentDownloadInfo}
                  onStop={onStopDownload}
                />
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="space-y-4">
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
          hideAlbumColumn={true}
          folderName={albumInfo.name}
          downloadedLyrics={downloadedLyrics}
          failedLyrics={failedLyrics}
          skippedLyrics={skippedLyrics}
          downloadingLyricsTrack={downloadingLyricsTrack}
          onToggleTrack={onToggleTrack}
          onToggleSelectAll={onToggleSelectAll}
          onDownloadTrack={onDownloadTrack}
          onDownloadLyrics={onDownloadLyrics}
          onPageChange={onPageChange}
          onTrackClick={onTrackClick}
        />
      </div>
    </div>
  );
}
