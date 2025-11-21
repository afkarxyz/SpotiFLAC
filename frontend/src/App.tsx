import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fetchSpotifyMetadata, downloadTrack } from "@/lib/api";
import type { SpotifyMetadataResponse, TrackMetadata } from "@/types/api";
import { Settings } from "@/components/Settings";
import { getSettings, applyThemeMode } from "@/lib/settings";
import { applyTheme } from "@/lib/themes";
import { Download, Search, CheckCircle, Info } from "lucide-react";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Spinner } from "@/components/ui/spinner";

function App() {
  const [spotifyUrl, setSpotifyUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [metadata, setMetadata] = useState<SpotifyMetadataResponse | null>(null);
  const [selectedTracks, setSelectedTracks] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadingTrack, setDownloadingTrack] = useState<string | null>(null);
  const [bulkDownloadType, setBulkDownloadType] = useState<'all' | 'selected' | null>(null);
  const [downloadedTracks, setDownloadedTracks] = useState<Set<string>>(new Set());
  const [currentDownloadInfo, setCurrentDownloadInfo] = useState<{ name: string; artists: string } | null>(null);
  const [showTimeoutDialog, setShowTimeoutDialog] = useState(false);
  const [timeoutValue, setTimeoutValue] = useState(60);
  const [pendingUrl, setPendingUrl] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [hasUpdate, setHasUpdate] = useState(false);
  const [showAlbumDialog, setShowAlbumDialog] = useState(false);
  const [selectedAlbum, setSelectedAlbum] = useState<{ id: string; name: string; external_urls: string } | null>(null);
  const shouldStopDownloadRef = useRef(false);
  
  const ITEMS_PER_PAGE = 50;
  const CURRENT_VERSION = "5.6";

  useEffect(() => {
    const settings = getSettings();
    applyThemeMode(settings.themeMode);
    applyTheme(settings.theme);

    // Listen for system theme changes when in auto mode
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      const currentSettings = getSettings();
      if (currentSettings.themeMode === "auto") {
        applyThemeMode("auto");
        applyTheme(currentSettings.theme);
      }
    };

    mediaQuery.addEventListener("change", handleChange);

    // Check for updates
    checkForUpdates();

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  const checkForUpdates = async () => {
    try {
      const response = await fetch('https://raw.githubusercontent.com/afkarxyz/SpotiFLAC/refs/heads/main/version.json');
      const data = await response.json();
      const latestVersion = data.version;
      
      // Compare versions (simple string comparison works for x.y format)
      if (latestVersion > CURRENT_VERSION) {
        setHasUpdate(true);
      }
    } catch (err) {
      // Silently fail if update check fails
      console.error('Failed to check for updates:', err);
    }
  };

  useEffect(() => {
    // Clear selection, search, downloaded tracks, and reset page when metadata changes
    setSelectedTracks([]);
    setSearchQuery("");
    setDownloadedTracks(new Set());
    setCurrentPage(1);
  }, [metadata]);

  const downloadWithAutoFallback = async (
    isrc: string, 
    settings: any, 
    trackName?: string, 
    artistName?: string, 
    albumName?: string,
    playlistName?: string,
    isArtistDiscography?: boolean
  ) => {
    let service = settings.downloader;
    
    // Build query for Tidal (title + artist)
    const query = trackName && artistName ? `${trackName} ${artistName}` : undefined;
    
    // Build output directory based on settings
    let outputDir = settings.downloadPath;
    
    // For playlist or artist discography downloads
    if (playlistName) {
      const sanitizedPlaylist = playlistName.replace(/[<>:"/\\|?*]/g, '_').trim();
      outputDir = `${settings.downloadPath}\\${sanitizedPlaylist}`;
      
      // For artist discography: only use album subfolder (artist is redundant)
      if (isArtistDiscography) {
        // Only add album subfolder if enabled
        if (settings.albumSubfolder && albumName) {
          const sanitizedAlbum = albumName.replace(/[<>:"/\\|?*]/g, '_').trim();
          outputDir = `${outputDir}\\${sanitizedAlbum}`;
        }
      } else {
        // For playlist: use both artist and album subfolders if enabled
        // Add artist subfolder if enabled
        if (settings.artistSubfolder && artistName) {
          const sanitizedArtist = artistName.replace(/[<>:"/\\|?*]/g, '_').trim();
          outputDir = `${outputDir}\\${sanitizedArtist}`;
        }
        
        // Add album subfolder if enabled
        if (settings.albumSubfolder && albumName) {
          const sanitizedAlbum = albumName.replace(/[<>:"/\\|?*]/g, '_').trim();
          outputDir = `${outputDir}\\${sanitizedAlbum}`;
        }
      }
    }
    
    // If auto mode, try Tidal first
    if (service === "auto") {
      try {
        const tidalResponse = await downloadTrack({
          isrc,
          service: "tidal",
          query,
          output_dir: outputDir,
          filename_format: settings.filenameFormat,
          track_number: settings.trackNumber,
        });

        if (tidalResponse.success) {
          return tidalResponse;
        }
        
        // Tidal failed, try Deezer
        service = "deezer";
      } catch (tidalErr) {
        service = "deezer";
      }
    }
    
    // Use selected service or fallback to Deezer
    return await downloadTrack({
      isrc,
      service: service as "deezer" | "tidal",
      query,
      output_dir: outputDir,
      filename_format: settings.filenameFormat,
      track_number: settings.trackNumber,
    });
  };

  const handleFetchMetadata = async () => {
    if (!spotifyUrl.trim()) {
      toast.error("Please enter a Spotify URL");
      return;
    }

    let urlToFetch = spotifyUrl.trim();
    const isArtistUrl = urlToFetch.includes('/artist/');
    
    // Auto-convert artist URL to discography
    if (isArtistUrl && !urlToFetch.includes('/discography')) {
      urlToFetch = urlToFetch.replace(/\/$/, '') + '/discography/all';
      setSpotifyUrl(urlToFetch);
    }

    // Show timeout dialog only for artist URLs
    if (isArtistUrl) {
      setPendingUrl(urlToFetch);
      setShowTimeoutDialog(true);
    } else {
      // Directly fetch for non-artist URLs (track, album, playlist)
      await fetchMetadataDirectly(urlToFetch);
    }
  };

  const fetchMetadataDirectly = async (url: string) => {
    setLoading(true);
    setMetadata(null);

    try {
      const data = await fetchSpotifyMetadata(url);
      setMetadata(data);
      toast.success("Metadata fetched successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to fetch metadata");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmFetch = async () => {
    setShowTimeoutDialog(false);
    setLoading(true);
    setMetadata(null);

    try {
      const data = await fetchSpotifyMetadata(pendingUrl, true, 1.0, timeoutValue);
      setMetadata(data);
      toast.success("Metadata fetched successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to fetch metadata");
    } finally {
      setLoading(false);
    }
  };

  const handleAlbumClick = (album: { id: string; name: string; external_urls: string }) => {
    setSelectedAlbum(album);
    setShowAlbumDialog(true);
  };

  const handleConfirmAlbumFetch = async () => {
    if (!selectedAlbum) return;
    
    setShowAlbumDialog(false);
    setLoading(true);
    setMetadata(null);

    try {
      const data = await fetchSpotifyMetadata(selectedAlbum.external_urls);
      setMetadata(data);
      toast.success("Album metadata fetched successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to fetch album metadata");
    } finally {
      setLoading(false);
      setSelectedAlbum(null);
    }
  };

  const handleDownloadTrack = async (isrc: string, trackName?: string, artistName?: string, albumName?: string) => {
    if (!isrc) {
      toast.error("No ISRC found for this track");
      return;
    }

    const settings = getSettings();
    setDownloadingTrack(isrc);
    
    try {
      // Single track download - no playlist folder
      const response = await downloadWithAutoFallback(isrc, settings, trackName, artistName, albumName, undefined, false);

      if (response.success) {
        toast.success(response.message);
        setDownloadedTracks(prev => new Set(prev).add(isrc));
      } else {
        toast.error(response.error || "Download failed");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloadingTrack(null);
    }
  };

  const handleDownloadSelected = async () => {
    if (selectedTracks.length === 0) {
      toast.error("No tracks selected");
      return;
    }

    const settings = getSettings();
    setIsDownloading(true);
    setBulkDownloadType('selected');
    setDownloadProgress(0);

    let successCount = 0;
    let errorCount = 0;
    const total = selectedTracks.length;

    // Get all tracks and playlist/album info from metadata
    let allTracks: TrackMetadata[] = [];
    let playlistName: string | undefined;
    let isArtistDiscography = false;
    
    if (metadata && "track_list" in metadata) {
      allTracks = metadata.track_list;
      
      // Get playlist/album name for folder structure
      if ("album_info" in metadata) {
        playlistName = metadata.album_info.name;
      } else if ("playlist_info" in metadata) {
        playlistName = metadata.playlist_info.owner.name;
      } else if ("artist_info" in metadata) {
        playlistName = metadata.artist_info.name;
        isArtistDiscography = true;
      }
    }

    for (let i = 0; i < selectedTracks.length; i++) {
      // Check if user clicked Stop
      if (shouldStopDownloadRef.current) {
        toast.info(`Download stopped. ${successCount} tracks downloaded, ${selectedTracks.length - i} skipped.`);
        break;
      }

      const isrc = selectedTracks[i];
      const track = allTracks.find(t => t.isrc === isrc);
      
      setDownloadingTrack(isrc); // Show spinner on this track
      
      // Set current download info for progress display
      if (track) {
        setCurrentDownloadInfo({ name: track.name, artists: track.artists });
      }
      
      try {
        const response = await downloadWithAutoFallback(
          isrc, 
          settings, 
          track?.name, 
          track?.artists,
          track?.album_name,
          playlistName,
          isArtistDiscography
        );

        if (response.success) {
          successCount++;
          setDownloadedTracks(prev => new Set(prev).add(isrc));
        } else {
          errorCount++;
        }
      } catch (err) {
        errorCount++;
      }

      setDownloadProgress(Math.round(((i + 1) / total) * 100));
    }

    setDownloadingTrack(null); // Clear spinner
    setCurrentDownloadInfo(null); // Clear download info
    setIsDownloading(false);
    setBulkDownloadType(null);
    shouldStopDownloadRef.current = false; // Reset flag

    if (errorCount === 0) {
      toast.success(`Downloaded ${successCount} tracks successfully`);
    } else {
      toast.warning(`Downloaded ${successCount} tracks, ${errorCount} failed`);
    }

    setSelectedTracks([]);
  };

  const handleDownloadAll = async (tracks: TrackMetadata[], playlistName?: string, isArtistDiscography?: boolean) => {
    const tracksWithIsrc = tracks.filter(track => track.isrc);

    if (tracksWithIsrc.length === 0) {
      toast.error("No tracks available for download");
      return;
    }

    const settings = getSettings();
    setIsDownloading(true);
    setBulkDownloadType('all');
    setDownloadProgress(0);

    let successCount = 0;
    let errorCount = 0;
    const total = tracksWithIsrc.length;

    for (let i = 0; i < tracksWithIsrc.length; i++) {
      // Check if user clicked Stop
      if (shouldStopDownloadRef.current) {
        toast.info(`Download stopped. ${successCount} tracks downloaded, ${tracksWithIsrc.length - i} skipped.`);
        break;
      }

      const track = tracksWithIsrc[i];
      
      setDownloadingTrack(track.isrc); // Show spinner on this track
      
      // Set current download info for progress display
      setCurrentDownloadInfo({ name: track.name, artists: track.artists });
      
      try {
        const response = await downloadWithAutoFallback(
          track.isrc, 
          settings, 
          track.name, 
          track.artists,
          track.album_name,
          playlistName,
          isArtistDiscography
        );

        if (response.success) {
          successCount++;
          setDownloadedTracks(prev => new Set(prev).add(track.isrc));
        } else {
          errorCount++;
        }
      } catch (err) {
        errorCount++;
      }

      setDownloadProgress(Math.round(((i + 1) / total) * 100));
    }

    setDownloadingTrack(null); // Clear spinner
    setCurrentDownloadInfo(null); // Clear download info
    setIsDownloading(false);
    setBulkDownloadType(null);
    shouldStopDownloadRef.current = false; // Reset flag

    if (errorCount === 0) {
      toast.success(`Downloaded ${successCount} tracks successfully`);
    } else {
      toast.warning(`Downloaded ${successCount} tracks, ${errorCount} failed`);
    }
  };

  const toggleTrackSelection = (isrc: string) => {
    setSelectedTracks(prev =>
      prev.includes(isrc)
        ? prev.filter(id => id !== isrc)
        : [...prev, isrc]
    );
  };

  const toggleSelectAll = (tracks: TrackMetadata[]) => {
    const tracksWithIsrc = tracks.filter(track => track.isrc).map(track => track.isrc);
    if (selectedTracks.length === tracksWithIsrc.length) {
      setSelectedTracks([]);
    } else {
      setSelectedTracks(tracksWithIsrc);
    }
  };

  const formatDuration = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setCurrentPage(1); // Reset to first page when searching
  };

  const handleStopDownload = () => {
    shouldStopDownloadRef.current = true;
    toast.info('Stopping download...');
  };

  const renderDownloadProgress = () => {
    if (!isDownloading) return null;
    
    return (
      <div className="w-full space-y-2 mt-4">
        <div className="flex items-center gap-2">
          <Progress value={downloadProgress} className="h-2 flex-1" />
          <Button 
            variant="destructive" 
            size="sm" 
            onClick={handleStopDownload}
          >
            Stop
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {downloadProgress}% - {currentDownloadInfo ? `${currentDownloadInfo.name} - ${currentDownloadInfo.artists}` : 'Preparing download...'}
        </p>
      </div>
    );
  };

  const renderTrackList = (tracks: TrackMetadata[], showCheckboxes: boolean = false, hideAlbumColumn: boolean = false) => {
    const filteredTracks = tracks.filter(track => {
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      return (
        track.name.toLowerCase().includes(query) ||
        track.artists.toLowerCase().includes(query) ||
        track.album_name.toLowerCase().includes(query)
      );
    });

    // Pagination
    const totalPages = Math.ceil(filteredTracks.length / ITEMS_PER_PAGE);
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const paginatedTracks = filteredTracks.slice(startIndex, endIndex);

    const tracksWithIsrc = filteredTracks.filter(track => track.isrc);
    const allSelected = tracksWithIsrc.length > 0 && tracksWithIsrc.every(track => selectedTracks.includes(track.isrc));

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
                      onCheckedChange={() => toggleSelectAll(filteredTracks)}
                    />
                  </th>
                )}
                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground w-12">#</th>
                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Title</th>
                {!hideAlbumColumn && <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground hidden md:table-cell">Album</th>}
                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground hidden lg:table-cell w-24">Duration</th>
                <th className="h-12 px-4 text-center align-middle font-medium text-muted-foreground w-32">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedTracks.map((track, index) => (
                <tr
                  key={index}
                  className="border-b transition-colors hover:bg-muted/50"
                >
                  {showCheckboxes && (
                    <td className="p-4 align-middle">
                      {track.isrc && (
                        <Checkbox
                          checked={selectedTracks.includes(track.isrc)}
                          onCheckedChange={() => toggleTrackSelection(track.isrc)}
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
                        </div>
                        <span className="text-sm text-muted-foreground">{track.artists}</span>
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
                        onClick={() => handleDownloadTrack(track.isrc, track.name, track.artists)}
                        size="sm"
                        disabled={isDownloading || downloadingTrack === track.isrc}
                      >
                        {downloadingTrack === track.isrc ? (
                          <Spinner />
                        ) : (
                          <>
                            <Download className="h-4 w-4 mr-2" />
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
        
        {/* Pagination */}
        {totalPages > 1 && (
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious 
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    if (currentPage > 1) setCurrentPage(currentPage - 1);
                  }}
                  className={currentPage === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                />
              </PaginationItem>
              
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                <PaginationItem key={page}>
                  <PaginationLink
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setCurrentPage(page);
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
                    if (currentPage < totalPages) setCurrentPage(currentPage + 1);
                  }}
                  className={currentPage === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        )}
      </div>
    );
  };

  const renderMetadata = () => {
    if (!metadata) return null;

    if ("track" in metadata) {
      const { track } = metadata;
      return (
        <Card>
          <CardContent className="pt-6">
            <div className="flex gap-6 items-start">
              {track.images && (
                <img
                  src={track.images}
                  alt={track.name}
                  className="w-48 h-48 rounded-md shadow-lg object-cover shrink-0"
                />
              )}
              <div className="flex-1 space-y-4 min-w-0">
                <div className="space-y-1">
                  <h1 className="text-3xl font-bold wrap-break-word">{track.name}</h1>
                  <p className="text-lg text-muted-foreground">{track.artists}</p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Album</p>
                    <p className="font-medium truncate">{track.album_name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Release Date</p>
                    <p className="font-medium">{track.release_date}</p>
                  </div>
                </div>
                {track.isrc && (
                  <div className="space-y-2">
                    <Button onClick={() => handleDownloadTrack(track.isrc, track.name, track.artists)} disabled={isDownloading || downloadingTrack === track.isrc}>
                      {downloadingTrack === track.isrc ? (
                        <Spinner />
                      ) : (
                        <>
                          <Download className="h-4 w-4 mr-2" />
                          Download
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      );
    }

    if ("album_info" in metadata) {
      const { album_info, track_list } = metadata;
      return (
        <div className="space-y-6">
          <Card>
            <CardContent className="pt-6">
              <div className="flex gap-6 items-start">
                {album_info.images && (
                  <img
                    src={album_info.images}
                    alt={album_info.name}
                    className="w-48 h-48 rounded-md shadow-lg object-cover"
                  />
                )}
                <div className="flex-1 space-y-4">
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Album</p>
                    <h2 className="text-4xl font-bold">{album_info.name}</h2>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{album_info.artists}</span>
                      <span>•</span>
                      <span>{album_info.release_date}</span>
                      <span>•</span>
                      <span>{album_info.total_tracks} songs</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={() => handleDownloadAll(track_list, album_info.name)} className="gap-2" disabled={isDownloading}>
                      {isDownloading && bulkDownloadType === 'all' ? (
                        <Spinner />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      Download All
                    </Button>
                    {selectedTracks.length > 0 && (
                      <Button onClick={handleDownloadSelected} variant="secondary" className="gap-2" disabled={isDownloading}>
                        {isDownloading && bulkDownloadType === 'selected' ? (
                          <Spinner />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                        Download Selected ({selectedTracks.length})
                      </Button>
                    )}
                  </div>
                  {renderDownloadProgress()}
                </div>
              </div>
            </CardContent>
          </Card>
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search tracks..."
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-10"
              />
            </div>
            {renderTrackList(track_list, true, true)}
          </div>
        </div>
      );
    }

    if ("playlist_info" in metadata) {
      const { playlist_info, track_list } = metadata;
      return (
        <div className="space-y-6">
          <Card>
            <CardContent className="pt-6">
              <div className="flex gap-6 items-start">
                {playlist_info.owner.images && (
                  <img
                    src={playlist_info.owner.images}
                    alt={playlist_info.owner.name}
                    className="w-48 h-48 rounded-md shadow-lg object-cover"
                  />
                )}
                <div className="flex-1 space-y-4">
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Playlist</p>
                    <h2 className="text-4xl font-bold">{playlist_info.owner.name}</h2>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{playlist_info.owner.display_name}</span>
                      <span>•</span>
                      <span>{playlist_info.tracks.total} songs</span>
                      <span>•</span>
                      <span>{playlist_info.followers.total.toLocaleString()} followers</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={() => handleDownloadAll(track_list, playlist_info.owner.name)} className="gap-2" disabled={isDownloading}>
                      {isDownloading && bulkDownloadType === 'all' ? (
                        <Spinner />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      Download All
                    </Button>
                    {selectedTracks.length > 0 && (
                      <Button onClick={handleDownloadSelected} variant="secondary" className="gap-2" disabled={isDownloading}>
                        {isDownloading && bulkDownloadType === 'selected' ? (
                          <Spinner />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                        Download Selected ({selectedTracks.length})
                      </Button>
                    )}
                  </div>
                  {renderDownloadProgress()}
                </div>
              </div>
            </CardContent>
          </Card>
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search tracks..."
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-10"
              />
            </div>
            {renderTrackList(track_list, true)}
          </div>
        </div>
      );
    }

    if ("artist_info" in metadata) {
      const { artist_info, album_list, track_list } = metadata;
      return (
        <div className="space-y-6">
          <Card>
            <CardContent className="pt-6">
              <div className="flex gap-6 items-start">
                {artist_info.images && (
                  <img
                    src={artist_info.images}
                    alt={artist_info.name}
                    className="w-48 h-48 rounded-full shadow-lg object-cover"
                  />
                )}
                <div className="flex-1 space-y-2">
                  <p className="text-sm font-medium">Artist</p>
                  <h2 className="text-4xl font-bold">{artist_info.name}</h2>
                  <div className="flex items-center gap-2 text-sm">
                    <span>{artist_info.followers.toLocaleString()} followers</span>
                    {artist_info.genres.length > 0 && (
                      <>
                        <span>•</span>
                        <span>{artist_info.genres.join(", ")}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {album_list.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-2xl font-bold">Discography</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {album_list.map((album) => (
                  <div 
                    key={album.id} 
                    className="group cursor-pointer"
                    onClick={() => handleAlbumClick({ id: album.id, name: album.name, external_urls: album.external_urls })}
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
                      {album.release_date?.split('-')[0]} • {album.album_type}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {track_list.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-2xl font-bold">Popular Tracks</h3>
                <div className="flex gap-2">
                  <Button onClick={() => handleDownloadAll(track_list, artist_info.name, true)} size="sm" className="gap-2" disabled={isDownloading}>
                    {isDownloading && bulkDownloadType === 'all' ? (
                      <Spinner />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                    Download All
                  </Button>
                  {selectedTracks.length > 0 && (
                    <Button onClick={handleDownloadSelected} size="sm" variant="secondary" className="gap-2" disabled={isDownloading}>
                      {isDownloading && bulkDownloadType === 'selected' ? (
                        <Spinner />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      Download Selected ({selectedTracks.length})
                    </Button>
                  )}
                </div>
              </div>
              {renderDownloadProgress()}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search tracks..."
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="pl-10"
                />
              </div>
              {renderTrackList(track_list, true)}
            </div>
          )}
        </div>
      );
    }

    if ("artist" in metadata) {
      const { artist } = metadata;
      return (
        <Card>
          <CardHeader>
            <CardTitle>Artist: {artist.name}</CardTitle>
            <CardDescription>
              {artist.followers.toLocaleString()} followers • Popularity: {artist.popularity}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {artist.images && (
              <img
                src={artist.images}
                alt={artist.name}
                className="w-48 h-48 rounded object-cover mb-4"
              />
            )}
            {artist.genres.length > 0 && (
              <div className="mt-4">
                <Label>Genres</Label>
                <p>{artist.genres.join(", ")}</p>
              </div>
            )}
          </CardContent>
        </Card>
      );
    }

    return null;
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background p-4 md:p-8">
        <div className="max-w-4xl mx-auto space-y-6">
        <div className="relative">
          <div className="text-center space-y-2">
            <div className="flex items-center justify-center gap-3">
              <img src="/icon.svg" alt="SpotiFLAC" className="w-12 h-12" />
              <h1 className="text-4xl font-bold">SpotiFLAC</h1>
              <div className="relative">
                <Badge variant="default" asChild>
                  <a 
                    href="https://github.com/afkarxyz/SpotiFLAC/releases" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="cursor-pointer hover:opacity-80 transition-opacity"
                  >
                    v{CURRENT_VERSION}
                  </a>
                </Badge>
                {hasUpdate && (
                  <span className="absolute -top-1 -right-1 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                  </span>
                )}
              </div>
            </div>
            <p className="text-muted-foreground">
              Get Spotify tracks in true FLAC from Tidal/Deezer — no account required.
            </p>
          </div>
          <div className="absolute right-0 top-0 flex gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="outline" 
                  size="icon"
                  asChild
                >
                  <a 
                    href="https://github.com/afkarxyz/SpotiFLAC/issues" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    aria-label="GitHub Issues"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="currentColor"
                    >
                      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                    </svg>
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Report bug or request feature</p>
              </TooltipContent>
            </Tooltip>
            <Settings />
          </div>
        </div>

        {/* Timeout Dialog */}
        <Dialog open={showTimeoutDialog} onOpenChange={setShowTimeoutDialog}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Fetch Settings</DialogTitle>
              <DialogDescription>
                Set timeout for fetching metadata. Longer timeout is recommended for artists with large discography.
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
                  value={timeoutValue}
                  onChange={(e) => setTimeoutValue(Number(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Default: 60 seconds. For large discographies, try 300-600 seconds (5-10 minutes).
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowTimeoutDialog(false)}>
                Cancel
              </Button>
              <Button onClick={handleConfirmFetch}>
                <Search className="h-4 w-4 mr-2" />
                Fetch
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Album Fetch Dialog */}
        <Dialog open={showAlbumDialog} onOpenChange={setShowAlbumDialog}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Fetch Album</DialogTitle>
              <DialogDescription>
                Do you want to fetch metadata for this album?
              </DialogDescription>
            </DialogHeader>
            {selectedAlbum && (
              <div className="py-4">
                <p className="font-medium">{selectedAlbum.name}</p>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAlbumDialog(false)}>
                Cancel
              </Button>
              <Button onClick={handleConfirmAlbumFetch}>
                <Search className="h-4 w-4 mr-2" />
                Fetch Album
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Card>
          <CardContent className="px-6 space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="spotify-url">Spotify URL</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <p>Supports track, album, playlist, and artist URLs</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex gap-2">
                <Input
                  id="spotify-url"
                  placeholder="https://open.spotify.com/..."
                  value={spotifyUrl}
                  onChange={(e) => setSpotifyUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleFetchMetadata()}
                />
                <Button onClick={handleFetchMetadata} disabled={loading}>
                  {loading ? (
                    <>
                      <Spinner />
                      Fetching...
                    </>
                  ) : (
                    <>
                      <Search className="h-4 w-4" />
                      Fetch
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {metadata && renderMetadata()}
        </div>
      </div>
    </TooltipProvider>
  );
}

export default App;
