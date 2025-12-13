import { useState, useRef } from "react";
import { downloadLyrics } from "@/lib/api";
import { getSettings, parseTemplate, type TemplateData } from "@/lib/settings";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { joinPath, sanitizePath } from "@/lib/utils";
import { logger } from "@/lib/logger";
import type { TrackMetadata } from "@/types/api";

export function useLyrics() {
  const [downloadingLyricsTrack, setDownloadingLyricsTrack] = useState<string | null>(null);
  const [downloadedLyrics, setDownloadedLyrics] = useState<Set<string>>(new Set());
  const [failedLyrics, setFailedLyrics] = useState<Set<string>>(new Set());
  const [skippedLyrics, setSkippedLyrics] = useState<Set<string>>(new Set());
  const [isBulkDownloadingLyrics, setIsBulkDownloadingLyrics] = useState(false);
  const [lyricsDownloadProgress, setLyricsDownloadProgress] = useState(0);
  const stopBulkDownloadRef = useRef(false);

  const handleDownloadLyrics = async (
    spotifyId: string,
    trackName: string,
    artistName: string,
    albumName?: string,
    playlistName?: string,
    position?: number
  ) => {
    if (!spotifyId) {
      toast.error("No Spotify ID found for this track");
      return;
    }

    logger.info(`downloading lyrics: ${trackName} - ${artistName}`);
    const settings = getSettings();
    setDownloadingLyricsTrack(spotifyId);

    try {
      const os = settings.operatingSystem;
      let outputDir = settings.downloadPath;

      // Build output path using template system
      const templateData: TemplateData = {
        artist: artistName,
        album: albumName,
        title: trackName,
        track: position,
        playlist: playlistName,
      };

      // For playlist/discography, prepend the folder name
      if (playlistName) {
        outputDir = joinPath(os, outputDir, sanitizePath(playlistName, os));
      }

      // Apply folder template
      if (settings.folderTemplate) {
        const folderPath = parseTemplate(settings.folderTemplate, templateData);
        if (folderPath) {
          const parts = folderPath.split("/").filter((p: string) => p.trim());
          for (const part of parts) {
            outputDir = joinPath(os, outputDir, sanitizePath(part, os));
          }
        }
      }

      const useAlbumTrackNumber = settings.folderTemplate?.includes("{album}") || false;

      const response = await downloadLyrics({
        spotify_id: spotifyId,
        track_name: trackName,
        artist_name: artistName,
        output_dir: outputDir,
        filename_format: settings.filenameTemplate || "{title}",
        track_number: settings.trackNumber,
        position: position || 0,
        use_album_track_number: useAlbumTrackNumber,
      });

      if (response.success) {
        if (response.already_exists) {
          toast.info("Lyrics file already exists");
          setSkippedLyrics((prev) => new Set(prev).add(spotifyId));
        } else {
          toast.success("Lyrics downloaded successfully");
          setDownloadedLyrics((prev) => new Set(prev).add(spotifyId));
        }
        setFailedLyrics((prev) => {
          const newSet = new Set(prev);
          newSet.delete(spotifyId);
          return newSet;
        });
      } else {
        toast.error(response.error || "Failed to download lyrics");
        setFailedLyrics((prev) => new Set(prev).add(spotifyId));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to download lyrics");
      setFailedLyrics((prev) => new Set(prev).add(spotifyId));
    } finally {
      setDownloadingLyricsTrack(null);
    }
  };

  const handleDownloadAllLyrics = async (
    tracks: TrackMetadata[],
    playlistName?: string,
    _isArtistDiscography?: boolean
  ) => {
    const tracksWithSpotifyId = tracks.filter((track) => track.spotify_id);

    if (tracksWithSpotifyId.length === 0) {
      toast.error("No tracks with Spotify ID available for lyrics download");
      return;
    }

    const settings = getSettings();
    setIsBulkDownloadingLyrics(true);
    setLyricsDownloadProgress(0);
    stopBulkDownloadRef.current = false;

    let completed = 0;
    let success = 0;
    let failed = 0;
    let skipped = 0;
    const total = tracksWithSpotifyId.length;

    for (const track of tracksWithSpotifyId) {
      if (stopBulkDownloadRef.current) {
        toast.info("Lyrics download stopped by user");
        break;
      }

      const id = track.spotify_id!;
      setDownloadingLyricsTrack(id);
      setLyricsDownloadProgress(Math.round((completed / total) * 100));

      try {
        const os = settings.operatingSystem;
        let outputDir = settings.downloadPath;

        // Build output path using template system
        const templateData: TemplateData = {
          artist: track.artists,
          album: track.album_name,
          title: track.name,
          track: track.track_number,
          playlist: playlistName,
        };

        // For playlist/discography, prepend the folder name
        if (playlistName) {
          outputDir = joinPath(os, outputDir, sanitizePath(playlistName, os));
        }

        // Apply folder template
        if (settings.folderTemplate) {
          const folderPath = parseTemplate(settings.folderTemplate, templateData);
          if (folderPath) {
            const parts = folderPath.split("/").filter((p: string) => p.trim());
            for (const part of parts) {
              outputDir = joinPath(os, outputDir, sanitizePath(part, os));
            }
          }
        }

        const useAlbumTrackNumber = settings.folderTemplate?.includes("{album}") || false;

        const response = await downloadLyrics({
          spotify_id: id,
          track_name: track.name,
          artist_name: track.artists,
          output_dir: outputDir,
          filename_format: settings.filenameTemplate || "{title}",
          track_number: settings.trackNumber,
          position: track.track_number || 0,
          use_album_track_number: useAlbumTrackNumber,
        });

        if (response.success) {
          if (response.already_exists) {
            skipped++;
            setSkippedLyrics((prev) => new Set(prev).add(id));
          } else {
            success++;
            setDownloadedLyrics((prev) => new Set(prev).add(id));
          }
          setFailedLyrics((prev) => {
            const newSet = new Set(prev);
            newSet.delete(id);
            return newSet;
          });
        } else {
          failed++;
          setFailedLyrics((prev) => new Set(prev).add(id));
        }
      } catch (err) {
        failed++;
        logger.error(`error downloading lyrics: ${track.name} - ${err}`);
        setFailedLyrics((prev) => new Set(prev).add(id));
      }

      completed++;
    }

    setDownloadingLyricsTrack(null);
    setIsBulkDownloadingLyrics(false);
    setLyricsDownloadProgress(0);

    if (!stopBulkDownloadRef.current) {
      toast.success(`Lyrics: ${success} downloaded, ${skipped} skipped, ${failed} failed`);
    }
  };

  const handleStopLyricsDownload = () => {
    logger.info("lyrics download stopped by user");
    stopBulkDownloadRef.current = true;
    toast.info("Stopping lyrics download...");
  };

  const resetLyricsState = () => {
    setDownloadedLyrics(new Set());
    setFailedLyrics(new Set());
    setSkippedLyrics(new Set());
  };

  return {
    downloadingLyricsTrack,
    downloadedLyrics,
    failedLyrics,
    skippedLyrics,
    isBulkDownloadingLyrics,
    lyricsDownloadProgress,
    handleDownloadLyrics,
    handleDownloadAllLyrics,
    handleStopLyricsDownload,
    resetLyricsState,
  };
}
