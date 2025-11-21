export interface TrackMetadata {
  artists: string;
  name: string;
  album_name: string;
  duration_ms: number;
  images: string;
  release_date: string;
  track_number: number;
  external_urls: string;
  isrc: string;
  album_type?: string;
}

export interface TrackResponse {
  track: TrackMetadata;
}

export interface AlbumInfo {
  total_tracks: number;
  name: string;
  release_date: string;
  artists: string;
  images: string;
  batch?: string;
}

export interface AlbumResponse {
  album_info: AlbumInfo;
  track_list: TrackMetadata[];
}

export interface PlaylistInfo {
  tracks: {
    total: number;
  };
  followers: {
    total: number;
  };
  owner: {
    display_name: string;
    name: string;
    images: string;
  };
  batch?: string;
}

export interface PlaylistResponse {
  playlist_info: PlaylistInfo;
  track_list: TrackMetadata[];
}

export interface ArtistInfo {
  name: string;
  followers: number;
  genres: string[];
  images: string;
  external_urls: string;
  discography_type: string;
  total_albums: number;
  batch?: string;
}

export interface DiscographyAlbum {
  id: string;
  name: string;
  album_type: string;
  release_date: string;
  total_tracks: number;
  artists: string;
  images: string;
  external_urls: string;
}

export interface ArtistDiscographyResponse {
  artist_info: ArtistInfo;
  album_list: DiscographyAlbum[];
  track_list: TrackMetadata[];
}

export interface ArtistResponse {
  artist: {
    name: string;
    followers: number;
    genres: string[];
    images: string;
    external_urls: string;
    popularity: number;
  };
}

export type SpotifyMetadataResponse =
  | TrackResponse
  | AlbumResponse
  | PlaylistResponse
  | ArtistDiscographyResponse
  | ArtistResponse;

export interface DownloadRequest {
  isrc: string;
  service: "deezer" | "tidal";
  query?: string;
  api_url?: string;
  output_dir?: string;
  audio_format?: string;
  folder_name?: string;
  filename_format?: string;
  track_number?: boolean;
}

export interface DownloadResponse {
  success: boolean;
  message: string;
  file?: string;
  error?: string;
}

export interface HealthResponse {
  status: string;
  time: string;
}
