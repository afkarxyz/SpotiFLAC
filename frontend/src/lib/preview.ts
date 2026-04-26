import { getSettings } from "@/lib/settings";
export const SPOTIFY_PREVIEW_VOLUME = 1;
export const PREVIEW_VOLUME_CHANGED_EVENT = "previewVolumeChanged";
export function getPreviewVolume(): number {
    const previewVolume = getSettings().previewVolume;
    if (!Number.isFinite(previewVolume)) {
        return SPOTIFY_PREVIEW_VOLUME;
    }
    return Math.min(1, Math.max(0, previewVolume / 100));
}
