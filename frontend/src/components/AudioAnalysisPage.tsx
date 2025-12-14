import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Upload, ArrowLeft, Trash2 } from "lucide-react";
import { AudioAnalysis } from "@/components/AudioAnalysis";
import { SpectrumVisualization } from "@/components/SpectrumVisualization";
import { useAudioAnalysis } from "@/hooks/useAudioAnalysis";
import { SelectFile } from "../../wailsjs/go/main/App";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { OnFileDrop, OnFileDropOff } from "../../wailsjs/runtime/runtime";

interface AudioAnalysisPageProps {
  onBack?: () => void;
}

export function AudioAnalysisPage({ onBack }: AudioAnalysisPageProps) {
  const { analyzing, result, analyzeFile, clearResult, selectedFilePath, spectrumLoading } = useAudioAnalysis();
  const [isDragging, setIsDragging] = useState(false);

  const handleSelectFile = async () => {
    try {
      const filePath = await SelectFile();
      if (filePath) {
        await analyzeFile(filePath);
      }
    } catch (err) {
      toast.error("File Selection Failed", {
        description: err instanceof Error ? err.message : "Failed to select file",
      });
    }
  };

  const handleFileDrop = useCallback(
    async (_x: number, _y: number, paths: string[]) => {
      setIsDragging(false);

      if (paths.length === 0) return;

      const filePath = paths[0];

      if (!filePath.toLowerCase().endsWith(".flac")) {
        toast.error("Invalid File Type", {
          description: "Please drop a FLAC file for analysis",
        });
        return;
      }

      await analyzeFile(filePath);
    },
    [analyzeFile]
  );

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

  return (
    <div className="space-y-6">
      {/* Header */}
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
          <Button onClick={handleAnalyzeAnother} variant="outline" size="sm">
            <Trash2 className="h-4 w-4" />
            Clear
          </Button>
        )}
      </div>

      {/* File Selection */}
      {!result && !analyzing && (
        <div
          className={`flex flex-col items-center justify-center h-[400px] border-2 border-dashed rounded-lg transition-colors ${
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

      {/* Loading State */}
      {analyzing && !result && (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
          <p className="text-sm text-muted-foreground">Analyzing audio file...</p>
        </div>
      )}

      {/* Analysis Results */}
      {result && (
        <div className="space-y-4">
          {/* Detailed Analysis */}
          <AudioAnalysis result={result} analyzing={analyzing} showAnalyzeButton={false} filePath={selectedFilePath} />

          {/* Spectrum Visualization */}
          {spectrumLoading ? (
            <div className="flex flex-col items-center justify-center py-16 border rounded-lg">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-2"></div>
              <p className="text-sm text-muted-foreground">Loading spectrum data...</p>
            </div>
          ) : (
            <SpectrumVisualization
              sampleRate={result.sample_rate}
              bitsPerSample={result.bits_per_sample}
              duration={result.duration}
              spectrumData={result.spectrum}
            />
          )}
        </div>
      )}
    </div>
  );
}
