// Memory cache for spectrum data (fast access, cleared on page refresh)
// Key: file path, Value: spectrum data

import type { SpectrumData } from "@/types/api";

const spectrumCache = new Map<string, SpectrumData>();

export function setSpectrumCache(filePath: string, spectrumData: SpectrumData): void {
  spectrumCache.set(filePath, spectrumData);
}

export function getSpectrumCache(filePath: string): SpectrumData | null {
  return spectrumCache.get(filePath) || null;
}

export function clearSpectrumCache(filePath?: string): void {
  if (filePath) {
    spectrumCache.delete(filePath);
  } else {
    spectrumCache.clear();
  }
}
