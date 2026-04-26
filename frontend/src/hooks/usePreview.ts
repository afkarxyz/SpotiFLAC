import { useEffect, useRef, useState } from "react";
import { GetPreviewURL } from "@/../wailsjs/go/main/App";
import { getPreviewVolume } from "@/lib/preview";
import { createPreviewPlayback, type PreviewPlayback } from "@/lib/preview-player";
import { toast } from "sonner";
export function usePreview() {
    const [loadingPreview, setLoadingPreview] = useState<string | null>(null);
    const [playingTrack, setPlayingTrack] = useState<string | null>(null);
    const currentPlaybackRef = useRef<PreviewPlayback | null>(null);
    const stopCurrentAudio = () => {
        if (!currentPlaybackRef.current) {
            return;
        }
        currentPlaybackRef.current.destroy();
        currentPlaybackRef.current = null;
    };
    useEffect(() => {
        return () => {
            stopCurrentAudio();
        };
    }, []);
    const playPreview = async (trackId: string, trackName: string) => {
        try {
            const currentAudio = currentPlaybackRef.current?.audio;
            if (playingTrack === trackId && currentAudio) {
                stopCurrentAudio();
                setPlayingTrack(null);
                return;
            }
            if (currentAudio) {
                stopCurrentAudio();
                setPlayingTrack(null);
            }
            setLoadingPreview(trackId);
            const previewURL = await GetPreviewURL(trackId);
            if (!previewURL) {
                toast.error("Preview not available", {
                    description: `No preview found for "${trackName}"`,
                });
                setLoadingPreview(null);
                return;
            }
            const playback = await createPreviewPlayback(previewURL, getPreviewVolume());
            const audio = playback.audio;
            audio.addEventListener("loadeddata", () => {
                setLoadingPreview(null);
                setPlayingTrack(trackId);
            });
            audio.addEventListener("ended", () => {
                setPlayingTrack(null);
                if (currentPlaybackRef.current?.audio === audio) {
                    currentPlaybackRef.current.destroy();
                    currentPlaybackRef.current = null;
                }
            });
            audio.addEventListener("error", () => {
                toast.error("Failed to play preview", {
                    description: `Could not play preview for "${trackName}"`,
                });
                setLoadingPreview(null);
                setPlayingTrack(null);
                if (currentPlaybackRef.current?.audio === audio) {
                    currentPlaybackRef.current.destroy();
                    currentPlaybackRef.current = null;
                }
            });
            currentPlaybackRef.current = playback;
            await audio.play();
        }
        catch (error: unknown) {
            stopCurrentAudio();
            console.error("Preview error:", error);
            toast.error("Preview not available", {
                description: error instanceof Error ? error.message : `Could not load preview for "${trackName}"`,
            });
            setLoadingPreview(null);
            setPlayingTrack(null);
        }
    };
    const stopPreview = () => {
        stopCurrentAudio();
        setPlayingTrack(null);
    };
    return {
        playPreview,
        stopPreview,
        loadingPreview,
        playingTrack,
    };
}
