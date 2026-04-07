package backend

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const songLinkUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"

var (
	isrcPattern          = regexp.MustCompile(`\b([A-Z]{2}[A-Z0-9]{3}\d{7})\b`)
	amazonAlbumTrackPath = regexp.MustCompile(`/albums/[A-Z0-9]{10}/(B[0-9A-Z]{9})`)
	amazonTrackPath      = regexp.MustCompile(`/tracks/(B[0-9A-Z]{9})`)
)

type SongLinkClient struct {
	client *http.Client
}

type SongLinkURLs struct {
	TidalURL  string `json:"tidal_url"`
	AmazonURL string `json:"amazon_url"`
	DeezerURL string `json:"deezer_url"`
	ISRC      string `json:"isrc"`
}

type TrackAvailability struct {
	SpotifyID string `json:"spotify_id"`
	Tidal     bool   `json:"tidal"`
	Amazon    bool   `json:"amazon"`
	Qobuz     bool   `json:"qobuz"`
	Deezer    bool   `json:"deezer"`
	TidalURL  string `json:"tidal_url,omitempty"`
	AmazonURL string `json:"amazon_url,omitempty"`
	QobuzURL  string `json:"qobuz_url,omitempty"`
	DeezerURL string `json:"deezer_url,omitempty"`
}

type songLinkAPIResponse struct {
	LinksByPlatform map[string]struct {
		URL string `json:"url"`
	} `json:"linksByPlatform"`
}

func NewSongLinkClient() *SongLinkClient {
	return &SongLinkClient{
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (s *SongLinkClient) GetAllURLsFromSpotify(spotifyTrackID string, region string) (*SongLinkURLs, error) {
	links, err := s.resolveSpotifyTrackLinks(spotifyTrackID, region)
	if err != nil && (links == nil || (links.TidalURL == "" && links.AmazonURL == "")) {
		return nil, err
	}

	urls := &SongLinkURLs{}
	if links != nil {
		urls.TidalURL = links.TidalURL
		urls.AmazonURL = normalizeAmazonMusicURL(links.AmazonURL)
		urls.DeezerURL = normalizeDeezerTrackURL(links.DeezerURL)
		urls.ISRC = links.ISRC
	}

	if urls.TidalURL == "" && urls.AmazonURL == "" && urls.DeezerURL == "" {
		if err != nil {
			return nil, err
		}
		return nil, fmt.Errorf("no streaming URLs found")
	}

	return urls, nil
}

func (s *SongLinkClient) CheckTrackAvailability(spotifyTrackID string) (*TrackAvailability, error) {
	links, err := s.resolveSpotifyTrackLinks(spotifyTrackID, "")

	availability := &TrackAvailability{
		SpotifyID: spotifyTrackID,
	}

	if links != nil {
		availability.TidalURL = links.TidalURL
		availability.AmazonURL = normalizeAmazonMusicURL(links.AmazonURL)
		availability.DeezerURL = normalizeDeezerTrackURL(links.DeezerURL)
		availability.Tidal = availability.TidalURL != ""
		availability.Amazon = availability.AmazonURL != ""
		availability.Deezer = availability.DeezerURL != ""
	}

	isrc := ""
	if links != nil {
		isrc = strings.TrimSpace(links.ISRC)
	}

	if isrc == "" && availability.DeezerURL != "" {
		if resolvedISRC, deezerErr := getDeezerISRC(availability.DeezerURL); deezerErr == nil {
			isrc = resolvedISRC
		}
	}

	if isrc == "" {
		if fallbackISRC, fallbackErr := s.lookupSpotifyISRC(spotifyTrackID); fallbackErr == nil {
			isrc = fallbackISRC
		} else if err == nil {
			err = fallbackErr
		}
	}

	if isrc != "" {
		availability.Qobuz = checkQobuzAvailability(isrc)
	}

	if availability.Tidal || availability.Amazon || availability.Deezer || availability.Qobuz {
		return availability, nil
	}

	if err != nil {
		return availability, err
	}

	return availability, fmt.Errorf("no platforms found")
}

func checkQobuzAvailability(isrc string) bool {
	client := &http.Client{Timeout: 10 * time.Second}
	appID := "798273057"

	searchURL := fmt.Sprintf(
		"https://www.qobuz.com/api.json/0.2/track/search?query=%s&limit=1&app_id=%s",
		url.QueryEscape(strings.TrimSpace(isrc)),
		appID,
	)

	resp, err := client.Get(searchURL)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return false
	}

	var searchResp struct {
		Tracks struct {
			Total int `json:"total"`
		} `json:"tracks"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&searchResp); err != nil {
		return false
	}

	return searchResp.Tracks.Total > 0
}

func (s *SongLinkClient) GetDeezerURLFromSpotify(spotifyTrackID string) (string, error) {
	links, err := s.resolveSpotifyTrackLinks(spotifyTrackID, "")
	if links != nil && links.DeezerURL != "" {
		deezerURL := normalizeDeezerTrackURL(links.DeezerURL)
		fmt.Printf("Found Deezer URL: %s\n", deezerURL)
		return deezerURL, nil
	}

	isrc := ""
	if links != nil {
		isrc = strings.TrimSpace(links.ISRC)
	}
	if isrc == "" {
		fallbackISRC, lookupErr := s.lookupSpotifyISRC(spotifyTrackID)
		if lookupErr == nil {
			isrc = fallbackISRC
		} else if err == nil {
			err = lookupErr
		}
	}

	if isrc != "" {
		deezerURL, deezerErr := s.lookupDeezerTrackURLByISRC(isrc)
		if deezerErr == nil {
			fmt.Printf("Found Deezer URL: %s\n", deezerURL)
			return deezerURL, nil
		}
		if err == nil {
			err = deezerErr
		}
	}

	if err != nil {
		return "", err
	}
	return "", fmt.Errorf("deezer link not found")
}

func getDeezerISRC(deezerURL string) (string, error) {
	trackID, err := extractDeezerTrackID(deezerURL)
	if err != nil {
		return "", err
	}

	apiURL := fmt.Sprintf("https://api.deezer.com/track/%s", trackID)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(apiURL)
	if err != nil {
		return "", fmt.Errorf("failed to call Deezer API: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("Deezer API returned status %d", resp.StatusCode)
	}

	var deezerTrack struct {
		ID    int64  `json:"id"`
		ISRC  string `json:"isrc"`
		Title string `json:"title"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&deezerTrack); err != nil {
		return "", fmt.Errorf("failed to decode Deezer API response: %w", err)
	}

	if deezerTrack.ISRC == "" {
		return "", fmt.Errorf("ISRC not found in Deezer API response for track %s", trackID)
	}

	fmt.Printf("Found ISRC from Deezer: %s (track: %s)\n", deezerTrack.ISRC, deezerTrack.Title)
	return strings.ToUpper(strings.TrimSpace(deezerTrack.ISRC)), nil
}

func (s *SongLinkClient) GetISRC(spotifyID string) (string, error) {
	links, err := s.resolveSpotifyTrackLinks(spotifyID, "")
	if links != nil && links.ISRC != "" {
		return links.ISRC, nil
	}

	if links != nil && links.DeezerURL != "" {
		if isrc, deezerErr := getDeezerISRC(links.DeezerURL); deezerErr == nil {
			return isrc, nil
		}
	}

	isrc, lookupErr := s.lookupSpotifyISRC(spotifyID)
	if lookupErr == nil && isrc != "" {
		return isrc, nil
	}

	if err != nil && lookupErr != nil {
		return "", fmt.Errorf("%v | %v", err, lookupErr)
	}
	if err != nil {
		return "", err
	}
	if lookupErr != nil {
		return "", lookupErr
	}

	return "", fmt.Errorf("ISRC not found")
}

func (s *SongLinkClient) GetISRCDirect(spotifyID string) (string, error) {
	return s.lookupSpotifyISRC(spotifyID)
}

func (s *SongLinkClient) fetchSongLinkLinksByURL(rawURL string, region string) (*songLinkAPIResponse, error) {
	apiURL := fmt.Sprintf("https://api.song.link/v1-alpha.1/links?url=%s", url.QueryEscape(rawURL))
	if region != "" {
		apiURL += fmt.Sprintf("&userCountry=%s", url.QueryEscape(region))
	}

	req, err := http.NewRequest(http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("User-Agent", songLinkUserAgent)

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to call song.link: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyPreview, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
		return nil, fmt.Errorf("song.link returned status %d (%s)", resp.StatusCode, strings.TrimSpace(string(bodyPreview)))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read song.link response: %w", err)
	}
	if len(body) == 0 {
		return nil, fmt.Errorf("song.link returned empty response")
	}

	var parsed songLinkAPIResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		bodyStr := string(body)
		if len(bodyStr) > 200 {
			bodyStr = bodyStr[:200] + "..."
		}
		return nil, fmt.Errorf("failed to decode song.link response: %w (response: %s)", err, bodyStr)
	}

	return &parsed, nil
}

func (s *SongLinkClient) lookupDeezerTrackURLByISRC(isrc string) (string, error) {
	apiURL := fmt.Sprintf("https://api.deezer.com/track/isrc:%s", strings.ToUpper(strings.TrimSpace(isrc)))

	req, err := http.NewRequest(http.MethodGet, apiURL, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("User-Agent", songLinkUserAgent)

	resp, err := s.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to call Deezer ISRC API: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("Deezer ISRC API returned status %d", resp.StatusCode)
	}

	var payload struct {
		ID   int64  `json:"id"`
		ISRC string `json:"isrc"`
		Link string `json:"link"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return "", fmt.Errorf("failed to decode Deezer ISRC response: %w", err)
	}

	if payload.Link != "" {
		return normalizeDeezerTrackURL(payload.Link), nil
	}
	if payload.ID > 0 {
		return normalizeDeezerTrackURL(fmt.Sprintf("https://www.deezer.com/track/%d", payload.ID)), nil
	}

	return "", fmt.Errorf("deezer track link not found for ISRC %s", isrc)
}

func mergeSongLinkResponse(links *resolvedTrackLinks, resp *songLinkAPIResponse) {
	if resp == nil {
		return
	}

	if link, ok := resp.LinksByPlatform["tidal"]; ok && link.URL != "" && links.TidalURL == "" {
		links.TidalURL = strings.TrimSpace(link.URL)
		fmt.Println("✓ Tidal URL found")
	}

	if link, ok := resp.LinksByPlatform["amazonMusic"]; ok && link.URL != "" && links.AmazonURL == "" {
		links.AmazonURL = normalizeAmazonMusicURL(link.URL)
		fmt.Println("✓ Amazon URL found")
	}

	if link, ok := resp.LinksByPlatform["deezer"]; ok && link.URL != "" && links.DeezerURL == "" {
		links.DeezerURL = normalizeDeezerTrackURL(link.URL)
		fmt.Println("✓ Deezer URL found")
	}
}

func normalizeAmazonMusicURL(rawURL string) string {
	amazonURL := strings.TrimSpace(rawURL)
	if amazonURL == "" {
		return ""
	}

	if strings.Contains(amazonURL, "trackAsin=") {
		parts := strings.Split(amazonURL, "trackAsin=")
		if len(parts) > 1 {
			trackAsin := strings.Split(parts[1], "&")[0]
			if trackAsin != "" {
				return fmt.Sprintf("https://music.amazon.com/tracks/%s?musicTerritory=US", trackAsin)
			}
		}
	}

	if match := amazonAlbumTrackPath.FindStringSubmatch(amazonURL); len(match) > 1 {
		return fmt.Sprintf("https://music.amazon.com/tracks/%s?musicTerritory=US", match[1])
	}

	if match := amazonTrackPath.FindStringSubmatch(amazonURL); len(match) > 1 {
		return fmt.Sprintf("https://music.amazon.com/tracks/%s?musicTerritory=US", match[1])
	}

	return ""
}

func normalizeDeezerTrackURL(rawURL string) string {
	trackID, err := extractDeezerTrackID(rawURL)
	if err != nil {
		return strings.TrimSpace(rawURL)
	}
	return fmt.Sprintf("https://www.deezer.com/track/%s", trackID)
}

func extractDeezerTrackID(rawURL string) (string, error) {
	cleanURL := strings.TrimSpace(rawURL)
	if cleanURL == "" {
		return "", fmt.Errorf("empty Deezer URL")
	}

	parts := strings.Split(cleanURL, "/track/")
	if len(parts) < 2 {
		return "", fmt.Errorf("could not extract track ID from Deezer URL: %s", rawURL)
	}

	trackID := strings.Split(parts[1], "?")[0]
	trackID = strings.Trim(trackID, "/ ")
	if trackID == "" {
		return "", fmt.Errorf("could not extract track ID from Deezer URL: %s", rawURL)
	}

	return trackID, nil
}

func hasAnySongLinkData(links *resolvedTrackLinks) bool {
	if links == nil {
		return false
	}
	return links.TidalURL != "" || links.AmazonURL != "" || links.DeezerURL != ""
}

func firstISRCMatch(body string) string {
	match := isrcPattern.FindStringSubmatch(strings.ToUpper(body))
	if len(match) < 2 {
		return ""
	}
	return strings.TrimSpace(match[1])
}
