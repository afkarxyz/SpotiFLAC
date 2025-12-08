import { useState, useRef } from "react";
import { downloadTrack } from "@/lib/api";
import { getSettings, parseTemplate, type TemplateData } from "@/lib/settings";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { joinPath, sanitizePath } from "@/lib/utils";
import { logger } from "@/lib/logger";
import type { TrackMetadata } from "@/types/api";

export function useDownload() {
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadingTrack, setDownloadingTrack] = useState<string | null>(null);
  const [bulkDownloadType, setBulkDownloadType] = useState<"all" | "selected" | null>(null);
  const [downloadedTracks, setDownloadedTracks] = useState<Set<string>>(new Set());
  const [failedTracks, setFailedTracks] = useState<Set<string>>(new Set());
  const [skippedTracks, setSkippedTracks] = useState<Set<string>>(new Set());
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
    position?: number,
    spotifyId?: string,
    durationMs?: number,
    releaseYear?: string
  ) => {
    let service = settings.downloader;

    const query = trackName && artistName ? `${trackName} ${artistName}` : undefined;
    const os = settings.operatingSystem;

    let outputDir = settings.downloadPath;
    let useAlbumTrackNumber = false;

    // Build template data for folder path
    const templateData: TemplateData = {
      artist: artistName,
      album: albumName,
      title: trackName,
      track: position,
      year: releaseYear,
      playlist: playlistName,
      isrc: isrc,
    };

    // For playlist/discography downloads, always create a folder with the playlist/artist name
    if (playlistName) {
      outputDir = joinPath(os, outputDir, sanitizePath(playlistName, os));
    }

    // Apply folder template if available
    if (settings.folderTemplate) {
      const folderPath = parseTemplate(settings.folderTemplate, templateData);
      if (folderPath) {
        const parts = folderPath.split("/").filter((p: string) => p.trim());
        for (const part of parts) {
          outputDir = joinPath(os, outputDir, sanitizePath(part, os));
        }
      }
      
      // Use album track number if template contains {album}
      if (settings.folderTemplate.includes("{album}")) {
        useAlbumTrackNumber = true;
      }
    }

    // Always add item to queue before downloading
    const { AddToDownloadQueue } = await import("../../wailsjs/go/main/App");
    const itemID = await AddToDownloadQueue(isrc, trackName || "", artistName || "", albumName || "");

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

      // Convert duration from ms to seconds for backend
      const durationSeconds = durationMs ? Math.round(durationMs / 1000) : undefined;

      // Try Tidal first
      if (streamingURLs?.tidal_url) {
        try {
          logger.debug(`trying tidal for: ${trackName} - ${artistName}`);
          const tidalResponse = await downloadTrack({
            isrc,
            service: "tidal",
            query,
            track_name: trackName,
            artist_name: artistName,
            album_name: albumName,
            output_dir: outputDir,
            filename_format: settings.filenameTemplate,
            track_number: settings.trackNumber,
            position,
            use_album_track_number: useAlbumTrackNumber,
            spotify_id: spotifyId,
            service_url: streamingURLs.tidal_url,
            duration: durationSeconds,
            item_id: itemID, // Pass the same itemID through all attempts
          });

          if (tidalResponse.success) {
            logger.success(`tidal: ${trackName} - ${artistName}`);
            return tidalResponse;
          }
          logger.warning(`tidal failed, trying deezer...`);
        } catch (tidalErr) {
          logger.error(`tidal error: ${tidalErr}`);
        }
      }

      // Try Deezer second
      if (streamingURLs?.deezer_url) {
        try {
          logger.debug(`trying deezer for: ${trackName} - ${artistName}`);
          const deezerResponse = await downloadTrack({
            isrc,
            service: "deezer",
            query,
            track_name: trackName,
            artist_name: artistName,
            album_name: albumName,
            output_dir: outputDir,
            filename_format: settings.filenameTemplate,
            track_number: settings.trackNumber,
            position,
            use_album_track_number: useAlbumTrackNumber,
            spotify_id: spotifyId,
            service_url: streamingURLs.deezer_url,
            item_id: itemID,
          });

          if (deezerResponse.success) {
            logger.success(`deezer: ${trackName} - ${artistName}`);
            return deezerResponse;
          }
          logger.warning(`deezer failed, trying amazon...`);
        } catch (deezerErr) {
          logger.error(`deezer error: ${deezerErr}`);
        }
      }

      // Try Amazon third
      if (streamingURLs?.amazon_url) {
        try {
          logger.debug(`trying amazon for: ${trackName} - ${artistName}`);
          const amazonResponse = await downloadTrack({
            isrc,
            service: "amazon",
            query,
            track_name: trackName,
            artist_name: artistName,
            album_name: albumName,
            output_dir: outputDir,
            filename_format: settings.filenameTemplate,
            track_number: settings.trackNumber,
            position,
            use_album_track_number: useAlbumTrackNumber,
            spotify_id: spotifyId,
            service_url: streamingURLs.amazon_url,
            item_id: itemID,
          });

          if (amazonResponse.success) {
            logger.success(`amazon: ${trackName} - ${artistName}`);
            return amazonResponse;
          }
          logger.warning(`amazon failed, trying qobuz...`);
        } catch (amazonErr) {
          logger.error(`amazon error: ${amazonErr}`);
        }
      }

      // Try Qobuz as last fallback
      logger.debug(`trying qobuz (fallback) for: ${trackName} - ${artistName}`);
      const qobuzResponse = await downloadTrack({
        isrc,
        service: "qobuz",
        query,
        track_name: trackName,
        artist_name: artistName,
        album_name: albumName,
        output_dir: outputDir,
        filename_format: settings.filenameTemplate,
        track_number: settings.trackNumber,
        position,
        use_album_track_number: useAlbumTrackNumber,
        spotify_id: spotifyId,
        duration: durationMs ? Math.round(durationMs / 1000) : undefined,
        item_id: itemID,
      });

      // If Qobuz also failed, mark the item as failed
      if (!qobuzResponse.success) {
        const { MarkDownloadItemFailed } = await import("../../wailsjs/go/main/App");
        await MarkDownloadItemFailed(itemID, qobuzResponse.error || "All services failed");
      }

      return qobuzResponse;
    }

    // Single service download (not auto-fallback)
    // Convert duration from ms to seconds for backend
    const durationSecondsForFallback = durationMs ? Math.round(durationMs / 1000) : undefined;

    const singleServiceResponse = await downloadTrack({
      isrc,
      service: service as "deezer" | "tidal" | "qobuz" | "amazon",
      query,
      track_name: trackName,
      artist_name: artistName,
      album_name: albumName,
      output_dir: outputDir,
      filename_format: settings.filenameTemplate,
      track_number: settings.trackNumber,
      position,
      use_album_track_number: useAlbumTrackNumber,
      spotify_id: spotifyId,
      duration: durationSecondsForFallback,
      item_id: itemID, // Pass itemID for tracking
    });

    // Mark as failed if download failed for single-service attempt
    if (!singleServiceResponse.success) {
      const { MarkDownloadItemFailed } = await import("../../wailsjs/go/main/App");
      await MarkDownloadItemFailed(itemID, singleServiceResponse.error || "Download failed");
    }

    return singleServiceResponse;
  };

  const downloadWithItemID = async (
    isrc: string,
    settings: any,
    itemID: string,
    trackName?: string,
    artistName?: string,
    albumName?: string,
    folderName?: string,
    position?: number,
    spotifyId?: string,
    durationMs?: number,
    isAlbum?: boolean,
    releaseYear?: string
  ) => {
    let service = settings.downloader;

    const query = trackName && artistName ? `${trackName} ${artistName}` : undefined;
    const os = settings.operatingSystem;

    let outputDir = settings.downloadPath;
    let useAlbumTrackNumber = false;

    // Build template data for folder path
    const templateData: TemplateData = {
      artist: artistName,
      album: albumName,
      title: trackName,
      track: position,
      year: releaseYear,
      playlist: folderName,
      isrc: isrc,
    };

    // For playlist/discography downloads, always create a folder with the playlist/artist name
    if (folderName && !isAlbum) {
      outputDir = joinPath(os, outputDir, sanitizePath(folderName, os));
    }

    // Apply folder template if available
    if (settings.folderTemplate) {
      // Parse and apply folder template
      const folderPath = parseTemplate(settings.folderTemplate, templateData);
      if (folderPath) {
        // Split by / and sanitize each part
        const parts = folderPath.split("/").filter(p => p.trim());
        for (const part of parts) {
          outputDir = joinPath(os, outputDir, sanitizePath(part, os));
        }
      }
      
      // Use album track number if template contains {album}
      if (settings.folderTemplate.includes("{album}")) {
        useAlbumTrackNumber = true;
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

      const durationSeconds = durationMs ? Math.round(durationMs / 1000) : undefined;

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
            filename_format: settings.filenameTemplate,
            track_number: settings.trackNumber,
            position,
            use_album_track_number: useAlbumTrackNumber,
            spotify_id: spotifyId,
            service_url: streamingURLs.tidal_url,
            duration: durationSeconds,
            item_id: itemID,
          });

          if (tidalResponse.success) {
            return tidalResponse;
          }
        } catch (tidalErr) {
          console.error("Tidal error:", tidalErr);
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
            filename_format: settings.filenameTemplate,
            track_number: settings.trackNumber,
            position,
            use_album_track_number: useAlbumTrackNumber,
            spotify_id: spotifyId,
            service_url: streamingURLs.deezer_url,
            item_id: itemID,
          });

          if (deezerResponse.success) {
            return deezerResponse;
          }
        } catch (deezerErr) {
          console.error("Deezer error:", deezerErr);
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
            filename_format: settings.filenameTemplate,
            track_number: settings.trackNumber,
            position,
            use_album_track_number: useAlbumTrackNumber,
            spotify_id: spotifyId,
            service_url: streamingURLs.amazon_url,
            item_id: itemID,
          });

          if (amazonResponse.success) {
            return amazonResponse;
          }
        } catch (amazonErr) {
          console.error("Amazon error:", amazonErr);
        }
      }

      // Try Qobuz as last fallback
      const qobuzResponse = await downloadTrack({
        isrc,
        service: "qobuz",
        query,
        track_name: trackName,
        artist_name: artistName,
        album_name: albumName,
        output_dir: outputDir,
        filename_format: settings.filenameTemplate,
        track_number: settings.trackNumber,
        position,
        use_album_track_number: useAlbumTrackNumber,
        spotify_id: spotifyId,
        duration: durationMs ? Math.round(durationMs / 1000) : undefined,
        item_id: itemID,
      });

      // If Qobuz also failed, mark the item as failed
      if (!qobuzResponse.success) {
        const { MarkDownloadItemFailed } = await import("../../wailsjs/go/main/App");
        await MarkDownloadItemFailed(itemID, qobuzResponse.error || "All services failed");
      }

      return qobuzResponse;
    }

    // Single service download
    const durationSecondsForFallback = durationMs ? Math.round(durationMs / 1000) : undefined;

    const singleServiceResponse = await downloadTrack({
      isrc,
      service: service as "deezer" | "tidal" | "qobuz" | "amazon",
      query,
      track_name: trackName,
      artist_name: artistName,
      album_name: albumName,
      output_dir: outputDir,
      filename_format: settings.filenameTemplate,
      track_number: settings.trackNumber,
      position,
      use_album_track_number: useAlbumTrackNumber,
      spotify_id: spotifyId,
      duration: durationSecondsForFallback,
      item_id: itemID,
    });

    // Mark as failed if download failed for single-service attempt
    if (!singleServiceResponse.success) {
      const { MarkDownloadItemFailed } = await import("../../wailsjs/go/main/App");
      await MarkDownloadItemFailed(itemID, singleServiceResponse.error || "Download failed");
    }

    return singleServiceResponse;
  };

  const handleDownloadTrack = async (
    isrc: string,
    trackName?: string,
    artistName?: string,
    albumName?: string,
    spotifyId?: string,
    playlistName?: string,
    durationMs?: number,
    position?: number
  ) => {
    if (!isrc) {
      toast.error("No ISRC found for this track");
      return;
    }

    logger.info(`starting download: ${trackName} - ${artistName}`);
    const settings = getSettings();
    setDownloadingTrack(isrc);

    try {
      // Single track download - use playlistName if provided for folder structure
      const response = await downloadWithAutoFallback(
        isrc,
        settings,
        trackName,
        artistName,
        albumName,
        playlistName,
        position, // Pass position for track numbering
        spotifyId,
        durationMs
      );

      if (response.success) {
        if (response.already_exists) {
          toast.info(response.message);
          setSkippedTracks((prev) => new Set(prev).add(isrc));
        } else {
          toast.success(response.message);
        }
        setDownloadedTracks((prev) => new Set(prev).add(isrc));
        setFailedTracks((prev) => {
          const newSet = new Set(prev);
          newSet.delete(isrc);
          return newSet;
        });
      } else {
        toast.error(response.error || "Download failed");
        setFailedTracks((prev) => new Set(prev).add(isrc));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
      setFailedTracks((prev) => new Set(prev).add(isrc));
    } finally {
      setDownloadingTrack(null);
    }
  };

  const handleDownloadSelected = async (
    selectedTracks: string[],
    allTracks: TrackMetadata[],
    folderName?: string,
    isAlbum?: boolean
  ) => {
    if (selectedTracks.length === 0) {
      toast.error("No tracks selected");
      return;
    }

    logger.info(`starting batch download: ${selectedTracks.length} selected tracks`);
    const settings = getSettings();
    setIsDownloading(true);
    setBulkDownloadType("selected");
    setDownloadProgress(0);

    // Pre-add ALL tracks to the queue before starting downloads
    const { AddToDownloadQueue } = await import("../../wailsjs/go/main/App");
    const itemIDs: string[] = [];
    for (const isrc of selectedTracks) {
      const track = allTracks.find((t) => t.isrc === isrc);
      const itemID = await AddToDownloadQueue(
        isrc,
        track?.name || "",
        track?.artists || "",
        track?.album_name || ""
      );
      itemIDs.push(itemID);
    }

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
      const itemID = itemIDs[i];

      setDownloadingTrack(isrc);

      if (track) {
        setCurrentDownloadInfo({ name: track.name, artists: track.artists });
      }

      try {
        // Extract year from release_date (format: YYYY-MM-DD or YYYY)
        const releaseYear = track?.release_date?.substring(0, 4);
        
        // Download with pre-created itemID
        const response = await downloadWithItemID(
          isrc,
          settings,
          itemID,
          track?.name,
          track?.artists,
          track?.album_name,
          folderName,
          i + 1, // Sequential position based on selection order
          track?.spotify_id,
          track?.duration_ms,
          isAlbum,
          releaseYear
        );

        if (response.success) {
          if (response.already_exists) {
            skippedCount++;
            logger.info(`skipped: ${track?.name} - ${track?.artists} (already exists)`);
            setSkippedTracks((prev) => new Set(prev).add(isrc));
          } else {
            successCount++;
            logger.success(`downloaded: ${track?.name} - ${track?.artists}`);
          }
          setDownloadedTracks((prev) => new Set(prev).add(isrc));
          setFailedTracks((prev) => {
            const newSet = new Set(prev);
            newSet.delete(isrc); // Remove from failed if it was there
            return newSet;
          });
        } else {
          errorCount++;
          logger.error(`failed: ${track?.name} - ${track?.artists}`);
          setFailedTracks((prev) => new Set(prev).add(isrc));
        }
      } catch (err) {
        errorCount++;
        logger.error(`error: ${track?.name} - ${err}`);
        setFailedTracks((prev) => new Set(prev).add(isrc));
        // Mark item as failed in queue
        const { MarkDownloadItemFailed } = await import("../../wailsjs/go/main/App");
        await MarkDownloadItemFailed(itemID, err instanceof Error ? err.message : String(err));
      }

      setDownloadProgress(Math.round(((i + 1) / total) * 100));
    }

    setDownloadingTrack(null);
    setCurrentDownloadInfo(null);
    setIsDownloading(false);
    setBulkDownloadType(null);
    shouldStopDownloadRef.current = false;

    // Cancel any remaining queued items
    const { CancelAllQueuedItems } = await import("../../wailsjs/go/main/App");
    await CancelAllQueuedItems();

    // Build summary message
    logger.info(`batch complete: ${successCount} downloaded, ${skippedCount} skipped, ${errorCount} failed`);
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
    folderName?: string,
    isAlbum?: boolean
  ) => {
    const tracksWithIsrc = tracks.filter((track) => track.isrc);

    if (tracksWithIsrc.length === 0) {
      toast.error("No tracks available for download");
      return;
    }

    logger.info(`starting batch download: ${tracksWithIsrc.length} tracks`);
    const settings = getSettings();
    setIsDownloading(true);
    setBulkDownloadType("all");
    setDownloadProgress(0);

    // Pre-add ALL tracks to the queue before starting downloads
    const { AddToDownloadQueue } = await import("../../wailsjs/go/main/App");
    const itemIDs: string[] = [];
    for (const track of tracksWithIsrc) {
      const itemID = await AddToDownloadQueue(
        track.isrc,
        track.name,
        track.artists,
        track.album_name || ""
      );
      itemIDs.push(itemID);
    }

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
      const itemID = itemIDs[i];

      setDownloadingTrack(track.isrc);
      setCurrentDownloadInfo({ name: track.name, artists: track.artists });

      try {
        // Extract year from release_date (format: YYYY-MM-DD or YYYY)
        const releaseYear = track.release_date?.substring(0, 4);
        
        const response = await downloadWithItemID(
          track.isrc,
          settings,
          itemID,
          track.name,
          track.artists,
          track.album_name,
          folderName,
          i + 1,
          track.spotify_id,
          track.duration_ms,
          isAlbum,
          releaseYear
        );

        if (response.success) {
          if (response.already_exists) {
            skippedCount++;
            logger.info(`skipped: ${track.name} - ${track.artists} (already exists)`);
            setSkippedTracks((prev) => new Set(prev).add(track.isrc));
          } else {
            successCount++;
            logger.success(`downloaded: ${track.name} - ${track.artists}`);
          }
          setDownloadedTracks((prev) => new Set(prev).add(track.isrc));
          setFailedTracks((prev) => {
            const newSet = new Set(prev);
            newSet.delete(track.isrc); // Remove from failed if it was there
            return newSet;
          });
        } else {
          errorCount++;
          logger.error(`failed: ${track.name} - ${track.artists}`);
          setFailedTracks((prev) => new Set(prev).add(track.isrc));
        }
      } catch (err) {
        errorCount++;
        logger.error(`error: ${track.name} - ${err}`);
        setFailedTracks((prev) => new Set(prev).add(track.isrc));
        // Mark item as failed in queue
        const { MarkDownloadItemFailed } = await import("../../wailsjs/go/main/App");
        await MarkDownloadItemFailed(itemID, err instanceof Error ? err.message : String(err));
      }

      setDownloadProgress(Math.round(((i + 1) / total) * 100));
    }

    setDownloadingTrack(null);
    setCurrentDownloadInfo(null);
    setIsDownloading(false);
    setBulkDownloadType(null);
    shouldStopDownloadRef.current = false;

    // Cancel any remaining queued items
    const { CancelAllQueuedItems: CancelQueued } = await import("../../wailsjs/go/main/App");
    await CancelQueued();

    // Build summary message
    logger.info(`batch complete: ${successCount} downloaded, ${skippedCount} skipped, ${errorCount} failed`);
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
    logger.info("download stopped by user");
    shouldStopDownloadRef.current = true;
    toast.info("Stopping download...");
  };

  const resetDownloadedTracks = () => {
    setDownloadedTracks(new Set());
    setFailedTracks(new Set());
    setSkippedTracks(new Set());
  };

  return {
    downloadProgress,
    isDownloading,
    downloadingTrack,
    bulkDownloadType,
    downloadedTracks,
    failedTracks,
    skippedTracks,
    currentDownloadInfo,
    handleDownloadTrack,
    handleDownloadSelected,
    handleDownloadAll,
    handleStopDownload,
    resetDownloadedTracks,
  };
}
