import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import {
  Upload,
  Download,
  X,
  CheckCircle2,
  AlertCircle,
  Trash2,
  FileMusic,
  WandSparkles,
} from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import {
  IsFFmpegInstalled,
  DownloadFFmpeg,
  ConvertAudio,
  SelectAudioFiles,
} from "../../wailsjs/go/main/App";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { OnFileDrop, OnFileDropOff } from "../../wailsjs/runtime/runtime";

interface AudioFile {
  path: string;
  name: string;
  format: string;
  size: number;
  status: "pending" | "converting" | "success" | "error";
  error?: string;
  outputPath?: string;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

const BITRATE_OPTIONS = [
  { value: "320k", label: "320k" },
  { value: "256k", label: "256k" },
  { value: "192k", label: "192k" },
  { value: "128k", label: "128k" },
];

const M4A_CODEC_OPTIONS = [
  { value: "aac", label: "AAC" },
  { value: "alac", label: "ALAC" },
];

const STORAGE_KEY = "spotiflac_audio_converter_state";

export function AudioConverterPage() {
  const [ffmpegInstalled, setFfmpegInstalled] = useState<boolean>(false);
  const [installingFfmpeg, setInstallingFfmpeg] = useState(false);
  const [files, setFiles] = useState<AudioFile[]>(() => {
    // Initialize from sessionStorage synchronously
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.files && Array.isArray(parsed.files) && parsed.files.length > 0) {
          return parsed.files;
        }
      }
    } catch (err) {
      console.error("Failed to load saved state:", err);
    }
    return [];
  });
  const [outputFormat, setOutputFormat] = useState<"mp3" | "m4a">(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.outputFormat === "mp3" || parsed.outputFormat === "m4a") {
          return parsed.outputFormat;
        }
      }
    } catch (err) {
      // Ignore
    }
    return "mp3";
  });
  const [bitrate, setBitrate] = useState(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.bitrate) {
          return parsed.bitrate;
        }
      }
    } catch (err) {
      // Ignore
    }
    return "320k";
  });
  const [m4aCodec, setM4aCodec] = useState<"aac" | "alac">(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.m4aCodec === "aac" || parsed.m4aCodec === "alac") {
          return parsed.m4aCodec;
        }
      }
    } catch (err) {
      // Ignore
    }
    return "aac";
  });
  const [converting, setConverting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Helper function to save state to sessionStorage
  const saveState = useCallback((stateToSave: { files: AudioFile[]; outputFormat: "mp3" | "m4a"; bitrate: string; m4aCodec: "aac" | "alac" }) => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
    } catch (err) {
      console.error("Failed to save state:", err);
    }
  }, []);

  // Load saved state from sessionStorage on mount (only for ffmpeg check)
  useEffect(() => {
    checkFfmpegInstallation();
  }, []);

  // Save state to sessionStorage whenever files, outputFormat, bitrate, or m4aCodec changes
  useEffect(() => {
    saveState({ files, outputFormat, bitrate, m4aCodec });
  }, [files, outputFormat, bitrate, m4aCodec, saveState]);

  // Auto-set output format to M4A if all files are MP3
  useEffect(() => {
    if (files.length === 0) return;
    
    const allMP3 = files.every((f) => f.format === "mp3");
    if (allMP3 && outputFormat !== "m4a") {
      setOutputFormat("m4a");
    }
    
    // Reset to AAC if no FLAC files (ALAC doesn't make sense for lossy input)
    const hasFlac = files.some((f) => f.format === "flac");
    if (!hasFlac && m4aCodec === "alac") {
      setM4aCodec("aac");
    }
  }, [files, outputFormat, m4aCodec]);

  // Check if format selection should be disabled (all files are MP3)
  const isFormatDisabled = files.length > 0 && files.every((f) => f.format === "mp3");
  
  // Check if any file is FLAC (ALAC only makes sense for lossless input)
  const hasFlacFiles = files.some((f) => f.format === "flac");

  // Detect fullscreen/maximized window
  useEffect(() => {
    const checkFullscreen = () => {
      // Check if window is maximized or fullscreen
      // For Wails, we can check if window height is close to screen height
      const isMaximized = window.innerHeight >= window.screen.height * 0.9;
      setIsFullscreen(isMaximized);
    };

    checkFullscreen();
    window.addEventListener("resize", checkFullscreen);
    
    // Also check on window focus in case user maximizes externally
    window.addEventListener("focus", checkFullscreen);

    return () => {
      window.removeEventListener("resize", checkFullscreen);
      window.removeEventListener("focus", checkFullscreen);
    };
  }, []);

  const checkFfmpegInstallation = async () => {
    try {
      const installed = await IsFFmpegInstalled();
      setFfmpegInstalled(installed);
    } catch (err) {
      console.error("Failed to check ffmpeg:", err);
      setFfmpegInstalled(false);
    }
  };

  const handleInstallFfmpeg = async () => {
    setInstallingFfmpeg(true);
    try {
      const result = await DownloadFFmpeg();
      if (result.success) {
        toast.success("FFmpeg Installed", {
          description: "FFmpeg has been installed successfully",
        });
        setFfmpegInstalled(true);
      } else {
        toast.error("Installation Failed", {
          description: result.error || "Failed to install FFmpeg",
        });
      }
    } catch (err) {
      toast.error("Installation Failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setInstallingFfmpeg(false);
    }
  };

  const handleSelectFiles = async () => {
    try {
      const selectedFiles = await SelectAudioFiles();
      if (selectedFiles && selectedFiles.length > 0) {
        addFiles(selectedFiles);
      }
    } catch (err) {
      toast.error("File Selection Failed", {
        description: err instanceof Error ? err.message : "Failed to select files",
      });
    }
  };

  const addFiles = useCallback(async (paths: string[]) => {
    const validExtensions = [".mp3", ".flac"];
    
    // Check for M4A files specifically
    const m4aFiles = paths.filter((path) => {
      const ext = path.toLowerCase().slice(path.lastIndexOf("."));
      return ext === ".m4a";
    });

    if (m4aFiles.length > 0) {
      toast.error("M4A files not supported", {
        description: "Only FLAC and MP3 files are supported as input. Please convert M4A files first.",
      });
    }

    // Get file sizes from backend
    const GetFileSizes = (files: string[]): Promise<Record<string, number>> =>
      (window as any)["go"]["main"]["App"]["GetFileSizes"](files);
    
    const validPaths = paths.filter((path) => {
      const ext = path.toLowerCase().slice(path.lastIndexOf("."));
      return validExtensions.includes(ext);
    });

    const fileSizes = validPaths.length > 0 ? await GetFileSizes(validPaths) : {};

    setFiles((prev) => {
      const newFiles: AudioFile[] = validPaths
        .filter((path) => !prev.some((f) => f.path === path))
        .map((path) => {
          const name = path.split(/[/\\]/).pop() || path;
          const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
          return {
            path,
            name,
            format: ext,
            size: fileSizes[path] || 0,
            status: "pending" as const,
          };
        });

      if (newFiles.length > 0) {
        if (paths.length > newFiles.length) {
          const skipped = paths.length - newFiles.length;
          toast.info("Some files skipped", {
            description: `${skipped} file(s) were skipped (unsupported format or already added)`,
          });
        }

        return [...prev, ...newFiles];
      }

      if (paths.length > 0 && m4aFiles.length === 0) {
        toast.info("No new files added", {
          description: "All files were already added or have unsupported format",
        });
      }

      return prev;
    });
  }, []);

  const handleFileDrop = useCallback(
    async (_x: number, _y: number, paths: string[]) => {
      setIsDragging(false);

      if (paths.length === 0) return;

      addFiles(paths);
    },
    [addFiles]
  );

  useEffect(() => {
    // Only enable drag and drop for audio files if FFmpeg is installed
    if (ffmpegInstalled === true) {
      OnFileDrop((x, y, paths) => {
        handleFileDrop(x, y, paths);
      }, true);

      return () => {
        OnFileDropOff();
      };
    }
  }, [handleFileDrop, ffmpegInstalled]);


  const removeFile = (path: string) => {
    setFiles((prev) => prev.filter((f) => f.path !== path));
  };

  const clearFiles = () => {
    setFiles([]);
  };

  const handleConvert = async () => {
    if (files.length === 0) {
      toast.error("No files selected", {
        description: "Please add audio files to convert",
      });
      return;
    }

    setConverting(true);

    try {
      // Include all files (including previously successful ones) for conversion
      const inputPaths = files.map((f) => f.path);

      // Mark all files as converting (including previously successful ones)
      setFiles((prev) =>
        prev.map((f) => {
          if (inputPaths.includes(f.path)) {
            return { ...f, status: "converting" as const, error: undefined };
          }
          return f;
        })
      );

      const results = await ConvertAudio({
        input_files: inputPaths,
        output_format: outputFormat,
        bitrate: bitrate,
        codec: outputFormat === "m4a" ? m4aCodec : "",
      });

      // Update file statuses based on results
      setFiles((prev) =>
        prev.map((f) => {
          const result = results.find((r) => r.input_file === f.path);
          if (result) {
            return {
              ...f,
              status: result.success ? "success" : "error",
              error: result.error,
              outputPath: result.output_file,
            };
          }
          return f;
        })
      );

      const successCount = results.filter((r) => r.success).length;
      const failCount = results.filter((r) => !r.success).length;

      if (successCount > 0) {
        toast.success("Conversion Complete", {
          description: `Successfully converted ${successCount} file(s)${failCount > 0 ? `, ${failCount} failed` : ""}`,
        });
      } else if (failCount > 0) {
        toast.error("Conversion Failed", {
          description: `All ${failCount} file(s) failed to convert`,
        });
      }
    } catch (err) {
      toast.error("Conversion Error", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
      setFiles((prev) =>
        prev.map((f) => ({ ...f, status: "error" as const, error: "Conversion failed" }))
      );
    } finally {
      setConverting(false);
    }
  };

  const getStatusIcon = (status: AudioFile["status"]) => {
    switch (status) {
      case "converting":
        return <Spinner className="h-4 w-4 text-primary" />;
      case "success":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "error":
        return <AlertCircle className="h-4 w-4 text-destructive" />;
      default:
        return <FileMusic className="h-4 w-4 text-muted-foreground" />;
    }
  };

  // Count files that can be converted (pending + success files that can be re-converted)
  const convertableCount = files.filter((f) => f.status === "pending" || f.status === "success").length;
  const successCount = files.filter((f) => f.status === "success").length;

  // Show FFmpeg installation prompt if not installed
  if (ffmpegInstalled === false) {
    return (
      <div className={`space-y-6 ${isFullscreen ? "h-full flex flex-col" : ""}`}>
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">Audio Converter</h1>
        </div>

        <div
          className={`flex flex-col items-center justify-center border-2 border-dashed rounded-lg transition-all ${
            isFullscreen ? "flex-1 min-h-[400px]" : "h-[400px]"
          } border-muted-foreground/30`}
        >
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Download className="h-8 w-8 text-primary" />
          </div>
          <p className="text-sm text-muted-foreground mb-4 text-center">
            FFmpeg is required to convert audio files
          </p>
          <Button
            onClick={handleInstallFfmpeg}
            disabled={installingFfmpeg}
            size="lg"
          >
            {installingFfmpeg ? (
              <>
                <Spinner className="h-5 w-5" />
                Installing FFmpeg...
              </>
            ) : (
              <>
                <Download className="h-5 w-5" />
                Install FFmpeg
              </>
            )}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${isFullscreen ? "h-full flex flex-col" : ""}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Audio Converter</h1>
        {files.length > 0 && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleSelectFiles}>
              <Upload className="h-4 w-4" />
              Add More
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={clearFiles}
              disabled={converting}
            >
              <Trash2 className="h-4 w-4" />
              Clear All
            </Button>
          </div>
        )}
      </div>

      {/* Drop Zone / File List */}
      <div
        className={`flex flex-col items-center justify-center border-2 border-dashed rounded-lg transition-all ${
          isFullscreen ? "flex-1 min-h-[400px]" : "h-[400px]"
        } ${
          isDragging
            ? "border-primary bg-primary/10"
            : "border-muted-foreground/30"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setIsDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
        }}
        style={{ "--wails-drop-target": "drop" } as React.CSSProperties}
      >
        {files.length === 0 ? (
          <>
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Upload className="h-8 w-8 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground mb-4 text-center">
              {isDragging
                ? "Drop your audio files here"
                : "Drag and drop audio files here, or click the button below to select"}
            </p>
            <Button onClick={handleSelectFiles} size="lg">
              <Upload className="h-5 w-5" />
              Select Files
            </Button>
            <p className="text-xs text-muted-foreground mt-4 text-center">
              Supported formats: FLAC, MP3
            </p>
          </>
        ) : (
          <div className="w-full h-full p-6 space-y-4 flex flex-col">
            {/* Settings Row - Only show when files exist */}
            <div className="space-y-2 pb-4 border-b shrink-0">
                {/* Format and Bitrate in one line */}
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Label className="whitespace-nowrap">Format:</Label>
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      value={outputFormat}
                      onValueChange={(value) => {
                        if (value && !isFormatDisabled) setOutputFormat(value as "mp3" | "m4a");
                      }}
                      disabled={isFormatDisabled}
                    >
                      {!isFormatDisabled && (
                        <ToggleGroupItem value="mp3" aria-label="MP3">
                          MP3
                        </ToggleGroupItem>
                      )}
                      <ToggleGroupItem value="m4a" aria-label="M4A" disabled={isFormatDisabled}>
                        M4A
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                  {/* Codec selection for M4A - only show ALAC option when input has FLAC files */}
                  {outputFormat === "m4a" && hasFlacFiles && (
                    <div className="flex items-center gap-2">
                      <Label className="whitespace-nowrap">Codec:</Label>
                      <ToggleGroup
                        type="single"
                        variant="outline"
                        value={m4aCodec}
                        onValueChange={(value) => {
                          if (value) setM4aCodec(value as "aac" | "alac");
                        }}
                      >
                        {M4A_CODEC_OPTIONS.map((option) => (
                          <ToggleGroupItem
                            key={option.value}
                            value={option.value}
                            aria-label={option.label}
                          >
                            {option.label}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    </div>
                  )}
                  {/* Bitrate selection - hide for ALAC (lossless) */}
                  {!(outputFormat === "m4a" && m4aCodec === "alac") && (
                    <div className="flex items-center gap-2">
                      <Label className="whitespace-nowrap">Bitrate:</Label>
                      <ToggleGroup
                        type="single"
                        variant="outline"
                        value={bitrate}
                        onValueChange={(value) => {
                          if (value) setBitrate(value);
                        }}
                      >
                        {BITRATE_OPTIONS.map((option) => (
                          <ToggleGroupItem
                            key={option.value}
                            value={option.value}
                            aria-label={option.label}
                          >
                            {option.label}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    </div>
                  )}
                </div>
              </div>

              {/* File List Header */}
              <div className="flex items-center justify-between shrink-0">
                <div className="text-sm text-muted-foreground">
                  {files.length} file(s) • {successCount} converted
                </div>
              </div>

              {/* File List */}
              <div className="flex-1 space-y-2 overflow-y-auto min-h-0">
              {files.map((file) => (
                <div
                  key={file.path}
                  className="flex items-center gap-3 rounded-lg border p-3"
                >
                  {getStatusIcon(file.status)}
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium">{file.name}</p>
                    {file.error && (
                      <p className="truncate text-xs text-destructive">
                        {file.error}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatFileSize(file.size)}
                  </span>
                  <span className="text-xs uppercase text-muted-foreground">
                    {file.format}
                  </span>
                  {file.status !== "converting" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => removeFile(file.path)}
                      disabled={converting}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>

              {/* Convert Button */}
              <div className="flex justify-center pt-4 border-t shrink-0">
                <Button
                  onClick={handleConvert}
                  disabled={converting || convertableCount === 0}
                  size="lg"
                >
                {converting ? (
                  <>
                    <Spinner className="h-4 w-4" />
                    Converting...
                  </>
                ) : (
                  <>
                    <WandSparkles className="h-4 w-4" />
                    Convert {convertableCount > 0 ? `${convertableCount} File(s)` : ""}
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}



