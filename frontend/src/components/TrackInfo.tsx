import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Download, FolderOpen } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import type { TrackMetadata } from "@/types/api";

interface TrackInfoProps {
  track: TrackMetadata & { album_name: string; release_date: string };
  isDownloading: boolean;
  downloadingTrack: string | null;
  isDownloaded: boolean;
  onDownload: (isrc: string, name: string, artists: string) => void;
  onOpenFolder: () => void;
}

export function TrackInfo({
  track,
  isDownloading,
  downloadingTrack,
  isDownloaded,
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
              <h1 className="text-3xl font-bold wrap-break-word">{track.name}</h1>
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
                  onClick={() => onDownload(track.isrc, track.name, track.artists)}
                  className="gap-1.5"
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
                  <Button onClick={onOpenFolder} variant="outline" className="gap-1.5">
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
