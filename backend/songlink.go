package backend

import (
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const songLinkUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"

var (
	errSongLinkRateLimited = errors.New("song.link rate limited")
	isrcPattern            = regexp.MustCompile(`\b([A-Z]{2}[A-Z0-9]{3}\d{7})\b`)
	csrfTokenPattern       = regexp.MustCompile(`name=["']csrfmiddlewaretoken["'][^>]*value=["']([^"']+)["']`)
	songstatsScriptPattern = regexp.MustCompile(`(?is)<script[^>]+type=["']application/ld\+json["'][^>]*>(.*?)</script>`)
	amazonAlbumTrackPath   = regexp.MustCompile(`/albums/[A-Z0-9]{10}/(B[0-9A-Z]{9})`)
	amazonTrackPath        = regexp.MustCompile(`/tracks/(B[0-9A-Z]{9})`)
)

type SongLinkClient struct {
	client *http.Client
}

type SongLinkURLs struct {
	TidalURL  string `json:"tidal_url"`
	AmazonURL string `json:"amazon_url"`
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

type resolvedTrackLinks struct {
	TidalURL  string
	AmazonURL string
	DeezerURL string
	ISRC      string
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
		urls.ISRC = links.ISRC
	}

	if urls.TidalURL == "" && urls.AmazonURL == "" {
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
		if deezerISRC, deezerErr := getDeezerISRC(availability.DeezerURL); deezerErr == nil {
			isrc = deezerISRC
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

func (s *SongLinkClient) resolveSpotifyTrackLinks(spotifyTrackID string, region string) (*resolvedTrackLinks, error) {
	links := &resolvedTrackLinks{}
	var attempts []string

	spotifyURL := fmt.Sprintf("https://open.spotify.com/track/%s", spotifyTrackID)

	fmt.Println("Getting streaming URLs from song.link...")
	resp, err := s.fetchSongLinkLinksByURL(spotifyURL, region)
	if err == nil {
		mergeSongLinkResponse(links, resp)
		if links.DeezerURL != "" && links.ISRC == "" {
			if isrc, deezerErr := getDeezerISRC(links.DeezerURL); deezerErr == nil {
				links.ISRC = isrc
			}
		}
		if hasAnySongLinkData(links) {
			return links, nil
		}
		attempts = append(attempts, "song.link spotify: no links found")
	} else {
		if errors.Is(err, errSongLinkRateLimited) {
			fmt.Println("song.link rate limited for Spotify URL, switching to fallback 1 (songstats)...")
		} else {
			fmt.Printf("song.link primary lookup failed: %v\n", err)
		}
		attempts = append(attempts, fmt.Sprintf("song.link spotify: %v", err))
	}

	isrc, lookupErr := s.lookupSpotifyISRC(spotifyTrackID)
	if lookupErr != nil {
		attempts = append(attempts, fmt.Sprintf("isrc lookup: %v", lookupErr))
	} else {
		links.ISRC = isrc
	}

	if links.ISRC != "" {
		fmt.Printf("Fallback 1: fetching Songstats links for ISRC %s\n", links.ISRC)
		if songstatsErr := s.populateLinksFromSongstats(links, links.ISRC); songstatsErr != nil {
			attempts = append(attempts, fmt.Sprintf("songstats: %v", songstatsErr))
		} else if links.TidalURL != "" && links.AmazonURL != "" {
			return links, nil
		}

		fmt.Printf("Fallback 2: resolving Deezer track from ISRC %s\n", links.ISRC)
		deezerURL, deezerErr := s.lookupDeezerTrackURLByISRC(links.ISRC)
		if deezerErr != nil {
			attempts = append(attempts, fmt.Sprintf("deezer isrc: %v", deezerErr))
		} else {
			if links.DeezerURL == "" {
				links.DeezerURL = deezerURL
			}
			deezerResp, deezerSongLinkErr := s.fetchSongLinkLinksByURL(deezerURL, region)
			if deezerSongLinkErr != nil {
				attempts = append(attempts, fmt.Sprintf("song.link deezer: %v", deezerSongLinkErr))
			} else {
				mergeSongLinkResponse(links, deezerResp)
			}
		}
	}

	if hasAnySongLinkData(links) {
		return links, nil
	}

	if len(attempts) == 0 {
		attempts = append(attempts, "no streaming URLs found")
	}

	return links, errors.New(strings.Join(attempts, " | "))
}

func (s *SongLinkClient) fetchSongLinkLinksByURL(rawURL string, region string) (*songLinkAPIResponse, error) {
	apiURL := fmt.Sprintf("https://api.song.link/v1-alpha.1/links?url=%s", url.QueryEscape(rawURL))
	if region != "" {
		apiURL += fmt.Sprintf("&userCountry=%s", url.QueryEscape(region))
	}

	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("User-Agent", songLinkUserAgent)

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to call song.link: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, errSongLinkRateLimited
	}
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

func (s *SongLinkClient) lookupSpotifyISRC(spotifyTrackID string) (string, error) {
	spotifyURL := fmt.Sprintf("https://open.spotify.com/track/%s", spotifyTrackID)

	providers := []struct {
		name string
		fn   func(string) (string, error)
	}{
		{name: "isrcfinder", fn: s.lookupISRCViaISRCFinder},
		{name: "phpstack", fn: lookupISRCViaPHPStack},
		{name: "findmyisrc", fn: lookupISRCViaFindMyISRC},
		{name: "mixvibe", fn: lookupISRCViaMixvibe},
	}

	var errorsList []string
	for _, provider := range providers {
		fmt.Printf("Trying ISRC provider: %s\n", provider.name)
		isrc, err := provider.fn(spotifyURL)
		if err == nil && isrc != "" {
			fmt.Printf("Found ISRC via %s: %s\n", provider.name, isrc)
			return isrc, nil
		}

		if err != nil {
			errorsList = append(errorsList, fmt.Sprintf("%s: %v", provider.name, err))
		} else {
			errorsList = append(errorsList, fmt.Sprintf("%s: no ISRC found", provider.name))
		}
	}

	return "", errors.New(strings.Join(errorsList, " | "))
}

func (s *SongLinkClient) lookupISRCViaISRCFinder(spotifyURL string) (string, error) {
	jar, err := cookiejar.New(nil)
	if err != nil {
		return "", fmt.Errorf("failed to create cookie jar: %w", err)
	}

	client := &http.Client{
		Timeout: 20 * time.Second,
		Jar:     jar,
	}

	req, err := http.NewRequest("GET", "https://www.isrcfinder.com/", nil)
	if err != nil {
		return "", fmt.Errorf("failed to create GET request: %w", err)
	}
	req.Header.Set("User-Agent", songLinkUserAgent)
	req.Header.Set("Referer", "https://www.isrcfinder.com/")
	req.Header.Set("Origin", "https://www.isrcfinder.com")

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to load isrcfinder: %w", err)
	}
	body, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		return "", fmt.Errorf("failed to read isrcfinder response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("isrcfinder returned status %d", resp.StatusCode)
	}

	token := extractCSRFToken(string(body))
	if token == "" {
		if parsedURL, parseErr := url.Parse("https://www.isrcfinder.com/"); parseErr == nil {
			for _, cookie := range jar.Cookies(parsedURL) {
				if cookie.Name == "csrftoken" {
					token = cookie.Value
					break
				}
			}
		}
	}
	if token == "" {
		return "", fmt.Errorf("csrf token not found")
	}

	form := url.Values{}
	form.Set("csrfmiddlewaretoken", token)
	form.Set("URI", spotifyURL)

	postReq, err := http.NewRequest("POST", "https://www.isrcfinder.com/", strings.NewReader(form.Encode()))
	if err != nil {
		return "", fmt.Errorf("failed to create POST request: %w", err)
	}
	postReq.Header.Set("User-Agent", songLinkUserAgent)
	postReq.Header.Set("Referer", "https://www.isrcfinder.com/")
	postReq.Header.Set("Origin", "https://www.isrcfinder.com")
	postReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	postResp, err := client.Do(postReq)
	if err != nil {
		return "", fmt.Errorf("failed to submit isrcfinder form: %w", err)
	}
	postBody, err := io.ReadAll(postResp.Body)
	postResp.Body.Close()
	if err != nil {
		return "", fmt.Errorf("failed to read isrcfinder POST response: %w", err)
	}
	if postResp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("isrcfinder POST returned status %d", postResp.StatusCode)
	}

	isrc := firstISRCMatch(string(postBody))
	if isrc == "" {
		return "", fmt.Errorf("ISRC not found in isrcfinder response")
	}

	return isrc, nil
}

func lookupISRCViaPHPStack(spotifyURL string) (string, error) {
	apiURL := fmt.Sprintf(
		"https://phpstack-822472-6184058.cloudwaysapps.com/api/spotify.php?q=%s",
		url.QueryEscape(spotifyURL),
	)

	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("User-Agent", songLinkUserAgent)
	req.Header.Set("Referer", "https://phpstack-822472-6184058.cloudwaysapps.com/?")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("phpstack request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("phpstack returned status %d", resp.StatusCode)
	}

	var payload struct {
		ISRC string `json:"isrc"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return "", fmt.Errorf("failed to decode phpstack response: %w", err)
	}
	if payload.ISRC == "" {
		return "", fmt.Errorf("ISRC missing in phpstack response")
	}

	return strings.ToUpper(strings.TrimSpace(payload.ISRC)), nil
}

func lookupISRCViaFindMyISRC(spotifyURL string) (string, error) {
	payloadBytes, err := json.Marshal(map[string][]string{
		"uris": []string{spotifyURL},
	})
	if err != nil {
		return "", fmt.Errorf("failed to encode payload: %w", err)
	}

	req, err := http.NewRequest(
		"POST",
		"https://lxtzsnh4l3.execute-api.ap-southeast-2.amazonaws.com/prod/find-my-isrc",
		strings.NewReader(string(payloadBytes)),
	)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("User-Agent", songLinkUserAgent)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://www.findmyisrc.com")
	req.Header.Set("Referer", "https://www.findmyisrc.com/")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("findmyisrc request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("findmyisrc returned status %d", resp.StatusCode)
	}

	var payload []struct {
		Data struct {
			ISRC string `json:"isrc"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return "", fmt.Errorf("failed to decode findmyisrc response: %w", err)
	}

	for _, item := range payload {
		if item.Data.ISRC != "" {
			return strings.ToUpper(strings.TrimSpace(item.Data.ISRC)), nil
		}
	}

	return "", fmt.Errorf("ISRC missing in findmyisrc response")
}

func lookupISRCViaMixvibe(spotifyURL string) (string, error) {
	payloadBytes, err := json.Marshal(map[string]string{
		"url": spotifyURL,
	})
	if err != nil {
		return "", fmt.Errorf("failed to encode payload: %w", err)
	}

	req, err := http.NewRequest(
		"POST",
		"https://tools.mixviberecords.com/api/find-isrc",
		strings.NewReader(string(payloadBytes)),
	)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("User-Agent", songLinkUserAgent)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://tools.mixviberecords.com")
	req.Header.Set("Referer", "https://tools.mixviberecords.com/isrc-finder")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("mixvibe request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read mixvibe response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("mixvibe returned status %d", resp.StatusCode)
	}

	var payload interface{}
	if err := json.Unmarshal(body, &payload); err == nil {
		if isrc := findISRCInValue(payload); isrc != "" {
			return isrc, nil
		}
	}

	if isrc := firstISRCMatch(string(body)); isrc != "" {
		return isrc, nil
	}

	return "", fmt.Errorf("ISRC missing in mixvibe response")
}

func (s *SongLinkClient) populateLinksFromSongstats(links *resolvedTrackLinks, isrc string) error {
	pageURL := fmt.Sprintf("https://songstats.com/%s?ref=ISRCFinder", strings.ToUpper(strings.TrimSpace(isrc)))

	req, err := http.NewRequest("GET", pageURL, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("User-Agent", songLinkUserAgent)

	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to fetch Songstats page: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("Songstats returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read Songstats response: %w", err)
	}

	matches := songstatsScriptPattern.FindAllStringSubmatch(string(body), -1)
	if len(matches) == 0 {
		return fmt.Errorf("Songstats JSON-LD not found")
	}

	found := false
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}

		scriptBody := strings.TrimSpace(html.UnescapeString(match[1]))
		if scriptBody == "" {
			continue
		}

		var payload interface{}
		if err := json.Unmarshal([]byte(scriptBody), &payload); err != nil {
			continue
		}

		before := *links
		collectSongstatsLinks(payload, links)
		if *links != before {
			found = true
		}
	}

	if !found && !hasAnySongLinkData(links) {
		return fmt.Errorf("no platform links found in Songstats")
	}

	return nil
}

func (s *SongLinkClient) lookupDeezerTrackURLByISRC(isrc string) (string, error) {
	apiURL := fmt.Sprintf("https://api.deezer.com/track/isrc:%s", strings.ToUpper(strings.TrimSpace(isrc)))

	req, err := http.NewRequest("GET", apiURL, nil)
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

func collectSongstatsLinks(value interface{}, links *resolvedTrackLinks) {
	switch typed := value.(type) {
	case map[string]interface{}:
		if sameAs, ok := typed["sameAs"]; ok {
			applySongstatsSameAs(sameAs, links)
		}
		for _, nested := range typed {
			collectSongstatsLinks(nested, links)
		}
	case []interface{}:
		for _, nested := range typed {
			collectSongstatsLinks(nested, links)
		}
	}
}

func applySongstatsSameAs(value interface{}, links *resolvedTrackLinks) {
	switch typed := value.(type) {
	case string:
		assignSongstatsLink(typed, links)
	case []interface{}:
		for _, item := range typed {
			if link, ok := item.(string); ok {
				assignSongstatsLink(link, links)
			}
		}
	}
}

func assignSongstatsLink(rawLink string, links *resolvedTrackLinks) {
	link := strings.TrimSpace(rawLink)
	if link == "" {
		return
	}

	switch {
	case strings.Contains(link, "listen.tidal.com/track"):
		if links.TidalURL == "" {
			links.TidalURL = link
			fmt.Println("✓ Tidal URL found via Songstats")
		}
	case strings.Contains(link, "music.amazon.com"):
		if links.AmazonURL == "" {
			if normalized := normalizeAmazonMusicURL(link); normalized != "" {
				links.AmazonURL = normalized
				fmt.Println("✓ Amazon URL found via Songstats")
			}
		}
	case strings.Contains(link, "deezer.com"):
		if links.DeezerURL == "" {
			links.DeezerURL = normalizeDeezerTrackURL(link)
			fmt.Println("✓ Deezer URL found via Songstats")
		}
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

func extractCSRFToken(body string) string {
	match := csrfTokenPattern.FindStringSubmatch(body)
	if len(match) < 2 {
		return ""
	}
	return strings.TrimSpace(match[1])
}

func firstISRCMatch(body string) string {
	match := isrcPattern.FindStringSubmatch(strings.ToUpper(body))
	if len(match) < 2 {
		return ""
	}
	return strings.TrimSpace(match[1])
}

func findISRCInValue(value interface{}) string {
	switch typed := value.(type) {
	case map[string]interface{}:
		for key, nested := range typed {
			if strings.EqualFold(key, "isrc") {
				if isrc, ok := nested.(string); ok {
					if normalized := firstISRCMatch(isrc); normalized != "" {
						return normalized
					}
				}
			}
			if isrc := findISRCInValue(nested); isrc != "" {
				return isrc
			}
		}
	case []interface{}:
		for _, nested := range typed {
			if isrc := findISRCInValue(nested); isrc != "" {
				return isrc
			}
		}
	case string:
		return firstISRCMatch(typed)
	}

	return ""
}
