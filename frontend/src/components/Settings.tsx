import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Settings as SettingsIcon, FolderOpen, Save, RotateCcw, Info } from "lucide-react";
import { getSettings, getSettingsWithDefaults, saveSettings, resetToDefaultSettings, applyThemeMode, type Settings as SettingsType } from "@/lib/settings";
import { themes, applyTheme } from "@/lib/themes";
import { SelectFolder } from "../../wailsjs/go/main/App";

// Service Icons
const TidalIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="inline-block w-[1.1em] h-[1.1em] mr-2">
    <path d="M4.022 4.5 0 8.516l3.997 3.99 3.997-3.984L4.022 4.5Zm7.956 0L7.994 8.522l4.003 3.984L16 8.484 11.978 4.5Zm8.007 0L24 8.528l-4.003 3.978L16 8.484 19.985 4.5Z"></path>
    <path d="m8.012 16.534 3.991 3.966L16 16.49l-4.003-3.984-3.985 4.028Z"></path>
  </svg>
);

const DeezerIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="inline-block w-[1.1em] h-[1.1em] mr-2">
    <path d="M18.77 5.55c.19-1.07.46-1.75.76-1.75.56 0 1.02 2.34 1.02 5.23 0 2.89-.46 5.23-1.02 5.23-.23 0-.44-.4-.61-1.06-.27 2.43-.83 4.11-1.48 4.11-.5 0-.96-1-1.26-2.6-.2 3.03-.73 5.17-1.33 5.17-.39 0-.73-.85-.99-2.23-.31 2.85-1.03 4.85-1.86 4.85-.83 0-1.55-2-1.86-4.85-.25 1.38-.6 2.23-.99 2.23-.6 0-1.12-2.14-1.33-5.16-.3 1.58-.75 2.6-1.26 2.6-.65 0-1.2-1.68-1.48-4.12-.17.66-.38 1.06-.61 1.06-.56 0-1.02-2.34-1.02-5.23 0-2.89.46-5.23 1.02-5.23.3 0 .57.68.76 1.75C5.53 3.7 6 2.5 6.56 2.5c.66 0 1.22 1.7 1.49 4.17.26-1.8.66-2.94 1.1-2.94.63 0 1.16 2.25 1.36 5.4.36-1.62.9-2.63 1.5-2.63.58 0 1.12 1.01 1.49 2.62.2-3.14.72-5.4 1.35-5.4.44 0 .84 1.15 1.1 2.95.27-2.47.84-4.17 1.49-4.17.55 0 1.03 1.2 1.33 3.05ZM2 8.52c0-1.3.26-2.34.58-2.34.32 0 .57 1.05.57 2.34 0 1.29-.25 2.34-.57 2.34-.32 0-.58-1.05-.58-2.34Zm18.85 0c0-1.3.25-2.34.57-2.34.32 0 .58 1.05.58 2.34 0 1.29-.26 2.34-.58 2.34-.32 0-.57-1.05-.57-2.34Z"></path>
  </svg>
);

const QobuzIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="inline-block w-[1.1em] h-[1.1em] mr-2">
    <path d="M21.744 9.815C19.836 1.261 8.393-1 3.55 6.64-.618 13.214 4 22 11.988 22c2.387 0 4.63-.83 6.394-2.304l2.252 2.252 1.224-1.224-2.252-2.253c1.983-2.407 2.823-5.586 2.138-8.656Zm-3.508 7.297L16.4 15.275c-.786-.787-2.017.432-1.224 1.225L17 18.326C10.29 23.656.5 16 5.16 7.667c3.502-6.264 13.172-4.348 14.707 2.574.529 2.385-.06 4.987-1.63 6.87Z"></path>
    <path d="M13.4 8.684a3.59 3.59 0 0 0-4.712 1.9 3.59 3.59 0 0 0 1.9 4.712 3.594 3.594 0 0 0 4.711-1.89 3.598 3.598 0 0 0-1.9-4.722Zm-.737 3.591a.727.727 0 0 1-.965.384.727.727 0 0 1-.384-.965.727.727 0 0 1 .965-.384.73.73 0 0 1 .384.965Z"></path>
  </svg>
);

export function Settings() {
  const [open, setOpen] = useState(false);
  const [savedSettings, setSavedSettings] = useState<SettingsType>(getSettings());
  const [tempSettings, setTempSettings] = useState<SettingsType>(savedSettings);
  const [, setIsLoadingDefaults] = useState(false);

  // Apply saved settings
  useEffect(() => {
    applyThemeMode(savedSettings.themeMode);
    applyTheme(savedSettings.theme);

    // Setup listener for system theme changes
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      if (savedSettings.themeMode === "auto") {
        applyThemeMode("auto");
        applyTheme(savedSettings.theme);
      }
    };

    mediaQuery.addEventListener("change", handleChange);

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, [savedSettings.themeMode, savedSettings.theme]);

  // Apply temp settings for preview when dialog is open
  useEffect(() => {
    if (open) {
      applyThemeMode(tempSettings.themeMode);
      applyTheme(tempSettings.theme);

      // Setup listener for system theme changes during preview
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handleChange = () => {
        if (tempSettings.themeMode === "auto") {
          applyThemeMode("auto");
          applyTheme(tempSettings.theme);
        }
      };

      mediaQuery.addEventListener("change", handleChange);

      return () => {
        mediaQuery.removeEventListener("change", handleChange);
      };
    }
  }, [open, tempSettings.themeMode, tempSettings.theme]);

  useEffect(() => {
    // Load settings with defaults from backend on mount
    const loadDefaults = async () => {
      if (!savedSettings.downloadPath) {
        setIsLoadingDefaults(true);
        const settingsWithDefaults = await getSettingsWithDefaults();
        setSavedSettings(settingsWithDefaults);
        setTempSettings(settingsWithDefaults);
        setIsLoadingDefaults(false);
      }
    };
    loadDefaults();
  }, []);

  // Reset temp settings when dialog opens
  useEffect(() => {
    if (open) {
      setTempSettings(savedSettings);
    }
  }, [open, savedSettings]);

  const handleSave = () => {
    saveSettings(tempSettings);
    setSavedSettings(tempSettings);
    setOpen(false);
  };

  const handleReset = async () => {
    const defaultSettings = await resetToDefaultSettings();
    setTempSettings(defaultSettings);
    setSavedSettings(defaultSettings);
    
    // Apply default theme mode and theme
    applyThemeMode(defaultSettings.themeMode);
    applyTheme(defaultSettings.theme);
  };

  const handleCancel = () => {
    // Revert to saved settings
    applyThemeMode(savedSettings.themeMode);
    applyTheme(savedSettings.theme);
    
    setTempSettings(savedSettings);
    setOpen(false);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // Dialog is closing, revert to saved settings
      applyThemeMode(savedSettings.themeMode);
      applyTheme(savedSettings.theme);
      setTempSettings(savedSettings);
    }
    setOpen(newOpen);
  };

  const handleDownloadPathChange = (value: string) => {
    setTempSettings((prev) => ({ ...prev, downloadPath: value }));
  };

  const handleDownloaderChange = (value: "auto" | "deezer" | "tidal" | "qobuz") => {
    setTempSettings((prev) => ({ ...prev, downloader: value }));
  };

  const handleThemeChange = (value: string) => {
    setTempSettings((prev) => ({ ...prev, theme: value }));
  };

  const handleThemeModeChange = (value: "auto" | "light" | "dark") => {
    setTempSettings((prev) => ({ ...prev, themeMode: value }));
  };

  const handleBrowseFolder = async () => {
    try {
      // Call backend to open folder selection dialog
      const selectedPath = await SelectFolder(tempSettings.downloadPath || "");
      console.log("Selected path:", selectedPath);
      
      if (selectedPath && selectedPath.trim() !== "") {
        setTempSettings((prev) => ({ ...prev, downloadPath: selectedPath }));
      } else {
        console.log("No folder selected or user cancelled");
      }
    } catch (error) {
      console.error("Error selecting folder:", error);
      alert(`Error selecting folder: ${error}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon">
          <SettingsIcon className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[700px] flex flex-col" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-6 py-2">
          {/* Left Column */}
          <div className="space-y-4">
            {/* Download Path */}
            <div className="space-y-2">
              <Label htmlFor="download-path">Download Path</Label>
              <div className="flex gap-2">
                <Input
                  id="download-path"
                  value={tempSettings.downloadPath}
                  onChange={(e) => handleDownloadPathChange(e.target.value)}
                  placeholder="C:\Users\YourUsername\Music"
                />
                <Button type="button" onClick={handleBrowseFolder} className="gap-1.5">
                  <FolderOpen className="h-4 w-4" />
                  Browse
                </Button>
              </div>
            </div>

            {/* Source Selection */}
            <div className="space-y-2">
              <Label htmlFor="downloader">Source</Label>
              <Select
                value={tempSettings.downloader}
                onValueChange={handleDownloaderChange}
              >
                <SelectTrigger id="downloader">
                  <SelectValue placeholder="Select a source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="tidal">
                    <span className="flex items-center">
                      <TidalIcon />
                      Tidal
                    </span>
                  </SelectItem>
                  <SelectItem value="deezer">
                    <span className="flex items-center">
                      <DeezerIcon />
                      Deezer
                    </span>
                  </SelectItem>
                  <SelectItem value="qobuz">
                    <span className="flex items-center">
                      <QobuzIcon />
                      Qobuz
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Theme Mode Selection */}
            <div className="space-y-2">
              <Label htmlFor="theme-mode">Theme</Label>
              <Select value={tempSettings.themeMode} onValueChange={handleThemeModeChange}>
                <SelectTrigger id="theme-mode">
                  <SelectValue placeholder="Select theme mode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Theme Color Selection */}
            <div className="space-y-2">
              <Label htmlFor="theme">Theme Color</Label>
              <Select value={tempSettings.theme} onValueChange={handleThemeChange}>
                <SelectTrigger id="theme">
                  <SelectValue placeholder="Select a theme" />
                </SelectTrigger>
                <SelectContent>
                  {themes.map((theme) => (
                    <SelectItem key={theme.name} value={theme.name}>
                      <span className="flex items-center gap-2">
                        <span 
                          className="w-3 h-3 rounded-full" 
                          style={{ backgroundColor: theme.cssVars.light.primary }}
                        />
                        {theme.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Right Column */}
          <div className="space-y-4">
            {/* Filename Format */}
            <div className="space-y-2">
              <Label className="text-sm">Filename Format</Label>
              <RadioGroup
                value={tempSettings.filenameFormat}
                onValueChange={(value) => setTempSettings(prev => ({ ...prev, filenameFormat: value as any }))}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="title-artist" id="title-artist" />
                  <Label htmlFor="title-artist" className="cursor-pointer font-normal text-sm">Title - Artist</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="artist-title" id="artist-title" />
                  <Label htmlFor="artist-title" className="cursor-pointer font-normal text-sm">Artist - Title</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="title" id="title" />
                  <Label htmlFor="title" className="cursor-pointer font-normal text-sm">Title</Label>
                </div>
              </RadioGroup>
            </div>

            <div className="border-t" />

            {/* Folder Settings */}
            <div className="space-y-2">
              <h3 className="font-medium text-sm">Folder Settings</h3>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="track-number"
                  checked={tempSettings.trackNumber}
                  onCheckedChange={(checked) => setTempSettings(prev => ({ ...prev, trackNumber: checked as boolean }))}
                />
                <Label htmlFor="track-number" className="cursor-pointer text-sm">Track Number</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="text-xs whitespace-nowrap">Adds track numbers based on the order in the album, playlist, or discography list</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="artist-subfolder"
                  checked={tempSettings.artistSubfolder}
                  onCheckedChange={(checked) => setTempSettings(prev => ({ ...prev, artistSubfolder: checked as boolean }))}
                />
                <Label htmlFor="artist-subfolder" className="cursor-pointer text-sm">Artist Subfolder (Playlist only)</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="album-subfolder"
                  checked={tempSettings.albumSubfolder}
                  onCheckedChange={(checked) => setTempSettings(prev => ({ ...prev, albumSubfolder: checked as boolean }))}
                />
                <Label htmlFor="album-subfolder" className="cursor-pointer text-sm">Album Subfolder (Playlist & Discography)</Label>
              </div>
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={handleReset} size="sm" className="gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" />
            Reset to Default
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleCancel} size="sm">
              Cancel
            </Button>
            <Button onClick={handleSave} size="sm" className="gap-1.5">
              <Save className="h-3.5 w-3.5" />
              Save Changes
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
