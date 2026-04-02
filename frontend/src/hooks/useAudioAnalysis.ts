import { useState, useCallback, useRef, useEffect, type MutableRefObject } from "react";
import type { AnalysisResult } from "@/types/api";
import { logger } from "@/lib/logger";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import {
    analyzeAudioArrayBuffer,
    analyzeAudioFile,
    analyzeDecodedSamples,
    analyzeSpectrumFromSamples,
    parseAudioMetadataFromInput,
    pcm16MonoArrayBufferToFloat32Samples,
    type AnalysisProgress,
    type FrontendAnalysisPayload,
    type ParsedAudioMetadata,
} from "@/lib/flac-analysis";
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

function nextUiTick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

async function base64ToArrayBuffer(base64: string, shouldCancel?: () => boolean): Promise<ArrayBuffer> {
    const clean = base64.includes(",") ? base64.split(",")[1] : base64;
    const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
    const outputLength = Math.floor((clean.length * 3) / 4) - padding;
    const bytes = new Uint8Array(outputLength);
    const chunkSize = 4 * 16384;
    let writeOffset = 0;

    for (let offset = 0; offset < clean.length; offset += chunkSize) {
        if (shouldCancel?.()) {
            throw new Error("Analysis cancelled");
        }

        const chunk = clean.slice(offset, Math.min(clean.length, offset + chunkSize));
        const binary = atob(chunk);

        for (let i = 0; i < binary.length; i++) {
            bytes[writeOffset++] = binary.charCodeAt(i);
        }

        if ((offset / chunkSize) % 4 === 0) {
            await nextUiTick();
        }
    }

    return bytes.buffer;
}

let sessionResult: AnalysisResult | null = null;
let sessionSelectedFilePath = "";
let sessionError: string | null = null;
let sessionSamples: Float32Array | null = null;
let sessionCurrentAnalysisKey = "";
const sessionSamplesByKey = new Map<string, Float32Array>();

interface ProgressState {
    percent: number;
    message: string;
}

const DEFAULT_PROGRESS_STATE: ProgressState = {
    percent: 0,
    message: "Preparing analysis...",
};

interface CancelToken {
    cancelled: boolean;
}

interface AnalyzeExecutionOptions {
    analysisKey?: string;
    displayPath?: string;
    suppressToast?: boolean;
}

export interface AnalyzeExecutionOutcome {
    result: AnalysisResult | null;
    error: string | null;
    cancelled: boolean;
}

interface WailsWindow extends Window {
    go?: {
        main?: {
            App?: {
                ReadFileAsBase64?: (path: string) => Promise<string>;
                DecodeAudioForAnalysis?: (path: string) => Promise<BackendAnalysisDecodeResponse>;
            };
        };
    };
}

interface BackendAnalysisDecodeResponse {
    pcm_base64: string;
    sample_rate: number;
    channels: number;
    bits_per_sample: number;
    duration: number;
    bitrate_kbps?: number;
    bit_depth?: string;
}

function cancelToken(tokenRef: MutableRefObject<CancelToken | null>): void {
    if (tokenRef.current) {
        tokenRef.current.cancelled = true;
        tokenRef.current = null;
    }
}

function createToken(tokenRef: MutableRefObject<CancelToken | null>): CancelToken {
    cancelToken(tokenRef);
    const token: CancelToken = { cancelled: false };
    tokenRef.current = token;
    return token;
}

function isCancelledError(error: unknown): boolean {
    return error instanceof Error && error.message === "Analysis cancelled";
}

function toProgressState(progress: AnalysisProgress): ProgressState {
    return {
        percent: Math.round(Math.max(0, Math.min(100, progress.percent))),
        message: progress.message,
    };
}

function isDecodeFailure(error: unknown): boolean {
    return error instanceof Error && /decode/i.test(error.message);
}

function mergeBackendDecodedMetadata(parsed: ParsedAudioMetadata, decoded: BackendAnalysisDecodeResponse): ParsedAudioMetadata {
    const sampleRate = decoded.sample_rate > 0 ? decoded.sample_rate : parsed.sampleRate;
    const bitsPerSample = decoded.bits_per_sample > 0 ? decoded.bits_per_sample : parsed.bitsPerSample;
    const duration = decoded.duration > 0 ? decoded.duration : parsed.duration;

    return {
        ...parsed,
        sampleRate,
        channels: decoded.channels > 0 ? decoded.channels : parsed.channels,
        bitsPerSample,
        totalSamples: duration > 0 && sampleRate > 0 ? Math.floor(duration * sampleRate) : parsed.totalSamples,
        duration,
        bitrateKbps: decoded.bitrate_kbps ?? parsed.bitrateKbps,
    };
}

export function useAudioAnalysis() {
    const [analyzing, setAnalyzing] = useState(false);
    const [analysisProgress, setAnalysisProgress] = useState<ProgressState>(DEFAULT_PROGRESS_STATE);
    const [result, setResult] = useState<AnalysisResult | null>(() => sessionResult);
    const [selectedFilePath, setSelectedFilePath] = useState(() => sessionSelectedFilePath);
    const [error, setError] = useState<string | null>(() => sessionError);
    const [spectrumLoading, setSpectrumLoading] = useState(false);
    const [spectrumProgress, setSpectrumProgress] = useState<ProgressState>(DEFAULT_PROGRESS_STATE);

    const samplesRef = useRef<Float32Array | null>(sessionSamples);
    const currentAnalysisKeyRef = useRef(sessionCurrentAnalysisKey);
    const analysisTokenRef = useRef<CancelToken | null>(null);
    const spectrumTokenRef = useRef<CancelToken | null>(null);

    useEffect(() => {
        return () => {
            cancelToken(analysisTokenRef);
            cancelToken(spectrumTokenRef);
        };
    }, []);

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

    const setCurrentAnalysisKey = useCallback((analysisKey: string) => {
        currentAnalysisKeyRef.current = analysisKey;
        sessionCurrentAnalysisKey = analysisKey;
    }, []);

    const storeSuccessfulAnalysis = useCallback((analysisKey: string, displayPath: string, payload: FrontendAnalysisPayload) => {
        sessionSamplesByKey.set(analysisKey, payload.samples);
        samplesRef.current = payload.samples;
        sessionSamples = payload.samples;
        setCurrentAnalysisKey(analysisKey);
        setResultWithSession(payload.result);
        setSelectedFilePathWithSession(displayPath);
        setErrorWithSession(null);
    }, [setCurrentAnalysisKey, setErrorWithSession, setResultWithSession, setSelectedFilePathWithSession]);

    const analyzeFile = useCallback(async (file: File, options?: AnalyzeExecutionOptions): Promise<AnalyzeExecutionOutcome> => {
        if (!file) {
            const errorMessage = "No file provided";
            setErrorWithSession(errorMessage);
            return {
                result: null,
                error: errorMessage,
                cancelled: false,
            };
        }

        const token = createToken(analysisTokenRef);
        const analysisKey = options?.analysisKey || file.name;
        const displayPath = options?.displayPath || file.name;

        cancelToken(spectrumTokenRef);
        setAnalyzing(true);
        setAnalysisProgress({
            percent: 1,
            message: "Preparing file...",
        });
        setErrorWithSession(null);
        setResultWithSession(null);
        setSelectedFilePathWithSession(displayPath);
        setCurrentAnalysisKey(analysisKey);

        try {
            logger.info(`Analyzing audio file (frontend): ${displayPath}`);
            const start = Date.now();
            const prefs = loadAudioAnalysisPreferences();

            const payload = await analyzeAudioFile(file, {
                fftSize: prefs.fftSize,
                windowFunction: prefs.windowFunction,
            }, (progress) => {
                if (token.cancelled) {
                    return;
                }

                setAnalysisProgress(toProgressState(progress));
            }, () => token.cancelled);

            if (token.cancelled) {
                return {
                    result: null,
                    error: null,
                    cancelled: true,
                };
            }

            storeSuccessfulAnalysis(analysisKey, displayPath, payload);

            const elapsed = ((Date.now() - start) / 1000).toFixed(2);
            logger.success(`Audio analysis completed in ${elapsed}s`);

            return {
                result: payload.result,
                error: null,
                cancelled: false,
            };
        }
        catch (err) {
            if (isCancelledError(err)) {
                return {
                    result: null,
                    error: null,
                    cancelled: true,
                };
            }

            const errorMessage = err instanceof Error ? err.message : "Failed to analyze audio file";
            logger.error(`Analysis error: ${errorMessage}`);
            setErrorWithSession(errorMessage);
            setAnalysisProgress({
                percent: 0,
                message: "Analysis failed",
            });

            if (!options?.suppressToast) {
                toast.error("Audio Analysis Failed", {
                    description: errorMessage,
                });
            }

            return {
                result: null,
                error: errorMessage,
                cancelled: false,
            };
        }
        finally {
            if (analysisTokenRef.current === token) {
                analysisTokenRef.current = null;
                setAnalyzing(false);
            }
        }
    }, [setCurrentAnalysisKey, setErrorWithSession, setResultWithSession, setSelectedFilePathWithSession, storeSuccessfulAnalysis]);

    const analyzeFilePath = useCallback(async (filePath: string, options?: AnalyzeExecutionOptions): Promise<AnalyzeExecutionOutcome> => {
        if (!filePath) {
            const errorMessage = "No file path provided";
            setErrorWithSession(errorMessage);
            return {
                result: null,
                error: errorMessage,
                cancelled: false,
            };
        }

        const token = createToken(analysisTokenRef);
        const analysisKey = options?.analysisKey || filePath;
        const displayPath = options?.displayPath || filePath;

        cancelToken(spectrumTokenRef);
        setAnalyzing(true);
        setAnalysisProgress({
            percent: 1,
            message: "Reading file from disk...",
        });
        setErrorWithSession(null);
        setResultWithSession(null);
        setSelectedFilePathWithSession(displayPath);
        setCurrentAnalysisKey(analysisKey);

        try {
            logger.info(`Analyzing audio file (frontend from path): ${filePath}`);
            const start = Date.now();
            const prefs = loadAudioAnalysisPreferences();
            const readFileAsBase64 = (window as WailsWindow).go?.main?.App?.ReadFileAsBase64;

            if (!readFileAsBase64) {
                throw new Error("ReadFileAsBase64 backend method is unavailable");
            }

            let base64Data = await readFileAsBase64(filePath);

            if (token.cancelled) {
                return {
                    result: null,
                    error: null,
                    cancelled: true,
                };
            }

            setAnalysisProgress({
                percent: 10,
                message: "File loaded",
            });

            const arrayBuffer = await base64ToArrayBuffer(base64Data, () => token.cancelled);
            base64Data = "";

            if (token.cancelled) {
                return {
                    result: null,
                    error: null,
                    cancelled: true,
                };
            }

            setAnalysisProgress({
                percent: 15,
                message: "Preparing audio buffer...",
            });

            const fileName = fileNameFromPath(filePath);
            const input = {
                fileName,
                fileSize: arrayBuffer.byteLength,
                arrayBuffer,
            };
            const analysisParams = {
                fftSize: prefs.fftSize,
                windowFunction: prefs.windowFunction,
            } as const;

            const updateProgress = (progress: AnalysisProgress) => {
                if (token.cancelled) {
                    return;
                }

                const mappedPercent = 10 + (progress.percent * 0.9);
                setAnalysisProgress({
                    percent: Math.round(Math.max(0, Math.min(100, mappedPercent))),
                    message: progress.message,
                });
            };

            let payload: FrontendAnalysisPayload;

            try {
                payload = await analyzeAudioArrayBuffer(input, analysisParams, updateProgress, () => token.cancelled);
            }
            catch (err) {
                if (!isDecodeFailure(err)) {
                    throw err;
                }

                const decodeAudioForAnalysis = (window as WailsWindow).go?.main?.App?.DecodeAudioForAnalysis;

                if (!decodeAudioForAnalysis) {
                    throw err;
                }

                logger.warning(`Browser decoder failed for ${fileName}; trying FFmpeg fallback`);
                setAnalysisProgress({
                    percent: 18,
                    message: "Browser decoder failed, trying FFmpeg fallback...",
                });

                const decoded = await decodeAudioForAnalysis(filePath);

                if (token.cancelled) {
                    return {
                        result: null,
                        error: null,
                        cancelled: true,
                    };
                }

                setAnalysisProgress({
                    percent: 24,
                    message: "Decoding audio with FFmpeg...",
                });

                const pcmBase64 = decoded.pcm_base64 || "";

                if (!pcmBase64) {
                    throw new Error("FFmpeg analysis decode returned no PCM data");
                }

                const pcmBuffer = await base64ToArrayBuffer(pcmBase64, () => token.cancelled);

                if (token.cancelled) {
                    return {
                        result: null,
                        error: null,
                        cancelled: true,
                    };
                }

                const parsedMetadata = parseAudioMetadataFromInput(input);
                const mergedMetadata = mergeBackendDecodedMetadata(parsedMetadata, decoded);
                const samples = pcm16MonoArrayBufferToFloat32Samples(pcmBuffer);

                payload = await analyzeDecodedSamples(
                    input,
                    mergedMetadata,
                    samples,
                    analysisParams,
                    updateProgress,
                    () => token.cancelled,
                    mergedMetadata.duration,
                );
            }

            if (token.cancelled) {
                return {
                    result: null,
                    error: null,
                    cancelled: true,
                };
            }

            storeSuccessfulAnalysis(analysisKey, displayPath, payload);

            const elapsed = ((Date.now() - start) / 1000).toFixed(2);
            logger.success(`Audio analysis completed in ${elapsed}s`);

            return {
                result: payload.result,
                error: null,
                cancelled: false,
            };
        }
        catch (err) {
            if (isCancelledError(err)) {
                return {
                    result: null,
                    error: null,
                    cancelled: true,
                };
            }

            const errorMessage = err instanceof Error ? err.message : "Failed to analyze audio file";
            logger.error(`Analysis error: ${errorMessage}`);
            setErrorWithSession(errorMessage);
            setAnalysisProgress({
                percent: 0,
                message: "Analysis failed",
            });

            if (!options?.suppressToast) {
                toast.error("Audio Analysis Failed", {
                    description: errorMessage,
                });
            }

            return {
                result: null,
                error: errorMessage,
                cancelled: false,
            };
        }
        finally {
            if (analysisTokenRef.current === token) {
                analysisTokenRef.current = null;
                setAnalyzing(false);
            }
        }
    }, [setCurrentAnalysisKey, setErrorWithSession, setResultWithSession, setSelectedFilePathWithSession, storeSuccessfulAnalysis]);

    const loadStoredAnalysis = useCallback((analysisKey: string, nextResult: AnalysisResult, displayPath: string) => {
        setCurrentAnalysisKey(analysisKey);
        samplesRef.current = sessionSamplesByKey.get(analysisKey) ?? null;
        sessionSamples = samplesRef.current;
        setResultWithSession(nextResult);
        setSelectedFilePathWithSession(displayPath);
        setErrorWithSession(null);
    }, [setCurrentAnalysisKey, setErrorWithSession, setResultWithSession, setSelectedFilePathWithSession]);

    const clearStoredAnalysis = useCallback((analysisKey?: string) => {
        if (analysisKey) {
            sessionSamplesByKey.delete(analysisKey);

            if (currentAnalysisKeyRef.current === analysisKey) {
                currentAnalysisKeyRef.current = "";
                sessionCurrentAnalysisKey = "";
                samplesRef.current = null;
                sessionSamples = null;
            }

            return;
        }

        sessionSamplesByKey.clear();
        currentAnalysisKeyRef.current = "";
        sessionCurrentAnalysisKey = "";
        samplesRef.current = null;
        sessionSamples = null;
    }, []);

    const cancelAnalysis = useCallback(() => {
        cancelToken(analysisTokenRef);
        setAnalyzing(false);
        setAnalysisProgress((prev) => prev.percent > 0
            ? {
                percent: prev.percent,
                message: "Analysis stopped",
            }
            : DEFAULT_PROGRESS_STATE);
    }, []);

    const reAnalyzeSpectrum = useCallback(async (fftSize: number, windowFunction: string) => {
        if (!result || !samplesRef.current) {
            return null;
        }

        const token = createToken(spectrumTokenRef);
        setSpectrumLoading(true);
        setSpectrumProgress({
            percent: 0,
            message: "Preparing FFT...",
        });

        try {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));

            const spectrum = await analyzeSpectrumFromSamples(samplesRef.current, result.sample_rate, {
                fftSize,
                windowFunction: toWindowFunction(windowFunction),
            }, (progress) => {
                if (token.cancelled) {
                    return;
                }

                setSpectrumProgress(toProgressState(progress));
            }, () => token.cancelled);

            if (token.cancelled) {
                return null;
            }

            const nextResult = {
                ...result,
                spectrum,
            };

            setResultWithSession(nextResult);
            return nextResult;
        }
        catch (err) {
            if (isCancelledError(err)) {
                return null;
            }

            const errorMessage = err instanceof Error ? err.message : "Failed to re-analyze spectrum";
            logger.error(`Spectrum re-analysis error: ${errorMessage}`);
            setSpectrumProgress({
                percent: 0,
                message: "Spectrum analysis failed",
            });
            toast.error("Spectrum Analysis Failed", {
                description: errorMessage,
            });
            return null;
        }
        finally {
            if (spectrumTokenRef.current === token) {
                spectrumTokenRef.current = null;
                setSpectrumLoading(false);
            }
        }
    }, [result, setResultWithSession]);

    const clearResult = useCallback(() => {
        cancelToken(analysisTokenRef);
        cancelToken(spectrumTokenRef);
        setAnalyzing(false);
        setResultWithSession(null);
        setErrorWithSession(null);
        setSelectedFilePathWithSession("");
        setSpectrumLoading(false);
        setAnalysisProgress(DEFAULT_PROGRESS_STATE);
        setSpectrumProgress(DEFAULT_PROGRESS_STATE);
        currentAnalysisKeyRef.current = "";
        sessionCurrentAnalysisKey = "";
        samplesRef.current = null;
        sessionSamples = null;
    }, [setErrorWithSession, setResultWithSession, setSelectedFilePathWithSession]);

    return {
        analyzing,
        analysisProgress,
        result,
        error,
        selectedFilePath,
        spectrumLoading,
        spectrumProgress,
        analyzeFile,
        analyzeFilePath,
        cancelAnalysis,
        loadStoredAnalysis,
        clearStoredAnalysis,
        reAnalyzeSpectrum,
        clearResult,
    };
}
