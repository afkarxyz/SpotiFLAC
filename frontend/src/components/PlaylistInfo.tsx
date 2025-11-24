import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Download, FolderOpen } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { SearchAndSort } from "./SearchAndSort";
import { TrackList } from "./TrackList";
import { DownloadProgress } from "./DownloadProgress";
import type { TrackMetadata } from "@/types/api";

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
  };
  trackList: TrackMetadata[];
  searchQuery: string;
  sortBy: string;
  selectedTracks: string[];
  downloadedTracks: Set<string>;
  failedTracks: Set<string>;
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
  onPageChange: (page: number) => void;
}

export function PlaylistInfo({
  playlistInfo,
  trackList,
  searchQuery,
  sortBy,
  selectedTracks,
  downloadedTracks,
  failedTracks,
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
  onPageChange,
}: PlaylistInfoProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="px-6">
          <div className="flex gap-6 items-start">
            {playlistInfo.owner.images && (
              <img
                src={playlistInfo.owner.images}
                alt={playlistInfo.owner.name}
                className="w-48 h-48 rounded-md shadow-lg object-cover"
              />
            )}
            <div className="flex-1 space-y-4">
              <div className="space-y-2">
                <p className="text-sm font-medium">Playlist</p>
                <h2 className="text-4xl font-bold">{playlistInfo.owner.name}</h2>
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{playlistInfo.owner.display_name}</span>
                  <span>•</span>
                  <span>{playlistInfo.tracks.total} songs</span>
                  <span>•</span>
                  <span>{playlistInfo.followers.total.toLocaleString()} followers</span>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={onDownloadAll}
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
    </div>
  );
}
