import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
  X,
  RotateCcw,
} from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Spinner } from "@/components/ui/spinner";
import { SelectFolder } from "../../wailsjs/go/main/App";
import { backend } from "../../wailsjs/go/models";

// These functions will be available after Wails regenerates bindings
// For now, we call them directly via window.go
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  children?: FileNode[];
  expanded?: boolean;
  selected?: boolean;
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

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}
const DEFAULT_PRESET = "title-artist";
const DEFAULT_CUSTOM_FORMAT = "{title} - {artist}";

export function FileManagerPage() {
  const [rootPath, setRootPath] = useState(() => {
    const settings = getSettings();
    return settings.downloadPath || "";
  });
  const [files, setFiles] = useState<FileNode[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [formatPreset, setFormatPreset] = useState<string>(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.formatPreset && FORMAT_PRESETS[parsed.formatPreset]) {
          return parsed.formatPreset;
        }
      }
    } catch (err) {
      // Ignore
    }
    return DEFAULT_PRESET;
  });
  const [customFormat, setCustomFormat] = useState(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.customFormat) {
          return parsed.customFormat;
        }
      }
    } catch (err) {
      // Ignore
    }
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

  // Save state to sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ formatPreset, customFormat }));
    } catch (err) {
      console.error("Failed to save state:", err);
    }
  }, [formatPreset, customFormat]);

  // Detect fullscreen/maximized window
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

  const loadFiles = useCallback(async () => {
    if (!rootPath) return;

    setLoading(true);
    try {
      const result = await ListDirectoryFiles(rootPath);
      // Handle null/undefined result (can happen on Linux)
      if (!result || !Array.isArray(result)) {
        setFiles([]);
        setSelectedFiles(new Set());
        return;
      }
      // Filter to only show audio files and folders containing audio files
      const filtered = filterAudioFiles(result as FileNode[]);
      setFiles(filtered);
      setSelectedFiles(new Set());
    } catch (err) {
      // Don't show error toast for empty directory or no files found
      const errorMsg = err instanceof Error ? err.message : String(err || "");
      if (!errorMsg.toLowerCase().includes("empty") && !errorMsg.toLowerCase().includes("no file")) {
        toast.error("Failed to load files", {
          description: errorMsg || "Unknown error",
        });
      }
      setFiles([]);
      setSelectedFiles(new Set());
    } finally {
      setLoading(false);
    }
  }, [rootPath]);

  useEffect(() => {
    if (rootPath) {
      loadFiles();
    }
  }, [rootPath, loadFiles]);

  const filterAudioFiles = (nodes: FileNode[]): FileNode[] => {
    return nodes
      .map((node) => {
        if (node.is_dir && node.children) {
          const filteredChildren = filterAudioFiles(node.children);
          if (filteredChildren.length > 0) {
            return { ...node, children: filteredChildren };
          }
          return null;
        }
        const ext = node.name.toLowerCase();
        if (ext.endsWith(".flac") || ext.endsWith(".mp3") || ext.endsWith(".m4a")) {
          return node;
        }
        return null;
      })
      .filter((node): node is FileNode => node !== null);
  };

  const handleSelectFolder = async () => {
    try {
      const path = await SelectFolder(rootPath);
      if (path) {
        setRootPath(path);
      }
    } catch (err) {
      toast.error("Failed to select folder", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  const toggleExpand = (path: string) => {
    setFiles((prev) => toggleNodeExpand(prev, path));
  };

  const toggleNodeExpand = (nodes: FileNode[], path: string): FileNode[] => {
    return nodes.map((node) => {
      if (node.path === path) {
        return { ...node, expanded: !node.expanded };
      }
      if (node.children) {
        return { ...node, children: toggleNodeExpand(node.children, path) };
      }
      return node;
    });
  };

  const toggleSelect = (path: string, isDir: boolean) => {
    if (isDir) return;

    setSelectedFiles((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  };

  const toggleFolderSelect = (node: FileNode) => {
    const folderFiles = getAllAudioFiles([node]);
    const allSelected = folderFiles.every((f) => selectedFiles.has(f.path));
    
    setSelectedFiles((prev) => {
      const newSet = new Set(prev);
      if (allSelected) {
        // Deselect all files in folder
        folderFiles.forEach((f) => newSet.delete(f.path));
      } else {
        // Select all files in folder
        folderFiles.forEach((f) => newSet.add(f.path));
      }
      return newSet;
    });
  };

  const isFolderSelected = (node: FileNode): boolean | "indeterminate" => {
    const folderFiles = getAllAudioFiles([node]);
    if (folderFiles.length === 0) return false;
    const selectedCount = folderFiles.filter((f) => selectedFiles.has(f.path)).length;
    if (selectedCount === 0) return false;
    if (selectedCount === folderFiles.length) return true;
    return "indeterminate";
  };

  const selectAll = () => {
    const allAudioFiles = getAllAudioFiles(files);
    setSelectedFiles(new Set(allAudioFiles.map((f) => f.path)));
  };

  const deselectAll = () => {
    setSelectedFiles(new Set());
  };

  const getAllAudioFiles = (nodes: FileNode[]): FileNode[] => {
    const result: FileNode[] = [];
    for (const node of nodes) {
      if (!node.is_dir) {
        result.push(node);
      }
      if (node.children) {
        result.push(...getAllAudioFiles(node.children));
      }
    }
    return result;
  };

  const resetToDefault = () => {
    setFormatPreset(DEFAULT_PRESET);
    setCustomFormat(DEFAULT_CUSTOM_FORMAT);
    setShowResetConfirm(false);
  };

  const handlePreview = async (isPreviewOnly: boolean) => {
    if (selectedFiles.size === 0) {
      toast.error("No files selected");
      return;
    }

    // Check if any selected file is M4A and ffprobe is not installed
    const hasM4A = Array.from(selectedFiles).some(f => f.toLowerCase().endsWith(".m4a"));
    if (hasM4A) {
      const installed = await IsFFprobeInstalled();
      if (!installed) {
        setShowFFprobeDialog(true);
        return;
      }
    }

    try {
      const result = await PreviewRenameFiles(Array.from(selectedFiles), renameFormat);
      setPreviewData(result);
      setPreviewOnly(isPreviewOnly);
      setShowPreview(true);
    } catch (err) {
      toast.error("Failed to generate preview", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  const handleShowMetadata = async (filePath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    // Check if M4A file needs ffprobe
    if (filePath.toLowerCase().endsWith(".m4a")) {
      const installed = await IsFFprobeInstalled();
      if (!installed) {
        setShowFFprobeDialog(true);
        return;
      }
    }
    
    setMetadataFile(filePath);
    setLoadingMetadata(true);
    try {
      const metadata = await ReadFileMetadata(filePath);
      setMetadataInfo(metadata as FileMetadata);
      setShowMetadata(true);
    } catch (err) {
      toast.error("Failed to read metadata", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
      setMetadataInfo(null);
    } finally {
      setLoadingMetadata(false);
    }
  };

  const handleInstallFFprobe = async () => {
    setInstallingFFprobe(true);
    try {
      const result = await DownloadFFmpeg();
      if (result.success) {
        toast.success("FFprobe installed successfully");
        setShowFFprobeDialog(false);
      } else {
        toast.error("Failed to install FFprobe", {
          description: result.error || result.message,
        });
      }
    } catch (err) {
      toast.error("Failed to install FFprobe", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setInstallingFFprobe(false);
    }
  };

  const handleRename = async () => {
    if (selectedFiles.size === 0) return;

    setRenaming(true);
    try {
      const result = await RenameFilesByMetadata(Array.from(selectedFiles), renameFormat);
      const successCount = result.filter((r: backend.RenameResult) => r.success).length;
      const failCount = result.filter((r: backend.RenameResult) => !r.success).length;

      if (successCount > 0) {
        toast.success("Rename Complete", {
          description: `${successCount} file(s) renamed${failCount > 0 ? `, ${failCount} failed` : ""}`,
        });
      } else {
        toast.error("Rename Failed", {
          description: `All ${failCount} file(s) failed to rename`,
        });
      }

      setShowPreview(false);
      setSelectedFiles(new Set());
      loadFiles();
    } catch (err) {
      toast.error("Rename Failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setRenaming(false);
    }
  };

  const renderFileTree = (nodes: FileNode[], depth = 0) => {
    return nodes.map((node) => (
      <div key={node.path}>
        <div
          className={`flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50 cursor-pointer ${
            selectedFiles.has(node.path) ? "bg-primary/10" : ""
          }`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => (node.is_dir ? toggleExpand(node.path) : toggleSelect(node.path, node.is_dir))}
        >
          {node.is_dir ? (
            <>
              <Checkbox
                checked={isFolderSelected(node) === true}
                ref={(el) => {
                  if (el) {
                    (el as HTMLButtonElement).dataset.state = 
                      isFolderSelected(node) === "indeterminate" ? "indeterminate" : 
                      isFolderSelected(node) ? "checked" : "unchecked";
                  }
                }}
                onCheckedChange={() => toggleFolderSelect(node)}
                onClick={(e) => e.stopPropagation()}
                className="shrink-0 data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground"
              />
              {node.expanded ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <Folder className="h-4 w-4 text-yellow-500 shrink-0" />
            </>
          ) : (
            <>
              <Checkbox
                checked={selectedFiles.has(node.path)}
                onCheckedChange={() => toggleSelect(node.path, node.is_dir)}
                onClick={(e) => e.stopPropagation()}
                className="shrink-0"
              />
              <FileMusic className="h-4 w-4 text-primary shrink-0" />
            </>
          )}
          <span className="truncate text-sm flex-1">
            {node.name}
            {node.is_dir && <span className="text-muted-foreground ml-1">({getAllAudioFiles([node]).length})</span>}
          </span>
          {!node.is_dir && (
            <>
              <span className="text-xs text-muted-foreground shrink-0">{formatFileSize(node.size)}</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="p-1 rounded hover:bg-muted shrink-0"
                    onClick={(e) => handleShowMetadata(node.path, e)}
                  >
                    <Info className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>View Metadata</TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
        {node.is_dir && node.expanded && node.children && (
          <div>{renderFileTree(node.children, depth + 1)}</div>
        )}
      </div>
    ));
  };

  const allAudioFiles = getAllAudioFiles(files);
  const allSelected = allAudioFiles.length > 0 && selectedFiles.size === allAudioFiles.length;

  return (
    <div className={`space-y-6 ${isFullscreen ? "h-full flex flex-col" : ""}`}>
      <div className="flex items-center justify-between shrink-0">
        <h1 className="text-2xl font-bold">File Manager</h1>
      </div>

      {/* Path Selection */}
      <div className="flex items-center gap-2 shrink-0">
        <Input
          value={rootPath}
          onChange={(e) => setRootPath(e.target.value)}
          placeholder="Select a folder..."
          className="flex-1"
        />
        <Button onClick={handleSelectFolder}>
          <FolderOpen className="h-4 w-4" />
          Browse
        </Button>
        <Button variant="outline" onClick={loadFiles} disabled={loading || !rootPath}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Rename Format */}
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
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(FORMAT_PRESETS).map(([key, { label }]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {formatPreset === "custom" && (
            <Input
              value={customFormat}
              onChange={(e) => setCustomFormat(e.target.value)}
              placeholder="{artist} - {title}"
              className="flex-1"
            />
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

      {/* File Tree */}
      <div className={`border rounded-lg ${isFullscreen ? "flex-1 flex flex-col min-h-0" : ""}`}>
        <div className="flex items-center justify-between p-3 border-b bg-muted/30 shrink-0">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={allSelected ? deselectAll : selectAll}>
              {allSelected ? "Deselect All" : "Select All"}
            </Button>
            <span className="text-sm text-muted-foreground">
              {selectedFiles.size} of {allAudioFiles.length} file(s) selected
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePreview(true)}
              disabled={selectedFiles.size === 0 || loading}
            >
              <Eye className="h-4 w-4" />
              Preview
            </Button>
            <Button
              size="sm"
              onClick={() => handlePreview(false)}
              disabled={selectedFiles.size === 0 || loading}
            >
              <Pencil className="h-4 w-4" />
              Rename
            </Button>
          </div>
        </div>

        <div className={`overflow-y-auto p-2 ${isFullscreen ? "flex-1 min-h-0" : "max-h-[400px]"}`}>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner className="h-6 w-6" />
            </div>
          ) : files.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {rootPath ? "No audio files found" : "Select a folder to browse"}
            </div>
          ) : (
            renderFileTree(files)
          )}
        </div>
      </div>

      {/* Reset Confirmation Dialog */}
      <AlertDialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to Default?</AlertDialogTitle>
            <AlertDialogDescription>
              This will reset the rename format to "Title - Artist". Your custom format will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={resetToDefault}>Reset</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Preview Dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col [&>button]:hidden">
          <DialogHeader>
            <div className="flex items-center justify-between pr-2">
              <DialogTitle>Rename Preview</DialogTitle>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-full hover:bg-muted"
                onClick={() => setShowPreview(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <DialogDescription>
              Review the changes before renaming. Files with errors will be skipped.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-2 py-4">
            {previewData.map((item, index) => (
              <div
                key={index}
                className={`p-3 rounded-lg border ${item.error ? "border-destructive/50 bg-destructive/5" : "border-border"}`}
              >
                <div className="text-sm">
                  <div className="text-muted-foreground break-all">{item.old_name}</div>
                  {item.error ? (
                    <div className="text-destructive text-xs mt-1">{item.error}</div>
                  ) : (
                    <div className="text-primary font-medium break-all mt-1">→ {item.new_name}</div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <DialogFooter>
            {previewOnly ? (
              <Button onClick={() => setShowPreview(false)}>
                Close
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setShowPreview(false)}>
                  Cancel
                </Button>
                <Button onClick={handleRename} disabled={renaming}>
                  {renaming ? (
                    <>
                      <Spinner className="h-4 w-4" />
                      Renaming...
                    </>
                  ) : (
                    <>
                      <Pencil className="h-4 w-4" />
                      Rename {previewData.filter((p) => !p.error).length} File(s)
                    </>
                  )}
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
            <div className="flex items-center justify-between pr-2">
              <DialogTitle>File Metadata</DialogTitle>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-full hover:bg-muted"
                onClick={() => setShowMetadata(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <DialogDescription className="break-all">
              {metadataFile.split(/[/\\]/).pop()}
            </DialogDescription>
          </DialogHeader>

          {loadingMetadata ? (
            <div className="flex items-center justify-center py-8">
              <Spinner className="h-6 w-6" />
            </div>
          ) : metadataInfo ? (
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-[100px_1fr] gap-2 text-sm">
                <span className="text-muted-foreground">Title</span>
                <span>{metadataInfo.title || "-"}</span>
              </div>
              <div className="grid grid-cols-[100px_1fr] gap-2 text-sm">
                <span className="text-muted-foreground">Artist</span>
                <span>{metadataInfo.artist || "-"}</span>
              </div>
              <div className="grid grid-cols-[100px_1fr] gap-2 text-sm">
                <span className="text-muted-foreground">Album</span>
                <span>{metadataInfo.album || "-"}</span>
              </div>
              <div className="grid grid-cols-[100px_1fr] gap-2 text-sm">
                <span className="text-muted-foreground">Album Artist</span>
                <span>{metadataInfo.album_artist || "-"}</span>
              </div>
              <div className="grid grid-cols-[100px_1fr] gap-2 text-sm">
                <span className="text-muted-foreground">Track</span>
                <span>{metadataInfo.track_number || "-"}</span>
              </div>
              <div className="grid grid-cols-[100px_1fr] gap-2 text-sm">
                <span className="text-muted-foreground">Disc</span>
                <span>{metadataInfo.disc_number || "-"}</span>
              </div>
              <div className="grid grid-cols-[100px_1fr] gap-2 text-sm">
                <span className="text-muted-foreground">Year</span>
                <span>{metadataInfo.year ? metadataInfo.year.substring(0, 4) : "-"}</span>
              </div>
            </div>
          ) : (
            <div className="text-center py-4 text-muted-foreground">
              No metadata available
            </div>
          )}

          <DialogFooter>
            <Button onClick={() => setShowMetadata(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* FFprobe Install Dialog */}
      <Dialog open={showFFprobeDialog} onOpenChange={setShowFFprobeDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>FFprobe Required</DialogTitle>
            <DialogDescription>
              Reading M4A metadata requires FFprobe. Would you like to download and install it now?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFFprobeDialog(false)} disabled={installingFFprobe}>
              Cancel
            </Button>
            <Button onClick={handleInstallFFprobe} disabled={installingFFprobe}>
              {installingFFprobe ? (
                <>
                  <Spinner className="h-4 w-4" />
                  Installing...
                </>
              ) : (
                "Install FFprobe"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
