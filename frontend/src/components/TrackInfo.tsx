import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Download, FolderOpen, CheckCircle, XCircle, FileText, FileCheck, Globe, ImageDown, Play, Pause } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger, } from "@/components/ui/tooltip";
import type { TrackMetadata, TrackAvailability } from "@/types/api";
import { TidalIcon, QobuzIcon, AmazonIcon } from "./PlatformIcons";
import { usePreview } from "@/hooks/usePreview";
interface TrackInfoProps {
    track: TrackMetadata & {
        album_name: string;
        release_date: string;
    };
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
    downloadedCover?: boolean;
    failedCover?: boolean;
    skippedCover?: boolean;
    onDownload: (isrc: string, name: string, artists: string, albumName?: string, spotifyId?: string, playlistName?: string, durationMs?: number, position?: number, albumArtist?: string, releaseDate?: string, coverUrl?: string, spotifyTrackNumber?: number, spotifyDiscNumber?: number, spotifyTotalTracks?: number, spotifyTotalDiscs?: number, copyright?: string, publisher?: string) => void;
    onDownloadLyrics?: (spotifyId: string, name: string, artists: string, albumName?: string, albumArtist?: string, releaseDate?: string, discNumber?: number) => void;
    onCheckAvailability?: (spotifyId: string, isrc?: string) => void;
    onDownloadCover?: (coverUrl: string, trackName: string, artistName: string, albumName?: string, playlistName?: string, position?: number, trackId?: string, albumArtist?: string, releaseDate?: string, discNumber?: number) => void;
    onOpenFolder: () => void;
    onBack?: () => void;
}
export function TrackInfo({ track, isDownloading, downloadingTrack, isDownloaded, isFailed, isSkipped, downloadingLyricsTrack, downloadedLyrics, failedLyrics, skippedLyrics, checkingAvailability, availability, downloadingCover, downloadedCover, failedCover, skippedCover, onDownload, onDownloadLyrics, onCheckAvailability, onDownloadCover, onOpenFolder, onBack, }: TrackInfoProps) {
    const { playPreview, loadingPreview, playingTrack } = usePreview();
    const formatDuration = (ms: number) => {
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        return `${minutes}:${seconds.toString().padStart(2, "0")}`;
    };
    const formatPlays = (plays: string) => {
        const num = parseInt(plays, 10);
        if (isNaN(num))
            return plays;
        return num.toLocaleString();
    };
    return (<Card className="relative">
    {onBack && (<div className="absolute top-4 right-4 z-10">
        <Button variant="ghost" size="icon" onClick={onBack}>
            <XCircle className="h-5 w-5"/>
        </Button>
    </div>)}
    <CardContent className="px-6">
      <div className="flex gap-6 items-start">
        <div className="shrink-0">
          {track.images && (<div className="relative w-48 h-48 rounded-md shadow-lg overflow-hidden">
            <img src={track.images} alt={track.name} className="w-full h-full object-cover"/>
            <div className="absolute bottom-1 right-1 bg-black/80 text-white px-1.5 py-0.5 text-xs font-medium rounded">
              {formatDuration(track.duration_ms)}
            </div>
          </div>)}
        </div>
        <div className="flex-1 space-y-4 min-w-0">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold wrap-break-word">{track.name}</h1>
              {track.is_explicit && (<span className="inline-flex items-center justify-center bg-red-600 text-white text-[10px] h-4 w-4 rounded shrink-0" title="Explicit">E</span>)}
              {isSkipped ? (<FileCheck className="h-6 w-6 text-yellow-500 shrink-0"/>) : isDownloaded ? (<CheckCircle className="h-6 w-6 text-green-500 shrink-0"/>) : isFailed ? (<XCircle className="h-6 w-6 text-red-500 shrink-0"/>) : null}
            </div>
            <p className="text-lg text-muted-foreground">{track.artists}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="space-y-1">
              <div>
                <p className="text-xs text-muted-foreground">Album</p>
                <p className="font-medium truncate">{track.album_name}</p>
              </div>
              {track.plays && (<div>
                <p className="text-xs text-muted-foreground">Total Plays</p>
                <p className="font-medium">{formatPlays(track.plays)}</p>
              </div>)}
            </div>
            <div className="space-y-1">
              <div>
                <p className="text-xs text-muted-foreground">Release Date</p>
                <p className="font-medium">{track.release_date}</p>
              </div>
              {track.copyright && (<div>
                <p className="text-xs text-muted-foreground">Copyright</p>
                <p className="font-medium truncate" title={track.copyright}>
                  {track.copyright}
                </p>
              </div>)}
            </div>
          </div>
          {track.isrc && (<div className="flex gap-2 flex-wrap">
            <Button onClick={() => onDownload(track.isrc, track.name, track.artists, track.album_name, track.spotify_id, undefined, track.duration_ms, track.track_number, track.album_artist, track.release_date, track.images, track.track_number, track.disc_number, track.total_tracks, track.total_discs, track.copyright, track.publisher)} disabled={isDownloading || downloadingTrack === track.isrc}>
              {downloadingTrack === track.isrc ? (<Spinner />) : (<>
                <Download className="h-4 w-4"/>
                Download
              </>)}
            </Button>
            {track.spotify_id && (<Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={() => playPreview(track.spotify_id!, track.name)} variant="outline" size="icon" disabled={loadingPreview === track.spotify_id}>
                  {loadingPreview === track.spotify_id ? (<Spinner />) : playingTrack === track.spotify_id ? (<Pause className="h-4 w-4"/>) : (<Play className="h-4 w-4"/>)}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{playingTrack === track.spotify_id ? "Stop Preview" : "Play Preview"}</p>
              </TooltipContent>
            </Tooltip>)}
            {track.spotify_id && onDownloadLyrics && (<Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={() => onDownloadLyrics(track.spotify_id!, track.name, track.artists, track.album_name, track.album_artist, track.release_date, track.disc_number)} variant="outline" size="icon" disabled={downloadingLyricsTrack === track.spotify_id}>
                  {downloadingLyricsTrack === track.spotify_id ? (<Spinner />) : skippedLyrics ? (<FileCheck className="h-4 w-4 text-yellow-500"/>) : downloadedLyrics ? (<CheckCircle className="h-4 w-4 text-green-500"/>) : failedLyrics ? (<XCircle className="h-4 w-4 text-red-500"/>) : (<FileText className="h-4 w-4"/>)}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Download Lyric</p>
              </TooltipContent>
            </Tooltip>)}
            {track.images && onDownloadCover && (<Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={() => onDownloadCover(track.images, track.name, track.artists, track.album_name, undefined, undefined, track.spotify_id, track.album_artist, track.release_date, track.disc_number)} variant="outline" size="icon" disabled={downloadingCover}>
                  {downloadingCover ? (<Spinner />) : skippedCover ? (<FileCheck className="h-4 w-4 text-yellow-500"/>) : downloadedCover ? (<CheckCircle className="h-4 w-4 text-green-500"/>) : failedCover ? (<XCircle className="h-4 w-4 text-red-500"/>) : (<ImageDown className="h-4 w-4"/>)}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Download Cover</p>
              </TooltipContent>
            </Tooltip>)}
            {track.spotify_id && onCheckAvailability && (<Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={() => onCheckAvailability(track.spotify_id!, track.isrc)} variant="outline" size="icon" disabled={checkingAvailability}>
                  {checkingAvailability ? (<Spinner />) : availability ? (<CheckCircle className="h-4 w-4 text-green-500"/>) : (<Globe className="h-4 w-4"/>)}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {availability ? (<div className="flex items-center gap-2">
                  <TidalIcon className={`w-4 h-4 ${availability.tidal ? "text-green-500" : "text-red-500"}`}/>
                  <QobuzIcon className={`w-4 h-4 ${availability.qobuz ? "text-green-500" : "text-red-500"}`}/>
                  <AmazonIcon className={`w-4 h-4 ${availability.amazon ? "text-green-500" : "text-red-500"}`}/>
                </div>) : (<p>Check Availability</p>)}
              </TooltipContent>
            </Tooltip>)}
            {isDownloaded && (<Button onClick={onOpenFolder} variant="outline">
              <FolderOpen className="h-4 w-4"/>
              Open Folder
            </Button>)}
          </div>)}
        </div>
      </div>
    </CardContent>
  </Card>);
}
