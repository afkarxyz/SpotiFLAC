import { useState, useCallback, useEffect } from "react";
import { AnalyzeTrack } from "../../wailsjs/go/main/App";
import type { AnalysisResult } from "@/types/api";
import { logger } from "@/lib/logger";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { setSpectrumCache, getSpectrumCache, clearSpectrumCache } from "@/lib/spectrum-cache";
const STORAGE_KEY = "spotiflac_audio_analysis_state";
export function useAudioAnalysis() {
    const [analyzing, setAnalyzing] = useState(false);
    const [result, setResult] = useState<AnalysisResult | null>(() => {
        try {
            const saved = sessionStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed.filePath && parsed.result) {
                    return {
                        ...parsed.result,
                        spectrum: undefined,
                    };
                }
            }
        }
        catch (err) {
            console.error("Failed to load saved analysis state:", err);
        }
        return null;
    });
    const [selectedFilePath, setSelectedFilePath] = useState<string>(() => {
        try {
            const saved = sessionStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                return parsed.filePath || "";
            }
        }
        catch (err) {
        }
        return "";
    });
    const [error, setError] = useState<string | null>(null);
    const [spectrumLoading, setSpectrumLoading] = useState(() => {
        try {
            const saved = sessionStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed.filePath && parsed.result) {
                    return true;
                }
            }
        }
        catch (err) {
        }
        return false;
    });
    const analyzeFile = useCallback(async (filePath: string) => {
        if (!filePath) {
            setError("No file path provided");
            return null;
        }
        setAnalyzing(true);
        setError(null);
        setResult(null);
        setSelectedFilePath(filePath);
        try {
            logger.info(`Analyzing audio file: ${filePath}`);
            const startTime = Date.now();
            const response = await AnalyzeTrack(filePath);
            const analysisResult: AnalysisResult = JSON.parse(response);
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
            logger.success(`Audio analysis completed in ${elapsed}s`);
            if (analysisResult.spectrum) {
                setSpectrumCache(filePath, analysisResult.spectrum);
            }
            const { spectrum, ...detailResult } = analysisResult;
            try {
                sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
                    filePath,
                    result: detailResult,
                }));
            }
            catch (err) {
                console.error("Failed to save analysis state:", err);
            }
            setResult(analysisResult);
            setSpectrumLoading(false);
            return analysisResult;
        }
        catch (err) {
            const errorMessage = err instanceof Error ? err.message : "Failed to analyze audio file";
            logger.error(`Analysis error: ${errorMessage}`);
            setError(errorMessage);
            toast.error("Audio Analysis Failed", {
                description: errorMessage,
            });
            return null;
        }
        finally {
            setAnalyzing(false);
        }
    }, []);
    const clearResult = useCallback(() => {
        setResult(null);
        setError(null);
        setSelectedFilePath("");
        try {
            sessionStorage.removeItem(STORAGE_KEY);
        }
        catch (err) {
        }
        clearSpectrumCache();
    }, []);
    useEffect(() => {
        if (!result || !selectedFilePath || result.spectrum || !spectrumLoading) {
            return;
        }
        let rafId: number;
        const loadSpectrum = () => {
            rafId = requestAnimationFrame(() => {
                const cachedSpectrum = getSpectrumCache(selectedFilePath);
                if (cachedSpectrum) {
                    setResult(prev => prev ? { ...prev, spectrum: cachedSpectrum } : null);
                    setSpectrumLoading(false);
                }
                else {
                    setSpectrumLoading(false);
                }
            });
        };
        requestAnimationFrame(() => {
            requestAnimationFrame(loadSpectrum);
        });
        return () => {
            if (rafId) {
                cancelAnimationFrame(rafId);
            }
        };
    }, [result, selectedFilePath, spectrumLoading]);
    return {
        analyzing,
        result,
        error,
        selectedFilePath,
        spectrumLoading,
        analyzeFile,
        clearResult,
    };
}
