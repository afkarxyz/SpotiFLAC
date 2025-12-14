package backend

import (
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	spotifyTokenURL       = "https://open.spotify.com/api/token"
	playlistBaseURL       = "https://api.spotify.com/v1/playlists/%s"
	albumBaseURL          = "https://api.spotify.com/v1/albums/%s"
	trackBaseURL          = "https://api.spotify.com/v1/tracks/%s"
	artistBaseURL         = "https://api.spotify.com/v1/artists/%s"
	artistAlbumsBaseURL   = "https://api.spotify.com/v1/artists/%s/albums"
	secretBytesRemotePath = "https://cdn.jsdelivr.net/gh/afkarxyz/secretBytes@refs/heads/main/secrets/secretBytes.json"
)

var (
	errInvalidSpotifyURL = errors.New("invalid or unsupported Spotify URL")
)

// SpotifyMetadataClient mirrors the behaviour of Doc/getMetadata.py and interacts with Spotify's web API.
type SpotifyMetadataClient struct {
	httpClient *http.Client
	rng        *rand.Rand
	rngMu      sync.Mutex
	userAgent  string
}

// NewSpotifyMetadataClient creates a ready-to-use client with sane defaults.
func NewSpotifyMetadataClient() *SpotifyMetadataClient {
	src := rand.NewSource(time.Now().UnixNano())
	c := &SpotifyMetadataClient{
		httpClient: &http.Client{Timeout: 15 * time.Second},
		rng:        rand.New(src),
	}
	c.userAgent = c.randomUserAgent()
	return c
}

// TrackMetadata mirrors the filtered track payload returned by the Python script.
type TrackMetadata struct {
	SpotifyID   string `json:"spotify_id,omitempty"`
	Artists     string `json:"artists"`
	Name        string `json:"name"`
	AlbumName   string `json:"album_name"`
	AlbumArtist string `json:"album_artist,omitempty"`
	DurationMS  int    `json:"duration_ms"`
	Images      string `json:"images"`
	ReleaseDate string `json:"release_date"`
	TrackNumber int    `json:"track_number"`
	TotalTracks int    `json:"total_tracks,omitempty"`
	DiscNumber  int    `json:"disc_number,omitempty"`
	ExternalURL string `json:"external_urls"`
	ISRC        string `json:"isrc"`
}

// ArtistSimple holds basic artist info for clickable artists
type ArtistSimple struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	ExternalURL string `json:"external_urls"`
}

// AlbumTrackMetadata holds per-track info for album / playlist formatting.
type AlbumTrackMetadata struct {
	SpotifyID   string         `json:"spotify_id,omitempty"`
	Artists     string         `json:"artists"`
	Name        string         `json:"name"`
	AlbumName   string         `json:"album_name"`
	AlbumArtist string         `json:"album_artist,omitempty"`
	DurationMS  int            `json:"duration_ms"`
	Images      string         `json:"images"`
	ReleaseDate string         `json:"release_date"`
	TrackNumber int            `json:"track_number"`
	TotalTracks int            `json:"total_tracks,omitempty"`
	DiscNumber  int            `json:"disc_number,omitempty"`
	ExternalURL string         `json:"external_urls"`
	ISRC        string         `json:"isrc"`
	AlbumType   string         `json:"album_type,omitempty"`
	AlbumID     string         `json:"album_id,omitempty"`
	AlbumURL    string         `json:"album_url,omitempty"`
	ArtistID    string         `json:"artist_id,omitempty"`
	ArtistURL   string         `json:"artist_url,omitempty"`
	ArtistsData []ArtistSimple `json:"artists_data,omitempty"`
}

type TrackResponse struct {
	Track TrackMetadata `json:"track"`
}

type AlbumInfoMetadata struct {
	TotalTracks int    `json:"total_tracks"`
	Name        string `json:"name"`
	ReleaseDate string `json:"release_date"`
	Artists     string `json:"artists"`
	Images      string `json:"images"`
	Batch       string `json:"batch,omitempty"`
	ArtistID    string `json:"artist_id,omitempty"`
	ArtistURL   string `json:"artist_url,omitempty"`
}

type AlbumResponsePayload struct {
	AlbumInfo AlbumInfoMetadata    `json:"album_info"`
	TrackList []AlbumTrackMetadata `json:"track_list"`
}

type PlaylistInfoMetadata struct {
	Tracks struct {
		Total int `json:"total"`
	} `json:"tracks"`
	Followers struct {
		Total int `json:"total"`
	} `json:"followers"`
	Owner struct {
		DisplayName string `json:"display_name"`
		Name        string `json:"name"`
		Images      string `json:"images"`
	} `json:"owner"`
	Batch string `json:"batch,omitempty"`
}

type PlaylistResponsePayload struct {
	PlaylistInfo PlaylistInfoMetadata `json:"playlist_info"`
	TrackList    []AlbumTrackMetadata `json:"track_list"`
}

type ArtistInfoMetadata struct {
	Name            string   `json:"name"`
	Followers       int      `json:"followers"`
	Genres          []string `json:"genres"`
	Images          string   `json:"images"`
	ExternalURL     string   `json:"external_urls"`
	DiscographyType string   `json:"discography_type"`
	TotalAlbums     int      `json:"total_albums"`
	Batch           string   `json:"batch,omitempty"`
}

type DiscographyAlbumMetadata struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	AlbumType   string `json:"album_type"`
	ReleaseDate string `json:"release_date"`
	TotalTracks int    `json:"total_tracks"`
	Artists     string `json:"artists"`
	Images      string `json:"images"`
	ExternalURL string `json:"external_urls"`
}

type ArtistDiscographyPayload struct {
	ArtistInfo ArtistInfoMetadata         `json:"artist_info"`
	AlbumList  []DiscographyAlbumMetadata `json:"album_list"`
	TrackList  []AlbumTrackMetadata       `json:"track_list"`
}

type ArtistResponsePayload struct {
	Artist struct {
		Name        string   `json:"name"`
		Followers   int      `json:"followers"`
		Genres      []string `json:"genres"`
		Images      string   `json:"images"`
		ExternalURL string   `json:"external_urls"`
		Popularity  int      `json:"popularity"`
	} `json:"artist"`
}

type spotifyURI struct {
	Type             string
	ID               string
	DiscographyGroup string
}

type secretEntry struct {
	Version int   `json:"version"`
	Secret  []int `json:"secret"`
}

type serverTimeResponse struct {
	ServerTime int64 `json:"serverTime"`
}

type accessTokenResponse struct {
	AccessToken string `json:"accessToken"`
}

type image struct {
	URL string `json:"url"`
}

type externalURL struct {
	Spotify string `json:"spotify"`
}

type externalID struct {
	ISRC string `json:"isrc"`
}

type artist struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type albumSimplified struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	AlbumType   string      `json:"album_type"`
	ReleaseDate string      `json:"release_date"`
	TotalTracks int         `json:"total_tracks"`
	Images      []image     `json:"images"`
	ExternalURL externalURL `json:"external_urls"`
	Artists     []artist    `json:"artists"`
}

type trackSimplified struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	DurationMS  int         `json:"duration_ms"`
	TrackNumber int         `json:"track_number"`
	DiscNumber  int         `json:"disc_number"`
	ExternalURL externalURL `json:"external_urls"`
	Artists     []artist    `json:"artists"`
}

type trackFull struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	DurationMS  int             `json:"duration_ms"`
	TrackNumber int             `json:"track_number"`
	DiscNumber  int             `json:"disc_number"`
	ExternalURL externalURL     `json:"external_urls"`
	ExternalID  externalID      `json:"external_ids"`
	Album       albumSimplified `json:"album"`
	Artists     []artist        `json:"artists"`
}

type playlistTrackItem struct {
	Track *trackFull `json:"track"`
}

type playlistResponse struct {
	Name   string  `json:"name"`
	Images []image `json:"images"`
	Owner  struct {
		DisplayName string `json:"display_name"`
	} `json:"owner"`
	Followers struct {
		Total int `json:"total"`
	} `json:"followers"`
	Tracks struct {
		Items []playlistTrackItem `json:"items"`
		Next  string              `json:"next"`
		Total int                 `json:"total"`
	} `json:"tracks"`
}

type albumResponse struct {
	Name        string   `json:"name"`
	ReleaseDate string   `json:"release_date"`
	TotalTracks int      `json:"total_tracks"`
	Images      []image  `json:"images"`
	Artists     []artist `json:"artists"`
	Tracks      struct {
		Items []trackSimplified `json:"items"`
		Next  string            `json:"next"`
	} `json:"tracks"`
}

type artistResponse struct {
	Name      string `json:"name"`
	Followers struct {
		Total int `json:"total"`
	} `json:"followers"`
	Genres      []string    `json:"genres"`
	Images      []image     `json:"images"`
	ExternalURL externalURL `json:"external_urls"`
	Popularity  int         `json:"popularity"`
}

type playlistRaw struct {
	Data         playlistResponse
	BatchEnabled bool
	BatchCount   int
}

type albumRaw struct {
	Data         albumResponse
	Token        string
	BatchEnabled bool
	BatchCount   int
}

type discographyRaw struct {
	Artist       artistResponse
	Albums       []albumSimplified
	Token        string
	Discography  string
	BatchEnabled bool
	BatchCount   int
}

// GetFilteredSpotifyData is a convenience wrapper that mirrors the Python module's entry point.
func GetFilteredSpotifyData(ctx context.Context, spotifyURL string, batch bool, delay time.Duration) (interface{}, error) {
	client := NewSpotifyMetadataClient()
	return client.GetFilteredData(ctx, spotifyURL, batch, delay)
}

// GetFilteredData fetches, normalises, and formats Spotify payloads for the given URL.
func (c *SpotifyMetadataClient) GetFilteredData(ctx context.Context, spotifyURL string, batch bool, delay time.Duration) (interface{}, error) {
	parsed, err := parseSpotifyURI(spotifyURL)
	if err != nil {
		return nil, err
	}

	token, err := c.getAccessToken(ctx)
	if err != nil {
		return nil, err
	}

	raw, err := c.getRawSpotifyData(ctx, parsed, token, batch, delay)
	if err != nil {
		return nil, err
	}

	return c.processSpotifyData(ctx, raw)
}

func (c *SpotifyMetadataClient) getRawSpotifyData(ctx context.Context, parsed spotifyURI, token string, batch bool, delay time.Duration) (interface{}, error) {
	switch parsed.Type {
	case "playlist":
		return c.fetchPlaylist(ctx, parsed.ID, token, batch, delay)
	case "album":
		return c.fetchAlbum(ctx, parsed.ID, token, batch, delay)
	case "track":
		return c.fetchTrack(ctx, parsed.ID, token)
	case "artist_discography":
		return c.fetchArtistDiscography(ctx, parsed, token, batch, delay)
	case "artist":
		return c.fetchArtist(ctx, parsed.ID, token)
	default:
		return nil, fmt.Errorf("unsupported Spotify type: %s", parsed.Type)
	}
}

func (c *SpotifyMetadataClient) processSpotifyData(ctx context.Context, raw interface{}) (interface{}, error) {
	switch payload := raw.(type) {
	case *playlistRaw:
		return c.formatPlaylistData(payload), nil
	case *albumRaw:
		return c.formatAlbumData(ctx, payload)
	case *trackFull:
		trackPayload := formatTrackData(payload)
		return trackPayload, nil
	case *discographyRaw:
		return c.formatArtistDiscographyData(ctx, payload)
	case *artistResponse:
		formatted := formatArtistData(payload)
		return formatted, nil
	default:
		return nil, errors.New("unknown raw payload type")
	}
}

func (c *SpotifyMetadataClient) fetchPlaylist(ctx context.Context, playlistID, token string, batch bool, delay time.Duration) (*playlistRaw, error) {
	var data playlistResponse
	if err := c.getJSON(ctx, fmt.Sprintf(playlistBaseURL, playlistID), token, &data); err != nil {
		return nil, err
	}

	tracksURL := fmt.Sprintf("https://api.spotify.com/v1/playlists/%s/tracks?limit=100", playlistID)
	var items []playlistTrackItem
	batchDelay := time.Duration(0)
	if batch {
		batchDelay = delay
	}
	batches, err := fetchPaging(ctx, c, tracksURL, token, batchDelay, &items)
	if err != nil {
		return nil, err
	}
	if len(items) > 0 {
		data.Tracks.Items = items
	}

	return &playlistRaw{
		Data:         data,
		BatchEnabled: batch,
		BatchCount:   batches,
	}, nil
}

func (c *SpotifyMetadataClient) fetchAlbum(ctx context.Context, albumID, token string, batch bool, delay time.Duration) (*albumRaw, error) {
	var data albumResponse
	if err := c.getJSON(ctx, fmt.Sprintf(albumBaseURL, albumID), token, &data); err != nil {
		return nil, err
	}

	tracksURL := fmt.Sprintf("%s/tracks?limit=50", fmt.Sprintf(albumBaseURL, albumID))
	var items []trackSimplified
	batchDelay := time.Duration(0)
	if batch {
		batchDelay = delay
	}
	batches, err := fetchPaging(ctx, c, tracksURL, token, batchDelay, &items)
	if err != nil {
		return nil, err
	}
	if len(items) > 0 {
		data.Tracks.Items = items
	}

	return &albumRaw{
		Data:         data,
		Token:        token,
		BatchEnabled: batch,
		BatchCount:   batches,
	}, nil
}

func (c *SpotifyMetadataClient) fetchTrack(ctx context.Context, trackID, token string) (*trackFull, error) {
	var data trackFull
	if err := c.getJSON(ctx, fmt.Sprintf(trackBaseURL, trackID), token, &data); err != nil {
		return nil, err
	}
	return &data, nil
}

func (c *SpotifyMetadataClient) fetchArtistDiscography(ctx context.Context, parsed spotifyURI, token string, batch bool, delay time.Duration) (*discographyRaw, error) {
	var artistData artistResponse
	if err := c.getJSON(ctx, fmt.Sprintf(artistBaseURL, parsed.ID), token, &artistData); err != nil {
		return nil, err
	}

	includeGroups := parsed.DiscographyGroup
	if includeGroups == "" || includeGroups == "all" {
		includeGroups = "album,single,compilation"
	}

	albumsURL := fmt.Sprintf("%s?include_groups=%s&limit=50", fmt.Sprintf(artistAlbumsBaseURL, parsed.ID), includeGroups)
	var albums []albumSimplified
	batchDelay := time.Duration(0)
	if batch {
		batchDelay = delay
	}
	batches, err := fetchPaging(ctx, c, albumsURL, token, batchDelay, &albums)
	if err != nil {
		return nil, err
	}

	return &discographyRaw{
		Artist:       artistData,
		Albums:       albums,
		Token:        token,
		Discography:  parsed.DiscographyGroup,
		BatchEnabled: batch,
		BatchCount:   batches,
	}, nil
}

func (c *SpotifyMetadataClient) fetchArtist(ctx context.Context, artistID, token string) (*artistResponse, error) {
	var artistData artistResponse
	if err := c.getJSON(ctx, fmt.Sprintf(artistBaseURL, artistID), token, &artistData); err != nil {
		return nil, err
	}
	return &artistData, nil
}

func (c *SpotifyMetadataClient) formatPlaylistData(raw *playlistRaw) PlaylistResponsePayload {
	var info PlaylistInfoMetadata
	info.Tracks.Total = raw.Data.Tracks.Total
	info.Followers.Total = raw.Data.Followers.Total
	info.Owner.DisplayName = raw.Data.Owner.DisplayName
	info.Owner.Name = raw.Data.Name
	info.Owner.Images = firstImageURL(raw.Data.Images)
	if raw.BatchEnabled {
		info.Batch = strconv.Itoa(maxInt(1, raw.BatchCount))
	}

	tracks := make([]AlbumTrackMetadata, 0, len(raw.Data.Tracks.Items))
	for _, item := range raw.Data.Tracks.Items {
		if item.Track == nil {
			continue
		}
		var artistID, artistURL string
		if len(item.Track.Artists) > 0 {
			artistID = item.Track.Artists[0].ID
			artistURL = fmt.Sprintf("https://open.spotify.com/artist/%s", item.Track.Artists[0].ID)
		}
		artistsData := make([]ArtistSimple, 0, len(item.Track.Artists))
		for _, a := range item.Track.Artists {
			artistsData = append(artistsData, ArtistSimple{
				ID:          a.ID,
				Name:        a.Name,
				ExternalURL: fmt.Sprintf("https://open.spotify.com/artist/%s", a.ID),
			})
		}
		tracks = append(tracks, AlbumTrackMetadata{
			SpotifyID:   item.Track.ID,
			Artists:     joinArtists(item.Track.Artists),
			Name:        item.Track.Name,
			AlbumName:   item.Track.Album.Name,
			AlbumArtist: joinArtists(item.Track.Album.Artists),
			DurationMS:  item.Track.DurationMS,
			Images:      firstNonEmpty(firstImageURL(item.Track.Album.Images), info.Owner.Images),
			ReleaseDate: item.Track.Album.ReleaseDate,
			TrackNumber: item.Track.TrackNumber,
			TotalTracks: item.Track.Album.TotalTracks,
			DiscNumber:  item.Track.DiscNumber,
			ExternalURL: item.Track.ExternalURL.Spotify,
			ISRC:        item.Track.ExternalID.ISRC,
			AlbumID:     item.Track.Album.ID,
			AlbumURL:    item.Track.Album.ExternalURL.Spotify,
			ArtistID:    artistID,
			ArtistURL:   artistURL,
			ArtistsData: artistsData,
		})
	}

	return PlaylistResponsePayload{
		PlaylistInfo: info,
		TrackList:    tracks,
	}
}

func (c *SpotifyMetadataClient) formatAlbumData(ctx context.Context, raw *albumRaw) (*AlbumResponsePayload, error) {
	albumImage := firstImageURL(raw.Data.Images)
	var artistID, artistURL string
	if len(raw.Data.Artists) > 0 {
		artistID = raw.Data.Artists[0].ID
		artistURL = fmt.Sprintf("https://open.spotify.com/artist/%s", raw.Data.Artists[0].ID)
	}
	info := AlbumInfoMetadata{
		TotalTracks: raw.Data.TotalTracks,
		Name:        raw.Data.Name,
		ReleaseDate: raw.Data.ReleaseDate,
		Artists:     joinArtists(raw.Data.Artists),
		Images:      albumImage,
		ArtistID:    artistID,
		ArtistURL:   artistURL,
	}
	if raw.BatchEnabled {
		info.Batch = strconv.Itoa(maxInt(1, raw.BatchCount))
	}

	tracks := make([]AlbumTrackMetadata, 0, len(raw.Data.Tracks.Items))
	cache := make(map[string]string)
	for _, item := range raw.Data.Tracks.Items {
		isrc := c.fetchTrackISRC(ctx, item.ID, raw.Token, cache)
		tracks = append(tracks, AlbumTrackMetadata{
			SpotifyID:   item.ID,
			Artists:     joinArtists(item.Artists),
			Name:        item.Name,
			AlbumName:   raw.Data.Name,
			AlbumArtist: joinArtists(raw.Data.Artists),
			DurationMS:  item.DurationMS,
			Images:      albumImage,
			ReleaseDate: raw.Data.ReleaseDate,
			TrackNumber: item.TrackNumber,
			TotalTracks: raw.Data.TotalTracks,
			DiscNumber:  item.DiscNumber,
			ExternalURL: item.ExternalURL.Spotify,
			ISRC:        isrc,
		})
	}

	return &AlbumResponsePayload{
		AlbumInfo: info,
		TrackList: tracks,
	}, nil
}

func (c *SpotifyMetadataClient) formatArtistDiscographyData(ctx context.Context, raw *discographyRaw) (*ArtistDiscographyPayload, error) {
	artistImage := firstImageURL(raw.Artist.Images)
	discType := raw.Discography
	if discType == "" {
		discType = "all"
	}

	info := ArtistInfoMetadata{
		Name:            raw.Artist.Name,
		Followers:       raw.Artist.Followers.Total,
		Genres:          raw.Artist.Genres,
		Images:          artistImage,
		ExternalURL:     raw.Artist.ExternalURL.Spotify,
		DiscographyType: discType,
		TotalAlbums:     len(raw.Albums),
	}
	if raw.BatchEnabled {
		info.Batch = strconv.Itoa(maxInt(1, raw.BatchCount))
	}

	albumList := make([]DiscographyAlbumMetadata, 0, len(raw.Albums))
	allTracks := make([]AlbumTrackMetadata, 0)
	isrcCache := make(map[string]string)

	for _, alb := range raw.Albums {
		albumImage := firstImageURL(alb.Images)
		albumList = append(albumList, DiscographyAlbumMetadata{
			ID:          alb.ID,
			Name:        alb.Name,
			AlbumType:   alb.AlbumType,
			ReleaseDate: alb.ReleaseDate,
			TotalTracks: alb.TotalTracks,
			Artists:     joinArtists(alb.Artists),
			Images:      albumImage,
			ExternalURL: alb.ExternalURL.Spotify,
		})

		tracks, err := c.collectAlbumTracks(ctx, alb.ID, raw.Token)
		if err != nil {
			fmt.Printf("Error getting tracks for album %s: %v\n", alb.Name, err)
			continue
		}

		for _, tr := range tracks {
			isrc := c.fetchTrackISRC(ctx, tr.ID, raw.Token, isrcCache)
			var artistID, artistURL string
			if len(tr.Artists) > 0 {
				artistID = tr.Artists[0].ID
				artistURL = fmt.Sprintf("https://open.spotify.com/artist/%s", tr.Artists[0].ID)
			}
			artistsData := make([]ArtistSimple, 0, len(tr.Artists))
			for _, a := range tr.Artists {
				artistsData = append(artistsData, ArtistSimple{
					ID:          a.ID,
					Name:        a.Name,
					ExternalURL: fmt.Sprintf("https://open.spotify.com/artist/%s", a.ID),
				})
			}
			allTracks = append(allTracks, AlbumTrackMetadata{
				SpotifyID:   tr.ID,
				Artists:     joinArtists(tr.Artists),
				Name:        tr.Name,
				AlbumName:   alb.Name,
				AlbumArtist: joinArtists(alb.Artists),
				AlbumType:   alb.AlbumType,
				DurationMS:  tr.DurationMS,
				Images:      albumImage,
				ReleaseDate: alb.ReleaseDate,
				TrackNumber: tr.TrackNumber,
				TotalTracks: alb.TotalTracks,
				DiscNumber:  tr.DiscNumber,
				ExternalURL: tr.ExternalURL.Spotify,
				ISRC:        isrc,
				AlbumID:     alb.ID,
				AlbumURL:    alb.ExternalURL.Spotify,
				ArtistID:    artistID,
				ArtistURL:   artistURL,
				ArtistsData: artistsData,
			})
		}
	}

	return &ArtistDiscographyPayload{
		ArtistInfo: info,
		AlbumList:  albumList,
		TrackList:  allTracks,
	}, nil
}

func formatArtistData(raw *artistResponse) ArtistResponsePayload {
	if raw == nil {
		return ArtistResponsePayload{}
	}
	payload := ArtistResponsePayload{}
	payload.Artist.Name = raw.Name
	payload.Artist.Followers = raw.Followers.Total
	payload.Artist.Genres = raw.Genres
	payload.Artist.Images = firstImageURL(raw.Images)
	payload.Artist.ExternalURL = raw.ExternalURL.Spotify
	payload.Artist.Popularity = raw.Popularity
	return payload
}

func formatTrackData(raw *trackFull) TrackResponse {
	if raw == nil {
		return TrackResponse{}
	}
	return TrackResponse{
		Track: TrackMetadata{
			SpotifyID:   raw.ID,
			Artists:     joinArtists(raw.Artists),
			Name:        raw.Name,
			AlbumName:   raw.Album.Name,
			AlbumArtist: joinArtists(raw.Album.Artists),
			DurationMS:  raw.DurationMS,
			Images:      firstImageURL(raw.Album.Images),
			ReleaseDate: raw.Album.ReleaseDate,
			TrackNumber: raw.TrackNumber,
			TotalTracks: raw.Album.TotalTracks,
			DiscNumber:  raw.DiscNumber,
			ExternalURL: raw.ExternalURL.Spotify,
			ISRC:        raw.ExternalID.ISRC,
		},
	}
}

func (c *SpotifyMetadataClient) collectAlbumTracks(ctx context.Context, albumID, token string) ([]trackSimplified, error) {
	url := fmt.Sprintf("%s/tracks?limit=50", fmt.Sprintf(albumBaseURL, albumID))
	var tracks []trackSimplified
	_, err := fetchPaging(ctx, c, url, token, 0, &tracks)
	if err != nil {
		return nil, err
	}
	return tracks, nil
}

func (c *SpotifyMetadataClient) fetchTrackISRC(ctx context.Context, trackID, token string, cache map[string]string) string {
	if trackID == "" || token == "" {
		return ""
	}
	if isrc, ok := cache[trackID]; ok {
		return isrc
	}

	var data struct {
		ExternalID externalID `json:"external_ids"`
	}
	if err := c.getJSON(ctx, fmt.Sprintf(trackBaseURL, trackID), token, &data); err != nil {
		return ""
	}
	cache[trackID] = data.ExternalID.ISRC
	return cache[trackID]
}

func fetchPaging[T any](ctx context.Context, client *SpotifyMetadataClient, nextURL, token string, delay time.Duration, dest *[]T) (int, error) {
	batches := 0
	for nextURL != "" {
		select {
		case <-ctx.Done():
			return batches, ctx.Err()
		default:
		}

		var page struct {
			Items []T    `json:"items"`
			Next  string `json:"next"`
		}
		if err := client.getJSON(ctx, nextURL, token, &page); err != nil {
			return batches, err
		}

		*dest = append(*dest, page.Items...)
		nextURL = stripLocaleParam(page.Next)
		batches++

		if nextURL != "" && delay > 0 {
			if err := sleepWithContext(ctx, delay); err != nil {
				return batches, err
			}
		}
	}
	return batches, nil
}

func (c *SpotifyMetadataClient) getJSON(ctx context.Context, endpoint, token string, dst interface{}) error {
	for {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return err
		}
		headers := c.baseHeaders()
		for key, values := range headers {
			for _, v := range values {
				req.Header.Add(key, v)
			}
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return err
		}
		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return err
		}

		if resp.StatusCode == http.StatusTooManyRequests {
			if err := sleepWithContext(ctx, parseRetryAfter(resp.Header.Get("Retry-After"))); err != nil {
				return err
			}
			continue
		}

		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("spotify API returned status %d for %s", resp.StatusCode, endpoint)
		}

		return json.Unmarshal(body, dst)
	}
}

func (c *SpotifyMetadataClient) baseHeaders() http.Header {
	h := http.Header{}
	h.Set("User-Agent", c.userAgent)
	h.Set("Accept", "application/json")
	h.Set("Accept-Language", "en-US,en;q=0.9")
	h.Set("sec-ch-ua-platform", "\"Windows\"")
	h.Set("sec-fetch-dest", "empty")
	h.Set("sec-fetch-mode", "cors")
	h.Set("sec-fetch-site", "same-origin")
	h.Set("Referer", "https://open.spotify.com/")
	h.Set("Origin", "https://open.spotify.com")
	return h
}

func (c *SpotifyMetadataClient) randomUserAgent() string {
	c.rngMu.Lock()
	defer c.rngMu.Unlock()

	macMajor := c.randRange(11, 15)
	macMinor := c.randRange(4, 9)
	webkitMajor := c.randRange(530, 537)
	webkitMinor := c.randRange(30, 37)
	chromeMajor := c.randRange(80, 105)
	chromeBuild := c.randRange(3000, 4500)
	chromePatch := c.randRange(60, 125)
	safariMajor := c.randRange(530, 537)
	safariMinor := c.randRange(30, 36)

	return fmt.Sprintf(
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_%d_%d) AppleWebKit/%d.%d (KHTML, like Gecko) Chrome/%d.0.%d.%d Safari/%d.%d",
		macMajor,
		macMinor,
		webkitMajor,
		webkitMinor,
		chromeMajor,
		chromeBuild,
		chromePatch,
		safariMajor,
		safariMinor,
	)
}

func (c *SpotifyMetadataClient) randRange(min, max int) int {
	if max <= min {
		return min
	}
	return c.rng.Intn(max-min) + min
}

func (c *SpotifyMetadataClient) getAccessToken(ctx context.Context) (string, error) {
	code, serverTime, version, err := c.generateTOTP(ctx)
	if err != nil {
		return "", err
	}

	timestampMS := time.Now().UnixMilli()
	params := url.Values{}
	params.Set("reason", "init")
	params.Set("productType", "web-player")
	params.Set("totp", code)
	params.Set("totpServerTime", strconv.FormatInt(serverTime, 10))
	params.Set("totpVer", strconv.Itoa(version))
	params.Set("sTime", strconv.FormatInt(serverTime, 10))
	params.Set("cTime", strconv.FormatInt(timestampMS, 10))
	params.Set("buildVer", "web-player_2025-07-02_1720000000000_12345678")
	params.Set("buildDate", "2025-07-02")

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, spotifyTokenURL, nil)
	if err != nil {
		return "", err
	}
	req.URL.RawQuery = params.Encode()
	req.Header = c.baseHeaders()

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	body, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		return "", err
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("failed to get access token. Status code: %d", resp.StatusCode)
	}

	var token accessTokenResponse
	if err := json.Unmarshal(body, &token); err != nil {
		return "", err
	}
	if token.AccessToken == "" {
		return "", errors.New("failed to get access token: empty token received")
	}
	return token.AccessToken, nil
}

func (c *SpotifyMetadataClient) generateTOTP(ctx context.Context) (string, int64, int, error) {
	secrets, _, err := c.fetchSecretBytes(ctx)
	if err != nil {
		return "", 0, 0, err
	}
	if len(secrets) == 0 {
		return "", 0, 0, errors.New("no secrets available")
	}

	latest := secrets[0]
	for _, entry := range secrets[1:] {
		if entry.Version > latest.Version {
			latest = entry
		}
	}

	builder := strings.Builder{}
	for idx, val := range latest.Secret {
		processed := val ^ ((idx % 33) + 9)
		builder.WriteString(strconv.Itoa(processed))
	}

	utfBytes := []byte(builder.String())
	hexStr := hex.EncodeToString(utfBytes)
	secretBytes, err := hex.DecodeString(hexStr)
	if err != nil {
		return "", 0, 0, err
	}
	b32Secret := base32.StdEncoding.EncodeToString(secretBytes)

	serverTime, err := c.fetchServerTime(ctx)
	if err != nil {
		return "", 0, 0, err
	}

	code, err := computeTOTP(b32Secret, serverTime)
	if err != nil {
		return "", 0, 0, err
	}

	return code, serverTime, latest.Version, nil
}

func (c *SpotifyMetadataClient) fetchSecretBytes(ctx context.Context) ([]secretEntry, bool, error) {
	// Add cache busting parameter with current timestamp
	urlWithCacheBust := fmt.Sprintf("%s?t=%d", secretBytesRemotePath, time.Now().Unix())

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, urlWithCacheBust, nil)
	if err == nil {
		// Add headers to bypass cache
		req.Header.Set("Cache-Control", "no-cache, no-store, must-revalidate")
		req.Header.Set("Pragma", "no-cache")
		req.Header.Set("Expires", "0")

		resp, err := c.httpClient.Do(req)
		if err == nil {
			body, readErr := io.ReadAll(resp.Body)
			resp.Body.Close()
			if readErr == nil && resp.StatusCode == http.StatusOK {
				var secrets []secretEntry
				if jsonErr := json.Unmarshal(body, &secrets); jsonErr == nil {
					return secrets, false, nil
				}
			}
		}
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return nil, false, fmt.Errorf("GitHub fetch failed and could not resolve home directory: %w", err)
	}
	localPath := filepath.Join(home, ".spotify-secret", "secretBytes.json")
	data, err := os.ReadFile(localPath)
	if err != nil {
		return nil, false, fmt.Errorf("failed to fetch secrets from both GitHub and local: %w", err)
	}

	var secrets []secretEntry
	if err := json.Unmarshal(data, &secrets); err != nil {
		return nil, false, fmt.Errorf("failed to process local secrets: %w", err)
	}
	return secrets, true, nil
}

func (c *SpotifyMetadataClient) fetchServerTime(ctx context.Context) (int64, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://open.spotify.com/api/server-time", nil)
	if err != nil {
		return 0, err
	}
	req.Header = c.serverTimeHeaders()

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return 0, err
	}
	body, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		return 0, err
	}

	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("failed to get server time. Status code: %d", resp.StatusCode)
	}

	var payload serverTimeResponse
	if err := json.Unmarshal(body, &payload); err != nil {
		return 0, err
	}
	if payload.ServerTime == 0 {
		return 0, errors.New("failed to fetch server time from Spotify")
	}
	return payload.ServerTime, nil
}

func (c *SpotifyMetadataClient) serverTimeHeaders() http.Header {
	h := http.Header{}
	h.Set("Host", "open.spotify.com")
	h.Set("User-Agent", c.randomUserAgent())
	h.Set("Accept", "*/*")
	return h
}

func computeTOTP(b32Secret string, timestamp int64) (string, error) {
	normalized := strings.ToUpper(strings.ReplaceAll(b32Secret, " ", ""))
	key, err := base32.StdEncoding.DecodeString(normalized)
	if err != nil {
		return "", err
	}

	// Normalise milliseconds if necessary.
	if timestamp > 1_000_000_000_000 {
		timestamp /= 1000
	}

	counter := uint64(timestamp / 30)
	var buf [8]byte
	binary.BigEndian.PutUint64(buf[:], counter)

	mac := hmac.New(sha1.New, key)
	if _, err := mac.Write(buf[:]); err != nil {
		return "", err
	}
	sum := mac.Sum(nil)
	if len(sum) < 20 {
		return "", errors.New("unexpected hmac length for TOTP")
	}

	offset := sum[len(sum)-1] & 0x0f
	binaryCode := (int(sum[offset])&0x7f)<<24 |
		(int(sum[offset+1])&0xff)<<16 |
		(int(sum[offset+2])&0xff)<<8 |
		(int(sum[offset+3]) & 0xff)
	otp := binaryCode % 1_000_000
	return fmt.Sprintf("%06d", otp), nil
}

func parseSpotifyURI(input string) (spotifyURI, error) {
	trimmed := strings.TrimSpace(input)
	if trimmed == "" {
		return spotifyURI{}, errInvalidSpotifyURL
	}

	if strings.HasPrefix(trimmed, "spotify:") {
		parts := strings.Split(trimmed, ":")
		if len(parts) == 3 {
			switch parts[1] {
			case "album", "track", "playlist", "artist":
				return spotifyURI{Type: parts[1], ID: parts[2]}, nil
			}
		}
	}

	parsed, err := url.Parse(trimmed)
	if err != nil {
		return spotifyURI{}, err
	}

	if parsed.Host == "embed.spotify.com" {
		if parsed.RawQuery == "" {
			return spotifyURI{}, errInvalidSpotifyURL
		}
		qs, _ := url.ParseQuery(parsed.RawQuery)
		embedded := qs.Get("uri")
		if embedded == "" {
			return spotifyURI{}, errInvalidSpotifyURL
		}
		return parseSpotifyURI(embedded)
	}

	if parsed.Scheme == "" && parsed.Host == "" {
		id := strings.Trim(strings.TrimSpace(parsed.Path), "/")
		if id == "" {
			return spotifyURI{}, errInvalidSpotifyURL
		}
		return spotifyURI{Type: "playlist", ID: id}, nil
	}

	if parsed.Host != "open.spotify.com" && parsed.Host != "play.spotify.com" {
		return spotifyURI{}, errInvalidSpotifyURL
	}

	parts := cleanPathParts(parsed.Path)
	if len(parts) == 0 {
		return spotifyURI{}, errInvalidSpotifyURL
	}

	if parts[0] == "embed" {
		parts = parts[1:]
	}
	if len(parts) == 0 {
		return spotifyURI{}, errInvalidSpotifyURL
	}
	if strings.HasPrefix(parts[0], "intl-") {
		parts = parts[1:]
	}
	if len(parts) == 0 {
		return spotifyURI{}, errInvalidSpotifyURL
	}

	if len(parts) == 2 {
		switch parts[0] {
		case "album", "track", "playlist", "artist":
			return spotifyURI{Type: parts[0], ID: parts[1]}, nil
		}
	}

	if len(parts) == 4 && parts[2] == "playlist" {
		return spotifyURI{Type: "playlist", ID: parts[3]}, nil
	}

	if len(parts) >= 3 && parts[0] == "artist" {
		if len(parts) >= 3 && parts[2] == "discography" {
			discType := "all"
			if len(parts) >= 4 {
				candidate := parts[3]
				if candidate == "all" || candidate == "album" || candidate == "single" || candidate == "compilation" {
					discType = candidate
				}
			}
			return spotifyURI{Type: "artist_discography", ID: parts[1], DiscographyGroup: discType}, nil
		}
		return spotifyURI{Type: "artist", ID: parts[1]}, nil
	}

	return spotifyURI{}, errInvalidSpotifyURL
}

func cleanPathParts(path string) []string {
	raw := strings.Split(path, "/")
	parts := make([]string, 0, len(raw))
	for _, part := range raw {
		if part != "" {
			parts = append(parts, part)
		}
	}
	return parts
}

func stripLocaleParam(raw string) string {
	if raw == "" {
		return ""
	}
	if idx := strings.Index(raw, "&locale="); idx != -1 {
		return raw[:idx]
	}
	if idx := strings.Index(raw, "?locale="); idx != -1 {
		return raw[:idx]
	}
	return raw
}

func firstImageURL(images []image) string {
	if len(images) == 0 {
		return ""
	}
	return images[0].URL
}

func joinArtists(artists []artist) string {
	if len(artists) == 0 {
		return ""
	}
	names := make([]string, 0, len(artists))
	for _, a := range artists {
		if a.Name != "" {
			names = append(names, a.Name)
		}
	}
	return strings.Join(names, ", ")
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func parseRetryAfter(value string) time.Duration {
	if value == "" {
		return 5 * time.Second
	}
	secs, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return 5 * time.Second
	}
	return time.Duration(secs+1) * time.Second
}

func sleepWithContext(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return nil
	}
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
