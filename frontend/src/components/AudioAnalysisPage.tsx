import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Upload, ArrowLeft, Trash2, Download } from "lucide-react";
import { AudioAnalysis } from "@/components/AudioAnalysis";
import { SpectrumVisualization } from "@/components/SpectrumVisualization";
import { useAudioAnalysis } from "@/hooks/useAudioAnalysis";
import { SelectFile, SaveSpectrumImage } from "../../wailsjs/go/main/App";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { OnFileDrop, OnFileDropOff } from "../../wailsjs/runtime/runtime";

interface AudioAnalysisPageProps {
    onBack?: () => void;
}

export function AudioAnalysisPage({ onBack }: AudioAnalysisPageProps) {
    const { analyzing, result, analyzeFile, clearResult, selectedFilePath, spectrumLoading, reAnalyzeSpectrum } =
        useAudioAnalysis();
    const [isDragging, setIsDragging] = useState(false);
    const spectrumRef = useRef<{ getCanvasDataURL: () => string | null; }>(null);
    const [isExporting, setIsExporting] = useState(false);

    const handleExport = async () => {
        if (!selectedFilePath || !spectrumRef.current)
            return;

        const dataUrl = spectrumRef.current.getCanvasDataURL();
        if (!dataUrl) {
            toast.error("Export Failed", { description: "Cannot get canvas data" });
            return;
        }

        setIsExporting(true);
        try {
            const outPath = await SaveSpectrumImage(selectedFilePath, dataUrl);
            toast.success("Exported Successfully", {
                description: `Saved to: ${outPath}`,
            });
        }
        catch (err) {
            toast.error("Export Failed", {
                description: err instanceof Error ? err.message : "Failed to save image",
            });
        }
        finally {
            setIsExporting(false);
        }
    };

    const handleSelectFile = async () => {
        try {
            const filePath = await SelectFile();
            if (filePath) {
                await analyzeFile(filePath);
            }
        }
        catch (err) {
            toast.error("File Selection Failed", {
                description: err instanceof Error ? err.message : "Failed to select file",
            });
        }
    };

    const handleFileDrop = useCallback(async (_x: number, _y: number, paths: string[]) => {
        setIsDragging(false);
        if (paths.length === 0)
            return;
        const filePath = paths[0];
        if (!filePath.toLowerCase().endsWith(".flac")) {
            toast.error("Invalid File Type", {
                description: "Please drop a FLAC file for analysis",
            });
            return;
        }
        await analyzeFile(filePath);
    }, [analyzeFile]);

    useEffect(() => {
        OnFileDrop((x, y, paths) => {
            handleFileDrop(x, y, paths);
        }, true);
        return () => {
            OnFileDropOff();
        };
    }, [handleFileDrop]);

    const handleAnalyzeAnother = () => {
        clearResult();
    };

    const fileName = selectedFilePath
        ? selectedFilePath.split(/[/\\]/).pop()
        : undefined;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    {onBack && (
                        <Button variant="ghost" size="icon" onClick={onBack}>
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                    )}
                    <h1 className="text-2xl font-bold">Audio Quality Analyzer</h1>
                </div>
                {result && (
                    <div className="flex gap-2">
                        <Button
                            onClick={handleExport}
                            variant="outline"
                            size="sm"
                            disabled={isExporting || spectrumLoading}
                        >
                            <Download className="h-4 w-4 mr-1" />
                            {isExporting ? "Exporting..." : "Export PNG"}
                        </Button>
                        <Button onClick={handleAnalyzeAnother} variant="outline" size="sm">
                            <Trash2 className="h-4 w-4 mr-1" />
                            Clear
                        </Button>
                    </div>
                )}
            </div>

            {!result && !analyzing && (
                <div
                    className={`flex flex-col items-center justify-center h-[400px] border-2 border-dashed rounded-lg transition-colors ${isDragging
                        ? "border-primary bg-primary/10"
                        : "border-muted-foreground/30"}`}
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
                    onDrop={(e) => { e.preventDefault(); setIsDragging(false); }}
                    style={{ "--wails-drop-target": "drop" } as React.CSSProperties}
                >
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                        <Upload className="h-8 w-8 text-primary" />
                    </div>
                    <p className="text-sm text-muted-foreground mb-4 text-center">
                        {isDragging
                            ? "Drop your FLAC file here"
                            : "Drag and drop a FLAC file here, or click the button below to select"}
                    </p>
                    <Button onClick={handleSelectFile} size="lg">
                        <Upload className="h-5 w-5" />
                        Select FLAC File
                    </Button>
                </div>
            )}

            {analyzing && !result && (
                <div className="flex flex-col items-center justify-center py-16">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
                    <p className="text-sm text-muted-foreground">Analyzing audio file...</p>
                </div>
            )}

            {result && (
                <div className="space-y-4">
                    <AudioAnalysis
                        result={result}
                        analyzing={analyzing}
                        showAnalyzeButton={false}
                        filePath={selectedFilePath}
                    />

                    <SpectrumVisualization
                        ref={spectrumRef}
                        sampleRate={result.sample_rate}
                        duration={result.duration}
                        spectrumData={result.spectrum}
                        fileName={fileName}
                        onReAnalyze={reAnalyzeSpectrum}
                        isAnalyzingSpectrum={spectrumLoading}
                    />
                </div>
            )}
        </div>
    );
}
