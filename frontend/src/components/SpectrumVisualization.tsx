import { useEffect, useRef, useState, useCallback } from "react";
import type { SpectrumData } from "@/types/api";
import { Label } from "@/components/ui/label";
import { forwardRef, useImperativeHandle } from "react";
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

type ColorScheme = "spek" | "viridis" | "hot" | "cool" | "grayscale";

function getColor(intensity: number, scheme: ColorScheme): string {
    const t = Math.max(0, Math.min(1, intensity));
    switch (scheme) {
        case "spek":
            return spekColor(t);
        case "viridis":
            return viridisColor(t);
        case "hot":
            return hotColor(t);
        case "cool":
            return coolColor(t);
        case "grayscale": {
            const v = Math.round(t * 255);
            return `rgb(${v},${v},${v})`;
        }
        default:
            return spekColor(t);
    }
}

function getColorRGB(intensity: number, scheme: ColorScheme): [number, number, number] {
    const t = Math.max(0, Math.min(1, intensity));
    const css = getColor(t, scheme);
    const m = css.match(/\d+/g)!;
    return [parseInt(m[0]), parseInt(m[1]), parseInt(m[2])];
}

function spekColor(t: number): string {
    if (t < 0.08) {
        const v = t / 0.08;
        return `rgb(0,0,${Math.round(v * 80)})`;
    }
    if (t < 0.18) {
        const v = (t - 0.08) / 0.10;
        return `rgb(${Math.round(v * 50)},${Math.round(v * 30)},${Math.round(80 + v * 175)})`;
    }
    if (t < 0.28) {
        const v = (t - 0.18) / 0.10;
        return `rgb(${Math.round(50 + v * 150)},${Math.round(30 - v * 30)},${Math.round(255 - v * 55)})`;
    }
    if (t < 0.40) {
        const v = (t - 0.28) / 0.12;
        return `rgb(${Math.round(200 + v * 55)},0,${Math.round(200 - v * 200)})`;
    }
    if (t < 0.52) {
        const v = (t - 0.40) / 0.12;
        return `rgb(255,${Math.round(v * 100)},0)`;
    }
    if (t < 0.65) {
        const v = (t - 0.52) / 0.13;
        return `rgb(255,${Math.round(100 + v * 80)},0)`;
    }
    if (t < 0.78) {
        const v = (t - 0.65) / 0.13;
        return `rgb(255,${Math.round(180 + v * 55)},${Math.round(v * 30)})`;
    }
    if (t < 0.90) {
        const v = (t - 0.78) / 0.12;
        return `rgb(255,${Math.round(235 + v * 20)},${Math.round(30 + v * 100)})`;
    }
    const v = (t - 0.90) / 0.10;
    return `rgb(255,255,${Math.round(130 + v * 125)})`;
}

function viridisColor(t: number): string {
    const stops: [number, number, number][] = [
        [68, 1, 84],
        [72, 36, 117],
        [62, 74, 137],
        [49, 104, 142],
        [38, 130, 142],
        [31, 158, 137],
        [53, 183, 121],
        [110, 206, 88],
        [181, 222, 43],
        [253, 231, 37],
    ];
    const i = t * (stops.length - 1);
    const lo = Math.floor(i);
    const hi = Math.min(lo + 1, stops.length - 1);
    const f = i - lo;
    const [r, g, b] = stops[lo].map((v, k) => Math.round(v + (stops[hi][k] - v) * f)) as [number, number, number];
    return `rgb(${r},${g},${b})`;
}

function hotColor(t: number): string {
    if (t < 0.33) {
        return `rgb(${Math.round(t / 0.33 * 255)},0,0)`;
    }
    if (t < 0.67) {
        return `rgb(255,${Math.round((t - 0.33) / 0.34 * 255)},0)`;
    }
    return `rgb(255,255,${Math.round((t - 0.67) / 0.33 * 255)})`;
}

function coolColor(t: number): string {
    if (t < 0.33) {
        return `rgb(0,0,${Math.round(128 + t / 0.33 * 127)})`;
    }
    if (t < 0.67) {
        return `rgb(0,${Math.round((t - 0.33) / 0.34 * 255)},255)`;
    }
    return `rgb(${Math.round((t - 0.67) / 0.33 * 255)},255,255)`;
}

type FreqScale = "linear" | "log2";

const MARGIN = { top: 50, right: 100, bottom: 50, left: 80 };
const CANVAS_W = 1200;
const CANVAS_H = 600;

function renderSpectrogram(
    ctx: CanvasRenderingContext2D,
    spectrum: SpectrumData,
    sampleRate: number,
    duration: number,
    freqScale: FreqScale,
    colorScheme: ColorScheme,
    fileName?: string,
) {
    const { top, right, bottom, left } = MARGIN;
    const pw = CANVAS_W - left - right;
    const ph = CANVAS_H - top - bottom;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    const slices = spectrum.time_slices;
    if (!slices || slices.length === 0)
        return;

    const numT = slices.length;
    const numF = slices[0].magnitudes.length;
    const maxFreq = spectrum.max_freq;

    let minDB = Infinity;
    let maxDB = -Infinity;
    for (const s of slices) {
        for (const v of s.magnitudes) {
            if (v > maxDB)
                maxDB = v;
            if (v < minDB && v > -200)
                minDB = v;
        }
    }
    minDB = Math.max(minDB, maxDB - 90);
    const dbRange = maxDB - minDB;

    const img = ctx.createImageData(pw, ph);
    const data = img.data;

    for (let x = 0; x < pw; x++) {
        const tProgress = x / (pw - 1);
        const tExact = tProgress * (numT - 1);
        const t0 = Math.floor(tExact);
        const t1 = Math.min(t0 + 1, numT - 1);
        const tf = tExact - t0;
        const frame0 = slices[t0].magnitudes;
        const frame1 = slices[t1].magnitudes;

        for (let y = 0; y < ph; y++) {
            let fProgress = (ph - 1 - y) / (ph - 1);

            if (freqScale === "log2") {
                const minF = 20;
                const octaves = Math.log2(maxFreq / minF);
                const freq = minF * Math.pow(2, fProgress * octaves);
                fProgress = freq / maxFreq;
            }

            const fExact = fProgress * (numF - 1);
            const f0 = Math.floor(fExact);
            const f1 = Math.min(f0 + 1, numF - 1);
            const ff = fExact - f0;

            const m00 = frame0[f0] ?? minDB;
            const m01 = frame0[f1] ?? minDB;
            const m10 = frame1[f0] ?? minDB;
            const m11 = frame1[f1] ?? minDB;
            const mag = (m00 * (1 - ff) + m01 * ff) * (1 - tf) + (m10 * (1 - ff) + m11 * ff) * tf;

            const norm = Math.max(0, Math.min(1, (mag - minDB) / dbRange));
            const [r, g, b] = getColorRGB(norm, colorScheme);
            const idx = (y * pw + x) * 4;
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = 255;
        }
    }

    ctx.putImageData(img, left, top);

    ctx.fillStyle = "#ccc";
    ctx.font = "12px 'Segoe UI', Arial";

    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    const freqLabels = buildFreqLabels(maxFreq, freqScale);
    for (const freq of freqLabels) {
        if (freq > maxFreq)
            continue;
        let yPos: number;
        if (freqScale === "log2") {
            const minF = 20;
            const norm = Math.log2(freq / minF) / Math.log2(maxFreq / minF);
            yPos = top + ph - norm * ph;
        } else {
            yPos = top + ph - (freq / maxFreq) * ph;
        }
        const label = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
        ctx.fillText(label, left - 8, yPos);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(left - 4, yPos);
        ctx.lineTo(left + pw, yPos);
        ctx.stroke();
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const timeStep = smartTimeStep(duration);
    for (let t = 0; t <= duration; t += timeStep) {
        const xPos = left + (t / duration) * pw;
        const label = timeStep >= 60
            ? `${Math.floor(t / 60)}m${t % 60 ? (t % 60) + "s" : ""}`
            : `${t}s`;
        ctx.fillText(label, xPos, top + ph + 8);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xPos, top);
        ctx.lineTo(xPos, top + ph + 4);
        ctx.stroke();
    }

    ctx.fillStyle = "#fff";
    ctx.font = "13px 'Segoe UI', Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("Time (seconds)", left + pw / 2, CANVAS_H - 12);

    ctx.save();
    ctx.translate(24, top + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = "middle";
    ctx.fillText("Frequency (Hz)", 0, 0);
    ctx.restore();

    ctx.font = "12px 'Segoe UI', Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    if (fileName)
        ctx.fillText(fileName, left, 26);

    ctx.textAlign = "right";
    ctx.fillText(`Sample Rate: ${sampleRate} Hz`, left + pw, 26);

    const cbX = left + pw + 25;
    const cbW = 14;
    for (let i = 0; i < ph; i++) {
        const norm = 1 - i / ph;
        ctx.fillStyle = getColor(norm, colorScheme);
        ctx.fillRect(cbX, top + i, cbW, 1);
    }
    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(cbX, top, cbW, ph);

    ctx.fillStyle = "#fff";
    ctx.font = "10px 'Segoe UI', Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("High", cbX + cbW + 6, top + 6);
    ctx.fillText("Low", cbX + cbW + 6, top + ph - 6);
}

function buildFreqLabels(maxFreq: number, scale: FreqScale): number[] {
    if (scale === "log2") {
        const labels: number[] = [];
        for (let f = 20; f <= maxFreq; f *= 2)
            labels.push(f);
        for (let f = 100; f <= maxFreq; f *= 10)
            labels.push(f);
        return [...new Set(labels)].sort((a, b) => a - b);
    }
    if (maxFreq <= 24000)
        return [2000, 4000, 6000, 8000, 10000, 12000, 14000, 16000, 18000, 20000, 22000];
    if (maxFreq <= 48000)
        return [5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000, 45000];
    if (maxFreq <= 96000)
        return [10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000];
    return [20000, 40000, 60000, 80000, 100000, 120000, 140000, 160000, 180000];
}

function smartTimeStep(duration: number): number {
    if (duration <= 30)
        return 5;
    if (duration <= 60)
        return 10;
    if (duration <= 120)
        return 15;
    if (duration <= 300)
        return 30;
    if (duration <= 600)
        return 60;
    return 120;
}

const COLOR_SCHEMES: { value: ColorScheme; label: string; gradient: string; }[] = [
    { value: "spek", label: "Spek", gradient: "linear-gradient(to right, #000050, #1e0080, #4000ff, #8000ff, #ff0080, #ff4000, #ff8000, #ffff00)" },
    { value: "viridis", label: "Viridis", gradient: "linear-gradient(to right, #440154, #31688e, #35b779, #fde725)" },
    { value: "hot", label: "Hot", gradient: "linear-gradient(to right, #000, #f00, #ff0, #fff)" },
    { value: "cool", label: "Cool", gradient: "linear-gradient(to right, #000080, #0000ff, #00ffff, #ffffff)" },
    { value: "grayscale", label: "Grayscale", gradient: "linear-gradient(to right, #000, #fff)" },
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

    useImperativeHandle(ref, () => ({
        getCanvasDataURL: () => {
            if (!canvasRef.current)
                return null;
            return canvasRef.current.toDataURL("image/png");
        }
    }));

    const [freqScale, setFreqScale] = useState<FreqScale>("linear");
    const [colorScheme, setColorScheme] = useState<ColorScheme>("spek");

    const [fftSize, setFftSize] = useState<string>(() => {
        if (spectrumData && spectrumData.freq_bins) {
            return String(spectrumData.freq_bins * 2);
        }
        return "4096";
    });
    const [windowFunction, setWindowFunction] = useState<string>("hann");

    useEffect(() => {
        if (spectrumData && spectrumData.freq_bins) {
            setFftSize(String(spectrumData.freq_bins * 2));
        }
    }, [spectrumData]);

    const handleReAnalyze = (newFftSize: string, newWindowFunc: string) => {
        setFftSize(newFftSize);
        setWindowFunction(newWindowFunc);
        if (onReAnalyze) {
            onReAnalyze(parseInt(newFftSize), newWindowFunc);
        }
    };

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas)
            return;
        const ctx = canvas.getContext("2d");
        if (!ctx)
            return;

        if (spectrumData) {
            renderSpectrogram(ctx, spectrumData, sampleRate, duration, freqScale, colorScheme, fileName);
        } else {
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
            ctx.fillStyle = "#444";
            ctx.font = "16px Arial";
            ctx.textAlign = "center";
            ctx.fillText("No spectrum data", CANVAS_W / 2, CANVAS_H / 2);
        }
    }, [spectrumData, sampleRate, duration, freqScale, colorScheme, fileName]);

    useEffect(() => { draw(); }, [draw]);

    useEffect(() => { draw(); }, [draw]);

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
                            {COLOR_SCHEMES.map((s) => (
                                <SelectItem key={s.value} value={s.value}>
                                    <div className="flex items-center gap-2">
                                        <div
                                            className="h-4 w-4 rounded-sm border opacity-90"
                                            style={{ backgroundImage: s.gradient }}
                                        />
                                        <span>{s.label}</span>
                                    </div>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="h-6 w-px bg-border hidden sm:block mx-1"></div>

                <div className="flex items-center gap-2">
                    <Label className="whitespace-nowrap text-sm font-medium">Freq Scale:</Label>
                    <Select value={freqScale} onValueChange={(v) => { if (v) setFreqScale(v as FreqScale); }} disabled={isAnalyzingSpectrum}>
                        <SelectTrigger className="h-8 w-[90px] text-sm">
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
                        <SelectTrigger className="h-8 w-[115px] text-sm capitalize">
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
