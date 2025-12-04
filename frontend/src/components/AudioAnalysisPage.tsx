import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Activity, Upload, ArrowLeft } from "lucide-react";
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
  const { analyzing, result, analyzeFile, clearResult } = useAudioAnalysis();
  const [selectedFilePath, setSelectedFilePath] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);

  const handleSelectFile = async () => {
    try {
      const filePath = await SelectFile();
      if (filePath) {
        setSelectedFilePath(filePath);
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

      setSelectedFilePath(filePath);
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
    setSelectedFilePath("");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        {onBack && (
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
        )}
        <h1 className="text-2xl font-bold">Audio Quality Analyzer</h1>
      </div>

      {/* File Selection */}
      {!result && !analyzing && (
        <div
          className={`flex flex-col items-center justify-center py-24 border-2 border-dashed rounded-lg transition-colors ${
            isDragging
              ? "border-primary bg-primary/10"
              : "border-muted-foreground/30 hover:border-muted-foreground/50"
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
          <Activity
            className={`h-20 w-20 mb-4 transition-colors ${isDragging ? "text-primary" : "text-muted-foreground/50"}`}
          />
          <h3 className="text-xl font-medium mb-2">Analyze FLAC Audio Quality</h3>
          <p className="text-sm text-muted-foreground mb-6 text-center max-w-md">
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
          {/* File Info */}
          <div className="p-3 bg-muted/30 rounded-lg">
            <p className="text-xs text-muted-foreground">Analyzing file:</p>
            <p className="text-sm font-mono truncate">{selectedFilePath}</p>
          </div>

          {/* Spectrum Visualization */}
          <SpectrumVisualization
            sampleRate={result.sample_rate}
            bitsPerSample={result.bits_per_sample}
            duration={result.duration}
            spectrumData={result.spectrum}
          />

          {/* Detailed Analysis */}
          <AudioAnalysis result={result} analyzing={analyzing} showAnalyzeButton={false} />

          {/* Actions */}
          <div className="flex gap-2 justify-end pt-2">
            <Button onClick={handleAnalyzeAnother} variant="outline">
              <Upload className="h-4 w-4" />
              Analyze Another File
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
