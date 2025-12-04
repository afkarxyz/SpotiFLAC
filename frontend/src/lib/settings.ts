import { GetDefaults } from "../../wailsjs/go/main/App";

export type FontFamily = "google-sans" | "inter" | "poppins" | "roboto" | "dm-sans" | "plus-jakarta-sans" | "manrope" | "space-grotesk";

export interface Settings {
  downloadPath: string;
  downloader: "auto" | "deezer" | "tidal" | "qobuz" | "amazon";
  theme: string;
  themeMode: "auto" | "light" | "dark";
  fontFamily: FontFamily;
  filenameFormat: "title-artist" | "artist-title" | "title";
  artistSubfolder: boolean;
  albumSubfolder: boolean;
  trackNumber: boolean;
  sfxEnabled: boolean;
  operatingSystem: "Windows" | "linux/MacOS"
}

// Auto-detect operating system
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
  filenameFormat: "title-artist",
  artistSubfolder: false,
  albumSubfolder: false,
  trackNumber: false,
  sfxEnabled: true,
  operatingSystem: detectOS()
};

export const FONT_OPTIONS: { value: FontFamily; label: string; fontFamily: string }[] = [
  { value: "google-sans", label: "Google Sans Flex", fontFamily: '"Google Sans Flex", system-ui, sans-serif' },
  { value: "inter", label: "Inter", fontFamily: '"Inter", system-ui, sans-serif' },
  { value: "poppins", label: "Poppins", fontFamily: '"Poppins", system-ui, sans-serif' },
  { value: "roboto", label: "Roboto", fontFamily: '"Roboto", system-ui, sans-serif' },
  { value: "dm-sans", label: "DM Sans", fontFamily: '"DM Sans", system-ui, sans-serif' },
  { value: "plus-jakarta-sans", label: "Plus Jakarta Sans", fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' },
  { value: "manrope", label: "Manrope", fontFamily: '"Manrope", system-ui, sans-serif' },
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
  } catch (error) {
    console.error("Failed to fetch default path:", error);
    return "";
  }
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
      // Always use detected OS (don't persist it)
      parsed.operatingSystem = detectOS();
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
