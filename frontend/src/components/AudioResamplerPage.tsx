import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Upload, X, CheckCircle2, AlertCircle, Trash2, FileMusic } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { SelectAudioFiles, SelectFolder, ListAudioFilesInDir, ResampleAudio } from "../../wailsjs/go/main/App";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { OnFileDrop, OnFileDropOff } from "../../wailsjs/runtime/runtime";
import { AudioLinesIcon } from "@/components/ui/audio-lines";

interface AudioFile {
    path: string;
    name: string;
    format: string;
    size: number;
    status: "pending" | "resampling" | "success" | "error";
    error?: string;
    outputPath?: string;
    srcSampleRate?: number;
    srcBitDepth?: number;
}

function formatFileSize(bytes: number): string {
    if (bytes === 0)
        return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatSampleRate(sr: number): string {
    if (!sr)
        return "";
    if (sr === 44100)
        return "44.1kHz";
    if (sr >= 1000)
        return `${sr / 1000}kHz`;
    return `${sr}Hz`;
}

const SAMPLE_RATE_OPTIONS = [
    { value: "44100", label: "44.1kHz" },
    { value: "48000", label: "48kHz" },
    { value: "96000", label: "96kHz" },
    { value: "192000", label: "192kHz" },
];

const BIT_DEPTH_OPTIONS = [
    { value: "16", label: "16-bit" },
    { value: "24", label: "24-bit" },
];

const STORAGE_KEY = "spotiflac_audio_resampler_state";

export function AudioResamplerPage() {
    const [files, setFiles] = useState<AudioFile[]>(() => {
        try {
            const saved = sessionStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed.files && Array.isArray(parsed.files) && parsed.files.length > 0) {
                    return parsed.files;
                }
            }
        }
        catch (err) {
            console.error("Failed to load saved state:", err);
        }
        return [];
    });
    const [sampleRate, setSampleRate] = useState(() => {
        try {
            const saved = sessionStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed.sampleRate)
                    return parsed.sampleRate;
            }
        }
        catch (err) {
        }
        return "44100";
    });
    const [bitDepth, setBitDepth] = useState(() => {
        try {
            const saved = sessionStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed.bitDepth)
                    return parsed.bitDepth;
            }
        }
        catch (err) {
        }
        return "16";
    });
    const [resampling, setResampling] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const saveState = useCallback((stateToSave: {
        files: AudioFile[];
        sampleRate: string;
        bitDepth: string;
    }) => {
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
        }
        catch (err) {
            console.error("Failed to save state:", err);
        }
    }, []);
    useEffect(() => {
        saveState({ files, sampleRate, bitDepth });
    }, [files, sampleRate, bitDepth, saveState]);
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
    const fetchAudioInfo = useCallback(async (paths: string[]) => {
        if (paths.length === 0)
            return;
        try {
            const GetFlacInfoBatch = (window as any)["go"]["main"]["App"]["GetFlacInfoBatch"];
            const infos: Array<{ path: string; sample_rate: number; bits_per_sample: number; }> =
                await GetFlacInfoBatch(paths);
            setFiles((prev) => prev.map((f) => {
                const info = infos.find((i) => i.path === f.path || i.path.toLowerCase() === f.path.toLowerCase());
                if (info) {
                    return {
                        ...f,
                        srcSampleRate: info.sample_rate || undefined,
                        srcBitDepth: info.bits_per_sample || undefined,
                    };
                }
                return f;
            }));
        }
        catch (err) {
            console.error("Failed to fetch audio info:", err);
        }
    }, []);
    const handleSelectFiles = async () => {
        try {
            const selectedFiles = await SelectAudioFiles();
            if (selectedFiles && selectedFiles.length > 0) {
                addFiles(selectedFiles);
            }
        }
        catch (err) {
            toast.error("File Selection Failed", {
                description: err instanceof Error ? err.message : "Failed to select files",
            });
        }
    };
    const handleSelectFolder = async () => {
        try {
            const selectedFolder = await SelectFolder("");
            if (selectedFolder) {
                const folderFiles = await ListAudioFilesInDir(selectedFolder);
                if (folderFiles && folderFiles.length > 0) {
                    addFiles(folderFiles.map((f) => f.path));
                }
                else {
                    toast.info("No audio files found", {
                        description: "No FLAC files found in the selected folder.",
                    });
                }
            }
        }
        catch (err) {
            toast.error("Folder Selection Failed", {
                description: err instanceof Error ? err.message : "Failed to select folder",
            });
        }
    };
    const addFiles = useCallback(async (paths: string[]) => {
        const validExtensions = [".flac"];
        const invalidFiles = paths.filter((path) => {
            const ext = path.toLowerCase().slice(path.lastIndexOf("."));
            return !validExtensions.includes(ext);
        });
        if (invalidFiles.length > 0) {
            toast.error("Unsupported format", {
                description: "Only FLAC files are supported for resampling.",
            });
        }
        const GetFileSizes = (files: string[]): Promise<Record<string, number>> => (window as any)["go"]["main"]["App"]["GetFileSizes"](files);
        const validPaths = paths.filter((path) => {
            const ext = path.toLowerCase().slice(path.lastIndexOf("."));
            return validExtensions.includes(ext);
        });
        const fileSizes = validPaths.length > 0 ? await GetFileSizes(validPaths) : {};
        let newlyAddedPaths: string[] = [];
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
            newlyAddedPaths = newFiles.map((f) => f.path);
            if (newFiles.length > 0) {
                if (paths.length > newFiles.length + invalidFiles.length) {
                    const skipped = paths.length - newFiles.length - invalidFiles.length;
                    toast.info("Some files skipped", {
                        description: `${skipped} file(s) were already added`,
                    });
                }
                return [...prev, ...newFiles];
            }
            if (validPaths.length > 0 && newFiles.length === 0) {
                toast.info("No new files added", {
                    description: "All valid files were already added",
                });
            }
            return prev;
        });
        setTimeout(() => {
            if (newlyAddedPaths.length > 0) {
                fetchAudioInfo(newlyAddedPaths);
            }
        }, 50);
    }, [fetchAudioInfo]);
    const handleFileDrop = useCallback(async (_x: number, _y: number, paths: string[]) => {
        setIsDragging(false);
        if (paths.length === 0)
            return;
        addFiles(paths);
    }, [addFiles]);
    useEffect(() => {
        OnFileDrop((x, y, paths) => {
            handleFileDrop(x, y, paths);
        }, true);
        return () => {
            OnFileDropOff();
        };
    }, [handleFileDrop]);
    const removeFile = (path: string) => {
        setFiles((prev) => prev.filter((f) => f.path !== path));
    };
    const clearFiles = () => {
        setFiles([]);
    };
    const handleResample = async () => {
        if (files.length === 0) {
            toast.error("No files selected", {
                description: "Please add FLAC files to resample",
            });
            return;
        }
        setResampling(true);
        try {
            const inputPaths = files.map((f) => f.path);
            setFiles((prev) => prev.map((f) => {
                if (inputPaths.includes(f.path)) {
                    return { ...f, status: "resampling" as const, error: undefined };
                }
                return f;
            }));
            const results = await ResampleAudio({
                input_files: inputPaths,
                sample_rate: sampleRate,
                bit_depth: bitDepth,
            });
            setFiles((prev) => prev.map((f) => {
                const result = results.find((r: any) => r.input_file === f.path || r.input_file.toLowerCase() === f.path.toLowerCase());
                if (result) {
                    return {
                        ...f,
                        status: result.success ? "success" : "error",
                        error: result.error,
                        outputPath: result.output_file,
                    };
                }
                return f;
            }));
            const successCount = results.filter((r: any) => r.success).length;
            const failCount = results.filter((r: any) => !r.success).length;
            if (successCount > 0) {
                toast.success("Resampling Complete", {
                    description: `Successfully resampled ${successCount} file(s)${failCount > 0 ? `, ${failCount} failed` : ""}`,
                });
            }
            else if (failCount > 0) {
                toast.error("Resampling Failed", {
                    description: `All ${failCount} file(s) failed to resample`,
                });
            }
        }
        catch (err) {
            toast.error("Resampling Error", {
                description: err instanceof Error ? err.message : "Unknown error",
            });
            setFiles((prev) => prev.map((f) => ({ ...f, status: "error" as const, error: "Resampling failed" })));
        }
        finally {
            setResampling(false);
        }
    };
    const getStatusIcon = (status: AudioFile["status"]) => {
        switch (status) {
            case "resampling":
                return <Spinner className="h-4 w-4 text-primary"/>;
            case "success":
                return <CheckCircle2 className="h-4 w-4 text-green-500"/>;
            case "error":
                return <AlertCircle className="h-4 w-4 text-destructive"/>;
            default:
                return <FileMusic className="h-4 w-4 text-muted-foreground"/>;
        }
    };
    const resampleableCount = files.filter((f) => f.status === "pending" || f.status === "success").length;
    const successCount = files.filter((f) => f.status === "success").length;
    return (<div className={`space-y-6 ${isFullscreen ? "h-full flex flex-col" : ""}`}>

        <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">Audio Resampler</h1>
            {files.length > 0 && (<div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleSelectFiles}>
                    <Upload className="h-4 w-4"/>
                    Add Files
                </Button>
                <Button variant="outline" size="sm" onClick={handleSelectFolder}>
                    <Upload className="h-4 w-4"/>
                    Add Folder
                </Button>
                <Button variant="outline" size="sm" onClick={clearFiles} disabled={resampling}>
                    <Trash2 className="h-4 w-4"/>
                    Clear All
                </Button>
            </div>)}
        </div>

        <div className={`flex flex-col items-center justify-center border-2 border-dashed rounded-lg transition-all ${isFullscreen ? "flex-1 min-h-[400px]" : "h-[400px]"} ${isDragging
            ? "border-primary bg-primary/10"
            : "border-muted-foreground/30"}`} onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
        }} onDragLeave={(e) => {
            e.preventDefault();
            setIsDragging(false);
        }} onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
        }} style={{ "--wails-drop-target": "drop" } as React.CSSProperties}>
            {files.length === 0 ? (<>
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                    <Upload className="h-8 w-8 text-primary"/>
                </div>
                <p className="text-sm text-muted-foreground mb-4 text-center">
                    {isDragging
                ? "Drop your audio files here"
                : "Drag and drop audio files here, or click the button below to select"}
                </p>
                <div className="flex gap-3">
                    <Button onClick={handleSelectFiles} size="lg">
                        <Upload className="h-5 w-5"/>
                        Select Files
                    </Button>
                    <Button onClick={handleSelectFolder} size="lg" variant="outline">
                        <Upload className="h-5 w-5"/>
                        Select Folder
                    </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-4 text-center">
                    Supported format: FLAC
                </p>
            </>) : (<div className="w-full h-full p-6 space-y-4 flex flex-col">
                <div className="space-y-2 pb-4 border-b shrink-0">
                    <div className="flex flex-wrap items-center gap-4">
                        <div className="flex items-center gap-2">
                            <Label className="whitespace-nowrap">Bit Depth:</Label>
                            <ToggleGroup type="single" variant="outline" value={bitDepth} onValueChange={(value) => {
                    if (value)
                        setBitDepth(value);
                }}>
                                {BIT_DEPTH_OPTIONS.map((option) => (<ToggleGroupItem key={option.value} value={option.value} aria-label={option.label}>
                                        {option.label}
                                    </ToggleGroupItem>))}
                            </ToggleGroup>
                        </div>

                        <div className="flex items-center gap-2">
                            <Label className="whitespace-nowrap">Sample Rate:</Label>
                            <ToggleGroup type="single" variant="outline" value={sampleRate} onValueChange={(value) => {
                    if (value)
                        setSampleRate(value);
                }}>
                                {SAMPLE_RATE_OPTIONS.map((option) => (<ToggleGroupItem key={option.value} value={option.value} aria-label={option.label}>
                                        {option.label}
                                    </ToggleGroupItem>))}
                            </ToggleGroup>
                        </div>
                    </div>
                </div>

                <div className="flex items-center justify-between shrink-0">
                    <div className="text-sm text-muted-foreground">
                        {files.length} file(s) • {successCount} resampled
                    </div>
                </div>

                <div className="flex-1 space-y-2 overflow-y-auto min-h-0">
                    {files.map((file) => {
            const srcParts: string[] = [];
            if (file.srcBitDepth)
                srcParts.push(`${file.srcBitDepth}-bit`);
            if (file.srcSampleRate)
                srcParts.push(formatSampleRate(file.srcSampleRate));
            const srcSpec = srcParts.join(" / ");
            return (<div key={file.path} className="flex items-center gap-3 rounded-lg border p-3">
                                    {getStatusIcon(file.status)}
                                    <div className="flex-1 min-w-0">
                                        <p className="truncate text-sm font-medium">{file.name}</p>
                                        {file.error && (<p className="truncate text-xs text-destructive">
                                                {file.error}
                                            </p>)}
                                    </div>

                                    {srcSpec ? (<span className="text-xs font-medium text-primary bg-primary/10 rounded px-1.5 py-0.5 whitespace-nowrap shrink-0">
                                            {srcSpec}
                                        </span>) : file.status === "pending" ? (<span className="text-xs text-muted-foreground/50 whitespace-nowrap shrink-0">
                                            reading...
                                        </span>) : null}

                                    <span className="text-xs text-muted-foreground shrink-0">
                                        {formatFileSize(file.size)}
                                    </span>
                                    <span className="text-xs uppercase text-muted-foreground shrink-0">
                                        {file.format}
                                    </span>
                                    {file.status !== "resampling" && (<Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeFile(file.path)} disabled={resampling}>
                                            <X className="h-4 w-4"/>
                                        </Button>)}
                                </div>);
        })}
                </div>

                <div className="flex justify-center pt-4 border-t shrink-0">
                    <Button onClick={handleResample} disabled={resampling || resampleableCount === 0} size="lg">
                        {resampling ? (<>
                                <Spinner className="h-4 w-4"/>
                                Resampling...
                            </>) : (<>
                                <AudioLinesIcon size={16} className="text-primary-foreground"/>
                                Resample{" "}
                                {resampleableCount > 0 ? `${resampleableCount} File(s)` : ""}
                            </>)}
                    </Button>
                </div>
            </div>)}
        </div>
    </div>);
}
