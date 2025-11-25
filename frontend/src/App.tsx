import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Search, X } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getSettings, applyThemeMode } from "@/lib/settings";
import { applyTheme } from "@/lib/themes";
import { OpenFolder } from "../wailsjs/go/main/App";
import { toastWithSound as toast } from "@/lib/toast-with-sound";

// Components
import { TitleBar } from "@/components/TitleBar";
import { Header } from "@/components/Header";
import { SearchBar } from "@/components/SearchBar";
import { TrackInfo } from "@/components/TrackInfo";
import { AlbumInfo } from "@/components/AlbumInfo";
import { PlaylistInfo } from "@/components/PlaylistInfo";
import { ArtistInfo } from "@/components/ArtistInfo";
import { DownloadProgressToast } from "@/components/DownloadProgressToast";
import type { HistoryItem } from "@/components/FetchHistory";

// Hooks
import { useDownload } from "@/hooks/useDownload";
import { useMetadata } from "@/hooks/useMetadata";

const HISTORY_KEY = "spotiflac_fetch_history";
const MAX_HISTORY = 5;

function App() {
  const [spotifyUrl, setSpotifyUrl] = useState("");
  const [selectedTracks, setSelectedTracks] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<string>("default");
  const [currentPage, setCurrentPage] = useState(1);
  const [hasUpdate, setHasUpdate] = useState(false);
  const [fetchHistory, setFetchHistory] = useState<HistoryItem[]>([]);

  const ITEMS_PER_PAGE = 50;
  const CURRENT_VERSION = "6.2";

  const download = useDownload();
  const metadata = useMetadata();

  useEffect(() => {
    const settings = getSettings();
    applyThemeMode(settings.themeMode);
    applyTheme(settings.theme);

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      const currentSettings = getSettings();
      if (currentSettings.themeMode === "auto") {
        applyThemeMode("auto");
        applyTheme(currentSettings.theme);
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    checkForUpdates();
    loadHistory();

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  useEffect(() => {
    setSelectedTracks([]);
    setSearchQuery("");
    download.resetDownloadedTracks();
    setSortBy("default");
    setCurrentPage(1);
  }, [metadata.metadata]);

  const checkForUpdates = async () => {
    try {
      const response = await fetch(
        "https://api.github.com/repos/afkarxyz/SpotiFLAC/releases/latest"
      );
      const data = await response.json();
      // tag_name format: "v6.1" -> extract "6.1"
      const latestVersion = data.tag_name?.replace(/^v/, "") || "";

      if (latestVersion && latestVersion > CURRENT_VERSION) {
        setHasUpdate(true);
      }
    } catch (err) {
      console.error("Failed to check for updates:", err);
    }
  };

  const loadHistory = () => {
    try {
      const saved = localStorage.getItem(HISTORY_KEY);
      if (saved) {
        setFetchHistory(JSON.parse(saved));
      }
    } catch (err) {
      console.error("Failed to load history:", err);
    }
  };

  const saveHistory = (history: HistoryItem[]) => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (err) {
      console.error("Failed to save history:", err);
    }
  };

  const addToHistory = (item: Omit<HistoryItem, "id" | "timestamp">) => {
    setFetchHistory((prev) => {
      const filtered = prev.filter((h) => h.url !== item.url);
      const newItem: HistoryItem = {
        ...item,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
      };
      const updated = [newItem, ...filtered].slice(0, MAX_HISTORY);
      saveHistory(updated);
      return updated;
    });
  };

  const removeFromHistory = (id: string) => {
    setFetchHistory((prev) => {
      const updated = prev.filter((h) => h.id !== id);
      saveHistory(updated);
      return updated;
    });
  };

  const handleHistorySelect = async (item: HistoryItem) => {
    setSpotifyUrl(item.url);
    const updatedUrl = await metadata.handleFetchMetadata(item.url);
    if (updatedUrl) {
      setSpotifyUrl(updatedUrl);
    }
  };

  const handleFetchMetadata = async () => {
    const updatedUrl = await metadata.handleFetchMetadata(spotifyUrl);
    if (updatedUrl) {
      setSpotifyUrl(updatedUrl);
    }
  };

  // Add to history when metadata is successfully fetched
  useEffect(() => {
    if (!metadata.metadata || !spotifyUrl) return;

    let historyItem: Omit<HistoryItem, "id" | "timestamp"> | null = null;

    if ("track" in metadata.metadata) {
      const { track } = metadata.metadata;
      historyItem = {
        url: spotifyUrl,
        type: "track",
        name: track.name,
        artist: track.artists,
        image: track.images,
      };
    } else if ("album_info" in metadata.metadata) {
      const { album_info } = metadata.metadata;
      historyItem = {
        url: spotifyUrl,
        type: "album",
        name: album_info.name,
        artist: album_info.artists,
        image: album_info.images,
      };
    } else if ("playlist_info" in metadata.metadata) {
      const { playlist_info } = metadata.metadata;
      historyItem = {
        url: spotifyUrl,
        type: "playlist",
        name: playlist_info.owner.name,
        artist: `${playlist_info.tracks.total} tracks • ${playlist_info.owner.display_name}`,
        image: playlist_info.owner.images || "",
      };
    } else if ("artist_info" in metadata.metadata) {
      const { artist_info } = metadata.metadata;
      historyItem = {
        url: spotifyUrl,
        type: "artist",
        name: artist_info.name,
        artist: `${artist_info.total_albums} albums`,
        image: artist_info.images,
      };
    }

    if (historyItem) {
      addToHistory(historyItem);
    }
  }, [metadata.metadata]);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setCurrentPage(1);
  };

  const toggleTrackSelection = (isrc: string) => {
    setSelectedTracks((prev) =>
      prev.includes(isrc) ? prev.filter((id) => id !== isrc) : [...prev, isrc]
    );
  };

  const toggleSelectAll = (tracks: any[]) => {
    const tracksWithIsrc = tracks.filter((track) => track.isrc).map((track) => track.isrc);
    if (selectedTracks.length === tracksWithIsrc.length) {
      setSelectedTracks([]);
    } else {
      setSelectedTracks(tracksWithIsrc);
    }
  };

  const handleOpenFolder = async () => {
    const settings = getSettings();
    if (!settings.downloadPath) {
      toast.error("Download path not set");
      return;
    }

    try {
      await OpenFolder(settings.downloadPath);
    } catch (error) {
      console.error("Error opening folder:", error);
      toast.error(`Error opening folder: ${error}`);
    }
  };

  const renderMetadata = () => {
    if (!metadata.metadata) return null;

    if ("track" in metadata.metadata) {
      const { track } = metadata.metadata;
      return (
        <TrackInfo
          track={track}
          isDownloading={download.isDownloading}
          downloadingTrack={download.downloadingTrack}
          isDownloaded={download.downloadedTracks.has(track.isrc)}
          isFailed={download.failedTracks.has(track.isrc)}
          onDownload={download.handleDownloadTrack}
          onOpenFolder={handleOpenFolder}
        />
      );
    }

    if ("album_info" in metadata.metadata) {
      const { album_info, track_list } = metadata.metadata;
      return (
        <AlbumInfo
          albumInfo={album_info}
          trackList={track_list}
          searchQuery={searchQuery}
          sortBy={sortBy}
          selectedTracks={selectedTracks}
          downloadedTracks={download.downloadedTracks}
          failedTracks={download.failedTracks}
          skippedTracks={download.skippedTracks}
          downloadingTrack={download.downloadingTrack}
          isDownloading={download.isDownloading}
          bulkDownloadType={download.bulkDownloadType}
          downloadProgress={download.downloadProgress}
          currentDownloadInfo={download.currentDownloadInfo}
          currentPage={currentPage}
          itemsPerPage={ITEMS_PER_PAGE}
          onSearchChange={handleSearchChange}
          onSortChange={setSortBy}
          onToggleTrack={toggleTrackSelection}
          onToggleSelectAll={toggleSelectAll}
          onDownloadTrack={download.handleDownloadTrack}
          onDownloadAll={() => download.handleDownloadAll(track_list, album_info.name)}
          onDownloadSelected={() =>
            download.handleDownloadSelected(selectedTracks, track_list, album_info.name)
          }
          onStopDownload={download.handleStopDownload}
          onOpenFolder={handleOpenFolder}
          onPageChange={setCurrentPage}
          onArtistClick={async (artist) => {
            const artistUrl = await metadata.handleArtistClick(artist);
            if (artistUrl) {
              setSpotifyUrl(artistUrl);
            }
          }}
          onTrackClick={async (track) => {
            if (track.external_urls) {
              setSpotifyUrl(track.external_urls);
              await metadata.handleFetchMetadata(track.external_urls);
            }
          }}
        />
      );
    }

    if ("playlist_info" in metadata.metadata) {
      const { playlist_info, track_list } = metadata.metadata;
      return (
        <PlaylistInfo
          playlistInfo={playlist_info}
          trackList={track_list}
          searchQuery={searchQuery}
          sortBy={sortBy}
          selectedTracks={selectedTracks}
          downloadedTracks={download.downloadedTracks}
          failedTracks={download.failedTracks}
          skippedTracks={download.skippedTracks}
          downloadingTrack={download.downloadingTrack}
          isDownloading={download.isDownloading}
          bulkDownloadType={download.bulkDownloadType}
          downloadProgress={download.downloadProgress}
          currentDownloadInfo={download.currentDownloadInfo}
          currentPage={currentPage}
          itemsPerPage={ITEMS_PER_PAGE}
          onSearchChange={handleSearchChange}
          onSortChange={setSortBy}
          onToggleTrack={toggleTrackSelection}
          onToggleSelectAll={toggleSelectAll}
          onDownloadTrack={download.handleDownloadTrack}
          onDownloadAll={() => download.handleDownloadAll(track_list, playlist_info.owner.name)}
          onDownloadSelected={() =>
            download.handleDownloadSelected(
              selectedTracks,
              track_list,
              playlist_info.owner.name
            )
          }
          onStopDownload={download.handleStopDownload}
          onOpenFolder={handleOpenFolder}
          onPageChange={setCurrentPage}
          onAlbumClick={metadata.handleAlbumClick}
          onArtistClick={async (artist) => {
            const artistUrl = await metadata.handleArtistClick(artist);
            if (artistUrl) {
              setSpotifyUrl(artistUrl);
            }
          }}
          onTrackClick={async (track) => {
            if (track.external_urls) {
              setSpotifyUrl(track.external_urls);
              await metadata.handleFetchMetadata(track.external_urls);
            }
          }}
        />
      );
    }

    if ("artist_info" in metadata.metadata) {
      const { artist_info, album_list, track_list } = metadata.metadata;
      return (
        <ArtistInfo
          artistInfo={artist_info}
          albumList={album_list}
          trackList={track_list}
          searchQuery={searchQuery}
          sortBy={sortBy}
          selectedTracks={selectedTracks}
          downloadedTracks={download.downloadedTracks}
          failedTracks={download.failedTracks}
          skippedTracks={download.skippedTracks}
          downloadingTrack={download.downloadingTrack}
          isDownloading={download.isDownloading}
          bulkDownloadType={download.bulkDownloadType}
          downloadProgress={download.downloadProgress}
          currentDownloadInfo={download.currentDownloadInfo}
          currentPage={currentPage}
          itemsPerPage={ITEMS_PER_PAGE}
          onSearchChange={handleSearchChange}
          onSortChange={setSortBy}
          onToggleTrack={toggleTrackSelection}
          onToggleSelectAll={toggleSelectAll}
          onDownloadTrack={download.handleDownloadTrack}
          onDownloadAll={() => download.handleDownloadAll(track_list, artist_info.name, true)}
          onDownloadSelected={() =>
            download.handleDownloadSelected(selectedTracks, track_list, artist_info.name, true)
          }
          onStopDownload={download.handleStopDownload}
          onOpenFolder={handleOpenFolder}
          onAlbumClick={metadata.handleAlbumClick}
          onArtistClick={async (artist) => {
            const artistUrl = await metadata.handleArtistClick(artist);
            if (artistUrl) {
              setSpotifyUrl(artistUrl);
            }
          }}
          onPageChange={setCurrentPage}
          onTrackClick={async (track) => {
            if (track.external_urls) {
              setSpotifyUrl(track.external_urls);
              await metadata.handleFetchMetadata(track.external_urls);
            }
          }}
        />
      );
    }

    return null;
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background flex flex-col">
        <TitleBar />
        <div className="flex-1 p-4 md:p-8">
          <div className="max-w-4xl mx-auto space-y-6">
            <Header version={CURRENT_VERSION} hasUpdate={hasUpdate} />
          
          {/* Download Progress Toast */}
          <DownloadProgressToast />

          {/* Timeout Dialog */}
          <Dialog
            open={metadata.showTimeoutDialog}
            onOpenChange={metadata.setShowTimeoutDialog}
          >
            <DialogContent className="sm:max-w-[425px] p-6 [&>button]:hidden">
              <div className="absolute right-4 top-4">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-70 hover:opacity-100"
                  onClick={() => metadata.setShowTimeoutDialog(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <DialogTitle className="text-sm font-medium">Fetch Artist</DialogTitle>
              <DialogDescription>
                Set timeout for fetching metadata. Longer timeout is recommended for artists
                with large discography.
              </DialogDescription>
              {metadata.pendingArtistName && (
                <div className="py-2">
                  <p className="font-medium bg-muted/50 rounded-md px-3 py-2">{metadata.pendingArtistName}</p>
                </div>
              )}
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="timeout">Timeout (seconds)</Label>
                  <Input
                    id="timeout"
                    type="number"
                    min="10"
                    max="600"
                    value={metadata.timeoutValue}
                    onChange={(e) => metadata.setTimeoutValue(Number(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Default: 60 seconds. For large discographies, try 300-600 seconds (5-10
                    minutes).
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => metadata.setShowTimeoutDialog(false)}
                >
                  Cancel
                </Button>
                <Button onClick={metadata.handleConfirmFetch}>
                  <Search className="h-4 w-4" />
                  Fetch
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Album Fetch Dialog */}
          <Dialog open={metadata.showAlbumDialog} onOpenChange={metadata.setShowAlbumDialog}>
            <DialogContent className="sm:max-w-[425px] p-6 [&>button]:hidden">
              <div className="absolute right-4 top-4">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-70 hover:opacity-100"
                  onClick={() => metadata.setShowAlbumDialog(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <DialogTitle className="text-sm font-medium">Fetch Album</DialogTitle>
              <DialogDescription>
                Do you want to fetch metadata for this album?
              </DialogDescription>
              {metadata.selectedAlbum && (
                <div className="py-2">
                  <p className="font-medium bg-muted/50 rounded-md px-3 py-2">{metadata.selectedAlbum.name}</p>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => metadata.setShowAlbumDialog(false)}>
                  Cancel
                </Button>
                <Button onClick={async () => {
                  const albumUrl = await metadata.handleConfirmAlbumFetch();
                  if (albumUrl) {
                    setSpotifyUrl(albumUrl);
                  }
                }}>
                  <Search className="h-4 w-4" />
                  Fetch Album
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <SearchBar
            url={spotifyUrl}
            loading={metadata.loading}
            onUrlChange={setSpotifyUrl}
            onFetch={handleFetchMetadata}
            history={fetchHistory}
            onHistorySelect={handleHistorySelect}
            onHistoryRemove={removeFromHistory}
            hasResult={!!metadata.metadata}
          />

            {metadata.metadata && renderMetadata()}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

export default App;
