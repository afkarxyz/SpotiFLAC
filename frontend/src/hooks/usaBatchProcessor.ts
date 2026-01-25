import { useState, useRef, useCallback } from "react";
import { fetchSpotifyMetadata } from "@/lib/api";
import { logger } from "@/lib/logger";
import { toastWithSound as toast } from "@/lib/toast-with-sound";

export interface BatchLog {
    id: string;
    type: "info" | "success" | "error" | "warning";
    message: string;
    timestamp: number;
}

interface ProcessOptions {
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
        spotifyTotalTracks?: number,
        spotifyTotalDiscs?: number,
        copyright?: string,
        publisher?: string
    ) => void;
}

export function useBatchProcessor() {
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [logs, setLogs] = useState<BatchLog[]>([]);
    const [processedCount, setProcessedCount] = useState(0);
    const [totalCount, setTotalCount] = useState(0);
    const shouldStopRef = useRef(false);

    const addLog = useCallback((type: BatchLog["type"], message: string) => {
        setLogs(prev => [
            {
                id: crypto.randomUUID(),
                type,
                message,
                timestamp: Date.now(),
            },
            ...prev
        ]);
        if (type === "error") logger.error(`[Batch] ${message}`);
        else if (type === "success") logger.success(`[Batch] ${message}`);
        else logger.info(`[Batch] ${message}`);
    }, []);

    const processUrls = useCallback(async (urls: string[], options: ProcessOptions) => {
        if (urls.length === 0) {
            toast.error("No URLs provided");
            return;
        }

        setIsProcessing(true);
        setProgress(0);
        setLogs([]);
        setProcessedCount(0);
        setTotalCount(urls.length);
        shouldStopRef.current = false;

        addLog("info", `Starting batch process for ${urls.length} URLs...`);

        for (let i = 0; i < urls.length; i++) {
            if (shouldStopRef.current) {
                addLog("warning", "Batch processing stopped by user.");
                break;
            }

            const url = urls[i].trim();
            if (!url) {
                setProcessedCount(prev => prev + 1);
                continue;
            }

            try {
                addLog("info", `Processing: ${url}`);
                
                const metadata = await fetchSpotifyMetadata(url);
                
                if ("track" in metadata) {
                    const track = metadata.track;
                    if (track.isrc) {
                        options.onDownloadTrack(
                            track.isrc,
                            track.name,
                            track.artists,
                            track.album_name,
                            track.spotify_id,
                            undefined,
                            track.duration_ms,
                            track.track_number,
                            track.album_artist,
                            track.release_date,
                            track.images,
                            track.track_number,
                            track.disc_number,
                            track.total_tracks,
                            track.total_discs,
                            track.copyright,
                            track.publisher
                        );
                        addLog("success", `Queued track: ${track.name} - ${track.artists}`);
                    } else {
                        addLog("error", `No ISRC found for track: ${track.name}`);
                    }
                } else if ("album_info" in metadata) {
                    const tracks = metadata.track_list;
                    addLog("info", `Found album: ${metadata.album_info.name} (${tracks.length} tracks)`);
                    
                    for (const track of tracks) {
                        if (shouldStopRef.current) break;
                        if (track.isrc) {
                            options.onDownloadTrack(
                                track.isrc,
                                track.name,
                                track.artists,
                                track.album_name,
                                track.spotify_id,
                                metadata.album_info.name,
                                track.duration_ms,
                                track.track_number,
                                track.album_artist,
                                track.release_date,
                                track.images,
                                track.track_number,
                                track.disc_number,
                                track.total_tracks,
                                track.total_discs,
                                undefined, 
                                undefined
                            );
                        }
                    }
                    addLog("success", `Queued album: ${metadata.album_info.name}`);
                } else if ("playlist_info" in metadata) {
                    const tracks = metadata.track_list;
                    addLog("info", `Found playlist: ${metadata.playlist_info.owner.name} (${tracks.length} tracks)`);
                    
                    for (const track of tracks) {
                        if (shouldStopRef.current) break;
                        if (track.isrc) {
                            options.onDownloadTrack(
                                track.isrc,
                                track.name,
                                track.artists,
                                track.album_name,
                                track.spotify_id,
                                metadata.playlist_info.owner.name,
                                track.duration_ms,
                                undefined,
                                track.album_artist,
                                track.release_date,
                                track.images,
                                track.track_number,
                                track.disc_number,
                                track.total_tracks,
                                track.total_discs,
                                undefined,
                                undefined
                            );
                        }
                    }
                    addLog("success", `Queued playlist: ${metadata.playlist_info.owner.name}`);
                } else if ("artist_info" in metadata) {
                    addLog("warning", `Artist URLs are usually too large for batch processing. Skipping: ${metadata.artist_info.name}`);
                }

                await new Promise(resolve => setTimeout(resolve, 800));

            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                addLog("error", `Failed to process ${url}: ${msg}`);
            }

            setProcessedCount(prev => prev + 1);
            setProgress(Math.round(((i + 1) / urls.length) * 100));
        }

        setIsProcessing(false);
        if (!shouldStopRef.current) {
            addLog("success", "Batch processing completed.");
            toast.success("Batch processing finished");
        }
    }, [addLog]);

    const stopProcessing = useCallback(() => {
        shouldStopRef.current = true;
    }, []);

    const clearLogs = useCallback(() => {
        setLogs([]);
        setProgress(0);
        setProcessedCount(0);
        setTotalCount(0);
    }, []);

    return {
        processUrls,
        stopProcessing,
        clearLogs,
        isProcessing,
        progress,
        logs,
        processedCount,
        totalCount
    };
}