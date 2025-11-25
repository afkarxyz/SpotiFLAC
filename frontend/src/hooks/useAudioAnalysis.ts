import { useState, useCallback } from "react";
import { AnalyzeTrack } from "../../wailsjs/go/main/App";
import type { AnalysisResult } from "@/types/api";
import { logger } from "@/lib/logger";
import { toastWithSound as toast } from "@/lib/toast-with-sound";

export function useAudioAnalysis() {
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const analyzeFile = useCallback(async (filePath: string) => {
    if (!filePath) {
      setError("No file path provided");
      return null;
    }

    setAnalyzing(true);
    setError(null);
    setResult(null);

    try {
      logger.info(`Analyzing audio file: ${filePath}`);
      const startTime = Date.now();

      const response = await AnalyzeTrack(filePath);
      const analysisResult: AnalysisResult = JSON.parse(response);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.success(`Audio analysis completed in ${elapsed}s`);

      setResult(analysisResult);

      return analysisResult;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to analyze audio file";
      logger.error(`Analysis error: ${errorMessage}`);
      setError(errorMessage);
      toast.error("Audio Analysis Failed", {
        description: errorMessage,
      });
      return null;
    } finally {
      setAnalyzing(false);
    }
  }, []);

  const clearResult = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return {
    analyzing,
    result,
    error,
    analyzeFile,
    clearResult,
  };
}
