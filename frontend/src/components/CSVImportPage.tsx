import { useState } from "react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Upload, FileText, Download, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import type { CSVTrack } from "@/types/api";
import { SelectCSVFile, ParseCSVPlaylist, GetSpotifyMetadata } from "../../wailsjs/go/main/App";

interface CSVImportPageProps {
  onDownloadTrack: (
    isrc: string,
    name: string,
    artists: string,
    albumName: string,
    spotifyId?: string,
    folderName?: string,
    durationMs?: number,
    position?: number,
    albumArtist?: string,
    releaseDate?: string,
    coverUrl?: string,
    spotifyTrackNumber?: number,
    spotifyDiscNumber?: number,
    spotifyTotalTracks?: number
  ) => void;
}

export function CSVImportPage({ onDownloadTrack }: CSVImportPageProps) {
  const [csvFilePath, setCSVFilePath] = useState<string>("");
  const [tracks, setTracks] = useState<CSVTrack[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0 });
  const [downloadedTracks, setDownloadedTracks] = useState<Set<string>>(new Set());
  const [failedTracks, setFailedTracks] = useState<Set<string>>(new Set());

  const handleSelectCSV = async () => {
    try {
      const filePath = await SelectCSVFile();
      if (filePath) {
        setCSVFilePath(filePath);
        await parseCSV(filePath);
      }
    } catch (err) {
      toast.error("Failed to select CSV file");
      console.error(err);
    }
  };

  const parseCSV = async (filePath: string) => {
    setIsLoading(true);
    try {
      const result = await ParseCSVPlaylist(filePath);
      if (result.success && result.tracks) {
        setTracks(result.tracks);
        toast.success(`Loaded ${result.track_count} tracks from CSV`);
      } else {
        toast.error(result.error || "Failed to parse CSV file");
      }
    } catch (err) {
      toast.error("Failed to parse CSV file");
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownloadAll = async () => {
    if (tracks.length === 0) {
      toast.error("No tracks to download");
      return;
    }

    setIsDownloading(true);
    setDownloadProgress({ current: 0, total: tracks.length });
    setDownloadedTracks(new Set());
    setFailedTracks(new Set());

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      setDownloadProgress({ current: i + 1, total: tracks.length });

      try {
        // Fetch full metadata from Spotify for ISRC
        const metadataJson = await GetSpotifyMetadata({
          url: `https://open.spotify.com/track/${track.spotify_id}`,
          batch: false,
          delay: 0.5,
          timeout: 30,
        });
        
        const metadata = JSON.parse(metadataJson);
        
        if (metadata.track && metadata.track.isrc) {
          const trackData = metadata.track;
          
          // Download the track
          await onDownloadTrack(
            trackData.isrc,
            track.track_name,
            track.artist_name,
            track.album_name,
            track.spotify_id,
            undefined, // folderName
            track.duration_ms,
            i + 1, // position
            trackData.album_artist,
            track.release_date,
            trackData.images,
            trackData.track_number,
            trackData.disc_number,
            trackData.total_tracks
          );

          setDownloadedTracks((prev) => new Set(prev).add(track.spotify_id));
          successCount++;
        } else {
          throw new Error("No ISRC found for track");
        }
      } catch (err) {
        console.error(`Failed to download track ${track.track_name}:`, err);
        setFailedTracks((prev) => new Set(prev).add(track.spotify_id));
        failCount++;
      }

      // Add a small delay between tracks to avoid rate limiting
      if (i < tracks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    setIsDownloading(false);
    
    if (failCount === 0) {
      toast.success(`Successfully downloaded all ${successCount} tracks!`);
    } else {
      toast.warning(`Downloaded ${successCount} tracks, ${failCount} failed`);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">CSV Playlist Import</h2>
        <p className="text-muted-foreground">
          Import and download tracks from a Spotify CSV export file
        </p>
      </div>

      <Card className="p-6">
        <div className="space-y-4">
          <div>
            <Button onClick={handleSelectCSV} disabled={isLoading || isDownloading}>
              <Upload className="h-4 w-4 mr-2" />
              Select CSV File
            </Button>
          </div>

          {csvFilePath && (
            <div className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Selected file:</span>
              <span className="font-mono text-xs">{csvFilePath}</span>
            </div>
          )}

          {tracks.length > 0 && (
            <>
              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-semibold">
                      {tracks.length} tracks loaded
                    </h3>
                    {isDownloading && (
                      <p className="text-sm text-muted-foreground">
                        Progress: {downloadProgress.current} / {downloadProgress.total}
                      </p>
                    )}
                  </div>
                  <Button
                    onClick={handleDownloadAll}
                    disabled={isDownloading}
                    size="lg"
                  >
                    {isDownloading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Downloading...
                      </>
                    ) : (
                      <>
                        <Download className="h-4 w-4 mr-2" />
                        Download All Tracks
                      </>
                    )}
                  </Button>
                </div>

                <div className="max-h-[400px] overflow-y-auto border rounded-lg">
                  <table className="w-full">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        <th className="p-3 text-left text-sm font-medium">Status</th>
                        <th className="p-3 text-left text-sm font-medium">Track</th>
                        <th className="p-3 text-left text-sm font-medium">Artist</th>
                        <th className="p-3 text-left text-sm font-medium">Album</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tracks.map((track, index) => (
                        <tr
                          key={track.spotify_id || index}
                          className="border-b hover:bg-muted/30"
                        >
                          <td className="p-3">
                            {downloadedTracks.has(track.spotify_id) ? (
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            ) : failedTracks.has(track.spotify_id) ? (
                              <XCircle className="h-4 w-4 text-red-500" />
                            ) : isDownloading &&
                              downloadProgress.current === index + 1 ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : null}
                          </td>
                          <td className="p-3 text-sm">{track.track_name}</td>
                          <td className="p-3 text-sm text-muted-foreground">
                            {track.artist_name}
                          </td>
                          <td className="p-3 text-sm text-muted-foreground">
                            {track.album_name}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      </Card>

      <Card className="p-6 bg-muted/30">
        <h3 className="font-semibold mb-2">How to use:</h3>
        <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
          <li>Export your Spotify playlist as a CSV file</li>
          <li>Click "Select CSV File" to choose your exported playlist</li>
          <li>Review the loaded tracks in the table</li>
          <li>Click "Download All Tracks" to start the batch download</li>
          <li>The app will fetch metadata and download each track automatically</li>
        </ol>
      </Card>
    </div>
  );
}
