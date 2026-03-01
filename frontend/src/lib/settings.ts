import { GetDefaults, LoadSettings, SaveSettings as SaveToBackend } from "../../wailsjs/go/main/App";
export type FontFamily = "google-sans" | "inter" | "poppins" | "roboto" | "dm-sans" | "plus-jakarta-sans" | "manrope" | "space-grotesk" | "noto-sans" | "nunito-sans" | "figtree" | "raleway" | "public-sans" | "outfit" | "jetbrains-mono" | "geist-sans" | "bricolage-grotesque";
export type FolderPreset = "none" | "artist" | "album" | "year-album" | "year-artist-album" | "artist-album" | "artist-year-album" | "artist-year-nested-album" | "album-artist" | "album-artist-album" | "album-artist-year-album" | "album-artist-year-nested-album" | "year" | "year-artist" | "custom";
export type FilenamePreset = "title" | "title-artist" | "artist-title" | "track-title" | "track-title-artist" | "track-artist-title" | "title-album-artist" | "track-title-album-artist" | "artist-album-title" | "track-dash-title" | "disc-track-title" | "disc-track-title-artist" | "custom";
export interface Settings {
    downloadPath: string;
    downloader: "auto" | "tidal" | "qobuz" | "amazon" | "deezer";
    theme: string;
    themeMode: "auto" | "light" | "dark";
    fontFamily: FontFamily;
    folderPreset: FolderPreset;
    folderTemplate: string;
    filenamePreset: FilenamePreset;
    filenameTemplate: string;
    filenameFormat?: "title-artist" | "artist-title" | "title";
    artistSubfolder?: boolean;
    albumSubfolder?: boolean;
    trackNumber: boolean;
    sfxEnabled: boolean;
    embedLyrics: boolean;
    embedMaxQualityCover: boolean;
    operatingSystem: "Windows" | "linux/MacOS";
    tidalQuality: "LOSSLESS" | "HI_RES_LOSSLESS";
    qobuzQuality: "6" | "7" | "27";
    amazonQuality: "original";
    autoOrder: "tidal-qobuz-amazon-deezer" | "tidal-qobuz-deezer-amazon" | "tidal-amazon-qobuz-deezer" | "tidal-amazon-deezer-qobuz" | "tidal-deezer-qobuz-amazon" | "tidal-deezer-amazon-qobuz" | "qobuz-tidal-amazon-deezer" | "qobuz-tidal-deezer-amazon" | "qobuz-amazon-tidal-deezer" | "qobuz-amazon-deezer-tidal" | "qobuz-deezer-tidal-amazon" | "qobuz-deezer-amazon-tidal" | "amazon-tidal-qobuz-deezer" | "amazon-tidal-deezer-qobuz" | "amazon-qobuz-tidal-deezer" | "amazon-qobuz-deezer-tidal" | "amazon-deezer-tidal-qobuz" | "amazon-deezer-qobuz-tidal" | "deezer-tidal-qobuz-amazon" | "deezer-tidal-amazon-qobuz" | "deezer-qobuz-tidal-amazon" | "deezer-qobuz-amazon-tidal" | "deezer-amazon-tidal-qobuz" | "deezer-amazon-qobuz-tidal" | string;
    autoQuality: "16" | "24";
    allowFallback: boolean;
    useSpotFetchAPI: boolean;
    spotFetchAPIUrl: string;
    createPlaylistFolder: boolean;
    createM3u8File: boolean;
    useFirstArtistOnly: boolean;
    useSingleGenre: boolean;
    embedGenre: boolean;
    concurrentDownloads: number;
}
export const FOLDER_PRESETS: Record<FolderPreset, {
    label: string;
    template: string;
}> = {
    "none": { label: "No Subfolder", template: "" },
    "artist": { label: "Artist", template: "{artist}" },
    "album": { label: "Album", template: "{album}" },
    "year-album": { label: "[Year] Album", template: "[{year}] {album}" },
    "year-artist-album": { label: "[Year] Artist - Album", template: "[{year}] {artist} - {album}" },
    "artist-album": { label: "Artist / Album", template: "{artist}/{album}" },
    "artist-year-album": { label: "Artist / [Year] Album", template: "{artist}/[{year}] {album}" },
    "artist-year-nested-album": { label: "Artist / Year / Album", template: "{artist}/{year}/{album}" },
    "album-artist": { label: "Album Artist", template: "{album_artist}" },
    "album-artist-album": { label: "Album Artist / Album", template: "{album_artist}/{album}" },
    "album-artist-year-album": { label: "Album Artist / [Year] Album", template: "{album_artist}/[{year}] {album}" },
    "album-artist-year-nested-album": { label: "Album Artist / Year / Album", template: "{album_artist}/{year}/{album}" },
    "year": { label: "Year", template: "{year}" },
    "year-artist": { label: "Year / Artist", template: "{year}/{artist}" },
    "custom": { label: "Custom...", template: "{artist}/{album}" },
};
export const FILENAME_PRESETS: Record<FilenamePreset, {
    label: string;
    template: string;
}> = {
    "title": { label: "Title", template: "{title}" },
    "title-artist": { label: "Title - Artist", template: "{title} - {artist}" },
    "artist-title": { label: "Artist - Title", template: "{artist} - {title}" },
    "track-title": { label: "Track. Title", template: "{track}. {title}" },
    "track-title-artist": { label: "Track. Title - Artist", template: "{track}. {title} - {artist}" },
    "track-artist-title": { label: "Track. Artist - Title", template: "{track}. {artist} - {title}" },
    "title-album-artist": { label: "Title - Album Artist", template: "{title} - {album_artist}" },
    "track-title-album-artist": { label: "Track. Title - Album Artist", template: "{track}. {title} - {album_artist}" },
    "artist-album-title": { label: "Artist - Album - Title", template: "{artist} - {album} - {title}" },
    "track-dash-title": { label: "Track - Title", template: "{track} - {title}" },
    "disc-track-title": { label: "Disc-Track. Title", template: "{disc}-{track}. {title}" },
    "disc-track-title-artist": { label: "Disc-Track. Title - Artist", template: "{disc}-{track}. {title} - {artist}" },
    "custom": { label: "Custom...", template: "{title} - {artist}" },
};
export const TEMPLATE_VARIABLES = [
    { key: "{title}", description: "Track title", example: "Shake It Off" },
    { key: "{artist}", description: "Track artist", example: "Taylor Swift" },
    { key: "{album}", description: "Album name", example: "1989" },
    { key: "{album_artist}", description: "Album artist", example: "Taylor Swift" },
    { key: "{track}", description: "Track number", example: "01" },
    { key: "{disc}", description: "Disc number", example: "1" },
    { key: "{year}", description: "Release year", example: "2014" },
    { key: "{date}", description: "Release date (YYYY-MM-DD)", example: "2014-10-27" },
];
function detectOS(): "Windows" | "linux/MacOS" {
    const platform = window.navigator.platform.toLowerCase();
    if (platform.includes('win')) {
        return "Windows";
    }
    return "linux/MacOS";
}
export const DEFAULT_SETTINGS: Settings = {
    downloadPath: "",
    downloader: "auto",
    theme: "yellow",
    themeMode: "auto",
    fontFamily: "google-sans",
    folderPreset: "none",
    folderTemplate: "",
    filenamePreset: "title-artist",
    filenameTemplate: "{title} - {artist}",
    trackNumber: false,
    sfxEnabled: true,
    embedLyrics: false,
    embedMaxQualityCover: false,
    operatingSystem: detectOS(),
    tidalQuality: "LOSSLESS",
    qobuzQuality: "6",
    amazonQuality: "original",
    autoOrder: "tidal-qobuz-amazon-deezer",
    autoQuality: "16",
    allowFallback: true,
    useSpotFetchAPI: false,
    spotFetchAPIUrl: "https://spotify.afkarxyz.fun/api",
    createPlaylistFolder: true,
    createM3u8File: false,
    useFirstArtistOnly: false,
    useSingleGenre: false,
    embedGenre: true,
    concurrentDownloads: 3
};
export const FONT_OPTIONS: {
    value: FontFamily;
    label: string;
    fontFamily: string;
}[] = [
    { value: "bricolage-grotesque", label: "Bricolage Grotesque", fontFamily: '"Bricolage Grotesque", system-ui, sans-serif' },
    { value: "dm-sans", label: "DM Sans", fontFamily: '"DM Sans", system-ui, sans-serif' },
    { value: "figtree", label: "Figtree", fontFamily: '"Figtree", system-ui, sans-serif' },
    { value: "geist-sans", label: "Geist Sans", fontFamily: '"Geist", system-ui, sans-serif' },
    { value: "google-sans", label: "Google Sans", fontFamily: '"Google Sans", system-ui, sans-serif' },
    { value: "inter", label: "Inter", fontFamily: '"Inter", system-ui, sans-serif' },
    { value: "jetbrains-mono", label: "JetBrains Mono", fontFamily: '"JetBrains Mono", ui-monospace, monospace' },
    { value: "manrope", label: "Manrope", fontFamily: '"Manrope", system-ui, sans-serif' },
    { value: "noto-sans", label: "Noto Sans", fontFamily: '"Noto Sans", system-ui, sans-serif' },
    { value: "nunito-sans", label: "Nunito Sans", fontFamily: '"Nunito Sans", system-ui, sans-serif' },
    { value: "outfit", label: "Outfit", fontFamily: '"Outfit", system-ui, sans-serif' },
    { value: "plus-jakarta-sans", label: "Plus Jakarta Sans", fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' },
    { value: "poppins", label: "Poppins", fontFamily: '"Poppins", system-ui, sans-serif' },
    { value: "public-sans", label: "Public Sans", fontFamily: '"Public Sans", system-ui, sans-serif' },
    { value: "raleway", label: "Raleway", fontFamily: '"Raleway", system-ui, sans-serif' },
    { value: "roboto", label: "Roboto", fontFamily: '"Roboto", system-ui, sans-serif' },
    { value: "space-grotesk", label: "Space Grotesk", fontFamily: '"Space Grotesk", system-ui, sans-serif' },
];
export function applyFont(fontFamily: FontFamily): void {
    const font = FONT_OPTIONS.find(f => f.value === fontFamily);
    if (font) {
        document.documentElement.style.setProperty('--font-sans', font.fontFamily);
        document.body.style.fontFamily = font.fontFamily;
    }
}
async function fetchDefaultPath(): Promise<string> {
    try {
        const data = await GetDefaults();
        return data.downloadPath || "";
    }
    catch (error) {
        console.error("Failed to fetch default path:", error);
        return "";
    }
}
const SETTINGS_KEY = "spotiflac-settings";
let cachedSettings: Settings | null = null;
function getSettingsFromLocalStorage(): Settings {
    try {
        const stored = localStorage.getItem(SETTINGS_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            if ('darkMode' in parsed && !('themeMode' in parsed)) {
                parsed.themeMode = parsed.darkMode ? 'dark' : 'light';
                delete parsed.darkMode;
            }
            if (!('folderPreset' in parsed) && ('artistSubfolder' in parsed || 'albumSubfolder' in parsed)) {
                const hasArtist = parsed.artistSubfolder;
                const hasAlbum = parsed.albumSubfolder;
                if (hasArtist && hasAlbum) {
                    parsed.folderPreset = "artist-album";
                    parsed.folderTemplate = "{artist}/{album}";
                }
                else if (hasArtist) {
                    parsed.folderPreset = "artist";
                    parsed.folderTemplate = "{artist}";
                }
                else if (hasAlbum) {
                    parsed.folderPreset = "album";
                    parsed.folderTemplate = "{album}";
                }
                else {
                    parsed.folderPreset = "none";
                    parsed.folderTemplate = "";
                }
            }
            if (!('filenamePreset' in parsed) && 'filenameFormat' in parsed) {
                const format = parsed.filenameFormat;
                if (format === "title-artist") {
                    parsed.filenamePreset = "artist-title";
                    parsed.filenameTemplate = "{artist} - {title}";
                }
                else if (format === "artist-title") {
                    parsed.filenamePreset = "artist-title";
                    parsed.filenameTemplate = "{artist} - {title}";
                }
                else {
                    parsed.filenamePreset = "title";
                    parsed.filenameTemplate = "{title}";
                }
            }
            parsed.operatingSystem = detectOS();
            if (!('tidalQuality' in parsed)) {
                parsed.tidalQuality = "LOSSLESS";
            }
            if (!('qobuzQuality' in parsed)) {
                parsed.qobuzQuality = "6";
            }
            if (!('amazonQuality' in parsed)) {
                parsed.amazonQuality = "original";
            }
            if (!('autoOrder' in parsed)) {
                parsed.autoOrder = "tidal-qobuz-amazon";
            }
            if (!('autoQuality' in parsed)) {
                parsed.autoQuality = "16";
            }
            if (!('allowFallback' in parsed)) {
                parsed.allowFallback = true;
            }
            if (!('concurrentDownloads' in parsed)) {
                parsed.concurrentDownloads = 3;
            }
            return { ...DEFAULT_SETTINGS, ...parsed };
        }
    }
    catch (error) {
        console.error("Failed to load settings from local storage:", error);
    }
    return DEFAULT_SETTINGS;
}
export function getSettings(): Settings {
    if (cachedSettings)
        return cachedSettings;
    return getSettingsFromLocalStorage();
}
export async function loadSettings(): Promise<Settings> {
    try {
        const backendSettings = await LoadSettings();
        if (backendSettings) {
            const parsed = backendSettings as any;
            if ('darkMode' in parsed && !('themeMode' in parsed)) {
                parsed.themeMode = parsed.darkMode ? 'dark' : 'light';
                delete parsed.darkMode;
            }
            if (!('folderPreset' in parsed) && ('artistSubfolder' in parsed || 'albumSubfolder' in parsed)) {
                const hasArtist = parsed.artistSubfolder;
                const hasAlbum = parsed.albumSubfolder;
                if (hasArtist && hasAlbum) {
                    parsed.folderPreset = "artist-album";
                    parsed.folderTemplate = "{artist}/{album}";
                }
                else if (hasArtist) {
                    parsed.folderPreset = "artist";
                    parsed.folderTemplate = "{artist}";
                }
                else if (hasAlbum) {
                    parsed.folderPreset = "album";
                    parsed.folderTemplate = "{album}";
                }
                else {
                    parsed.folderPreset = "none";
                    parsed.folderTemplate = "";
                }
            }
            if (!('filenamePreset' in parsed) && 'filenameFormat' in parsed) {
                const format = parsed.filenameFormat;
                if (format === "title-artist") {
                    parsed.filenamePreset = "artist-title";
                    parsed.filenameTemplate = "{artist} - {title}";
                }
                else if (format === "artist-title") {
                    parsed.filenamePreset = "artist-title";
                    parsed.filenameTemplate = "{artist} - {title}";
                }
                else {
                    parsed.filenamePreset = "title";
                    parsed.filenameTemplate = "{title}";
                }
            }
            parsed.operatingSystem = detectOS();
            if (!('tidalQuality' in parsed)) {
                parsed.tidalQuality = "LOSSLESS";
            }
            if (!('qobuzQuality' in parsed)) {
                parsed.qobuzQuality = "6";
            }
            if (!('amazonQuality' in parsed)) {
                parsed.amazonQuality = "original";
            }
            if (!('autoOrder' in parsed)) {
                parsed.autoOrder = "tidal-qobuz-amazon";
            }
            if (!('autoQuality' in parsed)) {
                parsed.autoQuality = "16";
            }
            if (!('allowFallback' in parsed)) {
                parsed.allowFallback = true;
            }
            if (!('createPlaylistFolder' in parsed)) {
                parsed.createPlaylistFolder = true;
            }
            if (!('createM3u8File' in parsed)) {
                parsed.createM3u8File = false;
            }
            if (!('useFirstArtistOnly' in parsed)) {
                parsed.useFirstArtistOnly = false;
            }
            if (!('useSingleGenre' in parsed)) {
                parsed.useSingleGenre = false;
            }
            if (!('embedGenre' in parsed)) {
                parsed.embedGenre = true;
            }
            if (!('concurrentDownloads' in parsed)) {
                parsed.concurrentDownloads = 3;
            }
            cachedSettings = { ...DEFAULT_SETTINGS, ...parsed };
            return cachedSettings!;
        }
    }
    catch (error) {
        console.error("Failed to load settings from backend:", error);
    }
    const local = getSettingsFromLocalStorage();
    try {
        await SaveToBackend(local as any);
        cachedSettings = local;
    }
    catch (error) {
        console.error("Failed to migrate settings to backend:", error);
    }
    return local;
}
export interface TemplateData {
    artist?: string;
    album?: string;
    album_artist?: string;
    title?: string;
    track?: number;
    disc?: number;
    year?: string;
    date?: string;
    playlist?: string;
}
export function parseTemplate(template: string, data: TemplateData): string {
    if (!template)
        return "";
    let result = template;
    result = result.replace(/\{title\}/g, data.title || "Unknown Title");
    result = result.replace(/\{artist\}/g, data.artist || "Unknown Artist");
    result = result.replace(/\{album\}/g, data.album || "Unknown Album");
    result = result.replace(/\{album_artist\}/g, data.album_artist || data.artist || "Unknown Artist");
    result = result.replace(/\{track\}/g, data.track ? String(data.track).padStart(2, "0") : "00");
    result = result.replace(/\{disc\}/g, data.disc ? String(data.disc) : "1");
    result = result.replace(/\{year\}/g, data.year || "0000");
    result = result.replace(/\{date\}/g, data.date || "0000-00-00");
    result = result.replace(/\{playlist\}/g, data.playlist || "");
    return result;
}
export async function getSettingsWithDefaults(): Promise<Settings> {
    const settings = await loadSettings();
    if (!settings.downloadPath) {
        settings.downloadPath = await fetchDefaultPath();
        await saveSettings(settings);
    }
    return settings;
}
export async function saveSettings(settings: Settings): Promise<void> {
    try {
        cachedSettings = settings;
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        await SaveToBackend(settings as any);
        window.dispatchEvent(new CustomEvent('settingsUpdated', { detail: settings }));
    }
    catch (error) {
        console.error("Failed to save settings:", error);
    }
}
export async function updateSettings(partial: Partial<Settings>): Promise<Settings> {
    const current = getSettings();
    const updated = { ...current, ...partial };
    await saveSettings(updated);
    return updated;
}
export async function resetToDefaultSettings(): Promise<Settings> {
    const defaultPath = await fetchDefaultPath();
    const defaultSettings = { ...DEFAULT_SETTINGS, downloadPath: defaultPath };
    await saveSettings(defaultSettings);
    return defaultSettings;
}
export function applyThemeMode(mode: "auto" | "light" | "dark"): void {
    if (mode === "auto") {
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        if (prefersDark) {
            document.documentElement.classList.add("dark");
        }
        else {
            document.documentElement.classList.remove("dark");
        }
    }
    else if (mode === "dark") {
        document.documentElement.classList.add("dark");
    }
    else {
        document.documentElement.classList.remove("dark");
    }
}
