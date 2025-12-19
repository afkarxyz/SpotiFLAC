import { useState, useRef } from "react";
import { downloadTrack } from "@/lib/api";
import { getSettings, parseTemplate, type TemplateData } from "@/lib/settings";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { joinPath, sanitizePath } from "@/lib/utils";
import { logger } from "@/lib/logger";
import type { TrackMetadata } from "@/types/api";

// Type definitions for new backend functions
interface CheckFileExistenceRequest {
  isrc: string;
  track_name: string;
  artist_name: string;
}

interface FileExistenceResult {
  isrc: string;
  exists: boolean;
  file_path?: string;
  track_name?: string;
  artist_name?: string;
}

// These functions will be available after Wails regenerates bindings
const CheckFilesExistence = (outputDir: string, tracks: CheckFileExistenceRequest[]): Promise<FileExistenceResult[]> =>
  (window as any)["go"]["main"]["App"]["CheckFilesExistence"](outputDir, tracks);
const SkipDownloadItem = (itemID: string, filePath: string): Promise<void> =>
  (window as any)["go"]["main"]["App"]["SkipDownloadItem"](itemID, filePath);

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    settings: any,
    trackName?: string,
    artistName?: string,
    albumName?: string,
    playlistName?: string,
    position?: number,
    spotifyId?: string,
    durationMs?: number,
    releaseYear?: string,
    albumArtist?: string,
    releaseDate?: string,
    coverUrl?: string,
    spotifyTrackNumber?: number,
    spotifyDiscNumber?: number,
    spotifyTotalTracks?: number
  ) => {
    const service = settings.downloader;

    const query = trackName && artistName ? `${trackName} ${artistName}` : undefined;
    const os = settings.operatingSystem;

    let outputDir = settings.downloadPath;
    let useAlbumTrackNumber = false;

    // Replace forward slashes in template data values to prevent them from being interpreted as path separators
    const placeholder = "__SLASH_PLACEHOLDER__";
    // Build template data for folder path
    const templateData: TemplateData = {
      artist: artistName?.replace(/\//g, placeholder),
      album: albumName?.replace(/\//g, placeholder),
      album_artist: albumArtist?.replace(/\//g, placeholder) || artistName?.replace(/\//g, placeholder),
      title: trackName?.replace(/\//g, placeholder),
      track: position,
      year: releaseYear,
      playlist: playlistName?.replace(/\//g, placeholder),
      isrc: isrc,
    };

    // For playlist/discography downloads, always create a folder with the playlist/artist name
    if (playlistName) {
      outputDir = joinPath(os, outputDir, sanitizePath(playlistName.replace(/\//g, " "), os));
    }

    // Apply folder template if available
    if (settings.folderTemplate) {
      const folderPath = parseTemplate(settings.folderTemplate, templateData);
      if (folderPath) {
        const parts = folderPath.split("/").filter((p: string) => p.trim());
        for (const part of parts) {
          // Restore any slashes that were in the original values as spaces
          const sanitizedPart = part.replace(new RegExp(placeholder, "g"), " ");
          outputDir = joinPath(os, outputDir, sanitizePath(sanitizedPart, os));
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
            album_artist: albumArtist,
            release_date: releaseDate,
            cover_url: coverUrl,
            output_dir: outputDir,
            filename_format: settings.filenameTemplate,
            track_number: settings.trackNumber,
            position,
            use_album_track_number: useAlbumTrackNumber,
            spotify_id: spotifyId,
            embed_lyrics: settings.embedLyrics,
            embed_max_quality_cover: settings.embedMaxQualityCover,
            service_url: streamingURLs.tidal_url,
            duration: durationSeconds,
            item_id: itemID, // Pass the same itemID through all attempts
            audio_format: settings.tidalQuality || "LOSSLESS", // Use default LOSSLESS for auto mode
            spotify_track_number: spotifyTrackNumber,
            spotify_disc_number: spotifyDiscNumber,
            spotify_total_tracks: spotifyTotalTracks,
          });

          if (tidalResponse.success) {
            logger.success(`tidal: ${trackName} - ${artistName}`);
            return tidalResponse;
          }
          logger.warning(`tidal failed, trying amazon...`);
        } catch (tidalErr) {
          logger.error(`tidal error: ${tidalErr}`);
        }
      }

      // Try Amazon second
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
            album_artist: albumArtist,
            release_date: releaseDate,
            cover_url: coverUrl,
            output_dir: outputDir,
            filename_format: settings.filenameTemplate,
            track_number: settings.trackNumber,
            position,
            use_album_track_number: useAlbumTrackNumber,
            spotify_id: spotifyId,
            embed_lyrics: settings.embedLyrics,
            embed_max_quality_cover: settings.embedMaxQualityCover,
            service_url: streamingURLs.amazon_url,
            item_id: itemID,
            spotify_track_number: spotifyTrackNumber,
            spotify_disc_number: spotifyDiscNumber,
            spotify_total_tracks: spotifyTotalTracks,
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
        album_artist: albumArtist,
        release_date: releaseDate,
        cover_url: coverUrl,
        output_dir: outputDir,
        filename_format: settings.filenameTemplate,
        track_number: settings.trackNumber,
        position,
        use_album_track_number: useAlbumTrackNumber,
        spotify_id: spotifyId,
        embed_lyrics: settings.embedLyrics,
        embed_max_quality_cover: settings.embedMaxQualityCover,
        duration: durationMs ? Math.round(durationMs / 1000) : undefined,
        item_id: itemID,
        audio_format: settings.qobuzQuality || "6", // Use default 6 (16-bit) for auto mode
        spotify_track_number: spotifyTrackNumber,
        spotify_disc_number: spotifyDiscNumber,
        spotify_total_tracks: spotifyTotalTracks,
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

    // Determine audio format based on service
    let audioFormat: string | undefined;
    if (service === "tidal") {
      audioFormat = settings.tidalQuality || "LOSSLESS";
    } else if (service === "qobuz") {
      audioFormat = settings.qobuzQuality || "6";
    }

    const singleServiceResponse = await downloadTrack({
      isrc,
      service: service as "tidal" | "qobuz" | "amazon",
      query,
      track_name: trackName,
      artist_name: artistName,
      album_name: albumName,
      album_artist: albumArtist,
      release_date: releaseDate,
      cover_url: coverUrl,
      output_dir: outputDir,
      filename_format: settings.filenameTemplate,
      track_number: settings.trackNumber,
      position,
      use_album_track_number: useAlbumTrackNumber,
      spotify_id: spotifyId,
      embed_lyrics: settings.embedLyrics,
      embed_max_quality_cover: settings.embedMaxQualityCover,
      duration: durationSecondsForFallback,
      item_id: itemID, // Pass itemID for tracking
      audio_format: audioFormat,
      spotify_track_number: spotifyTrackNumber,
      spotify_disc_number: spotifyDiscNumber,
      spotify_total_tracks: spotifyTotalTracks,
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    releaseYear?: string,
    albumArtist?: string,
    releaseDate?: string,
    coverUrl?: string,
    spotifyTrackNumber?: number,
    spotifyDiscNumber?: number,
    spotifyTotalTracks?: number
  ) => {
    const service = settings.downloader;

    const query = trackName && artistName ? `${trackName} ${artistName}` : undefined;
    const os = settings.operatingSystem;

    let outputDir = settings.downloadPath;
    let useAlbumTrackNumber = false;
    // Replace forward slashes in template data values to prevent them from being interpreted as path separators
    const placeholder = "__SLASH_PLACEHOLDER__";
    const templateData: TemplateData = {
      artist: artistName?.replace(/\//g, placeholder),
      album: albumName?.replace(/\//g, placeholder),
      album_artist: albumArtist?.replace(/\//g, placeholder) || artistName?.replace(/\//g, placeholder),
      title: trackName?.replace(/\//g, placeholder),
      track: position,
      year: releaseYear,
      playlist: folderName?.replace(/\//g, placeholder),
      isrc: isrc,
    };

    // For playlist/discography downloads, always create a folder with the playlist/artist name
    if (folderName && !isAlbum) {
      outputDir = joinPath(os, outputDir, sanitizePath(folderName.replace(/\//g, " "), os));
    }

    // Apply folder template if available
    if (settings.folderTemplate) {
      // Parse and apply folder template
      const folderPath = parseTemplate(settings.folderTemplate, templateData);
      if (folderPath) {
        // Split by / (template separators), then restore placeholders as spaces
        const parts = folderPath.split("/").filter(p => p.trim());
        for (const part of parts) {
          // Restore any slashes that were in the original values as spaces
          const sanitizedPart = part.replace(new RegExp(placeholder, "g"), " ");
          outputDir = joinPath(os, outputDir, sanitizePath(sanitizedPart, os));
        }
      }
      
      // Use album track number if template contains {album}
      if (settings.folderTemplate.includes("{album}")) {
        useAlbumTrackNumber = true;
      }
    }

    if (service === "auto") {
      // Get all streaming URLs once from song.link API
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
            album_artist: albumArtist,
            release_date: releaseDate,
            cover_url: coverUrl,
            output_dir: outputDir,
            filename_format: settings.filenameTemplate,
            track_number: settings.trackNumber,
            position,
            use_album_track_number: useAlbumTrackNumber,
            spotify_id: spotifyId,
            embed_lyrics: settings.embedLyrics,
            embed_max_quality_cover: settings.embedMaxQualityCover,
            service_url: streamingURLs.tidal_url,
            duration: durationSeconds,
            item_id: itemID,
            audio_format: settings.tidalQuality || "LOSSLESS", // Use default LOSSLESS for auto mode
            spotify_track_number: spotifyTrackNumber,
            spotify_disc_number: spotifyDiscNumber,
            spotify_total_tracks: spotifyTotalTracks,
          });

          if (tidalResponse.success) {
            return tidalResponse;
          }
        } catch (tidalErr) {
          console.error("Tidal error:", tidalErr);
        }
      }

      // Try Amazon second
      if (streamingURLs?.amazon_url) {
        try {
          const amazonResponse = await downloadTrack({
            isrc,
            service: "amazon",
            query,
            track_name: trackName,
            artist_name: artistName,
            album_name: albumName,
            album_artist: albumArtist,
            release_date: releaseDate,
            cover_url: coverUrl,
            output_dir: outputDir,
            filename_format: settings.filenameTemplate,
            track_number: settings.trackNumber,
            position,
            use_album_track_number: useAlbumTrackNumber,
            spotify_id: spotifyId,
            embed_lyrics: settings.embedLyrics,
            embed_max_quality_cover: settings.embedMaxQualityCover,
            service_url: streamingURLs.amazon_url,
            item_id: itemID,
            spotify_track_number: spotifyTrackNumber,
            spotify_disc_number: spotifyDiscNumber,
            spotify_total_tracks: spotifyTotalTracks,
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
        album_artist: albumArtist,
        release_date: releaseDate,
        cover_url: coverUrl,
        output_dir: outputDir,
        filename_format: settings.filenameTemplate,
        track_number: settings.trackNumber,
        position,
        use_album_track_number: useAlbumTrackNumber,
        spotify_id: spotifyId,
        embed_lyrics: settings.embedLyrics,
        embed_max_quality_cover: settings.embedMaxQualityCover,
        duration: durationMs ? Math.round(durationMs / 1000) : undefined,
        item_id: itemID,
        audio_format: settings.qobuzQuality || "6", // Use default 6 (16-bit) for auto mode
        spotify_track_number: spotifyTrackNumber,
        spotify_disc_number: spotifyDiscNumber,
        spotify_total_tracks: spotifyTotalTracks,
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

    // Determine audio format based on service
    let audioFormat: string | undefined;
    if (service === "tidal") {
      audioFormat = settings.tidalQuality || "LOSSLESS";
    } else if (service === "qobuz") {
      audioFormat = settings.qobuzQuality || "6";
    }

    const singleServiceResponse = await downloadTrack({
      isrc,
      service: service as "tidal" | "qobuz" | "amazon",
      query,
      track_name: trackName,
      artist_name: artistName,
      album_name: albumName,
      album_artist: albumArtist,
      release_date: releaseDate,
      cover_url: coverUrl,
      output_dir: outputDir,
      filename_format: settings.filenameTemplate,
      track_number: settings.trackNumber,
      position,
      use_album_track_number: useAlbumTrackNumber,
      spotify_id: spotifyId,
      embed_lyrics: settings.embedLyrics,
      embed_max_quality_cover: settings.embedMaxQualityCover,
      duration: durationSecondsForFallback,
      item_id: itemID,
      audio_format: audioFormat,
      spotify_track_number: spotifyTrackNumber,
      spotify_disc_number: spotifyDiscNumber,
      spotify_total_tracks: spotifyTotalTracks,
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
    position?: number,
    albumArtist?: string,
    releaseDate?: string,
    coverUrl?: string,
    spotifyTrackNumber?: number,
    spotifyDiscNumber?: number,
    spotifyTotalTracks?: number
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
      // Extract year from release_date (format: YYYY-MM-DD or YYYY)
      const releaseYear = releaseDate?.substring(0, 4);
      
      const response = await downloadWithAutoFallback(
        isrc,
        settings,
        trackName,
        artistName,
        albumName,
        playlistName,
        position, // Pass position for track numbering
        spotifyId,
        durationMs,
        releaseYear,
        albumArtist || "",
        releaseDate,
        coverUrl,
        spotifyTrackNumber, // Spotify album track number
        spotifyDiscNumber,  // Spotify disc number
        spotifyTotalTracks  // Total tracks in album
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

    // Build output directory path
    let outputDir = settings.downloadPath;
    const os = settings.operatingSystem;
    if (folderName && !isAlbum) {
      outputDir = joinPath(os, outputDir, sanitizePath(folderName.replace(/\//g, " "), os));
    }

    // Get selected track objects
    const selectedTrackObjects = selectedTracks
      .map((isrc) => allTracks.find((t) => t.isrc === isrc))
      .filter((t): t is TrackMetadata => t !== undefined);

    // Check file existence in parallel first
    logger.info(`checking existing files in parallel...`);
    const existenceChecks = selectedTrackObjects.map((track) => ({
      isrc: track.isrc,
      track_name: track.name || "",
      artist_name: track.artists || "",
    }));

    const existenceResults = await CheckFilesExistence(outputDir, existenceChecks);
    const existingISRCs = new Set<string>();
    const existingFilePaths = new Map<string, string>();

    for (const result of existenceResults) {
      if (result.exists) {
        existingISRCs.add(result.isrc);
        existingFilePaths.set(result.isrc, result.file_path || "");
      }
    }

    logger.info(`found ${existingISRCs.size} existing files`);

    // Pre-add ALL tracks to the queue and mark existing ones as skipped
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

      // Mark existing files as skipped immediately
      if (existingISRCs.has(isrc)) {
        const filePath = existingFilePaths.get(isrc) || "";
        setTimeout(() => SkipDownloadItem(itemID, filePath), 10);
        setSkippedTracks((prev) => new Set(prev).add(isrc));
        setDownloadedTracks((prev) => new Set(prev).add(isrc));
      }
    }

    // Filter out existing tracks
    const tracksToDownload = selectedTrackObjects.filter((track) => !existingISRCs.has(track.isrc));

    let successCount = 0;
    let errorCount = 0;
    let skippedCount = existingISRCs.size;
    const total = selectedTracks.length;

    // Update progress to reflect already-skipped tracks
    setDownloadProgress(Math.round((skippedCount / total) * 100));

    for (let i = 0; i < tracksToDownload.length; i++) {
      if (shouldStopDownloadRef.current) {
        toast.info(
          `Download stopped. ${successCount} tracks downloaded, ${tracksToDownload.length - i} remaining.`
        );
        break;
      }

      const track = tracksToDownload[i];
      const isrc = track.isrc;
      // Find original index and itemID
      const originalIndex = selectedTracks.indexOf(isrc);
      const itemID = itemIDs[originalIndex];

      setDownloadingTrack(isrc);
      setCurrentDownloadInfo({ name: track.name, artists: track.artists });

      try {
        // Extract year from release_date (format: YYYY-MM-DD or YYYY)
        const releaseYear = track.release_date?.substring(0, 4);
        
        // Download with pre-created itemID
        const response = await downloadWithItemID(
          isrc,
          settings,
          itemID,
          track.name,
          track.artists,
          track.album_name,
          folderName,
          originalIndex + 1, // Sequential position based on selection order
          track.spotify_id,
          track.duration_ms,
          isAlbum,
          releaseYear,
          track.album_artist || "", // Use album_artist from Spotify metadata
          track.release_date,
          track.images, // Spotify cover URL
          track.track_number, // Spotify album track number
          track.disc_number,  // Spotify disc number
          track.total_tracks  // Total tracks in album
        );

        if (response.success) {
          if (response.already_exists) {
            skippedCount++;
            logger.info(`skipped: ${track.name} - ${track.artists} (already exists)`);
            setSkippedTracks((prev) => new Set(prev).add(isrc));
          } else {
            successCount++;
            logger.success(`downloaded: ${track.name} - ${track.artists}`);
          }
          setDownloadedTracks((prev) => new Set(prev).add(isrc));
          setFailedTracks((prev) => {
            const newSet = new Set(prev);
            newSet.delete(isrc); // Remove from failed if it was there
            return newSet;
          });
        } else {
          errorCount++;
          logger.error(`failed: ${track.name} - ${track.artists}`);
          setFailedTracks((prev) => new Set(prev).add(isrc));
        }
      } catch (err) {
        errorCount++;
        logger.error(`error: ${track.name} - ${err}`);
        setFailedTracks((prev) => new Set(prev).add(isrc));
        // Mark item as failed in queue
        const { MarkDownloadItemFailed } = await import("../../wailsjs/go/main/App");
        await MarkDownloadItemFailed(itemID, err instanceof Error ? err.message : String(err));
      }

      const completedCount = skippedCount + successCount + errorCount;
      setDownloadProgress(Math.min(100, Math.round((completedCount / total) * 100)));
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

    // Build output directory path
    let outputDir = settings.downloadPath;
    const os = settings.operatingSystem;
    if (folderName && !isAlbum) {
      outputDir = joinPath(os, outputDir, sanitizePath(folderName.replace(/\//g, " "), os));
    }

    // Check file existence in parallel first
    logger.info(`checking existing files in parallel...`);
    const existenceChecks = tracksWithIsrc.map((track) => ({
      isrc: track.isrc,
      track_name: track.name || "",
      artist_name: track.artists || "",
    }));

    const existenceResults = await CheckFilesExistence(outputDir, existenceChecks);
    const existingISRCs = new Set<string>();
    const existingFilePaths = new Map<string, string>();

    for (const result of existenceResults) {
      if (result.exists) {
        existingISRCs.add(result.isrc);
        existingFilePaths.set(result.isrc, result.file_path || "");
      }
    }

    logger.info(`found ${existingISRCs.size} existing files`);

    // Pre-add ALL tracks to the queue and mark existing ones as skipped
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

      // Mark existing files as skipped immediately
      if (existingISRCs.has(track.isrc)) {
        const filePath = existingFilePaths.get(track.isrc) || "";
        setTimeout(() => SkipDownloadItem(itemID, filePath), 10);
        setSkippedTracks((prev) => new Set(prev).add(track.isrc));
        setDownloadedTracks((prev) => new Set(prev).add(track.isrc));
      }
    }

    // Filter out existing tracks
    const tracksToDownload = tracksWithIsrc.filter((track) => !existingISRCs.has(track.isrc));

    let successCount = 0;
    let errorCount = 0;
    let skippedCount = existingISRCs.size;
    const total = tracksWithIsrc.length;

    // Update progress to reflect already-skipped tracks
    setDownloadProgress(Math.round((skippedCount / total) * 100));

    for (let i = 0; i < tracksToDownload.length; i++) {
      if (shouldStopDownloadRef.current) {
        toast.info(
          `Download stopped. ${successCount} tracks downloaded, ${tracksToDownload.length - i} remaining.`
        );
        break;
      }

      const track = tracksToDownload[i];
      // Find original index and itemID
      const originalIndex = tracksWithIsrc.findIndex((t) => t.isrc === track.isrc);
      const itemID = itemIDs[originalIndex];

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
          originalIndex + 1,
          track.spotify_id,
          track.duration_ms,
          isAlbum,
          releaseYear,
          track.album_artist || "", // Use album_artist from Spotify metadata
          track.release_date,
          track.images, // Spotify cover URL
          track.track_number, // Spotify album track number
          track.disc_number,  // Spotify disc number
          track.total_tracks  // Total tracks in album
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

      const completedCount = skippedCount + successCount + errorCount;
      setDownloadProgress(Math.min(100, Math.round((completedCount / total) * 100)));
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
