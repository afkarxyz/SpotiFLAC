import { GetDefaults } from "../../wailsjs/go/main/App";

export interface Settings {
  downloadPath: string;
  downloader: "auto" | "deezer" | "tidal";
  theme: string;
  darkMode: boolean;
  filenameFormat: "title-artist" | "artist-title" | "title";
  artistSubfolder: boolean;
  albumSubfolder: boolean;
  trackNumber: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  downloadPath: "",
  downloader: "auto",
  theme: "yellow",
  darkMode: true,
  filenameFormat: "title-artist",
  artistSubfolder: false,
  albumSubfolder: false,
  trackNumber: false,
};

async function fetchDefaultPath(): Promise<string> {
  try {
    const data = await GetDefaults();
    return data.downloadPath || "C:\\Users\\Public\\Music";
  } catch (error) {
    console.error("Failed to fetch default path:", error);
  }
  return "C:\\Users\\Public\\Music";
}

const SETTINGS_KEY = "spotiflac-settings";

export function getSettings(): Settings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch (error) {
    console.error("Failed to load settings:", error);
  }
  return DEFAULT_SETTINGS;
}

export async function getSettingsWithDefaults(): Promise<Settings> {
  const settings = getSettings();
  
  // If downloadPath is empty, fetch from backend
  if (!settings.downloadPath) {
    settings.downloadPath = await fetchDefaultPath();
  }
  
  return settings;
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error("Failed to save settings:", error);
  }
}

export function updateSettings(partial: Partial<Settings>): Settings {
  const current = getSettings();
  const updated = { ...current, ...partial };
  saveSettings(updated);
  return updated;
}
