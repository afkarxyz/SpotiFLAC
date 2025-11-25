import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Activity, Upload, X } from "lucide-react";
import { AudioAnalysis } from "@/components/AudioAnalysis";
import { SpectrumVisualization } from "@/components/SpectrumVisualization";
import { useAudioAnalysis } from "@/hooks/useAudioAnalysis";
import { SelectFile } from "../../wailsjs/go/main/App";
import { toastWithSound as toast } from "@/lib/toast-with-sound";

export function AudioAnalysisDialog() {
  const [open, setOpen] = useState(false);
  const { analyzing, result, analyzeFile, clearResult } = useAudioAnalysis();
  const [selectedFilePath, setSelectedFilePath] = useState<string>("");

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

  const handleClose = () => {
    setOpen(false);
    setTimeout(() => {
      clearResult();
      setSelectedFilePath("");
    }, 200);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) {
        handleClose();
      } else {
        setOpen(true);
      }
    }}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button variant="outline" size="icon">
              <Activity className="h-5 w-5" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent side="left">
          <p>Audio Quality Analyzer</p>
        </TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto flex flex-col p-6 [&>button]:hidden custom-scrollbar" aria-describedby={undefined}>
        <div className="absolute right-4 top-4">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 opacity-70 hover:opacity-100"
            onClick={handleClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <DialogTitle className="text-sm font-medium">Audio Quality Analyzer</DialogTitle>

        <div className="space-y-4">
          {/* File Selection */}
          {!result && !analyzing && (
            <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed rounded-lg">
              <Activity className="h-16 w-16 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium mb-2">Analyze FLAC Audio Quality</h3>
              <p className="text-sm text-muted-foreground mb-6 text-center max-w-md">
                Upload a FLAC file to verify true lossless quality, view detailed technical specifications, and see the frequency spectrum
              </p>
              <Button onClick={handleSelectFile} size="lg">
                <Upload className="h-5 w-5" />
                Select FLAC File
              </Button>
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
              <AudioAnalysis
                result={result}
                analyzing={analyzing}
                showAnalyzeButton={false}
              />

              {/* Actions */}
              <div className="flex gap-2 justify-end pt-2">
                <Button onClick={handleSelectFile} variant="outline">
                  <Upload className="h-4 w-4" />
                  Analyze Another File
                </Button>
              </div>
            </div>
          )}

          {/* Loading State */}
          {analyzing && !result && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
              <p className="text-sm text-muted-foreground">Analyzing audio file...</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
