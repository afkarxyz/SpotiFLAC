import type { AnalysisResult, SpectrumData, TimeSlice } from "@/types/api";

export interface SpectrumParams {
    fftSize: number;
    windowFunction: "hann" | "hamming" | "blackman" | "rectangular";
}

const DEFAULT_PARAMS: SpectrumParams = {
    fftSize: 4096,
    windowFunction: "hann",
};

interface FlacStreamInfo {
    sampleRate: number;
    channels: number;
    bitsPerSample: number;
    totalSamples: number;
    duration: number;
}

export interface FrontendAnalysisPayload {
    result: AnalysisResult;
    samples: Float32Array;
}

export interface FlacArrayBufferInput {
    fileName: string;
    fileSize: number;
    arrayBuffer: ArrayBuffer;
}

function parseFlacStreamInfo(buffer: ArrayBuffer): FlacStreamInfo {
    const data = new Uint8Array(buffer);
    if (data.length < 4 || data[0] !== 0x66 || data[1] !== 0x4c || data[2] !== 0x61 || data[3] !== 0x43) {
        throw new Error("Invalid FLAC file");
    }

    let offset = 4;
    while (offset + 4 <= data.length) {
        const blockHeader = data[offset];
        const blockType = blockHeader & 0x7f;
        const blockLength = (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
        offset += 4;

        if (offset + blockLength > data.length) {
            break;
        }

        if (blockType === 0 && blockLength >= 18) {
            const streamInfo = data.subarray(offset, offset + blockLength);
            const sampleRate =
                (streamInfo[10] << 12) |
                (streamInfo[11] << 4) |
                (streamInfo[12] >> 4);
            const channels = ((streamInfo[12] >> 1) & 0x07) + 1;
            const bitsPerSample = (((streamInfo[12] & 0x01) << 4) | (streamInfo[13] >> 4)) + 1;
            const totalSamplesBig =
                (BigInt(streamInfo[13] & 0x0f) << 32n) |
                (BigInt(streamInfo[14]) << 24n) |
                (BigInt(streamInfo[15]) << 16n) |
                (BigInt(streamInfo[16]) << 8n) |
                BigInt(streamInfo[17]);
            const totalSamples = Number(totalSamplesBig);
            const duration = sampleRate > 0 && totalSamples > 0 ? totalSamples / sampleRate : 0;

            return {
                sampleRate,
                channels,
                bitsPerSample,
                totalSamples,
                duration,
            };
        }

        offset += blockLength;
    }

    throw new Error("FLAC STREAMINFO metadata not found");
}

function buildWindowCoefficients(size: number, windowFunction: SpectrumParams["windowFunction"]): Float32Array {
    const coeffs = new Float32Array(size);
    if (size <= 1) {
        coeffs.fill(1);
        return coeffs;
    }

    for (let i = 0; i < size; i++) {
        switch (windowFunction) {
            case "hamming":
                coeffs[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (size - 1));
                break;
            case "blackman":
                coeffs[i] =
                    0.42 -
                    0.5 * Math.cos((2 * Math.PI * i) / (size - 1)) +
                    0.08 * Math.cos((4 * Math.PI * i) / (size - 1));
                break;
            case "rectangular":
                coeffs[i] = 1;
                break;
            case "hann":
            default:
                coeffs[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
                break;
        }
    }

    return coeffs;
}

function buildBitReversal(size: number): Uint32Array {
    let bits = 0;
    while ((1 << bits) < size)
        bits++;

    const out = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
        let x = i;
        let rev = 0;
        for (let b = 0; b < bits; b++) {
            rev = (rev << 1) | (x & 1);
            x >>= 1;
        }
        out[i] = rev;
    }
    return out;
}

function fftInPlace(real: Float32Array, imag: Float32Array, bitReversal: Uint32Array): void {
    const size = real.length;

    for (let i = 1; i < size; i++) {
        const j = bitReversal[i];
        if (i < j) {
            const tr = real[i];
            real[i] = real[j];
            real[j] = tr;

            const ti = imag[i];
            imag[i] = imag[j];
            imag[j] = ti;
        }
    }

    for (let len = 2; len <= size; len <<= 1) {
        const wLen = (-2 * Math.PI) / len;
        const wLenReal = Math.cos(wLen);
        const wLenImag = Math.sin(wLen);

        for (let i = 0; i < size; i += len) {
            let wReal = 1;
            let wImag = 0;
            const half = len >> 1;

            for (let j = 0; j < half; j++) {
                const uReal = real[i + j];
                const uImag = imag[i + j];
                const vReal = real[i + j + half] * wReal - imag[i + j + half] * wImag;
                const vImag = real[i + j + half] * wImag + imag[i + j + half] * wReal;

                real[i + j] = uReal + vReal;
                imag[i + j] = uImag + vImag;
                real[i + j + half] = uReal - vReal;
                imag[i + j + half] = uImag - vImag;

                const tempReal = wReal * wLenReal - wImag * wLenImag;
                wImag = wReal * wLenImag + wImag * wLenReal;
                wReal = tempReal;
            }
        }
    }
}

export function analyzeSpectrumFromSamples(
    samples: Float32Array,
    sampleRate: number,
    params: SpectrumParams,
): SpectrumData {
    const fftSize = params.fftSize;
    const hopSize = Math.max(1, Math.floor(fftSize / 4));
    const rawWindows = Math.floor((samples.length - fftSize) / hopSize);
    const numWindows = Math.max(1, rawWindows);
    const freqBins = Math.floor(fftSize / 2) + 1;
    const duration = sampleRate > 0 ? samples.length / sampleRate : 0;
    const maxFreq = sampleRate / 2;

    const windowCoeffs = buildWindowCoefficients(fftSize, params.windowFunction);
    const bitReversal = buildBitReversal(fftSize);
    const real = new Float32Array(fftSize);
    const imag = new Float32Array(fftSize);
    const invFFTSizeSquared = 1 / (fftSize * fftSize);

    const timeSlices: TimeSlice[] = new Array(numWindows);
    for (let i = 0; i < numWindows; i++) {
        const start = i * hopSize;
        const remaining = samples.length - start;
        const copyLen = Math.max(0, Math.min(fftSize, remaining));

        for (let j = 0; j < copyLen; j++) {
            real[j] = samples[start + j] * windowCoeffs[j];
            imag[j] = 0;
        }
        for (let j = copyLen; j < fftSize; j++) {
            real[j] = 0;
            imag[j] = 0;
        }

        fftInPlace(real, imag, bitReversal);

        const magnitudes = new Array<number>(freqBins);
        for (let j = 0; j < freqBins; j++) {
            const power = (real[j] * real[j] + imag[j] * imag[j]) * invFFTSizeSquared;
            magnitudes[j] = power > 1e-12 ? 10 * Math.log10(power) : -120;
        }

        timeSlices[i] = {
            time: sampleRate > 0 ? start / sampleRate : 0,
            magnitudes,
        };
    }

    return {
        time_slices: timeSlices,
        sample_rate: sampleRate,
        freq_bins: freqBins,
        duration,
        max_freq: maxFreq,
    };
}

export async function analyzeFlacFile(
    file: File,
    params: SpectrumParams = DEFAULT_PARAMS,
): Promise<FrontendAnalysisPayload> {
    const arrayBuffer = await file.arrayBuffer();
    return analyzeFlacArrayBuffer(
        {
            fileName: file.name,
            fileSize: file.size,
            arrayBuffer,
        },
        params,
    );
}

export async function analyzeFlacArrayBuffer(
    input: FlacArrayBufferInput,
    params: SpectrumParams = DEFAULT_PARAMS,
): Promise<FrontendAnalysisPayload> {
    const streamInfo = parseFlacStreamInfo(input.arrayBuffer);
    const audioContext = new AudioContext({ sampleRate: streamInfo.sampleRate });

    try {
        const audioBuffer = await audioContext.decodeAudioData(input.arrayBuffer.slice(0));
        const samples = audioBuffer.getChannelData(0);

        let peak = 0;
        let sumSquares = 0;
        for (let i = 0; i < samples.length; i++) {
            const sample = samples[i];
            const absSample = Math.abs(sample);
            if (absSample > peak)
                peak = absSample;
            sumSquares += sample * sample;
        }

        const peakDB = peak > 0 ? 20 * Math.log10(peak) : -120;
        const rms = samples.length > 0 ? Math.sqrt(sumSquares / samples.length) : 0;
        const rmsDB = rms > 0 ? 20 * Math.log10(rms) : -120;
        const dynamicRange = peakDB - rmsDB;

        const spectrum = analyzeSpectrumFromSamples(samples, streamInfo.sampleRate, params);
        const durationFromBuffer = audioBuffer.duration;
        const duration = durationFromBuffer > 0 ? durationFromBuffer : streamInfo.duration;
        const totalSamples = streamInfo.totalSamples > 0 ? streamInfo.totalSamples : Math.floor(duration * streamInfo.sampleRate);

        return {
            result: {
                file_path: input.fileName,
                file_size: input.fileSize,
                sample_rate: streamInfo.sampleRate,
                channels: streamInfo.channels,
                bits_per_sample: streamInfo.bitsPerSample,
                total_samples: totalSamples,
                duration,
                bit_depth: `${streamInfo.bitsPerSample}-bit`,
                dynamic_range: dynamicRange,
                peak_amplitude: peakDB,
                rms_level: rmsDB,
                spectrum,
            },
            samples,
        };
    }
    finally {
        await audioContext.close();
    }
}
