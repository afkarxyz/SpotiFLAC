import { GetDefaults } from "../../wailsjs/go/main/App";

export interface Settings {
  downloadPath: string;
  downloader: "auto" | "deezer" | "tidal";
  theme: string;
  themeMode: "auto" | "light" | "dark";
  filenameFormat: "title-artist" | "artist-title" | "title";
  artistSubfolder: boolean;
  albumSubfolder: boolean;
  trackNumber: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  downloadPath: "",
  downloader: "auto",
  theme: "yellow",
  themeMode: "auto",
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
      // Migrate old darkMode to themeMode
      if ('darkMode' in parsed && !('themeMode' in parsed)) {
        parsed.themeMode = parsed.darkMode ? 'dark' : 'light';
        delete parsed.darkMode;
      }
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

export async function resetToDefaultSettings(): Promise<Settings> {
  const defaultPath = await fetchDefaultPath();
  const defaultSettings = { ...DEFAULT_SETTINGS, downloadPath: defaultPath };
  saveSettings(defaultSettings);
  return defaultSettings;
}

export function applyThemeMode(mode: "auto" | "light" | "dark"): void {
  if (mode === "auto") {
    // Check system preference
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (prefersDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  } else if (mode === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
}
