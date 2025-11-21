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
import { Settings as SettingsIcon, FolderOpen, Save, RotateCcw } from "lucide-react";
import { getSettings, getSettingsWithDefaults, saveSettings, resetToDefaultSettings, applyThemeMode, type Settings as SettingsType } from "@/lib/settings";
import { themes, applyTheme } from "@/lib/themes";
import { OpenFolder } from "../../wailsjs/go/main/App";

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

  const handleDownloaderChange = (value: "auto" | "deezer" | "tidal") => {
    setTempSettings((prev) => ({ ...prev, downloader: value }));
  };

  const handleThemeChange = (value: string) => {
    setTempSettings((prev) => ({ ...prev, theme: value }));
  };

  const handleThemeModeChange = (value: "auto" | "light" | "dark") => {
    setTempSettings((prev) => ({ ...prev, themeMode: value }));
  };

  const handleBrowseFolder = async () => {
    if (!tempSettings.downloadPath) {
      alert("Please enter a download path first");
      return;
    }

    try {
      // Call backend to open folder in file explorer
      await OpenFolder(tempSettings.downloadPath);
    } catch (error) {
      console.error("Error opening folder:", error);
      alert(`Error opening folder: ${error}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon">
          <SettingsIcon className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] max-h-[85vh] flex flex-col" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2 overflow-y-auto flex-1">
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
              <Button type="button" onClick={handleBrowseFolder}>
                <FolderOpen className="h-4 w-4" />
                Open
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
                <SelectItem value="auto">Auto (Tidal → Deezer)</SelectItem>
                <SelectItem value="tidal">Tidal</SelectItem>
                <SelectItem value="deezer">Deezer</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* File Settings */}
          <div className="space-y-3 pt-3 border-t">
            <h3 className="font-medium text-sm">File Settings</h3>
            
            {/* Filename Format */}
            <div className="space-y-1.5">
              <Label className="text-sm">Filename Format</Label>
              <RadioGroup
                value={tempSettings.filenameFormat}
                onValueChange={(value) => setTempSettings(prev => ({ ...prev, filenameFormat: value as any }))}
                className="flex flex-wrap gap-3"
              >
                <div className="flex items-center space-x-1.5">
                  <RadioGroupItem value="title-artist" id="title-artist" />
                  <Label htmlFor="title-artist" className="cursor-pointer font-normal text-xs">Title - Artist</Label>
                </div>
                <div className="flex items-center space-x-1.5">
                  <RadioGroupItem value="artist-title" id="artist-title" />
                  <Label htmlFor="artist-title" className="cursor-pointer font-normal text-xs">Artist - Title</Label>
                </div>
                <div className="flex items-center space-x-1.5">
                  <RadioGroupItem value="title" id="title" />
                  <Label htmlFor="title" className="cursor-pointer font-normal text-xs">Title</Label>
                </div>
              </RadioGroup>
            </div>

            {/* Subfolder Options */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="track-number"
                  checked={tempSettings.trackNumber}
                  onCheckedChange={(checked) => setTempSettings(prev => ({ ...prev, trackNumber: checked as boolean }))}
                />
                <Label htmlFor="track-number" className="cursor-pointer text-sm">Track Number</Label>
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

          {/* Theme Mode Selection */}
          <div className="space-y-1.5 pt-3 border-t">
            <Label htmlFor="theme-mode" className="text-sm">Theme</Label>
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
          <div className="space-y-1.5">
            <Label htmlFor="theme" className="text-sm">Theme Color</Label>
            <Select value={tempSettings.theme} onValueChange={handleThemeChange}>
              <SelectTrigger id="theme">
                <SelectValue placeholder="Select a theme" />
              </SelectTrigger>
              <SelectContent>
                {themes.map((theme) => (
                  <SelectItem key={theme.name} value={theme.name}>
                    {theme.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
