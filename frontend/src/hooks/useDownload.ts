import { useState, useRef } from "react";
import { downloadTrack, fetchSpotifyMetadata } from "@/lib/api";
import { getSettings, parseTemplate, type TemplateData } from "@/lib/settings";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { joinPath, sanitizePath } from "@/lib/utils";
import { logger } from "@/lib/logger";
import type { TrackMetadata } from "@/types/api";
interface CheckFileExistenceRequest {
    spotify_id: string;
    track_name: string;
    artist_name: string;
    album_name?: string;
    album_artist?: string;
    release_date?: string;
    track_number?: number;
    disc_number?: number;
    position?: number;
    use_album_track_number?: boolean;
    filename_format?: string;
    include_track_number?: boolean;
    audio_format?: string;
    relative_path?: string;
}
interface FileExistenceResult {
    spotify_id: string;
    exists: boolean;
    file_path?: string;
    track_name?: string;
    artist_name?: string;
}
const CheckFilesExistence = (outputDir: string, tracks: CheckFileExistenceRequest[]): Promise<FileExistenceResult[]> => (window as any)["go"]["main"]["App"]["CheckFilesExistence"](outputDir, tracks);
const SkipDownloadItem = (itemID: string, filePath: string): Promise<void> => (window as any)["go"]["main"]["App"]["SkipDownloadItem"](itemID, filePath);
export function useDownload(region: string) {
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
    const downloadWithAutoFallback = async (isrc: string, settings: any, trackName?: string, artistName?: string, albumName?: string, playlistName?: string, position?: number, spotifyId?: string, durationMs?: number, releaseYear?: string, albumArtist?: string, releaseDate?: string, coverUrl?: string, spotifyTrackNumber?: number, spotifyDiscNumber?: number, spotifyTotalTracks?: number, spotifyTotalDiscs?: number, copyright?: string, publisher?: string) => {
        const service = settings.downloader;
        const query = trackName && artistName ? `${trackName} ${artistName} ` : undefined;
        const os = settings.operatingSystem;
        let outputDir = settings.downloadPath;
        let useAlbumTrackNumber = false;
        const placeholder = "__SLASH_PLACEHOLDER__";
        let finalReleaseDate = releaseDate;
        let finalTrackNumber = spotifyTrackNumber || 0;
        if (spotifyId) {
            try {
                const trackURL = `https://open.spotify.com/track/${spotifyId}`;
                const trackMetadata = await fetchSpotifyMetadata(trackURL, false, 0, 10);
                if ("track" in trackMetadata && trackMetadata.track) {
                    if (trackMetadata.track.release_date) {
                        finalReleaseDate = trackMetadata.track.release_date;
                    }
                    if (trackMetadata.track.track_number > 0) {
                        finalTrackNumber = trackMetadata.track.track_number;
                    }
                }
            }
            catch (err) {
            }
        }
        const yearValue = releaseYear || finalReleaseDate?.substring(0, 4);
        const hasSubfolder = settings.folderTemplate && settings.folderTemplate.trim() !== "";
        const trackNumberForTemplate = (hasSubfolder && finalTrackNumber > 0) ? finalTrackNumber : (position || 0);
        if (hasSubfolder) {
            useAlbumTrackNumber = true;
        }
        const templateData: TemplateData = {
            artist: artistName?.replace(/\//g, placeholder),
            album: albumName?.replace(/\//g, placeholder),
            album_artist: albumArtist?.replace(/\//g, placeholder) || artistName?.replace(/\//g, placeholder),
            title: trackName?.replace(/\//g, placeholder),
            track: trackNumberForTemplate,
            year: yearValue,
            playlist: playlistName?.replace(/\//g, placeholder),
        };
        const folderTemplate = settings.folderTemplate || "";
        const useAlbumSubfolder = folderTemplate.includes("{album}") || folderTemplate.includes("{album_artist}") || folderTemplate.includes("{playlist}");
        if (playlistName && !useAlbumSubfolder) {
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
        const serviceForCheck = service === "auto" ? "flac" : (service === "tidal" ? "flac" : (service === "qobuz" ? "flac" : "flac"));
        let fileExists = false;
        if (trackName && artistName) {
            try {
                const checkRequest: CheckFileExistenceRequest = {
                    spotify_id: spotifyId || isrc,
                    track_name: trackName,
                    artist_name: artistName,
                    album_name: albumName,
                    album_artist: albumArtist,
                    release_date: finalReleaseDate || releaseDate,
                    track_number: finalTrackNumber || spotifyTrackNumber || 0,
                    disc_number: spotifyDiscNumber || 0,
                    position: trackNumberForTemplate,
                    use_album_track_number: useAlbumTrackNumber,
                    filename_format: settings.filenameTemplate || "",
                    include_track_number: settings.trackNumber || false,
                    audio_format: serviceForCheck,
                };
                const existenceResults = await CheckFilesExistence(outputDir, [checkRequest]);
                if (existenceResults.length > 0 && existenceResults[0].exists) {
                    fileExists = true;
                    return {
                        success: true,
                        message: "File already exists",
                        file: existenceResults[0].file_path || "",
                        already_exists: true,
                    };
                }
            }
            catch (err) {
                console.warn("File existence check failed:", err);
            }
        }
        const { AddToDownloadQueue } = await import("../../wailsjs/go/main/App");
        let itemID: string | undefined;
        if (!fileExists) {
            itemID = await AddToDownloadQueue(isrc, trackName || "", artistName || "", albumName || "");
        }
        if (service === "auto") {
            let streamingURLs: any = null;
            if (spotifyId) {
                try {
                    const { GetStreamingURLs } = await import("../../wailsjs/go/main/App");
                    const urlsJson = await GetStreamingURLs(spotifyId, region);
                    streamingURLs = JSON.parse(urlsJson);
                }
                catch (err) {
                    console.error("Failed to get streaming URLs:", err);
                }
            }
            const durationSeconds = durationMs ? Math.round(durationMs / 1000) : undefined;
            const order = (settings.autoOrder || "tidal-amazon-qobuz").split("-");
            let lastResponse: any = { success: false, error: "No matching services found" };
            const is24Bit = (settings.autoQuality || "24") === "24";
            const tidalQuality = is24Bit ? "HI_RES_LOSSLESS" : "LOSSLESS";
            const qobuzQuality = is24Bit ? "7" : "6";
            for (const s of order) {
                if (s === "tidal" && streamingURLs?.tidal_url) {
                    try {
                        logger.debug(`trying tidal for: ${trackName} - ${artistName}`);
                        const response = await downloadTrack({
                            isrc,
                            service: "tidal",
                            query,
                            track_name: trackName,
                            artist_name: artistName,
                            album_name: albumName,
                            album_artist: albumArtist,
                            release_date: finalReleaseDate || releaseDate,
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
                            audio_format: tidalQuality,
                            spotify_track_number: spotifyTrackNumber,
                            spotify_disc_number: spotifyDiscNumber,
                            spotify_total_tracks: spotifyTotalTracks,
                            spotify_total_discs: spotifyTotalDiscs,
                            copyright: copyright,
                            publisher: publisher,
                        });
                        if (response.success) {
                            logger.success(`tidal: ${trackName} - ${artistName}`);
                            return response;
                        }
                        lastResponse = response;
                        logger.warning(`tidal failed, trying next...`);
                    }
                    catch (err) {
                        logger.error(`tidal error: ${err}`);
                        lastResponse = { success: false, error: String(err) };
                    }
                }
                else if (s === "amazon" && streamingURLs?.amazon_url) {
                    try {
                        logger.debug(`trying amazon for: ${trackName} - ${artistName}`);
                        const response = await downloadTrack({
                            isrc,
                            service: "amazon",
                            query,
                            track_name: trackName,
                            artist_name: artistName,
                            album_name: albumName,
                            album_artist: albumArtist,
                            release_date: finalReleaseDate || releaseDate,
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
                            spotify_total_discs: spotifyTotalDiscs,
                            copyright: copyright,
                            publisher: publisher,
                        });
                        if (response.success) {
                            logger.success(`amazon: ${trackName} - ${artistName}`);
                            return response;
                        }
                        lastResponse = response;
                        logger.warning(`amazon failed, trying next...`);
                    }
                    catch (err) {
                        logger.error(`amazon error: ${err}`);
                        lastResponse = { success: false, error: String(err) };
                    }
                }
                else if (s === "qobuz") {
                    try {
                        logger.debug(`trying qobuz for: ${trackName} - ${artistName}`);
                        const response = await downloadTrack({
                            isrc,
                            service: "qobuz",
                            query,
                            track_name: trackName,
                            artist_name: artistName,
                            album_name: albumName,
                            album_artist: albumArtist,
                            release_date: finalReleaseDate || releaseDate,
                            cover_url: coverUrl,
                            output_dir: outputDir,
                            filename_format: settings.filenameTemplate,
                            track_number: settings.trackNumber,
                            position: trackNumberForTemplate,
                            use_album_track_number: useAlbumTrackNumber,
                            spotify_id: spotifyId,
                            embed_lyrics: settings.embedLyrics,
                            embed_max_quality_cover: settings.embedMaxQualityCover,
                            item_id: itemID,
                            audio_format: qobuzQuality,
                            spotify_track_number: spotifyTrackNumber,
                            spotify_disc_number: spotifyDiscNumber,
                            spotify_total_tracks: spotifyTotalTracks,
                            spotify_total_discs: spotifyTotalDiscs,
                            copyright: copyright,
                            publisher: publisher,
                        });
                        if (response.success) {
                            logger.success(`qobuz: ${trackName} - ${artistName}`);
                            return response;
                        }
                        lastResponse = response;
                        logger.warning(`qobuz failed, trying next...`);
                    }
                    catch (err) {
                        logger.error(`qobuz error: ${err}`);
                        lastResponse = { success: false, error: String(err) };
                    }
                }
            }
            if (itemID) {
                const { MarkDownloadItemFailed } = await import("../../wailsjs/go/main/App");
                await MarkDownloadItemFailed(itemID, lastResponse.error || "All services failed");
            }
            return lastResponse;
        }
        const durationSecondsForFallback = durationMs ? Math.round(durationMs / 1000) : undefined;
        let audioFormat: string | undefined;
        if (service === "tidal") {
            audioFormat = settings.tidalQuality || "LOSSLESS";
        }
        else if (service === "qobuz") {
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
            release_date: finalReleaseDate || releaseDate,
            cover_url: coverUrl,
            output_dir: outputDir,
            filename_format: settings.filenameTemplate,
            track_number: settings.trackNumber,
            position: trackNumberForTemplate,
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
            spotify_total_discs: spotifyTotalDiscs,
            copyright: copyright,
            publisher: publisher,
        });
        if (!singleServiceResponse.success && itemID) {
            const { MarkDownloadItemFailed } = await import("../../wailsjs/go/main/App");
            await MarkDownloadItemFailed(itemID, singleServiceResponse.error || "Download failed");
        }
        return singleServiceResponse;
    };
    const downloadWithItemID = async (isrc: string, settings: any, itemID: string, trackName?: string, artistName?: string, albumName?: string, folderName?: string, position?: number, spotifyId?: string, durationMs?: number, isAlbum?: boolean, releaseYear?: string, albumArtist?: string, releaseDate?: string, coverUrl?: string, spotifyTrackNumber?: number, spotifyDiscNumber?: number, spotifyTotalTracks?: number, spotifyTotalDiscs?: number, copyright?: string, publisher?: string) => {
        const service = settings.downloader;
        const query = trackName && artistName ? `${trackName} ${artistName}` : undefined;
        const os = settings.operatingSystem;
        let outputDir = settings.downloadPath;
        let useAlbumTrackNumber = false;
        const placeholder = "__SLASH_PLACEHOLDER__";
        let finalReleaseDate = releaseDate;
        let finalTrackNumber = spotifyTrackNumber || 0;
        if (spotifyId) {
            try {
                const trackURL = `https://open.spotify.com/track/${spotifyId}`;
                const trackMetadata = await fetchSpotifyMetadata(trackURL, false, 0, 10);
                if ("track" in trackMetadata && trackMetadata.track) {
                    if (trackMetadata.track.release_date) {
                        finalReleaseDate = trackMetadata.track.release_date;
                    }
                    if (trackMetadata.track.track_number > 0) {
                        finalTrackNumber = trackMetadata.track.track_number;
                    }
                }
            }
            catch (err) {
            }
        }
        const yearValue = releaseYear || finalReleaseDate?.substring(0, 4);
        const hasSubfolder = settings.folderTemplate && settings.folderTemplate.trim() !== "";
        const trackNumberForTemplate = (hasSubfolder && finalTrackNumber > 0) ? finalTrackNumber : (position || 0);
        if (hasSubfolder) {
            useAlbumTrackNumber = true;
        }
        const templateData: TemplateData = {
            artist: artistName?.replace(/\//g, placeholder),
            album: albumName?.replace(/\//g, placeholder),
            album_artist: albumArtist?.replace(/\//g, placeholder) || artistName?.replace(/\//g, placeholder),
            title: trackName?.replace(/\//g, placeholder),
            track: trackNumberForTemplate,
            year: yearValue,
            playlist: folderName?.replace(/\//g, placeholder),
        };
        const folderTemplate = settings.folderTemplate || "";
        const useAlbumSubfolder = folderTemplate.includes("{album}") || folderTemplate.includes("{album_artist}") || folderTemplate.includes("{playlist}");
        if (folderName && (!isAlbum || !useAlbumSubfolder)) {
            outputDir = joinPath(os, outputDir, sanitizePath(folderName.replace(/\//g, " "), os));
        }
        if (settings.folderTemplate) {
            const folderPath = parseTemplate(settings.folderTemplate, templateData);
            if (folderPath) {
                const parts = folderPath.split("/").filter(p => p.trim());
                for (const part of parts) {
                    const sanitizedPart = part.replace(new RegExp(placeholder, "g"), " ");
                    outputDir = joinPath(os, outputDir, sanitizePath(sanitizedPart, os));
                }
            }
        }
        if (service === "auto") {
            let streamingURLs: any = null;
            if (spotifyId) {
                try {
                    const { GetStreamingURLs } = await import("../../wailsjs/go/main/App");
                    const urlsJson = await GetStreamingURLs(spotifyId, region);
                    streamingURLs = JSON.parse(urlsJson);
                }
                catch (err) {
                    console.error("Failed to get streaming URLs:", err);
                }
            }
            const durationSeconds = durationMs ? Math.round(durationMs / 1000) : undefined;
            const order = (settings.autoOrder || "tidal-amazon-qobuz").split("-");
            let lastResponse: any = { success: false, error: "No matching services found" };
            const is24Bit = (settings.autoQuality || "24") === "24";
            const tidalQuality = is24Bit ? "HI_RES_LOSSLESS" : "LOSSLESS";
            const qobuzQuality = is24Bit ? "7" : "6";
            for (const s of order) {
                if (s === "tidal" && streamingURLs?.tidal_url) {
                    try {
                        const response = await downloadTrack({
                            isrc,
                            service: "tidal",
                            query,
                            track_name: trackName,
                            artist_name: artistName,
                            album_name: albumName,
                            album_artist: albumArtist,
                            release_date: finalReleaseDate || releaseDate,
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
                            audio_format: tidalQuality,
                            spotify_track_number: spotifyTrackNumber,
                            spotify_disc_number: spotifyDiscNumber,
                            spotify_total_tracks: spotifyTotalTracks,
                            spotify_total_discs: spotifyTotalDiscs,
                            copyright: copyright,
                            publisher: publisher,
                        });
                        if (response.success) {
                            return response;
                        }
                        lastResponse = response;
                    }
                    catch (err) {
                        console.error("Tidal error:", err);
                        lastResponse = { success: false, error: String(err) };
                    }
                }
                else if (s === "amazon" && streamingURLs?.amazon_url) {
                    try {
                        const response = await downloadTrack({
                            isrc,
                            service: "amazon",
                            query,
                            track_name: trackName,
                            artist_name: artistName,
                            album_name: albumName,
                            album_artist: albumArtist,
                            release_date: finalReleaseDate || releaseDate,
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
                            spotify_total_discs: spotifyTotalDiscs,
                            copyright: copyright,
                            publisher: publisher,
                        });
                        if (response.success) {
                            return response;
                        }
                        lastResponse = response;
                    }
                    catch (err) {
                        console.error("Amazon error:", err);
                        lastResponse = { success: false, error: String(err) };
                    }
                }
                else if (s === "qobuz") {
                    try {
                        const response = await downloadTrack({
                            isrc,
                            service: "qobuz",
                            query,
                            track_name: trackName,
                            artist_name: artistName,
                            album_name: albumName,
                            album_artist: albumArtist,
                            release_date: finalReleaseDate || releaseDate,
                            cover_url: coverUrl,
                            output_dir: outputDir,
                            filename_format: settings.filenameTemplate,
                            track_number: settings.trackNumber,
                            position: trackNumberForTemplate,
                            use_album_track_number: useAlbumTrackNumber,
                            spotify_id: spotifyId,
                            embed_lyrics: settings.embedLyrics,
                            embed_max_quality_cover: settings.embedMaxQualityCover,
                            duration: durationSeconds,
                            item_id: itemID,
                            audio_format: qobuzQuality,
                            spotify_track_number: spotifyTrackNumber,
                            spotify_disc_number: spotifyDiscNumber,
                            spotify_total_tracks: spotifyTotalTracks,
                            spotify_total_discs: spotifyTotalDiscs,
                            copyright: copyright,
                            publisher: publisher,
                        });
                        if (response.success) {
                            return response;
                        }
                        lastResponse = response;
                    }
                    catch (err) {
                        console.error("Qobuz error:", err);
                        lastResponse = { success: false, error: String(err) };
                    }
                }
            }
            if (!lastResponse.success && itemID) {
                const { MarkDownloadItemFailed } = await import("../../wailsjs/go/main/App");
                await MarkDownloadItemFailed(itemID, lastResponse.error || "All services failed");
            }
            return lastResponse;
        }
        const durationSecondsForFallback = durationMs ? Math.round(durationMs / 1000) : undefined;
        let audioFormat: string | undefined;
        if (service === "tidal") {
            audioFormat = settings.tidalQuality || "LOSSLESS";
        }
        else if (service === "qobuz") {
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
            release_date: finalReleaseDate || releaseDate,
            cover_url: coverUrl,
            output_dir: outputDir,
            filename_format: settings.filenameTemplate,
            track_number: settings.trackNumber,
            position: trackNumberForTemplate,
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
            spotify_total_discs: spotifyTotalDiscs,
            copyright: copyright,
            publisher: publisher,
        });
        if (!singleServiceResponse.success && itemID) {
            const { MarkDownloadItemFailed } = await import("../../wailsjs/go/main/App");
            await MarkDownloadItemFailed(itemID, singleServiceResponse.error || "Download failed");
        }
        return singleServiceResponse;
    };
    const handleDownloadTrack = async (isrc: string, trackName?: string, artistName?: string, albumName?: string, spotifyId?: string, playlistName?: string, durationMs?: number, position?: number, albumArtist?: string, releaseDate?: string, coverUrl?: string, spotifyTrackNumber?: number, spotifyDiscNumber?: number, spotifyTotalTracks?: number, spotifyTotalDiscs?: number, copyright?: string, publisher?: string) => {
        if (!isrc) {
            toast.error("No ISRC found for this track");
            return;
        }
        logger.info(`starting download: ${trackName} - ${artistName}`);
        const settings = getSettings();
        setDownloadingTrack(isrc);
        try {
            const releaseYear = releaseDate?.substring(0, 4);
            const response = await downloadWithAutoFallback(isrc, settings, trackName, artistName, albumName, playlistName, position, spotifyId, durationMs, releaseYear, albumArtist || "", releaseDate, coverUrl, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks, spotifyTotalDiscs, copyright, publisher);
            if (response.success) {
                if (response.already_exists) {
                    toast.info(response.message);
                    setSkippedTracks((prev) => new Set(prev).add(isrc));
                }
                else {
                    toast.success(response.message);
                }
                setDownloadedTracks((prev) => new Set(prev).add(isrc));
                setFailedTracks((prev) => {
                    const newSet = new Set(prev);
                    newSet.delete(isrc);
                    return newSet;
                });
            }
            else {
                toast.error(response.error || "Download failed");
                setFailedTracks((prev) => new Set(prev).add(isrc));
            }
        }
        catch (err) {
            toast.error(err instanceof Error ? err.message : "Download failed");
            setFailedTracks((prev) => new Set(prev).add(isrc));
        }
        finally {
            setDownloadingTrack(null);
        }
    };
    const handleDownloadSelected = async (selectedTracks: string[], allTracks: TrackMetadata[], folderName?: string, isAlbum?: boolean) => {
        if (selectedTracks.length === 0) {
            toast.error("No tracks selected");
            return;
        }
        logger.info(`starting batch download: ${selectedTracks.length} selected tracks`);
        const settings = getSettings();
        setIsDownloading(true);
        setBulkDownloadType("selected");
        setDownloadProgress(0);
        let outputDir = settings.downloadPath;
        const os = settings.operatingSystem;
        const useAlbumTag = settings.folderTemplate?.includes("{album}");
        if (folderName && (!isAlbum || !useAlbumTag)) {
            outputDir = joinPath(os, outputDir, sanitizePath(folderName.replace(/\//g, " "), os));
        }
        const selectedTrackObjects = selectedTracks
            .map((isrc) => allTracks.find((t) => t.isrc === isrc))
            .filter((t): t is TrackMetadata => t !== undefined);
        logger.info(`checking existing files in parallel...`);
        const useAlbumTrackNumber = settings.folderTemplate?.includes("{album}") || false;
        const audioFormat = "flac";
        const existenceChecks = selectedTrackObjects.map((track, index) => {
            return {
                spotify_id: track.spotify_id || track.isrc,
                track_name: track.name || "",
                artist_name: track.artists || "",
                album_name: track.album_name || "",
                album_artist: track.album_artist || "",
                release_date: track.release_date || "",
                track_number: track.track_number || 0,
                disc_number: track.disc_number || 0,
                position: index + 1,
                use_album_track_number: useAlbumTrackNumber,
                filename_format: settings.filenameTemplate || "",
                include_track_number: settings.trackNumber || false,
                audio_format: audioFormat,
            };
        });
        const existenceResults = await CheckFilesExistence(outputDir, existenceChecks);
        const existingSpotifyIDs = new Set<string>();
        const existingFilePaths = new Map<string, string>();
        for (const result of existenceResults) {
            if (result.exists) {
                existingSpotifyIDs.add(result.spotify_id);
                existingFilePaths.set(result.spotify_id, result.file_path || "");
            }
        }
        logger.info(`found ${existingSpotifyIDs.size} existing files`);
        const { AddToDownloadQueue } = await import("../../wailsjs/go/main/App");
        const itemIDs: string[] = [];
        for (const isrc of selectedTracks) {
            const track = allTracks.find((t) => t.isrc === isrc);
            const trackID = track?.spotify_id || isrc;
            const itemID = await AddToDownloadQueue(trackID, track?.name || "", track?.artists || "", track?.album_name || "");
            itemIDs.push(itemID);
            if (existingSpotifyIDs.has(trackID)) {
                const filePath = existingFilePaths.get(trackID) || "";
                setTimeout(() => SkipDownloadItem(itemID, filePath), 10);
                setSkippedTracks((prev) => new Set(prev).add(isrc));
                setDownloadedTracks((prev) => new Set(prev).add(isrc));
            }
        }
        const tracksToDownload = selectedTrackObjects.filter((track) => {
            const trackID = track.spotify_id || track.isrc;
            return !existingSpotifyIDs.has(trackID);
        });
        let successCount = 0;
        let errorCount = 0;
        let skippedCount = existingSpotifyIDs.size;
        const total = selectedTracks.length;
        setDownloadProgress(Math.round((skippedCount / total) * 100));
        for (let i = 0; i < tracksToDownload.length; i++) {
            if (shouldStopDownloadRef.current) {
                toast.info(`Download stopped. ${successCount} tracks downloaded, ${tracksToDownload.length - i} remaining.`);
                break;
            }
            const track = tracksToDownload[i];
            const isrc = track.isrc;
            const originalIndex = selectedTracks.indexOf(isrc);
            const itemID = itemIDs[originalIndex];
            setDownloadingTrack(isrc);
            setCurrentDownloadInfo({ name: track.name, artists: track.artists });
            try {
                const releaseYear = track.release_date?.substring(0, 4);
                const response = await downloadWithItemID(isrc, settings, itemID, track.name, track.artists, track.album_name, folderName, originalIndex + 1, track.spotify_id, track.duration_ms, isAlbum, releaseYear, track.album_artist || "", track.release_date, track.images, track.track_number, track.disc_number, track.total_tracks, track.total_discs, track.copyright, track.publisher);
                if (response.success) {
                    if (response.already_exists) {
                        skippedCount++;
                        logger.info(`skipped: ${track.name} - ${track.artists} (already exists)`);
                        setSkippedTracks((prev) => new Set(prev).add(isrc));
                    }
                    else {
                        successCount++;
                        logger.success(`downloaded: ${track.name} - ${track.artists}`);
                    }
                    setDownloadedTracks((prev) => new Set(prev).add(isrc));
                    setFailedTracks((prev) => {
                        const newSet = new Set(prev);
                        newSet.delete(isrc);
                        return newSet;
                    });
                }
                else {
                    errorCount++;
                    logger.error(`failed: ${track.name} - ${track.artists}`);
                    setFailedTracks((prev) => new Set(prev).add(isrc));
                }
            }
            catch (err) {
                errorCount++;
                logger.error(`error: ${track.name} - ${err}`);
                setFailedTracks((prev) => new Set(prev).add(isrc));
                if (itemID) {
                    const { MarkDownloadItemFailed } = await import("../../wailsjs/go/main/App");
                    await MarkDownloadItemFailed(itemID, err instanceof Error ? err.message : String(err));
                }
            }
            const completedCount = skippedCount + successCount + errorCount;
            setDownloadProgress(Math.min(100, Math.round((completedCount / total) * 100)));
        }
        setDownloadingTrack(null);
        setCurrentDownloadInfo(null);
        setIsDownloading(false);
        setBulkDownloadType(null);
        shouldStopDownloadRef.current = false;
        const { CancelAllQueuedItems } = await import("../../wailsjs/go/main/App");
        await CancelAllQueuedItems();
        logger.info(`batch complete: ${successCount} downloaded, ${skippedCount} skipped, ${errorCount} failed`);
        if (errorCount === 0 && skippedCount === 0) {
            toast.success(`Downloaded ${successCount} tracks successfully`);
        }
        else if (errorCount === 0 && successCount === 0) {
            toast.info(`${skippedCount} tracks already exist`);
        }
        else if (errorCount === 0) {
            toast.info(`${successCount} downloaded, ${skippedCount} skipped`);
        }
        else {
            const parts = [];
            if (successCount > 0)
                parts.push(`${successCount} downloaded`);
            if (skippedCount > 0)
                parts.push(`${skippedCount} skipped`);
            parts.push(`${errorCount} failed`);
            toast.warning(parts.join(", "));
        }
    };
    const handleDownloadAll = async (tracks: TrackMetadata[], folderName?: string, isAlbum?: boolean) => {
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
        let outputDir = settings.downloadPath;
        const os = settings.operatingSystem;
        const useAlbumTag = settings.folderTemplate?.includes("{album}");
        if (folderName && (!isAlbum || !useAlbumTag)) {
            outputDir = joinPath(os, outputDir, sanitizePath(folderName.replace(/\//g, " "), os));
        }
        logger.info(`checking existing files in parallel...`);
        const useAlbumTrackNumber = settings.folderTemplate?.includes("{album}") || false;
        const audioFormat = "flac";
        const existenceChecks = tracksWithIsrc.map((track, index) => {
            return {
                spotify_id: track.spotify_id || track.isrc,
                track_name: track.name || "",
                artist_name: track.artists || "",
                album_name: track.album_name || "",
                album_artist: track.album_artist || "",
                release_date: track.release_date || "",
                track_number: track.track_number || 0,
                disc_number: track.disc_number || 0,
                position: index + 1,
                use_album_track_number: useAlbumTrackNumber,
                filename_format: settings.filenameTemplate || "",
                include_track_number: settings.trackNumber || false,
                audio_format: audioFormat,
            };
        });
        const existenceResults = await CheckFilesExistence(outputDir, existenceChecks);
        const existingSpotifyIDs = new Set<string>();
        const existingFilePaths = new Map<string, string>();
        for (const result of existenceResults) {
            if (result.exists) {
                existingSpotifyIDs.add(result.spotify_id);
                existingFilePaths.set(result.spotify_id, result.file_path || "");
            }
        }
        logger.info(`found ${existingSpotifyIDs.size} existing files`);
        const { AddToDownloadQueue } = await import("../../wailsjs/go/main/App");
        const itemIDs: string[] = [];
        for (const track of tracksWithIsrc) {
            const itemID = await AddToDownloadQueue(track.isrc, track.name, track.artists, track.album_name || "");
            itemIDs.push(itemID);
            const trackID = track.spotify_id || track.isrc;
            if (existingSpotifyIDs.has(trackID)) {
                const filePath = existingFilePaths.get(trackID) || "";
                setTimeout(() => SkipDownloadItem(itemID, filePath), 10);
                setSkippedTracks((prev) => new Set(prev).add(track.isrc));
                setDownloadedTracks((prev) => new Set(prev).add(track.isrc));
            }
        }
        const tracksToDownload = tracksWithIsrc.filter((track) => {
            const trackID = track.spotify_id || track.isrc;
            return !existingSpotifyIDs.has(trackID);
        });
        let successCount = 0;
        let errorCount = 0;
        let skippedCount = existingSpotifyIDs.size;
        const total = tracksWithIsrc.length;
        setDownloadProgress(Math.round((skippedCount / total) * 100));
        for (let i = 0; i < tracksToDownload.length; i++) {
            if (shouldStopDownloadRef.current) {
                toast.info(`Download stopped. ${successCount} tracks downloaded, ${tracksToDownload.length - i} remaining.`);
                break;
            }
            const track = tracksToDownload[i];
            const originalIndex = tracksWithIsrc.findIndex((t) => t.isrc === track.isrc);
            const itemID = itemIDs[originalIndex];
            setDownloadingTrack(track.isrc);
            setCurrentDownloadInfo({ name: track.name, artists: track.artists });
            try {
                const releaseYear = track.release_date?.substring(0, 4);
                const response = await downloadWithItemID(track.isrc, settings, itemID, track.name, track.artists, track.album_name, folderName, originalIndex + 1, track.spotify_id, track.duration_ms, isAlbum, releaseYear, track.album_artist || "", track.release_date, track.images, track.track_number, track.disc_number, track.total_tracks, track.total_discs, track.copyright, track.publisher);
                if (response.success) {
                    if (response.already_exists) {
                        skippedCount++;
                        logger.info(`skipped: ${track.name} - ${track.artists} (already exists)`);
                        setSkippedTracks((prev) => new Set(prev).add(track.isrc));
                    }
                    else {
                        successCount++;
                        logger.success(`downloaded: ${track.name} - ${track.artists}`);
                    }
                    setDownloadedTracks((prev) => new Set(prev).add(track.isrc));
                    setFailedTracks((prev) => {
                        const newSet = new Set(prev);
                        newSet.delete(track.isrc);
                        return newSet;
                    });
                }
                else {
                    errorCount++;
                    logger.error(`failed: ${track.name} - ${track.artists}`);
                    setFailedTracks((prev) => new Set(prev).add(track.isrc));
                }
            }
            catch (err) {
                errorCount++;
                logger.error(`error: ${track.name} - ${err}`);
                setFailedTracks((prev) => new Set(prev).add(track.isrc));
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
        const { CancelAllQueuedItems: CancelQueued } = await import("../../wailsjs/go/main/App");
        await CancelQueued();
        logger.info(`batch complete: ${successCount} downloaded, ${skippedCount} skipped, ${errorCount} failed`);
        if (errorCount === 0 && skippedCount === 0) {
            toast.success(`Downloaded ${successCount} tracks successfully`);
        }
        else if (errorCount === 0 && successCount === 0) {
            toast.info(`${skippedCount} tracks already exist`);
        }
        else if (errorCount === 0) {
            toast.info(`${successCount} downloaded, ${skippedCount} skipped`);
        }
        else {
            const parts = [];
            if (successCount > 0)
                parts.push(`${successCount} downloaded`);
            if (skippedCount > 0)
                parts.push(`${skippedCount} skipped`);
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
