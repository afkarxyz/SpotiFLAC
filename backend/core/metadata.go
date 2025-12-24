package core

import (
	"context"
	"fmt"
	"time"

	"spotiflac/backend"
)

// TrackMetadata represents metadata for a single track
type TrackMetadata struct {
	ISRC        string
	SpotifyID   string
	Name        string
	Artist      string
	AlbumName   string
	TrackNumber int
	Duration    int // in milliseconds
	Images      string
	ReleaseDate string
}

// AlbumMetadata represents metadata for an album
type AlbumMetadata struct {
	Name        string
	Artist      string
	ReleaseDate string
	Images      string
	TrackCount  int
	Tracks      []TrackMetadata
}

// PlaylistMetadata represents metadata for a playlist
type PlaylistMetadata struct {
	Name       string
	Owner      string
	TrackCount int
	Tracks     []TrackMetadata
}

// DiscographyMetadata represents metadata for an artist's discography
type DiscographyMetadata struct {
	ArtistName      string
	DiscographyType string // all, album, single, compilation
	TotalAlbums     int
	Albums          []AlbumMetadata
	AllTracks       []TrackMetadata
}

// MetadataFetcher handles fetching metadata from Spotify
type MetadataFetcher struct {
	timeout time.Duration
}

// NewMetadataFetcher creates a new metadata fetcher
func NewMetadataFetcher() *MetadataFetcher {
	return &MetadataFetcher{
		timeout: 300 * time.Second, // Default 5 minutes
	}
}

// SetTimeout sets the timeout for metadata fetching
func (f *MetadataFetcher) SetTimeout(timeout time.Duration) {
	f.timeout = timeout
}

// FetchAlbum fetches album metadata from a Spotify URL
func (f *MetadataFetcher) FetchAlbum(spotifyURL string) (*AlbumMetadata, error) {
	ctx, cancel := context.WithTimeout(context.Background(), f.timeout)
	defer cancel()

	// Use the existing backend function
	data, err := backend.GetFilteredSpotifyData(ctx, spotifyURL, false, 1*time.Second)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch Spotify metadata: %w", err)
	}

	// Type assert to AlbumResponsePayload with pointer
	albumPayload, ok := data.(*backend.AlbumResponsePayload)
	if !ok {
		return nil, fmt.Errorf("expected album data, got type %T (URL may not be an album)", data)
	}

	// Convert to our simpler structure
	album := &AlbumMetadata{
		Name:        albumPayload.AlbumInfo.Name,
		Artist:      albumPayload.AlbumInfo.Artists,
		ReleaseDate: albumPayload.AlbumInfo.ReleaseDate,
		Images:      albumPayload.AlbumInfo.Images,
		TrackCount:  len(albumPayload.TrackList),
		Tracks:      make([]TrackMetadata, 0, len(albumPayload.TrackList)),
	}

	// Convert tracks
	for _, track := range albumPayload.TrackList {
		album.Tracks = append(album.Tracks, TrackMetadata{
			ISRC:        track.ISRC,
			SpotifyID:   track.SpotifyID,
			Name:        track.Name,
			Artist:      track.Artists,
			AlbumName:   track.AlbumName,
			TrackNumber: track.TrackNumber,
			Duration:    track.DurationMS,
			Images:      track.Images,
			ReleaseDate: track.ReleaseDate,
		})
	}

	return album, nil
}

// FetchPlaylist fetches playlist metadata from a Spotify URL
func (f *MetadataFetcher) FetchPlaylist(spotifyURL string) (*PlaylistMetadata, error) {
	ctx, cancel := context.WithTimeout(context.Background(), f.timeout)
	defer cancel()

	data, err := backend.GetFilteredSpotifyData(ctx, spotifyURL, false, 1*time.Second)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch Spotify metadata: %w", err)
	}

	// Type assert to PlaylistResponsePayload
	playlistPayload, ok := data.(backend.PlaylistResponsePayload)
	if !ok {
		return nil, fmt.Errorf("expected playlist data, got different type (URL may not be a playlist)")
	}

	// Convert to our simpler structure
	playlist := &PlaylistMetadata{
		Name:       playlistPayload.PlaylistInfo.Owner.Name,
		Owner:      playlistPayload.PlaylistInfo.Owner.DisplayName,
		TrackCount: len(playlistPayload.TrackList),
		Tracks:     make([]TrackMetadata, 0, len(playlistPayload.TrackList)),
	}

	// Convert tracks
	for _, track := range playlistPayload.TrackList {
		playlist.Tracks = append(playlist.Tracks, TrackMetadata{
			ISRC:        track.ISRC,
			SpotifyID:   track.SpotifyID,
			Name:        track.Name,
			Artist:      track.Artists,
			AlbumName:   track.AlbumName,
			TrackNumber: track.TrackNumber,
			Duration:    track.DurationMS,
			Images:      track.Images,
			ReleaseDate: track.ReleaseDate,
		})
	}

	return playlist, nil
}

// FetchMetadata detects the type and fetches appropriate metadata
// Returns either *AlbumMetadata or *PlaylistMetadata
func (f *MetadataFetcher) FetchMetadata(spotifyURL string) (interface{}, error) {
	ctx, cancel := context.WithTimeout(context.Background(), f.timeout)
	defer cancel()

	data, err := backend.GetFilteredSpotifyData(ctx, spotifyURL, false, 1*time.Second)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch Spotify metadata: %w", err)
	}

	// Detect type and convert
	switch payload := data.(type) {
	case backend.AlbumResponsePayload:
		album := &AlbumMetadata{
			Name:        payload.AlbumInfo.Name,
			Artist:      payload.AlbumInfo.Artists,
			ReleaseDate: payload.AlbumInfo.ReleaseDate,
			Images:      payload.AlbumInfo.Images,
			TrackCount:  len(payload.TrackList),
			Tracks:      make([]TrackMetadata, 0, len(payload.TrackList)),
		}

		for _, track := range payload.TrackList {
			album.Tracks = append(album.Tracks, TrackMetadata{
				ISRC:        track.ISRC,
				SpotifyID:   track.SpotifyID,
				Name:        track.Name,
				Artist:      track.Artists,
				AlbumName:   track.AlbumName,
				TrackNumber: track.TrackNumber,
				Duration:    track.DurationMS,
				Images:      track.Images,
				ReleaseDate: track.ReleaseDate,
			})
		}
		return album, nil

	case backend.PlaylistResponsePayload:
		playlist := &PlaylistMetadata{
			Name:       payload.PlaylistInfo.Owner.Name,
			Owner:      payload.PlaylistInfo.Owner.DisplayName,
			TrackCount: len(payload.TrackList),
			Tracks:     make([]TrackMetadata, 0, len(payload.TrackList)),
		}

		for _, track := range payload.TrackList {
			playlist.Tracks = append(playlist.Tracks, TrackMetadata{
				ISRC:        track.ISRC,
				SpotifyID:   track.SpotifyID,
				Name:        track.Name,
				Artist:      track.Artists,
				AlbumName:   track.AlbumName,
				TrackNumber: track.TrackNumber,
				Duration:    track.DurationMS,
				Images:      track.Images,
				ReleaseDate: track.ReleaseDate,
			})
		}
		return playlist, nil

	default:
		return nil, fmt.Errorf("unsupported Spotify URL type (currently only albums and playlists are supported)")
	}
}

// FetchDiscography fetches artist discography metadata from a Spotify URL
func (f *MetadataFetcher) FetchDiscography(spotifyURL string) (*DiscographyMetadata, error) {
	ctx, cancel := context.WithTimeout(context.Background(), f.timeout)
	defer cancel()

	data, err := backend.GetFilteredSpotifyData(ctx, spotifyURL, false, 1*time.Second)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch Spotify metadata: %w", err)
	}

	// Type assert to ArtistDiscographyPayload
	discographyPayload, ok := data.(*backend.ArtistDiscographyPayload)
	if !ok {
		return nil, fmt.Errorf("expected discography data, got type %T (URL may not be an artist discography)", data)
	}

	// Convert to our simpler structure
	discography := &DiscographyMetadata{
		ArtistName:      discographyPayload.ArtistInfo.Name,
		DiscographyType: discographyPayload.ArtistInfo.DiscographyType,
		TotalAlbums:     len(discographyPayload.AlbumList),
		Albums:          make([]AlbumMetadata, 0, len(discographyPayload.AlbumList)),
		AllTracks:       make([]TrackMetadata, 0, len(discographyPayload.TrackList)),
	}

	// Group tracks by album
	tracksByAlbumID := make(map[string][]TrackMetadata)
	for _, track := range discographyPayload.TrackList {
		trackMeta := TrackMetadata{
			ISRC:        track.ISRC,
			SpotifyID:   track.SpotifyID,
			Name:        track.Name,
			Artist:      track.Artists,
			AlbumName:   track.AlbumName,
			TrackNumber: track.TrackNumber,
			Duration:    track.DurationMS,
			Images:      track.Images,
			ReleaseDate: track.ReleaseDate,
		}
		discography.AllTracks = append(discography.AllTracks, trackMeta)

		// Group by album (using album name as key since we don't have album ID in track)
		tracksByAlbumID[track.AlbumName] = append(tracksByAlbumID[track.AlbumName], trackMeta)
	}

	// Convert albums
	for _, album := range discographyPayload.AlbumList {
		albumTracks := tracksByAlbumID[album.Name]

		// Determine artist from first track or use album artist
		artist := album.Artists
		if len(albumTracks) > 0 {
			artist = albumTracks[0].Artist
		}

		albumMeta := AlbumMetadata{
			Name:        album.Name,
			Artist:      artist,
			ReleaseDate: album.ReleaseDate,
			Images:      album.Images,
			TrackCount:  len(albumTracks),
			Tracks:      albumTracks,
		}
		discography.Albums = append(discography.Albums, albumMeta)
	}

	return discography, nil
}
