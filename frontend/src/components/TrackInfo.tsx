import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Download, FolderOpen, CheckCircle, XCircle, FileText, FileCheck, Globe, ImageDown } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { TrackMetadata, TrackAvailability } from "@/types/api";
import { TidalIcon, QobuzIcon, AmazonIcon } from "./PlatformIcons";

interface TrackInfoProps {
  track: TrackMetadata & { album_name: string; release_date: string };
  isDownloading: boolean;
  downloadingTrack: string | null;
  isDownloaded: boolean;
  isFailed: boolean;
  isSkipped: boolean;
  downloadingLyricsTrack?: string | null;
  downloadedLyrics?: boolean;
  failedLyrics?: boolean;
  skippedLyrics?: boolean;
  checkingAvailability?: boolean;
  availability?: TrackAvailability;
  downloadingCover?: boolean;
  onDownload: (isrc: string, name: string, artists: string, albumName?: string, spotifyId?: string, playlistName?: string, durationMs?: number, position?: number, albumArtist?: string, releaseDate?: string, coverUrl?: string, spotifyTrackNumber?: number, spotifyDiscNumber?: number, spotifyTotalTracks?: number) => void;
  onDownloadLyrics?: (spotifyId: string, name: string, artists: string, albumName?: string) => void;
  onCheckAvailability?: (spotifyId: string, isrc?: string) => void;
  onDownloadCover?: (coverUrl: string, trackName: string, artistName: string, albumName?: string) => void;
  onOpenFolder: () => void;
}

export function TrackInfo({
  track,
  isDownloading,
  downloadingTrack,
  isDownloaded,
  isFailed,
  isSkipped,
  downloadingLyricsTrack,
  downloadedLyrics,
  failedLyrics,
  skippedLyrics,
  checkingAvailability,
  availability,
  downloadingCover,
  onDownload,
  onDownloadLyrics,
  onCheckAvailability,
  onDownloadCover,
  onOpenFolder,
}: TrackInfoProps) {
  const [isHoveringCover, setIsHoveringCover] = useState(false);

  return (
    <Card>
      <CardContent className="px-6">
        <div className="flex gap-6 items-start">
          <div 
            className="shrink-0 relative"
            onMouseEnter={() => setIsHoveringCover(true)}
            onMouseLeave={() => setIsHoveringCover(false)}
          >
            {track.images && (
              <>
                <img
                  src={track.images}
                  alt={track.name}
                  className="w-48 h-48 rounded-md shadow-lg object-cover"
                />
                {isHoveringCover && onDownloadCover && (
                  <div className="absolute inset-0 bg-black/50 rounded-md flex items-center justify-center">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="secondary"
                          className="cursor-pointer"
                          onClick={() => onDownloadCover(track.images, track.name, track.artists, track.album_name)}
                          disabled={downloadingCover}
                        >
                          {downloadingCover ? <Spinner /> : <ImageDown className="h-5 w-5" />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Download Cover</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                )}
              </>
            )}
          </div>
          <div className="flex-1 space-y-4 min-w-0">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold wrap-break-word">{track.name}</h1>
                {isSkipped ? (
                  <FileCheck className="h-6 w-6 text-yellow-500 shrink-0" />
                ) : isDownloaded ? (
                  <CheckCircle className="h-6 w-6 text-green-500 shrink-0" />
                ) : isFailed ? (
                  <XCircle className="h-6 w-6 text-red-500 shrink-0" />
                ) : null}
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
              <div className="flex gap-2 flex-wrap">
                <Button
                  onClick={() => onDownload(track.isrc, track.name, track.artists, track.album_name, track.spotify_id, undefined, track.duration_ms, track.track_number, track.album_artist, track.release_date, track.images, track.track_number, track.disc_number, track.total_tracks)}
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
                {track.spotify_id && onDownloadLyrics && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={() => onDownloadLyrics(track.spotify_id!, track.name, track.artists, track.album_name)}
                        variant="outline"
                        disabled={downloadingLyricsTrack === track.spotify_id}
                      >
                        {downloadingLyricsTrack === track.spotify_id ? (
                          <Spinner />
                        ) : skippedLyrics ? (
                          <FileCheck className="h-4 w-4 text-yellow-500" />
                        ) : downloadedLyrics ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : failedLyrics ? (
                          <XCircle className="h-4 w-4 text-red-500" />
                        ) : (
                          <FileText className="h-4 w-4" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Download Lyric</p>
                    </TooltipContent>
                  </Tooltip>
                )}
                {track.spotify_id && onCheckAvailability && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={() => onCheckAvailability(track.spotify_id!, track.isrc)}
                        variant="outline"
                        disabled={checkingAvailability}
                      >
                        {checkingAvailability ? (
                          <Spinner />
                        ) : availability ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : (
                          <Globe className="h-4 w-4" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {availability ? (
                        <div className="flex items-center gap-2">
                          <TidalIcon className={`w-4 h-4 ${availability.tidal ? "text-green-500" : "text-red-500"}`} />
                          <QobuzIcon className={`w-4 h-4 ${availability.qobuz ? "text-green-500" : "text-red-500"}`} />
                          <AmazonIcon className={`w-4 h-4 ${availability.amazon ? "text-green-500" : "text-red-500"}`} />
                        </div>
                      ) : (
                        <p>Check Availability</p>
                      )}
                    </TooltipContent>
                  </Tooltip>
                )}
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
