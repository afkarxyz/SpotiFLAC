package backend

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

type SongLinkClient struct {
	client           *http.Client
	lastAPICallTime  time.Time
	apiCallCount     int
	apiCallResetTime time.Time
	mu               sync.Mutex
	cache            map[string]*songLinkCacheEntry
	cacheMu          sync.RWMutex
}

type songLinkCacheEntry struct {
	data      *songLinkPlatformData
	fetchedAt time.Time
}

type songLinkPlatformData struct {
	TidalURL  string
	AmazonURL string
	DeezerURL string
	ISRC      string
}

type SongLinkURLs struct {
	TidalURL  string `json:"tidal_url"`
	AmazonURL string `json:"amazon_url"`
	DeezerURL string `json:"deezer_url,omitempty"`
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

var (
	defaultSongLinkClient     *SongLinkClient
	defaultSongLinkClientOnce sync.Once
)

func GetSongLinkClient() *SongLinkClient {
	defaultSongLinkClientOnce.Do(func() {
		defaultSongLinkClient = NewSongLinkClient()
	})
	return defaultSongLinkClient
}

func NewSongLinkClient() *SongLinkClient {
	return &SongLinkClient{
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
		apiCallResetTime: time.Now(),
		cache:            make(map[string]*songLinkCacheEntry),
	}
}

const songLinkCacheTTL = 30 * time.Minute

func (s *SongLinkClient) getCached(spotifyTrackID string) *songLinkPlatformData {
	s.cacheMu.RLock()
	defer s.cacheMu.RUnlock()
	entry, ok := s.cache[spotifyTrackID]
	if !ok {
		return nil
	}
	if time.Since(entry.fetchedAt) > songLinkCacheTTL {
		return nil
	}
	return entry.data
}

func (s *SongLinkClient) setCached(spotifyTrackID string, data *songLinkPlatformData) {
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	s.cache[spotifyTrackID] = &songLinkCacheEntry{
		data:      data,
		fetchedAt: time.Now(),
	}
}

// fetchSongLinkData is the shared internal method for all Songlink API calls.
// It handles rate limiting, retries (including for HTTP 400/5xx), caching,
// and falls back to HTML scraping if the API is completely unavailable.
//
// The mutex is only held briefly for state reads/updates, never during
// network I/O or sleeps, so concurrent callers (e.g. ISRC goroutines)
// are not blocked for extended periods.
func (s *SongLinkClient) fetchSongLinkData(spotifyTrackID string, region string) (*songLinkPlatformData, error) {
	// Check cache first
	if cached := s.getCached(spotifyTrackID); cached != nil {
		fmt.Printf("Using cached song.link data for %s\n", spotifyTrackID)
		return cached, nil
	}

	s.mu.Lock()

	// Double-check cache after acquiring lock
	if cached := s.getCached(spotifyTrackID); cached != nil {
		s.mu.Unlock()
		return cached, nil
	}

	// Rate limiting — calculate delays while holding lock, then release before sleeping
	var rateLimitWait time.Duration
	var minDelayWait time.Duration

	now := time.Now()
	if now.Sub(s.apiCallResetTime) >= time.Minute {
		s.apiCallCount = 0
		s.apiCallResetTime = now
	}

	if s.apiCallCount >= 9 {
		rateLimitWait = time.Minute - now.Sub(s.apiCallResetTime)
		if rateLimitWait < 0 {
			rateLimitWait = 0
		}
	}

	if !s.lastAPICallTime.IsZero() {
		timeSinceLastCall := time.Since(s.lastAPICallTime)
		minDelay := 7 * time.Second
		if timeSinceLastCall < minDelay {
			minDelayWait = minDelay - timeSinceLastCall
		}
	}

	s.mu.Unlock()

	// Sleep outside the lock so other callers (e.g. cache hits) are not blocked
	if rateLimitWait > 0 {
		fmt.Printf("Rate limit reached, waiting %v...\n", rateLimitWait.Round(time.Second))
		time.Sleep(rateLimitWait)
		s.mu.Lock()
		s.apiCallCount = 0
		s.apiCallResetTime = time.Now()
		s.mu.Unlock()
	}

	if minDelayWait > 0 {
		fmt.Printf("Rate limiting: waiting %v...\n", minDelayWait.Round(time.Second))
		time.Sleep(minDelayWait)
	}

	spotifyURL := fmt.Sprintf("https://open.spotify.com/track/%s", spotifyTrackID)
	apiURL := fmt.Sprintf("https://api.song.link/v1-alpha.1/links?url=%s", url.QueryEscape(spotifyURL))
	if region != "" {
		apiURL += fmt.Sprintf("&userCountry=%s", region)
	}

	fmt.Println("Getting streaming URLs from song.link...")

	maxRetries := 3
	var lastStatus int
	var lastErr error

	for i := 0; i < maxRetries; i++ {
		req, err := http.NewRequest("GET", apiURL, nil)
		if err != nil {
			return nil, fmt.Errorf("failed to create request: %w", err)
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36")

		// HTTP call without holding the lock
		resp, err := s.client.Do(req)
		if err != nil {
			lastErr = err
			if i < maxRetries-1 {
				waitTime := time.Duration((i+1)*5) * time.Second
				fmt.Printf("Request failed, waiting %v before retry... (%v)\n", waitTime, err)
				time.Sleep(waitTime)
				continue
			}
			break
		}

		// Brief lock to update API call tracking
		s.mu.Lock()
		s.lastAPICallTime = time.Now()
		s.apiCallCount++
		s.mu.Unlock()

		lastStatus = resp.StatusCode

		if resp.StatusCode == 429 {
			resp.Body.Close()
			if i < maxRetries-1 {
				waitTime := 15 * time.Second
				fmt.Printf("Rate limited by API (429), waiting %v before retry...\n", waitTime)
				time.Sleep(waitTime)
				continue
			}
			lastErr = fmt.Errorf("API rate limit exceeded after %d retries", maxRetries)
			break
		}

		if resp.StatusCode == 400 || resp.StatusCode >= 500 {
			resp.Body.Close()
			if i < maxRetries-1 {
				waitTime := time.Duration((i+1)*10) * time.Second
				fmt.Printf("API returned status %d, waiting %v before retry...\n", resp.StatusCode, waitTime)
				time.Sleep(waitTime)
				continue
			}
			lastErr = fmt.Errorf("API returned status %d after %d retries", resp.StatusCode, maxRetries)
			break
		}

		if resp.StatusCode != 200 {
			resp.Body.Close()
			lastErr = fmt.Errorf("API returned status %d", resp.StatusCode)
			break
		}

		// Success - parse response
		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("failed to read response body: %w", err)
		}

		if len(body) == 0 {
			lastErr = fmt.Errorf("API returned empty response")
			break
		}

		var songLinkResp struct {
			LinksByPlatform map[string]struct {
				URL string `json:"url"`
			} `json:"linksByPlatform"`
		}

		if err := json.Unmarshal(body, &songLinkResp); err != nil {
			bodyStr := string(body)
			if len(bodyStr) > 200 {
				bodyStr = bodyStr[:200] + "..."
			}
			return nil, fmt.Errorf("failed to decode response: %w (response: %s)", err, bodyStr)
		}

		data := &songLinkPlatformData{}

		if tidalLink, ok := songLinkResp.LinksByPlatform["tidal"]; ok && tidalLink.URL != "" {
			data.TidalURL = tidalLink.URL
			fmt.Printf("✓ Tidal URL found\n")
		}

		if amazonLink, ok := songLinkResp.LinksByPlatform["amazonMusic"]; ok && amazonLink.URL != "" {
			data.AmazonURL = amazonLink.URL
			fmt.Printf("✓ Amazon URL found\n")
		}

		if deezerLink, ok := songLinkResp.LinksByPlatform["deezer"]; ok && deezerLink.URL != "" {
			data.DeezerURL = deezerLink.URL
			fmt.Printf("✓ Deezer URL found\n")
			if isrc, err := getDeezerISRC(deezerLink.URL); err == nil && isrc != "" {
				data.ISRC = isrc
			}
		}

		s.setCached(spotifyTrackID, data)
		return data, nil
	}

	// API failed after all retries - try HTML scraping fallback
	fmt.Println("API failed, trying HTML scraping fallback...")
	scraped, scrapeErr := s.scrapeSongLinkHTML(spotifyTrackID)
	if scrapeErr == nil && scraped != nil {
		s.setCached(spotifyTrackID, scraped)
		return scraped, nil
	}

	if lastErr != nil {
		return nil, fmt.Errorf("API failed (status %d): %v, HTML fallback also failed: %v", lastStatus, lastErr, scrapeErr)
	}
	return nil, fmt.Errorf("API failed (status %d), HTML fallback also failed: %v", lastStatus, scrapeErr)
}

// scrapeSongLinkHTML scrapes the song.link HTML page as a fallback when the API is down.
func (s *SongLinkClient) scrapeSongLinkHTML(spotifyTrackID string) (*songLinkPlatformData, error) {
	pageURL := fmt.Sprintf("https://song.link/s/%s", spotifyTrackID)

	req, err := http.NewRequest("GET", pageURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create scrape request: %w", err)
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36")

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch song.link page: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("song.link page returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read song.link page: %w", err)
	}

	html := string(body)
	result := &songLinkPlatformData{}

	tidalRe := regexp.MustCompile(`href="(https?://(?:www\.)?(?:tidal\.com|listen\.tidal\.com)/[^"]+)"`)
	amazonRe := regexp.MustCompile(`href="(https?://(?:www\.)?(?:music\.amazon\.[^"]+|amazon\.[^"/]+/music[^"]*))(?:"|\?)`)
	deezerRe := regexp.MustCompile(`href="(https?://(?:www\.)?deezer\.com/[^"]+)"`)

	if m := tidalRe.FindStringSubmatch(html); len(m) > 1 {
		result.TidalURL = m[1]
		fmt.Printf("✓ Tidal URL found (HTML fallback)\n")
	}
	if m := amazonRe.FindStringSubmatch(html); len(m) > 1 {
		result.AmazonURL = m[1]
		fmt.Printf("✓ Amazon URL found (HTML fallback)\n")
	}
	if m := deezerRe.FindStringSubmatch(html); len(m) > 1 {
		result.DeezerURL = m[1]
		fmt.Printf("✓ Deezer URL found (HTML fallback)\n")
		if isrc, err := getDeezerISRC(m[1]); err == nil && isrc != "" {
			result.ISRC = isrc
		}
	}

	if result.TidalURL == "" && result.AmazonURL == "" && result.DeezerURL == "" {
		return nil, fmt.Errorf("no platform links found in HTML")
	}

	fmt.Println("✓ HTML scraping fallback succeeded")
	return result, nil
}

func (s *SongLinkClient) GetAllURLsFromSpotify(spotifyTrackID string, region string) (*SongLinkURLs, error) {
	data, err := s.fetchSongLinkData(spotifyTrackID, region)
	if err != nil {
		return nil, err
	}

	urls := &SongLinkURLs{
		TidalURL:  data.TidalURL,
		AmazonURL: data.AmazonURL,
		DeezerURL: data.DeezerURL,
		ISRC:      data.ISRC,
	}

	if urls.TidalURL == "" && urls.AmazonURL == "" && urls.DeezerURL == "" && urls.ISRC == "" {
		return nil, fmt.Errorf("no streaming URLs found")
	}

	return urls, nil
}

func (s *SongLinkClient) CheckTrackAvailability(spotifyTrackID string) (*TrackAvailability, error) {
	fmt.Printf("Checking availability for track: %s\n", spotifyTrackID)

	data, err := s.fetchSongLinkData(spotifyTrackID, "")
	if err != nil {
		return nil, err
	}

	availability := &TrackAvailability{
		SpotifyID: spotifyTrackID,
	}

	if data.TidalURL != "" {
		availability.Tidal = true
		availability.TidalURL = data.TidalURL
	}

	if data.AmazonURL != "" {
		availability.Amazon = true
		availability.AmazonURL = data.AmazonURL
	}

	if data.DeezerURL != "" {
		availability.Deezer = true
		availability.DeezerURL = data.DeezerURL

		isrc := data.ISRC
		if isrc == "" {
			isrc, _ = getDeezerISRC(data.DeezerURL)
		}
		if isrc != "" {
			availability.Qobuz = checkQobuzAvailability(isrc)
		}
	}

	return availability, nil
}

func checkQobuzAvailability(isrc string) bool {
	client := &http.Client{Timeout: 10 * time.Second}
	appID := "798273057"

	searchURL := fmt.Sprintf("https://www.qobuz.com/api.json/0.2/track/search?query=%s&limit=1&app_id=%s", isrc, appID)

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
	data, err := s.fetchSongLinkData(spotifyTrackID, "")
	if err != nil {
		return "", err
	}

	if data.DeezerURL == "" {
		return "", fmt.Errorf("deezer link not found")
	}

	fmt.Printf("Found Deezer URL: %s\n", data.DeezerURL)
	return data.DeezerURL, nil
}

func getDeezerISRC(deezerURL string) (string, error) {

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

func (s *SongLinkClient) GetISRC(spotifyID string) (string, error) {
	data, err := s.fetchSongLinkData(spotifyID, "")
	if err != nil {
		return "", err
	}

	if data.ISRC != "" {
		return data.ISRC, nil
	}

	if data.DeezerURL != "" {
		return getDeezerISRC(data.DeezerURL)
	}

	return "", fmt.Errorf("could not resolve ISRC for track %s", spotifyID)
}
