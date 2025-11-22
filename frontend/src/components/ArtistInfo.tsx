import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Download, FolderOpen } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { SearchAndSort } from "./SearchAndSort";
import { TrackList } from "./TrackList";
import { DownloadProgress } from "./DownloadProgress";
import type { TrackMetadata } from "@/types/api";

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
  downloadingTrack: string | null;
  isDownloading: boolean;
  bulkDownloadType: "all" | "selected" | null;
  downloadProgress: number;
  currentDownloadInfo: { name: string; artists: string } | null;
  currentPage: number;
  itemsPerPage: number;
  onSearchChange: (value: string) => void;
  onSortChange: (value: string) => void;
  onToggleTrack: (isrc: string) => void;
  onToggleSelectAll: (tracks: TrackMetadata[]) => void;
  onDownloadTrack: (isrc: string, name: string, artists: string, albumName: string) => void;
  onDownloadAll: () => void;
  onDownloadSelected: () => void;
  onStopDownload: () => void;
  onOpenFolder: () => void;
  onAlbumClick: (album: { id: string; name: string; external_urls: string }) => void;
  onPageChange: (page: number) => void;
}

export function ArtistInfo({
  artistInfo,
  albumList,
  trackList,
  searchQuery,
  sortBy,
  selectedTracks,
  downloadedTracks,
  downloadingTrack,
  isDownloading,
  bulkDownloadType,
  downloadProgress,
  currentDownloadInfo,
  currentPage,
  itemsPerPage,
  onSearchChange,
  onSortChange,
  onToggleTrack,
  onToggleSelectAll,
  onDownloadTrack,
  onDownloadAll,
  onDownloadSelected,
  onStopDownload,
  onOpenFolder,
  onAlbumClick,
  onPageChange,
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
              <div className="flex items-center gap-2 text-sm">
                <span>{artistInfo.followers.toLocaleString()} followers</span>
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
          <div className="flex items-center justify-between">
            <h3 className="text-2xl font-bold">Popular Tracks</h3>
            <div className="flex gap-2">
              <Button
                onClick={onDownloadAll}
                size="sm"
                className="gap-2"
                disabled={isDownloading}
              >
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
                  className="gap-2"
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
                <Button onClick={onOpenFolder} size="sm" variant="outline" className="gap-2">
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
            downloadingTrack={downloadingTrack}
            isDownloading={isDownloading}
            currentPage={currentPage}
            itemsPerPage={itemsPerPage}
            showCheckboxes={true}
            hideAlbumColumn={false}
            onToggleTrack={onToggleTrack}
            onToggleSelectAll={onToggleSelectAll}
            onDownloadTrack={onDownloadTrack}
            onPageChange={onPageChange}
          />
        </div>
      )}
    </div>
  );
}
