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
    const handleDownloadLyrics = async (spotifyId: string, trackName: string, artistName: string, albumName?: string, playlistName?: string, position?: number, albumArtist?: string, releaseDate?: string, discNumber?: number, isAlbum?: boolean) => {
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
            const placeholder = "__SLASH_PLACEHOLDER__";
            const yearValue = releaseDate?.substring(0, 4);
            const templateData: TemplateData = {
                artist: artistName?.replace(/\//g, placeholder),
                album: albumName?.replace(/\//g, placeholder),
                title: trackName?.replace(/\//g, placeholder),
                track: position,
                year: yearValue,
                playlist: playlistName?.replace(/\//g, placeholder),
            };
            const folderTemplate = settings.folderTemplate || "";
            const useAlbumSubfolder = folderTemplate.includes("{album}") || folderTemplate.includes("{album_artist}") || folderTemplate.includes("{playlist}");
            if (playlistName && (!isAlbum || !useAlbumSubfolder)) {
                outputDir = joinPath(os, outputDir, sanitizePath(playlistName.replace(/\//g, " "), os));
            }
            if (settings.folderTemplate) {
                const folderPath = parseTemplate(settings.folderTemplate, templateData);
                if (folderPath) {
                    const parts = folderPath.split("/").filter((p: string) => p.trim());
                    for (const part of parts) {
                        const sanitizedPart = part.replace(new RegExp(placeholder, "g"), " ");
                        outputDir = joinPath(os, outputDir, sanitizePath(sanitizedPart, os));
                    }
                }
            }
            const useAlbumTrackNumber = settings.folderTemplate?.includes("{album}") || false;
            const response = await downloadLyrics({
                spotify_id: spotifyId,
                track_name: trackName,
                artist_name: artistName,
                album_name: albumName,
                album_artist: albumArtist,
                release_date: releaseDate,
                output_dir: outputDir,
                filename_format: settings.filenameTemplate || "{title}",
                track_number: settings.trackNumber,
                position: position || 0,
                use_album_track_number: useAlbumTrackNumber,
                disc_number: discNumber,
            });
            if (response.success) {
                if (response.already_exists) {
                    toast.info("Lyrics file already exists");
                    setSkippedLyrics((prev) => new Set(prev).add(spotifyId));
                }
                else {
                    toast.success("Lyrics downloaded successfully");
                    setDownloadedLyrics((prev) => new Set(prev).add(spotifyId));
                }
                setFailedLyrics((prev) => {
                    const newSet = new Set(prev);
                    newSet.delete(spotifyId);
                    return newSet;
                });
            }
            else {
                toast.error(response.error || "Failed to download lyrics");
                setFailedLyrics((prev) => new Set(prev).add(spotifyId));
            }
        }
        catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to download lyrics");
            setFailedLyrics((prev) => new Set(prev).add(spotifyId));
        }
        finally {
            setDownloadingLyricsTrack(null);
        }
    };
    const handleDownloadAllLyrics = async (tracks: TrackMetadata[], playlistName?: string, _isArtistDiscography?: boolean, isAlbum?: boolean) => {
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
        for (let i = 0; i < tracksWithSpotifyId.length; i++) {
            const track = tracksWithSpotifyId[i];
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
                const placeholder = "__SLASH_PLACEHOLDER__";
                const useAlbumTrackNumber = settings.folderTemplate?.includes("{album}") || false;
                const trackPosition = useAlbumTrackNumber ? (track.track_number || i + 1) : (i + 1);
                const yearValue = track.release_date?.substring(0, 4);
                const templateData: TemplateData = {
                    artist: track.artists?.replace(/\//g, placeholder),
                    album: track.album_name?.replace(/\//g, placeholder),
                    title: track.name?.replace(/\//g, placeholder),
                    track: trackPosition,
                    year: yearValue,
                    playlist: playlistName?.replace(/\//g, placeholder),
                };
                const folderTemplate = settings.folderTemplate || "";
                const useAlbumSubfolder = folderTemplate.includes("{album}") || folderTemplate.includes("{album_artist}") || folderTemplate.includes("{playlist}");
                if (playlistName && (!isAlbum || !useAlbumSubfolder)) {
                    outputDir = joinPath(os, outputDir, sanitizePath(playlistName.replace(/\//g, " "), os));
                }
                if (settings.folderTemplate) {
                    const folderPath = parseTemplate(settings.folderTemplate, templateData);
                    if (folderPath) {
                        const parts = folderPath.split("/").filter((p: string) => p.trim());
                        for (const part of parts) {
                            const sanitizedPart = part.replace(new RegExp(placeholder, "g"), " ");
                            outputDir = joinPath(os, outputDir, sanitizePath(sanitizedPart, os));
                        }
                    }
                }
                const response = await downloadLyrics({
                    spotify_id: id,
                    track_name: track.name,
                    artist_name: track.artists,
                    album_name: track.album_name,
                    album_artist: track.album_artist,
                    release_date: track.release_date,
                    output_dir: outputDir,
                    filename_format: settings.filenameTemplate || "{title}",
                    track_number: settings.trackNumber,
                    position: trackPosition,
                    use_album_track_number: useAlbumTrackNumber,
                    disc_number: track.disc_number,
                });
                if (response.success) {
                    if (response.already_exists) {
                        skipped++;
                        setSkippedLyrics((prev) => new Set(prev).add(id));
                    }
                    else {
                        success++;
                        setDownloadedLyrics((prev) => new Set(prev).add(id));
                    }
                    setFailedLyrics((prev) => {
                        const newSet = new Set(prev);
                        newSet.delete(id);
                        return newSet;
                    });
                }
                else {
                    failed++;
                    setFailedLyrics((prev) => new Set(prev).add(id));
                }
            }
            catch (err) {
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
