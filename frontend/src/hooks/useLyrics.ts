import { useState } from "react";
import { downloadLyrics } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { joinPath, sanitizePath } from "@/lib/utils";
import { logger } from "@/lib/logger";

export function useLyrics() {
  const [downloadingLyricsTrack, setDownloadingLyricsTrack] = useState<string | null>(null);
  const [downloadedLyrics, setDownloadedLyrics] = useState<Set<string>>(new Set());
  const [failedLyrics, setFailedLyrics] = useState<Set<string>>(new Set());
  const [skippedLyrics, setSkippedLyrics] = useState<Set<string>>(new Set());

  const handleDownloadLyrics = async (
    spotifyId: string,
    trackName: string,
    artistName: string,
    albumName?: string,
    playlistName?: string,
    isArtistDiscography?: boolean,
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

      // Build output path similar to audio download
      if (playlistName) {
        outputDir = joinPath(os, outputDir, sanitizePath(playlistName, os));

        if (isArtistDiscography) {
          if (settings.albumSubfolder && albumName) {
            outputDir = joinPath(os, outputDir, sanitizePath(albumName, os));
          }
        } else {
          if (settings.artistSubfolder && artistName) {
            outputDir = joinPath(os, outputDir, sanitizePath(artistName, os));
          }
          if (settings.albumSubfolder && albumName) {
            outputDir = joinPath(os, outputDir, sanitizePath(albumName, os));
          }
        }
      }

      const response = await downloadLyrics({
        spotify_id: spotifyId,
        track_name: trackName,
        artist_name: artistName,
        output_dir: outputDir,
        filename_format: settings.filenameFormat,
        track_number: settings.trackNumber,
        position: position || 0,
        use_album_track_number: settings.albumSubfolder,
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
    handleDownloadLyrics,
    resetLyricsState,
  };
}
