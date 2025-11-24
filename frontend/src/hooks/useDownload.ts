import { useState, useRef } from "react";
import { downloadTrack } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { joinPath, sanitizePath } from "@/lib/utils";
import type { TrackMetadata } from "@/types/api";

export function useDownload() {
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadingTrack, setDownloadingTrack] = useState<string | null>(null);
  const [bulkDownloadType, setBulkDownloadType] = useState<"all" | "selected" | null>(null);
  const [downloadedTracks, setDownloadedTracks] = useState<Set<string>>(new Set());
  const [failedTracks, setFailedTracks] = useState<Set<string>>(new Set());
  const [currentDownloadInfo, setCurrentDownloadInfo] = useState<{
    name: string;
    artists: string;
  } | null>(null);
  const shouldStopDownloadRef = useRef(false);

  const downloadWithAutoFallback = async (
    isrc: string,
    settings: any,
    trackName?: string,
    artistName?: string,
    albumName?: string,
    playlistName?: string,
    isArtistDiscography?: boolean,
    position?: number,
    spotifyId?: string
  ) => {
    let service = settings.downloader;

    const query = trackName && artistName ? `${trackName} ${artistName}` : undefined;
    const os = settings.operatingSystem;

    let outputDir = settings.downloadPath;
    let useAlbumTrackNumber = false;

    if (playlistName) {
      outputDir = joinPath(os, outputDir, sanitizePath(playlistName, os));

      if (isArtistDiscography) {
        if (settings.albumSubfolder && albumName) {
          outputDir = joinPath(os, outputDir, sanitizePath(albumName, os));
          useAlbumTrackNumber = true; // Use album track number for discography with album subfolder
        }
      } else {
        if (settings.artistSubfolder && artistName) {
          outputDir = joinPath(os, outputDir, sanitizePath(artistName, os));
        }

        if (settings.albumSubfolder && albumName) {
          outputDir = joinPath(os, outputDir, sanitizePath(albumName, os));
          useAlbumTrackNumber = true; // Use album track number when both artist and album subfolders are used
        }
      }
    }

    if (service === "auto") {
      // Get all streaming URLs once from song.link API
      let streamingURLs: any = null;
      if (spotifyId) {
        try {
          const { GetStreamingURLs } = await import("../../wailsjs/go/main/App");
          const urlsJson = await GetStreamingURLs(spotifyId);
          streamingURLs = JSON.parse(urlsJson);
        } catch (err) {
          console.error("Failed to get streaming URLs:", err);
        }
      }

      // Try Tidal first
      if (streamingURLs?.tidal_url) {
        try {
          const tidalResponse = await downloadTrack({
            isrc,
            service: "tidal",
            query,
            track_name: trackName,
            artist_name: artistName,
            album_name: albumName,
            output_dir: outputDir,
            filename_format: settings.filenameFormat,
            track_number: settings.trackNumber,
            position,
            use_album_track_number: useAlbumTrackNumber,
            spotify_id: spotifyId,
            service_url: streamingURLs.tidal_url,
          });

          if (tidalResponse.success) {
            return tidalResponse;
          }
          console.log("Tidal failed, trying Deezer...");
        } catch (tidalErr) {
          console.log("Tidal error:", tidalErr);
        }
      }

      // Try Deezer second
      if (streamingURLs?.deezer_url) {
        try {
          const deezerResponse = await downloadTrack({
            isrc,
            service: "deezer",
            query,
            track_name: trackName,
            artist_name: artistName,
            album_name: albumName,
            output_dir: outputDir,
            filename_format: settings.filenameFormat,
            track_number: settings.trackNumber,
            position,
            use_album_track_number: useAlbumTrackNumber,
            spotify_id: spotifyId,
            service_url: streamingURLs.deezer_url,
          });

          if (deezerResponse.success) {
            return deezerResponse;
          }
          console.log("Deezer failed, trying Amazon...");
        } catch (deezerErr) {
          console.log("Deezer error:", deezerErr);
        }
      }

      // Try Amazon third
      if (streamingURLs?.amazon_url) {
        try {
          const amazonResponse = await downloadTrack({
            isrc,
            service: "amazon",
            query,
            track_name: trackName,
            artist_name: artistName,
            album_name: albumName,
            output_dir: outputDir,
            filename_format: settings.filenameFormat,
            track_number: settings.trackNumber,
            position,
            use_album_track_number: useAlbumTrackNumber,
            spotify_id: spotifyId,
            service_url: streamingURLs.amazon_url,
          });

          if (amazonResponse.success) {
            return amazonResponse;
          }
          console.log("Amazon failed, trying Qobuz...");
        } catch (amazonErr) {
          console.log("Amazon error:", amazonErr);
        }
      }

      // Try Qobuz as last fallback
      service = "qobuz";
    }

    return await downloadTrack({
      isrc,
      service: service as "deezer" | "tidal" | "qobuz" | "amazon",
      query,
      track_name: trackName,
      artist_name: artistName,
      album_name: albumName,
      output_dir: outputDir,
      filename_format: settings.filenameFormat,
      track_number: settings.trackNumber,
      position,
      use_album_track_number: useAlbumTrackNumber,
      spotify_id: spotifyId,
    });
  };

  const handleDownloadTrack = async (
    isrc: string,
    trackName?: string,
    artistName?: string,
    albumName?: string,
    spotifyId?: string
  ) => {
    if (!isrc) {
      toast.error("No ISRC found for this track");
      return;
    }

    const settings = getSettings();
    setDownloadingTrack(isrc);

    try {
      // Single track download - no position parameter
      const response = await downloadWithAutoFallback(
        isrc,
        settings,
        trackName,
        artistName,
        albumName,
        undefined,
        false,
        undefined, // Don't pass position for single track
        spotifyId
      );

      if (response.success) {
        if (response.already_exists) {
          toast.info(response.message);
        } else {
          toast.success(response.message);
        }
        setDownloadedTracks((prev) => new Set(prev).add(isrc));
      } else {
        toast.error(response.error || "Download failed");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloadingTrack(null);
    }
  };

  const handleDownloadSelected = async (
    selectedTracks: string[],
    allTracks: TrackMetadata[],
    playlistName?: string,
    isArtistDiscography?: boolean
  ) => {
    if (selectedTracks.length === 0) {
      toast.error("No tracks selected");
      return;
    }

    const settings = getSettings();
    setIsDownloading(true);
    setBulkDownloadType("selected");
    setDownloadProgress(0);

    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    const total = selectedTracks.length;

    for (let i = 0; i < selectedTracks.length; i++) {
      if (shouldStopDownloadRef.current) {
        toast.info(
          `Download stopped. ${successCount} tracks downloaded, ${selectedTracks.length - i} skipped.`
        );
        break;
      }

      const isrc = selectedTracks[i];
      const track = allTracks.find((t) => t.isrc === isrc);

      setDownloadingTrack(isrc);

      if (track) {
        setCurrentDownloadInfo({ name: track.name, artists: track.artists });
      }

      try {
        // Use sequential numbering (1, 2, 3...) for selected tracks
        const response = await downloadWithAutoFallback(
          isrc,
          settings,
          track?.name,
          track?.artists,
          track?.album_name,
          playlistName,
          isArtistDiscography,
          i + 1, // Sequential position based on selection order
          track?.spotify_id
        );

        if (response.success) {
          if (response.already_exists) {
            skippedCount++;
            console.log(`Skipped: ${track?.name} - ${track?.artists} (already exists)`);
          } else {
            successCount++;
          }
          setDownloadedTracks((prev) => new Set(prev).add(isrc));
          setFailedTracks((prev) => {
            const newSet = new Set(prev);
            newSet.delete(isrc); // Remove from failed if it was there
            return newSet;
          });
        } else {
          errorCount++;
          setFailedTracks((prev) => new Set(prev).add(isrc));
        }
      } catch (err) {
        errorCount++;
        setFailedTracks((prev) => new Set(prev).add(isrc));
      }

      setDownloadProgress(Math.round(((i + 1) / total) * 100));
    }

    setDownloadingTrack(null);
    setCurrentDownloadInfo(null);
    setIsDownloading(false);
    setBulkDownloadType(null);
    shouldStopDownloadRef.current = false;

    // Build summary message
    if (errorCount === 0 && skippedCount === 0) {
      toast.success(`Downloaded ${successCount} tracks successfully`);
    } else if (errorCount === 0 && successCount === 0) {
      // All skipped
      toast.info(`${skippedCount} tracks already exist`);
    } else if (errorCount === 0) {
      // Mix of downloaded and skipped
      toast.info(`${successCount} downloaded, ${skippedCount} skipped`);
    } else {
      // Has errors
      const parts = [];
      if (successCount > 0) parts.push(`${successCount} downloaded`);
      if (skippedCount > 0) parts.push(`${skippedCount} skipped`);
      parts.push(`${errorCount} failed`);
      toast.warning(parts.join(", "));
    }
  };

  const handleDownloadAll = async (
    tracks: TrackMetadata[],
    playlistName?: string,
    isArtistDiscography?: boolean
  ) => {
    const tracksWithIsrc = tracks.filter((track) => track.isrc);

    if (tracksWithIsrc.length === 0) {
      toast.error("No tracks available for download");
      return;
    }

    const settings = getSettings();
    setIsDownloading(true);
    setBulkDownloadType("all");
    setDownloadProgress(0);

    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    const total = tracksWithIsrc.length;

    for (let i = 0; i < tracksWithIsrc.length; i++) {
      if (shouldStopDownloadRef.current) {
        toast.info(
          `Download stopped. ${successCount} tracks downloaded, ${tracksWithIsrc.length - i} skipped.`
        );
        break;
      }

      const track = tracksWithIsrc[i];

      setDownloadingTrack(track.isrc);
      setCurrentDownloadInfo({ name: track.name, artists: track.artists });

      try {
        const response = await downloadWithAutoFallback(
          track.isrc,
          settings,
          track.name,
          track.artists,
          track.album_name,
          playlistName,
          isArtistDiscography,
          i + 1,
          track.spotify_id
        );

        if (response.success) {
          if (response.already_exists) {
            skippedCount++;
            console.log(`Skipped: ${track.name} - ${track.artists} (already exists)`);
          } else {
            successCount++;
          }
          setDownloadedTracks((prev) => new Set(prev).add(track.isrc));
          setFailedTracks((prev) => {
            const newSet = new Set(prev);
            newSet.delete(track.isrc); // Remove from failed if it was there
            return newSet;
          });
        } else {
          errorCount++;
          setFailedTracks((prev) => new Set(prev).add(track.isrc));
        }
      } catch (err) {
        errorCount++;
        setFailedTracks((prev) => new Set(prev).add(track.isrc));
      }

      setDownloadProgress(Math.round(((i + 1) / total) * 100));
    }

    setDownloadingTrack(null);
    setCurrentDownloadInfo(null);
    setIsDownloading(false);
    setBulkDownloadType(null);
    shouldStopDownloadRef.current = false;

    // Build summary message
    if (errorCount === 0 && skippedCount === 0) {
      toast.success(`Downloaded ${successCount} tracks successfully`);
    } else if (errorCount === 0 && successCount === 0) {
      // All skipped
      toast.info(`${skippedCount} tracks already exist`);
    } else if (errorCount === 0) {
      // Mix of downloaded and skipped
      toast.info(`${successCount} downloaded, ${skippedCount} skipped`);
    } else {
      // Has errors
      const parts = [];
      if (successCount > 0) parts.push(`${successCount} downloaded`);
      if (skippedCount > 0) parts.push(`${skippedCount} skipped`);
      parts.push(`${errorCount} failed`);
      toast.warning(parts.join(", "));
    }
  };

  const handleStopDownload = () => {
    shouldStopDownloadRef.current = true;
    toast.info("Stopping download...");
  };

  const resetDownloadedTracks = () => {
    setDownloadedTracks(new Set());
    setFailedTracks(new Set());
  };

  return {
    downloadProgress,
    isDownloading,
    downloadingTrack,
    bulkDownloadType,
    downloadedTracks,
    failedTracks,
    currentDownloadInfo,
    handleDownloadTrack,
    handleDownloadSelected,
    handleDownloadAll,
    handleStopDownload,
    resetDownloadedTracks,
  };
}
