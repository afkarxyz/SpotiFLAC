// Memory cache for spectrum data (fast access, cleared on page refresh)
// Key: file path, Value: spectrum data

const spectrumCache = new Map<string, any>();

export function setSpectrumCache(filePath: string, spectrumData: any): void {
  spectrumCache.set(filePath, spectrumData);
}

export function getSpectrumCache(filePath: string): any | null {
  return spectrumCache.get(filePath) || null;
}

export function clearSpectrumCache(filePath?: string): void {
  if (filePath) {
    spectrumCache.delete(filePath);
  } else {
    spectrumCache.clear();
  }
}

