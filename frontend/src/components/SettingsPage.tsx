import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { InputWithContext } from "@/components/ui/input-with-context";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FolderOpen, Save, RotateCcw, Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { getSettings, getSettingsWithDefaults, saveSettings, resetToDefaultSettings, applyThemeMode, applyFont, FONT_OPTIONS, FOLDER_PRESETS, FILENAME_PRESETS, TEMPLATE_VARIABLES, type Settings as SettingsType, type FontFamily, type FolderPreset, type FilenamePreset } from "@/lib/settings";
import { themes, applyTheme } from "@/lib/themes";
import { SelectFolder } from "../../wailsjs/go/main/App";
import { toastWithSound as toast } from "@/lib/toast-with-sound";

// Service Icons
const TidalIcon = () => (
  <svg viewBox="0 0 24 24" className="inline-block w-[1.1em] h-[1.1em] mr-2 fill-muted-foreground">
    <path d="M4.022 4.5 0 8.516l3.997 3.99 3.997-3.984L4.022 4.5Zm7.956 0L7.994 8.522l4.003 3.984L16 8.484 11.978 4.5Zm8.007 0L24 8.528l-4.003 3.978L16 8.484 19.985 4.5Z"></path>
    <path d="m8.012 16.534 3.991 3.966L16 16.49l-4.003-3.984-3.985 4.028Z"></path>
  </svg>
);

const QobuzIcon = () => (
  <svg viewBox="0 0 24 24" className="inline-block w-[1.1em] h-[1.1em] mr-2 fill-muted-foreground">
    <path d="M21.744 9.815C19.836 1.261 8.393-1 3.55 6.64-.618 13.214 4 22 11.988 22c2.387 0 4.63-.83 6.394-2.304l2.252 2.252 1.224-1.224-2.252-2.253c1.983-2.407 2.823-5.586 2.138-8.656Zm-3.508 7.297L16.4 15.275c-.786-.787-2.017.432-1.224 1.225L17 18.326C10.29 23.656.5 16 5.16 7.667c3.502-6.264 13.172-4.348 14.707 2.574.529 2.385-.06 4.987-1.63 6.87Z"></path>
    <path d="M13.4 8.684a3.59 3.59 0 0 0-4.712 1.9 3.59 3.59 0 0 0 1.9 4.712 3.594 3.594 0 0 0 4.711-1.89 3.598 3.598 0 0 0-1.9-4.722Zm-.737 3.591a.727.727 0 0 1-.965.384.727.727 0 0 1-.384-.965.727.727 0 0 1 .965-.384.73.73 0 0 1 .384.965Z"></path>
  </svg>
);

const AmazonIcon = () => (
  <svg viewBox="0 0 24 24" className="inline-block w-[1.1em] h-[1.1em] mr-2 fill-muted-foreground">
    <path fillRule="evenodd" d="M15.62 11.13c-.15.1-.37.18-.64.18-.42 0-.82-.05-1.21-.18l-.22-.04c-.08 0-.1.04-.1.14v.25c0 .08.02.12.05.17.02.03.07.08.15.1.4.18.84.25 1.33.25.52 0 .91-.12 1.24-.37.32-.25.47-.57.47-.99 0-.3-.08-.52-.23-.72-.15-.17-.4-.34-.74-.47l-.7-.27c-.26-.1-.46-.2-.53-.3a.47.47 0 0 1-.15-.36c0-.38.27-.57.84-.57.32 0 .64.05.94.15l.2.04c.07 0 .12-.04.12-.14v-.25c0-.08-.03-.12-.05-.17-.03-.05-.08-.08-.15-.1-.37-.13-.74-.2-1.11-.2-.47 0-.87.12-1.16.35-.3.22-.45.54-.45.91 0 .57.32.99.97 1.24l.74.27c.24.1.4.17.5.27.09.1.12.2.12.35 0 .2-.08.37-.23.46Zm-3.88-3.55v3.28c-.42.28-.84.42-1.26.42-.27 0-.47-.07-.6-.22-.11-.15-.16-.37-.16-.7V7.59c0-.13-.05-.18-.18-.18h-.52c-.12 0-.17.05-.17.18v3.06c0 .42.1.77.32.99.22.22.55.35.97.35.56 0 1.13-.2 1.68-.6l.05.3c0 .07.02.1.07.12.02.03.07.03.15.03h.37c.12 0 .17-.05.17-.18V7.58c0-.13-.05-.18-.17-.18h-.52c-.15 0-.2.08-.2.18Zm-4.69 4.27h.52c.12 0 .17-.05.17-.17v-3.1c0-.41-.1-.73-.32-.95a1.25 1.25 0 0 0-.94-.35c-.57 0-1.16.2-1.73.62-.2-.42-.57-.62-1.11-.62-.55 0-1.1.2-1.64.57l-.04-.27c0-.08-.03-.1-.08-.13-.02-.02-.07-.02-.12-.02h-.4c-.12 0-.17.05-.17.17v4.1c0 .13.05.18.17.18h.52c.12 0 .17-.05.17-.18V8.37c.42-.25.84-.4 1.29-.4.25 0 .42.08.52.22.1.15.17.35.17.65v2.84c0 .12.05.17.17.17h.52c.13 0 .18-.05.18-.17V8.37c.44-.27.86-.4 1.28-.4.25 0 .42.08.52.22.1.15.17.35.17.65v2.84c0 .12.05.17.18.17Zm13.47 3.29a21.8 21.8 0 0 1-8.3 1.7c-3.96 0-7.8-1.08-10.88-2.89a.35.35 0 0 0-.15-.05c-.17 0-.27.2-.1.37a16.11 16.11 0 0 0 10.87 4.16c3.02 0 6.5-.94 8.9-2.72.42-.3.08-.74-.34-.57Zm-.08-6.74c.22-.26.57-.38 1.06-.38.25 0 .5.03.72.1l.15.02c.07 0 .12-.04.12-.17v-.25c0-.07-.02-.14-.05-.17a.54.54 0 0 0-.12-.1c-.32-.07-.64-.15-.94-.15-.7 0-1.21.2-1.6.62-.38.4-.57 1-.57 1.73 0 .74.17 1.31.54 1.7.37.4.89.6 1.58.6.37 0 .72-.05.99-.17.07-.03.12-.05.15-.1.02-.03.02-.1.02-.17v-.25c0-.13-.05-.17-.12-.17-.03 0-.07 0-.12.02-.28.07-.55.12-.8.12-.46 0-.81-.12-1.03-.37-.23-.24-.32-.64-.32-1.16v-.12c.02-.55.12-.94.34-1.19Z" clipRule="evenodd"></path>
    <path fillRule="evenodd" d="M21.55 17.46c1.29-1.09 1.64-3.33 1.36-3.68-.12-.15-.71-.3-1.45-.3-.8 0-1.73.18-2.45.67-.22.15-.17.35.05.32.76-.1 2.5-.3 2.82.1.3.4-.35 2.03-.65 2.74-.07.23.1.3.32.15ZM18.12 7.4h-.52c-.12 0-.17.05-.17.18v4.1c0 .12.05.17.17.17h.52c.12 0 .17-.05.17-.17v-4.1c0-.1-.05-.18-.17-.18Zm.15-1.68a.58.58 0 0 0-.42-.15c-.18 0-.3.05-.4.15a.5.5 0 0 0-.15.37c0 .15.05.3.15.37.1.1.22.15.4.15.17 0 .3-.05.4-.15a.5.5 0 0 0 .14-.37c0-.15-.02-.3-.12-.37Z" clipRule="evenodd"></path>
  </svg>
);

export function SettingsPage() {
  const [savedSettings, setSavedSettings] = useState<SettingsType>(getSettings());
  const [tempSettings, setTempSettings] = useState<SettingsType>(savedSettings);
  const [isDark, setIsDark] = useState(document.documentElement.classList.contains('dark'));
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  useEffect(() => {
    applyThemeMode(savedSettings.themeMode);
    applyTheme(savedSettings.theme);

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      if (savedSettings.themeMode === "auto") {
        applyThemeMode("auto");
        applyTheme(savedSettings.theme);
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [savedSettings.themeMode, savedSettings.theme]);

  useEffect(() => {
    applyThemeMode(tempSettings.themeMode);
    applyTheme(tempSettings.theme);
    applyFont(tempSettings.fontFamily);
    setTimeout(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    }, 0);
  }, [tempSettings.themeMode, tempSettings.theme, tempSettings.fontFamily]);

  useEffect(() => {
    const loadDefaults = async () => {
      if (!savedSettings.downloadPath) {
        const settingsWithDefaults = await getSettingsWithDefaults();
        setSavedSettings(settingsWithDefaults);
        setTempSettings(settingsWithDefaults);
        // Save to localStorage so it persists on reload
        saveSettings(settingsWithDefaults);
      }
    };
    loadDefaults();
  }, []);

  const handleSave = () => {
    saveSettings(tempSettings);
    setSavedSettings(tempSettings);
    toast.success("Settings saved");
  };

  const handleReset = async () => {
    const defaultSettings = await resetToDefaultSettings();
    setTempSettings(defaultSettings);
    setSavedSettings(defaultSettings);
    applyThemeMode(defaultSettings.themeMode);
    applyTheme(defaultSettings.theme);
    applyFont(defaultSettings.fontFamily);
    setShowResetConfirm(false);
    toast.success("Settings reset to default");
  };

  const handleBrowseFolder = async () => {
    try {
      const selectedPath = await SelectFolder(tempSettings.downloadPath || "");
      if (selectedPath && selectedPath.trim() !== "") {
        setTempSettings((prev) => ({ ...prev, downloadPath: selectedPath }));
      }
    } catch (error) {
      console.error("Error selecting folder:", error);
      toast.error(`Error selecting folder: ${error}`);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left Column */}
        <div className="space-y-4">
          {/* Download Path */}
          <div className="space-y-2">
            <Label htmlFor="download-path">Download Path</Label>
            <div className="flex gap-2">
              <InputWithContext
                id="download-path"
                value={tempSettings.downloadPath}
                onChange={(e) => setTempSettings((prev) => ({ ...prev, downloadPath: e.target.value }))}
                placeholder="C:\Users\YourUsername\Music"
              />
              <Button type="button" onClick={handleBrowseFolder} className="gap-1.5">
                <FolderOpen className="h-4 w-4" />
                Browse
              </Button>
            </div>
          </div>

          {/* Theme Mode */}
          <div className="space-y-2">
            <Label htmlFor="theme-mode">Mode</Label>
            <Select
              value={tempSettings.themeMode}
              onValueChange={(value: "auto" | "light" | "dark") => setTempSettings((prev) => ({ ...prev, themeMode: value }))}
            >
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

          {/* Accent */}
          <div className="space-y-2">
            <Label htmlFor="theme">Accent</Label>
            <Select
              value={tempSettings.theme}
              onValueChange={(value) => setTempSettings((prev) => ({ ...prev, theme: value }))}
            >
              <SelectTrigger id="theme">
                <SelectValue placeholder="Select a theme" />
              </SelectTrigger>
              <SelectContent>
                {themes.map((theme) => (
                  <SelectItem key={theme.name} value={theme.name}>
                    <span className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full border border-border"
                        style={{
                          backgroundColor: isDark ? theme.cssVars.dark.primary : theme.cssVars.light.primary
                        }}
                      />
                      {theme.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Font */}
          <div className="space-y-2">
            <Label htmlFor="font">Font</Label>
            <Select
              value={tempSettings.fontFamily}
              onValueChange={(value: FontFamily) => setTempSettings((prev) => ({ ...prev, fontFamily: value }))}
            >
              <SelectTrigger id="font">
                <SelectValue placeholder="Select a font" />
              </SelectTrigger>
              <SelectContent>
                {FONT_OPTIONS.map((font) => (
                  <SelectItem key={font.value} value={font.value}>
                    <span style={{ fontFamily: font.fontFamily }}>{font.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Sound Effects */}
          <div className="flex items-center gap-3">
            <Label htmlFor="sfx-enabled" className="cursor-pointer text-sm">Sound Effects</Label>
            <Switch
              id="sfx-enabled"
              checked={tempSettings.sfxEnabled}
              onCheckedChange={(checked) => setTempSettings(prev => ({ ...prev, sfxEnabled: checked }))}
            />
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-4">
          {/* Source Selection */}
          <div className="space-y-2">
            <Label htmlFor="downloader" className="text-sm">Source</Label>
            <div className="flex gap-2">
              <Select
                value={tempSettings.downloader}
                onValueChange={(value: "auto" | "tidal" | "qobuz" | "amazon") => setTempSettings((prev) => ({ ...prev, downloader: value }))}
              >
                <SelectTrigger id="downloader" className="h-9 w-fit">
                  <SelectValue placeholder="Select a source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="tidal">
                    <span className="flex items-center"><TidalIcon />Tidal</span>
                  </SelectItem>
                  <SelectItem value="qobuz">
                    <span className="flex items-center"><QobuzIcon />Qobuz</span>
                  </SelectItem>
                  <SelectItem value="amazon">
                    <span className="flex items-center"><AmazonIcon />Amazon Music</span>
                  </SelectItem>
                </SelectContent>
              </Select>
              {/* Quality dropdown for Tidal */}
              {tempSettings.downloader === "tidal" && (
                <Select
                  value={tempSettings.tidalQuality}
                  onValueChange={(value: "LOSSLESS" | "HI_RES_LOSSLESS") => setTempSettings((prev) => ({ ...prev, tidalQuality: value }))}
                >
                  <SelectTrigger className="h-9 w-fit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOSSLESS">Lossless (16-bit/CD Quality)</SelectItem>
                    <SelectItem value="HI_RES_LOSSLESS">Hi-Res Lossless (24-bit/48kHz+)</SelectItem>
                  </SelectContent>
                </Select>
              )}
              {/* Quality dropdown for Qobuz */}
              {tempSettings.downloader === "qobuz" && (
                <Select
                  value={tempSettings.qobuzQuality}
                  onValueChange={(value: "6" | "7" | "27") => setTempSettings((prev) => ({ ...prev, qobuzQuality: value }))}
                >
                  <SelectTrigger className="h-9 w-fit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="6">FLAC 16-bit (CD Quality)</SelectItem>
                    <SelectItem value="7">FLAC 24-bit</SelectItem>
                    <SelectItem value="27">Hi-Res (24-bit/96kHz+)</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          {/* Embed Lyrics & Embed Max Quality Cover */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <Label htmlFor="embed-lyrics" className="cursor-pointer text-sm">Embed Lyrics</Label>
              <Switch
                id="embed-lyrics"
                checked={tempSettings.embedLyrics}
                onCheckedChange={(checked) => setTempSettings(prev => ({ ...prev, embedLyrics: checked }))}
              />
            </div>
            <div className="flex items-center gap-3">
              <Label htmlFor="embed-max-quality-cover" className="cursor-pointer text-sm">Embed Max Quality Cover</Label>
              <Switch
                id="embed-max-quality-cover"
                checked={tempSettings.embedMaxQualityCover}
                onCheckedChange={(checked) => setTempSettings(prev => ({ ...prev, embedMaxQualityCover: checked }))}
              />
            </div>
          </div>

          <div className="border-t" />

          {/* Folder Structure */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label className="text-sm">Folder Structure</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p className="text-xs whitespace-nowrap">Variables: {TEMPLATE_VARIABLES.map(v => v.key).join(", ")}</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="flex gap-2">
              <Select
                value={tempSettings.folderPreset}
                onValueChange={(value: FolderPreset) => {
                  const preset = FOLDER_PRESETS[value];
                  setTempSettings(prev => ({
                    ...prev,
                    folderPreset: value,
                    folderTemplate: value === "custom" ? (prev.folderTemplate || preset.template) : preset.template
                  }));
                }}
              >
                <SelectTrigger className="h-9 w-fit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(FOLDER_PRESETS).map(([key, { label }]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {tempSettings.folderPreset === "custom" && (
                <InputWithContext
                  value={tempSettings.folderTemplate}
                  onChange={(e) => setTempSettings(prev => ({ ...prev, folderTemplate: e.target.value }))}
                  placeholder="{artist}/{album}"
                  className="h-9 text-sm flex-1"
                />
              )}
            </div>
            {tempSettings.folderTemplate && (
              <p className="text-xs text-muted-foreground">
                Preview: <span className="font-mono">{tempSettings.folderTemplate.replace(/\{artist\}/g, "Kendrick Lamar, SZA").replace(/\{album\}/g, "Black Panther").replace(/\{album_artist\}/g, "Kendrick Lamar").replace(/\{year\}/g, "2018")}/</span>
              </p>
            )}
          </div>

          <div className="border-t" />

          {/* Filename Format */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label className="text-sm">Filename Format</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p className="text-xs whitespace-nowrap">Variables: {TEMPLATE_VARIABLES.map(v => v.key).join(", ")}</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="flex gap-2">
              <Select
                value={tempSettings.filenamePreset}
                onValueChange={(value: FilenamePreset) => {
                  const preset = FILENAME_PRESETS[value];
                  setTempSettings(prev => ({
                    ...prev,
                    filenamePreset: value,
                    filenameTemplate: value === "custom" ? (prev.filenameTemplate || preset.template) : preset.template
                  }));
                }}
              >
                <SelectTrigger className="h-9 w-fit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(FILENAME_PRESETS).map(([key, { label }]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {tempSettings.filenamePreset === "custom" && (
                <InputWithContext
                  value={tempSettings.filenameTemplate}
                  onChange={(e) => setTempSettings(prev => ({ ...prev, filenameTemplate: e.target.value }))}
                  placeholder="{track}. {title}"
                  className="h-9 text-sm flex-1"
                />
              )}
            </div>
            {tempSettings.filenameTemplate && (
              <p className="text-xs text-muted-foreground">
                Preview: <span className="font-mono">{tempSettings.filenameTemplate.replace(/\{artist\}/g, "Kendrick Lamar, SZA").replace(/\{album_artist\}/g, "Kendrick Lamar").replace(/\{title\}/g, "All The Stars").replace(/\{track\}/g, "01").replace(/\{disc\}/g, "1").replace(/\{year\}/g, "2018")}.flac</span>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 justify-between pt-4 border-t">
        <Button variant="outline" onClick={() => setShowResetConfirm(true)} className="gap-1.5">
          <RotateCcw className="h-4 w-4" />
          Reset to Default
        </Button>
        <Button onClick={handleSave} className="gap-1.5">
          <Save className="h-4 w-4" />
          Save Changes
        </Button>
      </div>

      {/* Reset Confirmation Dialog */}
      <Dialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <DialogContent className="max-w-md [&>button]:hidden">
          <DialogHeader>
            <DialogTitle>Reset to Default?</DialogTitle>
            <DialogDescription>
              This will reset all settings to their default values. Your custom configurations will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResetConfirm(false)}>Cancel</Button>
            <Button onClick={handleReset}>Reset</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
