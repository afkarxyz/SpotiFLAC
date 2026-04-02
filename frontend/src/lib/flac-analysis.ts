import type { AnalysisResult, SpectrumData, TimeSlice } from "@/types/api";
export interface SpectrumParams {
    fftSize: number;
    windowFunction: "hann" | "hamming" | "blackman" | "rectangular";
}
const DEFAULT_PARAMS: SpectrumParams = {
    fftSize: 4096,
    windowFunction: "hann",
};
const MAX_SPECTRUM_FRAMES = 2200;
const METRICS_CHUNK_SIZE = 262144;
const AAC_SAMPLE_RATES = [
    96000, 88200, 64000, 48000, 44100, 32000, 24000,
    22050, 16000, 12000, 11025, 8000, 7350,
] as const;
const MP4_CONTAINER_TYPES = new Set([
    "moov", "trak", "mdia", "minf", "stbl", "edts", "dinf",
    "udta", "ilst", "meta", "stsd", "wave",
]);
export type SupportedAudioFileType = "FLAC" | "MP3" | "M4A" | "AAC";
export interface ParsedAudioMetadata {
    fileType: SupportedAudioFileType;
    sampleRate: number;
    channels: number;
    bitsPerSample: number;
    totalSamples: number;
    duration: number;
    codecMode?: string;
    bitrateKbps?: number;
    totalFrames?: number;
    codecVersion?: string;
}
interface Mp4BoxInfo {
    offset: number;
    size: number;
    headerSize: number;
    type: string;
}
export interface FrontendAnalysisPayload {
    result: AnalysisResult;
    samples: Float32Array;
}
export interface AudioArrayBufferInput {
    fileName: string;
    fileSize: number;
    arrayBuffer: ArrayBuffer;
}
export type AnalysisPhase = "read" | "parse" | "decode" | "metrics" | "spectrum" | "finalize";
export interface AnalysisProgress {
    phase: AnalysisPhase;
    percent: number;
    message: string;
}
export type AnalysisProgressCallback = (progress: AnalysisProgress) => void;
export type AnalysisCancelCheck = () => boolean;
function reportProgress(callback: AnalysisProgressCallback | undefined, phase: AnalysisPhase, percent: number, message: string): void {
    if (!callback)
        return;
    callback({
        phase,
        percent: Math.max(0, Math.min(100, percent)),
        message,
    });
}
function throwIfCancelled(cancelCheck?: AnalysisCancelCheck): void {
    if (cancelCheck?.()) {
        throw new Error("Analysis cancelled");
    }
}
function nowMs(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
}
function nextTick(): Promise<void> {
    if (typeof requestAnimationFrame === "function") {
        return new Promise((resolve) => requestAnimationFrame(() => resolve()));
    }
    return new Promise((resolve) => setTimeout(resolve, 0));
}
function readFourCC(view: DataView, offset: number): string {
    return String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
}
function fileExtension(fileName: string): string {
    const normalized = fileName.toLowerCase();
    const dotIndex = normalized.lastIndexOf(".");
    return dotIndex >= 0 ? normalized.slice(dotIndex) : "";
}
function detectAudioFileType(buffer: ArrayBuffer, fileName = ""): SupportedAudioFileType {
    const view = new DataView(buffer);
    if (view.byteLength >= 4 && view.getUint32(0, false) === 0x664c6143) {
        return "FLAC";
    }
    if (view.byteLength >= 3 &&
        view.getUint8(0) === 0x49 &&
        view.getUint8(1) === 0x44 &&
        view.getUint8(2) === 0x33) {
        return "MP3";
    }
    if (view.byteLength >= 8 && readFourCC(view, 4) === "ftyp") {
        return "M4A";
    }
    if (view.byteLength >= 2 && view.getUint8(0) === 0xff && (view.getUint8(1) & 0xf6) === 0xf0) {
        return "AAC";
    }
    for (let offset = 0; offset < Math.min(4096, view.byteLength - 4); offset++) {
        const header = view.getUint32(offset, false);
        if ((header >>> 21) === 0x7ff) {
            const version = (header >>> 19) & 0x03;
            const layer = (header >>> 17) & 0x03;
            const sampleRateIndex = (header >>> 10) & 0x03;
            if (version !== 1 && layer !== 0 && sampleRateIndex !== 3) {
                return "MP3";
            }
        }
    }
    switch (fileExtension(fileName)) {
        case ".flac": return "FLAC";
        case ".mp3": return "MP3";
        case ".m4a":
        case ".mp4": return "M4A";
        case ".aac": return "AAC";
        default: throw new Error(`Unsupported audio format: ${fileName || "unknown"}`);
    }
}
function parseFlacMetadata(buffer: ArrayBuffer): ParsedAudioMetadata {
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
        if (offset + blockLength > data.length)
            break;
        if (blockType === 0 && blockLength >= 18) {
            const streamInfo = data.subarray(offset, offset + blockLength);
            const sampleRate = (streamInfo[10] << 12) | (streamInfo[11] << 4) | (streamInfo[12] >> 4);
            const channels = ((streamInfo[12] >> 1) & 0x07) + 1;
            const bitsPerSample = (((streamInfo[12] & 0x01) << 4) | (streamInfo[13] >> 4)) + 1;
            const totalSamplesBig = (BigInt(streamInfo[13] & 0x0f) << 32n) |
                (BigInt(streamInfo[14]) << 24n) |
                (BigInt(streamInfo[15]) << 16n) |
                (BigInt(streamInfo[16]) << 8n) |
                BigInt(streamInfo[17]);
            const totalSamples = Number(totalSamplesBig);
            const duration = sampleRate > 0 && totalSamples > 0 ? totalSamples / sampleRate : 0;
            return {
                fileType: "FLAC",
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
function skipId3v2Tag(view: DataView): number {
    if (view.byteLength < 10 ||
        view.getUint8(0) !== 0x49 ||
        view.getUint8(1) !== 0x44 ||
        view.getUint8(2) !== 0x33) {
        return 0;
    }
    const size = ((view.getUint8(6) & 0x7f) << 21) |
        ((view.getUint8(7) & 0x7f) << 14) |
        ((view.getUint8(8) & 0x7f) << 7) |
        (view.getUint8(9) & 0x7f);
    let offset = 10 + size;
    if ((view.getUint8(5) & 0x10) !== 0) {
        offset += 10;
    }
    return offset < view.byteLength ? offset : 0;
}
function getMp3Bitrate(version: number, layer: number, bitrateIndex: number): number {
    const tables: Record<number, Record<number, number[]>> = {
        1: {
            1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0],
            2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0],
            3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
        },
        2: {
            1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0],
            2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
            3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
        },
    };
    const normalizedVersion = version === 2.5 ? 2 : version;
    return tables[normalizedVersion]?.[layer]?.[bitrateIndex] ?? 0;
}
function getMp3SamplesPerFrame(version: number, layer: number): number {
    if (layer === 1)
        return 384;
    if (version === 1)
        return 1152;
    return 576;
}
interface Mp3FrameInfo {
    version: number;
    versionName: string;
    layer: number;
    sampleRate: number;
    bitrate: number;
    channels: number;
    frameSize: number;
    samplesPerFrame: number;
}
function parseMp3FrameHeader(header: number): Mp3FrameInfo | null {
    if (((header >>> 21) & 0x7ff) !== 0x7ff)
        return null;
    const versionBits = (header >>> 19) & 0x03;
    const layerBits = (header >>> 17) & 0x03;
    const bitrateIndex = (header >>> 12) & 0x0f;
    const sampleRateIndex = (header >>> 10) & 0x03;
    const padding = (header >>> 9) & 0x01;
    const channelMode = (header >>> 6) & 0x03;
    const versions = [2.5, null, 2, 1] as const;
    const layers = [null, 3, 2, 1] as const;
    const version = versions[versionBits];
    const layer = layers[layerBits];
    if (version === null || layer === null || sampleRateIndex === 3)
        return null;
    const sampleRateTables: Record<1 | 2 | 25, [
        number,
        number,
        number
    ]> = {
        1: [44100, 48000, 32000],
        2: [22050, 24000, 16000],
        25: [11025, 12000, 8000],
    };
    const sampleRateKey = version === 2.5 ? 25 : (version as 1 | 2);
    const sampleRate = sampleRateTables[sampleRateKey][sampleRateIndex];
    const bitrate = getMp3Bitrate(version, layer, bitrateIndex);
    const samplesPerFrame = getMp3SamplesPerFrame(version, layer);
    if (!sampleRate || !bitrate || !samplesPerFrame)
        return null;
    return {
        version,
        versionName: `MPEG-${version === 1 ? "1" : version === 2 ? "2" : "2.5"}`,
        layer,
        sampleRate,
        bitrate,
        channels: channelMode === 3 ? 1 : 2,
        frameSize: Math.floor((samplesPerFrame / 8 * bitrate * 1000) / sampleRate) + padding,
        samplesPerFrame,
    };
}
function getMp3SideInfoSize(frameInfo: Mp3FrameInfo): number {
    if (frameInfo.version === 1) {
        return frameInfo.channels === 1 ? 17 : 32;
    }
    return frameInfo.channels === 1 ? 9 : 17;
}
function parseMp3XingHeader(view: DataView, offset: number, frameInfo: Mp3FrameInfo) {
    if (offset + 16 > view.byteLength)
        return null;
    const flags = view.getUint32(offset + 4, false);
    let pos = offset + 8;
    let totalFrames = 0;
    let totalBytes = 0;
    if ((flags & 0x01) !== 0 && pos + 4 <= view.byteLength) {
        totalFrames = view.getUint32(pos, false);
        pos += 4;
    }
    if ((flags & 0x02) !== 0 && pos + 4 <= view.byteLength) {
        totalBytes = view.getUint32(pos, false);
    }
    const duration = totalFrames > 0 ? (totalFrames * frameInfo.samplesPerFrame) / frameInfo.sampleRate : 0;
    const avgBitrate = duration > 0 && totalBytes > 0 ? Math.round((totalBytes * 8) / duration / 1000) : frameInfo.bitrate;
    return {
        codecMode: "VBR (Xing)",
        totalFrames,
        duration,
        bitrateKbps: avgBitrate,
    };
}
function parseMp3VbriHeader(view: DataView, offset: number, frameInfo: Mp3FrameInfo) {
    if (offset + 18 > view.byteLength)
        return null;
    const totalBytes = view.getUint32(offset + 10, false);
    const totalFrames = view.getUint32(offset + 14, false);
    const duration = totalFrames > 0 ? (totalFrames * frameInfo.samplesPerFrame) / frameInfo.sampleRate : 0;
    const bitrateKbps = duration > 0 && totalBytes > 0 ? Math.round((totalBytes * 8) / duration / 1000) : frameInfo.bitrate;
    return {
        codecMode: "VBR (VBRI)",
        totalFrames,
        duration,
        bitrateKbps,
    };
}
function parseMp3VbrInfo(view: DataView, frameOffset: number, frameInfo: Mp3FrameInfo) {
    const sideInfoSize = getMp3SideInfoSize(frameInfo);
    const xingOffset = frameOffset + 4 + sideInfoSize;
    if (xingOffset + 4 <= view.byteLength) {
        const xingTag = String.fromCharCode(view.getUint8(xingOffset), view.getUint8(xingOffset + 1), view.getUint8(xingOffset + 2), view.getUint8(xingOffset + 3));
        if (xingTag === "Xing" || xingTag === "Info") {
            return parseMp3XingHeader(view, xingOffset, frameInfo);
        }
    }
    const vbriOffset = frameOffset + 36;
    if (vbriOffset + 4 <= view.byteLength) {
        const vbriTag = String.fromCharCode(view.getUint8(vbriOffset), view.getUint8(vbriOffset + 1), view.getUint8(vbriOffset + 2), view.getUint8(vbriOffset + 3));
        if (vbriTag === "VBRI") {
            return parseMp3VbriHeader(view, vbriOffset, frameInfo);
        }
    }
    return null;
}
function parseMp3Metadata(buffer: ArrayBuffer): ParsedAudioMetadata {
    const view = new DataView(buffer);
    const startOffset = skipId3v2Tag(view);
    for (let offset = startOffset; offset <= view.byteLength - 4; offset++) {
        const header = view.getUint32(offset, false);
        const frameInfo = parseMp3FrameHeader(header);
        if (frameInfo) {
            const vbrInfo = parseMp3VbrInfo(view, offset, frameInfo);
            const estimatedAudioDataSize = Math.max(0, view.byteLength - offset);
            const estimatedFrameSize = frameInfo.frameSize > 0 ? frameInfo.frameSize : 1;
            const totalFrames = vbrInfo?.totalFrames ?? Math.floor(estimatedAudioDataSize / estimatedFrameSize);
            const duration = vbrInfo?.duration ?? ((totalFrames * frameInfo.samplesPerFrame) / frameInfo.sampleRate);
            const bitrateKbps = vbrInfo?.bitrateKbps ?? frameInfo.bitrate;
            return {
                fileType: "MP3",
                sampleRate: frameInfo.sampleRate,
                channels: frameInfo.channels,
                bitsPerSample: 16,
                totalSamples: duration > 0 ? Math.floor(duration * frameInfo.sampleRate) : 0,
                duration,
                codecMode: vbrInfo?.codecMode ?? "CBR",
                bitrateKbps,
                totalFrames,
                codecVersion: frameInfo.versionName,
            };
        }
    }
    throw new Error("No valid MP3 frame found");
}
function parseAacMetadata(buffer: ArrayBuffer): ParsedAudioMetadata {
    const data = new Uint8Array(buffer);
    for (let offset = 0; offset <= data.length - 7; offset++) {
        if (data[offset] !== 0xff || (data[offset + 1] & 0xf6) !== 0xf0)
            continue;
        const sampleRateIndex = (data[offset + 2] >> 2) & 0x0f;
        const sampleRate = AAC_SAMPLE_RATES[sampleRateIndex];
        const channels = ((data[offset + 2] & 0x01) << 2) | ((data[offset + 3] >> 6) & 0x03);
        if (!sampleRate)
            continue;
        return {
            fileType: "AAC",
            sampleRate,
            channels: channels || 2,
            bitsPerSample: 16,
            totalSamples: 0,
            duration: 0,
        };
    }
    throw new Error("No valid AAC ADTS header found");
}
function readMp4Box(view: DataView, offset: number, limit: number): Mp4BoxInfo | null {
    if (offset + 8 > limit)
        return null;
    let size = view.getUint32(offset, false);
    const type = readFourCC(view, offset + 4);
    let headerSize = 8;
    if (size === 1) {
        if (offset + 16 > limit)
            return null;
        const high = view.getUint32(offset + 8, false);
        const low = view.getUint32(offset + 12, false);
        size = high * 4294967296 + low;
        headerSize = 16;
    }
    else if (size === 0) {
        size = limit - offset;
    }
    if (size < headerSize || offset + size > limit)
        return null;
    return { offset, size, headerSize, type };
}
function parseM4aMetadata(buffer: ArrayBuffer): ParsedAudioMetadata {
    const view = new DataView(buffer);
    let sampleRate = 0;
    let channels = 0;
    let bitsPerSample = 0;
    let duration = 0;
    const scanBoxes = (start: number, end: number): void => {
        let offset = start;
        while (offset + 8 <= end) {
            const box = readMp4Box(view, offset, end);
            if (!box)
                break;
            const boxEnd = box.offset + box.size;
            const contentStart = box.offset + box.headerSize;
            if (box.type === "mdhd" && contentStart + 24 <= boxEnd) {
                const version = view.getUint8(contentStart);
                if (version === 0 && contentStart + 24 <= boxEnd) {
                    const timeScale = view.getUint32(contentStart + 12, false);
                    const durationValue = view.getUint32(contentStart + 16, false);
                    if (timeScale > 0) {
                        sampleRate = timeScale;
                        duration = durationValue / timeScale;
                    }
                }
                else if (version === 1 && contentStart + 36 <= boxEnd) {
                    const timeScale = view.getUint32(contentStart + 20, false);
                    const durationHigh = view.getUint32(contentStart + 24, false);
                    const durationLow = view.getUint32(contentStart + 28, false);
                    const durationValue = durationHigh * 4294967296 + durationLow;
                    if (timeScale > 0) {
                        sampleRate = timeScale;
                        duration = durationValue / timeScale;
                    }
                }
            }
            else if ((box.type === "mp4a" || box.type === "aac " || box.type === "alac") && box.offset + 36 <= boxEnd) {
                channels = view.getUint16(box.offset + 24, false) || channels;
                bitsPerSample = view.getUint16(box.offset + 26, false) || bitsPerSample;
                if (!sampleRate) {
                    const fixedPointSampleRate = view.getUint32(box.offset + 32, false);
                    if (fixedPointSampleRate > 0) {
                        sampleRate = Math.floor(fixedPointSampleRate / 65536);
                    }
                }
            }
            if (MP4_CONTAINER_TYPES.has(box.type)) {
                let childStart = contentStart;
                if (box.type === "meta")
                    childStart = Math.min(boxEnd, contentStart + 4);
                else if (box.type === "stsd")
                    childStart = Math.min(boxEnd, contentStart + 8);
                if (childStart < boxEnd)
                    scanBoxes(childStart, boxEnd);
            }
            offset = boxEnd;
        }
    };
    scanBoxes(0, view.byteLength);
    if (sampleRate <= 0)
        sampleRate = 44100;
    if (channels <= 0)
        channels = 2;
    if (bitsPerSample <= 0)
        bitsPerSample = 16;
    return {
        fileType: "M4A",
        sampleRate,
        channels,
        bitsPerSample,
        totalSamples: duration > 0 ? Math.floor(duration * sampleRate) : 0,
        duration,
    };
}
export function parseAudioMetadataFromInput(input: AudioArrayBufferInput): ParsedAudioMetadata {
    const fileType = detectAudioFileType(input.arrayBuffer, input.fileName);
    switch (fileType) {
        case "FLAC": return parseFlacMetadata(input.arrayBuffer);
        case "MP3": return parseMp3Metadata(input.arrayBuffer);
        case "M4A": return parseM4aMetadata(input.arrayBuffer);
        case "AAC": return parseAacMetadata(input.arrayBuffer);
        default: throw new Error(`Unsupported audio format: ${input.fileName || "unknown"}`);
    }
}
export function pcm16MonoArrayBufferToFloat32Samples(buffer: ArrayBuffer): Float32Array {
    const sampleCount = Math.floor(buffer.byteLength / 2);
    const samples = new Float32Array(sampleCount);
    const view = new DataView(buffer);
    for (let i = 0; i < sampleCount; i++) {
        samples[i] = view.getInt16(i * 2, true) / 32768;
    }
    return samples;
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
export async function analyzeSpectrumFromSamples(samples: Float32Array, sampleRate: number, params: SpectrumParams, onProgress?: AnalysisProgressCallback, shouldCancel?: AnalysisCancelCheck): Promise<SpectrumData> {
    throwIfCancelled(shouldCancel);
    const fftSize = params.fftSize;
    const hopSize = Math.max(1, Math.floor(fftSize / 4));
    const rawWindows = Math.floor((samples.length - fftSize) / hopSize);
    const numWindows = Math.max(1, rawWindows);
    const frameStride = Math.max(1, Math.ceil(numWindows / MAX_SPECTRUM_FRAMES));
    const freqBins = Math.floor(fftSize / 2) + 1;
    const duration = sampleRate > 0 ? samples.length / sampleRate : 0;
    const maxFreq = sampleRate / 2;
    const windowCoeffs = buildWindowCoefficients(fftSize, params.windowFunction);
    const bitReversal = buildBitReversal(fftSize);
    const real = new Float32Array(fftSize);
    const imag = new Float32Array(fftSize);
    const invFFTSizeSquared = 1 / (fftSize * fftSize);
    reportProgress(onProgress, "spectrum", 0, "Preparing FFT...");
    const windowIndices: number[] = [];
    for (let windowIndex = 0; windowIndex < numWindows; windowIndex += frameStride) {
        windowIndices.push(windowIndex);
    }
    if (windowIndices[windowIndices.length - 1] !== numWindows - 1) {
        windowIndices.push(numWindows - 1);
    }
    const totalSlices = windowIndices.length;
    const timeSlices: TimeSlice[] = new Array(totalSlices);
    let lastReportedPercent = -1;
    let lastYieldAt = nowMs();
    for (let i = 0; i < totalSlices; i++) {
        throwIfCancelled(shouldCancel);
        const windowIndex = windowIndices[i];
        const start = windowIndex * hopSize;
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
        const magnitudes = new Float32Array(freqBins);
        for (let j = 0; j < freqBins; j++) {
            const power = (real[j] * real[j] + imag[j] * imag[j]) * invFFTSizeSquared;
            magnitudes[j] = power > 1e-12 ? 10 * Math.log10(power) : -120;
        }
        timeSlices[i] = {
            time: sampleRate > 0 ? start / sampleRate : 0,
            magnitudes,
        };
        const currentPercent = Math.floor(((i + 1) / totalSlices) * 100);
        if (currentPercent > lastReportedPercent) {
            lastReportedPercent = currentPercent;
            reportProgress(onProgress, "spectrum", currentPercent, "Analyzing spectrum...");
        }
        if ((i + 1) % 8 === 0) {
            const now = nowMs();
            if (now - lastYieldAt >= 16) {
                await nextTick();
                lastYieldAt = nowMs();
                throwIfCancelled(shouldCancel);
            }
        }
    }
    reportProgress(onProgress, "spectrum", 100, "Spectrum analysis complete");
    return {
        time_slices: timeSlices,
        sample_rate: sampleRate,
        freq_bins: freqBins,
        duration,
        max_freq: maxFreq,
    };
}
function createAnalysisAudioContext(sampleRate: number): AudioContext {
    if (sampleRate > 0) {
        try {
            return new AudioContext({ sampleRate });
        }
        catch {
            return new AudioContext();
        }
    }
    return new AudioContext();
}
export async function analyzeAudioFile(file: File, params: SpectrumParams = DEFAULT_PARAMS, onProgress?: AnalysisProgressCallback, shouldCancel?: AnalysisCancelCheck): Promise<FrontendAnalysisPayload> {
    throwIfCancelled(shouldCancel);
    reportProgress(onProgress, "read", 2, "Reading file...");
    const arrayBuffer = await file.arrayBuffer();
    throwIfCancelled(shouldCancel);
    reportProgress(onProgress, "read", 10, "File loaded");
    return analyzeAudioArrayBuffer({
        fileName: file.name,
        fileSize: file.size,
        arrayBuffer,
    }, params, (progress) => {
        const mappedPercent = 10 + (progress.percent * 0.9);
        reportProgress(onProgress, progress.phase, mappedPercent, progress.message);
    }, shouldCancel);
}
export async function analyzeAudioArrayBuffer(input: AudioArrayBufferInput, params: SpectrumParams = DEFAULT_PARAMS, onProgress?: AnalysisProgressCallback, shouldCancel?: AnalysisCancelCheck): Promise<FrontendAnalysisPayload> {
    throwIfCancelled(shouldCancel);
    reportProgress(onProgress, "parse", 5, "Parsing audio metadata...");
    const metadata = parseAudioMetadataFromInput(input);
    throwIfCancelled(shouldCancel);
    reportProgress(onProgress, "decode", 15, "Decoding audio stream...");
    const audioContext = createAnalysisAudioContext(metadata.sampleRate);
    try {
        const audioBuffer = await audioContext.decodeAudioData(input.arrayBuffer.slice(0));
        throwIfCancelled(shouldCancel);
        reportProgress(onProgress, "decode", 35, "Audio decoded");
        const samples = audioBuffer.getChannelData(0);
        return analyzeDecodedSamples(input, metadata, samples, params, onProgress, shouldCancel, audioBuffer.duration);
    }
    finally {
        await audioContext.close();
    }
}
export async function analyzeDecodedSamples(input: AudioArrayBufferInput, metadata: ParsedAudioMetadata, samples: Float32Array, params: SpectrumParams = DEFAULT_PARAMS, onProgress?: AnalysisProgressCallback, shouldCancel?: AnalysisCancelCheck, durationOverride?: number): Promise<FrontendAnalysisPayload> {
    throwIfCancelled(shouldCancel);
    const analysisSampleRate = metadata.sampleRate > 0 ? metadata.sampleRate : 44100;
    const analysisChannels = metadata.channels > 0 ? metadata.channels : 1;
    const bitDepthLabel = metadata.bitsPerSample > 0 ? `${metadata.bitsPerSample}-bit` : "Unknown";
    reportProgress(onProgress, "metrics", 40, "Calculating peak/RMS...");
    let peak = 0;
    let sumSquares = 0;
    let lastMetricsYieldAt = nowMs();
    for (let i = 0; i < samples.length; i++) {
        throwIfCancelled(shouldCancel);
        const sample = samples[i];
        const absSample = Math.abs(sample);
        if (absSample > peak)
            peak = absSample;
        sumSquares += sample * sample;
        if ((i + 1) % METRICS_CHUNK_SIZE === 0 || i === samples.length - 1) {
            const metricsProgress = 40 + (((i + 1) / Math.max(1, samples.length)) * 10);
            reportProgress(onProgress, "metrics", metricsProgress, "Calculating peak/RMS...");
            const now = nowMs();
            if (now - lastMetricsYieldAt >= 16) {
                await nextTick();
                lastMetricsYieldAt = nowMs();
                throwIfCancelled(shouldCancel);
            }
        }
    }
    const peakDB = peak > 0 ? 20 * Math.log10(peak) : -120;
    const rms = samples.length > 0 ? Math.sqrt(sumSquares / samples.length) : 0;
    const rmsDB = rms > 0 ? 20 * Math.log10(rms) : -120;
    const dynamicRange = peakDB - rmsDB;
    const duration = durationOverride && durationOverride > 0
        ? durationOverride
        : (metadata.duration > 0
            ? metadata.duration
            : (analysisSampleRate > 0 ? samples.length / analysisSampleRate : 0));
    const totalSamples = metadata.totalSamples > 0
        ? metadata.totalSamples
        : (duration > 0 ? Math.floor(duration * analysisSampleRate) : samples.length);
    reportProgress(onProgress, "metrics", 50, "Signal metrics complete");
    const spectrum = await analyzeSpectrumFromSamples(samples, analysisSampleRate, params, (progress) => {
        const mappedPercent = 50 + (progress.percent * 0.45);
        reportProgress(onProgress, "spectrum", mappedPercent, progress.message);
    }, shouldCancel);
    reportProgress(onProgress, "finalize", 97, "Finalizing result...");
    const payload: FrontendAnalysisPayload = {
        result: {
            file_path: input.fileName,
            file_size: input.fileSize,
            file_type: metadata.fileType,
            sample_rate: analysisSampleRate,
            channels: analysisChannels,
            bits_per_sample: metadata.bitsPerSample,
            total_samples: totalSamples,
            duration,
            bit_depth: bitDepthLabel,
            dynamic_range: dynamicRange,
            peak_amplitude: peakDB,
            rms_level: rmsDB,
            codec_mode: metadata.codecMode,
            bitrate_kbps: metadata.bitrateKbps,
            total_frames: metadata.totalFrames,
            codec_version: metadata.codecVersion,
            spectrum,
        },
        samples,
    };
    reportProgress(onProgress, "finalize", 100, "Analysis complete");
    return payload;
}
export const analyzeFlacFile = analyzeAudioFile;
export const analyzeFlacArrayBuffer = analyzeAudioArrayBuffer;
