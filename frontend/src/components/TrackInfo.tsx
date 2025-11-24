import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Download, FolderOpen, CheckCircle, XCircle } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import type { TrackMetadata } from "@/types/api";

interface TrackInfoProps {
  track: TrackMetadata & { album_name: string; release_date: string };
  isDownloading: boolean;
  downloadingTrack: string | null;
  isDownloaded: boolean;
  isFailed: boolean;
  onDownload: (isrc: string, name: string, artists: string, albumName?: string, spotifyId?: string) => void;
  onOpenFolder: () => void;
}

export function TrackInfo({
  track,
  isDownloading,
  downloadingTrack,
  isDownloaded,
  isFailed,
  onDownload,
  onOpenFolder,
}: TrackInfoProps) {
  return (
    <Card>
      <CardContent className="px-6">
        <div className="flex gap-6 items-start">
          {track.images && (
            <img
              src={track.images}
              alt={track.name}
              className="w-48 h-48 rounded-md shadow-lg object-cover shrink-0"
            />
          )}
          <div className="flex-1 space-y-4 min-w-0">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold wrap-break-word">{track.name}</h1>
                {isDownloaded && (
                  <CheckCircle className="h-6 w-6 text-green-500 shrink-0" />
                )}
                {isFailed && (
                  <XCircle className="h-6 w-6 text-red-500 shrink-0" />
                )}
              </div>
              <p className="text-lg text-muted-foreground">{track.artists}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Album</p>
                <p className="font-medium truncate">{track.album_name}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Release Date</p>
                <p className="font-medium">{track.release_date}</p>
              </div>
            </div>
            {track.isrc && (
              <div className="flex gap-2">
                <Button
                  onClick={() => onDownload(track.isrc, track.name, track.artists, track.album_name, track.spotify_id)}
                  disabled={isDownloading || downloadingTrack === track.isrc}
                >
                  {downloadingTrack === track.isrc ? (
                    <Spinner />
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      Download
                    </>
                  )}
                </Button>
                {isDownloaded && (
                  <Button onClick={onOpenFolder} variant="outline">
                    <FolderOpen className="h-4 w-4" />
                    Open Folder
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
