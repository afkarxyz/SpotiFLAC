package backend

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type SongLinkClient struct {
	client           *http.Client
	lastAPICallTime  time.Time
	apiCallCount     int
	apiCallResetTime time.Time
}

type SongLinkURLs struct {
	TidalURL  string `json:"tidal_url"`
	AmazonURL string `json:"amazon_url"`
}

type TrackAvailability struct {
	SpotifyID string `json:"spotify_id"`
	Tidal     bool   `json:"tidal"`
	Amazon    bool   `json:"amazon"`
	Qobuz     bool   `json:"qobuz"`
	TidalURL  string `json:"tidal_url,omitempty"`
	AmazonURL string `json:"amazon_url,omitempty"`
	QobuzURL  string `json:"qobuz_url,omitempty"`
}

func NewSongLinkClient() *SongLinkClient {
	return &SongLinkClient{
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
		apiCallResetTime: time.Now(),
	}
}

func (s *SongLinkClient) GetAllURLsFromSpotify(spotifyTrackID string, region string) (*SongLinkURLs, error) {

	now := time.Now()
	if now.Sub(s.apiCallResetTime) >= time.Minute {
		s.apiCallCount = 0
		s.apiCallResetTime = now
	}

	if s.apiCallCount >= 9 {
		waitTime := time.Minute - now.Sub(s.apiCallResetTime)
		if waitTime > 0 {
			fmt.Printf("Rate limit reached, waiting %v...\n", waitTime.Round(time.Second))
			time.Sleep(waitTime)
			s.apiCallCount = 0
			s.apiCallResetTime = time.Now()
		}
	}

	if !s.lastAPICallTime.IsZero() {
		timeSinceLastCall := now.Sub(s.lastAPICallTime)
		minDelay := 7 * time.Second
		if timeSinceLastCall < minDelay {
			waitTime := minDelay - timeSinceLastCall
			fmt.Printf("Rate limiting: waiting %v...\n", waitTime.Round(time.Second))
			time.Sleep(waitTime)
		}
	}

	spotifyBase, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly9vcGVuLnNwb3RpZnkuY29tL3RyYWNrLw==")
	spotifyURL := fmt.Sprintf("%s%s", string(spotifyBase), spotifyTrackID)

	apiBase, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly9hcGkuc29uZy5saW5rL3YxLWFscGhhLjEvbGlua3M/dXJsPQ==")
	apiURL := fmt.Sprintf("%s%s", string(apiBase), url.QueryEscape(spotifyURL))

	if region != "" {
		apiURL += fmt.Sprintf("&userCountry=%s", region)
	}

	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	fmt.Println("Getting streaming URLs from song.link...")

	maxRetries := 3
	var resp *http.Response
	for i := 0; i < maxRetries; i++ {
		resp, err = s.client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("failed to get URLs: %w", err)
		}

		s.lastAPICallTime = time.Now()
		s.apiCallCount++

		if resp.StatusCode == 429 {
			resp.Body.Close()
			if i < maxRetries-1 {
				waitTime := 15 * time.Second
				fmt.Printf("Rate limited by API, waiting %v before retry...\n", waitTime)
				time.Sleep(waitTime)
				continue
			}
			return nil, fmt.Errorf("API rate limit exceeded after %d retries", maxRetries)
		}

		if resp.StatusCode != 200 {
			resp.Body.Close()
			return nil, fmt.Errorf("API returned status %d", resp.StatusCode)
		}

		break
	}
	defer resp.Body.Close()

	var songLinkResp struct {
		LinksByPlatform map[string]struct {
			URL string `json:"url"`
		} `json:"linksByPlatform"`
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	if len(body) == 0 {
		return nil, fmt.Errorf("API returned empty response")
	}

	if err := json.Unmarshal(body, &songLinkResp); err != nil {

		bodyStr := string(body)
		if len(bodyStr) > 200 {
			bodyStr = bodyStr[:200] + "..."
		}
		return nil, fmt.Errorf("failed to decode response: %w (response: %s)", err, bodyStr)
	}

	urls := &SongLinkURLs{}

	if tidalLink, ok := songLinkResp.LinksByPlatform["tidal"]; ok && tidalLink.URL != "" {
		urls.TidalURL = tidalLink.URL
		fmt.Printf("✓ Tidal URL found\n")
	}

	if amazonLink, ok := songLinkResp.LinksByPlatform["amazonMusic"]; ok && amazonLink.URL != "" {
		amazonURL := amazonLink.URL

		if len(amazonURL) > 0 {
			urls.AmazonURL = amazonURL
			fmt.Printf("✓ Amazon URL found\n")
		}
	}

	if urls.TidalURL == "" && urls.AmazonURL == "" {
		return nil, fmt.Errorf("no streaming URLs found")
	}

	return urls, nil
}

func (s *SongLinkClient) CheckTrackAvailability(spotifyTrackID string, isrc string) (*TrackAvailability, error) {

	now := time.Now()
	if now.Sub(s.apiCallResetTime) >= time.Minute {
		s.apiCallCount = 0
		s.apiCallResetTime = now
	}

	if s.apiCallCount >= 9 {
		waitTime := time.Minute - now.Sub(s.apiCallResetTime)
		if waitTime > 0 {
			fmt.Printf("Rate limit reached, waiting %v...\n", waitTime.Round(time.Second))
			time.Sleep(waitTime)
			s.apiCallCount = 0
			s.apiCallResetTime = time.Now()
		}
	}

	if !s.lastAPICallTime.IsZero() {
		timeSinceLastCall := now.Sub(s.lastAPICallTime)
		minDelay := 7 * time.Second
		if timeSinceLastCall < minDelay {
			waitTime := minDelay - timeSinceLastCall
			fmt.Printf("Rate limiting: waiting %v...\n", waitTime.Round(time.Second))
			time.Sleep(waitTime)
		}
	}

	spotifyBase, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly9vcGVuLnNwb3RpZnkuY29tL3RyYWNrLw==")
	spotifyURL := fmt.Sprintf("%s%s", string(spotifyBase), spotifyTrackID)

	apiBase, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly9hcGkuc29uZy5saW5rL3YxLWFscGhhLjEvbGlua3M/dXJsPQ==")
	apiURL := fmt.Sprintf("%s%s", string(apiBase), url.QueryEscape(spotifyURL))

	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	fmt.Printf("Checking availability for track: %s\n", spotifyTrackID)

	maxRetries := 3
	var resp *http.Response
	for i := 0; i < maxRetries; i++ {
		resp, err = s.client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("failed to check availability: %w", err)
		}

		s.lastAPICallTime = time.Now()
		s.apiCallCount++

		if resp.StatusCode == 429 {
			resp.Body.Close()
			if i < maxRetries-1 {
				waitTime := 15 * time.Second
				fmt.Printf("Rate limited by API, waiting %v before retry...\n", waitTime)
				time.Sleep(waitTime)
				continue
			}
			return nil, fmt.Errorf("API rate limit exceeded after %d retries", maxRetries)
		}

		if resp.StatusCode != 200 {
			resp.Body.Close()
			return nil, fmt.Errorf("API returned status %d", resp.StatusCode)
		}

		break
	}
	defer resp.Body.Close()

	var songLinkResp struct {
		LinksByPlatform map[string]struct {
			URL string `json:"url"`
		} `json:"linksByPlatform"`
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	if len(body) == 0 {
		return nil, fmt.Errorf("API returned empty response")
	}

	if err := json.Unmarshal(body, &songLinkResp); err != nil {

		bodyStr := string(body)
		if len(bodyStr) > 200 {
			bodyStr = bodyStr[:200] + "..."
		}
		return nil, fmt.Errorf("failed to decode response: %w (response: %s)", err, bodyStr)
	}

	availability := &TrackAvailability{
		SpotifyID: spotifyTrackID,
	}

	if tidalLink, ok := songLinkResp.LinksByPlatform["tidal"]; ok && tidalLink.URL != "" {
		availability.Tidal = true
		availability.TidalURL = tidalLink.URL
	}

	if amazonLink, ok := songLinkResp.LinksByPlatform["amazonMusic"]; ok && amazonLink.URL != "" {
		availability.Amazon = true
		availability.AmazonURL = amazonLink.URL
	}

	if deezerLink, ok := songLinkResp.LinksByPlatform["deezer"]; ok && deezerLink.URL != "" {
		deezerURL := deezerLink.URL

		deezerISRC, err := GetDeezerISRC(deezerURL)
		if err == nil && deezerISRC != "" {
			qobuzAvailable := checkQobuzAvailability(deezerISRC)
			availability.Qobuz = qobuzAvailable
		}
	}

	return availability, nil
}

func checkQobuzAvailability(isrc string) bool {
	client := &http.Client{Timeout: 10 * time.Second}
	appID := "798273057"

	apiBase, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly93d3cucW9idXouY29tL2FwaS5qc29uLzAuMi90cmFjay9zZWFyY2g/cXVlcnk9")
	searchURL := fmt.Sprintf("%s%s&limit=1&app_id=%s", string(apiBase), isrc, appID)

	resp, err := client.Get(searchURL)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
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

	now := time.Now()
	if now.Sub(s.apiCallResetTime) >= time.Minute {
		s.apiCallCount = 0
		s.apiCallResetTime = now
	}

	if s.apiCallCount >= 9 {
		waitTime := time.Minute - now.Sub(s.apiCallResetTime)
		if waitTime > 0 {
			fmt.Printf("Rate limit reached, waiting %v...\n", waitTime.Round(time.Second))
			time.Sleep(waitTime)
			s.apiCallCount = 0
			s.apiCallResetTime = time.Now()
		}
	}

	if !s.lastAPICallTime.IsZero() {
		timeSinceLastCall := now.Sub(s.lastAPICallTime)
		minDelay := 7 * time.Second
		if timeSinceLastCall < minDelay {
			waitTime := minDelay - timeSinceLastCall
			fmt.Printf("Rate limiting: waiting %v...\n", waitTime.Round(time.Second))
			time.Sleep(waitTime)
		}
	}

	spotifyBase, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly9vcGVuLnNwb3RpZnkuY29tL3RyYWNrLw==")
	spotifyURL := fmt.Sprintf("%s%s", string(spotifyBase), spotifyTrackID)

	apiBase, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly9hcGkuc29uZy5saW5rL3YxLWFscGhhLjEvbGlua3M/dXJsPQ==")
	apiURL := fmt.Sprintf("%s%s", string(apiBase), url.QueryEscape(spotifyURL))

	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	fmt.Println("Getting Deezer URL from song.link...")

	maxRetries := 3
	var resp *http.Response
	for i := 0; i < maxRetries; i++ {
		resp, err = s.client.Do(req)
		if err != nil {
			return "", fmt.Errorf("failed to get Deezer URL: %w", err)
		}

		s.lastAPICallTime = time.Now()
		s.apiCallCount++

		if resp.StatusCode == 429 {
			resp.Body.Close()
			if i < maxRetries-1 {
				waitTime := 15 * time.Second
				fmt.Printf("Rate limited by API, waiting %v before retry...\n", waitTime)
				time.Sleep(waitTime)
				continue
			}
			return "", fmt.Errorf("API rate limit exceeded after %d retries", maxRetries)
		}

		if resp.StatusCode != 200 {
			resp.Body.Close()
			return "", fmt.Errorf("API returned status %d", resp.StatusCode)
		}

		break
	}
	defer resp.Body.Close()

	var songLinkResp struct {
		LinksByPlatform map[string]struct {
			URL string `json:"url"`
		} `json:"linksByPlatform"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&songLinkResp); err != nil {
		return "", fmt.Errorf("failed to decode response: %w", err)
	}

	deezerLink, ok := songLinkResp.LinksByPlatform["deezer"]
	if !ok || deezerLink.URL == "" {
		return "", fmt.Errorf("deezer link not found")
	}

	deezerURL := deezerLink.URL
	fmt.Printf("Found Deezer URL: %s\n", deezerURL)
	return deezerURL, nil
}

func GetDeezerISRC(deezerURL string) (string, error) {

	var trackID string
	if strings.Contains(deezerURL, "/track/") {
		parts := strings.Split(deezerURL, "/track/")
		if len(parts) > 1 {
			trackID = strings.Split(parts[1], "?")[0]
			trackID = strings.TrimSpace(trackID)
		}
	}

	if trackID == "" {
		return "", fmt.Errorf("could not extract track ID from Deezer URL: %s", deezerURL)
	}

	apiURL := fmt.Sprintf("https://api.deezer.com/track/%s", trackID)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(apiURL)
	if err != nil {
		return "", fmt.Errorf("failed to call Deezer API: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
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
	return deezerTrack.ISRC, nil
}
