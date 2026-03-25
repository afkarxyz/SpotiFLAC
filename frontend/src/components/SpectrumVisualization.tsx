import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import type { SpectrumData } from "@/types/api";
import { Label } from "@/components/ui/label";
import {
    loadAudioAnalysisPreferences,
    saveAudioAnalysisPreferences,
    type AnalyzerColorScheme,
    type AnalyzerFreqScale,
    type AnalyzerWindowFunction,
} from "@/lib/audio-analysis-preferences";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

export interface SpectrumVisualizationHandle {
    getCanvasDataURL: () => string | null;
}

interface SpectrumVisualizationProps {
    sampleRate: number;
    duration: number;
    spectrumData?: SpectrumData;
    fileName?: string;
    onReAnalyze?: (fftSize: number, windowFunction: string) => void;
    isAnalyzingSpectrum?: boolean;
}

type ColorScheme = AnalyzerColorScheme;
type FreqScale = AnalyzerFreqScale;
type WindowFunction = AnalyzerWindowFunction;

const MARGIN = { top: 50, right: 120, bottom: 70, left: 90 };
const CANVAS_W = 1100;
const CANVAS_H = 600;
const MAX_RENDER_HEIGHT = 1080;

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function spekColorMap(t: number): [number, number, number] {
    const colors: Array<[number, number, number]> = [
        [0, 0, 0],
        [0, 0, 25],
        [0, 0, 50],
        [0, 0, 80],
        [20, 0, 120],
        [50, 0, 150],
        [80, 0, 180],
        [120, 0, 120],
        [150, 0, 80],
        [180, 0, 40],
        [210, 0, 0],
        [240, 30, 0],
        [255, 60, 0],
        [255, 100, 0],
        [255, 140, 0],
        [255, 180, 0],
        [255, 210, 0],
        [255, 235, 0],
        [255, 250, 50],
        [255, 255, 100],
        [255, 255, 150],
        [255, 255, 200],
        [255, 255, 255],
    ];

    const scaled = t * (colors.length - 1);
    const idx = Math.floor(scaled);
    const fraction = scaled - idx;

    if (idx >= colors.length - 1) {
        return colors[colors.length - 1];
    }

    const c1 = colors[idx];
    const c2 = colors[idx + 1];
    return [
        Math.round(c1[0] + (c2[0] - c1[0]) * fraction),
        Math.round(c1[1] + (c2[1] - c1[1]) * fraction),
        Math.round(c1[2] + (c2[2] - c1[2]) * fraction),
    ];
}

function viridisColorMap(t: number): [number, number, number] {
    const colors: Array<[number, number, number]> = [
        [68, 1, 84],
        [70, 20, 100],
        [72, 40, 120],
        [67, 62, 133],
        [62, 74, 137],
        [55, 89, 140],
        [49, 104, 142],
        [43, 117, 142],
        [38, 130, 142],
        [35, 144, 140],
        [31, 158, 137],
        [42, 171, 129],
        [53, 183, 121],
        [81, 194, 105],
        [109, 205, 89],
        [144, 214, 67],
        [180, 222, 44],
        [216, 227, 41],
        [253, 231, 37],
    ];

    const scaled = t * (colors.length - 1);
    const idx = Math.floor(scaled);
    const fraction = scaled - idx;

    if (idx >= colors.length - 1) {
        return colors[colors.length - 1];
    }

    const c1 = colors[idx];
    const c2 = colors[idx + 1];
    return [
        Math.floor(c1[0] + (c2[0] - c1[0]) * fraction),
        Math.floor(c1[1] + (c2[1] - c1[1]) * fraction),
        Math.floor(c1[2] + (c2[2] - c1[2]) * fraction),
    ];
}

function hotColorMap(t: number): [number, number, number] {
    if (t < 0.33) {
        return [Math.floor(t * 3 * 255), 0, 0];
    }
    if (t < 0.66) {
        return [255, Math.floor((t - 0.33) * 3 * 255), 0];
    }
    return [255, 255, Math.floor((t - 0.66) * 3 * 255)];
}

function coolColorMap(t: number): [number, number, number] {
    return [Math.floor(t * 255), Math.floor((1 - t) * 255), 255];
}

function getColorValues(norm: number, scheme: ColorScheme): [number, number, number] {
    const value = clamp01(norm);
    switch (scheme) {
        case "spek":
            return spekColorMap(value);
        case "viridis":
            return viridisColorMap(value);
        case "hot":
            return hotColorMap(value);
        case "cool":
            return coolColorMap(value);
        case "grayscale":
        default: {
            const gray = Math.floor(value * 255);
            return [gray, gray, gray];
        }
    }
}

function getColorString(norm: number, scheme: ColorScheme): string {
    const [r, g, b] = getColorValues(norm, scheme);
    return `rgb(${r},${g},${b})`;
}

function addAxisLabels(
    ctx: CanvasRenderingContext2D,
    plotWidth: number,
    plotHeight: number,
    sampleRate: number,
    duration: number,
    freqScale: FreqScale,
    fileName?: string,
) {
    ctx.fillStyle = "#ffffff";
    ctx.font = "12px Segoe UI";

    ctx.textAlign = "center";
    const widthFactor = plotWidth / 1000;
    let timeStep: number;

    if (duration <= 10) {
        timeStep = widthFactor >= 1.8 ? 0.25 : (widthFactor >= 1.3 ? 0.5 : 0.5);
    } else if (duration <= 30) {
        timeStep = widthFactor >= 1.8 ? 0.5 : (widthFactor >= 1.3 ? 1 : 1);
    } else if (duration <= 120) {
        timeStep = widthFactor >= 1.8 ? 3 : (widthFactor >= 1.3 ? 4 : 5);
    } else if (duration <= 600) {
        timeStep = widthFactor >= 1.8 ? 10 : (widthFactor >= 1.3 ? 15 : 20);
    } else {
        timeStep = widthFactor >= 1.8 ? 20 : (widthFactor >= 1.3 ? 30 : 40);
    }

    if (duration > 0) {
        for (let time = 0; time <= duration + 1e-9; time += timeStep) {
            const timeProgress = time / duration;
            const x = MARGIN.left + timeProgress * (plotWidth - 1);
            const y = CANVAS_H - MARGIN.bottom + 20;

            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, MARGIN.top + plotHeight);
            ctx.lineTo(x, MARGIN.top + plotHeight + 5);
            ctx.stroke();

            let label: string;
            if (timeStep >= 60) {
                const minutes = Math.floor(time / 60);
                const seconds = time % 60;
                label = seconds === 0 ? `${minutes}m` : `${minutes}m${seconds}s`;
            } else {
                label = `${time}s`;
            }
            ctx.fillText(label, x, y);
        }
    }

    ctx.textAlign = "right";
    const maxFreq = sampleRate / 2;

    if (freqScale === "log2") {
        const heightFactor = plotHeight / 500;
        const minFreq = 20;
        const frequencies: number[] = [];
        const octaveStep = heightFactor >= 1.5 ? 1 : (heightFactor >= 1.0 ? 1 : 2);

        let octaveCount = 0;
        for (let freq = minFreq; freq <= maxFreq; freq *= 2) {
            if (octaveCount % octaveStep === 0) {
                frequencies.push(freq);
            }
            octaveCount++;
        }

        for (const freq of frequencies) {
            const freqNormalized = Math.log2(freq / minFreq) / Math.log2(maxFreq / minFreq);
            const y = MARGIN.top + plotHeight * (1 - freqNormalized);

            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(MARGIN.left - 5, y);
            ctx.lineTo(MARGIN.left, y);
            ctx.stroke();

            const label = freq >= 1000 ? `${(freq / 1000).toFixed(1)}k` : `${freq}`;
            ctx.fillText(label, MARGIN.left - 10, y + 4);
        }
    } else {
        const heightFactor = plotHeight / 500;
        let freqStep: number;

        if (maxFreq <= 8000) {
            freqStep = heightFactor >= 1.8 ? 250 : (heightFactor >= 1.3 ? 400 : 500);
        } else if (maxFreq <= 16000) {
            freqStep = heightFactor >= 1.8 ? 500 : (heightFactor >= 1.3 ? 800 : 1000);
        } else if (maxFreq <= 24000) {
            freqStep = heightFactor >= 1.8 ? 1000 : (heightFactor >= 1.3 ? 1500 : 2000);
        } else {
            freqStep = heightFactor >= 1.8 ? 2000 : (heightFactor >= 1.3 ? 2500 : 4000);
        }

        for (let freq = 0; freq <= maxFreq; freq += freqStep) {
            const y = MARGIN.top + plotHeight - (freq / maxFreq) * plotHeight + 4;
            const x = MARGIN.left - 15;

            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(MARGIN.left - 5, y - 4);
            ctx.lineTo(MARGIN.left, y - 4);
            ctx.stroke();

            let label: string;
            if (freq === 0) {
                label = "0";
            } else if (freq >= 1000) {
                label = freq % 1000 === 0 ? `${freq / 1000}k` : `${(freq / 1000).toFixed(1)}k`;
            } else {
                label = `${freq}`;
            }
            ctx.fillText(label, x, y);
        }
    }

    ctx.textAlign = "center";
    ctx.font = "14px Segoe UI";
    ctx.fillText("Time (seconds)", CANVAS_W / 2, CANVAS_H - 15);

    ctx.save();
    ctx.translate(25, CANVAS_H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("Frequency (Hz)", 0, 0);
    ctx.restore();

    ctx.font = "12px Segoe UI";
    if (fileName) {
        ctx.textAlign = "left";
        ctx.fillText(fileName, MARGIN.left + 15, 25);
    }

    ctx.textAlign = "right";
    ctx.fillText(`Sample Rate: ${sampleRate} Hz`, CANVAS_W - 20, 25);
}

function drawColorBar(
    ctx: CanvasRenderingContext2D,
    plotHeight: number,
    colorScheme: ColorScheme,
) {
    const colorBarWidth = 20;
    const colorBarX = CANVAS_W - MARGIN.right + 30;
    const colorBarY = MARGIN.top;
    const gradient = ctx.createLinearGradient(0, colorBarY + plotHeight, 0, colorBarY);

    for (let i = 0; i <= 100; i++) {
        const value = i / 100;
        gradient.addColorStop(value, getColorString(value, colorScheme));
    }

    ctx.fillStyle = gradient;
    ctx.fillRect(colorBarX, colorBarY, colorBarWidth, plotHeight);

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.strokeRect(colorBarX, colorBarY, colorBarWidth, plotHeight);

    ctx.fillStyle = "#ffffff";
    ctx.font = "10px Segoe UI";
    ctx.textAlign = "left";
    ctx.fillText("High", colorBarX + colorBarWidth + 5, colorBarY + 12);
    ctx.fillText("Low", colorBarX + colorBarWidth + 5, colorBarY + plotHeight - 5);
}

async function renderSpectrogram(
    ctx: CanvasRenderingContext2D,
    spectrum: SpectrumData,
    sampleRate: number,
    duration: number,
    freqScale: FreqScale,
    colorScheme: ColorScheme,
    fileName: string | undefined,
    shouldCancel: () => boolean,
) {
    const plotWidth = CANVAS_W - MARGIN.left - MARGIN.right;
    const plotHeight = CANVAS_H - MARGIN.top - MARGIN.bottom;

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    const spectrogramData = spectrum.time_slices;
    const numTimeFrames = spectrogramData.length;
    const numFreqBins = spectrogramData[0]?.magnitudes.length ?? 0;
    if (numTimeFrames === 0 || numFreqBins === 0) {
        return;
    }

    let minMag = Number.POSITIVE_INFINITY;
    let maxMag = Number.NEGATIVE_INFINITY;
    const sampleStep = numTimeFrames > 10000 ? Math.floor(numTimeFrames / 5000) : 1;

    for (let i = 0; i < numTimeFrames; i += sampleStep) {
        const frame = spectrogramData[i].magnitudes;
        for (const mag of frame) {
            if (Number.isFinite(mag)) {
                if (mag < minMag)
                    minMag = mag;
                if (mag > maxMag)
                    maxMag = mag;
            }
        }
    }

    if (!Number.isFinite(minMag) || !Number.isFinite(maxMag)) {
        minMag = -120;
        maxMag = 0;
    }

    const magRange = maxMag - minMag;
    const safeMagRange = magRange > 0 ? magRange : 1;

    const highResImageData = ctx.createImageData(plotWidth, MAX_RENDER_HEIGHT);
    const highResData = highResImageData.data;
    const CHUNK_SIZE = 50;

    for (let xStart = 0; xStart < plotWidth; xStart += CHUNK_SIZE) {
        if (shouldCancel()) {
            return;
        }

        const xEnd = Math.min(xStart + CHUNK_SIZE, plotWidth);
        for (let x = xStart; x < xEnd; x++) {
            const timeProgress = x / (plotWidth - 1);
            const exactTimePos = timeProgress * (numTimeFrames - 1);
            const timeIdx = Math.floor(exactTimePos);
            const timeIdx2 = Math.min(timeIdx + 1, numTimeFrames - 1);
            const timeFrac = exactTimePos - timeIdx;

            const frame1 = spectrogramData[timeIdx]?.magnitudes ?? spectrogramData[0].magnitudes;
            const frame2 = spectrogramData[timeIdx2]?.magnitudes ?? frame1;

            for (let y = 0; y < MAX_RENDER_HEIGHT; y++) {
                let freqProgress = (MAX_RENDER_HEIGHT - 1 - y) / (MAX_RENDER_HEIGHT - 1);

                if (freqScale === "log2") {
                    const minFreq = 20;
                    const maxFreq = sampleRate / 2;
                    const octaves = Math.log2(maxFreq / minFreq);
                    const octave = freqProgress * octaves;
                    const freq = minFreq * Math.pow(2, octave);
                    freqProgress = freq / maxFreq;
                }

                const exactFreqPos = freqProgress * (numFreqBins - 1);
                const freqIdx = Math.floor(exactFreqPos);
                const freqIdx2 = Math.min(freqIdx + 1, numFreqBins - 1);
                const freqFrac = exactFreqPos - freqIdx;

                let magnitude: number;
                if (timeFrac === 0 && freqFrac === 0) {
                    magnitude = frame1[freqIdx] ?? 0;
                } else {
                    const mag11 = frame1[freqIdx] ?? 0;
                    const mag12 = frame1[freqIdx2] ?? 0;
                    const mag21 = frame2[freqIdx] ?? 0;
                    const mag22 = frame2[freqIdx2] ?? 0;

                    const magT1 = mag11 * (1 - freqFrac) + mag12 * freqFrac;
                    const magT2 = mag21 * (1 - freqFrac) + mag22 * freqFrac;
                    magnitude = magT1 * (1 - timeFrac) + magT2 * timeFrac;
                }

                const normalizedMag = clamp01((magnitude - minMag) / safeMagRange);
                const [r, g, b] = getColorValues(normalizedMag, colorScheme);
                const pixelIdx = (y * plotWidth + x) * 4;
                highResData[pixelIdx] = r;
                highResData[pixelIdx + 1] = g;
                highResData[pixelIdx + 2] = b;
                highResData[pixelIdx + 3] = 255;
            }
        }

        if (xStart + CHUNK_SIZE < plotWidth) {
            await new Promise((resolve) => setTimeout(resolve, 1));
        }
    }

    if (shouldCancel()) {
        return;
    }

    const finalImageData = ctx.createImageData(plotWidth, plotHeight);
    const finalData = finalImageData.data;

    for (let y = 0; y < plotHeight; y++) {
        for (let x = 0; x < plotWidth; x++) {
            const highResY = Math.round((y / plotHeight) * MAX_RENDER_HEIGHT);
            const highResIdx = (highResY * plotWidth + x) * 4;
            const finalIdx = (y * plotWidth + x) * 4;

            if (highResIdx < highResData.length) {
                finalData[finalIdx] = highResData[highResIdx];
                finalData[finalIdx + 1] = highResData[highResIdx + 1];
                finalData[finalIdx + 2] = highResData[highResIdx + 2];
                finalData[finalIdx + 3] = highResData[highResIdx + 3];
            }
        }
    }

    ctx.putImageData(finalImageData, MARGIN.left, MARGIN.top);
    addAxisLabels(ctx, plotWidth, plotHeight, sampleRate, duration, freqScale, fileName);
    drawColorBar(ctx, plotHeight, colorScheme);
}

const COLOR_SCHEMES: { value: ColorScheme; label: string; gradient: string; }[] = [
    { value: "spek", label: "Spek", gradient: "linear-gradient(to right, #0f0040, #1e0080, #4000ff, #8000ff, #ff0080, #ff4000, #ff8000, #ffff00)" },
    { value: "viridis", label: "Viridis", gradient: "linear-gradient(to right, #440154, #31688e, #35b779, #fde725)" },
    { value: "hot", label: "Hot", gradient: "linear-gradient(to right, #000000, #ff0000, #ffff00, #ffffff)" },
    { value: "cool", label: "Cool", gradient: "linear-gradient(to right, #000080, #0000ff, #00ffff, #ffffff)" },
    { value: "grayscale", label: "Grayscale", gradient: "linear-gradient(to right, #000000, #ffffff)" },
];

export const SpectrumVisualization = forwardRef<SpectrumVisualizationHandle, SpectrumVisualizationProps>(({
    sampleRate,
    duration,
    spectrumData,
    fileName,
    onReAnalyze,
    isAnalyzingSpectrum,
}, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const preferencesRef = useRef(loadAudioAnalysisPreferences());

    useImperativeHandle(ref, () => ({
        getCanvasDataURL: () => {
            if (!canvasRef.current)
                return null;
            return canvasRef.current.toDataURL("image/png");
        },
    }));

    const [freqScale, setFreqScale] = useState<FreqScale>(preferencesRef.current.freqScale);
    const [colorScheme, setColorScheme] = useState<ColorScheme>(preferencesRef.current.colorScheme);
    const [fftSize, setFftSize] = useState<string>(() => String(preferencesRef.current.fftSize));
    const [windowFunction, setWindowFunction] = useState<WindowFunction>(preferencesRef.current.windowFunction);

    useEffect(() => {
        if (spectrumData?.freq_bins) {
            setFftSize(String((spectrumData.freq_bins - 1) * 2));
        }
    }, [spectrumData]);

    useEffect(() => {
        saveAudioAnalysisPreferences({
            colorScheme,
            freqScale,
            fftSize: Number(fftSize),
            windowFunction,
        });
    }, [colorScheme, freqScale, fftSize, windowFunction]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas)
            return;
        const ctx = canvas.getContext("2d");
        if (!ctx)
            return;

        let canceled = false;
        const shouldCancel = () => canceled;

        if (spectrumData) {
            void renderSpectrogram(
                ctx,
                spectrumData,
                sampleRate,
                duration,
                freqScale,
                colorScheme,
                fileName,
                shouldCancel,
            );
        } else {
            ctx.fillStyle = "#000000";
            ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
            ctx.fillStyle = "#444444";
            ctx.font = "16px Arial";
            ctx.textAlign = "center";
            ctx.fillText("No spectrum data", CANVAS_W / 2, CANVAS_H / 2);
        }

        return () => {
            canceled = true;
        };
    }, [spectrumData, sampleRate, duration, freqScale, colorScheme, fileName]);

    const handleReAnalyze = (newFftSize: string, newWindowFunc: string) => {
        setFftSize(newFftSize);
        setWindowFunction(newWindowFunc as WindowFunction);
        if (onReAnalyze) {
            onReAnalyze(parseInt(newFftSize, 10), newWindowFunc);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 sm:gap-4 p-1">
                <div className="flex items-center gap-2">
                    <Label className="whitespace-nowrap text-sm font-medium">Color Scheme:</Label>
                    <Select value={colorScheme} onValueChange={(v) => setColorScheme(v as ColorScheme)} disabled={isAnalyzingSpectrum}>
                        <SelectTrigger className="h-8 w-[130px] text-sm">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {COLOR_SCHEMES.map((scheme) => (
                                <SelectItem key={scheme.value} value={scheme.value}>
                                    <div className="flex items-center gap-2">
                                        <div
                                            className="h-4 w-4 rounded-sm border opacity-90"
                                            style={{ backgroundImage: scheme.gradient }}
                                        />
                                        <span>{scheme.label}</span>
                                    </div>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="h-6 w-px bg-border hidden sm:block mx-1"></div>

                <div className="flex items-center gap-2">
                    <Label className="whitespace-nowrap text-sm font-medium">Freq Scale:</Label>
                    <Select value={freqScale} onValueChange={(v) => setFreqScale(v as FreqScale)} disabled={isAnalyzingSpectrum}>
                        <SelectTrigger className="h-8 w-[95px] text-sm">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="linear">Linear</SelectItem>
                            <SelectItem value="log2">Log2</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div className="flex items-center gap-2">
                    <Label className="whitespace-nowrap text-sm font-medium">FFT Size:</Label>
                    <Select value={fftSize} onValueChange={(v) => handleReAnalyze(v, windowFunction)} disabled={isAnalyzingSpectrum}>
                        <SelectTrigger className="h-8 w-[90px] text-sm">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="512">512</SelectItem>
                            <SelectItem value="1024">1024</SelectItem>
                            <SelectItem value="2048">2048</SelectItem>
                            <SelectItem value="4096">4096</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div className="flex items-center gap-2">
                    <Label className="whitespace-nowrap text-sm font-medium">Window:</Label>
                    <Select value={windowFunction} onValueChange={(v) => handleReAnalyze(fftSize, v)} disabled={isAnalyzingSpectrum}>
                        <SelectTrigger className="h-8 w-[120px] text-sm capitalize">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="hann">Hann</SelectItem>
                            <SelectItem value="hamming">Hamming</SelectItem>
                            <SelectItem value="blackman">Blackman</SelectItem>
                            <SelectItem value="rectangular">Rectangular</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            <div className="relative border border-white/10 rounded-lg overflow-hidden bg-black shadow-xl">
                {isAnalyzingSpectrum && (
                    <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center z-10 backdrop-blur-sm">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-2"></div>
                        <p className="text-sm text-foreground">Re-analyzing spectrum...</p>
                    </div>
                )}
                <canvas
                    ref={canvasRef}
                    width={CANVAS_W}
                    height={CANVAS_H}
                    className="w-full h-auto"
                    style={{ imageRendering: "auto" }}
                />
            </div>
        </div>
    );
});
