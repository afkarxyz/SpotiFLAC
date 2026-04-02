package backend

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

const (
	soundplateSpotifyAPIURL = "https://phpstack-822472-6184058.cloudwaysapps.com/api/spotify.php"
	soundplateRefererURL    = "https://phpstack-822472-6184058.cloudwaysapps.com/?"
	soundplateUserAgent     = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
)

type soundplateSpotifyResponse struct {
	Name       string `json:"name"`
	Artist     string `json:"artist"`
	Album      string `json:"album"`
	AlbumType  string `json:"album_type"`
	ArtworkURL string `json:"artwork_url"`
	ISRC       string `json:"isrc"`
	Year       string `json:"year"`
	SpotifyURL string `json:"spotify_url"`
}

func (s *SongLinkClient) lookupSpotifyISRCViaSoundplate(spotifyTrackID string) (string, string, error) {
	normalizedTrackID, err := extractSpotifyTrackID(spotifyTrackID)
	if err != nil {
		return "", "", err
	}

	spotifyTrackURL := fmt.Sprintf("https://open.spotify.com/track/%s", normalizedTrackID)
	query := url.Values{}
	query.Set("q", spotifyTrackURL)

	req, err := http.NewRequest(http.MethodGet, soundplateSpotifyAPIURL+"?"+query.Encode(), nil)
	if err != nil {
		return "", "", fmt.Errorf("failed to create Soundplate ISRC request: %w", err)
	}
	req.Header.Set("User-Agent", soundplateUserAgent)
	req.Header.Set("Accept", "*/*")
	req.Header.Set("Referer", soundplateRefererURL)
	req.Header.Set("Accept-Language", "en-US,en;q=0.9,id;q=0.8")
	req.Header.Set("Sec-CH-UA", "\"Chromium\";v=\"146\", \"Not-A.Brand\";v=\"24\", \"Google Chrome\";v=\"146\"")
	req.Header.Set("Sec-CH-UA-Mobile", "?0")
	req.Header.Set("Sec-CH-UA-Platform", "\"Windows\"")
	req.Header.Set("Sec-Fetch-Dest", "empty")
	req.Header.Set("Sec-Fetch-Mode", "cors")
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	req.Header.Set("Priority", "u=1, i")

	resp, err := s.client.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("Soundplate ISRC request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", "", fmt.Errorf("failed to read Soundplate ISRC response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		bodyPreview := strings.TrimSpace(string(body))
		if len(bodyPreview) > 256 {
			bodyPreview = bodyPreview[:256]
		}
		return "", "", fmt.Errorf("Soundplate ISRC returned status %d (%s)", resp.StatusCode, bodyPreview)
	}

	var payload soundplateSpotifyResponse
	if err := json.Unmarshal(body, &payload); err != nil {
		return "", "", fmt.Errorf("failed to decode Soundplate ISRC response: %w", err)
	}

	isrc := firstISRCMatch(payload.ISRC)
	if isrc == "" {
		isrc = firstISRCMatch(string(body))
	}
	if isrc == "" {
		return "", "", fmt.Errorf("ISRC missing in Soundplate response")
	}

	resolvedTrackID := ""
	if payload.SpotifyURL != "" {
		if trackID, err := extractSpotifyTrackID(payload.SpotifyURL); err == nil {
			resolvedTrackID = trackID
		}
	}

	return isrc, resolvedTrackID, nil
}
