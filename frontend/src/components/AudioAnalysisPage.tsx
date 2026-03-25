import { useState, useCallback, useRef, useEffect, type ChangeEvent, type DragEvent, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Upload, ArrowLeft, Trash2, Download } from "lucide-react";
import { AudioAnalysis } from "@/components/AudioAnalysis";
import { SpectrumVisualization } from "@/components/SpectrumVisualization";
import { useAudioAnalysis } from "@/hooks/useAudioAnalysis";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { SelectFile, SaveSpectrumImage } from "../../wailsjs/go/main/App";
import { OnFileDrop, OnFileDropOff } from "../../wailsjs/runtime/runtime";
interface AudioAnalysisPageProps {
    onBack?: () => void;
}
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
export function AudioAnalysisPage({ onBack }: AudioAnalysisPageProps) {
    const { analyzing, analysisProgress, result, analyzeFile, analyzeFilePath, clearResult, selectedFilePath, spectrumLoading, spectrumProgress, reAnalyzeSpectrum, } = useAudioAnalysis();
    const [isDragging, setIsDragging] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const spectrumRef = useRef<{
        getCanvasDataURL: () => string | null;
    }>(null);
    const analyzeSelectedPath = useCallback(async (filePath: string) => {
        if (!isSupportedAudioPath(filePath)) {
            toast.error("Invalid File Type", {
                description: `Please select a ${SUPPORTED_AUDIO_LABEL} file for analysis`,
            });
            return;
        }
        await analyzeFilePath(filePath);
    }, [analyzeFilePath]);
    const analyzeSelectedFile = useCallback(async (file: File) => {
        if (!isSupportedAudioFile(file)) {
            toast.error("Invalid File Type", {
                description: `Please select a ${SUPPORTED_AUDIO_LABEL} file for analysis`,
            });
            return;
        }
        await analyzeFile(file);
    }, [analyzeFile]);
    const handleSelectFile = useCallback(async () => {
        try {
            const filePath = await SelectFile();
            if (!filePath) {
                return;
            }
            await analyzeSelectedPath(filePath);
        }
        catch {
            fileInputRef.current?.click();
        }
    }, [analyzeSelectedPath]);
    const handleInputChange = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file)
            return;
        await analyzeSelectedFile(file);
        e.target.value = "";
    }, [analyzeSelectedFile]);
    const handleHtmlDrop = useCallback(async (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (!file)
            return;
        await analyzeSelectedFile(file);
    }, [analyzeSelectedFile]);
    useEffect(() => {
        OnFileDrop((_x, _y, paths) => {
            setIsDragging(false);
            const droppedPath = paths?.[0];
            if (!droppedPath)
                return;
            void analyzeSelectedPath(droppedPath);
        }, true);
        return () => {
            OnFileDropOff();
        };
    }, [analyzeSelectedPath]);
    const handleExport = useCallback(async () => {
        if (!spectrumRef.current)
            return;
        const dataUrl = spectrumRef.current.getCanvasDataURL();
        if (!dataUrl) {
            toast.error("Export Failed", { description: "Cannot get canvas data" });
            return;
        }
        setIsExporting(true);
        try {
            if (selectedFilePath && isAbsolutePath(selectedFilePath)) {
                const outPath = await SaveSpectrumImage(selectedFilePath, dataUrl);
                toast.success("Exported Successfully", {
                    description: `Saved to: ${outPath}`,
                });
                return;
            }
            const base = selectedFilePath
                ? fileNameFromPath(selectedFilePath).replace(/\.[^/.]+$/, "")
                : "spectrogram";
            const a = document.createElement("a");
            a.href = dataUrl;
            a.download = `${base}_spectrogram.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            toast.success("Exported Successfully", {
                description: "Spectrogram image downloaded",
            });
        }
        catch (err) {
            toast.error("Export Failed", {
                description: err instanceof Error ? err.message : "Failed to export image",
            });
        }
        finally {
            setIsExporting(false);
        }
    }, [selectedFilePath]);
    const handleAnalyzeAnother = () => {
        clearResult();
    };
    const fileName = selectedFilePath ? fileNameFromPath(selectedFilePath) : undefined;
    return (<div className="space-y-6">
            <input ref={fileInputRef} type="file" accept={SUPPORTED_AUDIO_ACCEPT} className="hidden" onChange={handleInputChange}/>

            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    {onBack && (<Button variant="ghost" size="icon" onClick={onBack}>
                            <ArrowLeft className="h-5 w-5"/>
                        </Button>)}
                    <h1 className="text-2xl font-bold">Audio Quality Analyzer</h1>
                </div>
                {result && (<div className="flex gap-2">
                        <Button onClick={handleExport} variant="outline" size="sm" disabled={isExporting || spectrumLoading}>
                            <Download className="h-4 w-4 mr-1"/>
                            {isExporting ? "Exporting..." : "Export PNG"}
                        </Button>
                        <Button onClick={handleAnalyzeAnother} variant="outline" size="sm">
                            <Trash2 className="h-4 w-4 mr-1"/>
                            Clear
                        </Button>
                    </div>)}
            </div>

            {!result && !analyzing && (<div className={`flex flex-col items-center justify-center h-[400px] border-2 border-dashed rounded-lg transition-colors ${isDragging
                ? "border-primary bg-primary/10"
                : "border-muted-foreground/30"}`} onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
            }} onDragLeave={(e) => {
                e.preventDefault();
                setIsDragging(false);
            }} onDrop={handleHtmlDrop} style={{ "--wails-drop-target": "drop" } as CSSProperties}>
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                        <Upload className="h-8 w-8 text-primary"/>
                    </div>
                    <p className="text-sm text-muted-foreground mb-4 text-center">
                        {isDragging
                ? "Drop your audio file here"
                : "Drag and drop an audio file here, or click the button below to select"}
                    </p>
                    <Button onClick={handleSelectFile} size="lg">
                        <Upload className="h-5 w-5"/>
                        Select Audio File
                    </Button>
                    <p className="text-xs text-muted-foreground mt-4 text-center">
                        Supported formats: FLAC, MP3, M4A, AAC
                    </p>
                </div>)}

            {analyzing && !result && (<div className="flex h-[400px] items-center justify-center">
                    <div className="w-full max-w-md space-y-2">
                        <div className="flex items-center justify-between text-sm text-muted-foreground">
                            <span>Processing...</span>
                            <span className="tabular-nums">{analysisProgress.percent}%</span>
                        </div>
                        <Progress value={analysisProgress.percent} className="h-2 w-full"/>
                    </div>
                </div>)}

            {result && (<div className="space-y-4">
                    <AudioAnalysis result={result} analyzing={analyzing} showAnalyzeButton={false} filePath={selectedFilePath}/>

                    <SpectrumVisualization ref={spectrumRef} sampleRate={result.sample_rate} duration={result.duration} spectrumData={result.spectrum} fileName={fileName} onReAnalyze={reAnalyzeSpectrum} isAnalyzingSpectrum={spectrumLoading} spectrumProgress={spectrumProgress}/>
                </div>)}
        </div>);
}
