import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import {
  Activity,
  Waves,
  Radio,
  TrendingUp,
  FileAudio,
  Clock,
  Gauge,
  HardDrive
} from "lucide-react";
import type { AnalysisResult } from "@/types/api";

interface AudioAnalysisProps {
  result: AnalysisResult | null;
  analyzing: boolean;
  onAnalyze?: () => void;
  showAnalyzeButton?: boolean;
  filePath?: string;
}

export function AudioAnalysis({
  result,
  analyzing,
  onAnalyze,
  showAnalyzeButton = true,
  filePath
}: AudioAnalysisProps) {
  if (analyzing) {
    return (
      <Card>
        <CardContent className="px-6">
          <div className="flex items-center justify-center py-8 gap-3">
            <Spinner />
            <span className="text-muted-foreground">Analyzing audio quality...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!result && showAnalyzeButton) {
    return (
      <Card>
        <CardContent className="px-6">
          <div className="flex flex-col items-center justify-center py-8 gap-4">
            <Activity className="h-12 w-12 text-primary" />
            <div className="text-center space-y-2">
              <p className="font-medium">Audio Quality Analysis</p>
              <p className="text-sm text-muted-foreground">
                Verify the true lossless quality of downloaded files
              </p>
            </div>
            {onAnalyze && (
              <Button onClick={onAnalyze}>
                <Activity className="h-4 w-4" />
                Analyze Audio
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!result) {
    return null;
  }

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatNumber = (num: number) => {
    return num.toFixed(2);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  // Calculate Nyquist frequency (half of sample rate)
  const nyquistFreq = result.sample_rate / 2;

  return (
    <Card className="gap-2">
      <CardHeader>
        {filePath && (
          <p className="text-sm font-mono break-all">{filePath}</p>
        )}
      </CardHeader>

      <CardContent className="space-y-2">
        {/* Audio Properties - Single line */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <div className="flex items-center gap-1">
            <Radio className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">Sample Rate:</span>
            <span className="font-semibold">{(result.sample_rate / 1000).toFixed(1)} kHz</span>
          </div>
          <div className="flex items-center gap-1">
            <FileAudio className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">Bit Depth:</span>
            <span className="font-semibold">{result.bit_depth}</span>
          </div>
          <div className="flex items-center gap-1">
            <Waves className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">Channels:</span>
            <span className="font-semibold">{result.channels === 2 ? "Stereo" : result.channels === 1 ? "Mono" : `${result.channels}`}</span>
          </div>
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">Duration:</span>
            <span className="font-semibold">{formatDuration(result.duration)}</span>
          </div>
          <div className="flex items-center gap-1">
            <Gauge className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">Nyquist:</span>
            <span className="font-semibold">{(nyquistFreq / 1000).toFixed(1)} kHz</span>
          </div>
          {result.file_size > 0 && (
            <div className="flex items-center gap-1">
              <HardDrive className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">Size:</span>
              <span className="font-semibold">{formatFileSize(result.file_size)}</span>
            </div>
          )}
        </div>

        {/* Dynamic Range - Single line */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs border-t pt-2">
          <div className="flex items-center gap-1">
            <TrendingUp className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">Dynamic Range:</span>
            <span className="font-semibold">{formatNumber(result.dynamic_range)} dB</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Peak:</span>
            <span className="font-semibold">{formatNumber(result.peak_amplitude)} dB</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">RMS:</span>
            <span className="font-semibold">{formatNumber(result.rms_level)} dB</span>
          </div>
          <div className="flex items-center gap-1 ml-auto">
            <span className="text-muted-foreground">Samples:</span>
            <span className="font-semibold">{result.total_samples.toLocaleString()}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
