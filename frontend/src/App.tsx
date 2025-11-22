import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getSettings, applyThemeMode } from "@/lib/settings";
import { applyTheme } from "@/lib/themes";
import { OpenFolder } from "../wailsjs/go/main/App";
import { toastWithSound as toast } from "@/lib/toast-with-sound";

// Components
import { Header } from "@/components/Header";
import { SearchBar } from "@/components/SearchBar";
import { TrackInfo } from "@/components/TrackInfo";
import { AlbumInfo } from "@/components/AlbumInfo";
import { PlaylistInfo } from "@/components/PlaylistInfo";
import { ArtistInfo } from "@/components/ArtistInfo";

// Hooks
import { useDownload } from "@/hooks/useDownload";
import { useMetadata } from "@/hooks/useMetadata";

function App() {
  const [spotifyUrl, setSpotifyUrl] = useState("");
  const [selectedTracks, setSelectedTracks] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<string>("default");
  const [currentPage, setCurrentPage] = useState(1);
  const [hasUpdate, setHasUpdate] = useState(false);

  const ITEMS_PER_PAGE = 50;
  const CURRENT_VERSION = "5.7";

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
        "https://raw.githubusercontent.com/afkarxyz/SpotiFLAC/refs/heads/main/version.json"
      );
      const data = await response.json();
      const latestVersion = data.version;

      if (latestVersion > CURRENT_VERSION) {
        setHasUpdate(true);
      }
    } catch (err) {
      console.error("Failed to check for updates:", err);
    }
  };

  const handleFetchMetadata = async () => {
    const updatedUrl = await metadata.handleFetchMetadata(spotifyUrl);
    if (updatedUrl) {
      setSpotifyUrl(updatedUrl);
    }
  };

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
          onPageChange={setCurrentPage}
        />
      );
    }

    return null;
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background p-4 md:p-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <Header version={CURRENT_VERSION} hasUpdate={hasUpdate} />

          {/* Timeout Dialog */}
          <Dialog
            open={metadata.showTimeoutDialog}
            onOpenChange={metadata.setShowTimeoutDialog}
          >
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Fetch Settings</DialogTitle>
                <DialogDescription>
                  Set timeout for fetching metadata. Longer timeout is recommended for artists
                  with large discography.
                </DialogDescription>
              </DialogHeader>
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
                  <Search className="h-4 w-4 mr-2" />
                  Fetch
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Album Fetch Dialog */}
          <Dialog open={metadata.showAlbumDialog} onOpenChange={metadata.setShowAlbumDialog}>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Fetch Album</DialogTitle>
                <DialogDescription>
                  Do you want to fetch metadata for this album?
                </DialogDescription>
              </DialogHeader>
              {metadata.selectedAlbum && (
                <div className="py-4">
                  <p className="font-medium">{metadata.selectedAlbum.name}</p>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => metadata.setShowAlbumDialog(false)}>
                  Cancel
                </Button>
                <Button onClick={metadata.handleConfirmAlbumFetch}>
                  <Search className="h-4 w-4 mr-2" />
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
          />

          {metadata.metadata && renderMetadata()}
        </div>
      </div>
    </TooltipProvider>
  );
}

export default App;
