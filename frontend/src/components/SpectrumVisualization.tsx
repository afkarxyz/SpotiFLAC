import { useEffect, useRef } from "react";
import type { SpectrumData } from "@/types/api";

interface SpectrumVisualizationProps {
  sampleRate: number;
  bitsPerSample: number;
  duration: number;
  spectrumData?: SpectrumData;
}

export function SpectrumVisualization({
  sampleRate,
  bitsPerSample,
  duration,
  spectrumData,
}: SpectrumVisualizationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Calculate margins for labels
    const marginLeft = 70; // More space for Frequency label
    const marginRight = 70; // Space for color bar
    const marginTop = 30; // More space at top
    const marginBottom = 65; // More space at bottom for Time label

    const plotWidth = width - marginLeft - marginRight;
    const plotHeight = height - marginTop - marginBottom;

    // Black background
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, width, height);

    // Calculate Nyquist frequency
    const nyquistFreq = sampleRate / 2;

    if (spectrumData) {
      drawRealSpectrum(
        ctx,
        marginLeft,
        marginTop,
        plotWidth,
        plotHeight,
        spectrumData
      );
    }

    // Draw axes, labels, and color bar
    drawAxesAndLabels(ctx, marginLeft, marginTop, plotWidth, plotHeight, nyquistFreq, duration, sampleRate);
    drawColorBar(ctx, marginLeft + plotWidth + 15, marginTop, 20, plotHeight);
  }, [sampleRate, bitsPerSample, duration, spectrumData]);

  const drawRealSpectrum = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    spectrum: SpectrumData
  ) => {
    const timeSlices = spectrum.time_slices;
    if (timeSlices.length === 0) return;

    const freqBins = timeSlices[0].magnitudes.length;
    const nyquistFreq = spectrum.max_freq;

    // Find min/max dB values
    let minDB = 0;
    let maxDB = -200;

    timeSlices.forEach((slice) => {
      slice.magnitudes.forEach((db) => {
        if (db > maxDB) maxDB = db;
        if (db < minDB && db > -200) minDB = db;
      });
    });

    // Clamp range for better visualization
    minDB = Math.max(minDB, maxDB - 90); // 90dB dynamic range
    const dbRange = maxDB - minDB;

    const sliceWidth = Math.ceil(width / timeSlices.length);

    for (let t = 0; t < timeSlices.length; t++) {
      const slice = timeSlices[t];
      const xPos = x + (t / timeSlices.length) * width;

      for (let f = 0; f < freqBins && f < slice.magnitudes.length; f++) {
        const db = slice.magnitudes[f];

        // Linear frequency scale
        const freq = (f / freqBins) * nyquistFreq;
        const freqRatio = freq / nyquistFreq;
        
        const yPos = y + height - (freqRatio * height);

        // Calculate bin height
        const nextFreq = ((f + 1) / freqBins) * nyquistFreq;
        const nextFreqRatio = nextFreq / nyquistFreq;
        const nextYPos = y + height - (nextFreqRatio * height);
        
        const binHeight = Math.max(1, Math.abs(yPos - nextYPos) + 1);

        // Normalize intensity
        const intensity = Math.max(0, Math.min(1, (db - minDB) / dbRange));

        const color = getSpekColor(intensity);
        ctx.fillStyle = color;
        ctx.fillRect(xPos, nextYPos, sliceWidth, binHeight);
      }
    }
  };

  // Vibrant color scheme like Spek - NGEJERENG!
  const getSpekColor = (intensity: number): string => {
    if (intensity < 0.08) {
      // Black to deep blue
      const t = intensity / 0.08;
      return `rgb(0, 0, ${Math.floor(t * 80)})`;
    } else if (intensity < 0.18) {
      // Deep blue to bright blue
      const t = (intensity - 0.08) / 0.10;
      return `rgb(${Math.floor(t * 50)}, ${Math.floor(t * 30)}, ${Math.floor(80 + t * 175)})`;
    } else if (intensity < 0.28) {
      // Blue to magenta/purple
      const t = (intensity - 0.18) / 0.10;
      return `rgb(${Math.floor(50 + t * 150)}, ${Math.floor(30 - t * 30)}, ${Math.floor(255 - t * 55)})`;
    } else if (intensity < 0.40) {
      // Magenta to bright red
      const t = (intensity - 0.28) / 0.12;
      return `rgb(${Math.floor(200 + t * 55)}, 0, ${Math.floor(200 - t * 200)})`;
    } else if (intensity < 0.52) {
      // Red to orange-red
      const t = (intensity - 0.40) / 0.12;
      return `rgb(255, ${Math.floor(t * 100)}, 0)`;
    } else if (intensity < 0.65) {
      // Orange-red to bright orange
      const t = (intensity - 0.52) / 0.13;
      return `rgb(255, ${Math.floor(100 + t * 80)}, 0)`;
    } else if (intensity < 0.78) {
      // Orange to yellow-orange
      const t = (intensity - 0.65) / 0.13;
      return `rgb(255, ${Math.floor(180 + t * 55)}, ${Math.floor(t * 30)})`;
    } else if (intensity < 0.90) {
      // Yellow-orange to bright yellow
      const t = (intensity - 0.78) / 0.12;
      return `rgb(255, ${Math.floor(235 + t * 20)}, ${Math.floor(30 + t * 100)})`;
    } else {
      // Yellow to white (hottest)
      const t = (intensity - 0.90) / 0.10;
      return `rgb(255, 255, ${Math.floor(130 + t * 125)})`;
    }
  };

  const drawAxesAndLabels = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    nyquistFreq: number,
    duration: number,
    sampleRate: number
  ) => {
    // Frequency labels on Y-axis
    ctx.fillStyle = "#CCCCCC";
    ctx.font = "12px Arial";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    // Generate frequency labels based on Nyquist
    const freqLabels = generateFreqLabels(nyquistFreq);
    
    freqLabels.forEach(freq => {
      if (freq <= nyquistFreq) {
        const freqRatio = freq / nyquistFreq;
        const yPos = y + height - (freqRatio * height);
        const label = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
        ctx.fillText(label, x - 8, yPos);
      }
    });

    // "0" at bottom
    ctx.fillText("0", x - 8, y + height);

    // Time labels on X-axis
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    const timeStep = getTimeStep(duration);
    for (let t = 0; t <= duration; t += timeStep) {
      const xPos = x + (t / duration) * width;
      ctx.fillText(`${Math.round(t)}s`, xPos, y + height + 8);
    }

    // Axis titles
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "13px Arial";

    // Y-axis title: "Frequency (Hz)"
    ctx.save();
    ctx.translate(12, y + height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText("Frequency (Hz)", 0, 0);
    ctx.restore();

    // X-axis title: "Time (seconds)"
    ctx.textAlign = "center";
    ctx.fillText("Time (seconds)", x + width / 2, y + height + 35);

    // Sample rate info in top right
    ctx.textAlign = "right";
    ctx.fillStyle = "#CCCCCC";
    ctx.font = "12px Arial";
    ctx.fillText(`Sample Rate: ${sampleRate} Hz`, x + width - 5, y - 3);
  };

  const generateFreqLabels = (nyquistFreq: number): number[] => {
    if (nyquistFreq <= 24000) {
      return [2000, 4000, 6000, 8000, 10000, 12000, 14000, 16000, 18000, 20000, 22000];
    } else if (nyquistFreq <= 48000) {
      return [5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000, 45000];
    } else if (nyquistFreq <= 96000) {
      return [10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000];
    } else {
      return [20000, 40000, 60000, 80000, 100000, 120000, 140000, 160000, 180000];
    }
  };

  const getTimeStep = (duration: number): number => {
    // Always use 30s intervals like the reference image
    if (duration <= 60) return 15;
    if (duration <= 120) return 30;
    if (duration <= 300) return 30;
    if (duration <= 600) return 60;
    return 60;
  };

  const drawColorBar = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number
  ) => {
    // Draw gradient color bar
    for (let i = 0; i < height; i++) {
      const intensity = 1 - (i / height); // Top is high, bottom is low
      const color = getSpekColor(intensity);
      ctx.fillStyle = color;
      ctx.fillRect(x, y + i, width, 1);
    }

    // Border around color bar
    ctx.strokeStyle = "#666666";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, width, height);

    // Labels
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "11px Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    
    ctx.fillText("High", x + width + 5, y + 10);
    ctx.fillText("Low", x + width + 5, y + height - 10);
  };

  return (
    <div className="border border-white/10 rounded-lg overflow-hidden bg-black shadow-xl">
      <canvas
        ref={canvasRef}
        width={1200}
        height={600}
        className="w-full h-auto"
        style={{ imageRendering: "auto" }}
      />
    </div>
  );
}
