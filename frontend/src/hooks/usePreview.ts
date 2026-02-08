import { useState, useEffect } from "react";
import { GetPreviewURL } from "@/../wailsjs/go/main/App";
import { toast } from "sonner";
export function usePreview() {
    const [loadingPreview, setLoadingPreview] = useState<string | null>(null);
    const [currentAudio, setCurrentAudio] = useState<HTMLAudioElement | null>(null);
    const [playingTrack, setPlayingTrack] = useState<string | null>(null);
    useEffect(() => {
        return () => {
            if (currentAudio) {
                currentAudio.pause();
                currentAudio.currentTime = 0;
            }
        };
    }, [currentAudio]);
    const playPreview = async (trackId: string, trackName: string) => {
        try {
            if (playingTrack === trackId && currentAudio) {
                currentAudio.pause();
                currentAudio.currentTime = 0;
                setPlayingTrack(null);
                setCurrentAudio(null);
                return;
            }
            if (currentAudio) {
                currentAudio.pause();
                currentAudio.currentTime = 0;
                setCurrentAudio(null);
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
            const audio = new Audio(previewURL);
            audio.addEventListener("loadeddata", () => {
                setLoadingPreview(null);
                setPlayingTrack(trackId);
            });
            audio.addEventListener("ended", () => {
                setPlayingTrack(null);
                setCurrentAudio(null);
            });
            audio.addEventListener("error", () => {
                toast.error("Failed to play preview", {
                    description: `Could not play preview for "${trackName}"`,
                });
                setLoadingPreview(null);
                setPlayingTrack(null);
                setCurrentAudio(null);
            });
            setCurrentAudio(audio);
            await audio.play();
        }
        catch (error: any) {
            console.error("Preview error:", error);
            toast.error("Preview not available", {
                description: error?.message || `Could not load preview for "${trackName}"`,
            });
            setLoadingPreview(null);
            setPlayingTrack(null);
        }
    };
    const stopPreview = () => {
        if (currentAudio) {
            currentAudio.pause();
            currentAudio.currentTime = 0;
            setCurrentAudio(null);
            setPlayingTrack(null);
        }
    };
    return {
        playPreview,
        stopPreview,
        loadingPreview,
        playingTrack,
    };
}
