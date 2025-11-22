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
    isArtistDiscography?: boolean
  ) => {
    let service = settings.downloader;

    const query = trackName && artistName ? `${trackName} ${artistName}` : undefined;
    const os = settings.operatingSystem;

    let outputDir = settings.downloadPath;

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

        service = "deezer";
      } catch (tidalErr) {
        service = "deezer";
      }
    }

    return await downloadTrack({
      isrc,
      service: service as "deezer" | "tidal",
      query,
      output_dir: outputDir,
      filename_format: settings.filenameFormat,
      track_number: settings.trackNumber,
    });
  };

  const handleDownloadTrack = async (
    isrc: string,
    trackName?: string,
    artistName?: string,
    albumName?: string
  ) => {
    if (!isrc) {
      toast.error("No ISRC found for this track");
      return;
    }

    const settings = getSettings();
    setDownloadingTrack(isrc);

    try {
      const response = await downloadWithAutoFallback(
        isrc,
        settings,
        trackName,
        artistName,
        albumName,
        undefined,
        false
      );

      if (response.success) {
        toast.success(response.message);
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
          setDownloadedTracks((prev) => new Set(prev).add(isrc));
        } else {
          errorCount++;
        }
      } catch (err) {
        errorCount++;
      }

      setDownloadProgress(Math.round(((i + 1) / total) * 100));
    }

    setDownloadingTrack(null);
    setCurrentDownloadInfo(null);
    setIsDownloading(false);
    setBulkDownloadType(null);
    shouldStopDownloadRef.current = false;

    if (errorCount === 0) {
      toast.success(`Downloaded ${successCount} tracks successfully`);
    } else {
      toast.warning(`Downloaded ${successCount} tracks, ${errorCount} failed`);
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
          isArtistDiscography
        );

        if (response.success) {
          successCount++;
          setDownloadedTracks((prev) => new Set(prev).add(track.isrc));
        } else {
          errorCount++;
        }
      } catch (err) {
        errorCount++;
      }

      setDownloadProgress(Math.round(((i + 1) / total) * 100));
    }

    setDownloadingTrack(null);
    setCurrentDownloadInfo(null);
    setIsDownloading(false);
    setBulkDownloadType(null);
    shouldStopDownloadRef.current = false;

    if (errorCount === 0) {
      toast.success(`Downloaded ${successCount} tracks successfully`);
    } else {
      toast.warning(`Downloaded ${successCount} tracks, ${errorCount} failed`);
    }
  };

  const handleStopDownload = () => {
    shouldStopDownloadRef.current = true;
    toast.info("Stopping download...");
  };

  const resetDownloadedTracks = () => {
    setDownloadedTracks(new Set());
  };

  return {
    downloadProgress,
    isDownloading,
    downloadingTrack,
    bulkDownloadType,
    downloadedTracks,
    currentDownloadInfo,
    handleDownloadTrack,
    handleDownloadSelected,
    handleDownloadAll,
    handleStopDownload,
    resetDownloadedTracks,
  };
}
