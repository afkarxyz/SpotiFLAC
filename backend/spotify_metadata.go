package backend

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var (
	errInvalidSpotifyURL = errors.New("invalid or unsupported Spotify URL")
)

type MetadataCallback func(data interface{})

type SpotifyMetadataClient struct {
	httpClient *http.Client
	Separator  string
}

func NewSpotifyMetadataClient() *SpotifyMetadataClient {
	return &SpotifyMetadataClient{
		httpClient: &http.Client{Timeout: 30 * time.Second},
		Separator:  ", ",
	}
}

type TrackMetadata struct {
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
	AlbumID     string         `json:"album_id,omitempty"`
	AlbumURL    string         `json:"album_url,omitempty"`
	ArtistID    string         `json:"artist_id,omitempty"`
	ArtistURL   string         `json:"artist_url,omitempty"`
	ArtistsData []ArtistSimple `json:"artists_data,omitempty"`
	UPC         string         `json:"upc,omitempty"`
	Copyright   string         `json:"copyright,omitempty"`
	Publisher   string         `json:"publisher,omitempty"`
	Composer    string         `json:"composer,omitempty"`
	Plays       string         `json:"plays,omitempty"`
	PreviewURL  string         `json:"preview_url,omitempty"`
	IsExplicit  bool           `json:"is_explicit,omitempty"`
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
	AlbumType   string         `json:"album_type,omitempty"`
	AlbumID     string         `json:"album_id,omitempty"`
	AlbumURL    string         `json:"album_url,omitempty"`
	ArtistID    string         `json:"artist_id,omitempty"`
	ArtistURL   string         `json:"artist_url,omitempty"`
	ArtistsData []ArtistSimple `json:"artists_data,omitempty"`
	UPC         string         `json:"upc,omitempty"`
	Plays       string         `json:"plays,omitempty"`
	Status      string         `json:"status,omitempty"`
	PreviewURL  string         `json:"preview_url,omitempty"`
	IsExplicit  bool           `json:"is_explicit,omitempty"`
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
	UPC         string `json:"upc,omitempty"`
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
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Artists   string   `json:"artists"`
	ArtistIds []string `json:"artistIds,omitempty"`
	UPC       string   `json:"upc,omitempty"`
	Duration  string   `json:"duration"`
	Track     int      `json:"track"`
	Disc      int      `json:"disc"`
	Discs     int      `json:"discs"`
	Copyright string   `json:"copyright"`
	Composer  string   `json:"composer,omitempty"`
	Plays     string   `json:"plays"`
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
	IsExplicit bool `json:"is_explicit"`
}

type apiAlbumResponse struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Artists     string `json:"artists"`
	Cover       string `json:"cover"`
	ReleaseDate string `json:"releaseDate"`
	UPC         string `json:"upc,omitempty"`
	Count       int    `json:"count"`
	Label       string `json:"label"`
	Discs       struct {
		TotalCount int `json:"totalCount"`
	} `json:"discs"`
	Tracks []struct {
		ID         string   `json:"id"`
		Name       string   `json:"name"`
		Artists    string   `json:"artists"`
		ArtistIds  []string `json:"artistIds"`
		Duration   string   `json:"duration"`
		Plays      string   `json:"plays"`
		UPC        string   `json:"upc,omitempty"`
		IsExplicit bool     `json:"is_explicit"`
		DiscNumber int      `json:"disc_number"`
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
		ID          string   `json:"id"`
		Cover       string   `json:"cover"`
		Title       string   `json:"title"`
		Artist      string   `json:"artist"`
		ArtistIds   []string `json:"artistIds"`
		Plays       string   `json:"plays"`
		Status      string   `json:"status"`
		Album       string   `json:"album"`
		AlbumArtist string   `json:"albumArtist"`
		AlbumID     string   `json:"albumId"`
		UPC         string   `json:"upc,omitempty"`
		Duration    string   `json:"duration"`
		IsExplicit  bool     `json:"is_explicit"`
		DiscNumber  int      `json:"disc_number"`
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
			ID          string `json:"id"`
			Name        string `json:"name"`
			Cover       string `json:"cover"`
			Date        string `json:"date"`
			Year        int    `json:"year"`
			TotalTracks int    `json:"total_tracks"`
			Type        string `json:"type"`
		} `json:"all"`
		Total int `json:"total"`
	} `json:"discography"`
}

type apiSearchResponse struct {
	Results struct {
		Tracks []struct {
			ID         string `json:"id"`
			Name       string `json:"name"`
			Artists    string `json:"artists"`
			Album      string `json:"album"`
			Duration   string `json:"duration"`
			Cover      string `json:"cover"`
			IsExplicit bool   `json:"is_explicit"`
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
	IsExplicit  bool   `json:"is_explicit,omitempty"`
}

type SearchResponse struct {
	Tracks    []SearchResult `json:"tracks"`
	Albums    []SearchResult `json:"albums"`
	Artists   []SearchResult `json:"artists"`
	Playlists []SearchResult `json:"playlists"`
}

func GetFilteredSpotifyData(ctx context.Context, spotifyURL string, batch bool, delay time.Duration, separator string, callback MetadataCallback) (interface{}, error) {
	client := NewSpotifyMetadataClient()
	if separator != "" {
		client.Separator = separator
	}
	return client.GetFilteredData(ctx, spotifyURL, batch, delay, callback)
}

func (c *SpotifyMetadataClient) GetFilteredData(ctx context.Context, spotifyURL string, batch bool, delay time.Duration, callback MetadataCallback) (interface{}, error) {
	parsed, err := parseSpotifyURI(spotifyURL)
	if err != nil {
		return nil, err
	}

	raw, err := c.getRawSpotifyData(ctx, parsed, batch, delay, callback)
	if err != nil {
		return nil, err
	}

	return c.processSpotifyData(ctx, raw, callback)
}

func (c *SpotifyMetadataClient) getRawSpotifyData(ctx context.Context, parsed spotifyURI, batch bool, delay time.Duration, callback MetadataCallback) (interface{}, error) {
	switch parsed.Type {
	case "playlist":
		return c.fetchPlaylist(ctx, parsed.ID, callback)
	case "album":
		return c.fetchAlbum(ctx, parsed.ID, callback)
	case "track":
		return c.fetchTrack(ctx, parsed.ID)
	case "artist_discography":
		return c.fetchArtistDiscography(ctx, parsed, callback)
	case "artist":

		discographyParsed := spotifyURI{Type: "artist_discography", ID: parsed.ID, DiscographyGroup: "all"}
		return c.fetchArtistDiscography(ctx, discographyParsed, callback)
	default:
		return nil, fmt.Errorf("unsupported Spotify type: %s", parsed.Type)
	}
}

func (c *SpotifyMetadataClient) processSpotifyData(ctx context.Context, raw interface{}, callback MetadataCallback) (interface{}, error) {
	switch payload := raw.(type) {
	case *apiPlaylistResponse:
		return c.formatPlaylistData(payload, callback), nil
	case *apiAlbumResponse:
		return c.formatAlbumData(payload, callback)
	case *apiTrackResponse:
		return c.formatTrackData(payload), nil
	case *apiArtistResponse:
		return c.formatArtistDiscographyData(ctx, payload, callback)
	default:
		return nil, errors.New("unknown raw payload type")
	}
}

func (c *SpotifyMetadataClient) fetchTrack(ctx context.Context, trackID string) (*apiTrackResponse, error) {
	client := NewSpotifyClient()
	if err := client.Initialize(); err != nil {
		return nil, fmt.Errorf("failed to initialize spotify client: %w", err)
	}

	payload := map[string]interface{}{
		"variables": map[string]interface{}{
			"uri": fmt.Sprintf("spotify:track:%s", trackID),
		},
		"operationName": "getTrack",
		"extensions": map[string]interface{}{
			"persistedQuery": map[string]interface{}{
				"version":    1,
				"sha256Hash": "612585ae06ba435ad26369870deaae23b5c8800a256cd8a57e08eddc25a37294",
			},
		},
	}

	data, err := client.Query(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to query track: %w", err)
	}

	var albumFetchData map[string]interface{}
	if trackData, ok := data["data"].(map[string]interface{}); ok {
		if trackUnion, ok := trackData["trackUnion"].(map[string]interface{}); ok {
			if albumOfTrack, ok := trackUnion["albumOfTrack"].(map[string]interface{}); ok {
				albumID := ""
				if id, ok := albumOfTrack["id"].(string); ok && id != "" {
					albumID = id
				} else if uri, ok := albumOfTrack["uri"].(string); ok && uri != "" {
					if strings.Contains(uri, ":") {
						parts := strings.Split(uri, ":")
						if len(parts) > 0 {
							albumID = parts[len(parts)-1]
						}
					}
				}

				if albumID != "" {

					albumResponse, err := c.fetchAlbumWithClient(ctx, client, albumID, nil)
					if err == nil && albumResponse != nil {

						albumJSON, _ := json.Marshal(albumResponse)
						var albumMap map[string]interface{}
						json.Unmarshal(albumJSON, &albumMap)

						tracksItems := []interface{}{}
						if albumMap["tracks"] != nil {
							if trackList, ok := albumMap["tracks"].([]interface{}); ok {
								for _, t := range trackList {
									if trackMap, ok := t.(map[string]interface{}); ok {
										tracksItems = append(tracksItems, map[string]interface{}{
											"track": map[string]interface{}{
												"discNumber": trackMap["disc_number"],
												"id":         trackMap["id"],
												"uri":        fmt.Sprintf("spotify:track:%s", trackMap["id"]),
											},
										})
									}
								}
							}
						}

						albumFetchData = map[string]interface{}{
							"data": map[string]interface{}{
								"albumUnion": map[string]interface{}{
									"discs": map[string]interface{}{
										"totalCount": albumResponse.Discs.TotalCount,
									},
									"tracks": map[string]interface{}{
										"items":      tracksItems,
										"totalCount": albumResponse.Count,
									},
									"artists": albumResponse.Artists,
									"label":   albumResponse.Label,
								},
							},
						}
					}
				}
			}
		}
	}

	filteredData := FilterTrack(data, c.Separator, albumFetchData)
	composer, composerErr := c.fetchTrackComposerWithClient(ctx, client, trackID)
	if composerErr == nil && composer != "" {
		filteredData["composer"] = composer
	}

	jsonData, err := json.Marshal(filteredData)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal filtered data: %w", err)
	}

	var result apiTrackResponse
	if err := json.Unmarshal(jsonData, &result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal to apiTrackResponse: %w", err)
	}

	if result.ID != "" {
		if identifiers, err := GetSpotifyTrackIdentifiersDirect(result.ID); err == nil || identifiers.UPC != "" {
			if identifiers.UPC != "" {
				result.UPC = identifiers.UPC
			}
		}
	}

	return &result, nil
}

func collectTrackCreditNamesByRole(items []interface{}, role string) []string {
	role = strings.TrimSpace(role)
	if role == "" || len(items) == 0 {
		return nil
	}

	seen := make(map[string]struct{}, len(items))
	names := make([]string, 0, len(items))
	for _, item := range items {
		itemMap, ok := item.(map[string]interface{})
		if !ok {
			continue
		}

		if !strings.EqualFold(strings.TrimSpace(getString(itemMap, "role")), role) {
			continue
		}

		name := strings.TrimSpace(getString(itemMap, "name"))
		if name == "" {
			continue
		}
		if _, exists := seen[name]; exists {
			continue
		}

		seen[name] = struct{}{}
		names = append(names, name)
	}

	return names
}

func (c *SpotifyMetadataClient) fetchTrackComposerWithClient(ctx context.Context, client *SpotifyClient, trackID string) (string, error) {
	_ = ctx

	payload := map[string]interface{}{
		"variables": map[string]interface{}{
			"trackUri":           fmt.Sprintf("spotify:track:%s", trackID),
			"contributorsLimit":  100,
			"contributorsOffset": 0,
		},
		"operationName": "queryTrackCreditsModal",
		"extensions": map[string]interface{}{
			"persistedQuery": map[string]interface{}{
				"version":    1,
				"sha256Hash": "e2ca40d46cf1fde36562261ccec754f23fb31b561877252e9fe0d6834aabb84b",
			},
		},
	}

	data, err := client.Query(payload)
	if err != nil {
		return "", fmt.Errorf("failed to query track credits: %w", err)
	}

	creditItems := getSlice(
		getMap(
			getMap(
				getMap(
					getMap(data, "data"),
					"trackUnion",
				),
				"creditsTrait",
			),
			"contributors",
		),
		"items",
	)

	composerNames := collectTrackCreditNamesByRole(creditItems, "Composer")
	if len(composerNames) == 0 {
		return "", nil
	}

	separator := strings.TrimSpace(c.Separator)
	if separator == "" {
		separator = ", "
	}

	return strings.Join(composerNames, separator), nil
}

func (c *SpotifyMetadataClient) fetchAlbum(ctx context.Context, albumID string, callback MetadataCallback) (*apiAlbumResponse, error) {
	client := NewSpotifyClient()
	if err := client.Initialize(); err != nil {
		return nil, fmt.Errorf("failed to initialize spotify client: %w", err)
	}
	return c.fetchAlbumWithClient(ctx, client, albumID, callback)
}

func (c *SpotifyMetadataClient) fetchAlbumWithClient(ctx context.Context, client *SpotifyClient, albumID string, callback MetadataCallback) (*apiAlbumResponse, error) {

	allItems := []interface{}{}
	offset := 0
	limit := 1000
	var totalCount interface{}
	var data map[string]interface{}

	for {
		payload := map[string]interface{}{
			"variables": map[string]interface{}{
				"uri":    fmt.Sprintf("spotify:album:%s", albumID),
				"locale": "",
				"offset": offset,
				"limit":  limit,
			},
			"operationName": "getAlbum",
			"extensions": map[string]interface{}{
				"persistedQuery": map[string]interface{}{
					"version":    1,
					"sha256Hash": "b9bfabef66ed756e5e13f68a942deb60bd4125ec1f1be8cc42769dc0259b4b10",
				},
			},
		}

		response, err := client.Query(payload)
		if err != nil {
			return nil, fmt.Errorf("failed to query album: %w", err)
		}

		if data == nil {
			data = response
			if callback != nil {
				filtered := FilterAlbum(data, c.Separator)
				jsonData, _ := json.Marshal(filtered)
				var result apiAlbumResponse
				if json.Unmarshal(jsonData, &result) == nil {
					formatted, _ := c.formatAlbumData(&result, nil)
					callback(formatted)
				}
			}
		}

		albumData := getMap(getMap(response, "data"), "albumUnion")
		tracksData := getMap(albumData, "tracksV2")
		items := getSlice(tracksData, "items")

		if items == nil || len(items) == 0 {
			break
		}

		allItems = append(allItems, items...)

		if totalCount == nil {
			if tc, ok := tracksData["totalCount"].(float64); ok {
				totalCount = int(tc)
			} else {
				totalCount = len(items)
			}
		}

		tcInt := 0
		if tc, ok := totalCount.(int); ok {
			tcInt = tc
		} else if tc, ok := totalCount.(float64); ok {
			tcInt = int(tc)
		}

		if len(allItems) >= tcInt || len(items) < limit {
			break
		}

		offset += limit
	}

	if data != nil && len(allItems) > 0 {
		dataMap := getMap(data, "data")
		albumUnion := getMap(dataMap, "albumUnion")
		tracksV2 := getMap(albumUnion, "tracksV2")
		tracksV2["items"] = allItems
		tracksV2["totalCount"] = len(allItems)
	}

	filteredData := FilterAlbum(data, c.Separator)

	jsonData, err := json.Marshal(filteredData)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal filtered data: %w", err)
	}

	var result apiAlbumResponse
	if err := json.Unmarshal(jsonData, &result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal to apiAlbumResponse: %w", err)
	}

	if result.ID != "" {
		if upc, err := lookupSpotifyAlbumUPC(result.ID); err == nil && strings.TrimSpace(upc) != "" {
			result.UPC = upc
			for i := range result.Tracks {
				if strings.TrimSpace(result.Tracks[i].UPC) == "" {
					result.Tracks[i].UPC = upc
				}
			}
		}
	}

	return &result, nil
}

func (c *SpotifyMetadataClient) fetchPlaylist(ctx context.Context, playlistID string, callback MetadataCallback) (*apiPlaylistResponse, error) {
	client := NewSpotifyClient()
	if err := client.Initialize(); err != nil {
		return nil, fmt.Errorf("failed to initialize spotify client: %w", err)
	}

	allItems := []interface{}{}
	offset := 0
	limit := 1000
	var totalCount interface{}
	var data map[string]interface{}

	for {
		payload := map[string]interface{}{
			"variables": map[string]interface{}{
				"uri":                       fmt.Sprintf("spotify:playlist:%s", playlistID),
				"offset":                    offset,
				"limit":                     limit,
				"enableWatchFeedEntrypoint": false,
			},
			"operationName": "fetchPlaylist",
			"extensions": map[string]interface{}{
				"persistedQuery": map[string]interface{}{
					"version":    1,
					"sha256Hash": "bb67e0af06e8d6f52b531f97468ee4acd44cd0f82b988e15c2ea47b1148efc77",
				},
			},
		}

		response, err := client.Query(payload)
		if err != nil {
			return nil, fmt.Errorf("failed to query playlist: %w", err)
		}

		if data == nil {
			data = response
			if callback != nil {
				filtered := FilterPlaylist(data, c.Separator)
				jsonData, _ := json.Marshal(filtered)
				var result apiPlaylistResponse
				if json.Unmarshal(jsonData, &result) == nil {
					formatted := c.formatPlaylistData(&result, nil)
					callback(formatted)
				}
			}
		}

		playlistData := getMap(getMap(response, "data"), "playlistV2")
		content := getMap(playlistData, "content")
		items := getSlice(content, "items")

		if items == nil || len(items) == 0 {
			break
		}

		allItems = append(allItems, items...)

		if totalCount == nil {
			if tc, ok := content["totalCount"].(float64); ok {
				totalCount = int(tc)
			} else {
				totalCount = len(items)
			}
		}

		tcInt := 0
		if tc, ok := totalCount.(int); ok {
			tcInt = tc
		} else if tc, ok := totalCount.(float64); ok {
			tcInt = int(tc)
		}

		if len(allItems) >= tcInt || len(items) < limit {
			break
		}

		offset += limit
	}

	if data != nil && len(allItems) > 0 {
		dataMap := getMap(data, "data")
		playlistV2 := getMap(dataMap, "playlistV2")
		content := getMap(playlistV2, "content")
		content["items"] = allItems
		content["totalCount"] = len(allItems)
	}

	filteredData := FilterPlaylist(data, c.Separator)

	jsonData, err := json.Marshal(filteredData)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal filtered data: %w", err)
	}

	var result apiPlaylistResponse
	if err := json.Unmarshal(jsonData, &result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal to apiPlaylistResponse: %w", err)
	}

	return &result, nil
}

func (c *SpotifyMetadataClient) fetchArtistDiscography(ctx context.Context, parsed spotifyURI, callback MetadataCallback) (*apiArtistResponse, error) {
	client := NewSpotifyClient()
	if err := client.Initialize(); err != nil {
		return nil, fmt.Errorf("failed to initialize spotify client: %w", err)
	}

	overviewPayload := map[string]interface{}{
		"variables": map[string]interface{}{
			"uri":    fmt.Sprintf("spotify:artist:%s", parsed.ID),
			"locale": "",
		},
		"operationName": "queryArtistOverview",
		"extensions": map[string]interface{}{
			"persistedQuery": map[string]interface{}{
				"version":    1,
				"sha256Hash": "446130b4a0aa6522a686aafccddb0ae849165b5e0436fd802f96e0243617b5d8",
			},
		},
	}

	data, err := client.Query(overviewPayload)
	if err != nil {
		return nil, fmt.Errorf("failed to query artist overview: %w", err)
	}

	if callback != nil {
		filtered := FilterArtist(data, c.Separator)
		jsonData, _ := json.Marshal(filtered)
		var result apiArtistResponse
		if json.Unmarshal(jsonData, &result) == nil {
			formatted, _ := c.formatArtistDiscographyData(ctx, &result, nil)
			callback(formatted)
		}
	}

	allDiscographyItems := []interface{}{}
	offset := 0
	limit := 50
	var totalCount interface{}

	for {
		discographyPayload := map[string]interface{}{
			"variables": map[string]interface{}{
				"uri":    fmt.Sprintf("spotify:artist:%s", parsed.ID),
				"offset": offset,
				"limit":  limit,
				"order":  "DATE_DESC",
			},
			"operationName": "queryArtistDiscographyAll",
			"extensions": map[string]interface{}{
				"persistedQuery": map[string]interface{}{
					"version":    1,
					"sha256Hash": "5e07d323febb57b4a56a42abbf781490e58764aa45feb6e3dc0591564fc56599",
				},
			},
		}

		response, err := client.Query(discographyPayload)
		if err != nil {
			break
		}

		discographyData := getMap(getMap(getMap(response, "data"), "artistUnion"), "discography")
		allData := getMap(discographyData, "all")
		items := getSlice(allData, "items")

		if items == nil || len(items) == 0 {
			break
		}

		allDiscographyItems = append(allDiscographyItems, items...)

		if totalCount == nil {
			if tc, ok := allData["totalCount"].(float64); ok {
				totalCount = int(tc)
			} else {
				totalCount = len(items)
			}
		}

		tcInt := 0
		if tc, ok := totalCount.(int); ok {
			tcInt = tc
		} else if tc, ok := totalCount.(float64); ok {
			tcInt = int(tc)
		}

		if len(allDiscographyItems) >= tcInt || len(items) < limit {
			break
		}

		offset += limit

		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}
	}

	albumsItems := []interface{}{}
	compilationsItems := []interface{}{}
	singlesItems := []interface{}{}

	for _, item := range allDiscographyItems {
		itemMap, ok := item.(map[string]interface{})
		if !ok {
			continue
		}

		releases := getMap(itemMap, "releases")
		releaseItems := getSlice(releases, "items")
		var release map[string]interface{}
		if len(releaseItems) > 0 {
			if r, ok := releaseItems[0].(map[string]interface{}); ok {
				release = r
			}
		}

		if release != nil {
			releaseType := getString(release, "type")
			switch releaseType {
			case "ALBUM":
				albumsItems = append(albumsItems, item)
			case "COMPILATION":
				compilationsItems = append(compilationsItems, item)
			case "SINGLE":
				singlesItems = append(singlesItems, item)
			default:
				singlesItems = append(singlesItems, item)
			}
		}
	}

	if len(allDiscographyItems) > 0 {
		dataMap := getMap(data, "data")
		artistUnion := getMap(dataMap, "artistUnion")
		discographyMap := getMap(artistUnion, "discography")

		if len(albumsItems) > 0 {
			discographyMap["albums"] = map[string]interface{}{
				"items":      albumsItems,
				"totalCount": len(albumsItems),
			}
		}
		if len(compilationsItems) > 0 {
			discographyMap["compilations"] = map[string]interface{}{
				"items":      compilationsItems,
				"totalCount": len(compilationsItems),
			}
		}
		if len(singlesItems) > 0 {
			discographyMap["singles"] = map[string]interface{}{
				"items":      singlesItems,
				"totalCount": len(singlesItems),
			}
		}

		discographyMap["all"] = map[string]interface{}{
			"items":      allDiscographyItems,
			"totalCount": len(allDiscographyItems),
		}
	}

	filteredData := FilterArtist(data, c.Separator)

	jsonData, err := json.Marshal(filteredData)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal filtered data: %w", err)
	}

	var result apiArtistResponse
	if err := json.Unmarshal(jsonData, &result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal to apiArtistResponse: %w", err)
	}

	return &result, nil
}

func (c *SpotifyMetadataClient) formatTrackData(raw *apiTrackResponse) TrackResponse {
	durationMS := parseDuration(raw.Duration)

	externalURL := fmt.Sprintf("https://open.spotify.com/track/%s", raw.ID)
	albumID := strings.TrimSpace(raw.Album.ID)
	albumURL := ""
	if albumID != "" {
		albumURL = fmt.Sprintf("https://open.spotify.com/album/%s", albumID)
	}
	artistID := ""
	artistURL := ""
	artistsData := make([]ArtistSimple, 0, len(raw.ArtistIds))
	for index, id := range raw.ArtistIds {
		trimmedID := strings.TrimSpace(id)
		if trimmedID == "" {
			continue
		}
		if artistID == "" {
			artistID = trimmedID
			artistURL = fmt.Sprintf("https://open.spotify.com/artist/%s", trimmedID)
		}
		artistName := ""
		artistNames := splitAndCleanArtists(raw.Artists)
		if index < len(artistNames) {
			artistName = artistNames[index]
		}
		artistsData = append(artistsData, ArtistSimple{
			ID:          trimmedID,
			Name:        artistName,
			ExternalURL: fmt.Sprintf("https://open.spotify.com/artist/%s", trimmedID),
		})
	}

	coverURL := raw.Cover.Small
	if coverURL == "" {
		coverURL = raw.Cover.Medium
	}
	if coverURL == "" {
		coverURL = raw.Cover.Large
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
		AlbumID:     albumID,
		AlbumURL:    albumURL,
		ArtistID:    artistID,
		ArtistURL:   artistURL,
		ArtistsData: artistsData,
		UPC:         raw.UPC,
		Copyright:   raw.Copyright,
		Publisher:   raw.Album.Label,
		Composer:    raw.Composer,
		Plays:       raw.Plays,
		IsExplicit:  raw.IsExplicit,
	}

	return TrackResponse{
		Track: trackMetadata,
	}
}

func (c *SpotifyMetadataClient) formatAlbumData(raw *apiAlbumResponse, callback MetadataCallback) (*AlbumResponsePayload, error) {
	var artistID, artistURL string
	for _, item := range raw.Tracks {
		if len(item.ArtistIds) == 0 {
			continue
		}
		candidate := strings.TrimSpace(item.ArtistIds[0])
		if candidate == "" {
			continue
		}
		artistID = candidate
		artistURL = fmt.Sprintf("https://open.spotify.com/artist/%s", candidate)
		break
	}

	info := AlbumInfoMetadata{
		TotalTracks: raw.Count,
		Name:        raw.Name,
		ReleaseDate: raw.ReleaseDate,
		Artists:     raw.Artists,
		Images:      raw.Cover,
		UPC:         raw.UPC,
		ArtistID:    artistID,
		ArtistURL:   artistURL,
	}

	if callback != nil {
		callback(AlbumResponsePayload{
			AlbumInfo: info,
			TrackList: []AlbumTrackMetadata{},
		})
	}

	tracks := make([]AlbumTrackMetadata, 0, len(raw.Tracks))
	for idx, item := range raw.Tracks {
		durationMS := parseDuration(item.Duration)
		trackNumber := idx + 1
		trackUPC := strings.TrimSpace(item.UPC)
		if trackUPC == "" {
			trackUPC = strings.TrimSpace(raw.UPC)
		}

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
			DiscNumber:  item.DiscNumber,
			TotalDiscs:  raw.Discs.TotalCount,
			ExternalURL: fmt.Sprintf("https://open.spotify.com/track/%s", item.ID),
			AlbumID:     raw.ID,
			AlbumURL:    fmt.Sprintf("https://open.spotify.com/album/%s", raw.ID),
			ArtistID:    artistID,
			ArtistURL:   artistURL,
			ArtistsData: artistsData,
			UPC:         trackUPC,
			Plays:       item.Plays,
			IsExplicit:  item.IsExplicit,
		})
	}

	if callback != nil {
		callback(tracks)
	}

	return &AlbumResponsePayload{
		AlbumInfo: info,
		TrackList: tracks,
	}, nil
}

func (c *SpotifyMetadataClient) formatPlaylistData(raw *apiPlaylistResponse, callback MetadataCallback) PlaylistResponsePayload {
	var info PlaylistInfoMetadata
	info.Tracks.Total = raw.Count
	info.Followers.Total = raw.Followers
	info.Owner.DisplayName = raw.Owner.Name
	info.Owner.Name = raw.Name
	info.Owner.Images = raw.Owner.Avatar
	info.Cover = raw.Cover
	info.Description = raw.Description

	if callback != nil {
		callback(PlaylistResponsePayload{
			PlaylistInfo: info,
			TrackList:    []AlbumTrackMetadata{},
		})
	}

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
			AlbumArtist: item.AlbumArtist,
			DurationMS:  durationMS,
			Images:      item.Cover,
			ReleaseDate: "",
			TrackNumber: 0,
			TotalTracks: 0,
			DiscNumber:  item.DiscNumber,
			TotalDiscs:  0,
			ExternalURL: fmt.Sprintf("https://open.spotify.com/track/%s", item.ID),
			AlbumID:     item.AlbumID,
			AlbumURL:    fmt.Sprintf("https://open.spotify.com/album/%s", item.AlbumID),
			ArtistID:    artistID,
			ArtistURL:   artistURL,
			ArtistsData: artistsData,
			UPC:         item.UPC,
			Plays:       item.Plays,
			Status:      item.Status,
			IsExplicit:  item.IsExplicit,
		})
	}

	if callback != nil {
		callback(tracks)
	}

	return PlaylistResponsePayload{
		PlaylistInfo: info,
		TrackList:    tracks,
	}
}

func (c *SpotifyMetadataClient) formatArtistDiscographyData(ctx context.Context, raw *apiArtistResponse, callback MetadataCallback) (*ArtistDiscographyPayload, error) {
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

	type fetchResult struct {
		tracks []AlbumTrackMetadata
		err    error
	}

	resultsChan := make(chan fetchResult, len(raw.Discography.All))
	sem := make(chan struct{}, 5)

	sharedClient := NewSpotifyClient()
	if err := sharedClient.Initialize(); err != nil {
		return nil, fmt.Errorf("failed to initialize shared spotify client: %w", err)
	}

	for _, alb := range raw.Discography.All {
		albumList = append(albumList, DiscographyAlbumMetadata{
			ID:          alb.ID,
			Name:        alb.Name,
			AlbumType:   alb.Type,
			ReleaseDate: alb.Date,
			TotalTracks: alb.TotalTracks,
			Artists:     raw.Name,
			Images:      alb.Cover,
			ExternalURL: fmt.Sprintf("https://open.spotify.com/album/%s", alb.ID),
		})
	}

	if callback != nil {
		callback(ArtistDiscographyPayload{
			ArtistInfo: info,
			AlbumList:  albumList,
			TrackList:  []AlbumTrackMetadata{},
		})
	}

	for _, alb := range raw.Discography.All {
		go func(albumID string, albumName string) {
			sem <- struct{}{}

			time.Sleep(100 * time.Millisecond)
			defer func() { <-sem }()

			select {
			case <-ctx.Done():
				resultsChan <- fetchResult{err: ctx.Err()}
				return
			default:
			}

			albumData, err := c.fetchAlbumWithClient(ctx, sharedClient, albumID, nil)
			if err != nil {
				fmt.Printf("Error getting tracks for album %s: %v\n", albumName, err)
				resultsChan <- fetchResult{tracks: []AlbumTrackMetadata{}}
				return
			}

			tracks := make([]AlbumTrackMetadata, 0, len(albumData.Tracks))
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

				tracks = append(tracks, AlbumTrackMetadata{
					SpotifyID:   tr.ID,
					Artists:     tr.Artists,
					Name:        tr.Name,
					AlbumName:   albumData.Name,
					AlbumArtist: raw.Name,
					AlbumType:   "album",
					DurationMS:  durationMS,
					Images:      albumData.Cover,
					ReleaseDate: albumData.ReleaseDate,
					TrackNumber: trackNumber,
					TotalTracks: albumData.Count,
					DiscNumber:  tr.DiscNumber,
					UPC:         tr.UPC,
					ExternalURL: fmt.Sprintf("https://open.spotify.com/track/%s", tr.ID),
					AlbumID:     albumID,
					AlbumURL:    fmt.Sprintf("https://open.spotify.com/album/%s", albumID),
					ArtistID:    artistID,
					ArtistURL:   artistURL,
					ArtistsData: artistsData,
					Plays:       tr.Plays,
					IsExplicit:  tr.IsExplicit,
				})
			}
			if callback != nil {
				callback(tracks)
			}
			resultsChan <- fetchResult{tracks: tracks}
		}(alb.ID, alb.Name)
	}

	for i := 0; i < len(raw.Discography.All); i++ {
		res := <-resultsChan
		if res.err != nil {
			return nil, res.err
		}
		allTracks = append(allTracks, res.tracks...)
	}

	return &ArtistDiscographyPayload{
		ArtistInfo: info,
		AlbumList:  albumList,
		TrackList:  allTracks,
	}, nil
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

func splitAndCleanArtists(artists string) []string {
	raw := regexp.MustCompile(`\s*[;,]\s*`).Split(strings.TrimSpace(artists), -1)
	parts := make([]string, 0, len(raw))
	for _, part := range raw {
		part = strings.TrimSpace(part)
		if part != "" {
			parts = append(parts, part)
		}
	}
	return parts
}

func (c *SpotifyMetadataClient) Search(ctx context.Context, query string, limit int) (*SearchResponse, error) {
	if query == "" {
		return nil, errors.New("search query cannot be empty")
	}

	if limit <= 0 || limit > 50 {
		limit = 50
	}

	client := NewSpotifyClient()
	if err := client.Initialize(); err != nil {
		return nil, fmt.Errorf("failed to initialize spotify client: %w", err)
	}

	payload := map[string]interface{}{
		"variables": map[string]interface{}{
			"searchTerm":                    query,
			"offset":                        0,
			"limit":                         limit,
			"numberOfTopResults":            5,
			"includeAudiobooks":             true,
			"includeArtistHasConcertsField": false,
			"includePreReleases":            true,
			"includeAuthors":                false,
		},
		"operationName": "searchDesktop",
		"extensions": map[string]interface{}{
			"persistedQuery": map[string]interface{}{
				"version":    1,
				"sha256Hash": "fcad5a3e0d5af727fb76966f06971c19cfa2275e6ff7671196753e008611873c",
			},
		},
	}

	data, err := client.Query(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to query search: %w", err)
	}

	filteredData := FilterSearch(data, c.Separator)

	jsonData, err := json.Marshal(filteredData)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal filtered data: %w", err)
	}

	var apiResp apiSearchResponse
	if err := json.Unmarshal(jsonData, &apiResp); err != nil {
		return nil, fmt.Errorf("failed to unmarshal to apiSearchResponse: %w", err)
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
			IsExplicit:  item.IsExplicit,
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

	client := NewSpotifyClient()
	if err := client.Initialize(); err != nil {
		return nil, fmt.Errorf("failed to initialize spotify client: %w", err)
	}

	payload := map[string]interface{}{
		"variables": map[string]interface{}{
			"searchTerm":                    query,
			"offset":                        offset,
			"limit":                         limit,
			"numberOfTopResults":            5,
			"includeAudiobooks":             true,
			"includeArtistHasConcertsField": false,
			"includePreReleases":            true,
			"includeAuthors":                false,
		},
		"operationName": "searchDesktop",
		"extensions": map[string]interface{}{
			"persistedQuery": map[string]interface{}{
				"version":    1,
				"sha256Hash": "fcad5a3e0d5af727fb76966f06971c19cfa2275e6ff7671196753e008611873c",
			},
		},
	}

	data, err := client.Query(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to query search: %w", err)
	}

	filteredData := FilterSearch(data, c.Separator)

	jsonData, err := json.Marshal(filteredData)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal filtered data: %w", err)
	}

	var apiResp apiSearchResponse
	if err := json.Unmarshal(jsonData, &apiResp); err != nil {
		return nil, fmt.Errorf("failed to unmarshal to apiSearchResponse: %w", err)
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
				IsExplicit:  item.IsExplicit,
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

func GetPreviewURL(trackID string) (string, error) {
	if trackID == "" {
		return "", errors.New("track ID cannot be empty")
	}

	embedURL := fmt.Sprintf("https://open.spotify.com/embed/track/%s", trackID)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Get(embedURL)
	if err != nil {
		return "", fmt.Errorf("failed to fetch embed page: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("embed page returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response body: %w", err)
	}

	html := string(body)
	re := regexp.MustCompile(`https://p\.scdn\.co/mp3-preview/[a-zA-Z0-9]+`)
	match := re.FindString(html)

	if match == "" {
		return "", errors.New("preview URL not found")
	}

	return match, nil
}
