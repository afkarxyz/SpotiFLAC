import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import {
  Activity,
  Waves,
  Radio,
  TrendingUp,
  FileAudio,
  Clock
} from "lucide-react";
import type { AnalysisResult } from "@/types/api";

interface AudioAnalysisProps {
  result: AnalysisResult | null;
  analyzing: boolean;
  onAnalyze?: () => void;
  showAnalyzeButton?: boolean;
}

export function AudioAnalysis({
  result,
  analyzing,
  onAnalyze,
  showAnalyzeButton = true
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
            <Activity className="h-12 w-12 text-muted-foreground/50" />
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

  return (
    <Card>
      <CardHeader>
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Audio Quality Analysis
          </CardTitle>
          <CardDescription>
            Technical analysis of audio file properties
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="px-6 space-y-6">

        {/* Technical Specifications */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Radio className="h-3 w-3" />
              Sample Rate
            </div>
            <p className="font-semibold">{(result.sample_rate / 1000).toFixed(1)} kHz</p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <FileAudio className="h-3 w-3" />
              Bit Depth
            </div>
            <p className="font-semibold">{result.bit_depth}</p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Waves className="h-3 w-3" />
              Channels
            </div>
            <p className="font-semibold">{result.channels === 2 ? "Stereo" : result.channels === 1 ? "Mono" : `${result.channels} channels`}</p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              Duration
            </div>
            <p className="font-semibold">{formatDuration(result.duration)}</p>
          </div>
        </div>

        {/* Dynamic Range Analysis */}
        <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
          <div className="flex items-center gap-2 text-sm font-medium">
            <TrendingUp className="h-4 w-4" />
            Dynamic Range Analysis
          </div>

          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Dynamic Range</p>
              <p className="font-semibold">{formatNumber(result.dynamic_range)} dB</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Peak Level</p>
              <p className="font-semibold">{formatNumber(result.peak_amplitude)} dB</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">RMS Level</p>
              <p className="font-semibold">{formatNumber(result.rms_level)} dB</p>
            </div>
          </div>
        </div>

        {/* Technical Info Footer */}
        <div className="pt-2 border-t">
          <p className="text-xs text-muted-foreground">
            Total Samples: {result.total_samples.toLocaleString()}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
