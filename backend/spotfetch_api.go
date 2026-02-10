package backend

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

func GetSpotifyDataWithAPI(ctx context.Context, spotifyURL string, useAPI bool, apiBaseURL string, batch bool, delay time.Duration) (interface{}, error) {
	if !useAPI || apiBaseURL == "" {

		return GetFilteredSpotifyData(ctx, spotifyURL, batch, delay)
	}

	spotifyType, id := parseSpotifyURLToTypeAndID(spotifyURL)
	if spotifyType == "" || id == "" {
		return nil, fmt.Errorf("invalid Spotify URL: %s", spotifyURL)
	}

	apiURL := fmt.Sprintf("%s/%s/%s", strings.TrimSuffix(apiBaseURL, "/"), spotifyType, id)

	req, err := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create API request: %w", err)
	}

	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("SpotFetch API request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("SpotFetch API error: HTTP %d", resp.StatusCode)
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read API response: %w", err)
	}

	var data interface{}

	switch spotifyType {
	case "track":
		var trackResp TrackResponse
		if err := json.Unmarshal(bodyBytes, &trackResp); err != nil {
			return nil, fmt.Errorf("failed to decode track response: %w", err)
		}
		data = trackResp
	case "album":
		var albumResp AlbumResponsePayload
		if err := json.Unmarshal(bodyBytes, &albumResp); err != nil {
			return nil, fmt.Errorf("failed to decode album response: %w", err)
		}
		data = &albumResp
	case "playlist":
		var playlistResp PlaylistResponsePayload
		if err := json.Unmarshal(bodyBytes, &playlistResp); err != nil {
			return nil, fmt.Errorf("failed to decode playlist response: %w", err)
		}
		data = playlistResp
	case "artist":
		var artistResp ArtistDiscographyPayload
		if err := json.Unmarshal(bodyBytes, &artistResp); err != nil {
			return nil, fmt.Errorf("failed to decode artist response: %w", err)
		}
		data = &artistResp
	default:
		return nil, fmt.Errorf("unsupported Spotify type: %s", spotifyType)
	}

	return data, nil
}

func parseSpotifyURLToTypeAndID(url string) (string, string) {

	if strings.HasPrefix(url, "spotify:") {
		parts := strings.Split(url, ":")
		if len(parts) >= 3 {
			return parts[1], parts[2]
		}
	}

	re := regexp.MustCompile(`spotify\.com/(track|album|playlist|artist)/([a-zA-Z0-9]+)`)
	matches := re.FindStringSubmatch(url)
	if len(matches) == 3 {
		return matches[1], matches[2]
	}

	return "", ""
}
