export interface ArtistSimple {
  id: string;
  name: string;
  external_urls: string;
}

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
  spotify_id?: string;
  album_id?: string;
  album_url?: string;
  artist_id?: string;
  artist_url?: string;
  artists_data?: ArtistSimple[];
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
  service: "deezer" | "tidal" | "qobuz" | "amazon";
  query?: string;
  track_name?: string;
  artist_name?: string;
  album_name?: string;
  api_url?: string;
  output_dir?: string;
  audio_format?: string;
  folder_name?: string;
  filename_format?: string;
  track_number?: boolean;
  position?: number;
  use_album_track_number?: boolean;
  spotify_id?: string;
  service_url?: string;
  duration?: number; // Track duration in seconds for better matching
  item_id?: string; // Optional queue item ID for multi-service fallback tracking
}

export interface DownloadResponse {
  success: boolean;
  message: string;
  file?: string;
  error?: string;
  already_exists?: boolean;
  item_id?: string; // Queue item ID for tracking
}

export interface HealthResponse {
  status: string;
  time: string;
}

export interface TimeSlice {
  time: number;
  magnitudes: number[]; 
}

export interface SpectrumData {
  time_slices: TimeSlice[];
  sample_rate: number;
  freq_bins: number;
  duration: number;
  max_freq: number;
}

export interface AnalysisResult {
  file_path: string;
  sample_rate: number;
  channels: number;
  bits_per_sample: number;
  total_samples: number;
  duration: number;
  bit_depth: string;
  dynamic_range: number;
  peak_amplitude: number;
  rms_level: number;
  spectrum?: SpectrumData;
}

export interface LyricsDownloadRequest {
  spotify_id: string;
  track_name: string;
  artist_name: string;
  output_dir?: string;
  filename_format?: string;
  track_number?: boolean;
  position?: number;
  use_album_track_number?: boolean;
}

export interface LyricsDownloadResponse {
  success: boolean;
  message: string;
  file?: string;
  error?: string;
  already_exists?: boolean;
}

export interface TrackAvailability {
  spotify_id: string;
  tidal: boolean;
  deezer: boolean;
  amazon: boolean;
  qobuz: boolean;
  tidal_url?: string;
  deezer_url?: string;
  amazon_url?: string;
  qobuz_url?: string;
}


