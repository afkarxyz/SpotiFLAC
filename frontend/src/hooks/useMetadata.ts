import { useEffect, useRef, useState } from "react";
import { fetchSpotifyMetadata } from "@/lib/api";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { logger } from "@/lib/logger";
import { AddFetchHistory, SearchSpotifyByType } from "../../wailsjs/go/main/App";
import { EventsOff, EventsOn } from "../../wailsjs/runtime/runtime";
import type { SpotifyMetadataResponse } from "@/types/api";
export function useMetadata() {
    const [loading, setLoading] = useState(false);
    const [metadata, setMetadata] = useState<SpotifyMetadataResponse | null>(null);
    const [showVpnAdviceDialog, setShowVpnAdviceDialog] = useState(false);
    const [fetchFailureReason, setFetchFailureReason] = useState("");
    const loadingToastId = useRef<string | number | null>(null);
    const fetchedCount = useRef(0);
    const currentName = useRef("");
    const [showAlbumDialog, setShowAlbumDialog] = useState(false);
    const [selectedAlbum, setSelectedAlbum] = useState<{
        id: string;
        name: string;
        external_urls: string;
    } | null>(null);
    const [pendingArtistName, setPendingArtistName] = useState<string | null>(null);
    const showFetchFailureAdvice = (errorMsg: string) => {
        setFetchFailureReason(errorMsg);
        setShowVpnAdviceDialog(true);
    };
    const resolveArtistUrlBySearch = async (artistName: string): Promise<string | null> => {
        const query = artistName.trim();
        if (!query) {
            return null;
        }
        const results = await SearchSpotifyByType({
            query,
            search_type: "artist",
            limit: 1,
            offset: 0,
        });
        return results[0]?.external_urls || null;
    };
    useEffect(() => {
        if (loading) {
            fetchedCount.current = 0;
            currentName.current = "";
            loadingToastId.current = toast.silentInfo("fetching metadata...", {
                duration: Infinity,
                description: "please wait while we retrieve the information"
            });
            return;
        }
        if (loadingToastId.current) {
            toast.dismiss(loadingToastId.current);
            loadingToastId.current = null;
        }
    }, [loading]);
    useEffect(() => {
        const handler = (data: any) => {
            if (!data) {
                return;
            }
            if (Array.isArray(data)) {
                fetchedCount.current += data.length;
                if (loadingToastId.current && currentName.current) {
                    toast.silentInfo(`fetching tracks for ${currentName.current.toLowerCase()}...`, {
                        id: loadingToastId.current,
                        description: `${fetchedCount.current.toLocaleString()} tracks fetched`
                    });
                }
            }
            else {
                const baseInfo = data;
                const name = "artist_info" in baseInfo ? baseInfo.artist_info.name :
                    "album_info" in baseInfo ? baseInfo.album_info.name :
                        "playlist_info" in baseInfo ? (baseInfo.playlist_info.name || baseInfo.playlist_info.owner.name) : "";
                if (name) {
                    currentName.current = name;
                    if (loadingToastId.current) {
                        toast.silentInfo(`fetching tracks for ${name.toLowerCase()}...`, {
                            id: loadingToastId.current,
                            description: `${fetchedCount.current.toLocaleString()} tracks fetched`
                        });
                    }
                }
            }
            setMetadata(prev => {
                if (Array.isArray(data)) {
                    if (!prev || !("track_list" in prev)) {
                        return prev;
                    }
                    return {
                        ...prev,
                        track_list: [...prev.track_list, ...data]
                    };
                }
                if (prev && "track_list" in prev && prev.track_list.length > 0) {
                    return prev;
                }
                const baseInfo = data;
                if (!("track_list" in baseInfo)) {
                    baseInfo.track_list = [];
                }
                return baseInfo;
            });
        };
        EventsOn("metadata-stream", handler);
        return () => EventsOff("metadata-stream");
    }, []);
    const getUrlType = (url: string): string => {
        if (url.includes("/track/"))
            return "track";
        if (url.includes("/album/"))
            return "album";
        if (url.includes("/playlist/"))
            return "playlist";
        if (url.includes("/artist/"))
            return "artist";
        return "unknown";
    };
    const saveToHistory = async (url: string, data: SpotifyMetadataResponse) => {
        try {
            let name = "";
            let info = "";
            let image = "";
            let type = "unknown";
            if ("track" in data) {
                type = "track";
                name = data.track.name;
                info = data.track.artists;
                image = (data.track.images && data.track.images.length > 0) ? data.track.images : "";
            }
            else if ("album_info" in data) {
                type = "album";
                name = data.album_info.name;
                info = `${data.track_list.length} tracks`;
                image = data.album_info.images;
            }
            else if ("playlist_info" in data) {
                type = "playlist";
                if (data.playlist_info.name) {
                    name = data.playlist_info.name;
                }
                else if (data.playlist_info.owner.name) {
                    name = data.playlist_info.owner.name;
                }
                info = `${data.playlist_info.tracks.total} tracks`;
                image = data.playlist_info.cover || "";
            }
            else if ("artist_info" in data) {
                type = "artist";
                name = data.artist_info.name;
                info = `${data.artist_info.total_albums || data.album_list.length} albums`;
                image = data.artist_info.images;
            }
            const jsonStr = JSON.stringify(data);
            await AddFetchHistory({
                id: crypto.randomUUID(),
                url: url,
                type: type,
                name: name,
                info: info,
                image: image,
                data: jsonStr,
                timestamp: Math.floor(Date.now() / 1000)
            });
        }
        catch (err) {
            console.error("Failed to save fetch history:", err);
        }
    };
    const fetchMetadataDirectly = async (url: string) => {
        const urlType = getUrlType(url);
        logger.info(`fetching ${urlType} metadata...`);
        logger.debug(`url: ${url}`);
        setLoading(true);
        setMetadata(null);
        try {
            const startTime = Date.now();
            const timeout = urlType === "artist" ? 60 : 300;
            const data = await fetchSpotifyMetadata(url, true, 1.0, timeout);
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
            if ("playlist_info" in data) {
                const playlistInfo = data.playlist_info;
                if (!playlistInfo.owner.name && playlistInfo.tracks.total === 0 && data.track_list.length === 0) {
                    logger.warning("playlist appears to be empty or private");
                    toast.error("Playlist not found or may be private");
                    setMetadata(null);
                    return;
                }
            }
            else if ("album_info" in data) {
                const albumInfo = data.album_info;
                if (!albumInfo.name && albumInfo.total_tracks === 0 && data.track_list.length === 0) {
                    logger.warning("album appears to be empty or not found");
                    toast.error("Album not found or may be private");
                    setMetadata(null);
                    return;
                }
            }
            setMetadata(data);
            saveToHistory(url, data);
            if ("track" in data) {
                logger.success(`fetched track: ${data.track.name} - ${data.track.artists}`);
                logger.debug(`duration: ${data.track.duration_ms}ms`);
            }
            else if ("album_info" in data) {
                logger.success(`fetched album: ${data.album_info.name}`);
                logger.debug(`${data.track_list.length} tracks, released: ${data.album_info.release_date}`);
            }
            else if ("playlist_info" in data) {
                logger.success(`fetched playlist: ${data.track_list.length} tracks`);
                logger.debug(`by ${data.playlist_info.owner.display_name || data.playlist_info.owner.name}`);
            }
            else if ("artist_info" in data) {
                logger.success(`fetched artist: ${data.artist_info.name}`);
                logger.debug(`${data.album_list.length} albums, ${data.track_list.length} tracks`);
            }
            logger.info(`fetch completed in ${elapsed}s`);
            toast.success("Metadata fetched successfully");
        }
        catch (err) {
            const errorMsg = err instanceof Error ? err.message : "Failed to fetch metadata";
            logger.error(`fetch failed: ${errorMsg}`);
            toast.error(errorMsg);
            showFetchFailureAdvice(errorMsg);
        }
        finally {
            setLoading(false);
        }
    };
    const loadFromCache = (cachedData: string) => {
        try {
            const data = JSON.parse(cachedData);
            setMetadata(data);
            toast.success("Loaded from cache");
        }
        catch (err) {
            console.error("Failed to load from cache:", err);
            toast.error("Failed to load from cache");
        }
    };
    const handleFetchMetadata = async (url: string) => {
        if (!url.trim()) {
            logger.warning("empty url provided");
            toast.error("Please enter a Spotify URL");
            return;
        }
        let urlToFetch = url.trim();
        const isArtistUrl = urlToFetch.includes("/artist/");
        if (isArtistUrl && !urlToFetch.includes("/discography")) {
            urlToFetch = urlToFetch.replace(/\/$/, "") + "/discography/all";
            logger.debug("converted to discography url");
        }
        if (isArtistUrl) {
            logger.info("artist url detected");
            setPendingArtistName(null);
            await fetchMetadataDirectly(urlToFetch);
        }
        else {
            await fetchMetadataDirectly(urlToFetch);
        }
        return urlToFetch;
    };
    const handleAlbumClick = (album: {
        id: string;
        name: string;
        external_urls: string;
    }) => {
        logger.debug(`album clicked: ${album.name}`);
        setSelectedAlbum(album);
        setShowAlbumDialog(true);
    };
    const handleArtistClick = async (artist: {
        id: string;
        name: string;
        external_urls: string;
    }) => {
        logger.debug(`artist clicked: ${artist.name}`);
        const resolvedArtistUrl = artist.external_urls.trim() || (await resolveArtistUrlBySearch(artist.name)) || "";
        if (!resolvedArtistUrl) {
            toast.error(`Artist not found: ${artist.name}`);
            return "";
        }
        const artistUrl = resolvedArtistUrl.includes("/discography")
            ? resolvedArtistUrl
            : resolvedArtistUrl.replace(/\/$/, "") + "/discography/all";
        setPendingArtistName(artist.name);
        await fetchMetadataDirectly(artistUrl);
        return resolvedArtistUrl;
    };
    const handleConfirmAlbumFetch = async () => {
        if (!selectedAlbum)
            return;
        const albumUrl = selectedAlbum.external_urls;
        logger.info(`fetching album: ${selectedAlbum.name}...`);
        logger.debug(`url: ${albumUrl}`);
        setShowAlbumDialog(false);
        setLoading(true);
        setMetadata(null);
        try {
            const startTime = Date.now();
            const data = await fetchSpotifyMetadata(albumUrl);
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
            if ("album_info" in data) {
                const albumInfo = data.album_info;
                if (!albumInfo.name && albumInfo.total_tracks === 0 && data.track_list.length === 0) {
                    logger.warning("album appears to be empty or not found");
                    toast.error("Album not found or may be private");
                    setMetadata(null);
                    setSelectedAlbum(null);
                    return albumUrl;
                }
            }
            setMetadata(data);
            saveToHistory(albumUrl, data);
            if ("album_info" in data) {
                logger.success(`fetched album: ${data.album_info.name}`);
                logger.debug(`${data.track_list.length} tracks, released: ${data.album_info.release_date}`);
            }
            logger.info(`fetch completed in ${elapsed}s`);
            toast.success("Album metadata fetched successfully");
            return albumUrl;
        }
        catch (err) {
            const errorMsg = err instanceof Error ? err.message : "Failed to fetch album metadata";
            logger.error(`fetch failed: ${errorMsg}`);
            toast.error(errorMsg);
            showFetchFailureAdvice(errorMsg);
        }
        finally {
            setLoading(false);
            setSelectedAlbum(null);
        }
    };
    return {
        loading,
        metadata,
        showVpnAdviceDialog,
        setShowVpnAdviceDialog,
        fetchFailureReason,
        showAlbumDialog,
        setShowAlbumDialog,
        selectedAlbum,
        pendingArtistName,
        handleFetchMetadata,
        handleAlbumClick,
        handleConfirmAlbumFetch,
        handleArtistClick,
        loadFromCache,
        resetMetadata: () => setMetadata(null),
    };
}
