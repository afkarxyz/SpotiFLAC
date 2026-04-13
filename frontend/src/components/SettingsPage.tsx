import { useState, useEffect, useCallback } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { InputWithContext } from "@/components/ui/input-with-context";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger, } from "@/components/ui/tooltip";
import { FolderOpen, Save, RotateCcw, Info, ArrowRight, MonitorCog, FolderCog, Router, FolderLock } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { getSettings, getSettingsWithDefaults, saveSettings, resetToDefaultSettings, applyThemeMode, applyFont, FONT_OPTIONS, FOLDER_PRESETS, FILENAME_PRESETS, TEMPLATE_VARIABLES, type Settings as SettingsType, type FontFamily, type FolderPreset, type FilenamePreset, } from "@/lib/settings";
import { themes, applyTheme } from "@/lib/themes";
import { SelectFolder, OpenConfigFolder } from "../../wailsjs/go/main/App";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { ApiStatusTab } from "./ApiStatusTab";
import { AmazonIcon, QobuzIcon, TidalIcon } from "./PlatformIcons";
import songlinkIcon from "@/assets/icons/songlink.ico";
import songstatsIcon from "@/assets/icons/songstats.png";
interface SettingsPageProps {
    onUnsavedChangesChange?: (hasUnsavedChanges: boolean) => void;
    onResetRequest?: (resetFn: () => void) => void;
}
export function SettingsPage({ onUnsavedChangesChange, onResetRequest, }: SettingsPageProps) {
    const [savedSettings, setSavedSettings] = useState<SettingsType>(getSettings());
    const [tempSettings, setTempSettings] = useState<SettingsType>(savedSettings);
    const [isDark, setIsDark] = useState(document.documentElement.classList.contains("dark"));
    const [showResetConfirm, setShowResetConfirm] = useState(false);
    const hasUnsavedChanges = JSON.stringify(savedSettings) !== JSON.stringify(tempSettings);
    const resetToSaved = useCallback(() => {
        const freshSavedSettings = getSettings();
        flushSync(() => {
            setTempSettings(freshSavedSettings);
            setIsDark(document.documentElement.classList.contains("dark"));
        });
    }, []);
    useEffect(() => {
        if (onResetRequest) {
            onResetRequest(resetToSaved);
        }
    }, [onResetRequest, resetToSaved]);
    useEffect(() => {
        onUnsavedChangesChange?.(hasUnsavedChanges);
    }, [hasUnsavedChanges, onUnsavedChangesChange]);
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
            setIsDark(document.documentElement.classList.contains("dark"));
        }, 0);
    }, [tempSettings.themeMode, tempSettings.theme, tempSettings.fontFamily]);
    useEffect(() => {
        const loadDefaults = async () => {
            if (!savedSettings.downloadPath) {
                const settingsWithDefaults = await getSettingsWithDefaults();
                setSavedSettings(settingsWithDefaults);
                setTempSettings(settingsWithDefaults);
                await saveSettings(settingsWithDefaults);
            }
        };
        loadDefaults();
    }, []);
    const handleSave = async () => {
        await saveSettings(tempSettings);
        setSavedSettings(tempSettings);
        toast.success("Settings saved");
        onUnsavedChangesChange?.(false);
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
        }
        catch (error) {
            console.error("Error selecting folder:", error);
            toast.error(`Error selecting folder: ${error}`);
        }
    };
    const handleTidalQualityChange = async (value: "LOSSLESS" | "HI_RES_LOSSLESS") => {
        setTempSettings((prev) => ({ ...prev, tidalQuality: value }));
    };
    const handleQobuzQualityChange = (value: "6" | "7" | "27") => {
        setTempSettings((prev) => ({ ...prev, qobuzQuality: value }));
    };
    const handleAutoQualityChange = async (value: "16" | "24") => {
        setTempSettings((prev) => ({ ...prev, autoQuality: value }));
    };
    const [activeTab, setActiveTab] = useState<"general" | "files" | "api">("general");
    return (<div className="space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between shrink-0">
        <h1 className="text-2xl font-bold">Settings</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={async () => {
            try {
                await OpenConfigFolder();
            }
            catch (e) {
                toast.error(`Failed to open config folder: ${e}`);
            }
        }} className="gap-1.5">
            <FolderLock className="h-4 w-4"/>
            Open Config Folder
          </Button>
          <Button variant="outline" onClick={() => setShowResetConfirm(true)} className="gap-1.5">
            <RotateCcw className="h-4 w-4"/>
            Reset to Default
          </Button>
          <Button onClick={handleSave} className="gap-1.5">
            <Save className="h-4 w-4"/>
            Save Changes
          </Button>
        </div>
      </div>

      <div className="flex gap-2 border-b shrink-0">
        <Button variant={activeTab === "general" ? "default" : "ghost"} size="sm" onClick={() => setActiveTab("general")} className="rounded-b-none gap-2">
          <MonitorCog className="h-4 w-4"/>
          General
        </Button>
        <Button variant={activeTab === "files" ? "default" : "ghost"} size="sm" onClick={() => setActiveTab("files")} className="rounded-b-none gap-2">
          <FolderCog className="h-4 w-4"/>
          File Management
        </Button>
        <Button variant={activeTab === "api" ? "default" : "ghost"} size="sm" onClick={() => setActiveTab("api")} className="rounded-b-none gap-2">
          <Router className="h-4 w-4"/>
          Status
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto pt-4">
        {activeTab === "general" && (<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="download-path">Download Path</Label>
                <div className="flex gap-2">
                  <InputWithContext id="download-path" value={tempSettings.downloadPath} onChange={(e) => setTempSettings((prev) => ({
                ...prev,
                downloadPath: e.target.value,
            }))} placeholder="C:\Users\YourUsername\Music"/>
                  <Button type="button" onClick={handleBrowseFolder} className="gap-1.5">
                    <FolderOpen className="h-4 w-4"/>
                    Browse
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="theme-mode">Mode</Label>
                <Select value={tempSettings.themeMode} onValueChange={(value: "auto" | "light" | "dark") => setTempSettings((prev) => ({ ...prev, themeMode: value }))}>
                  <SelectTrigger id="theme-mode">
                    <SelectValue placeholder="Select theme mode"/>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto</SelectItem>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="dark">Dark</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="theme">Accent</Label>
                <Select value={tempSettings.theme} onValueChange={(value) => setTempSettings((prev) => ({ ...prev, theme: value }))}>
                  <SelectTrigger id="theme">
                    <SelectValue placeholder="Select a theme"/>
                  </SelectTrigger>
                  <SelectContent>
                    {themes.map((theme) => (<SelectItem key={theme.name} value={theme.name}>
                        <span className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full border border-border" style={{
                    backgroundColor: isDark
                        ? theme.cssVars.dark.primary
                        : theme.cssVars.light.primary,
                }}/>
                          {theme.label}
                        </span>
                      </SelectItem>))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="font">Font</Label>
                <Select value={tempSettings.fontFamily} onValueChange={(value: FontFamily) => setTempSettings((prev) => ({ ...prev, fontFamily: value }))}>
                  <SelectTrigger id="font">
                    <SelectValue placeholder="Select a font"/>
                  </SelectTrigger>
                  <SelectContent>
                    {FONT_OPTIONS.map((font) => (<SelectItem key={font.value} value={font.value}>
                        <span style={{ fontFamily: font.fontFamily }}>
                          {font.label}
                        </span>
                      </SelectItem>))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Switch id="sfx-enabled" checked={tempSettings.sfxEnabled} onCheckedChange={(checked) => setTempSettings((prev) => ({
                ...prev,
                sfxEnabled: checked,
            }))}/>
                <Label htmlFor="sfx-enabled" className="cursor-pointer text-sm font-normal">
                  Sound Effects
                </Label>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="link-resolver">Link Resolver</Label>
                <div className="flex items-center gap-3 flex-wrap">
                  <Select value={tempSettings.linkResolver} onValueChange={(value: "songstats" | "songlink") => setTempSettings((prev) => ({
                ...prev,
                linkResolver: value,
            }))}>
                    <SelectTrigger id="link-resolver" className="h-9 w-fit min-w-[140px]">
                      <SelectValue placeholder="Select a link resolver"/>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="songlink">
                        <span className="flex items-center gap-2">
                          <img src={songlinkIcon} alt="Songlink" className="h-4 w-4 shrink-0 rounded-[3px] object-contain" loading="lazy"/>
                          Songlink
                        </span>
                      </SelectItem>
                      <SelectItem value="songstats">
                        <span className="flex items-center gap-2">
                          <img src={songstatsIcon} alt="Songstats" className="h-4 w-4 shrink-0 rounded-[3px] object-contain" loading="lazy"/>
                          Songstats
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>

                  <div className="flex items-center gap-3">
                    <Switch id="allow-link-resolver-fallback" checked={tempSettings.allowResolverFallback} onCheckedChange={(checked) => setTempSettings((prev) => ({
                ...prev,
                allowResolverFallback: checked,
            }))}/>
                    <Label htmlFor="allow-link-resolver-fallback" className="text-sm font-normal cursor-pointer">
                      Allow Fallback
                    </Label>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="downloader">Source</Label>
                <div className="flex gap-2 flex-wrap">
                  <Select value={tempSettings.downloader} onValueChange={(value: any) => setTempSettings((prev) => ({
                ...prev,
                downloader: value,
            }))}>
                    <SelectTrigger id="downloader" className="h-9 w-fit">
                      <SelectValue placeholder="Select a source"/>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto</SelectItem>
                      <SelectItem value="tidal">
                        <span className="flex items-center gap-2">
                          <TidalIcon />
                          Tidal
                        </span>
                      </SelectItem>
                      <SelectItem value="qobuz">
                        <span className="flex items-center gap-2">
                          <QobuzIcon />
                          Qobuz
                        </span>
                      </SelectItem>
                      <SelectItem value="amazon">
                        <span className="flex items-center gap-2">
                          <AmazonIcon />
                          Amazon Music
                        </span>
                      </SelectItem>

                    </SelectContent>
                  </Select>

                  {tempSettings.downloader === "auto" && (<>
                      <Select value={tempSettings.autoOrder || "tidal-qobuz-amazon"} onValueChange={(value: any) => setTempSettings((prev) => ({
                    ...prev,
                    autoOrder: value,
                }))}>
                        <SelectTrigger className="h-9 w-fit min-w-[140px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          
                          <SelectItem value="tidal-qobuz-amazon">
                            <span className="flex items-center gap-1.5">
                              <TidalIcon className="fill-current"/>
                              <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                              <QobuzIcon className="fill-current"/>
                              <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                              <AmazonIcon className="fill-current"/>
                            </span>
                          </SelectItem>
                          <SelectItem value="tidal-amazon-qobuz">
                            <span className="flex items-center gap-1.5">
                              <TidalIcon className="fill-current"/>
                              <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                              <AmazonIcon className="fill-current"/>
                              <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                              <QobuzIcon className="fill-current"/>
                            </span>
                          </SelectItem>
                          <SelectItem value="qobuz-tidal-amazon">
                            <span className="flex items-center gap-1.5">
                              <QobuzIcon className="fill-current"/>
                              <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                              <TidalIcon className="fill-current"/>
                              <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                              <AmazonIcon className="fill-current"/>
                            </span>
                          </SelectItem>
                          <SelectItem value="qobuz-amazon-tidal">
                            <span className="flex items-center gap-1.5">
                              <QobuzIcon className="fill-current"/>
                              <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                              <AmazonIcon className="fill-current"/>
                              <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                              <TidalIcon className="fill-current"/>
                            </span>
                          </SelectItem>
                          <SelectItem value="amazon-tidal-qobuz">
                            <span className="flex items-center gap-1.5">
                              <AmazonIcon className="fill-current"/>
                              <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                              <TidalIcon className="fill-current"/>
                              <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                              <QobuzIcon className="fill-current"/>
                            </span>
                          </SelectItem>
                          <SelectItem value="amazon-qobuz-tidal">
                            <span className="flex items-center gap-1.5">
                              <AmazonIcon className="fill-current"/>
                              <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                              <QobuzIcon className="fill-current"/>
                              <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                              <TidalIcon className="fill-current"/>
                            </span>
                          </SelectItem>

                          
                          <SelectItem value="tidal-qobuz">
                            <span className="flex items-center gap-1.5">
                              <TidalIcon className="fill-current"/>
                              <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                              <QobuzIcon className="fill-current"/>
                            </span>
                          </SelectItem>
                          <SelectItem value="tidal-amazon">
                            <span className="flex items-center gap-1.5">
                              <TidalIcon className="fill-current"/>
                              <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                              <AmazonIcon className="fill-current"/>
                            </span>
                          </SelectItem>
                          <SelectItem value="qobuz-tidal">
                            <span className="flex items-center gap-1.5">
                              <QobuzIcon className="fill-current"/>
                              <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                              <TidalIcon className="fill-current"/>
                            </span>
                          </SelectItem>
                          <SelectItem value="qobuz-amazon">
                            <span className="flex items-center gap-1.5">
                              <QobuzIcon className="fill-current"/>
                              <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                              <AmazonIcon className="fill-current"/>
                            </span>
                          </SelectItem>
                          <SelectItem value="amazon-tidal">
                            <span className="flex items-center gap-1.5">
                              <AmazonIcon className="fill-current"/>
                              <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                              <TidalIcon className="fill-current"/>
                            </span>
                          </SelectItem>
                          <SelectItem value="amazon-qobuz">
                            <span className="flex items-center gap-1.5">
                              <AmazonIcon className="fill-current"/>
                              <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                              <QobuzIcon className="fill-current"/>
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>

                      <Select value={tempSettings.autoQuality || "16"} onValueChange={handleAutoQualityChange}>
                        <SelectTrigger className="h-9 w-fit">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="16">16-bit/44.1kHz</SelectItem>
                          <SelectItem value="24">24-bit/48kHz</SelectItem>
                        </SelectContent>
                      </Select>
                    </>)}

                  {tempSettings.downloader === "tidal" && (<Select value={tempSettings.tidalQuality} onValueChange={handleTidalQualityChange}>
                      <SelectTrigger className="h-9 w-fit">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="LOSSLESS">16-bit/44.1kHz</SelectItem>
                        <SelectItem value="HI_RES_LOSSLESS">
                          24-bit/48kHz
                        </SelectItem>
                      </SelectContent>
                    </Select>)}

                  {tempSettings.downloader === "qobuz" && (<Select value={tempSettings.qobuzQuality} onValueChange={handleQobuzQualityChange}>
                      <SelectTrigger className="h-9 w-fit">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="6">16-bit/44.1kHz</SelectItem>
                        <SelectItem value="27">24-bit/48kHz - 192kHz</SelectItem>
                      </SelectContent>
                    </Select>)}

                  {tempSettings.downloader === "amazon" && (<div className="h-9 px-3 flex items-center text-sm font-medium border border-input rounded-md bg-muted/30 text-muted-foreground whitespace-nowrap cursor-default">
                      16-bit - 24-bit/44.1kHz - 192kHz
                    </div>)}

                </div>

                {((tempSettings.downloader === "tidal" &&
                tempSettings.tidalQuality === "HI_RES_LOSSLESS") ||
                (tempSettings.downloader === "qobuz" &&
                    tempSettings.qobuzQuality === "27") ||
                (tempSettings.downloader === "auto" &&
                    tempSettings.autoQuality === "24")) && (<div className="flex items-center gap-3 pt-2">
                    <div className="flex items-center gap-3">
                      <Switch id="allow-fallback" checked={tempSettings.allowFallback} onCheckedChange={(checked) => setTempSettings((prev) => ({
                    ...prev,
                    allowFallback: checked,
                }))}/>
                      <Label htmlFor="allow-fallback" className="text-sm font-normal cursor-pointer">
                        Allow Quality Fallback (16-bit)
                      </Label>
                    </div>
                  </div>)}
              </div>

              <div className="border-t pt-6"/>

              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Switch id="embed-lyrics" checked={tempSettings.embedLyrics} onCheckedChange={(checked) => setTempSettings((prev) => ({
                ...prev,
                embedLyrics: checked,
            }))}/>
                  <Label htmlFor="embed-lyrics" className="cursor-pointer text-sm font-normal">
                    Embed Lyrics
                  </Label>
                </div>
                <div className="flex items-center gap-3">
                  <Switch id="embed-max-quality-cover" checked={tempSettings.embedMaxQualityCover} onCheckedChange={(checked) => setTempSettings((prev) => ({
                ...prev,
                embedMaxQualityCover: checked,
            }))}/>
                  <Label htmlFor="embed-max-quality-cover" className="cursor-pointer text-sm font-normal">
                    Embed Max Quality Cover
                  </Label>
                </div>
                <div className="flex items-center gap-3">
                  <Switch id="embed-genre" checked={tempSettings.embedGenre} onCheckedChange={(checked) => setTempSettings((prev) => ({
                ...prev,
                embedGenre: checked,
            }))}/>
                  <Label htmlFor="embed-genre" className="cursor-pointer text-sm font-normal">
                    Embed Genre
                  </Label>
                </div>
                {tempSettings.embedGenre && (<div className="flex items-center gap-3">
                    <Switch id="use-single-genre" checked={tempSettings.useSingleGenre} onCheckedChange={(checked) => setTempSettings((prev) => ({
                    ...prev,
                    useSingleGenre: checked,
                }))}/>
                    <Label htmlFor="use-single-genre" className="text-sm cursor-pointer font-normal">
                      Use Single Genre
                    </Label>
                  </div>)}
              </div>
            </div>
          </div>)}

        {activeTab === "files" && (<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label className="text-sm">Folder Structure</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help"/>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p className="text-xs whitespace-nowrap">
                        Variables:{" "}
                        {TEMPLATE_VARIABLES.map((v) => v.key).join(", ")}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex gap-2">
                  <Select value={tempSettings.folderPreset} onValueChange={(value: FolderPreset) => {
                const preset = FOLDER_PRESETS[value];
                setTempSettings((prev) => ({
                    ...prev,
                    folderPreset: value,
                    folderTemplate: value === "custom"
                        ? prev.folderTemplate || preset.template
                        : preset.template,
                }));
            }}>
                    <SelectTrigger className="h-9 w-fit">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(FOLDER_PRESETS).map(([key, { label }]) => (<SelectItem key={key} value={key}>
                            {label}
                          </SelectItem>))}
                    </SelectContent>
                  </Select>
                  {tempSettings.folderPreset === "custom" && (<InputWithContext value={tempSettings.folderTemplate} onChange={(e) => setTempSettings((prev) => ({
                    ...prev,
                    folderTemplate: e.target.value,
                }))} placeholder="{artist}/{album}" className="h-9 text-sm flex-1"/>)}
                </div>
                {tempSettings.folderTemplate && (<p className="text-xs text-muted-foreground">
                    Preview:{" "}
                    <span className="font-mono">
                      {tempSettings.folderTemplate
                    .replace(/\{artist\}/g, tempSettings.separator === "comma" ? "Kendrick Lamar, SZA" : "Kendrick Lamar; SZA")
                    .replace(/\{album\}/g, "Black Panther")
                    .replace(/\{album_artist\}/g, "Kendrick Lamar")
                    .replace(/\{title\}/g, "All The Stars")
                    .replace(/\{track\}/g, "01")
                    .replace(/\{disc\}/g, "1")
                    .replace(/\{year\}/g, "2018")
                    .replace(/\{date\}/g, "2018-02-09")}
                      /
                    </span>
                  </p>)}
              </div>

              <div className="flex items-center gap-3">
                <Switch id="create-playlist-folder" checked={tempSettings.createPlaylistFolder} onCheckedChange={(checked) => setTempSettings((prev) => ({
                ...prev,
                createPlaylistFolder: checked,
            }))}/>
                <Label htmlFor="create-playlist-folder" className="text-sm cursor-pointer font-normal">
                  Playlist Folder
                </Label>
              </div>

              <div className="flex items-center gap-3">
                <Switch id="playlist-owner-folder-name" checked={tempSettings.playlistOwnerFolderName} onCheckedChange={(checked) => setTempSettings((prev) => ({
                ...prev,
                playlistOwnerFolderName: checked,
            }))}/>
                <Label htmlFor="playlist-owner-folder-name" className="text-sm cursor-pointer font-normal">
                  Playlist Owner Folder Name
                </Label>
              </div>

              <div className="flex items-center gap-3">
                <Switch id="create-m3u8-file" checked={tempSettings.createM3u8File} onCheckedChange={(checked) => setTempSettings((prev) => ({
                ...prev,
                createM3u8File: checked,
            }))}/>
                <Label htmlFor="create-m3u8-file" className="text-sm cursor-pointer font-normal">
                  Create M3U8 Playlist File
                </Label>
              </div>

              <div className="flex items-center gap-3">
                <Switch id="use-first-artist-only" checked={tempSettings.useFirstArtistOnly} onCheckedChange={(checked) => setTempSettings((prev) => ({
                ...prev,
                useFirstArtistOnly: checked,
            }))}/>
                <Label htmlFor="use-first-artist-only" className="text-sm cursor-pointer font-normal">
                  Use First Artist Only
                </Label>
              </div>


            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label className="text-sm">Filename Format</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help"/>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="text-xs whitespace-nowrap">
                      Variables:{" "}
                      {TEMPLATE_VARIABLES.map((v) => v.key).join(", ")}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex gap-2">
                <Select value={tempSettings.filenamePreset} onValueChange={(value: FilenamePreset) => {
                const preset = FILENAME_PRESETS[value];
                setTempSettings((prev) => ({
                    ...prev,
                    filenamePreset: value,
                    filenameTemplate: value === "custom"
                        ? prev.filenameTemplate || preset.template
                        : preset.template,
                }));
            }}>
                  <SelectTrigger className="h-9 w-fit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(FILENAME_PRESETS).map(([key, { label }]) => (<SelectItem key={key} value={key}>
                          {label}
                        </SelectItem>))}
                  </SelectContent>
                </Select>
                {tempSettings.filenamePreset === "custom" && (<InputWithContext value={tempSettings.filenameTemplate} onChange={(e) => setTempSettings((prev) => ({
                    ...prev,
                    filenameTemplate: e.target.value,
                }))} placeholder="{track}. {title}" className="h-9 text-sm flex-1"/>)}
              </div>
              <div className="space-y-2 pt-2">
                <Label className="text-sm">Separator</Label>
                <div className="flex gap-2">
                  <Select value={tempSettings.separator} onValueChange={(value: "comma" | "semicolon") => setTempSettings((prev) => ({
                ...prev,
                separator: value,
            }))}>
                    <SelectTrigger className="h-9 w-fit">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="comma">Comma (,)</SelectItem>
                      <SelectItem value="semicolon">Semicolon (;)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {tempSettings.filenameTemplate && (<p className="text-xs text-muted-foreground">
                  Preview:{" "}
                  <span className="font-mono">
                    {tempSettings.filenameTemplate
                    .replace(/\{artist\}/g, tempSettings.separator === "comma" ? "Kendrick Lamar, SZA" : "Kendrick Lamar; SZA")
                    .replace(/\{album_artist\}/g, "Kendrick Lamar")
                    .replace(/\{album\}/g, "Black Panther")
                    .replace(/\{title\}/g, "All The Stars")
                    .replace(/\{track\}/g, "01")
                    .replace(/\{disc\}/g, "1")
                    .replace(/\{year\}/g, "2018")
                    .replace(/\{date\}/g, "2018-02-09")}
                    .flac
                  </span>
                </p>)}
                
            </div>
          </div>)}
        
        {activeTab === "api" && (<ApiStatusTab />)}
      </div>

      <Dialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <DialogContent className="max-w-md [&>button]:hidden">
          <DialogHeader>
            <DialogTitle>Reset to Default?</DialogTitle>
            <DialogDescription>
              This will reset all settings to their default values. Your custom
              configurations will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResetConfirm(false)}>
              Cancel
            </Button>
            <Button onClick={handleReset}>Reset</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>);
}
