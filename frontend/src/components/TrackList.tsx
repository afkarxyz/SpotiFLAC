import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Download, CheckCircle, XCircle } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import type { TrackMetadata } from "@/types/api";

interface TrackListProps {
  tracks: TrackMetadata[];
  searchQuery: string;
  sortBy: string;
  selectedTracks: string[];
  downloadedTracks: Set<string>;
  failedTracks: Set<string>;
  downloadingTrack: string | null;
  isDownloading: boolean;
  currentPage: number;
  itemsPerPage: number;
  showCheckboxes?: boolean;
  hideAlbumColumn?: boolean;
  onToggleTrack: (isrc: string) => void;
  onToggleSelectAll: (tracks: TrackMetadata[]) => void;
  onDownloadTrack: (isrc: string, name: string, artists: string, albumName: string) => void;
  onPageChange: (page: number) => void;
}

export function TrackList({
  tracks,
  searchQuery,
  sortBy,
  selectedTracks,
  downloadedTracks,
  failedTracks,
  downloadingTrack,
  isDownloading,
  currentPage,
  itemsPerPage,
  showCheckboxes = false,
  hideAlbumColumn = false,
  onToggleTrack,
  onToggleSelectAll,
  onDownloadTrack,
  onPageChange,
}: TrackListProps) {
  let filteredTracks = tracks.filter((track) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      track.name.toLowerCase().includes(query) ||
      track.artists.toLowerCase().includes(query) ||
      track.album_name.toLowerCase().includes(query)
    );
  });

  // Apply sorting
  if (sortBy === "title-asc") {
    filteredTracks = [...filteredTracks].sort((a, b) => a.name.localeCompare(b.name));
  } else if (sortBy === "title-desc") {
    filteredTracks = [...filteredTracks].sort((a, b) => b.name.localeCompare(a.name));
  } else if (sortBy === "artist-asc") {
    filteredTracks = [...filteredTracks].sort((a, b) => a.artists.localeCompare(b.artists));
  } else if (sortBy === "artist-desc") {
    filteredTracks = [...filteredTracks].sort((a, b) => b.artists.localeCompare(a.artists));
  } else if (sortBy === "duration-asc") {
    filteredTracks = [...filteredTracks].sort((a, b) => a.duration_ms - b.duration_ms);
  } else if (sortBy === "duration-desc") {
    filteredTracks = [...filteredTracks].sort((a, b) => b.duration_ms - a.duration_ms);
  } else if (sortBy === "downloaded") {
    filteredTracks = [...filteredTracks].sort((a, b) => {
      const aDownloaded = downloadedTracks.has(a.isrc);
      const bDownloaded = downloadedTracks.has(b.isrc);
      return (bDownloaded ? 1 : 0) - (aDownloaded ? 1 : 0);
    });
  } else if (sortBy === "not-downloaded") {
    filteredTracks = [...filteredTracks].sort((a, b) => {
      const aDownloaded = downloadedTracks.has(a.isrc);
      const bDownloaded = downloadedTracks.has(b.isrc);
      return (aDownloaded ? 1 : 0) - (bDownloaded ? 1 : 0);
    });
  }

  const totalPages = Math.ceil(filteredTracks.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedTracks = filteredTracks.slice(startIndex, endIndex);

  const tracksWithIsrc = filteredTracks.filter((track) => track.isrc);
  const allSelected =
    tracksWithIsrc.length > 0 &&
    tracksWithIsrc.every((track) => selectedTracks.includes(track.isrc));

  const formatDuration = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50">
                {showCheckboxes && (
                  <th className="h-12 px-4 text-left align-middle w-12">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={() => onToggleSelectAll(filteredTracks)}
                    />
                  </th>
                )}
                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground w-12">
                  #
                </th>
                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                  Title
                </th>
                {!hideAlbumColumn && (
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground hidden md:table-cell">
                    Album
                  </th>
                )}
                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground hidden lg:table-cell w-24">
                  Duration
                </th>
                <th className="h-12 px-4 text-center align-middle font-medium text-muted-foreground w-32">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {paginatedTracks.map((track, index) => (
                <tr key={index} className="border-b transition-colors hover:bg-muted/50">
                  {showCheckboxes && (
                    <td className="p-4 align-middle">
                      {track.isrc && (
                        <Checkbox
                          checked={selectedTracks.includes(track.isrc)}
                          onCheckedChange={() => onToggleTrack(track.isrc)}
                        />
                      )}
                    </td>
                  )}
                  <td className="p-4 align-middle text-sm text-muted-foreground">
                    {startIndex + index + 1}
                  </td>
                  <td className="p-4 align-middle">
                    <div className="flex items-center gap-3">
                      {track.images && (
                        <img
                          src={track.images}
                          alt={track.name}
                          className="w-10 h-10 rounded object-cover"
                        />
                      )}
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{track.name}</span>
                          {downloadedTracks.has(track.isrc) && (
                            <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                          )}
                          {failedTracks.has(track.isrc) && (
                            <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                          )}
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {track.artists}
                        </span>
                      </div>
                    </div>
                  </td>
                  {!hideAlbumColumn && (
                    <td className="p-4 align-middle text-sm text-muted-foreground hidden md:table-cell">
                      {track.album_name}
                    </td>
                  )}
                  <td className="p-4 align-middle text-sm text-muted-foreground hidden lg:table-cell">
                    {formatDuration(track.duration_ms)}
                  </td>
                  <td className="p-4 align-middle text-center">
                    {track.isrc && (
                      <Button
                        onClick={() =>
                          onDownloadTrack(track.isrc, track.name, track.artists, track.album_name)
                        }
                        size="sm"
                        className="gap-1.5"
                        disabled={isDownloading || downloadingTrack === track.isrc}
                      >
                        {downloadingTrack === track.isrc ? (
                          <Spinner />
                        ) : (
                          <>
                            <Download className="h-4 w-4" />
                            Download
                          </>
                        )}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  if (currentPage > 1) onPageChange(currentPage - 1);
                }}
                className={
                  currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"
                }
              />
            </PaginationItem>

            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <PaginationItem key={page}>
                <PaginationLink
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    onPageChange(page);
                  }}
                  isActive={currentPage === page}
                  className="cursor-pointer"
                >
                  {page}
                </PaginationLink>
              </PaginationItem>
            ))}

            <PaginationItem>
              <PaginationNext
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  if (currentPage < totalPages) onPageChange(currentPage + 1);
                }}
                className={
                  currentPage === totalPages
                    ? "pointer-events-none opacity-50"
                    : "cursor-pointer"
                }
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
