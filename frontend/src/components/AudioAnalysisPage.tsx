import { useState, useCallback, useRef, useEffect, type ChangeEvent, type CSSProperties, type DragEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Upload, ArrowLeft, Trash2, Download, FolderOpen, X, AlertCircle, CheckCircle2, FileMusic, ChevronDown, Play, StopCircle } from "lucide-react";
import { AudioAnalysis } from "@/components/AudioAnalysis";
import { SpectrumVisualization, createSpectrogramDataURL, type SpectrumVisualizationHandle } from "@/components/SpectrumVisualization";
import { useAudioAnalysis } from "@/hooks/useAudioAnalysis";
import type { AnalysisResult } from "@/types/api";
import { loadAudioAnalysisPreferences } from "@/lib/audio-analysis-preferences";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { GetFileSizes, ListAudioFilesInDir, SaveSpectrumImage, SelectAudioFiles, SelectFolder } from "../../wailsjs/go/main/App";
import { OnFileDrop, OnFileDropOff } from "../../wailsjs/runtime/runtime";

interface AudioAnalysisPageProps {
    onBack?: () => void;
}

type BatchItemStatus = "pending" | "analyzing" | "success" | "error";
type BatchItemSource = "path" | "browser";

interface BatchAnalysisItem {
    id: string;
    source: BatchItemSource;
    path: string;
    name: string;
    size: number;
    status: BatchItemStatus;
    error?: string;
    result?: AnalysisResult;
    file?: File;
}

interface QueueProgressState {
    completed: number;
    total: number;
    fileName: string;
}

const EMPTY_PROGRESS_STATE: QueueProgressState = {
    completed: 0,
    total: 0,
    fileName: "",
};

const SUPPORTED_AUDIO_EXTENSIONS = [".flac", ".mp3", ".m4a", ".aac"];
const SUPPORTED_AUDIO_ACCEPT = [
    ".flac",
    ".mp3",
    ".m4a",
    ".aac",
    "audio/flac",
    "audio/x-flac",
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/x-m4a",
    "audio/aac",
    "audio/aacp",
].join(",");
const SUPPORTED_AUDIO_LABEL = "FLAC, MP3, M4A, or AAC";
function isSupportedAudioPath(filePath: string): boolean {
    const normalized = filePath.toLowerCase();
    return SUPPORTED_AUDIO_EXTENSIONS.some((ext) => normalized.endsWith(ext));
}
function isSupportedAudioFile(file: File): boolean {
    const normalizedName = file.name.toLowerCase();
    const normalizedType = file.type.toLowerCase();
    return (SUPPORTED_AUDIO_EXTENSIONS.some((ext) => normalizedName.endsWith(ext)) ||
        normalizedType === "audio/flac" ||
        normalizedType === "audio/x-flac" ||
        normalizedType === "audio/mpeg" ||
        normalizedType === "audio/mp3" ||
        normalizedType === "audio/mp4" ||
        normalizedType === "audio/x-m4a" ||
        normalizedType === "audio/aac" ||
        normalizedType === "audio/aacp");
}
function isAbsolutePath(filePath: string): boolean {
    return /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(filePath);
}
function fileNameFromPath(filePath: string): string {
    const parts = filePath.split(/[/\\]/);
    return parts[parts.length - 1] || filePath;
}

function browserFileId(file: File): string {
    return `browser:${file.name}:${file.size}:${file.lastModified}`;
}

function downloadDataURL(dataUrl: string, fileName: string): void {
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function formatFileSize(bytes: number): string {
    if (bytes <= 0) {
        return "0 B";
    }

    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const index = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
    return `${parseFloat((bytes / Math.pow(k, index)).toFixed(1))} ${sizes[index]}`;
}

function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function itemMetaLine(item: BatchAnalysisItem): string {
    if (item.result) {
        const parts = [
            item.result.file_type ?? "Audio",
            `${(item.result.sample_rate / 1000).toFixed(1)} kHz`,
            formatDuration(item.result.duration),
        ];

        if (typeof item.result.bitrate_kbps === "number" && item.result.bitrate_kbps > 0) {
            parts.push(`${item.result.bitrate_kbps} kbps`);
        }

        return parts.join(" • ");
    }

    switch (item.status) {
        case "analyzing":
            return "Analyzing audio quality...";
        case "error":
            return item.error || "Analysis failed";
        case "pending":
        default:
            return "Waiting to be analyzed";
    }
}

function statusIcon(status: BatchItemStatus) {
    switch (status) {
        case "analyzing":
            return <Spinner className="h-4 w-4 text-primary" />;
        case "success":
            return <CheckCircle2 className="h-4 w-4 text-green-500" />;
        case "error":
            return <AlertCircle className="h-4 w-4 text-destructive" />;
        case "pending":
        default:
            return <FileMusic className="h-4 w-4 text-muted-foreground" />;
    }
}
export function AudioAnalysisPage({ onBack }: AudioAnalysisPageProps) {
    const {
        analysisProgress,
        spectrumLoading,
        spectrumProgress,
        analyzeFile,
        analyzeFilePath,
        cancelAnalysis,
        loadStoredAnalysis,
        clearStoredAnalysis,
        reAnalyzeSpectrum,
        clearResult,
    } = useAudioAnalysis();

    const [items, setItems] = useState<BatchAnalysisItem[]>([]);
    const [activeItemId, setActiveItemId] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isExportingSelected, setIsExportingSelected] = useState(false);
    const [isExportingBatch, setIsExportingBatch] = useState(false);
    const [isBatchRunning, setIsBatchRunning] = useState(false);
    const [batchProgress, setBatchProgress] = useState<QueueProgressState>(EMPTY_PROGRESS_STATE);
    const [exportProgress, setExportProgress] = useState<QueueProgressState>(EMPTY_PROGRESS_STATE);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const spectrumRef = useRef<SpectrumVisualizationHandle>(null);
    const batchRunIdRef = useRef(0);
    const itemsRef = useRef(items);
    const activeItemIdRef = useRef<string | null>(activeItemId);

    useEffect(() => {
        itemsRef.current = items;
    }, [items]);

    useEffect(() => {
        activeItemIdRef.current = activeItemId;
    }, [activeItemId]);

    const setActiveSelection = useCallback((nextId: string | null) => {
        activeItemIdRef.current = nextId;
        setActiveItemId(nextId);
    }, []);

    const activeItem = items.find((item) => item.id === activeItemId) ?? null;
    const successItems = items.filter((item) => item.status === "success" && item.result?.spectrum);
    const pendingItems = items.filter((item) => item.status === "pending");
    const isSingleMode = items.length === 1;
    const isBatchMode = items.length > 1;
    const canResumeBatch = isBatchMode && !isBatchRunning && pendingItems.length > 0;

    const batchPercent = batchProgress.total > 0
        ? Math.round(Math.max(0, Math.min(100, ((batchProgress.completed + (isBatchRunning ? analysisProgress.percent / 100 : 0)) / batchProgress.total) * 100)))
        : 0;
    const exportPercent = exportProgress.total > 0
        ? Math.round(Math.max(0, Math.min(100, (exportProgress.completed / exportProgress.total) * 100)))
        : 0;

    useEffect(() => {
        if (!activeItem?.result) {
            return;
        }

        loadStoredAnalysis(activeItem.id, activeItem.result, activeItem.path);
    }, [activeItem, loadStoredAnalysis]);

    const runBatchAnalysis = useCallback(async (entries: BatchAnalysisItem[]) => {
        if (entries.length === 0) {
            return;
        }

        const runId = batchRunIdRef.current + 1;
        batchRunIdRef.current = runId;
        setIsBatchRunning(true);
        setBatchProgress({
            completed: 0,
            total: entries.length,
            fileName: entries[0]?.name ?? "",
        });

        let successCount = 0;
        let failCount = 0;

        try {
            for (let index = 0; index < entries.length; index++) {
                if (batchRunIdRef.current !== runId) {
                    return;
                }

                const entry = entries[index];
                setBatchProgress({
                    completed: index,
                    total: entries.length,
                    fileName: entry.name,
                });

                setItems((prev) => prev.map((item) => item.id === entry.id
                    ? { ...item, status: "analyzing", error: undefined }
                    : item));

                const outcome = entry.source === "browser" && entry.file
                    ? await analyzeFile(entry.file, {
                        analysisKey: entry.id,
                        displayPath: entry.path,
                        suppressToast: true,
                    })
                    : await analyzeFilePath(entry.path, {
                        analysisKey: entry.id,
                        displayPath: entry.path,
                        suppressToast: true,
                    });

                if (batchRunIdRef.current !== runId) {
                    return;
                }

                if (outcome.cancelled) {
                    return;
                }

                if (outcome.result) {
                    const analysisResult = outcome.result;
                    successCount++;
                    setItems((prev) => prev.map((item) => item.id === entry.id
                        ? {
                            ...item,
                            status: "success",
                            error: undefined,
                            result: analysisResult,
                            size: analysisResult.file_size || item.size,
                        }
                        : item));

                    const hasSelectedSuccess = itemsRef.current.some((item) => item.id === activeItemIdRef.current && item.status === "success" && item.result);
                    if (!hasSelectedSuccess) {
                        setActiveSelection(entry.id);
                    }
                }
                else {
                    failCount++;
                    setItems((prev) => prev.map((item) => item.id === entry.id
                        ? {
                            ...item,
                            status: "error",
                            error: outcome.error || "Analysis failed",
                        }
                        : item));

                    if (!activeItemIdRef.current) {
                        setActiveSelection(entry.id);
                    }
                }
            }

            if (batchRunIdRef.current === runId) {
                setBatchProgress({
                    completed: entries.length,
                    total: entries.length,
                    fileName: "",
                });

                if (successCount > 0) {
                    toast.success("Batch Analysis Complete", {
                        description: `Successfully analyzed ${successCount} file(s)${failCount > 0 ? `, ${failCount} failed` : ""}`,
                    });
                }
                else if (failCount > 0) {
                    toast.error("Batch Analysis Failed", {
                        description: `All ${failCount} file(s) failed to analyze`,
                    });
                }
            }
        }
        finally {
            if (batchRunIdRef.current === runId) {
                setIsBatchRunning(false);
            }
        }
    }, [analyzeFile, analyzeFilePath, setActiveSelection]);

    const ensureIdleQueue = useCallback(() => {
        if (!isBatchRunning) {
            return true;
        }

        toast.info("Analysis in progress", {
            description: "Please wait for the current batch to finish or clear it first.",
        });
        return false;
    }, [isBatchRunning]);

    const addPathItems = useCallback(async (paths: string[]) => {
        if (!ensureIdleQueue()) {
            return;
        }

        const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
        const invalidCount = uniquePaths.filter((path) => !isSupportedAudioPath(path)).length;
        const validPaths = uniquePaths.filter(isSupportedAudioPath);

        if (invalidCount > 0) {
            toast.error("Unsupported format", {
                description: `Only ${SUPPORTED_AUDIO_LABEL} files can be analyzed.`,
            });
        }

        if (validPaths.length === 0) {
            return;
        }

        const existingIds = new Set(itemsRef.current.map((item) => item.id));
        const newPaths = validPaths.filter((path) => !existingIds.has(path));

        if (newPaths.length === 0) {
            toast.info("No new files added", {
                description: "All selected files were already in the batch queue.",
            });
            return;
        }

        const fileSizes = await GetFileSizes(newPaths);
        const newItems = newPaths.map((path) => ({
            id: path,
            source: "path" as const,
            path,
            name: fileNameFromPath(path),
            size: fileSizes[path] || 0,
            status: "pending" as const,
        }));

        if (validPaths.length !== newPaths.length) {
            toast.info("Some files skipped", {
                description: `${validPaths.length - newPaths.length} file(s) were already queued.`,
            });
        }

        setItems((prev) => [...prev, ...newItems]);
        if (!activeItemIdRef.current) {
            setActiveSelection(newItems[0]?.id ?? null);
        }

        void runBatchAnalysis(newItems);
    }, [ensureIdleQueue, runBatchAnalysis, setActiveSelection]);

    const addBrowserFiles = useCallback(async (files: File[]) => {
        if (!ensureIdleQueue()) {
            return;
        }

        const validFiles = files.filter(isSupportedAudioFile);
        const invalidCount = files.length - validFiles.length;

        if (invalidCount > 0) {
            toast.error("Unsupported format", {
                description: `Only ${SUPPORTED_AUDIO_LABEL} files can be analyzed.`,
            });
        }

        if (validFiles.length === 0) {
            return;
        }

        const existingIds = new Set(itemsRef.current.map((item) => item.id));
        const newItems = validFiles
            .map((file) => ({
                id: browserFileId(file),
                source: "browser" as const,
                path: file.name,
                name: file.name,
                size: file.size,
                status: "pending" as const,
                file,
            }))
            .filter((item) => !existingIds.has(item.id));

        if (newItems.length === 0) {
            toast.info("No new files added", {
                description: "All selected files were already in the batch queue.",
            });
            return;
        }

        if (validFiles.length !== newItems.length) {
            toast.info("Some files skipped", {
                description: `${validFiles.length - newItems.length} file(s) were already queued.`,
            });
        }

        setItems((prev) => [...prev, ...newItems]);
        if (!activeItemIdRef.current) {
            setActiveSelection(newItems[0]?.id ?? null);
        }

        void runBatchAnalysis(newItems);
    }, [ensureIdleQueue, runBatchAnalysis, setActiveSelection]);

    const handleSelectFiles = useCallback(async () => {
        if (!ensureIdleQueue()) {
            return;
        }

        try {
            const selectedPaths = await SelectAudioFiles();
            if (selectedPaths && selectedPaths.length > 0) {
                await addPathItems(selectedPaths);
            }
            return;
        }
        catch {
            fileInputRef.current?.click();
            return;
        }
    }, [addPathItems, ensureIdleQueue]);

    const handleSelectFolder = useCallback(async () => {
        if (!ensureIdleQueue()) {
            return;
        }

        try {
            const selectedFolder = await SelectFolder("");
            if (!selectedFolder) {
                return;
            }

            const folderFiles = await ListAudioFilesInDir(selectedFolder);
            if (!folderFiles || folderFiles.length === 0) {
                toast.info("No audio files found", {
                    description: `No ${SUPPORTED_AUDIO_LABEL} files were found in the selected folder.`,
                });
                return;
            }

            await addPathItems(folderFiles.map((file) => file.path));
        }
        catch (err) {
            toast.error("Folder Selection Failed", {
                description: err instanceof Error ? err.message : "Failed to select folder",
            });
        }
    }, [addPathItems, ensureIdleQueue]);

    const handleInputChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = "";

        if (files.length === 0) {
            return;
        }

        await addBrowserFiles(files);
    }, [addBrowserFiles]);

    const handleHtmlDrop = useCallback(async (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsDragging(false);

        const files = Array.from(event.dataTransfer.files ?? []);
        if (files.length === 0) {
            return;
        }

        await addBrowserFiles(files);
    }, [addBrowserFiles]);
    useEffect(() => {
        OnFileDrop((_x, _y, paths) => {
            setIsDragging(false);

            if (!paths || paths.length === 0) {
                return;
            }

            void addPathItems(paths);
        }, true);

        return () => {
            OnFileDropOff();
        };
    }, [addPathItems]);

    const handleSelectItem = useCallback((itemId: string) => {
        setActiveSelection(itemId);
    }, [setActiveSelection]);

    const handleRemoveItem = useCallback((itemId: string) => {
        if (isBatchRunning || isExportingBatch || isExportingSelected || spectrumLoading) {
            return;
        }

        clearStoredAnalysis(itemId);
        const nextItems = itemsRef.current.filter((item) => item.id !== itemId);
        itemsRef.current = nextItems;
        setItems(nextItems);

        if (activeItemIdRef.current === itemId) {
            const nextActive = nextItems.find((item) => item.status === "success" && item.result) ?? nextItems[0] ?? null;
            setActiveSelection(nextActive?.id ?? null);
            if (!nextActive) {
                clearResult();
            }
        }
    }, [clearResult, clearStoredAnalysis, isBatchRunning, isExportingBatch, isExportingSelected, setActiveSelection, spectrumLoading]);

    const handleClearAll = useCallback(() => {
        if (isExportingBatch || isExportingSelected) {
            return;
        }

        batchRunIdRef.current += 1;
        itemsRef.current = [];
        setItems([]);
        setActiveSelection(null);
        clearStoredAnalysis();
        clearResult();
        setIsBatchRunning(false);
        setBatchProgress(EMPTY_PROGRESS_STATE);
        setExportProgress(EMPTY_PROGRESS_STATE);
        setIsDragging(false);
    }, [clearResult, clearStoredAnalysis, isExportingBatch, isExportingSelected, setActiveSelection]);

    const handleStopBatch = useCallback(() => {
        if (!isBatchRunning) {
            return;
        }

        batchRunIdRef.current += 1;
        cancelAnalysis();
        setIsBatchRunning(false);
        setBatchProgress(EMPTY_PROGRESS_STATE);
        setItems((prev) => prev.map((item) => item.status === "analyzing"
            ? {
                ...item,
                status: "pending",
            }
            : item));
        toast.info("Batch analysis stopped", {
            description: "Click Analyze to continue the remaining files.",
        });
    }, [cancelAnalysis, isBatchRunning]);

    const handleAnalyzePending = useCallback(() => {
        if (isBatchRunning || isExportingBatch || isExportingSelected || spectrumLoading) {
            return;
        }

        const nextPendingItems = itemsRef.current.filter((item) => item.status === "pending");
        if (nextPendingItems.length === 0) {
            return;
        }

        void runBatchAnalysis(nextPendingItems);
    }, [isBatchRunning, isExportingBatch, isExportingSelected, runBatchAnalysis, spectrumLoading]);

    const handleExportSelected = useCallback(async () => {
        if (!activeItem?.result?.spectrum || !spectrumRef.current) {
            return;
        }

        const dataUrl = spectrumRef.current.getCanvasDataURL();
        if (!dataUrl) {
            toast.error("Export Failed", {
                description: "Cannot get canvas data",
            });
            return;
        }

        setIsExportingSelected(true);

        try {
            if (activeItem.source === "path" && isAbsolutePath(activeItem.path)) {
                const outPath = await SaveSpectrumImage(activeItem.path, dataUrl);
                toast.success("PNG Exported", {
                    description: `Saved to: ${outPath}`,
                });
                return;
            }

            const baseName = activeItem.name.replace(/\.[^/.]+$/, "") || "spectrogram";
            downloadDataURL(dataUrl, `${baseName}_spectrogram.png`);
            toast.success("PNG Exported", {
                description: "Spectrogram image downloaded",
            });
        }
        catch (err) {
            toast.error("Export Failed", {
                description: err instanceof Error ? err.message : "Failed to export image",
            });
        }
        finally {
            setIsExportingSelected(false);
        }
    }, [activeItem]);

    const handleBatchExport = useCallback(async () => {
        const exportableItems = itemsRef.current.filter((item) => item.status === "success" && item.result?.spectrum);

        if (exportableItems.length === 0) {
            toast.error("Nothing to export", {
                description: "Analyze at least one file successfully before exporting PNGs.",
            });
            return;
        }

        const preferences = loadAudioAnalysisPreferences();
        setIsExportingBatch(true);
        setExportProgress({
            completed: 0,
            total: exportableItems.length,
            fileName: exportableItems[0]?.name ?? "",
        });

        let successCount = 0;
        let failCount = 0;

        try {
            for (let index = 0; index < exportableItems.length; index++) {
                const item = exportableItems[index];
                const result = item.result;

                if (!result?.spectrum) {
                    failCount++;
                    continue;
                }

                setExportProgress({
                    completed: index,
                    total: exportableItems.length,
                    fileName: item.name,
                });

                try {
                    const dataUrl = await createSpectrogramDataURL({
                        spectrumData: result.spectrum,
                        sampleRate: result.sample_rate,
                        duration: result.duration,
                        freqScale: preferences.freqScale,
                        colorScheme: preferences.colorScheme,
                        fileName: item.name,
                    });

                    if (item.source === "path" && isAbsolutePath(item.path)) {
                        await SaveSpectrumImage(item.path, dataUrl);
                    }
                    else {
                        const baseName = item.name.replace(/\.[^/.]+$/, "") || "spectrogram";
                        downloadDataURL(dataUrl, `${baseName}_spectrogram.png`);
                    }

                    successCount++;
                }
                catch {
                    failCount++;
                }

                await new Promise((resolve) => setTimeout(resolve, 0));
            }

            setExportProgress({
                completed: exportableItems.length,
                total: exportableItems.length,
                fileName: "",
            });

            if (successCount > 0) {
                toast.success("Batch PNG Export Complete", {
                    description: `Exported ${successCount} spectrogram PNG file(s)${failCount > 0 ? `, ${failCount} failed` : ""}`,
                });
            }
            else {
                toast.error("Batch PNG Export Failed", {
                    description: "No spectrogram PNG files were exported.",
                });
            }
        }
        finally {
            setIsExportingBatch(false);
        }
    }, []);

    const handleReAnalyzeSelectedSpectrum = useCallback(async (fftSize: number, windowFunction: string) => {
        if (!activeItem?.result) {
            return;
        }

        const nextResult = await reAnalyzeSpectrum(fftSize, windowFunction);
        if (!nextResult) {
            return;
        }

        setItems((prev) => prev.map((item) => item.id === activeItem.id
            ? {
                ...item,
                result: nextResult,
                status: "success",
                error: undefined,
            }
            : item));
    }, [activeItem, reAnalyzeSpectrum]);

    const batchDetailContent = !activeItem ? (
        <Card>
            <CardContent className="flex min-h-[320px] items-center justify-center px-6 py-10">
                <p className="text-sm text-muted-foreground">
                    Select a file from the batch queue to inspect its analysis result.
                </p>
            </CardContent>
        </Card>
    ) : activeItem.status !== "success" || !activeItem.result ? (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="text-base">{activeItem.name}</CardTitle>
                <p className="break-all font-mono text-sm text-muted-foreground">{activeItem.path}</p>
            </CardHeader>
            <CardContent className="space-y-4">
                {activeItem.status === "analyzing" && (
                    <div className="space-y-3">
                        <div className="flex items-center gap-3">
                            <Spinner />
                            <span className="text-sm text-muted-foreground">Analyzing audio quality...</span>
                        </div>
                        <Progress value={analysisProgress.percent} className="h-2 w-full" />
                        <p className="text-xs text-muted-foreground">{analysisProgress.message}</p>
                    </div>
                )}
                {activeItem.status === "pending" && (
                    <p className="text-sm text-muted-foreground">
                        This file is queued and waiting for batch analysis to start.
                    </p>
                )}
                {activeItem.status === "error" && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                        {activeItem.error || "Analysis failed"}
                    </div>
                )}
            </CardContent>
        </Card>
    ) : (
        <div className="space-y-4">
            <AudioAnalysis
                result={activeItem.result}
                analyzing={false}
                showAnalyzeButton={false}
                filePath={activeItem.path}
            />

            <SpectrumVisualization
                ref={spectrumRef}
                sampleRate={activeItem.result.sample_rate}
                duration={activeItem.result.duration}
                spectrumData={activeItem.result.spectrum}
                fileName={activeItem.name}
                onReAnalyze={handleReAnalyzeSelectedSpectrum}
                isAnalyzingSpectrum={spectrumLoading}
                spectrumProgress={spectrumProgress}
            />
        </div>
    );

    const singleModeContent = !activeItem ? null : activeItem.status === "success" && activeItem.result ? (
        <div className="mx-auto w-full max-w-6xl space-y-4">
            <AudioAnalysis
                result={activeItem.result}
                analyzing={false}
                showAnalyzeButton={false}
                filePath={activeItem.path}
            />

            <SpectrumVisualization
                ref={spectrumRef}
                sampleRate={activeItem.result.sample_rate}
                duration={activeItem.result.duration}
                spectrumData={activeItem.result.spectrum}
                fileName={activeItem.name}
                onReAnalyze={handleReAnalyzeSelectedSpectrum}
                isAnalyzingSpectrum={spectrumLoading}
                spectrumProgress={spectrumProgress}
            />
        </div>
    ) : activeItem.status === "analyzing" || activeItem.status === "pending" ? (
        <div className="flex h-[400px] items-center justify-center">
            <div className="w-full max-w-md space-y-2">
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>{activeItem.status === "pending" ? "Preparing..." : "Processing..."}</span>
                    <span className="tabular-nums">{analysisProgress.percent}%</span>
                </div>
                <Progress value={analysisProgress.percent} className="h-2 w-full" />
                <p className="text-center text-xs text-muted-foreground">{analysisProgress.message}</p>
            </div>
        </div>
    ) : (
        <div className="flex h-[400px] items-center justify-center">
            <div className="w-full max-w-md rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                {activeItem.error || "Analysis failed"}
            </div>
        </div>
    );

    const showSingleModeActions = isSingleMode && activeItem?.status === "success" && activeItem.result;

    return (
        <div className="space-y-6">
            <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={SUPPORTED_AUDIO_ACCEPT}
                className="hidden"
                onChange={handleInputChange}
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-4">
                    {onBack && (
                        <Button variant="ghost" size="icon" onClick={onBack}>
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                    )}
                    <h1 className="text-2xl font-bold">Audio Quality Analyzer</h1>
                </div>

                <div className="flex flex-wrap gap-2">
                    {isBatchMode && isBatchRunning && (
                        <Button
                            onClick={handleStopBatch}
                            variant="destructive"
                            size="sm"
                            disabled={isExportingBatch || isExportingSelected}
                            className="gap-1.5"
                        >
                            <StopCircle className="h-4 w-4" />
                            Stop
                        </Button>
                    )}
                    {canResumeBatch && (
                        <Button
                            onClick={handleAnalyzePending}
                            variant="outline"
                            size="sm"
                            disabled={isExportingBatch || isExportingSelected || spectrumLoading}
                        >
                            <Play className="h-4 w-4" />
                            Analyze
                        </Button>
                    )}
                    {isBatchMode && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm" disabled={isBatchRunning || isExportingBatch || isExportingSelected}>
                                    <Upload className="h-4 w-4 mr-1" />
                                    Add
                                    <ChevronDown className="ml-1 h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-[180px]">
                                <DropdownMenuItem onClick={handleSelectFiles} className="cursor-pointer">
                                    <Upload className="h-4 w-4" />
                                    Add Files
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={handleSelectFolder} className="cursor-pointer">
                                    <FolderOpen className="h-4 w-4" />
                                    Add Folder
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                    {showSingleModeActions && (
                        <Button
                            onClick={handleExportSelected}
                            variant="outline"
                            size="sm"
                            disabled={isExportingSelected || spectrumLoading}
                        >
                            <Download className="h-4 w-4 mr-1" />
                            {isExportingSelected ? "Exporting..." : "Export PNG"}
                        </Button>
                    )}
                    {isBatchMode && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={successItems.length === 0 || isExportingBatch || isExportingSelected || isBatchRunning || spectrumLoading}
                                >
                                    <Download className="h-4 w-4 mr-1" />
                                    {isExportingBatch ? "Exporting..." : isExportingSelected ? "Exporting..." : "Export"}
                                    <ChevronDown className="ml-1 h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-[200px]">
                                <DropdownMenuItem onClick={handleExportSelected} className="cursor-pointer" disabled={!activeItem?.result?.spectrum}>
                                    <Download className="h-4 w-4" />
                                    Export Selected PNG
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={handleBatchExport} className="cursor-pointer" disabled={successItems.length === 0}>
                                    <Download className="h-4 w-4" />
                                    Export All PNG
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                    {showSingleModeActions && (
                        <Button
                            onClick={handleClearAll}
                            variant="outline"
                            size="sm"
                            disabled={isExportingSelected}
                        >
                            <Trash2 className="h-4 w-4 mr-1" />
                            Clear
                        </Button>
                    )}
                    {isBatchMode && (
                        <Button
                            onClick={handleClearAll}
                            variant="outline"
                            size="sm"
                            disabled={isExportingBatch || isExportingSelected}
                        >
                            <Trash2 className="h-4 w-4 mr-1" />
                            Clear
                        </Button>
                    )}
                </div>
            </div>

            {items.length === 0 && (
                <div
                    className={`flex h-[400px] flex-col items-center justify-center rounded-lg border-2 border-dashed transition-all ${
                        isDragging ? "border-primary bg-primary/10" : "border-muted-foreground/30"
                    }`}
                    onDragOver={(event) => {
                        event.preventDefault();
                        setIsDragging(true);
                    }}
                    onDragLeave={(event) => {
                        event.preventDefault();
                        setIsDragging(false);
                    }}
                    onDrop={handleHtmlDrop}
                    style={{ "--wails-drop-target": "drop" } as CSSProperties}
                >
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                        <Upload className="h-8 w-8 text-primary" />
                    </div>
                    <p className="text-sm text-muted-foreground mb-4 text-center">
                        {isDragging
                            ? "Drop your audio files here"
                            : "Drag and drop audio files here, or click the button below to select"}
                    </p>
                    <div className="flex gap-3">
                        <Button onClick={handleSelectFiles} size="lg">
                            <Upload className="h-5 w-5" />
                            Select Files
                        </Button>
                        <Button onClick={handleSelectFolder} size="lg" variant="outline">
                            <Upload className="h-5 w-5" />
                            Select Folder
                        </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-4 text-center">
                        Supported formats: FLAC, MP3, M4A, AAC
                    </p>
                </div>
            )}

            {isSingleMode && (
                <div className="space-y-4">
                    {singleModeContent}
                </div>
            )}

            {isBatchMode && (
                <div className="grid gap-4 xl:grid-cols-[360px,minmax(0,1fr)]">
                    <div className="space-y-3">
                        {(isBatchRunning || isExportingBatch) && (
                            <Card className="gap-2 py-4">
                                <CardHeader className="px-4 pb-0">
                                    <CardTitle className="text-sm">
                                        {isExportingBatch ? "Batch PNG Export" : "Batch Analysis"}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-2 px-4">
                                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                                        <span className="truncate pr-3">
                                            {isExportingBatch
                                                ? exportProgress.fileName || "Preparing export..."
                                                : batchProgress.fileName || analysisProgress.message}
                                        </span>
                                        <span className="tabular-nums">
                                            {isExportingBatch
                                                ? `${exportProgress.completed}/${exportProgress.total}`
                                                : `${Math.min(batchProgress.completed + (isBatchRunning ? 1 : 0), batchProgress.total)}/${batchProgress.total}`}
                                        </span>
                                    </div>
                                    <Progress value={isExportingBatch ? exportPercent : batchPercent} className="h-1.5 w-full" />
                                    {!isExportingBatch && (
                                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                                            <span>{analysisProgress.message}</span>
                                            <span className="tabular-nums">{analysisProgress.percent}%</span>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        )}

                        <Card className="gap-2 overflow-hidden py-4">
                            <CardHeader className="px-4 pb-0">
                                <div className="flex items-center justify-between gap-3">
                                    <CardTitle className="text-sm">Batch Queue</CardTitle>
                                    <p className="text-xs text-muted-foreground">
                                        {items.length} queued • {successItems.length} ready
                                    </p>
                                </div>
                            </CardHeader>
                            <CardContent className="px-4">
                                <div className="max-h-[232px] space-y-2 overflow-y-auto pr-1">
                                    {items.map((item) => {
                                        const isActive = item.id === activeItemId;
                                        const isSelectable = item.status !== "pending";
                                        return (
                                            <div
                                                key={item.id}
                                                role={isSelectable ? "button" : undefined}
                                                tabIndex={isSelectable ? 0 : -1}
                                                className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                                                    isActive
                                                        ? "border-primary bg-primary/5"
                                                        : isSelectable
                                                            ? "border-border hover:border-primary/40"
                                                            : "border-border"
                                                }`}
                                                onClick={() => {
                                                    if (!isSelectable) {
                                                        return;
                                                    }
                                                    handleSelectItem(item.id);
                                                }}
                                                onKeyDown={(event) => {
                                                    if (!isSelectable) {
                                                        return;
                                                    }
                                                    if (event.key === "Enter" || event.key === " ") {
                                                        event.preventDefault();
                                                        handleSelectItem(item.id);
                                                    }
                                                }}
                                            >
                                                <div className="mt-0.5 shrink-0">{statusIcon(item.status)}</div>
                                                <div className="min-w-0 flex-1">
                                                    <p className="truncate text-sm font-medium">{item.name}</p>
                                                    <p className={`truncate text-xs ${item.status === "error" ? "text-destructive" : "text-muted-foreground"}`}>
                                                        {itemMetaLine(item)}
                                                    </p>
                                                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                                        <span>{formatFileSize(item.size)}</span>
                                                        <span>{fileNameFromPath(item.path).split(".").pop()?.toUpperCase() || "AUDIO"}</span>
                                                    </div>
                                                </div>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 shrink-0"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        handleRemoveItem(item.id);
                                                    }}
                                                    disabled={isBatchRunning || isExportingBatch || isExportingSelected || spectrumLoading}
                                                >
                                                    <X className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="space-y-4">
                        {batchDetailContent}
                    </div>
                </div>
            )}
        </div>
    );
}
