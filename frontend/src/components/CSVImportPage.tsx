import { useState, useRef, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Upload, FileText, Download, CheckCircle, XCircle, Loader2, X, Image, Files } from "lucide-react";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { getSettings } from "@/lib/settings";
import { downloadCover, checkTrackExists } from "@/lib/api";
import { logger } from "@/lib/logger";
import type { CSVTrack } from "@/types/api";
import { SelectCSVFile, SelectMultipleCSVFiles, ParseCSVPlaylist, ParseMultipleCSVFiles, GetISRCWithFallback, GetSpotifyMetadata } from "../../wailsjs/go/main/App";

interface CSVImportPageProps {
  onDownloadTrack: (
    isrc: string,
    name: string,
    artists: string,
    albumName: string,
    spotifyId?: string,
    folderName?: string,
    durationMs?: number,
    position?: number,
    albumArtist?: string,
    releaseDate?: string,
    coverUrl?: string,
    spotifyTrackNumber?: number,
    spotifyDiscNumber?: number,
    spotifyTotalTracks?: number
  ) => void;
}

interface CSVFileInfo {
  filePath: string;
  fileName: string;
  playlistName: string;
  tracks: CSVTrack[];
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
}

export function CSVImportPage({ onDownloadTrack }: CSVImportPageProps) {
  const [csvFilePath, setCSVFilePath] = useState<string>("");
  const [playlistName, setPlaylistName] = useState<string>("");
  const [tracks, setTracks] = useState<CSVTrack[]>([]);
  const [csvFiles, setCsvFiles] = useState<CSVFileInfo[]>([]);
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [currentFileIndex, setCurrentFileIndex] = useState<number>(-1);
  const [isLoading, setIsLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0 });
  const [downloadedTracks, setDownloadedTracks] = useState<Set<string>>(new Set());
  const [failedTracks, setFailedTracks] = useState<Set<string>>(new Set());
  const [downloadingTrack, setDownloadingTrack] = useState<string | null>(null);
  const [isDownloadingCovers, setIsDownloadingCovers] = useState(false);
  const shouldStopDownloadRef = useRef(false);
  
  // Ref for the scrollable parent element
  const parentRef = useRef<HTMLDivElement>(null);
  
  // Virtual scrolling for large lists
  const rowVirtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 53, // Estimated row height in pixels
    overscan: 10, // Number of items to render outside of the visible area
  });

  const handleSelectCSV = useCallback(async () => {
    try {
      const filePath = await SelectCSVFile();
      if (filePath) {
        setCSVFilePath(filePath);
        setIsBatchMode(false);
        setCsvFiles([]);
        
        // Extract playlist name from filename (remove path and .csv extension)
        const fileName = filePath.split(/[/\\]/).pop() || "";
        const nameWithoutExt = fileName.replace(/\.csv$/i, "");
        setPlaylistName(nameWithoutExt);
        
        await parseCSV(filePath);
      }
    } catch (err) {
      toast.error("Failed to select CSV file");
      console.error(err);
    }
  }, []);

  const handleSelectMultipleCSV = useCallback(async () => {
    try {
      const filePaths = await SelectMultipleCSVFiles();
      if (filePaths && filePaths.length > 0) {
        setIsBatchMode(true);
        setCSVFilePath("");
        setTracks([]);
        setPlaylistName("");
        
        setIsLoading(true);
        const result = await ParseMultipleCSVFiles(filePaths);
        
        if (result.success && result.files) {
          const fileInfos: CSVFileInfo[] = result.files.map(file => {
            const fileName = file.file_name || file.file_path.split(/[/\\]/).pop() || "";
            const nameWithoutExt = fileName.replace(/\.csv$/i, "");
            
            return {
              filePath: file.file_path,
              fileName: fileName,
              playlistName: nameWithoutExt,
              tracks: file.tracks || [],
              status: file.success ? 'pending' : 'failed',
              error: file.error
            };
          });
          
          setCsvFiles(fileInfos);
          toast.success(`Loaded ${result.successful_files}/${result.total_files} CSV files with ${result.total_tracks} total tracks`);
        } else {
          toast.error(result.error || "Failed to parse CSV files");
        }
        setIsLoading(false);
      }
    } catch (err) {
      toast.error("Failed to select CSV files");
      console.error(err);
      setIsLoading(false);
    }
  }, []);

  const parseCSV = useCallback(async (filePath: string) => {
    setIsLoading(true);
    try {
      const result = await ParseCSVPlaylist(filePath);
      if (result.success && result.tracks) {
        setTracks(result.tracks);
        toast.success(`Loaded ${result.track_count} tracks from CSV`);
      } else {
        toast.error(result.error || "Failed to parse CSV file");
      }
    } catch (err) {
      toast.error("Failed to parse CSV file");
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleDownloadAll = useCallback(async () => {
    if (isBatchMode && csvFiles.length > 0) {
      // Batch mode: process CSV files one by one
      await handleDownloadAllBatch();
    } else if (tracks.length > 0) {
      // Single mode: download all tracks from current CSV
      await handleDownloadAllSingle();
    } else {
      toast.error("No tracks to download");
    }
  }, [isBatchMode, csvFiles, tracks]);

  const handleDownloadAllBatch = useCallback(async () => {
    const filesToProcess = csvFiles.filter(f => f.status === 'pending' || f.status === 'failed');
    
    if (filesToProcess.length === 0) {
      toast.error("No CSV files to process");
      return;
    }

    setIsDownloading(true);
    shouldStopDownloadRef.current = false;

    let totalSuccessCount = 0;
    let totalFailCount = 0;
    let totalSkippedCount = 0;

    for (let i = 0; i < csvFiles.length; i++) {
      if (shouldStopDownloadRef.current) {
        toast.info(`Batch download stopped at file ${i + 1}/${csvFiles.length}`);
        break;
      }

      const fileInfo = csvFiles[i];
      if (fileInfo.status !== 'pending' && fileInfo.status !== 'failed') {
        continue;
      }

      setCurrentFileIndex(i);
      setCsvFiles(prev => prev.map((f, idx) => 
        idx === i ? { ...f, status: 'processing' as const } : f
      ));

      logger.info(`[Batch CSV] Processing file ${i + 1}/${csvFiles.length}: ${fileInfo.fileName}`);
      toast.info(`Processing ${fileInfo.fileName} (${i + 1}/${csvFiles.length})`);

      try {
        const { successCount, failCount, skippedCount } = await processCSVFile(fileInfo);
        
        totalSuccessCount += successCount;
        totalFailCount += failCount;
        totalSkippedCount += skippedCount;

        setCsvFiles(prev => prev.map((f, idx) => 
          idx === i ? { ...f, status: 'completed' as const } : f
        ));

        logger.success(`[Batch CSV] Completed ${fileInfo.fileName}: ${successCount} success, ${failCount} failed, ${skippedCount} skipped`);
      } catch (err) {
        logger.error(`[Batch CSV] Failed to process ${fileInfo.fileName}: ${err}`);
        setCsvFiles(prev => prev.map((f, idx) => 
          idx === i ? { ...f, status: 'failed' as const, error: String(err) } : f
        ));
      }
    }

    setIsDownloading(false);
    setCurrentFileIndex(-1);

    if (!shouldStopDownloadRef.current) {
      if (totalFailCount === 0 && totalSkippedCount === 0) {
        toast.success(`Batch complete! Downloaded ${totalSuccessCount} tracks from ${csvFiles.length} files`);
      } else {
        toast.warning(`Batch complete: ${totalSuccessCount} downloaded, ${totalSkippedCount} existed, ${totalFailCount} failed`);
      }
    }
  }, [csvFiles]);

  const processCSVFile = useCallback(async (fileInfo: CSVFileInfo) => {
    const counters = {
      successCount: 0,
      failCount: 0,
      skippedCount: 0,
    };

    const settings = getSettings();
    const concurrency = settings.enableParallelDownloads ? settings.concurrentDownloads : 1;

    let currentIndex = 0;
    const activeDownloads = new Set<Promise<void>>();

    const processTrack = async (track: CSVTrack, index: number) => {
      if (shouldStopDownloadRef.current) {
        return;
      }

      try {
        const existsCheck = await checkTrackExists({
          track_name: track.track_name,
          artist_name: track.artist_name,
          album_name: track.album_name,
          output_dir: settings.downloadPath + (fileInfo.playlistName ? `/${fileInfo.playlistName}` : ""),
          filename_format: settings.filenameTemplate || "{title}",
          track_number: settings.trackNumber,
          position: index + 1,
        });

        // Track audio file exists - but we should still check for cover/lyrics
        if (existsCheck.exists) {
          logger.info(`[CSV] Track exists, checking for missing cover/lyrics: ${track.track_name}`);
          counters.skippedCount++;
          
          // Fetch metadata for cover URL even when track exists
          try {
            const metadataJson = await GetSpotifyMetadata({
              url: `https://open.spotify.com/track/${track.spotify_id}`,
              batch: false,
              delay: 0,
              timeout: 30,
            });
            const metadata = JSON.parse(metadataJson);
            const trackData = metadata.track || {};
            
            let coverUrl = trackData.images || "";
            if (Array.isArray(coverUrl) && coverUrl.length > 0) {
              coverUrl = coverUrl[0].url || coverUrl[0];
            }
            
            // Download cover if available
            if (coverUrl) {
              await downloadCover({
                cover_url: coverUrl,
                track_name: track.track_name,
                artist_name: track.artist_name,
                album_name: track.album_name,
                album_artist: trackData.album_artist || track.artist_name,
                release_date: track.release_date || "",
                output_dir: settings.downloadPath + (fileInfo.playlistName ? `/${fileInfo.playlistName}` : ""),
                filename_format: settings.filenameTemplate || "{title}",
                track_number: settings.trackNumber,
                position: index + 1,
                disc_number: trackData.disc_number || 0,
              });
              logger.debug(`[CSV] Cover check completed for: ${track.track_name}`);
            }
          } catch (coverErr) {
            logger.warning(`[CSV] Failed to check/download cover for existing track ${track.track_name}: ${coverErr}`);
          }
          
          return;
        }

        const isrcResponse = await GetISRCWithFallback({
          spotify_id: track.spotify_id,
          database_path: settings.databasePath || "",
          spotify_url: `https://open.spotify.com/track/${track.spotify_id}`,
        });

        if (!isrcResponse.success || !isrcResponse.isrc) {
          throw new Error(isrcResponse.error || "Failed to get ISRC");
        }

        let trackData: any;
        if (isrcResponse.source === "database") {
          // ISRC from database - we need to fetch metadata for cover URL and track numbers
          try {
            const metadataJson = await GetSpotifyMetadata({
              url: `https://open.spotify.com/track/${track.spotify_id}`,
              batch: false,
              delay: 0,
              timeout: 30,
            });
            const metadata = JSON.parse(metadataJson);
            trackData = metadata.track || {};
            // Fallback to CSV data if metadata fetch fails
            if (!trackData.album_artist) trackData.album_artist = track.artist_name;
          } catch (metadataErr) {
            console.warn(`Failed to fetch metadata for ${track.track_name}, using CSV data:`, metadataErr);
            trackData = {
              isrc: isrcResponse.isrc,
              album_artist: track.artist_name,
              images: "",
              track_number: 0,
              disc_number: 1,
              total_tracks: 0,
            };
          }
        } else {
          const metadata = JSON.parse(isrcResponse.track_data);
          trackData = metadata.track;
        }
        
        let coverUrl = trackData.images || "";
        if (Array.isArray(coverUrl) && coverUrl.length > 0) {
          coverUrl = coverUrl[0].url || coverUrl[0];
        }
        
        await onDownloadTrack(
          isrcResponse.isrc,
          track.track_name,
          track.artist_name,
          track.album_name,
          track.spotify_id,
          fileInfo.playlistName,
          track.duration_ms,
          index + 1,
          trackData.album_artist || track.artist_name,
          track.release_date,
          coverUrl,
          trackData.track_number,
          trackData.disc_number,
          trackData.total_tracks
        );

        counters.successCount++;
      } catch (err) {
        console.error(`Failed to download track ${track.track_name}:`, err);
        counters.failCount++;
      }
    };

    while (currentIndex < fileInfo.tracks.length || activeDownloads.size > 0) {
      if (shouldStopDownloadRef.current) {
        await Promise.all(Array.from(activeDownloads));
        break;
      }

      while (activeDownloads.size < concurrency && currentIndex < fileInfo.tracks.length) {
        const track = fileInfo.tracks[currentIndex];
        const index = currentIndex;

        const downloadPromise = processTrack(track, index).then(() => {
          activeDownloads.delete(downloadPromise);
        });

        activeDownloads.add(downloadPromise);
        currentIndex++;
      }

      if (activeDownloads.size > 0) {
        await Promise.race(Array.from(activeDownloads));
      }
    }

    return counters;
  }, [onDownloadTrack]);

  const handleDownloadAllSingle = useCallback(async () => {
    if (tracks.length === 0) {
      toast.error("No tracks to download");
      return;
    }

    setIsDownloading(true);
    setDownloadProgress({ current: 0, total: tracks.length });
    setDownloadedTracks(new Set());
    setFailedTracks(new Set());
    shouldStopDownloadRef.current = false;

    const counters = {
      successCount: 0,
      failCount: 0,
      skippedCount: 0,
    };

    // Get settings for parallel downloads
    const settings = getSettings();
    const concurrency = settings.enableParallelDownloads ? settings.concurrentDownloads : 1;

    let currentIndex = 0;
    const activeDownloads = new Set<Promise<void>>();

    const processTrack = async (track: CSVTrack, index: number) => {
      if (shouldStopDownloadRef.current) {
        return;
      }

      setDownloadingTrack(track.spotify_id);

      try {
        // First, check if file already exists (skip expensive API call if possible)
        const existsCheck = await checkTrackExists({
          track_name: track.track_name,
          artist_name: track.artist_name,
          album_name: track.album_name,
          output_dir: settings.downloadPath + (playlistName ? `/${playlistName}` : ""),
          filename_format: settings.filenameTemplate || "{title}",
          track_number: settings.trackNumber,
          position: index + 1,
        });

        if (existsCheck.exists) {
          // Track audio file exists - but check for missing cover/lyrics
          logger.info(`[CSV] Track exists, checking for missing cover/lyrics: ${track.track_name}`);
          setDownloadedTracks((prev) => new Set(prev).add(track.spotify_id));
          counters.skippedCount++;
          
          // Fetch metadata for cover URL even when track exists
          try {
            const metadataJson = await GetSpotifyMetadata({
              url: `https://open.spotify.com/track/${track.spotify_id}`,
              batch: false,
              delay: 0,
              timeout: 30,
            });
            const metadata = JSON.parse(metadataJson);
            const trackData = metadata.track || {};
            
            let coverUrl = trackData.images || "";
            if (Array.isArray(coverUrl) && coverUrl.length > 0) {
              coverUrl = coverUrl[0].url || coverUrl[0];
            }
            
            // Download cover if available
            if (coverUrl) {
              await downloadCover({
                cover_url: coverUrl,
                track_name: track.track_name,
                artist_name: track.artist_name,
                album_name: track.album_name,
                album_artist: trackData.album_artist || track.artist_name,
                release_date: track.release_date || "",
                output_dir: settings.downloadPath + (playlistName ? `/${playlistName}` : ""),
                filename_format: settings.filenameTemplate || "{title}",
                track_number: settings.trackNumber,
                position: index + 1,
                disc_number: trackData.disc_number || 0,
              });
              logger.debug(`[CSV] Cover check completed for: ${track.track_name}`);
            }
          } catch (coverErr) {
            logger.warning(`[CSV] Failed to check/download cover for existing track ${track.track_name}: ${coverErr}`);
          }
          
          return;
        }

        // File doesn't exist, proceed with fetching ISRC (database first, then API fallback)
        const isrcResponse = await GetISRCWithFallback({
          spotify_id: track.spotify_id,
          database_path: settings.databasePath || "", // Use database if configured
          spotify_url: `https://open.spotify.com/track/${track.spotify_id}`,
        });

        if (!isrcResponse.success || !isrcResponse.isrc) {
          throw new Error(isrcResponse.error || "Failed to get ISRC");
        }

        // Log the source for debugging
        console.log(`[CSV Download] ISRC for ${track.track_name}: ${isrcResponse.isrc} (source: ${isrcResponse.source})`);

        // If we got ISRC from database, we still need some metadata for download
        // Use the track data from CSV and Spotify API fallback if needed
        let trackData: any;
        if (isrcResponse.source === "database") {
          // ISRC from database - we need to fetch metadata for cover URL and track numbers
          try {
            const metadataJson = await GetSpotifyMetadata({
              url: `https://open.spotify.com/track/${track.spotify_id}`,
              batch: false,
              delay: 0,
              timeout: 30,
            });
            const metadata = JSON.parse(metadataJson);
            trackData = metadata.track || {};
            // Fallback to CSV data if metadata fetch fails
            if (!trackData.album_artist) trackData.album_artist = track.artist_name;
          } catch (metadataErr) {
            console.warn(`Failed to fetch metadata for ${track.track_name}, using CSV data:`, metadataErr);
            trackData = {
              isrc: isrcResponse.isrc,
              album_artist: track.artist_name,
              images: "",
              track_number: 0,
              disc_number: 1,
              total_tracks: 0,
            };
          }
        } else {
          // We got full metadata from API
          const metadata = JSON.parse(isrcResponse.track_data);
          trackData = metadata.track;
        }
        
        // Extract cover URL - handle both string and array formats
        let coverUrl = trackData.images || "";
        if (Array.isArray(coverUrl) && coverUrl.length > 0) {
          // If it's an array, get the first (largest) image
          coverUrl = coverUrl[0].url || coverUrl[0];
        }
        
        // Download the track
        await onDownloadTrack(
          isrcResponse.isrc,
          track.track_name,
          track.artist_name,
          track.album_name,
          track.spotify_id,
          playlistName, // Use playlist name as folder
          track.duration_ms,
          index + 1, // position
          trackData.album_artist || track.artist_name,
          track.release_date,
          coverUrl,
          trackData.track_number,
          trackData.disc_number,
          trackData.total_tracks
        );

        setDownloadedTracks((prev) => new Set(prev).add(track.spotify_id));
        counters.successCount++;
      } catch (err) {
        console.error(`Failed to download track ${track.track_name}:`, err);
        setFailedTracks((prev) => new Set(prev).add(track.spotify_id));
        counters.failCount++;
      } finally {
        const completedCount = counters.successCount + counters.failCount + counters.skippedCount;
        setDownloadProgress({ current: completedCount, total: tracks.length });
      }
    };

    // Main download loop with concurrency control
    while (currentIndex < tracks.length || activeDownloads.size > 0) {
      if (shouldStopDownloadRef.current) {
        // Wait for active downloads to finish
        await Promise.all(Array.from(activeDownloads));
        toast.info(
          `Download stopped. ${counters.successCount} tracks downloaded, ${tracks.length - currentIndex} remaining.`
        );
        break;
      }

      // Start new downloads up to concurrency limit
      while (activeDownloads.size < concurrency && currentIndex < tracks.length) {
        const track = tracks[currentIndex];
        const index = currentIndex;

        const downloadPromise = processTrack(track, index).then(() => {
          activeDownloads.delete(downloadPromise);
        });

        activeDownloads.add(downloadPromise);
        currentIndex++;
      }

      // Wait for at least one download to complete
      if (activeDownloads.size > 0) {
        await Promise.race(Array.from(activeDownloads));
      }
    }

    setIsDownloading(false);
    setDownloadingTrack(null);
    shouldStopDownloadRef.current = false;
    
    if (!shouldStopDownloadRef.current) {
      if (counters.failCount === 0 && counters.skippedCount === 0) {
        toast.success(`Successfully downloaded all ${counters.successCount} tracks!`);
      } else if (counters.failCount === 0) {
        toast.info(`Downloaded ${counters.successCount} tracks, ${counters.skippedCount} already existed`);
      } else {
        toast.warning(`Downloaded ${counters.successCount} tracks, ${counters.skippedCount} existed, ${counters.failCount} failed`);
      }
    }
  }, [tracks, playlistName, onDownloadTrack]);

  const handleStopDownload = useCallback(() => {
    shouldStopDownloadRef.current = true;
    toast.info("Stopping download...");
  }, []);

  const handleDownloadCoversOnly = useCallback(async () => {
    if (tracks.length === 0) {
      toast.error("No tracks to download covers for");
      return;
    }

    logger.info(`[CSV Cover Download] Starting cover-only download for ${tracks.length} tracks`);
    setIsDownloadingCovers(true);
    setDownloadProgress({ current: 0, total: tracks.length });
    shouldStopDownloadRef.current = false;

    const counters = {
      successCount: 0,
      failCount: 0,
      skippedCount: 0,
    };

    // Get settings for parallel downloads
    const settings = getSettings();
    const concurrency = settings.enableParallelDownloads ? settings.concurrentDownloads : 1;
    logger.info(`[CSV Cover Download] Using concurrency: ${concurrency}`);

    let currentIndex = 0;
    const activeDownloads = new Set<Promise<void>>();

    const processCover = async (track: CSVTrack, index: number) => {
      if (shouldStopDownloadRef.current) {
        return;
      }

      setDownloadingTrack(track.spotify_id);

      try {
        logger.debug(`[CSV Cover Download] Processing track ${index + 1}/${tracks.length}: ${track.track_name} - ${track.artist_name}`);
        
        // Fetch full metadata from Spotify for cover URL
        const metadataJson = await GetSpotifyMetadata({
          url: `https://open.spotify.com/track/${track.spotify_id}`,
          batch: false,
          delay: 0, // No delay needed - concurrency control handles rate limiting
          timeout: 30,
        });
        
        const metadata = JSON.parse(metadataJson);
        
        if (metadata.track) {
          const trackData = metadata.track;
          
          // Extract cover URL
          let coverUrl = trackData.images;
          if (Array.isArray(coverUrl) && coverUrl.length > 0) {
            coverUrl = coverUrl[0].url || coverUrl[0];
          }

          if (!coverUrl) {
            logger.error(`[CSV Cover Download] No cover URL found for: ${track.track_name}`);
            throw new Error("No cover URL found");
          }

          logger.debug(`[CSV Cover Download] Cover URL found: ${coverUrl.substring(0, 50)}...`);

          // Download only the cover
          const response = await downloadCover({
            cover_url: coverUrl,
            track_name: track.track_name,
            artist_name: track.artist_name,
            album_name: track.album_name,
            album_artist: trackData.album_artist || "",
            release_date: track.release_date || "",
            output_dir: settings.downloadPath + (playlistName ? `/${playlistName}` : ""),
            filename_format: settings.filenameTemplate || "{title}",
            track_number: settings.trackNumber,
            position: index + 1,
            disc_number: trackData.disc_number || 0,
          });

          if (response.success) {
            if (response.already_exists) {
              logger.info(`[CSV Cover Download] ✓ Cover already exists: ${track.track_name}`);
              counters.skippedCount++;
            } else {
              logger.success(`[CSV Cover Download] ✓ Successfully downloaded cover: ${track.track_name}`);
              counters.successCount++;
            }
          } else {
            logger.error(`[CSV Cover Download] ✗ Failed to download cover: ${track.track_name} - ${response.error || 'Unknown error'}`);
            counters.failCount++;
          }
        } else {
          logger.error(`[CSV Cover Download] No metadata found for track: ${track.track_name}`);
          throw new Error("No metadata found for track");
        }
      } catch (err) {
        logger.error(`[CSV Cover Download] ✗ Error processing ${track.track_name}: ${err}`);
        counters.failCount++;
      } finally {
        const completedCount = counters.successCount + counters.failCount + counters.skippedCount;
        setDownloadProgress({ current: completedCount, total: tracks.length });
        logger.info(`[CSV Cover Download] Progress: ${completedCount}/${tracks.length} (Success: ${counters.successCount}, Failed: ${counters.failCount}, Skipped: ${counters.skippedCount})`);
      }
    };

    // Main download loop with concurrency control
    while (currentIndex < tracks.length || activeDownloads.size > 0) {
      if (shouldStopDownloadRef.current) {
        logger.warning(`[CSV Cover Download] Stop requested, waiting for active downloads...`);
        await Promise.all(Array.from(activeDownloads));
        toast.info(
          `Cover download stopped. ${counters.successCount} covers downloaded, ${tracks.length - currentIndex} remaining.`
        );
        break;
      }

      while (activeDownloads.size < concurrency && currentIndex < tracks.length) {
        const track = tracks[currentIndex];
        const index = currentIndex;

        const downloadPromise = processCover(track, index).then(() => {
          activeDownloads.delete(downloadPromise);
        });

        activeDownloads.add(downloadPromise);
        currentIndex++;
      }

      if (activeDownloads.size > 0) {
        await Promise.race(Array.from(activeDownloads));
      }
    }

    logger.info(`[CSV Cover Download] Completed. Final stats - Success: ${counters.successCount}, Failed: ${counters.failCount}, Skipped: ${counters.skippedCount}`);
    setIsDownloadingCovers(false);
    setDownloadingTrack(null);
    shouldStopDownloadRef.current = false;
    
    if (!shouldStopDownloadRef.current) {
      if (counters.failCount === 0 && counters.skippedCount === 0) {
        toast.success(`Successfully downloaded ${counters.successCount} covers!`);
      } else if (counters.failCount === 0) {
        toast.info(`Downloaded ${counters.successCount} covers, ${counters.skippedCount} already existed`);
      } else {
        toast.warning(`Downloaded ${counters.successCount} covers, ${counters.skippedCount} existed, ${counters.failCount} failed`);
      }
    }
  }, [tracks, playlistName]);

  const handleDownloadSingle = useCallback(async (track: CSVTrack, index: number) => {
    if (downloadedTracks.has(track.spotify_id) || downloadingTrack) {
      return;
    }

    setDownloadingTrack(track.spotify_id);

    try {
      // Get settings for database path
      const settings = getSettings();

      // Fetch ISRC using database first, then API fallback
      const isrcResponse = await GetISRCWithFallback({
        spotify_id: track.spotify_id,
        database_path: settings.databasePath || "",
        spotify_url: `https://open.spotify.com/track/${track.spotify_id}`,
      });

      if (!isrcResponse.success || !isrcResponse.isrc) {
        throw new Error(isrcResponse.error || "Failed to get ISRC");
      }

      // Parse track data
      let trackData: any;
      if (isrcResponse.source === "database") {
          // ISRC from database - we need to fetch metadata for cover URL and track numbers
          try {
            const metadataJson = await GetSpotifyMetadata({
              url: `https://open.spotify.com/track/${track.spotify_id}`,
              batch: false,
              delay: 0,
              timeout: 30,
            });
            const metadata = JSON.parse(metadataJson);
            trackData = metadata.track || {};
            // Fallback to CSV data if metadata fetch fails
            if (!trackData.album_artist) trackData.album_artist = track.artist_name;
          } catch (metadataErr) {
            console.warn(`Failed to fetch metadata for ${track.track_name}, using CSV data:`, metadataErr);
            trackData = {
              isrc: isrcResponse.isrc,
              album_artist: track.artist_name,
              images: "",
              track_number: 0,
              disc_number: 1,
              total_tracks: 0,
            };
          }
        } else {
          // Full metadata from API
          const metadata = JSON.parse(isrcResponse.track_data);
          trackData = metadata.track;
        }
      
      // Extract cover URL - handle both string and array formats
      let coverUrl = trackData.images || "";
      if (Array.isArray(coverUrl) && coverUrl.length > 0) {
        // If it's an array, get the first (largest) image
        coverUrl = coverUrl[0].url || coverUrl[0];
      }
      
      // Download the track
      await onDownloadTrack(
        isrcResponse.isrc,
        track.track_name,
        track.artist_name,
        track.album_name,
        track.spotify_id,
        playlistName, // Use playlist name as folder
        track.duration_ms,
        index + 1, // position
        trackData.album_artist || track.artist_name,
        track.release_date,
        coverUrl,
        trackData.track_number,
        trackData.disc_number,
        trackData.total_tracks
      );

      setDownloadedTracks((prev) => new Set(prev).add(track.spotify_id));
      toast.success(`Downloaded: ${track.track_name}`);
    } catch (err) {
      console.error(`Failed to download track ${track.track_name}:`, err);
      setFailedTracks((prev) => new Set(prev).add(track.spotify_id));
      toast.error(`Failed to download: ${track.track_name}`);
    } finally {
      setDownloadingTrack(null);
    }
  }, [downloadedTracks, downloadingTrack, playlistName, onDownloadTrack]);

  // Virtual items for rendering
  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">CSV Playlist Import</h2>
        <p className="text-muted-foreground">
          Import and download tracks from Spotify CSV export files
        </p>
      </div>

      <Card className="p-6">
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button onClick={handleSelectCSV} disabled={isLoading || isDownloading}>
              <Upload className="h-4 w-4 mr-2" />
              Select Single CSV File
            </Button>
            <Button onClick={handleSelectMultipleCSV} disabled={isLoading || isDownloading} variant="outline">
              <Files className="h-4 w-4 mr-2" />
              Select Multiple CSV Files
            </Button>
          </div>

          {isBatchMode && csvFiles.length > 0 && (
            <div className="space-y-4">
              <div className="border-t pt-4">
                <h3 className="font-semibold mb-3">
                  Batch Mode: {csvFiles.length} CSV file{csvFiles.length !== 1 ? 's' : ''} loaded
                </h3>
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {csvFiles.map((file, index) => (
                    <div
                      key={file.filePath}
                      className={`p-3 border rounded-lg ${
                        currentFileIndex === index ? 'bg-blue-50 dark:bg-blue-950 border-blue-300' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-1">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <div className="flex-1">
                            <p className="font-medium text-sm">{file.fileName}</p>
                            <p className="text-xs text-muted-foreground">
                              {file.tracks.length} track{file.tracks.length !== 1 ? 's' : ''} • Folder: {file.playlistName}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {file.status === 'completed' && (
                            <CheckCircle className="h-5 w-5 text-green-500" />
                          )}
                          {file.status === 'failed' && (
                            <XCircle className="h-5 w-5 text-red-500" />
                          )}
                          {file.status === 'processing' && (
                            <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                          )}
                          {file.status === 'pending' && (
                            <span className="text-xs text-muted-foreground">Pending</span>
                          )}
                        </div>
                      </div>
                      {file.error && (
                        <p className="text-xs text-red-500 mt-1">{file.error}</p>
                      )}
                    </div>
                  ))}
                </div>
                
                <div className="flex gap-2 mt-4">
                  {isDownloading ? (
                    <>
                      <Button
                        onClick={handleStopDownload}
                        variant="destructive"
                        size="lg"
                      >
                        <X className="h-4 w-4 mr-2" />
                        Stop Batch Download
                      </Button>
                      <Button disabled size="lg">
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Processing CSV Files...
                      </Button>
                    </>
                  ) : (
                    <Button onClick={handleDownloadAll} size="lg">
                      <Download className="h-4 w-4 mr-2" />
                      Download All ({csvFiles.reduce((sum, f) => sum + f.tracks.length, 0)} tracks)
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          {!isBatchMode && csvFilePath && (
            <div className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Selected file:</span>
              <span className="font-mono text-xs">{csvFilePath}</span>
            </div>
          )}

          {!isBatchMode && csvFilePath && (
            <div className="space-y-2">
              <Label htmlFor="playlist-name">Playlist/Folder Name</Label>
              <Input
                id="playlist-name"
                value={playlistName}
                onChange={(e) => setPlaylistName(e.target.value)}
                placeholder="Enter playlist name..."
                disabled={isDownloading}
                className="max-w-md"
              />
              <p className="text-xs text-muted-foreground">
                All tracks will be downloaded to a folder with this name
              </p>
            </div>
          )}

          {!isBatchMode && tracks.length > 0 && (
            <>
              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-semibold">
                      {tracks.length} tracks loaded
                    </h3>
                    {isDownloading && (
                      <p className="text-sm text-muted-foreground">
                        Progress: {downloadProgress.current} / {downloadProgress.total}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {isDownloading || isDownloadingCovers ? (
                      <>
                        <Button
                          onClick={handleStopDownload}
                          variant="destructive"
                          size="lg"
                        >
                          <X className="h-4 w-4 mr-2" />
                          Stop Download
                        </Button>
                        <Button disabled size="lg">
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          {isDownloadingCovers ? "Downloading Covers..." : "Downloading..."}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          onClick={handleDownloadAll}
                          size="lg"
                        >
                          <Download className="h-4 w-4 mr-2" />
                          Download All Tracks
                        </Button>
                        <Button
                          onClick={handleDownloadCoversOnly}
                          disabled={tracks.length === 0}
                          variant="outline"
                          size="lg"
                        >
                          <Image className="h-4 w-4 mr-2" />
                          Download Covers Only
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                <div 
                  ref={parentRef}
                  className="max-h-[400px] overflow-y-auto border rounded-lg"
                >
                  <div className="w-full">
                    {/* Header */}
                    <div className="bg-muted sticky top-0 z-10 grid grid-cols-[60px_1fr_1fr_1fr_100px] gap-3 p-3 border-b font-medium text-sm">
                      <div className="text-left">Status</div>
                      <div className="text-left">Track</div>
                      <div className="text-left">Artist</div>
                      <div className="text-left">Album</div>
                      <div className="text-center">Action</div>
                    </div>
                    
                    {/* Virtual scrolling container */}
                    <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
                      {virtualItems.map((virtualRow) => {
                        const track = tracks[virtualRow.index];
                        const isDownloaded = downloadedTracks.has(track.spotify_id);
                        const isFailed = failedTracks.has(track.spotify_id);
                        const isDownloadingThis = downloadingTrack === track.spotify_id;
                        
                        return (
                          <div
                            key={track.spotify_id || virtualRow.index}
                            className="border-b hover:bg-muted/30 absolute w-full grid grid-cols-[60px_1fr_1fr_1fr_100px] gap-3 p-3 items-center"
                            style={{
                              height: `${virtualRow.size}px`,
                              transform: `translateY(${virtualRow.start}px)`,
                            }}
                          >
                            <div className="flex items-center">
                              {isDownloaded ? (
                                <CheckCircle className="h-4 w-4 text-green-500" />
                              ) : isFailed ? (
                                <XCircle className="h-4 w-4 text-red-500" />
                              ) : isDownloadingThis ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : null}
                            </div>
                            <div className="text-sm truncate">{track.track_name}</div>
                            <div className="text-sm text-muted-foreground truncate">
                              {track.artist_name}
                            </div>
                            <div className="text-sm text-muted-foreground truncate">
                              {track.album_name}
                            </div>
                            <div className="flex justify-center">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleDownloadSingle(track, virtualRow.index)}
                                disabled={
                                  downloadingTrack !== null ||
                                  isDownloading ||
                                  isDownloaded
                                }
                              >
                                {isDownloadingThis ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : isDownloaded ? (
                                  <CheckCircle className="h-4 w-4" />
                                ) : (
                                  <Download className="h-4 w-4" />
                                )}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      </Card>

      <Card className="p-6 bg-muted/30">
        <h3 className="font-semibold mb-2">How to use:</h3>
        <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
          <li>Export your Spotify playlist(s) as CSV file(s)</li>
          <li>Click "Select Single CSV File" for one playlist, or "Select Multiple CSV Files" to process several playlists at once</li>
          <li>Review the loaded tracks in the table</li>
          <li>Click "Download All Tracks" to batch download, or use individual download buttons</li>
          <li>In batch mode, the app will process each CSV file sequentially with its own folder</li>
          <li>The app will fetch metadata and download each track automatically</li>
        </ol>
      </Card>
    </div>
  );
}
