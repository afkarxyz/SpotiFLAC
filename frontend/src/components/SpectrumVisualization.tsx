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
    const marginLeft = 80;
    const marginRight = 80;
    const marginTop = 20;
    const marginBottom = 50;

    const plotWidth = width - marginLeft - marginRight;
    const plotHeight = height - marginTop - marginBottom;

    // Black background like Spek
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

      drawGrid(ctx, marginLeft, marginTop, plotWidth, plotHeight, nyquistFreq);
    }
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

    let minDB = 0;
    let maxDB = -120;

    timeSlices.forEach((slice) => {
      slice.magnitudes.forEach((db) => {
        if (db > maxDB) maxDB = db;
        if (db < minDB) minDB = db;
      });
    });

    const dbRange = maxDB - minDB;

    for (let t = 0; t < timeSlices.length; t++) {
      const slice = timeSlices[t];
      const xPos = x + (t / timeSlices.length) * width;
      const sliceWidth = Math.max(1, width / timeSlices.length);

      for (let f = 0; f < freqBins && f < slice.magnitudes.length; f++) {
        const db = slice.magnitudes[f];

        // Linear frequency scale like Spek
        const freq = (f / freqBins) * nyquistFreq;
        const freqRatio = freq / nyquistFreq;
        
        const yPos = y + height - (freqRatio * height);

        // Calculate next frequency bin position
        const nextFreq = ((f + 1) / freqBins) * nyquistFreq;
        const nextFreqRatio = nextFreq / nyquistFreq;
        const nextYPos = y + height - (nextFreqRatio * height);
        
        const binHeight = Math.max(1, Math.abs(yPos - nextYPos) + 1);

        const intensity = (db - minDB) / dbRange;

        const color = getSpekColor(intensity);
        ctx.fillStyle = color;
        ctx.fillRect(xPos, nextYPos, sliceWidth, binHeight);
      }
    }
  };

  const getSpekColor = (intensity: number): string => {
    // Enhanced color scheme - better than Spek
    if (intensity < 0.10) {
      // Deep black to dark blue
      const t = intensity / 0.10;
      return `rgb(0, 0, ${Math.floor(t * 100)})`;
    } else if (intensity < 0.25) {
      // Dark blue to bright blue
      const t = (intensity - 0.10) / 0.15;
      return `rgb(0, ${Math.floor(t * 50)}, ${Math.floor(100 + t * 155)})`;
    } else if (intensity < 0.40) {
      // Blue to cyan
      const t = (intensity - 0.25) / 0.15;
      return `rgb(0, ${Math.floor(50 + t * 205)}, 255)`;
    } else if (intensity < 0.55) {
      // Cyan to green
      const t = (intensity - 0.40) / 0.15;
      return `rgb(0, 255, ${Math.floor(255 - t * 200)})`;
    } else if (intensity < 0.70) {
      // Green to yellow
      const t = (intensity - 0.55) / 0.15;
      return `rgb(${Math.floor(t * 255)}, 255, ${Math.floor(55 - t * 55)})`;
    } else if (intensity < 0.85) {
      // Yellow to orange
      const t = (intensity - 0.70) / 0.15;
      return `rgb(255, ${Math.floor(255 - t * 100)}, 0)`;
    } else {
      // Orange to red
      const t = (intensity - 0.85) / 0.15;
      return `rgb(255, ${Math.floor(155 - t * 155)}, ${Math.floor(t * 30)})`;
    }
  };

  const drawGrid = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    nyquistFreq: number
  ) => {
    // Enhanced grid lines
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 1;

    // Dynamic frequency grid lines based on Nyquist frequency
    const generateFreqLines = (maxFreq: number): number[] => {
      if (maxFreq <= 24000) {
        // Standard 44.1/48 kHz (Nyquist ~22/24 kHz)
        return [1000, 2000, 5000, 10000, 15000, 20000];
      } else if (maxFreq <= 48000) {
        // 88.2/96 kHz (Nyquist ~44/48 kHz)
        return [5000, 10000, 20000, 30000, 40000];
      } else if (maxFreq <= 96000) {
        // 176.4/192 kHz (Nyquist ~88/96 kHz)
        return [10000, 20000, 40000, 60000, 80000];
      } else {
        // 352.8/384 kHz and higher (Nyquist ~176/192+ kHz)
        return [20000, 40000, 80000, 120000, 160000];
      }
    };

    const freqLines = generateFreqLines(nyquistFreq);
    
    freqLines.forEach(freq => {
      if (freq <= nyquistFreq) {
        const freqRatio = freq / nyquistFreq;
        const yPos = y + height - (freqRatio * height);
        
        ctx.beginPath();
        ctx.moveTo(x, yPos);
        ctx.lineTo(x + width, yPos);
        ctx.stroke();
      }
    });

    // Vertical time grid lines
    for (let i = 1; i < 10; i++) {
      const xPos = x + (i / 10) * width;
      ctx.beginPath();
      ctx.moveTo(xPos, y);
      ctx.lineTo(xPos, y + height);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(220, 220, 220, 0.9)";
    ctx.font = "11px Arial";

    // Frequency labels - dynamic formatting
    freqLines.forEach(freq => {
      if (freq <= nyquistFreq) {
        const freqRatio = freq / nyquistFreq;
        const yPos = y + height - (freqRatio * height);
        const label = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
        
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(label, x - 6, yPos);
      }
    });

    // Time labels
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let i = 0; i <= 10; i++) {
      const timePos = x + (i / 10) * width;
      const timeValue = (i / 10) * duration;
      if (i % 2 === 0) {
        ctx.fillText(timeValue.toFixed(1), timePos, y + height + 5);
      }
    }

    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 13px Arial";
    ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
    ctx.shadowBlur = 4;

    ctx.save();
    ctx.translate(8, y + height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText("Frequency (kHz)", 0, 0);
    ctx.restore();

    ctx.textAlign = "center";
    ctx.fillText("Time (s)", x + width / 2, y + height + 26);
    ctx.shadowBlur = 0;

    const boxGradient = ctx.createLinearGradient(x + width - 200, y + 5, x + width - 200, y + 68);
    boxGradient.addColorStop(0, "rgba(0, 0, 0, 0.85)");
    boxGradient.addColorStop(1, "rgba(0, 0, 0, 0.7)");
    ctx.fillStyle = boxGradient;
    ctx.fillRect(x + width - 200, y + 5, 190, 63);
    
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + width - 200, y + 5, 190, 63);

    ctx.fillStyle = "#FFFFFF";
    ctx.font = "600 11px Arial";
    ctx.textAlign = "left";
    ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
    ctx.shadowBlur = 2;
    ctx.fillText(`Sample Rate: ${(sampleRate / 1000).toFixed(1)} kHz`, x + width - 190, y + 20);
    ctx.fillText(`Bit Depth: ${bitsPerSample}-bit`, x + width - 190, y + 36);
    ctx.fillText(`Nyquist: ${(nyquistFreq / 1000).toFixed(1)} kHz`, x + width - 190, y + 52);
    ctx.shadowBlur = 0;
  };

  return (
    <div className="border border-white/10 rounded-lg overflow-hidden bg-black shadow-xl">
      <canvas
        ref={canvasRef}
        width={1600}
        height={800}
        className="w-full h-auto"
        style={{ imageRendering: "auto" }}
      />
    </div>
  );
}
