package backend

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	apiBaseURL = "https://afkarxyz.web.id"
	apiKey     = "NDAwNDAxNDAzNDA0NTAwNTAyNTAz"
)

var (
	errInvalidSpotifyURL = errors.New("invalid or unsupported Spotify URL")
)

type SpotifyMetadataClient struct {
	httpClient *http.Client
}

func NewSpotifyMetadataClient() *SpotifyMetadataClient {
	return &SpotifyMetadataClient{
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

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
	TotalDiscs  int    `json:"total_discs,omitempty"`
	ExternalURL string `json:"external_urls"`
	ISRC        string `json:"isrc"`
	Copyright   string `json:"copyright,omitempty"`
	Publisher   string `json:"publisher,omitempty"`
	Plays       string `json:"plays,omitempty"`
}

type ArtistSimple struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	ExternalURL string `json:"external_urls"`
}

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
	TotalDiscs  int            `json:"total_discs,omitempty"`
	ExternalURL string         `json:"external_urls"`
	ISRC        string         `json:"isrc"`
	AlbumType   string         `json:"album_type,omitempty"`
	AlbumID     string         `json:"album_id,omitempty"`
	AlbumURL    string         `json:"album_url,omitempty"`
	ArtistID    string         `json:"artist_id,omitempty"`
	ArtistURL   string         `json:"artist_url,omitempty"`
	ArtistsData []ArtistSimple `json:"artists_data,omitempty"`
	Plays       string         `json:"plays,omitempty"`
	Status      string         `json:"status,omitempty"`
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
	Cover       string `json:"cover,omitempty"`
	Description string `json:"description,omitempty"`
	Batch       string `json:"batch,omitempty"`
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
	Header          string   `json:"header,omitempty"`
	Gallery         []string `json:"gallery,omitempty"`
	ExternalURL     string   `json:"external_urls"`
	DiscographyType string   `json:"discography_type"`
	TotalAlbums     int      `json:"total_albums"`
	Biography       string   `json:"biography,omitempty"`
	Verified        bool     `json:"verified,omitempty"`
	Listeners       int      `json:"listeners,omitempty"`
	Rank            int      `json:"rank,omitempty"`
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

type apiTrackResponse struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Artists   string `json:"artists"`
	Duration  string `json:"duration"`
	Track     int    `json:"track"`
	Disc      int    `json:"disc"`
	Discs     int    `json:"discs"`
	Copyright string `json:"copyright"`
	Label     string `json:"label"`
	Plays     string `json:"plays"`
	Album     struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		Released string `json:"released"`
		Year     int    `json:"year"`
		Tracks   int    `json:"tracks"`
		Artists  string `json:"artists"`
		Label    string `json:"label"`
	} `json:"album"`
	Cover struct {
		Small  string `json:"small"`
		Medium string `json:"medium"`
		Large  string `json:"large"`
	} `json:"cover"`
}

type apiAlbumResponse struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Artists     string `json:"artists"`
	Cover       string `json:"cover"`
	ReleaseDate string `json:"releaseDate"`
	Count       int    `json:"count"`
	Tracks      []struct {
		ID        string   `json:"id"`
		Name      string   `json:"name"`
		Artists   string   `json:"artists"`
		ArtistIds []string `json:"artistIds"`
		Duration  string   `json:"duration"`
		Plays     string   `json:"plays"`
	} `json:"tracks"`
}

type apiPlaylistResponse struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Owner       struct {
		Name   string `json:"name"`
		Avatar string `json:"avatar"`
	} `json:"owner"`
	Cover     string `json:"cover"`
	Count     int    `json:"count"`
	Followers int    `json:"followers"`
	Tracks    []struct {
		ID        string   `json:"id"`
		Cover     string   `json:"cover"`
		Title     string   `json:"title"`
		Artist    string   `json:"artist"`
		ArtistIds []string `json:"artistIds"`
		Plays     string   `json:"plays"`
		Status    string   `json:"status"`
		Album     string   `json:"album"`
		AlbumID   string   `json:"albumId"`
		Duration  string   `json:"duration"`
	} `json:"tracks"`
}

type apiArtistResponse struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Profile struct {
		Biography string `json:"biography"`
		Name      string `json:"name"`
		Verified  bool   `json:"verified"`
	} `json:"profile"`
	Avatar string `json:"avatar"`
	Header string `json:"header"`
	Stats  struct {
		Followers int `json:"followers"`
		Listeners int `json:"listeners"`
		Rank      int `json:"rank"`
	} `json:"stats"`
	Gallery     []string `json:"gallery"`
	Discography struct {
		All []struct {
			ID    string `json:"id"`
			Name  string `json:"name"`
			Cover string `json:"cover"`
			Date  string `json:"date"`
			Year  int    `json:"year"`
		} `json:"all"`
		Total int `json:"total"`
	} `json:"discography"`
}

type apiSearchResponse struct {
	Results struct {
		Tracks []struct {
			ID       string `json:"id"`
			Name     string `json:"name"`
			Artists  string `json:"artists"`
			Album    string `json:"album"`
			Duration string `json:"duration"`
			Cover    string `json:"cover"`
		} `json:"tracks"`
		Albums []struct {
			ID      string `json:"id"`
			Name    string `json:"name"`
			Artists string `json:"artists"`
			Cover   string `json:"cover"`
			Year    int    `json:"year"`
		} `json:"albums"`
		Artists []struct {
			ID    string `json:"id"`
			Name  string `json:"name"`
			Cover string `json:"cover"`
		} `json:"artists"`
		Playlists []struct {
			ID    string `json:"id"`
			Name  string `json:"name"`
			Cover string `json:"cover"`
			Owner string `json:"owner"`
		} `json:"playlists"`
	} `json:"results"`
	TotalResults struct {
		Tracks    int `json:"tracks"`
		Albums    int `json:"albums"`
		Artists   int `json:"artists"`
		Playlists int `json:"playlists"`
	} `json:"totalResults"`
}

type SearchResult struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Type        string `json:"type"`
	Artists     string `json:"artists,omitempty"`
	AlbumName   string `json:"album_name,omitempty"`
	Images      string `json:"images"`
	ReleaseDate string `json:"release_date,omitempty"`
	ExternalURL string `json:"external_urls"`
	Duration    int    `json:"duration_ms,omitempty"`
	TotalTracks int    `json:"total_tracks,omitempty"`
	Owner       string `json:"owner,omitempty"`
}

type SearchResponse struct {
	Tracks    []SearchResult `json:"tracks"`
	Albums    []SearchResult `json:"albums"`
	Artists   []SearchResult `json:"artists"`
	Playlists []SearchResult `json:"playlists"`
}

func GetFilteredSpotifyData(ctx context.Context, spotifyURL string, batch bool, delay time.Duration) (interface{}, error) {
	client := NewSpotifyMetadataClient()
	return client.GetFilteredData(ctx, spotifyURL, batch, delay)
}

func (c *SpotifyMetadataClient) GetFilteredData(ctx context.Context, spotifyURL string, batch bool, delay time.Duration) (interface{}, error) {
	parsed, err := parseSpotifyURI(spotifyURL)
	if err != nil {
		return nil, err
	}

	raw, err := c.getRawSpotifyData(ctx, parsed, batch, delay)
	if err != nil {
		return nil, err
	}

	return c.processSpotifyData(ctx, raw)
}

func (c *SpotifyMetadataClient) getRawSpotifyData(ctx context.Context, parsed spotifyURI, batch bool, delay time.Duration) (interface{}, error) {
	switch parsed.Type {
	case "playlist":
		return c.fetchPlaylist(ctx, parsed.ID)
	case "album":
		return c.fetchAlbum(ctx, parsed.ID)
	case "track":
		return c.fetchTrack(ctx, parsed.ID)
	case "artist_discography":
		return c.fetchArtistDiscography(ctx, parsed)
	case "artist":

		discographyParsed := spotifyURI{Type: "artist_discography", ID: parsed.ID, DiscographyGroup: "all"}
		return c.fetchArtistDiscography(ctx, discographyParsed)
	default:
		return nil, fmt.Errorf("unsupported Spotify type: %s", parsed.Type)
	}
}

func (c *SpotifyMetadataClient) processSpotifyData(ctx context.Context, raw interface{}) (interface{}, error) {
	switch payload := raw.(type) {
	case *apiPlaylistResponse:
		return c.formatPlaylistData(payload), nil
	case *apiAlbumResponse:
		return c.formatAlbumData(payload)
	case *apiTrackResponse:
		return c.formatTrackData(payload), nil
	case *apiArtistResponse:
		return c.formatArtistDiscographyData(ctx, payload)
	default:
		return nil, errors.New("unknown raw payload type")
	}
}

func (c *SpotifyMetadataClient) fetchTrack(ctx context.Context, trackID string) (*apiTrackResponse, error) {
	url := fmt.Sprintf("%s/track/%s", apiBaseURL, trackID)
	var data apiTrackResponse
	if err := c.getJSON(ctx, url, &data); err != nil {
		return nil, err
	}
	return &data, nil
}

func (c *SpotifyMetadataClient) fetchAlbum(ctx context.Context, albumID string) (*apiAlbumResponse, error) {
	url := fmt.Sprintf("%s/album/%s", apiBaseURL, albumID)
	var data apiAlbumResponse
	if err := c.getJSON(ctx, url, &data); err != nil {
		return nil, err
	}
	return &data, nil
}

func (c *SpotifyMetadataClient) fetchPlaylist(ctx context.Context, playlistID string) (*apiPlaylistResponse, error) {
	url := fmt.Sprintf("%s/playlist/%s", apiBaseURL, playlistID)
	var data apiPlaylistResponse
	if err := c.getJSON(ctx, url, &data); err != nil {
		return nil, err
	}
	return &data, nil
}

func (c *SpotifyMetadataClient) fetchArtistDiscography(ctx context.Context, parsed spotifyURI) (*apiArtistResponse, error) {
	url := fmt.Sprintf("%s/artist/%s", apiBaseURL, parsed.ID)
	var data apiArtistResponse
	if err := c.getJSON(ctx, url, &data); err != nil {
		return nil, err
	}
	return &data, nil
}

func (c *SpotifyMetadataClient) formatTrackData(raw *apiTrackResponse) TrackResponse {
	durationMS := parseDuration(raw.Duration)

	externalURL := fmt.Sprintf("https://open.spotify.com/track/%s", raw.ID)

	coverURL := raw.Cover.Medium
	if coverURL == "" {
		coverURL = raw.Cover.Large
	}
	if coverURL == "" {
		coverURL = raw.Cover.Small
	}

	releaseDate := raw.Album.Released
	if releaseDate == "" && raw.Album.Year > 0 {
		releaseDate = fmt.Sprintf("%d", raw.Album.Year)
	}
	trackMetadata := TrackMetadata{
		SpotifyID:   raw.ID,
		Artists:     raw.Artists,
		Name:        raw.Name,
		AlbumName:   raw.Album.Name,
		AlbumArtist: raw.Album.Artists,
		DurationMS:  durationMS,
		Images:      coverURL,
		ReleaseDate: releaseDate,
		TrackNumber: raw.Track,
		TotalTracks: raw.Album.Tracks,
		DiscNumber:  raw.Disc,
		TotalDiscs:  raw.Discs,
		ExternalURL: externalURL,
		ISRC:        raw.ID,
		Copyright:   raw.Copyright,
		Publisher:   raw.Album.Label,
		Plays:       raw.Plays,
	}

	return TrackResponse{
		Track: trackMetadata,
	}
}

func (c *SpotifyMetadataClient) formatAlbumData(raw *apiAlbumResponse) (*AlbumResponsePayload, error) {
	var artistID, artistURL string

	info := AlbumInfoMetadata{
		TotalTracks: raw.Count,
		Name:        raw.Name,
		ReleaseDate: raw.ReleaseDate,
		Artists:     raw.Artists,
		Images:      raw.Cover,
		ArtistID:    artistID,
		ArtistURL:   artistURL,
	}

	tracks := make([]AlbumTrackMetadata, 0, len(raw.Tracks))
	for idx, item := range raw.Tracks {
		durationMS := parseDuration(item.Duration)
		trackNumber := idx + 1

		var artistID, artistURL string
		if len(item.ArtistIds) > 0 {
			artistID = item.ArtistIds[0]
			artistURL = fmt.Sprintf("https://open.spotify.com/artist/%s", artistID)
		}

		artistsData := make([]ArtistSimple, 0, len(item.ArtistIds))
		for _, id := range item.ArtistIds {
			artistsData = append(artistsData, ArtistSimple{
				ID:          id,
				Name:        "",
				ExternalURL: fmt.Sprintf("https://open.spotify.com/artist/%s", id),
			})
		}

		tracks = append(tracks, AlbumTrackMetadata{
			SpotifyID:   item.ID,
			Artists:     item.Artists,
			Name:        item.Name,
			AlbumName:   raw.Name,
			AlbumArtist: raw.Artists,
			DurationMS:  durationMS,
			Images:      raw.Cover,
			ReleaseDate: raw.ReleaseDate,
			TrackNumber: trackNumber,
			TotalTracks: raw.Count,
			DiscNumber:  1,
			TotalDiscs:  0,
			ExternalURL: fmt.Sprintf("https://open.spotify.com/track/%s", item.ID),
			ISRC:        item.ID,
			AlbumID:     raw.ID,
			AlbumURL:    fmt.Sprintf("https://open.spotify.com/album/%s", raw.ID),
			ArtistID:    artistID,
			ArtistURL:   artistURL,
			ArtistsData: artistsData,
			Plays:       item.Plays,
		})
	}

	return &AlbumResponsePayload{
		AlbumInfo: info,
		TrackList: tracks,
	}, nil
}

func (c *SpotifyMetadataClient) formatPlaylistData(raw *apiPlaylistResponse) PlaylistResponsePayload {
	var info PlaylistInfoMetadata
	info.Tracks.Total = raw.Count
	info.Followers.Total = raw.Followers
	info.Owner.DisplayName = raw.Owner.Name
	info.Owner.Name = raw.Name
	info.Owner.Images = raw.Owner.Avatar
	info.Cover = raw.Cover
	info.Description = raw.Description

	tracks := make([]AlbumTrackMetadata, 0, len(raw.Tracks))
	for _, item := range raw.Tracks {
		durationMS := parseDuration(item.Duration)

		var artistID, artistURL string
		if len(item.ArtistIds) > 0 {
			artistID = item.ArtistIds[0]
			artistURL = fmt.Sprintf("https://open.spotify.com/artist/%s", artistID)
		}

		artistsData := make([]ArtistSimple, 0, len(item.ArtistIds))
		for _, id := range item.ArtistIds {
			artistsData = append(artistsData, ArtistSimple{
				ID:          id,
				Name:        "",
				ExternalURL: fmt.Sprintf("https://open.spotify.com/artist/%s", id),
			})
		}

		tracks = append(tracks, AlbumTrackMetadata{
			SpotifyID:   item.ID,
			Artists:     item.Artist,
			Name:        item.Title,
			AlbumName:   item.Album,
			AlbumArtist: item.Artist,
			DurationMS:  durationMS,
			Images:      item.Cover,
			ReleaseDate: "",
			TrackNumber: 0,
			TotalTracks: 0,
			DiscNumber:  1,
			TotalDiscs:  0,
			ExternalURL: fmt.Sprintf("https://open.spotify.com/track/%s", item.ID),
			ISRC:        item.ID,
			AlbumID:     item.AlbumID,
			AlbumURL:    fmt.Sprintf("https://open.spotify.com/album/%s", item.AlbumID),
			ArtistID:    artistID,
			ArtistURL:   artistURL,
			ArtistsData: artistsData,
			Plays:       item.Plays,
			Status:      item.Status,
		})
	}

	return PlaylistResponsePayload{
		PlaylistInfo: info,
		TrackList:    tracks,
	}
}

func (c *SpotifyMetadataClient) formatArtistDiscographyData(ctx context.Context, raw *apiArtistResponse) (*ArtistDiscographyPayload, error) {
	discType := "all"

	info := ArtistInfoMetadata{
		Name:            raw.Name,
		Followers:       raw.Stats.Followers,
		Genres:          []string{},
		Images:          raw.Avatar,
		Header:          raw.Header,
		Gallery:         raw.Gallery,
		ExternalURL:     fmt.Sprintf("https://open.spotify.com/artist/%s", raw.ID),
		DiscographyType: discType,
		TotalAlbums:     raw.Discography.Total,
		Biography:       raw.Profile.Biography,
		Verified:        raw.Profile.Verified,
		Listeners:       raw.Stats.Listeners,
		Rank:            raw.Stats.Rank,
	}

	albumList := make([]DiscographyAlbumMetadata, 0, len(raw.Discography.All))
	allTracks := make([]AlbumTrackMetadata, 0)

	for _, alb := range raw.Discography.All {

		select {
		case <-ctx.Done():

			return &ArtistDiscographyPayload{
				ArtistInfo: info,
				AlbumList:  albumList,
				TrackList:  allTracks,
			}, ctx.Err()
		default:

		}

		albumList = append(albumList, DiscographyAlbumMetadata{
			ID:          alb.ID,
			Name:        alb.Name,
			AlbumType:   "album",
			ReleaseDate: alb.Date,
			TotalTracks: 0,
			Artists:     raw.Name,
			Images:      alb.Cover,
			ExternalURL: fmt.Sprintf("https://open.spotify.com/album/%s", alb.ID),
		})

		albumData, err := c.fetchAlbum(ctx, alb.ID)
		if err != nil {
			fmt.Printf("Error getting tracks for album %s: %v\n", alb.Name, err)
			continue
		}

		for idx, tr := range albumData.Tracks {
			durationMS := parseDuration(tr.Duration)
			trackNumber := idx + 1

			var artistID, artistURL string
			if len(tr.ArtistIds) > 0 {
				artistID = tr.ArtistIds[0]
				artistURL = fmt.Sprintf("https://open.spotify.com/artist/%s", artistID)
			}

			artistsData := make([]ArtistSimple, 0, len(tr.ArtistIds))
			for _, id := range tr.ArtistIds {
				artistsData = append(artistsData, ArtistSimple{
					ID:          id,
					Name:        "",
					ExternalURL: fmt.Sprintf("https://open.spotify.com/artist/%s", id),
				})
			}

			allTracks = append(allTracks, AlbumTrackMetadata{
				SpotifyID:   tr.ID,
				Artists:     tr.Artists,
				Name:        tr.Name,
				AlbumName:   albumData.Name,
				AlbumArtist: albumData.Artists,
				AlbumType:   "album",
				DurationMS:  durationMS,
				Images:      albumData.Cover,
				ReleaseDate: albumData.ReleaseDate,
				TrackNumber: trackNumber,
				TotalTracks: albumData.Count,
				DiscNumber:  1,
				ExternalURL: fmt.Sprintf("https://open.spotify.com/track/%s", tr.ID),
				ISRC:        tr.ID,
				AlbumID:     alb.ID,
				AlbumURL:    fmt.Sprintf("https://open.spotify.com/album/%s", alb.ID),
				ArtistID:    artistID,
				ArtistURL:   artistURL,
				ArtistsData: artistsData,
				Plays:       tr.Plays,
			})
		}
	}

	return &ArtistDiscographyPayload{
		ArtistInfo: info,
		AlbumList:  albumList,
		TrackList:  allTracks,
	}, nil
}

func (c *SpotifyMetadataClient) getJSON(ctx context.Context, endpoint string, dst interface{}) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}

	decodedKey, err := base64.StdEncoding.DecodeString(apiKey)
	if err != nil {
		return fmt.Errorf("failed to decode API key: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
	req.Header.Set("X-API-Key", string(decodedKey))

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API returned status %d for %s: %s", resp.StatusCode, endpoint, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	return json.Unmarshal(body, dst)
}

func parseDuration(durationStr string) int {
	if durationStr == "" {
		return 0
	}

	parts := strings.Split(durationStr, ":")
	if len(parts) != 2 {
		return 0
	}

	minutes, err1 := strconv.Atoi(parts[0])
	seconds, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil {
		return 0
	}

	return (minutes*60 + seconds) * 1000
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

func parseArtistIDsFromString(artists string) []string {

	return []string{}
}

func (c *SpotifyMetadataClient) Search(ctx context.Context, query string, limit int) (*SearchResponse, error) {
	if query == "" {
		return nil, errors.New("search query cannot be empty")
	}

	if limit <= 0 || limit > 50 {
		limit = 50
	}

	encodedQuery := url.QueryEscape(query)
	searchURL := fmt.Sprintf("%s/search?q=%s&limit=%d&offset=0", apiBaseURL, encodedQuery, limit)

	var apiResp apiSearchResponse
	if err := c.getJSON(ctx, searchURL, &apiResp); err != nil {
		return nil, fmt.Errorf("search failed: %w", err)
	}

	response := &SearchResponse{
		Tracks:    make([]SearchResult, 0),
		Albums:    make([]SearchResult, 0),
		Artists:   make([]SearchResult, 0),
		Playlists: make([]SearchResult, 0),
	}

	for _, item := range apiResp.Results.Tracks {
		response.Tracks = append(response.Tracks, SearchResult{
			ID:          item.ID,
			Name:        item.Name,
			Type:        "track",
			Artists:     item.Artists,
			AlbumName:   item.Album,
			Images:      item.Cover,
			ExternalURL: fmt.Sprintf("https://open.spotify.com/track/%s", item.ID),
			Duration:    parseDuration(item.Duration),
		})
	}

	for _, item := range apiResp.Results.Albums {
		response.Albums = append(response.Albums, SearchResult{
			ID:          item.ID,
			Name:        item.Name,
			Type:        "album",
			Artists:     item.Artists,
			Images:      item.Cover,
			ReleaseDate: fmt.Sprintf("%d", item.Year),
			ExternalURL: fmt.Sprintf("https://open.spotify.com/album/%s", item.ID),
		})
	}

	for _, item := range apiResp.Results.Artists {
		response.Artists = append(response.Artists, SearchResult{
			ID:          item.ID,
			Name:        item.Name,
			Type:        "artist",
			Images:      item.Cover,
			ExternalURL: fmt.Sprintf("https://open.spotify.com/artist/%s", item.ID),
		})
	}

	for _, item := range apiResp.Results.Playlists {
		response.Playlists = append(response.Playlists, SearchResult{
			ID:          item.ID,
			Name:        item.Name,
			Type:        "playlist",
			Images:      item.Cover,
			Owner:       item.Owner,
			ExternalURL: fmt.Sprintf("https://open.spotify.com/playlist/%s", item.ID),
		})
	}

	return response, nil
}

func SearchSpotify(ctx context.Context, query string, limit int) (*SearchResponse, error) {
	client := NewSpotifyMetadataClient()
	return client.Search(ctx, query, limit)
}

func (c *SpotifyMetadataClient) SearchByType(ctx context.Context, query string, searchType string, limit int, offset int) ([]SearchResult, error) {
	if query == "" {
		return nil, errors.New("search query cannot be empty")
	}

	if limit <= 0 || limit > 50 {
		limit = 50
	}

	if offset < 0 {
		offset = 0
	}

	encodedQuery := url.QueryEscape(query)
	searchURL := fmt.Sprintf("%s/search?q=%s&limit=%d&offset=%d", apiBaseURL, encodedQuery, limit, offset)

	var apiResp apiSearchResponse
	if err := c.getJSON(ctx, searchURL, &apiResp); err != nil {
		return nil, fmt.Errorf("search failed: %w", err)
	}

	results := make([]SearchResult, 0)

	switch searchType {
	case "track":
		for _, item := range apiResp.Results.Tracks {
			results = append(results, SearchResult{
				ID:          item.ID,
				Name:        item.Name,
				Type:        "track",
				Artists:     item.Artists,
				AlbumName:   item.Album,
				Images:      item.Cover,
				ExternalURL: fmt.Sprintf("https://open.spotify.com/track/%s", item.ID),
				Duration:    parseDuration(item.Duration),
			})
		}
	case "album":
		for _, item := range apiResp.Results.Albums {
			results = append(results, SearchResult{
				ID:          item.ID,
				Name:        item.Name,
				Type:        "album",
				Artists:     item.Artists,
				Images:      item.Cover,
				ReleaseDate: fmt.Sprintf("%d", item.Year),
				ExternalURL: fmt.Sprintf("https://open.spotify.com/album/%s", item.ID),
			})
		}
	case "artist":
		for _, item := range apiResp.Results.Artists {
			results = append(results, SearchResult{
				ID:          item.ID,
				Name:        item.Name,
				Type:        "artist",
				Images:      item.Cover,
				ExternalURL: fmt.Sprintf("https://open.spotify.com/artist/%s", item.ID),
			})
		}
	case "playlist":
		for _, item := range apiResp.Results.Playlists {
			results = append(results, SearchResult{
				ID:          item.ID,
				Name:        item.Name,
				Type:        "playlist",
				Images:      item.Cover,
				Owner:       item.Owner,
				ExternalURL: fmt.Sprintf("https://open.spotify.com/playlist/%s", item.ID),
			})
		}
	default:
		return nil, fmt.Errorf("invalid search type: %s", searchType)
	}

	return results, nil
}

func SearchSpotifyByType(ctx context.Context, query string, searchType string, limit int, offset int) ([]SearchResult, error) {
	client := NewSpotifyMetadataClient()
	return client.SearchByType(ctx, query, searchType, limit, offset)
}
