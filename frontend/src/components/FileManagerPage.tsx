import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { InputWithContext } from "@/components/ui/input-with-context";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FolderOpen,
  RefreshCw,
  FileMusic,
  ChevronRight,
  ChevronDown,
  Pencil,
  Eye,
  Folder,
  Info,
  RotateCcw,
  FileText,
  Image,
  Copy,
  Check,
} from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Spinner } from "@/components/ui/spinner";
import { SelectFolder } from "../../wailsjs/go/main/App";
import { backend } from "../../wailsjs/go/models";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { getSettings } from "@/lib/settings";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const ListDirectoryFiles = (path: string): Promise<backend.FileInfo[]> => 
  (window as any)['go']['main']['App']['ListDirectoryFiles'](path);
const PreviewRenameFiles = (files: string[], format: string): Promise<backend.RenamePreview[]> => 
  (window as any)['go']['main']['App']['PreviewRenameFiles'](files, format);
const RenameFilesByMetadata = (files: string[], format: string): Promise<backend.RenameResult[]> => 
  (window as any)['go']['main']['App']['RenameFilesByMetadata'](files, format);
const ReadFileMetadata = (path: string): Promise<backend.AudioMetadata> => 
  (window as any)['go']['main']['App']['ReadFileMetadata'](path);
const IsFFprobeInstalled = (): Promise<boolean> => 
  (window as any)['go']['main']['App']['IsFFprobeInstalled']();
const DownloadFFmpeg = (): Promise<{ success: boolean; message: string; error?: string }> => 
  (window as any)['go']['main']['App']['DownloadFFmpeg']();
const ReadTextFile = (path: string): Promise<string> => 
  (window as any)['go']['main']['App']['ReadTextFile'](path);
const RenameFileTo = (oldPath: string, newName: string): Promise<void> => 
  (window as any)['go']['main']['App']['RenameFileTo'](oldPath, newName);
const ReadImageAsBase64 = (path: string): Promise<string> => 
  (window as any)['go']['main']['App']['ReadImageAsBase64'](path);

interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  children?: FileNode[];
  expanded?: boolean;
}

interface FileMetadata {
  title: string;
  artist: string;
  album: string;
  album_artist: string;
  track_number: number;
  disc_number: number;
  year: string;
}

type TabType = "track" | "lyric" | "cover";

const FORMAT_PRESETS: Record<string, { label: string; template: string }> = {
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

const STORAGE_KEY = "spotiflac_file_manager_state";
const DEFAULT_PRESET = "title-artist";
const DEFAULT_CUSTOM_FORMAT = "{title} - {artist}";

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export function FileManagerPage() {
  const [rootPath, setRootPath] = useState(() => {
    const settings = getSettings();
    return settings.downloadPath || "";
  });
  const [allFiles, setAllFiles] = useState<FileNode[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>("track");
  const [formatPreset, setFormatPreset] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.formatPreset && FORMAT_PRESETS[parsed.formatPreset]) {
          return parsed.formatPreset;
        }
      }
    } catch { /* ignore */ }
    return DEFAULT_PRESET;
  });
  const [customFormat, setCustomFormat] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.customFormat) return parsed.customFormat;
      }
    } catch { /* ignore */ }
    return DEFAULT_CUSTOM_FORMAT;
  });

  const renameFormat = formatPreset === "custom" ? (customFormat || FORMAT_PRESETS["custom"].template) : FORMAT_PRESETS[formatPreset].template;
  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState<backend.RenamePreview[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [previewOnly, setPreviewOnly] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);
  const [metadataFile, setMetadataFile] = useState<string>("");
  const [metadataInfo, setMetadataInfo] = useState<FileMetadata | null>(null);
  const [loadingMetadata, setLoadingMetadata] = useState(false);
  const [showFFprobeDialog, setShowFFprobeDialog] = useState(false);
  const [installingFFprobe, setInstallingFFprobe] = useState(false);
  const [showLyricsPreview, setShowLyricsPreview] = useState(false);
  const [lyricsContent, setLyricsContent] = useState("");
  const [lyricsFile, setLyricsFile] = useState("");
  const [lyricsTab, setLyricsTab] = useState<"synced" | "plain">("synced");
  const [copySuccess, setCopySuccess] = useState(false);
  const [showCoverPreview, setShowCoverPreview] = useState(false);
  const [coverFile, setCoverFile] = useState("");
  const [coverData, setCoverData] = useState("");
  const [showManualRename, setShowManualRename] = useState(false);
  const [manualRenameFile, setManualRenameFile] = useState("");
  const [manualRenameName, setManualRenameName] = useState("");
  const [manualRenaming, setManualRenaming] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ formatPreset, customFormat }));
    } catch { /* ignore */ }
  }, [formatPreset, customFormat]);

  useEffect(() => {
    const checkFullscreen = () => {
      const isMaximized = window.innerHeight >= window.screen.height * 0.9;
      setIsFullscreen(isMaximized);
    };
    checkFullscreen();
    window.addEventListener("resize", checkFullscreen);
    window.addEventListener("focus", checkFullscreen);
    return () => {
      window.removeEventListener("resize", checkFullscreen);
      window.removeEventListener("focus", checkFullscreen);
    };
  }, []);

  const filterFilesByType = (nodes: FileNode[], type: TabType): FileNode[] => {
    return nodes
      .map((node) => {
        if (node.is_dir && node.children) {
          const filteredChildren = filterFilesByType(node.children, type);
          if (filteredChildren.length > 0) {
            return { ...node, children: filteredChildren };
          }
          return null;
        }
        const ext = node.name.toLowerCase();
        if (type === "track" && (ext.endsWith(".flac") || ext.endsWith(".mp3") || ext.endsWith(".m4a"))) return node;
        if (type === "lyric" && ext.endsWith(".lrc")) return node;
        if (type === "cover" && (ext.endsWith(".jpg") || ext.endsWith(".jpeg") || ext.endsWith(".png"))) return node;
        return null;
      })
      .filter((node): node is FileNode => node !== null);
  };

  const loadFiles = useCallback(async () => {
    if (!rootPath) return;
    setLoading(true);
    try {
      const result = await ListDirectoryFiles(rootPath);
      if (!result || !Array.isArray(result)) {
        setAllFiles([]);
        setSelectedFiles(new Set());
        return;
      }
      setAllFiles(result as FileNode[]);
      setSelectedFiles(new Set());
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err || "");
      if (!errorMsg.toLowerCase().includes("empty") && !errorMsg.toLowerCase().includes("no file")) {
        toast.error("Failed to load files", { description: errorMsg || "Unknown error" });
      }
      setAllFiles([]);
      setSelectedFiles(new Set());
    } finally {
      setLoading(false);
    }
  }, [rootPath]);

  useEffect(() => {
    if (rootPath) loadFiles();
  }, [rootPath, loadFiles]);

  const filteredFiles = filterFilesByType(allFiles, activeTab);

  const getAllFilesFlat = (nodes: FileNode[]): FileNode[] => {
    const result: FileNode[] = [];
    for (const node of nodes) {
      if (!node.is_dir) result.push(node);
      if (node.children) result.push(...getAllFilesFlat(node.children));
    }
    return result;
  };

  const allAudioFiles = getAllFilesFlat(filterFilesByType(allFiles, "track"));
  const allLyricFiles = getAllFilesFlat(filterFilesByType(allFiles, "lyric"));
  const allCoverFiles = getAllFilesFlat(filterFilesByType(allFiles, "cover"));

  const handleSelectFolder = async () => {
    try {
      const path = await SelectFolder(rootPath);
      if (path) setRootPath(path);
    } catch (err) {
      toast.error("Failed to select folder", { description: err instanceof Error ? err.message : "Unknown error" });
    }
  };

  const toggleExpand = (path: string) => {
    setAllFiles((prev) => toggleNodeExpand(prev, path));
  };

  const toggleNodeExpand = (nodes: FileNode[], path: string): FileNode[] => {
    return nodes.map((node) => {
      if (node.path === path) return { ...node, expanded: !node.expanded };
      if (node.children) return { ...node, children: toggleNodeExpand(node.children, path) };
      return node;
    });
  };

  const toggleSelect = (path: string) => {
    setSelectedFiles((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(path)) newSet.delete(path);
      else newSet.add(path);
      return newSet;
    });
  };

  const toggleFolderSelect = (node: FileNode) => {
    const folderFiles = getAllFilesFlat([node]);
    const allSelected = folderFiles.every((f) => selectedFiles.has(f.path));
    setSelectedFiles((prev) => {
      const newSet = new Set(prev);
      if (allSelected) folderFiles.forEach((f) => newSet.delete(f.path));
      else folderFiles.forEach((f) => newSet.add(f.path));
      return newSet;
    });
  };

  const isFolderSelected = (node: FileNode): boolean | "indeterminate" => {
    const folderFiles = getAllFilesFlat([node]);
    if (folderFiles.length === 0) return false;
    const selectedCount = folderFiles.filter((f) => selectedFiles.has(f.path)).length;
    if (selectedCount === 0) return false;
    if (selectedCount === folderFiles.length) return true;
    return "indeterminate";
  };

  const selectAll = () => setSelectedFiles(new Set(allAudioFiles.map((f) => f.path)));
  const deselectAll = () => setSelectedFiles(new Set());
  const resetToDefault = () => { setFormatPreset(DEFAULT_PRESET); setCustomFormat(DEFAULT_CUSTOM_FORMAT); setShowResetConfirm(false); };

  const handlePreview = async (isPreviewOnly: boolean) => {
    if (selectedFiles.size === 0) { toast.error("No files selected"); return; }
    const hasM4A = Array.from(selectedFiles).some(f => f.toLowerCase().endsWith(".m4a"));
    if (hasM4A) {
      const installed = await IsFFprobeInstalled();
      if (!installed) { setShowFFprobeDialog(true); return; }
    }
    try {
      const result = await PreviewRenameFiles(Array.from(selectedFiles), renameFormat);
      setPreviewData(result);
      setPreviewOnly(isPreviewOnly);
      setShowPreview(true);
    } catch (err) {
      toast.error("Failed to generate preview", { description: err instanceof Error ? err.message : "Unknown error" });
    }
  };

  const handleShowMetadata = async (filePath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (filePath.toLowerCase().endsWith(".m4a")) {
      const installed = await IsFFprobeInstalled();
      if (!installed) { setShowFFprobeDialog(true); return; }
    }
    setMetadataFile(filePath);
    setLoadingMetadata(true);
    try {
      const metadata = await ReadFileMetadata(filePath);
      setMetadataInfo(metadata as FileMetadata);
      setShowMetadata(true);
    } catch (err) {
      toast.error("Failed to read metadata", { description: err instanceof Error ? err.message : "Unknown error" });
      setMetadataInfo(null);
    } finally {
      setLoadingMetadata(false);
    }
  };

  const handleInstallFFprobe = async () => {
    setInstallingFFprobe(true);
    try {
      const result = await DownloadFFmpeg();
      if (result.success) { toast.success("FFprobe installed successfully"); setShowFFprobeDialog(false); }
      else toast.error("Failed to install FFprobe", { description: result.error || result.message });
    } catch (err) {
      toast.error("Failed to install FFprobe", { description: err instanceof Error ? err.message : "Unknown error" });
    } finally {
      setInstallingFFprobe(false);
    }
  };

  const handleShowLyrics = async (filePath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setLyricsFile(filePath);
    setLyricsTab("synced");
    try {
      const content = await ReadTextFile(filePath);
      setLyricsContent(content);
      setShowLyricsPreview(true);
    } catch (err) {
      toast.error("Failed to read lyrics file", { description: err instanceof Error ? err.message : "Unknown error" });
    }
  };

  const handleShowCover = async (filePath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCoverFile(filePath);
    try {
      const data = await ReadImageAsBase64(filePath);
      setCoverData(data);
      setShowCoverPreview(true);
    } catch (err) {
      toast.error("Failed to load image", { description: err instanceof Error ? err.message : "Unknown error" });
    }
  };

  const getPlainLyrics = (content: string) => {
    return content.split('\n').map(line => line.replace(/^\[[\d:.]+\]\s*/, '')).filter(line => !line.startsWith('[') || line.includes(']')).map(line => line.startsWith('[') ? '' : line).join('\n').trim();
  };

  const handleCopyLyrics = async () => {
    try {
      const textToCopy = lyricsTab === "synced" ? lyricsContent : getPlainLyrics(lyricsContent);
      await navigator.clipboard.writeText(textToCopy);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 500);
    } catch { toast.error("Failed to copy lyrics"); }
  };

  const handleManualRename = (filePath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const fileName = filePath.split(/[/\\]/).pop() || "";
    const nameWithoutExt = fileName.replace(/\.[^.]+$/, "");
    setManualRenameFile(filePath);
    setManualRenameName(nameWithoutExt);
    setShowManualRename(true);
  };

  const handleConfirmManualRename = async () => {
    if (!manualRenameFile || !manualRenameName.trim()) return;
    setManualRenaming(true);
    try {
      await RenameFileTo(manualRenameFile, manualRenameName.trim());
      toast.success("File renamed successfully");
      setShowManualRename(false);
      loadFiles();
    } catch (err) {
      toast.error("Failed to rename file", { description: err instanceof Error ? err.message : "Unknown error" });
    } finally {
      setManualRenaming(false);
    }
  };

  const handleRename = async () => {
    if (selectedFiles.size === 0) return;
    setRenaming(true);
    try {
      const result = await RenameFilesByMetadata(Array.from(selectedFiles), renameFormat);
      const successCount = result.filter((r: backend.RenameResult) => r.success).length;
      const failCount = result.filter((r: backend.RenameResult) => !r.success).length;
      if (successCount > 0) toast.success("Rename Complete", { description: `${successCount} file(s) renamed${failCount > 0 ? `, ${failCount} failed` : ""}` });
      else toast.error("Rename Failed", { description: `All ${failCount} file(s) failed to rename` });
      setShowPreview(false);
      setSelectedFiles(new Set());
      loadFiles();
    } catch (err) {
      toast.error("Rename Failed", { description: err instanceof Error ? err.message : "Unknown error" });
    } finally {
      setRenaming(false);
    }
  };

  const renderTrackTree = (nodes: FileNode[], depth = 0) => {
    return nodes.map((node) => (
      <div key={node.path}>
        <div
          className={`flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50 cursor-pointer ${selectedFiles.has(node.path) ? "bg-primary/10" : ""}`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => (node.is_dir ? toggleExpand(node.path) : toggleSelect(node.path))}
        >
          {node.is_dir ? (
            <>
              <Checkbox
                checked={isFolderSelected(node) === true}
                ref={(el) => { if (el) (el as HTMLButtonElement).dataset.state = isFolderSelected(node) === "indeterminate" ? "indeterminate" : isFolderSelected(node) ? "checked" : "unchecked"; }}
                onCheckedChange={() => toggleFolderSelect(node)}
                onClick={(e) => e.stopPropagation()}
                className="shrink-0 data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground"
              />
              {node.expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
              <Folder className="h-4 w-4 text-yellow-500 shrink-0" />
            </>
          ) : (
            <>
              <Checkbox checked={selectedFiles.has(node.path)} onCheckedChange={() => toggleSelect(node.path)} onClick={(e) => e.stopPropagation()} className="shrink-0" />
              <FileMusic className="h-4 w-4 text-primary shrink-0" />
            </>
          )}
          <span className="truncate text-sm flex-1">
            {node.name}
            {node.is_dir && <span className="text-muted-foreground ml-1">({getAllFilesFlat([node]).length})</span>}
          </span>
          {!node.is_dir && (
            <>
              <span className="text-xs text-muted-foreground shrink-0">{formatFileSize(node.size)}</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button className="p-1 rounded hover:bg-muted shrink-0" onClick={(e) => handleShowMetadata(node.path, e)}>
                    <Info className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>View Metadata</TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
        {node.is_dir && node.expanded && node.children && <div>{renderTrackTree(node.children, depth + 1)}</div>}
      </div>
    ));
  };

  const renderLyricTree = (nodes: FileNode[], depth = 0) => {
    return nodes.map((node) => (
      <div key={node.path}>
        <div
          className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50 cursor-pointer"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={(e) => node.is_dir ? toggleExpand(node.path) : handleShowLyrics(node.path, e)}
        >
          {node.is_dir ? (
            <>
              {node.expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
              <Folder className="h-4 w-4 text-yellow-500 shrink-0" />
            </>
          ) : (
            <FileText className="h-4 w-4 text-blue-500 shrink-0" />
          )}
          <span className="truncate text-sm flex-1">
            {node.name}
            {node.is_dir && <span className="text-muted-foreground ml-1">({getAllFilesFlat([node]).length})</span>}
          </span>
          {!node.is_dir && (
            <>
              <span className="text-xs text-muted-foreground shrink-0">{formatFileSize(node.size)}</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button className="p-1 rounded hover:bg-muted shrink-0" onClick={(e) => handleManualRename(node.path, e)}>
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Rename</TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
        {node.is_dir && node.expanded && node.children && <div>{renderLyricTree(node.children, depth + 1)}</div>}
      </div>
    ));
  };

  const renderCoverTree = (nodes: FileNode[], depth = 0) => {
    return nodes.map((node) => (
      <div key={node.path}>
        <div
          className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50 cursor-pointer"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={(e) => node.is_dir ? toggleExpand(node.path) : handleShowCover(node.path, e)}
        >
          {node.is_dir ? (
            <>
              {node.expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
              <Folder className="h-4 w-4 text-yellow-500 shrink-0" />
            </>
          ) : (
            <Image className="h-4 w-4 text-green-500 shrink-0" />
          )}
          <span className="truncate text-sm flex-1">
            {node.name}
            {node.is_dir && <span className="text-muted-foreground ml-1">({getAllFilesFlat([node]).length})</span>}
          </span>
          {!node.is_dir && (
            <>
              <span className="text-xs text-muted-foreground shrink-0">{formatFileSize(node.size)}</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button className="p-1 rounded hover:bg-muted shrink-0" onClick={(e) => handleManualRename(node.path, e)}>
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Rename</TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
        {node.is_dir && node.expanded && node.children && <div>{renderCoverTree(node.children, depth + 1)}</div>}
      </div>
    ));
  };

  const allSelected = allAudioFiles.length > 0 && selectedFiles.size === allAudioFiles.length;

  return (
    <div className={`space-y-6 ${isFullscreen ? "h-full flex flex-col" : ""}`}>
      <div className="flex items-center justify-between shrink-0">
        <h1 className="text-2xl font-bold">File Manager</h1>
      </div>

      {/* Path Selection */}
      <div className="flex items-center gap-2 shrink-0">
        <InputWithContext value={rootPath} onChange={(e) => setRootPath(e.target.value)} placeholder="Select a folder..." className="flex-1" />
        <Button onClick={handleSelectFolder}>
          <FolderOpen className="h-4 w-4" />
          Browse
        </Button>
        <Button variant="outline" onClick={loadFiles} disabled={loading || !rootPath}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b shrink-0">
        <Button variant={activeTab === "track" ? "default" : "ghost"} size="sm" onClick={() => setActiveTab("track")} className="rounded-b-none">
          <FileMusic className="h-4 w-4" />
          Track ({allAudioFiles.length})
        </Button>
        <Button variant={activeTab === "lyric" ? "default" : "ghost"} size="sm" onClick={() => setActiveTab("lyric")} className="rounded-b-none">
          <FileText className="h-4 w-4" />
          Lyric ({allLyricFiles.length})
        </Button>
        <Button variant={activeTab === "cover" ? "default" : "ghost"} size="sm" onClick={() => setActiveTab("cover")} className="rounded-b-none">
          <Image className="h-4 w-4" />
          Cover ({allCoverFiles.length})
        </Button>
      </div>

      {/* Rename Format - Only for Track tab */}
      {activeTab === "track" && (
        <div className="space-y-2 shrink-0">
          <div className="flex items-center gap-2">
            <Label className="text-sm">Rename Format</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="right">
                <p className="text-xs whitespace-nowrap">Variables: {"{title}"}, {"{artist}"}, {"{album}"}, {"{album_artist}"}, {"{track}"}, {"{disc}"}, {"{year}"}</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="flex items-center gap-2">
            <Select value={formatPreset} onValueChange={setFormatPreset}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(FORMAT_PRESETS).map(([key, { label }]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {formatPreset === "custom" && (
              <InputWithContext value={customFormat} onChange={(e) => setCustomFormat(e.target.value)} placeholder="{artist} - {title}" className="flex-1" />
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={() => setShowResetConfirm(true)}>
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reset to Default</TooltipContent>
            </Tooltip>
          </div>
          <p className="text-xs text-muted-foreground">
            Preview: <span className="font-mono">{renameFormat.replace(/\{title\}/g, "All The Stars").replace(/\{artist\}/g, "Kendrick Lamar, SZA").replace(/\{album\}/g, "Black Panther").replace(/\{album_artist\}/g, "Kendrick Lamar").replace(/\{track\}/g, "01").replace(/\{disc\}/g, "1").replace(/\{year\}/g, "2018")}.flac</span>
          </p>
        </div>
      )}

      {/* File Tree */}
      <div className={`border rounded-lg ${isFullscreen ? "flex-1 flex flex-col min-h-0" : ""}`}>
        {activeTab === "track" && (
          <div className="flex items-center justify-between p-3 border-b bg-muted/30 shrink-0">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={allSelected ? deselectAll : selectAll}>
                {allSelected ? "Deselect All" : "Select All"}
              </Button>
              <span className="text-sm text-muted-foreground">{selectedFiles.size} of {allAudioFiles.length} file(s) selected</span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => handlePreview(true)} disabled={selectedFiles.size === 0 || loading}>
                <Eye className="h-4 w-4" />
                Preview
              </Button>
              <Button size="sm" onClick={() => handlePreview(false)} disabled={selectedFiles.size === 0 || loading}>
                <Pencil className="h-4 w-4" />
                Rename
              </Button>
            </div>
          </div>
        )}

        <div className={`overflow-y-auto p-2 ${isFullscreen ? "flex-1 min-h-0" : "max-h-[400px]"}`}>
          {loading ? (
            <div className="flex items-center justify-center py-8"><Spinner className="h-6 w-6" /></div>
          ) : filteredFiles.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {rootPath ? `No ${activeTab} files found` : "Select a folder to browse"}
            </div>
          ) : (
            activeTab === "track" ? renderTrackTree(filteredFiles) :
            activeTab === "lyric" ? renderLyricTree(filteredFiles) :
            renderCoverTree(filteredFiles)
          )}
        </div>
      </div>

      {/* Reset Confirmation Dialog */}
      <Dialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <DialogContent className="max-w-md [&>button]:hidden">
          <DialogHeader>
            <DialogTitle>Reset to Default?</DialogTitle>
            <DialogDescription>This will reset the rename format to "Title - Artist". Your custom format will be lost.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResetConfirm(false)}>Cancel</Button>
            <Button onClick={resetToDefault}>Reset</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col [&>button]:hidden">
          <DialogHeader>
            <DialogTitle>Rename Preview</DialogTitle>
            <DialogDescription>Review the changes before renaming. Files with errors will be skipped.</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-2 py-4">
            {previewData.map((item, index) => (
              <div key={index} className={`p-3 rounded-lg border ${item.error ? "border-destructive/50 bg-destructive/5" : "border-border"}`}>
                <div className="text-sm">
                  <div className="text-muted-foreground break-all">{item.old_name}</div>
                  {item.error ? <div className="text-destructive text-xs mt-1">{item.error}</div> : <div className="text-primary font-medium break-all mt-1">→ {item.new_name}</div>}
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            {previewOnly ? (
              <Button onClick={() => setShowPreview(false)}>Close</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setShowPreview(false)}>Cancel</Button>
                <Button onClick={handleRename} disabled={renaming}>
                  {renaming ? <><Spinner className="h-4 w-4" />Renaming...</> : <>Rename {previewData.filter((p) => !p.error).length} File(s)</>}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Metadata Dialog */}
      <Dialog open={showMetadata} onOpenChange={setShowMetadata}>
        <DialogContent className="max-w-md [&>button]:hidden">
          <DialogHeader>
            <DialogTitle>File Metadata</DialogTitle>
            <DialogDescription className="break-all">{metadataFile.split(/[/\\]/).pop()}</DialogDescription>
          </DialogHeader>
          {loadingMetadata ? (
            <div className="flex items-center justify-center py-8"><Spinner className="h-6 w-6" /></div>
          ) : metadataInfo ? (
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-[100px_1fr] gap-2 text-sm"><span className="text-muted-foreground">Title</span><span>{metadataInfo.title || "-"}</span></div>
              <div className="grid grid-cols-[100px_1fr] gap-2 text-sm"><span className="text-muted-foreground">Artist</span><span>{metadataInfo.artist || "-"}</span></div>
              <div className="grid grid-cols-[100px_1fr] gap-2 text-sm"><span className="text-muted-foreground">Album</span><span>{metadataInfo.album || "-"}</span></div>
              <div className="grid grid-cols-[100px_1fr] gap-2 text-sm"><span className="text-muted-foreground">Album Artist</span><span>{metadataInfo.album_artist || "-"}</span></div>
              <div className="grid grid-cols-[100px_1fr] gap-2 text-sm"><span className="text-muted-foreground">Track</span><span>{metadataInfo.track_number || "-"}</span></div>
              <div className="grid grid-cols-[100px_1fr] gap-2 text-sm"><span className="text-muted-foreground">Disc</span><span>{metadataInfo.disc_number || "-"}</span></div>
              <div className="grid grid-cols-[100px_1fr] gap-2 text-sm"><span className="text-muted-foreground">Year</span><span>{metadataInfo.year ? metadataInfo.year.substring(0, 4) : "-"}</span></div>
            </div>
          ) : (
            <div className="text-center py-4 text-muted-foreground">No metadata available</div>
          )}
          <DialogFooter><Button onClick={() => setShowMetadata(false)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* FFprobe Install Dialog */}
      <Dialog open={showFFprobeDialog} onOpenChange={setShowFFprobeDialog}>
        <DialogContent className="max-w-md [&>button]:hidden">
          <DialogHeader>
            <DialogTitle>FFprobe Required</DialogTitle>
            <DialogDescription>Reading M4A metadata requires FFprobe. Would you like to download and install it now?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFFprobeDialog(false)} disabled={installingFFprobe}>Cancel</Button>
            <Button onClick={handleInstallFFprobe} disabled={installingFFprobe}>
              {installingFFprobe ? <><Spinner className="h-4 w-4" />Installing...</> : "Install FFprobe"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lyrics Preview Dialog */}
      <Dialog open={showLyricsPreview} onOpenChange={setShowLyricsPreview}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-hidden flex flex-col [&>button]:hidden">
          <DialogHeader>
            <DialogTitle>Lyrics Preview</DialogTitle>
            <DialogDescription className="break-all">{lyricsFile.split(/[/\\]/).pop()}</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 border-b pb-2">
            <Button variant={lyricsTab === "synced" ? "default" : "ghost"} size="sm" onClick={() => setLyricsTab("synced")}>Synced</Button>
            <Button variant={lyricsTab === "plain" ? "default" : "ghost"} size="sm" onClick={() => setLyricsTab("plain")}>Plain</Button>
          </div>
          <div className="flex-1 overflow-y-auto py-4">
            <pre className="text-sm whitespace-pre-wrap font-mono bg-muted/30 p-4 rounded-lg">
              {lyricsTab === "synced" ? lyricsContent : getPlainLyrics(lyricsContent) || "No lyrics content"}
            </pre>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCopyLyrics} className="gap-1.5">
              {copySuccess ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              Copy
            </Button>
            <Button onClick={() => setShowLyricsPreview(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cover Preview Dialog */}
      <Dialog open={showCoverPreview} onOpenChange={setShowCoverPreview}>
        <DialogContent className="max-w-lg [&>button]:hidden">
          <DialogHeader>
            <DialogTitle>Cover Preview</DialogTitle>
            <DialogDescription className="break-all">{coverFile.split(/[/\\]/).pop()}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center p-4">
            {coverData ? <img src={coverData} alt="Cover" className="max-w-full max-h-[350px] rounded-lg object-contain" /> : <div className="text-muted-foreground">Loading...</div>}
          </div>
          <DialogFooter><Button onClick={() => setShowCoverPreview(false)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual Rename Dialog */}
      <Dialog open={showManualRename} onOpenChange={setShowManualRename}>
        <DialogContent className="max-w-2xl [&>button]:hidden">
          <DialogHeader>
            <DialogTitle>Rename File</DialogTitle>
            <DialogDescription className="break-all">{manualRenameFile.split(/[/\\]/).pop()}</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="newName" className="text-sm">New Name</Label>
            <div className="flex items-center gap-2 mt-2">
              <InputWithContext id="newName" value={manualRenameName} onChange={(e) => setManualRenameName(e.target.value)} placeholder="Enter new name" className="flex-1" onKeyDown={(e) => { if (e.key === "Enter" && !manualRenaming) handleConfirmManualRename(); }} />
              <span className="text-sm text-muted-foreground shrink-0">{manualRenameFile.match(/\.[^.]+$/)?.[0] || ""}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowManualRename(false)} disabled={manualRenaming}>Cancel</Button>
            <Button onClick={handleConfirmManualRename} disabled={manualRenaming || !manualRenameName.trim()}>
              {manualRenaming ? <><Spinner className="h-4 w-4" />Renaming...</> : "Rename"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
