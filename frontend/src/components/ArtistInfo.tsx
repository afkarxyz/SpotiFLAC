import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Download, FolderOpen, ImageDown, FileText, BadgeCheck } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SearchAndSort } from "./SearchAndSort";
import { TrackList } from "./TrackList";
import { DownloadProgress } from "./DownloadProgress";
import type { TrackMetadata, TrackAvailability } from "@/types/api";
import { downloadHeader, downloadGalleryImage, downloadAvatar } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { useState } from "react";
interface ArtistInfoProps {
    artistInfo: {
        name: string;
        images: string;
        header?: string;
        gallery?: string[];
        followers: number;
        genres: string[];
        biography?: string;
        verified?: boolean;
        listeners?: number;
        rank?: number;
    };
    albumList: Array<{
        id: string;
        name: string;
        images: string;
        release_date: string;
        album_type: string;
        external_urls: string;
    }>;
    trackList: TrackMetadata[];
    searchQuery: string;
    sortBy: string;
    selectedTracks: string[];
    downloadedTracks: Set<string>;
    failedTracks: Set<string>;
    skippedTracks: Set<string>;
    downloadingTrack: string | null;
    isDownloading: boolean;
    bulkDownloadType: "all" | "selected" | null;
    downloadProgress: number;
    currentDownloadInfo: {
        name: string;
        artists: string;
    } | null;
    currentPage: number;
    itemsPerPage: number;
    downloadedLyrics?: Set<string>;
    failedLyrics?: Set<string>;
    skippedLyrics?: Set<string>;
    downloadingLyricsTrack?: string | null;
    checkingAvailabilityTrack?: string | null;
    availabilityMap?: Map<string, TrackAvailability>;
    downloadedCovers?: Set<string>;
    failedCovers?: Set<string>;
    skippedCovers?: Set<string>;
    downloadingCoverTrack?: string | null;
    isBulkDownloadingCovers?: boolean;
    isBulkDownloadingLyrics?: boolean;
    onSearchChange: (value: string) => void;
    onSortChange: (value: string) => void;
    onToggleTrack: (isrc: string) => void;
    onToggleSelectAll: (tracks: TrackMetadata[]) => void;
    onDownloadTrack: (isrc: string, name: string, artists: string, albumName: string, spotifyId?: string, folderName?: string, durationMs?: number, position?: number, albumArtist?: string, releaseDate?: string, coverUrl?: string, spotifyTrackNumber?: number, spotifyDiscNumber?: number, spotifyTotalTracks?: number, spotifyTotalDiscs?: number, copyright?: string, publisher?: string) => void;
    onDownloadLyrics?: (spotifyId: string, name: string, artists: string, albumName: string, folderName?: string, isArtistDiscography?: boolean, position?: number, albumArtist?: string, releaseDate?: string, discNumber?: number) => void;
    onDownloadCover?: (coverUrl: string, trackName: string, artistName: string, albumName: string, folderName?: string, isArtistDiscography?: boolean, position?: number, trackId?: string, albumArtist?: string, releaseDate?: string, discNumber?: number) => void;
    onCheckAvailability?: (spotifyId: string) => void;
    onDownloadAllLyrics?: () => void;
    onDownloadAllCovers?: () => void;
    onDownloadAll: () => void;
    onDownloadSelected: () => void;
    onStopDownload: () => void;
    onOpenFolder: () => void;
    onAlbumClick: (album: {
        id: string;
        name: string;
        external_urls: string;
    }) => void;
    onArtistClick: (artist: {
        id: string;
        name: string;
        external_urls: string;
    }) => void;
    onPageChange: (page: number) => void;
    onTrackClick?: (track: TrackMetadata) => void;
}
export function ArtistInfo({ artistInfo, albumList, trackList, searchQuery, sortBy, selectedTracks, downloadedTracks, failedTracks, skippedTracks, downloadingTrack, isDownloading, bulkDownloadType, downloadProgress, currentDownloadInfo, currentPage, itemsPerPage, downloadedLyrics, failedLyrics, skippedLyrics, downloadingLyricsTrack, checkingAvailabilityTrack, availabilityMap, downloadedCovers, failedCovers, skippedCovers, downloadingCoverTrack, isBulkDownloadingCovers, isBulkDownloadingLyrics, onSearchChange, onSortChange, onToggleTrack, onToggleSelectAll, onDownloadTrack, onDownloadLyrics, onDownloadCover, onCheckAvailability, onDownloadAllLyrics, onDownloadAllCovers, onDownloadAll, onDownloadSelected, onStopDownload, onOpenFolder, onAlbumClick, onArtistClick, onPageChange, onTrackClick, }: ArtistInfoProps) {
    const [downloadingHeader, setDownloadingHeader] = useState(false);
    const [downloadingAvatar, setDownloadingAvatar] = useState(false);
    const [downloadingGalleryIndex, setDownloadingGalleryIndex] = useState<number | null>(null);
    const [downloadingAllGallery, setDownloadingAllGallery] = useState(false);
    const handleDownloadHeader = async () => {
        if (!artistInfo.header)
            return;
        setDownloadingHeader(true);
        try {
            const settings = getSettings();
            const response = await downloadHeader({
                header_url: artistInfo.header,
                artist_name: artistInfo.name,
                output_dir: settings.downloadPath,
            });
            if (response.success) {
                if (response.already_exists) {
                    toast.info("Header already exists");
                }
                else {
                    toast.success("Header downloaded successfully");
                }
            }
            else {
                toast.error(response.error || "Failed to download header");
            }
        }
        catch (error) {
            toast.error(`Error downloading header: ${error}`);
        }
        finally {
            setDownloadingHeader(false);
        }
    };
    const handleDownloadAvatar = async () => {
        if (!artistInfo.images)
            return;
        setDownloadingAvatar(true);
        try {
            const settings = getSettings();
            const response = await downloadAvatar({
                avatar_url: artistInfo.images,
                artist_name: artistInfo.name,
                output_dir: settings.downloadPath,
            });
            if (response.success) {
                if (response.already_exists) {
                    toast.info("Avatar already exists");
                }
                else {
                    toast.success("Avatar downloaded successfully");
                }
            }
            else {
                toast.error(response.error || "Failed to download avatar");
            }
        }
        catch (error) {
            toast.error(`Error downloading avatar: ${error}`);
        }
        finally {
            setDownloadingAvatar(false);
        }
    };
    const handleDownloadGalleryImage = async (imageUrl: string, index: number) => {
        setDownloadingGalleryIndex(index);
        try {
            const settings = getSettings();
            const response = await downloadGalleryImage({
                image_url: imageUrl,
                artist_name: artistInfo.name,
                image_index: index,
                output_dir: settings.downloadPath,
            });
            if (response.success) {
                if (response.already_exists) {
                    toast.info(`Gallery image ${index + 1} already exists`);
                }
                else {
                    toast.success(`Gallery image ${index + 1} downloaded successfully`);
                }
            }
            else {
                toast.error(response.error || `Failed to download gallery image ${index + 1}`);
            }
        }
        catch (error) {
            toast.error(`Error downloading gallery image ${index + 1}: ${error}`);
        }
        finally {
            setDownloadingGalleryIndex(null);
        }
    };
    const handleDownloadAllGallery = async () => {
        if (!artistInfo.gallery || artistInfo.gallery.length === 0)
            return;
        setDownloadingAllGallery(true);
        try {
            const settings = getSettings();
            let successCount = 0;
            let existsCount = 0;
            let failCount = 0;
            for (let index = 0; index < artistInfo.gallery.length; index++) {
                const imageUrl = artistInfo.gallery[index];
                try {
                    const response = await downloadGalleryImage({
                        image_url: imageUrl,
                        artist_name: artistInfo.name,
                        image_index: index,
                        output_dir: settings.downloadPath,
                    });
                    if (response.success) {
                        if (response.already_exists) {
                            existsCount++;
                        }
                        else {
                            successCount++;
                        }
                    }
                    else {
                        failCount++;
                    }
                }
                catch (error) {
                    failCount++;
                }
            }
            if (failCount === 0) {
                if (existsCount > 0 && successCount > 0) {
                    toast.success(`${successCount} images downloaded, ${existsCount} already existed`);
                }
                else if (existsCount > 0) {
                    toast.info(`All ${existsCount} images already exist`);
                }
                else {
                    toast.success(`All ${successCount} gallery images downloaded successfully`);
                }
            }
            else {
                toast.error(`${failCount} images failed to download`);
            }
        }
        catch (error) {
            toast.error(`Error downloading gallery images: ${error}`);
        }
        finally {
            setDownloadingAllGallery(false);
        }
    };
    return (<div className="space-y-6">
      <Card className="overflow-hidden p-0">
        {artistInfo.header ? (<>
            <div className="relative w-full h-64 bg-cover bg-center">
              <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${artistInfo.header})` }}/>
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent"/>
              <div className="absolute top-4 right-4 z-10">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button onClick={handleDownloadHeader} size="sm" variant="secondary" disabled={downloadingHeader} className="bg-white/10 hover:bg-white/20 text-white border-white/20">
                      {downloadingHeader ? (<Spinner className="h-4 w-4"/>) : (<ImageDown className="h-4 w-4"/>)}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Download Header</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="relative px-6 pt-6 pb-20">
                <div className="flex gap-6 items-start">
                  {artistInfo.images && (<div className="relative group">
                      <img src={artistInfo.images} alt={artistInfo.name} className="w-48 h-48 rounded-full shadow-lg object-cover border-4 border-white"/>
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-colors rounded-full flex items-center justify-center">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button onClick={handleDownloadAvatar} size="sm" variant="secondary" disabled={downloadingAvatar} className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/10 hover:bg-white/20 text-white border-white/20">
                              {downloadingAvatar ? (<Spinner className="h-4 w-4"/>) : (<ImageDown className="h-4 w-4"/>)}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Download Avatar</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>)}
                  <div className="flex-1 space-y-2">
                    <p className="text-sm font-medium text-white/80">Artist</p>
                    <div className="flex items-center gap-2">
                      <h2 className="text-4xl font-bold text-white">{artistInfo.name}</h2>
                      {artistInfo.verified && (<BadgeCheck className="h-6 w-6 text-blue-400 shrink-0"/>)}
                    </div>
                    {artistInfo.biography && (<p className="text-sm text-white/90">{artistInfo.biography}</p>)}
                    <div className="flex items-center gap-2 text-sm flex-wrap text-white/90">
                      <span>{artistInfo.followers.toLocaleString()} followers</span>
                      {artistInfo.listeners && (<>
                          <span>•</span>
                          <span>{artistInfo.listeners.toLocaleString()} listeners</span>
                        </>)}
                      {artistInfo.rank && (<>
                          <span>•</span>
                          <span>#{artistInfo.rank} rank</span>
                        </>)}
                      <span>•</span>
                      <span>{albumList.length} {albumList.length === 1 ? "album" : "albums"}</span>
                      <span>•</span>
                      <span>{trackList.length} {trackList.length === 1 ? "track" : "tracks"}</span>
                      {artistInfo.genres.length > 0 && (<>
                          <span>•</span>
                          <span>{artistInfo.genres.join(", ")}</span>
                        </>)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>) : (<CardContent className="px-6 py-6">
            <div className="flex gap-6 items-start">
              {artistInfo.images && (<div className="relative group">
                  <img src={artistInfo.images} alt={artistInfo.name} className="w-48 h-48 rounded-full shadow-lg object-cover border-4 border-white"/>
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-colors rounded-full flex items-center justify-center">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button onClick={handleDownloadAvatar} size="sm" variant="secondary" disabled={downloadingAvatar} className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/10 hover:bg-white/20 text-white border-white/20">
                          {downloadingAvatar ? (<Spinner className="h-4 w-4"/>) : (<ImageDown className="h-4 w-4"/>)}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Download Avatar</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>)}
              <div className="flex-1 space-y-2">
                <p className="text-sm font-medium">Artist</p>
                <div className="flex items-center gap-2">
                  <h2 className="text-4xl font-bold">{artistInfo.name}</h2>
                  {artistInfo.verified && (<BadgeCheck className="h-6 w-6 text-blue-500 shrink-0"/>)}
                </div>
                {artistInfo.biography && (<p className="text-sm text-muted-foreground">{artistInfo.biography}</p>)}
                <div className="flex items-center gap-2 text-sm flex-wrap">
                  <span>{artistInfo.followers.toLocaleString()} followers</span>
                  {artistInfo.listeners && (<>
                      <span>•</span>
                      <span>{artistInfo.listeners.toLocaleString()} listeners</span>
                    </>)}
                  {artistInfo.rank && (<>
                      <span>•</span>
                      <span>#{artistInfo.rank} rank</span>
                    </>)}
                  <span>•</span>
                  <span>{albumList.length} albums</span>
                  <span>•</span>
                  <span>{trackList.length} tracks</span>
                  {artistInfo.genres.length > 0 && (<>
                      <span>•</span>
                      <span>{artistInfo.genres.join(", ")}</span>
                    </>)}
                </div>
              </div>
            </div>
          </CardContent>)}
      </Card>

      {artistInfo.gallery && artistInfo.gallery.length > 0 && (<div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-2xl font-bold">Gallery ({artistInfo.gallery.length})</h3>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={handleDownloadAllGallery} size="sm" variant="outline" disabled={downloadingAllGallery}>
                  {downloadingAllGallery ? <Spinner className="h-4 w-4"/> : <ImageDown className="h-4 w-4"/>}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Download All Gallery</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {artistInfo.gallery.map((imageUrl, index) => (<div key={index} className="relative group">
                <div className="relative aspect-square rounded-md overflow-hidden shadow-md">
                  <img src={imageUrl} alt={`${artistInfo.name} gallery ${index + 1}`} className="w-full h-full object-cover"/>
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-colors flex items-center justify-center">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button onClick={() => handleDownloadGalleryImage(imageUrl, index)} size="sm" variant="secondary" disabled={downloadingGalleryIndex === index} className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/10 hover:bg-white/20 text-white border-white/20">
                          {downloadingGalleryIndex === index ? (<Spinner className="h-4 w-4"/>) : (<ImageDown className="h-4 w-4"/>)}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Download Image {index + 1}</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </div>))}
          </div>
        </div>)}

      {albumList.length > 0 && (<div className="space-y-4">
          <h3 className="text-2xl font-bold">Discography</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {albumList.map((album) => (<div key={album.id} className="group cursor-pointer" onClick={() => onAlbumClick({
                    id: album.id,
                    name: album.name,
                    external_urls: album.external_urls,
                })}>
                <div className="relative mb-4">
                  {album.images && (<img src={album.images} alt={album.name} className="w-full aspect-square object-cover rounded-md shadow-md transition-shadow group-hover:shadow-xl"/>)}
                </div>
                <h4 className="font-semibold truncate">{album.name}</h4>
                <p className="text-sm text-muted-foreground">
                  {album.release_date?.split("-")[0]}
                </p>
              </div>))}
          </div>
        </div>)}

      {trackList.length > 0 && (<div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-2xl font-bold">All Tracks</h3>
            <div className="flex gap-2 flex-wrap">
              <Button onClick={onDownloadAll} size="sm" disabled={isDownloading}>
                {isDownloading && bulkDownloadType === "all" ? (<Spinner />) : (<Download className="h-4 w-4"/>)}
                Download All
              </Button>
              {selectedTracks.length > 0 && (<Button onClick={onDownloadSelected} size="sm" variant="secondary" disabled={isDownloading}>
                  {isDownloading && bulkDownloadType === "selected" ? (<Spinner />) : (<Download className="h-4 w-4"/>)}
                  Download Selected ({selectedTracks.length})
                </Button>)}
              {onDownloadAllLyrics && (<Tooltip>
                  <TooltipTrigger asChild>
                    <Button onClick={onDownloadAllLyrics} size="sm" variant="outline" disabled={isBulkDownloadingLyrics}>
                      {isBulkDownloadingLyrics ? <Spinner /> : <FileText className="h-4 w-4"/>}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Download All Lyrics</p>
                  </TooltipContent>
                </Tooltip>)}
              {onDownloadAllCovers && (<Tooltip>
                  <TooltipTrigger asChild>
                    <Button onClick={onDownloadAllCovers} size="sm" variant="outline" disabled={isBulkDownloadingCovers}>
                      {isBulkDownloadingCovers ? <Spinner /> : <ImageDown className="h-4 w-4"/>}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Download All Covers</p>
                  </TooltipContent>
                </Tooltip>)}
              {downloadedTracks.size > 0 && (<Button onClick={onOpenFolder} size="sm" variant="outline">
                  <FolderOpen className="h-4 w-4"/>
                  Open Folder
                </Button>)}
            </div>
          </div>
          {isDownloading && (<DownloadProgress progress={downloadProgress} currentTrack={currentDownloadInfo} onStop={onStopDownload}/>)}
          <SearchAndSort searchQuery={searchQuery} sortBy={sortBy} onSearchChange={onSearchChange} onSortChange={onSortChange}/>
          <TrackList tracks={trackList} searchQuery={searchQuery} sortBy={sortBy} selectedTracks={selectedTracks} downloadedTracks={downloadedTracks} failedTracks={failedTracks} skippedTracks={skippedTracks} downloadingTrack={downloadingTrack} isDownloading={isDownloading} currentPage={currentPage} itemsPerPage={itemsPerPage} showCheckboxes={true} hideAlbumColumn={false} folderName={artistInfo.name} isArtistDiscography={true} downloadedLyrics={downloadedLyrics} failedLyrics={failedLyrics} skippedLyrics={skippedLyrics} downloadingLyricsTrack={downloadingLyricsTrack} checkingAvailabilityTrack={checkingAvailabilityTrack} availabilityMap={availabilityMap} onToggleTrack={onToggleTrack} onToggleSelectAll={onToggleSelectAll} onDownloadTrack={onDownloadTrack} onDownloadLyrics={onDownloadLyrics} onDownloadCover={onDownloadCover} downloadedCovers={downloadedCovers} failedCovers={failedCovers} skippedCovers={skippedCovers} downloadingCoverTrack={downloadingCoverTrack} onCheckAvailability={onCheckAvailability} onPageChange={onPageChange} onAlbumClick={onAlbumClick} onArtistClick={onArtistClick} onTrackClick={onTrackClick}/>
        </div>)}
    </div>);
}
