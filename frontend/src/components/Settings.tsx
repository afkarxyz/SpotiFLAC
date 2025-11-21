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
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Settings as SettingsIcon, FolderOpen } from "lucide-react";
import { getSettings, getSettingsWithDefaults, saveSettings, type Settings as SettingsType } from "@/lib/settings";
import { themes, applyTheme } from "@/lib/themes";
import { OpenFolder } from "../../wailsjs/go/main/App";

export function Settings() {
  const [open, setOpen] = useState(false);
  const [savedSettings, setSavedSettings] = useState<SettingsType>(getSettings());
  const [tempSettings, setTempSettings] = useState<SettingsType>(savedSettings);
  const [, setIsLoadingDefaults] = useState(false);

  // Apply saved settings
  useEffect(() => {
    if (savedSettings.darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    applyTheme(savedSettings.theme);
  }, [savedSettings.darkMode, savedSettings.theme]);

  // Apply temp settings for preview when dialog is open
  useEffect(() => {
    if (open) {
      if (tempSettings.darkMode) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
      applyTheme(tempSettings.theme);
    }
  }, [open, tempSettings.darkMode, tempSettings.theme]);

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

  const handleCancel = () => {
    // Revert to saved settings
    if (savedSettings.darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    applyTheme(savedSettings.theme);
    
    setTempSettings(savedSettings);
    setOpen(false);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // Dialog is closing, revert to saved settings
      if (savedSettings.darkMode) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
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

  const toggleDarkMode = () => {
    setTempSettings((prev) => ({ ...prev, darkMode: !prev.darkMode }));
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
      <DialogContent className="sm:max-w-[550px]" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="grid gap-6 py-4">
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
          <div className="space-y-4 pt-4 border-t">
            <h3 className="font-medium">File Settings</h3>
            
            {/* Filename Format */}
            <div className="space-y-2">
              <Label>Filename Format</Label>
              <RadioGroup
                value={tempSettings.filenameFormat}
                onValueChange={(value) => setTempSettings(prev => ({ ...prev, filenameFormat: value as any }))}
                className="flex gap-4"
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

            {/* Subfolder Options */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="artist-subfolder"
                  checked={tempSettings.artistSubfolder}
                  onCheckedChange={(checked) => setTempSettings(prev => ({ ...prev, artistSubfolder: checked as boolean }))}
                />
                <Label htmlFor="artist-subfolder" className="cursor-pointer text-sm">Artist Subfolder (Playlist)</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="album-subfolder"
                  checked={tempSettings.albumSubfolder}
                  onCheckedChange={(checked) => setTempSettings(prev => ({ ...prev, albumSubfolder: checked as boolean }))}
                />
                <Label htmlFor="album-subfolder" className="cursor-pointer text-sm">Album Subfolder (Playlist)</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="track-number"
                  checked={tempSettings.trackNumber}
                  onCheckedChange={(checked) => setTempSettings(prev => ({ ...prev, trackNumber: checked as boolean }))}
                />
                <Label htmlFor="track-number" className="cursor-pointer text-sm">Track Number</Label>
              </div>
            </div>
          </div>

          {/* Dark Mode Toggle */}
          <div className="flex items-center justify-between pt-4 border-t">
            <Label htmlFor="dark-mode">Dark Mode</Label>
            <Switch
              id="dark-mode"
              checked={tempSettings.darkMode}
              onCheckedChange={toggleDarkMode}
            />
          </div>

          {/* Theme Selection */}
          <div className="space-y-2">
            <Label htmlFor="theme">Theme Color</Label>
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
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
