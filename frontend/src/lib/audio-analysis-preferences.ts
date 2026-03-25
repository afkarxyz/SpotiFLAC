export type AnalyzerColorScheme = "spek" | "viridis" | "hot" | "cool" | "grayscale";
export type AnalyzerFreqScale = "linear" | "log2";
export type AnalyzerWindowFunction = "hann" | "hamming" | "blackman" | "rectangular";

export interface AudioAnalysisPreferences {
    colorScheme: AnalyzerColorScheme;
    freqScale: AnalyzerFreqScale;
    fftSize: number;
    windowFunction: AnalyzerWindowFunction;
}

const STORAGE_KEY = "spotiflac_audio_analysis_preferences";

const DEFAULT_PREFERENCES: AudioAnalysisPreferences = {
    colorScheme: "spek",
    freqScale: "linear",
    fftSize: 4096,
    windowFunction: "hann",
};

const FFT_SIZE_SET = new Set([512, 1024, 2048, 4096]);

function toColorScheme(value: unknown): AnalyzerColorScheme {
    return value === "viridis" || value === "hot" || value === "cool" || value === "grayscale"
        ? value
        : "spek";
}

function toFreqScale(value: unknown): AnalyzerFreqScale {
    return value === "log2" ? "log2" : "linear";
}

function toFFTSize(value: unknown): number {
    const num = typeof value === "number" ? value : Number(value);
    return FFT_SIZE_SET.has(num) ? num : 4096;
}

function toWindowFunction(value: unknown): AnalyzerWindowFunction {
    return value === "hamming" || value === "blackman" || value === "rectangular"
        ? value
        : "hann";
}

export function loadAudioAnalysisPreferences(): AudioAnalysisPreferences {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw)
            return DEFAULT_PREFERENCES;

        const parsed = JSON.parse(raw) as Partial<AudioAnalysisPreferences>;
        return {
            colorScheme: toColorScheme(parsed.colorScheme),
            freqScale: toFreqScale(parsed.freqScale),
            fftSize: toFFTSize(parsed.fftSize),
            windowFunction: toWindowFunction(parsed.windowFunction),
        };
    }
    catch {
        return DEFAULT_PREFERENCES;
    }
}

export function saveAudioAnalysisPreferences(preferences: AudioAnalysisPreferences): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            colorScheme: toColorScheme(preferences.colorScheme),
            freqScale: toFreqScale(preferences.freqScale),
            fftSize: toFFTSize(preferences.fftSize),
            windowFunction: toWindowFunction(preferences.windowFunction),
        }));
    }
    catch {
        // Ignore persistence errors.
    }
}
