import { getPreviewVolume, PREVIEW_VOLUME_CHANGED_EVENT } from "@/lib/preview";
export interface PreviewPlayback {
    audio: HTMLAudioElement;
    destroy: () => void;
}
export async function createPreviewPlayback(url: string, volume: number): Promise<PreviewPlayback> {
    const audio = new Audio(url);
    const applyVolume = (nextVolume: number) => {
        if (!Number.isFinite(nextVolume)) {
            return;
        }
        audio.volume = Math.min(1, Math.max(0, nextVolume));
    };
    applyVolume(volume);
    const handleSettingsUpdated = () => {
        applyVolume(getPreviewVolume());
    };
    const handlePreviewVolumeChanged = (event: Event) => {
        const nextVolumePercent = (event as CustomEvent<number>).detail;
        if (!Number.isFinite(nextVolumePercent)) {
            return;
        }
        applyVolume(nextVolumePercent / 100);
    };
    window.addEventListener("settingsUpdated", handleSettingsUpdated);
    window.addEventListener(PREVIEW_VOLUME_CHANGED_EVENT, handlePreviewVolumeChanged);
    return {
        audio,
        destroy: () => {
            window.removeEventListener("settingsUpdated", handleSettingsUpdated);
            window.removeEventListener(PREVIEW_VOLUME_CHANGED_EVENT, handlePreviewVolumeChanged);
            audio.pause();
            audio.removeAttribute("src");
            audio.load();
        },
    };
}
