import { useState, useEffect, useCallback } from "react";
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
import { Search, X, ArrowUp } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getSettings, getSettingsWithDefaults, saveSettings, applyThemeMode, applyFont } from "@/lib/settings";
import { applyTheme } from "@/lib/themes";
import { OpenFolder } from "../wailsjs/go/main/App";
import { toastWithSound as toast } from "@/lib/toast-with-sound";

// Components
import { TitleBar } from "@/components/TitleBar";
import { Sidebar, type PageType } from "@/components/Sidebar";
import { Header } from "@/components/Header";
import { SearchBar } from "@/components/SearchBar";
import { TrackInfo } from "@/components/TrackInfo";
import { AlbumInfo } from "@/components/AlbumInfo";
import { PlaylistInfo } from "@/components/PlaylistInfo";
import { ArtistInfo } from "@/components/ArtistInfo";
import { DownloadQueue } from "@/components/DownloadQueue";
import { DownloadProgressToast } from "@/components/DownloadProgressToast";
import { AudioAnalysisPage } from "@/components/AudioAnalysisPage";
import { AudioConverterPage } from "@/components/AudioConverterPage";
import { FileManagerPage } from "@/components/FileManagerPage";
import { CSVImportPage } from "@/components/CSVImportPage";
import { SettingsPage } from "@/components/SettingsPage";
import { DebugLoggerPage } from "@/components/DebugLoggerPage";
import type { HistoryItem } from "@/components/FetchHistory";

// Hooks
import { useDownload } from "@/hooks/useDownload";
import { useMetadata } from "@/hooks/useMetadata";
import { useLyrics } from "@/hooks/useLyrics";
import { useCover } from "@/hooks/useCover";
import { useAvailability } from "@/hooks/useAvailability";
import { useDownloadQueueDialog } from "@/hooks/useDownloadQueueDialog";

const HISTORY_KEY = "spotiflac_fetch_history";
const MAX_HISTORY = 5;

function App() {
  const [currentPage, setCurrentPage] = useState<PageType>("main");
  const [spotifyUrl, setSpotifyUrl] = useState("");
  const [selectedTracks, setSelectedTracks] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<string>("default");
  const [currentListPage, setCurrentListPage] = useState(1);
  const [hasUpdate, setHasUpdate] = useState(false);
  const [releaseDate, setReleaseDate] = useState<string | null>(null);
  const [fetchHistory, setFetchHistory] = useState<HistoryItem[]>([]);
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);

  const ITEMS_PER_PAGE = 50;
  const CURRENT_VERSION = "7.0";

  const download = useDownload();
  const metadata = useMetadata();
  const lyrics = useLyrics();
  const cover = useCover();
  const availability = useAvailability();
  const downloadQueue = useDownloadQueueDialog();


  useEffect(() => {
    const initSettings = async () => {
      const settings = getSettings();
      applyThemeMode(settings.themeMode);
      applyTheme(settings.theme);
      applyFont(settings.fontFamily);

      // Initialize default download path if not set
      if (!settings.downloadPath) {
        const settingsWithDefaults = await getSettingsWithDefaults();
        saveSettings(settingsWithDefaults);
      }
    };
    initSettings();

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

    // Scroll listener for jump to top button
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 300);
    };
    window.addEventListener("scroll", handleScroll);

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  useEffect(() => {
    setSelectedTracks([]);
    setSearchQuery("");
    download.resetDownloadedTracks();
    lyrics.resetLyricsState();
    cover.resetCoverState();
    availability.clearAvailability();
    setSortBy("default");
    setCurrentListPage(1);
  }, [metadata.metadata]);

  const checkForUpdates = async () => {
    try {
      const response = await fetch(
        "https://api.github.com/repos/afkarxyz/SpotiFLAC/releases/latest"
      );
      const data = await response.json();
      const latestVersion = data.tag_name?.replace(/^v/, "") || "";

      if (data.published_at) {
        setReleaseDate(data.published_at);
      }

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
    setCurrentListPage(1);
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
          isSkipped={download.skippedTracks.has(track.isrc)}
          downloadingLyricsTrack={lyrics.downloadingLyricsTrack}
          downloadedLyrics={lyrics.downloadedLyrics.has(track.spotify_id || "")}
          failedLyrics={lyrics.failedLyrics.has(track.spotify_id || "")}
          skippedLyrics={lyrics.skippedLyrics.has(track.spotify_id || "")}
          checkingAvailability={availability.checkingTrackId === track.spotify_id}
          availability={availability.getAvailability(track.spotify_id || "")}
          downloadingCover={cover.downloadingCover}
          downloadedCover={cover.downloadedCovers.has(track.spotify_id || "")}
          failedCover={cover.failedCovers.has(track.spotify_id || "")}
          skippedCover={cover.skippedCovers.has(track.spotify_id || "")}
          onDownload={download.handleDownloadTrack}
          onDownloadLyrics={(spotifyId, name, artists, albumName, albumArtist, releaseDate, discNumber) =>
            lyrics.handleDownloadLyrics(spotifyId, name, artists, albumName, undefined, undefined, albumArtist, releaseDate, discNumber)
          }
          onCheckAvailability={availability.checkAvailability}
          onDownloadCover={(coverUrl, trackName, artistName, albumName, _playlistName, _position, trackId, albumArtist, releaseDate, discNumber) =>
            cover.handleDownloadCover(coverUrl, trackName, artistName, albumName, undefined, undefined, trackId, albumArtist, releaseDate, discNumber)
          }
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
          currentPage={currentListPage}
          itemsPerPage={ITEMS_PER_PAGE}
          downloadedLyrics={lyrics.downloadedLyrics}
          failedLyrics={lyrics.failedLyrics}
          skippedLyrics={lyrics.skippedLyrics}
          downloadingLyricsTrack={lyrics.downloadingLyricsTrack}
          checkingAvailabilityTrack={availability.checkingTrackId}
          availabilityMap={availability.availabilityMap}
          downloadedCovers={cover.downloadedCovers}
          failedCovers={cover.failedCovers}
          skippedCovers={cover.skippedCovers}
          downloadingCoverTrack={cover.downloadingCoverTrack}
          isBulkDownloadingCovers={cover.isBulkDownloadingCovers}
          isBulkDownloadingLyrics={lyrics.isBulkDownloadingLyrics}
          onSearchChange={handleSearchChange}
          onSortChange={setSortBy}
          onToggleTrack={toggleTrackSelection}
          onToggleSelectAll={toggleSelectAll}
          onDownloadTrack={download.handleDownloadTrack}
          onDownloadLyrics={(spotifyId, name, artists, albumName, _folderName, _isArtistDiscography, position, albumArtist, releaseDate, discNumber) =>
            lyrics.handleDownloadLyrics(spotifyId, name, artists, albumName, album_info.name, position, albumArtist, releaseDate, discNumber, true)
          }
          onDownloadCover={(coverUrl, trackName, artistName, albumName, _folderName, _isArtistDiscography, position, trackId, albumArtist, releaseDate, discNumber) =>
            cover.handleDownloadCover(coverUrl, trackName, artistName, albumName, album_info.name, position, trackId, albumArtist, releaseDate, discNumber, true)
          }
          onCheckAvailability={availability.checkAvailability}
          onDownloadAllLyrics={() => lyrics.handleDownloadAllLyrics(track_list, album_info.name, undefined, true)}
          onDownloadAllCovers={() => cover.handleDownloadAllCovers(track_list, album_info.name, true)}
          onDownloadAll={() => download.handleDownloadAll(track_list, undefined, true)}
          onDownloadSelected={() =>
            download.handleDownloadSelected(selectedTracks, track_list, undefined, true)
          }
          onStopDownload={download.handleStopDownload}
          onOpenFolder={handleOpenFolder}
          onPageChange={setCurrentListPage}
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
          currentPage={currentListPage}
          itemsPerPage={ITEMS_PER_PAGE}
          downloadedLyrics={lyrics.downloadedLyrics}
          failedLyrics={lyrics.failedLyrics}
          skippedLyrics={lyrics.skippedLyrics}
          downloadingLyricsTrack={lyrics.downloadingLyricsTrack}
          checkingAvailabilityTrack={availability.checkingTrackId}
          availabilityMap={availability.availabilityMap}
          downloadedCovers={cover.downloadedCovers}
          failedCovers={cover.failedCovers}
          skippedCovers={cover.skippedCovers}
          downloadingCoverTrack={cover.downloadingCoverTrack}
          isBulkDownloadingCovers={cover.isBulkDownloadingCovers}
          isBulkDownloadingLyrics={lyrics.isBulkDownloadingLyrics}
          onSearchChange={handleSearchChange}
          onSortChange={setSortBy}
          onToggleTrack={toggleTrackSelection}
          onToggleSelectAll={toggleSelectAll}
          onDownloadTrack={download.handleDownloadTrack}
          onDownloadLyrics={(spotifyId, name, artists, albumName, _folderName, _isArtistDiscography, position, albumArtist, releaseDate, discNumber) =>
            lyrics.handleDownloadLyrics(spotifyId, name, artists, albumName, playlist_info.owner.name, position, albumArtist, releaseDate, discNumber)
          }
          onDownloadCover={(coverUrl, trackName, artistName, albumName, _folderName, _isArtistDiscography, position, trackId, albumArtist, releaseDate, discNumber) =>
            cover.handleDownloadCover(coverUrl, trackName, artistName, albumName, playlist_info.owner.name, position, trackId, albumArtist, releaseDate, discNumber)
          }
          onCheckAvailability={availability.checkAvailability}
          onDownloadAllLyrics={() => lyrics.handleDownloadAllLyrics(track_list, playlist_info.owner.name)}
          onDownloadAllCovers={() => cover.handleDownloadAllCovers(track_list, playlist_info.owner.name)}
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
          onPageChange={setCurrentListPage}
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
          currentPage={currentListPage}
          itemsPerPage={ITEMS_PER_PAGE}
          downloadedLyrics={lyrics.downloadedLyrics}
          failedLyrics={lyrics.failedLyrics}
          skippedLyrics={lyrics.skippedLyrics}
          downloadingLyricsTrack={lyrics.downloadingLyricsTrack}
          checkingAvailabilityTrack={availability.checkingTrackId}
          availabilityMap={availability.availabilityMap}
          downloadedCovers={cover.downloadedCovers}
          failedCovers={cover.failedCovers}
          skippedCovers={cover.skippedCovers}
          downloadingCoverTrack={cover.downloadingCoverTrack}
          isBulkDownloadingCovers={cover.isBulkDownloadingCovers}
          isBulkDownloadingLyrics={lyrics.isBulkDownloadingLyrics}
          onSearchChange={handleSearchChange}
          onSortChange={setSortBy}
          onToggleTrack={toggleTrackSelection}
          onToggleSelectAll={toggleSelectAll}
          onDownloadTrack={download.handleDownloadTrack}
          onDownloadLyrics={(spotifyId, name, artists, albumName, _folderName, _isArtistDiscography, position, albumArtist, releaseDate, discNumber) =>
            lyrics.handleDownloadLyrics(spotifyId, name, artists, albumName, artist_info.name, position, albumArtist, releaseDate, discNumber)
          }
          onDownloadCover={(coverUrl, trackName, artistName, albumName, _folderName, _isArtistDiscography, position, trackId, albumArtist, releaseDate, discNumber) =>
            cover.handleDownloadCover(coverUrl, trackName, artistName, albumName, artist_info.name, position, trackId, albumArtist, releaseDate, discNumber)
          }
          onCheckAvailability={availability.checkAvailability}
          onDownloadAllLyrics={() => lyrics.handleDownloadAllLyrics(track_list, artist_info.name)}
          onDownloadAllCovers={() => cover.handleDownloadAllCovers(track_list, artist_info.name)}
          onDownloadAll={() => download.handleDownloadAll(track_list, artist_info.name)}
          onDownloadSelected={() =>
            download.handleDownloadSelected(selectedTracks, track_list, artist_info.name)
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
          onPageChange={setCurrentListPage}
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


  const renderPage = () => {
    switch (currentPage) {
      case "settings":
        return <SettingsPage />;
      case "debug":
        return <DebugLoggerPage />;
      case "audio-analysis":
        return <AudioAnalysisPage />;
      case "audio-converter":
        return <AudioConverterPage />;
      case "file-manager":
        return <FileManagerPage />;
      case "csv-import":
        return null; // Rendered separately to keep mounted
      default:
        return (
          <>
            <Header
              version={CURRENT_VERSION}
              hasUpdate={hasUpdate}
              releaseDate={releaseDate}
            />

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
              onFetchUrl={async (url) => {
                setSpotifyUrl(url);
                const updatedUrl = await metadata.handleFetchMetadata(url);
                if (updatedUrl) {
                  setSpotifyUrl(updatedUrl);
                }
              }}
              history={fetchHistory}
              onHistorySelect={handleHistorySelect}
              onHistoryRemove={removeFromHistory}
              hasResult={!!metadata.metadata}
              searchMode={isSearchMode}
              onSearchModeChange={setIsSearchMode}
            />

            {!isSearchMode && metadata.metadata && renderMetadata()}
          </>
        );
    }
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background flex flex-col">
        <TitleBar />
        <Sidebar currentPage={currentPage} onPageChange={setCurrentPage} />

        {/* Main content area with sidebar offset */}
        <div className="flex-1 ml-14 mt-10 p-4 md:p-8">
          <div className="max-w-4xl mx-auto space-y-6">
            {/* Keep CSV Import Page mounted to preserve download state */}
            <div style={{ display: currentPage === "csv-import" ? "block" : "none" }}>
              <CSVImportPage onDownloadTrack={download.handleDownloadTrack} />
            </div>
            {/* Render other pages normally */}
            {currentPage !== "csv-import" && renderPage()}
          </div>
        </div>

        {/* Download Progress Toast - Bottom Left */}
        <DownloadProgressToast onClick={downloadQueue.openQueue} />

        {/* Download Queue Dialog */}
        <DownloadQueue
          isOpen={downloadQueue.isOpen}
          onClose={downloadQueue.closeQueue}
        />

        {/* Jump to Top Button - Bottom Right */}
        {showScrollTop && (
          <Button
            onClick={scrollToTop}
            className="fixed bottom-6 right-6 z-50 h-10 w-10 rounded-full shadow-lg"
            size="icon"
          >
            <ArrowUp className="h-5 w-5" />
          </Button>
        )}
      </div>
    </TooltipProvider>
  );
}

export default App;
