import { useState, useRef } from "react";
import { downloadCover } from "@/lib/api";
import { getSettings, parseTemplate, type TemplateData } from "@/lib/settings";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { joinPath, sanitizePath } from "@/lib/utils";
import { logger } from "@/lib/logger";
import type { TrackMetadata } from "@/types/api";

export function useCover() {
  const [downloadingCover, setDownloadingCover] = useState(false);
  const [downloadingCoverTrack, setDownloadingCoverTrack] = useState<string | null>(null);
  const [downloadedCovers, setDownloadedCovers] = useState<Set<string>>(new Set());
  const [failedCovers, setFailedCovers] = useState<Set<string>>(new Set());
  const [skippedCovers, setSkippedCovers] = useState<Set<string>>(new Set());
  const [isBulkDownloadingCovers, setIsBulkDownloadingCovers] = useState(false);
  const [coverDownloadProgress, setCoverDownloadProgress] = useState(0);
  const stopBulkDownloadRef = useRef(false);

  const handleDownloadCover = async (
    coverUrl: string,
    trackName: string,
    artistName: string,
    albumName?: string,
    playlistName?: string,
    position?: number,
    trackId?: string
  ) => {
    if (!coverUrl) {
      toast.error("No cover URL found for this track");
      return;
    }

    const id = trackId || `${trackName}-${artistName}`;
    logger.info(`downloading cover: ${trackName} - ${artistName}`);
    const settings = getSettings();
    setDownloadingCover(true);
    setDownloadingCoverTrack(id);

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

      const response = await downloadCover({
        cover_url: coverUrl,
        track_name: trackName,
        artist_name: artistName,
        output_dir: outputDir,
        filename_format: settings.filenameTemplate || "{title}",
        track_number: settings.trackNumber,
        position: position || 0,
      });

      if (response.success) {
        if (response.already_exists) {
          toast.info("Cover file already exists");
          setSkippedCovers((prev) => new Set(prev).add(id));
        } else {
          toast.success("Cover downloaded successfully");
          setDownloadedCovers((prev) => new Set(prev).add(id));
        }
        setFailedCovers((prev) => {
          const newSet = new Set(prev);
          newSet.delete(id);
          return newSet;
        });
      } else {
        toast.error(response.error || "Failed to download cover");
        setFailedCovers((prev) => new Set(prev).add(id));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to download cover");
      setFailedCovers((prev) => new Set(prev).add(id));
    } finally {
      setDownloadingCover(false);
      setDownloadingCoverTrack(null);
    }
  };

  const handleDownloadAllCovers = async (
    tracks: TrackMetadata[],
    playlistName?: string
  ) => {
    if (tracks.length === 0) {
      toast.error("No tracks to download covers");
      return;
    }

    const settings = getSettings();
    setIsBulkDownloadingCovers(true);
    setCoverDownloadProgress(0);
    stopBulkDownloadRef.current = false;

    let completed = 0;
    let success = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < tracks.length; i++) {
      if (stopBulkDownloadRef.current) {
        toast.info("Cover download stopped");
        break;
      }

      const track = tracks[i];
      if (!track.images) {
        completed++;
        setCoverDownloadProgress(Math.round((completed / tracks.length) * 100));
        continue;
      }

      const id = track.spotify_id || `${track.name}-${track.artists}`;
      setDownloadingCoverTrack(id);

      try {
        const os = settings.operatingSystem;
        let outputDir = settings.downloadPath;

        // Build output path using template system
        const templateData: TemplateData = {
          artist: track.artists,
          album: track.album_name,
          title: track.name,
          track: i + 1,
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

        const response = await downloadCover({
          cover_url: track.images,
          track_name: track.name,
          artist_name: track.artists,
          output_dir: outputDir,
          filename_format: settings.filenameTemplate || "{title}",
          track_number: settings.trackNumber,
          position: i + 1,
        });

        if (response.success) {
          if (response.already_exists) {
            skipped++;
            setSkippedCovers((prev) => new Set(prev).add(id));
          } else {
            success++;
            setDownloadedCovers((prev) => new Set(prev).add(id));
          }
        } else {
          failed++;
          setFailedCovers((prev) => new Set(prev).add(id));
        }
      } catch {
        failed++;
        setFailedCovers((prev) => new Set(prev).add(id));
      }

      completed++;
      setCoverDownloadProgress(Math.round((completed / tracks.length) * 100));
    }

    setDownloadingCoverTrack(null);
    setIsBulkDownloadingCovers(false);
    setCoverDownloadProgress(0);

    if (!stopBulkDownloadRef.current) {
      toast.success(`Covers: ${success} downloaded, ${skipped} skipped, ${failed} failed`);
    }
  };

  const handleStopCoverDownload = () => {
    stopBulkDownloadRef.current = true;
  };

  const resetCoverState = () => {
    setDownloadedCovers(new Set());
    setFailedCovers(new Set());
    setSkippedCovers(new Set());
  };

  return {
    downloadingCover,
    downloadingCoverTrack,
    downloadedCovers,
    failedCovers,
    skippedCovers,
    isBulkDownloadingCovers,
    coverDownloadProgress,
    handleDownloadCover,
    handleDownloadAllCovers,
    handleStopCoverDownload,
    resetCoverState,
  };
}
