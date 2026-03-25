import { useState, useCallback, useRef } from "react";
import type { AnalysisResult } from "@/types/api";
import { logger } from "@/lib/logger";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { analyzeFlacArrayBuffer, analyzeFlacFile, analyzeSpectrumFromSamples } from "@/lib/flac-analysis";
import { loadAudioAnalysisPreferences } from "@/lib/audio-analysis-preferences";

type WindowFunction = "hann" | "hamming" | "blackman" | "rectangular";

function toWindowFunction(value: string): WindowFunction {
    switch (value) {
        case "hamming":
        case "blackman":
        case "rectangular":
            return value;
        case "hann":
        default:
            return "hann";
    }
}

function fileNameFromPath(filePath: string): string {
    const parts = filePath.split(/[/\\]/);
    return parts[parts.length - 1] || filePath;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const clean = base64.includes(",") ? base64.split(",")[1] : base64;
    const binary = atob(clean);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

let sessionResult: AnalysisResult | null = null;
let sessionSelectedFilePath = "";
let sessionError: string | null = null;
let sessionSamples: Float32Array | null = null;

export function useAudioAnalysis() {
    const [analyzing, setAnalyzing] = useState(false);
    const [result, setResult] = useState<AnalysisResult | null>(() => sessionResult);
    const [selectedFilePath, setSelectedFilePath] = useState(() => sessionSelectedFilePath);
    const [error, setError] = useState<string | null>(() => sessionError);
    const [spectrumLoading, setSpectrumLoading] = useState(false);
    const samplesRef = useRef<Float32Array | null>(sessionSamples);

    const setResultWithSession = useCallback((next: AnalysisResult | null) => {
        sessionResult = next;
        setResult(next);
    }, []);

    const setSelectedFilePathWithSession = useCallback((next: string) => {
        sessionSelectedFilePath = next;
        setSelectedFilePath(next);
    }, []);

    const setErrorWithSession = useCallback((next: string | null) => {
        sessionError = next;
        setError(next);
    }, []);

    const analyzeFile = useCallback(async (file: File) => {
        if (!file) {
            setErrorWithSession("No file provided");
            return null;
        }

        setAnalyzing(true);
        setErrorWithSession(null);
        setResultWithSession(null);
        setSelectedFilePathWithSession(file.name);

        try {
            logger.info(`Analyzing audio file (frontend): ${file.name}`);
            const start = Date.now();
            const prefs = loadAudioAnalysisPreferences();
            const payload = await analyzeFlacFile(file, {
                fftSize: prefs.fftSize,
                windowFunction: prefs.windowFunction,
            });

            samplesRef.current = payload.samples;
            sessionSamples = payload.samples;
            setResultWithSession(payload.result);

            const elapsed = ((Date.now() - start) / 1000).toFixed(2);
            logger.success(`Audio analysis completed in ${elapsed}s`);
            return payload.result;
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "Failed to analyze audio file";
            logger.error(`Analysis error: ${errorMessage}`);
            setErrorWithSession(errorMessage);
            toast.error("Audio Analysis Failed", {
                description: errorMessage,
            });
            return null;
        } finally {
            setAnalyzing(false);
        }
    }, [setErrorWithSession, setResultWithSession, setSelectedFilePathWithSession]);

    const analyzeFilePath = useCallback(async (filePath: string) => {
        if (!filePath) {
            setErrorWithSession("No file path provided");
            return null;
        }

        setAnalyzing(true);
        setErrorWithSession(null);
        setResultWithSession(null);
        setSelectedFilePathWithSession(filePath);

        try {
            logger.info(`Analyzing audio file (frontend from path): ${filePath}`);
            const start = Date.now();
            const prefs = loadAudioAnalysisPreferences();

            const readFileAsBase64 = (window as any)?.go?.main?.App?.ReadFileAsBase64 as
                | ((path: string) => Promise<string>)
                | undefined;
            if (!readFileAsBase64) {
                throw new Error("ReadFileAsBase64 backend method is unavailable");
            }

            const base64Data = await readFileAsBase64(filePath);
            const arrayBuffer = base64ToArrayBuffer(base64Data);
            const fileName = fileNameFromPath(filePath);
            const payload = await analyzeFlacArrayBuffer(
                {
                    fileName,
                    fileSize: arrayBuffer.byteLength,
                    arrayBuffer,
                },
                {
                    fftSize: prefs.fftSize,
                    windowFunction: prefs.windowFunction,
                },
            );

            samplesRef.current = payload.samples;
            sessionSamples = payload.samples;
            setResultWithSession(payload.result);

            const elapsed = ((Date.now() - start) / 1000).toFixed(2);
            logger.success(`Audio analysis completed in ${elapsed}s`);
            return payload.result;
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "Failed to analyze audio file";
            logger.error(`Analysis error: ${errorMessage}`);
            setErrorWithSession(errorMessage);
            toast.error("Audio Analysis Failed", {
                description: errorMessage,
            });
            return null;
        } finally {
            setAnalyzing(false);
        }
    }, [setErrorWithSession, setResultWithSession, setSelectedFilePathWithSession]);

    const reAnalyzeSpectrum = useCallback(async (fftSize: number, windowFunction: string) => {
        if (!result || !samplesRef.current) return;

        setSpectrumLoading(true);
        try {
            const spectrum = analyzeSpectrumFromSamples(samplesRef.current, result.sample_rate, {
                fftSize,
                windowFunction: toWindowFunction(windowFunction),
            });
            setResult((prev) => {
                const next = prev ? { ...prev, spectrum } : prev;
                sessionResult = next;
                return next;
            });
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "Failed to re-analyze spectrum";
            logger.error(`Spectrum re-analysis error: ${errorMessage}`);
            toast.error("Spectrum Analysis Failed", {
                description: errorMessage,
            });
        } finally {
            setSpectrumLoading(false);
        }
    }, [result]);

    const clearResult = useCallback(() => {
        setResultWithSession(null);
        setErrorWithSession(null);
        setSelectedFilePathWithSession("");
        setSpectrumLoading(false);
        samplesRef.current = null;
        sessionSamples = null;
    }, [setErrorWithSession, setResultWithSession, setSelectedFilePathWithSession]);

    return {
        analyzing,
        result,
        error,
        selectedFilePath,
        spectrumLoading,
        analyzeFile,
        analyzeFilePath,
        reAnalyzeSpectrum,
        clearResult,
    };
}
