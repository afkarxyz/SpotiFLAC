import type {
  SpotifyMetadataResponse,
  DownloadRequest,
  DownloadResponse,
  HealthResponse,
  LyricsDownloadRequest,
  LyricsDownloadResponse,
  CoverDownloadRequest,
  CoverDownloadResponse,
} from "@/types/api";
import { GetSpotifyMetadata, DownloadTrack, DownloadLyrics, DownloadCover } from "../../wailsjs/go/main/App";
import { main } from "../../wailsjs/go/models";

export async function fetchSpotifyMetadata(
  url: string,
  batch: boolean = true,
  delay: number = 1.0,
  timeout: number = 300.0
): Promise<SpotifyMetadataResponse> {
  const req = new main.SpotifyMetadataRequest({
    url,
    batch,
    delay,
    timeout,
  });

  const jsonString = await GetSpotifyMetadata(req);
  return JSON.parse(jsonString);
}

export async function downloadTrack(
  request: DownloadRequest
): Promise<DownloadResponse> {
  const req = new main.DownloadRequest(request);
  return await DownloadTrack(req);
}

export async function checkHealth(): Promise<HealthResponse> {
  // For Wails, we can just return a simple health check
  // since the app is running locally
  return {
    status: "ok",
    time: new Date().toISOString(),
  };
}

export async function downloadLyrics(
  request: LyricsDownloadRequest
): Promise<LyricsDownloadResponse> {
  const req = new main.LyricsDownloadRequest(request);
  return await DownloadLyrics(req);
}

export async function downloadCover(
  request: CoverDownloadRequest
): Promise<CoverDownloadResponse> {
  const req = new main.CoverDownloadRequest(request);
  return await DownloadCover(req);
}
