package backend

import (
	"encoding/base64"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type TidalDownloader struct {
	client       *http.Client
	timeout      time.Duration
	maxRetries   int
	clientID     string
	clientSecret string
	apiURL       string
}

type TidalSearchResponse struct {
	Limit              int          `json:"limit"`
	Offset             int          `json:"offset"`
	TotalNumberOfItems int          `json:"totalNumberOfItems"`
	Items              []TidalTrack `json:"items"`
}

type TidalTrack struct {
	ID           int64  `json:"id"`
	Title        string `json:"title"`
	ISRC         string `json:"isrc"`
	AudioQuality string `json:"audioQuality"`
	TrackNumber  int    `json:"trackNumber"`
	VolumeNumber int    `json:"volumeNumber"`
	Duration     int    `json:"duration"`
	Copyright    string `json:"copyright"`
	Explicit     bool   `json:"explicit"`
	Album        struct {
		Title       string `json:"title"`
		Cover       string `json:"cover"`
		ReleaseDate string `json:"releaseDate"`
	} `json:"album"`
	Artists []struct {
		Name string `json:"name"`
	} `json:"artists"`
	Artist struct {
		Name string `json:"name"`
	} `json:"artist"`
	MediaMetadata struct {
		Tags []string `json:"tags"`
	} `json:"mediaMetadata"`
}

type TidalAPIResponse struct {
	OriginalTrackURL string `json:"OriginalTrackUrl"`
}

// TidalAPIResponseV2 is the new API response format (version 2.0)
type TidalAPIResponseV2 struct {
	Version string `json:"version"`
	Data    struct {
		TrackID           int64  `json:"trackId"`
		AssetPresentation string `json:"assetPresentation"`
		AudioMode         string `json:"audioMode"`
		AudioQuality      string `json:"audioQuality"`
		ManifestMimeType  string `json:"manifestMimeType"`
		ManifestHash      string `json:"manifestHash"`
		Manifest          string `json:"manifest"`
		BitDepth          int    `json:"bitDepth"`
		SampleRate        int    `json:"sampleRate"`
	} `json:"data"`
}

type TidalAPIInfo struct {
	URL    string `json:"url"`
	Status string `json:"status"`
}

// TidalBTSManifest is the BTS (application/vnd.tidal.bts) manifest format
type TidalBTSManifest struct {
	MimeType       string   `json:"mimeType"`
	Codecs         string   `json:"codecs"`
	EncryptionType string   `json:"encryptionType"`
	URLs           []string `json:"urls"`
}

func NewTidalDownloader(apiURL string) *TidalDownloader {
	clientID, _ := base64.StdEncoding.DecodeString("NkJEU1JkcEs5aHFFQlRnVQ==")
	clientSecret, _ := base64.StdEncoding.DecodeString("eGV1UG1ZN25icFo5SUliTEFjUTkzc2hrYTFWTmhlVUFxTjZJY3N6alRHOD0=")

	// If apiURL is empty, try to get first available API
	if apiURL == "" {
		downloader := &TidalDownloader{
			client: &http.Client{
				Timeout: 5 * time.Second,
			},
			timeout:      5 * time.Second,
			maxRetries:   3,
			clientID:     string(clientID),
			clientSecret: string(clientSecret),
			apiURL:       "",
		}

		// Try to get available APIs
		apis, err := downloader.GetAvailableAPIs()
		if err == nil && len(apis) > 0 {
			apiURL = apis[0]
		}
	}

	return &TidalDownloader{
		client: &http.Client{
			Timeout: 5 * time.Second,
		},
		timeout:      5 * time.Second,
		maxRetries:   3,
		clientID:     string(clientID),
		clientSecret: string(clientSecret),
		apiURL:       apiURL,
	}
}

func (t *TidalDownloader) GetAvailableAPIs() ([]string, error) {
	// Hardcoded API URLs (base64 encoded for obfuscation)
	encodedAPIs := []string{
		"dm9nZWwucXFkbC5zaXRl",         // API 1
		"bWF1cy5xcWRsLnNpdGU=",         // API 2
		"aHVuZC5xcWRsLnNpdGU=",         // API 3
		"a2F0emUucXFkbC5zaXRl",         // API 4
		"d29sZi5xcWRsLnNpdGU=",         // API 5
		"dGlkYWwua2lub3BsdXMub25saW5l", // API 6
		"dGlkYWwtYXBpLmJpbmltdW0ub3Jn", // API 7
		"dHJpdG9uLnNxdWlkLnd0Zg==",     // API 8
	}

	var apis []string
	for _, encoded := range encodedAPIs {
		decoded, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			continue
		}
		apis = append(apis, "https://"+string(decoded))
	}

	return apis, nil
}

func (t *TidalDownloader) GetAccessToken() (string, error) {
	data := fmt.Sprintf("client_id=%s&grant_type=client_credentials", t.clientID)

	// Decode base64 API URL
	authURL, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly9hdXRoLnRpZGFsLmNvbS92MS9vYXV0aDIvdG9rZW4=")
	req, err := http.NewRequest("POST", string(authURL), strings.NewReader(data))
	if err != nil {
		return "", err
	}

	req.SetBasicAuth(t.clientID, t.clientSecret)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := t.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("failed to get access token: HTTP %d", resp.StatusCode)
	}

	var result struct {
		AccessToken string `json:"access_token"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}

	return result.AccessToken, nil
}

// SearchTracks searches for tracks on Tidal with configurable limit
func (t *TidalDownloader) SearchTracks(query string) (*TidalSearchResponse, error) {
	return t.SearchTracksWithLimit(query, 50) // Default to 50 results for better matching
}

// SearchTracksWithLimit searches for tracks on Tidal with a specific limit
func (t *TidalDownloader) SearchTracksWithLimit(query string, limit int) (*TidalSearchResponse, error) {
	token, err := t.GetAccessToken()
	if err != nil {
		return nil, fmt.Errorf("failed to get access token: %w", err)
	}

	// Decode base64 API URL and encode the query parameter
	searchBase, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly9hcGkudGlkYWwuY29tL3YxL3NlYXJjaC90cmFja3M/cXVlcnk9")
	searchURL := fmt.Sprintf("%s%s&limit=%d&offset=0&countryCode=US", string(searchBase), url.QueryEscape(query), limit)

	req, err := http.NewRequest("GET", searchURL, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := t.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("search failed: HTTP %d - %s", resp.StatusCode, string(body))
	}

	var result TidalSearchResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	return &result, nil
}

// SearchTrackByMetadata searches for a track using artist name and track name
// It tries multiple search strategies including romaji conversion for Japanese text
// Now accepts ISRC for exact matching
func (t *TidalDownloader) SearchTrackByMetadata(trackName, artistName string, expectedDuration int) (*TidalTrack, error) {
	return t.SearchTrackByMetadataWithISRC(trackName, artistName, "", expectedDuration)
}

// SearchTrackByMetadataWithISRC searches for a track with ISRC matching priority
func (t *TidalDownloader) SearchTrackByMetadataWithISRC(trackName, artistName, spotifyISRC string, expectedDuration int) (*TidalTrack, error) {
	// Build search queries - multiple strategies
	queries := []string{}

	// Strategy 1: Artist + Track name (original)
	if artistName != "" && trackName != "" {
		queries = append(queries, artistName+" "+trackName)
	}

	// Strategy 2: Track name only (sometimes works better)
	if trackName != "" {
		queries = append(queries, trackName)
	}

	// Strategy 3: Romaji versions if Japanese detected
	if ContainsJapanese(trackName) || ContainsJapanese(artistName) {
		// Convert to romaji (hiragana/katakana only, kanji stays)
		romajiTrack := JapaneseToRomaji(trackName)
		romajiArtist := JapaneseToRomaji(artistName)

		// Clean and remove ALL non-ASCII characters (including kanji)
		cleanRomajiTrack := cleanToASCII(romajiTrack)
		cleanRomajiArtist := cleanToASCII(romajiArtist)

		// Artist + Track romaji (cleaned to ASCII only)
		if cleanRomajiArtist != "" && cleanRomajiTrack != "" {
			romajiQuery := cleanRomajiArtist + " " + cleanRomajiTrack
			if !containsQuery(queries, romajiQuery) {
				queries = append(queries, romajiQuery)
				fmt.Printf("Japanese detected, adding romaji query: %s\n", romajiQuery)
			}
		}

		// Track romaji only (cleaned)
		if cleanRomajiTrack != "" && cleanRomajiTrack != trackName {
			if !containsQuery(queries, cleanRomajiTrack) {
				queries = append(queries, cleanRomajiTrack)
			}
		}

		// Also try with partial romaji (artist + cleaned track)
		if artistName != "" && cleanRomajiTrack != "" {
			partialQuery := artistName + " " + cleanRomajiTrack
			if !containsQuery(queries, partialQuery) {
				queries = append(queries, partialQuery)
			}
		}
	}

	// Strategy 4: Artist only as last resort
	if artistName != "" {
		artistOnly := cleanToASCII(JapaneseToRomaji(artistName))
		if artistOnly != "" && !containsQuery(queries, artistOnly) {
			queries = append(queries, artistOnly)
		}
	}

	// Collect all search results from all queries
	var allTracks []TidalTrack
	searchedQueries := make(map[string]bool)

	for _, query := range queries {
		cleanQuery := strings.TrimSpace(query)
		if cleanQuery == "" || searchedQueries[cleanQuery] {
			continue
		}
		searchedQueries[cleanQuery] = true

		fmt.Printf("Searching Tidal for: %s\n", cleanQuery)

		result, err := t.SearchTracksWithLimit(cleanQuery, 100) // Get more results
		if err != nil {
			fmt.Printf("Search error for '%s': %v\n", cleanQuery, err)
			continue
		}

		if len(result.Items) > 0 {
			fmt.Printf("Found %d results for '%s'\n", len(result.Items), cleanQuery)
			allTracks = append(allTracks, result.Items...)
		}
	}

	if len(allTracks) == 0 {
		return nil, fmt.Errorf("no tracks found for any search query")
	}

	// Priority 1: Match by ISRC (exact match)
	if spotifyISRC != "" {
		fmt.Printf("Looking for ISRC match: %s\n", spotifyISRC)
		for i := range allTracks {
			track := &allTracks[i]
			if track.ISRC == spotifyISRC {
				fmt.Printf("✓ ISRC match found: %s - %s (ISRC: %s, Quality: %s)\n",
					track.Artist.Name, track.Title, track.ISRC, track.AudioQuality)
				return track, nil
			}
		}
		fmt.Printf("No exact ISRC match found, trying other matching methods...\n")
	}

	// If ISRC was provided but no match found, return error - don't download wrong track
	if spotifyISRC != "" {
		fmt.Printf("✗ No ISRC match found for: %s\n", spotifyISRC)
		fmt.Printf("  Available ISRCs from search results:\n")
		// Show first 5 results for debugging
		for i, track := range allTracks {
			if i >= 5 {
				fmt.Printf("  ... and %d more results\n", len(allTracks)-5)
				break
			}
			fmt.Printf("  - %s - %s (ISRC: %s)\n", track.Artist.Name, track.Title, track.ISRC)
		}
		return nil, fmt.Errorf("ISRC mismatch: no track found with ISRC %s on Tidal", spotifyISRC)
	}

	// Only proceed without ISRC matching if no ISRC was provided
	// Priority 2: Match by duration (within tolerance) + prefer best quality
	var bestMatch *TidalTrack
	if expectedDuration > 0 {
		tolerance := 3 // 3 seconds tolerance
		var durationMatches []*TidalTrack

		for i := range allTracks {
			track := &allTracks[i]
			durationDiff := track.Duration - expectedDuration
			if durationDiff < 0 {
				durationDiff = -durationDiff
			}
			if durationDiff <= tolerance {
				durationMatches = append(durationMatches, track)
			}
		}

		if len(durationMatches) > 0 {
			// Find best quality among duration matches
			bestMatch = durationMatches[0]
			for _, track := range durationMatches {
				for _, tag := range track.MediaMetadata.Tags {
					if tag == "HIRES_LOSSLESS" {
						bestMatch = track
						break
					}
				}
			}
			fmt.Printf("Found via duration match: %s - %s (%s)\n",
				bestMatch.Artist.Name, bestMatch.Title, bestMatch.AudioQuality)
			return bestMatch, nil
		}
	}

	// Priority 3: Just take the best quality from first results (only when no ISRC provided)
	bestMatch = &allTracks[0]
	for i := range allTracks {
		track := &allTracks[i]
		for _, tag := range track.MediaMetadata.Tags {
			if tag == "HIRES_LOSSLESS" {
				bestMatch = track
				break
			}
		}
		if bestMatch != &allTracks[0] {
			break // Found HIRES_LOSSLESS
		}
	}

	fmt.Printf("Found via search (no ISRC provided): %s - %s (ISRC: %s, Quality: %s)\n",
		bestMatch.Artist.Name, bestMatch.Title, bestMatch.ISRC, bestMatch.AudioQuality)

	return bestMatch, nil
}

// containsQuery checks if a query already exists in the list
func containsQuery(queries []string, query string) bool {
	for _, q := range queries {
		if q == query {
			return true
		}
	}
	return false
}

func (t *TidalDownloader) GetTidalURLFromSpotify(spotifyTrackID string) (string, error) {
	// Decode base64 API URL
	spotifyBase, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly9vcGVuLnNwb3RpZnkuY29tL3RyYWNrLw==")
	spotifyURL := fmt.Sprintf("%s%s", string(spotifyBase), spotifyTrackID)

	apiBase, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly9hcGkuc29uZy5saW5rL3YxLWFscGhhLjEvbGlua3M/dXJsPQ==")
	apiURL := fmt.Sprintf("%s%s", string(apiBase), url.QueryEscape(spotifyURL))

	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	fmt.Println("Getting Tidal URL...")

	resp, err := t.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to get Tidal URL: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("API returned status %d", resp.StatusCode)
	}

	var songLinkResp struct {
		LinksByPlatform map[string]struct {
			URL string `json:"url"`
		} `json:"linksByPlatform"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&songLinkResp); err != nil {
		return "", fmt.Errorf("failed to decode response: %w", err)
	}

	tidalLink, ok := songLinkResp.LinksByPlatform["tidal"]
	if !ok || tidalLink.URL == "" {
		return "", fmt.Errorf("tidal link not found")
	}

	tidalURL := tidalLink.URL
	fmt.Printf("Found Tidal URL: %s\n", tidalURL)
	return tidalURL, nil
}

func (t *TidalDownloader) GetTrackIDFromURL(tidalURL string) (int64, error) {
	// Extract track ID from Tidal URL
	// Format: https://listen.tidal.com/track/441821360
	// or: https://tidal.com/browse/track/123456789
	parts := strings.Split(tidalURL, "/track/")
	if len(parts) < 2 {
		return 0, fmt.Errorf("invalid tidal URL format")
	}

	// Get the track ID part and remove any query parameters
	trackIDStr := strings.Split(parts[1], "?")[0]
	trackIDStr = strings.TrimSpace(trackIDStr)

	var trackID int64
	_, err := fmt.Sscanf(trackIDStr, "%d", &trackID)
	if err != nil {
		return 0, fmt.Errorf("failed to parse track ID: %w", err)
	}

	return trackID, nil
}

func (t *TidalDownloader) GetTrackInfoByID(trackID int64) (*TidalTrack, error) {
	token, err := t.GetAccessToken()
	if err != nil {
		return nil, fmt.Errorf("failed to get access token: %w", err)
	}

	// Decode base64 API URL
	trackBase, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly9hcGkudGlkYWwuY29tL3YxL3RyYWNrcy8=")
	trackURL := fmt.Sprintf("%s%d?countryCode=US", string(trackBase), trackID)

	req, err := http.NewRequest("GET", trackURL, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := t.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get track info: HTTP %d - %s", resp.StatusCode, string(body))
	}

	var trackInfo TidalTrack
	if err := json.NewDecoder(resp.Body).Decode(&trackInfo); err != nil {
		return nil, err
	}

	fmt.Printf("Found: %s (%s)\n", trackInfo.Title, trackInfo.AudioQuality)
	return &trackInfo, nil
}

func (t *TidalDownloader) GetDownloadURL(trackID int64, quality string) (string, error) {
	fmt.Println("Fetching URL...")

	url := fmt.Sprintf("%s/track/?id=%d&quality=%s", t.apiURL, trackID, quality)
	fmt.Printf("Tidal API URL: %s\n", url)

	resp, err := t.client.Get(url)
	if err != nil {
		fmt.Printf("✗ Tidal API request failed: %v\n", err)
		return "", fmt.Errorf("failed to get download URL: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		fmt.Printf("✗ Tidal API returned status code: %d\n", resp.StatusCode)
		return "", fmt.Errorf("API returned status code: %d", resp.StatusCode)
	}

	// Read body to try both formats
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		fmt.Printf("✗ Failed to read response body: %v\n", err)
		return "", fmt.Errorf("failed to read response: %w", err)
	}

	// Try v2 format first (object with manifest)
	var v2Response TidalAPIResponseV2
	if err := json.Unmarshal(body, &v2Response); err == nil && v2Response.Data.Manifest != "" {
		fmt.Println("✓ Tidal manifest found (v2 API)")
		return "MANIFEST:" + v2Response.Data.Manifest, nil
	}

	// Fallback to v1 format (array with OriginalTrackUrl)
	var apiResponses []TidalAPIResponse
	if err := json.Unmarshal(body, &apiResponses); err != nil {
		// Truncate body for error message (max 200 chars)
		bodyStr := string(body)
		if len(bodyStr) > 200 {
			bodyStr = bodyStr[:200] + "..."
		}
		fmt.Printf("✗ Failed to decode Tidal API response: %v (response: %s)\n", err, bodyStr)
		return "", fmt.Errorf("failed to decode response: %w (response: %s)", err, bodyStr)
	}

	if len(apiResponses) == 0 {
		fmt.Println("✗ Tidal API returned empty response")
		return "", fmt.Errorf("no download URL in response")
	}

	for _, item := range apiResponses {
		if item.OriginalTrackURL != "" {
			fmt.Println("✓ Tidal download URL found")
			return item.OriginalTrackURL, nil
		}
	}

	fmt.Println("✗ No valid download URL in Tidal API response")
	return "", fmt.Errorf("download URL not found in response")
}

func (t *TidalDownloader) DownloadAlbumArt(albumID string) ([]byte, error) {
	albumID = strings.ReplaceAll(albumID, "-", "/")
	// Decode base64 API URL
	imageBase, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly9yZXNvdXJjZXMudGlkYWwuY29tL2ltYWdlcy8=")
	artURL := fmt.Sprintf("%s%s/1280x1280.jpg", string(imageBase), albumID)

	resp, err := t.client.Get(artURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("failed to download album art: HTTP %d", resp.StatusCode)
	}

	return io.ReadAll(resp.Body)
}

func (t *TidalDownloader) DownloadFile(url, filepath string) error {
	// Check if this is a manifest-based download
	if strings.HasPrefix(url, "MANIFEST:") {
		return t.DownloadFromManifest(strings.TrimPrefix(url, "MANIFEST:"), filepath)
	}

	resp, err := t.client.Get(url)

	if err != nil {
		return fmt.Errorf("failed to download file: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("download failed with status %d", resp.StatusCode)
	}

	out, err := os.Create(filepath)
	if err != nil {
		return fmt.Errorf("failed to create file: %w", err)
	}
	defer out.Close()

	// Use progress writer to track download
	pw := NewProgressWriter(out)
	_, err = io.Copy(pw, resp.Body)
	if err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}

	// Print final size
	fmt.Printf("\rDownloaded: %.2f MB (Complete)\n", float64(pw.GetTotal())/(1024*1024))

	fmt.Println("Download complete")
	return nil
}

// DownloadFromManifest downloads audio from manifest (supports BTS and DASH formats)
func (t *TidalDownloader) DownloadFromManifest(manifestB64, outputPath string) error {
	directURL, initURL, mediaURLs, err := parseManifest(manifestB64)
	if err != nil {
		return fmt.Errorf("failed to parse manifest: %w", err)
	}

	// Create HTTP client with longer timeout
	client := &http.Client{
		Timeout: 120 * time.Second,
	}

	// If we have a direct URL (BTS format), download directly
	if directURL != "" {
		fmt.Println("Downloading file...")

		resp, err := client.Get(directURL)
		if err != nil {
			return fmt.Errorf("failed to download file: %w", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != 200 {
			return fmt.Errorf("download failed with status %d", resp.StatusCode)
		}

		out, err := os.Create(outputPath)
		if err != nil {
			return fmt.Errorf("failed to create file: %w", err)
		}
		defer out.Close()

		// Use progress writer to track download
		pw := NewProgressWriter(out)
		_, err = io.Copy(pw, resp.Body)
		if err != nil {
			return fmt.Errorf("failed to write file: %w", err)
		}

		fmt.Printf("\rDownloaded: %.2f MB (Complete)\n", float64(pw.GetTotal())/(1024*1024))
		fmt.Println("Download complete")
		return nil
	}

	// DASH format - download segments to temporary M4A file, then remux to FLAC
	fmt.Printf("Downloading %d segments...\n", len(mediaURLs)+1)

	// Create temporary file for M4A segments
	tempPath := outputPath + ".m4a.tmp"
	out, err := os.Create(tempPath)
	if err != nil {
		return fmt.Errorf("failed to create temp file: %w", err)
	}

	// Download initialization segment
	fmt.Print("Downloading init segment... ")
	resp, err := client.Get(initURL)
	if err != nil {
		out.Close()
		os.Remove(tempPath)
		return fmt.Errorf("failed to download init segment: %w", err)
	}
	if resp.StatusCode != 200 {
		resp.Body.Close()
		out.Close()
		os.Remove(tempPath)
		return fmt.Errorf("init segment download failed with status %d", resp.StatusCode)
	}
	_, err = io.Copy(out, resp.Body)
	resp.Body.Close()
	if err != nil {
		out.Close()
		os.Remove(tempPath)
		return fmt.Errorf("failed to write init segment: %w", err)
	}
	fmt.Println("OK")

	// Download media segments with progress tracking
	totalSegments := len(mediaURLs)
	var totalBytes int64
	lastTime := time.Now()
	var lastBytes int64
	for i, mediaURL := range mediaURLs {
		resp, err := client.Get(mediaURL)
		if err != nil {
			out.Close()
			os.Remove(tempPath)
			return fmt.Errorf("failed to download segment %d: %w", i+1, err)
		}
		if resp.StatusCode != 200 {
			resp.Body.Close()
			out.Close()
			os.Remove(tempPath)
			return fmt.Errorf("segment %d download failed with status %d", i+1, resp.StatusCode)
		}
		n, err := io.Copy(out, resp.Body)
		totalBytes += n
		resp.Body.Close()
		if err != nil {
			out.Close()
			os.Remove(tempPath)
			return fmt.Errorf("failed to write segment %d: %w", i+1, err)
		}

		// Calculate speed and update progress for frontend
		mbDownloaded := float64(totalBytes) / (1024 * 1024)
		now := time.Now()
		timeDiff := now.Sub(lastTime).Seconds()
		var speedMBps float64
		if timeDiff > 0.1 { // Update speed every 100ms
			bytesDiff := float64(totalBytes - lastBytes)
			speedMBps = (bytesDiff / (1024 * 1024)) / timeDiff
			SetDownloadSpeed(speedMBps)
			lastTime = now
			lastBytes = totalBytes
		}
		SetDownloadProgress(mbDownloaded)

		// Show progress with size in terminal
		fmt.Printf("\rDownloading: %.2f MB (%d/%d segments)", mbDownloaded, i+1, totalSegments)
	}

	// Close temp file before remuxing
	out.Close()

	// Get temp file size
	tempInfo, _ := os.Stat(tempPath)
	fmt.Printf("\rDownloaded: %.2f MB (Complete)          \n", float64(tempInfo.Size())/(1024*1024))

	// Remux M4A to FLAC using ffmpeg
	// DASH segments are in fMP4 container with FLAC codec, need to extract to native FLAC
	fmt.Println("Converting to FLAC...")
	cmd := exec.Command("ffmpeg", "-y", "-i", tempPath, "-vn", "-c:a", "flac", outputPath)
	var stderr strings.Builder
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		// If ffmpeg fails, try to keep the M4A file for debugging
		m4aPath := strings.TrimSuffix(outputPath, ".flac") + ".m4a"
		os.Rename(tempPath, m4aPath)
		return fmt.Errorf("ffmpeg conversion failed (M4A saved as %s): %w - %s", m4aPath, err, stderr.String())
	}

	// Remove temp file
	os.Remove(tempPath)
	fmt.Println("Download complete")

	return nil
}

func (t *TidalDownloader) DownloadByURL(tidalURL, outputDir, quality, filenameFormat string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate string, useAlbumTrackNumber bool, spotifyCoverURL string, embedMaxQualityCover bool, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks int, spotifyISRC string) (string, error) {
	if outputDir != "." {
		if err := os.MkdirAll(outputDir, 0755); err != nil {
			return "", fmt.Errorf("directory error: %w", err)
		}
	}

	fmt.Printf("Using Tidal URL: %s\n", tidalURL)

	// Extract track ID from URL
	trackID, err := t.GetTrackIDFromURL(tidalURL)
	if err != nil {
		return "", err
	}

	// Get track info by ID
	trackInfo, err := t.GetTrackInfoByID(trackID)
	if err != nil {
		return "", err
	}

	if trackInfo.ID == 0 {
		return "", fmt.Errorf("no track ID found")
	}

	// All metadata from Spotify - no fallback to Tidal
	artistName := spotifyArtistName
	trackTitle := spotifyTrackName
	albumTitle := spotifyAlbumName

	// Sanitize for filename only (not for metadata)
	artistNameForFile := sanitizeFilename(artistName)
	trackTitleForFile := sanitizeFilename(trackTitle)
	albumTitleForFile := sanitizeFilename(albumTitle)
	albumArtistForFile := sanitizeFilename(spotifyAlbumArtist)

	// Check if file with same ISRC already exists
	if existingFile, exists := CheckISRCExists(outputDir, trackInfo.ISRC); exists {
		fmt.Printf("File with ISRC %s already exists: %s\n", trackInfo.ISRC, existingFile)
		return "EXISTS:" + existingFile, nil
	}

	// Build filename based on format settings (use sanitized versions for filename)
	filename := buildTidalFilename(trackTitleForFile, artistNameForFile, albumTitleForFile, albumArtistForFile, spotifyReleaseDate, trackInfo.TrackNumber, spotifyDiscNumber, filenameFormat, includeTrackNumber, position, useAlbumTrackNumber)
	outputFilename := filepath.Join(outputDir, filename)

	if fileInfo, err := os.Stat(outputFilename); err == nil && fileInfo.Size() > 0 {
		fmt.Printf("File already exists: %s (%.2f MB)\n", outputFilename, float64(fileInfo.Size())/(1024*1024))
		return "EXISTS:" + outputFilename, nil
	}

	downloadURL, err := t.GetDownloadURL(trackInfo.ID, quality)
	if err != nil {
		return "", err
	}

	fmt.Printf("Downloading to: %s\n", outputFilename)
	if err := t.DownloadFile(downloadURL, outputFilename); err != nil {
		return "", err
	}

	fmt.Println("Adding metadata...")

	coverPath := ""
	// Use Spotify cover URL (with max resolution if enabled) - all metadata from Spotify
	if spotifyCoverURL != "" {
		coverPath = outputFilename + ".cover.jpg"
		coverClient := NewCoverClient()
		if err := coverClient.DownloadCoverToPath(spotifyCoverURL, coverPath, embedMaxQualityCover); err != nil {
			fmt.Printf("Warning: Failed to download Spotify cover: %v\n", err)
			coverPath = ""
		} else {
			defer os.Remove(coverPath)
			fmt.Println("Spotify cover downloaded")
		}
	}

	// Determine track number to embed - ALL from Spotify
	// - If position > 0 and !useAlbumTrackNumber: use playlist position
	// - Otherwise: use Spotify track number
	trackNumberToEmbed := spotifyTrackNumber
	if position > 0 && !useAlbumTrackNumber {
		trackNumberToEmbed = position // Use playlist position
	}

	// ALL metadata from Spotify
	metadata := Metadata{
		Title:       trackTitle,
		Artist:      artistName,
		Album:       albumTitle,
		AlbumArtist: spotifyAlbumArtist,
		Date:        spotifyReleaseDate, // Recorded date (full date YYYY-MM-DD)
		TrackNumber: trackNumberToEmbed,
		TotalTracks: spotifyTotalTracks, // Total tracks in album from Spotify
		DiscNumber:  spotifyDiscNumber,  // Disc number from Spotify
		ISRC:        spotifyISRC,        // ISRC from Spotify
		Description: "https://github.com/afkarxyz/SpotiFLAC",
	}

	if err := EmbedMetadata(outputFilename, metadata, coverPath); err != nil {
		fmt.Printf("Tagging failed: %v\n", err)
	} else {
		fmt.Println("Metadata saved")
	}

	fmt.Println("Done")
	fmt.Println("✓ Downloaded successfully from Tidal")
	return outputFilename, nil
}

func (t *TidalDownloader) DownloadByURLWithFallback(tidalURL, outputDir, quality, filenameFormat string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate string, useAlbumTrackNumber bool, spotifyCoverURL string, embedMaxQualityCover bool, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks int, spotifyISRC string) (string, error) {
	apis, err := t.GetAvailableAPIs()
	if err != nil {
		return "", fmt.Errorf("no APIs available for fallback: %w", err)
	}

	if outputDir != "." {
		if err := os.MkdirAll(outputDir, 0755); err != nil {
			return "", fmt.Errorf("directory error: %w", err)
		}
	}

	fmt.Printf("Using Tidal URL: %s\n", tidalURL)

	// Extract track ID from URL
	trackID, err := t.GetTrackIDFromURL(tidalURL)
	if err != nil {
		return "", err
	}

	// Get track info by ID
	trackInfo, err := t.GetTrackInfoByID(trackID)
	if err != nil {
		return "", err
	}

	if trackInfo.ID == 0 {
		return "", fmt.Errorf("no track ID found")
	}

	// All metadata from Spotify - no fallback to Tidal
	artistName := spotifyArtistName
	trackTitle := spotifyTrackName
	albumTitle := spotifyAlbumName

	// Sanitize for filename only (not for metadata)
	artistNameForFile := sanitizeFilename(artistName)
	trackTitleForFile := sanitizeFilename(trackTitle)
	albumTitleForFile := sanitizeFilename(albumTitle)
	albumArtistForFile := sanitizeFilename(spotifyAlbumArtist)

	// Check if file with same ISRC already exists
	if existingFile, exists := CheckISRCExists(outputDir, trackInfo.ISRC); exists {
		fmt.Printf("File with ISRC %s already exists: %s\n", trackInfo.ISRC, existingFile)
		return "EXISTS:" + existingFile, nil
	}

	filename := buildTidalFilename(trackTitleForFile, artistNameForFile, albumTitleForFile, albumArtistForFile, spotifyReleaseDate, trackInfo.TrackNumber, spotifyDiscNumber, filenameFormat, includeTrackNumber, position, useAlbumTrackNumber)
	outputFilename := filepath.Join(outputDir, filename)

	if fileInfo, err := os.Stat(outputFilename); err == nil && fileInfo.Size() > 0 {
		fmt.Printf("File already exists: %s (%.2f MB)\n", outputFilename, float64(fileInfo.Size())/(1024*1024))
		return "EXISTS:" + outputFilename, nil
	}

	// Request download URL from ALL APIs in parallel - use first success
	successAPI, downloadURL, err := getDownloadURLParallel(apis, trackInfo.ID, quality)
	if err != nil {
		return "", err
	}

	// Download the file
	fmt.Printf("Downloading to: %s\n", outputFilename)
	downloader := NewTidalDownloader(successAPI)
	if err := downloader.DownloadFile(downloadURL, outputFilename); err != nil {
		return "", err
	}

	fmt.Println("Adding metadata...")

	coverPath := ""
	// Use Spotify cover URL (with max resolution if enabled) - all metadata from Spotify
	if spotifyCoverURL != "" {
		coverPath = outputFilename + ".cover.jpg"
		coverClient := NewCoverClient()
		if err := coverClient.DownloadCoverToPath(spotifyCoverURL, coverPath, embedMaxQualityCover); err != nil {
			fmt.Printf("Warning: Failed to download Spotify cover: %v\n", err)
			coverPath = ""
		} else {
			defer os.Remove(coverPath)
			fmt.Println("Spotify cover downloaded")
		}
	}

	// Determine track number to embed - ALL from Spotify
	trackNumberToEmbed := spotifyTrackNumber
	if position > 0 && !useAlbumTrackNumber {
		trackNumberToEmbed = position // Use playlist position
	}

	// ALL metadata from Spotify
	metadata := Metadata{
		Title:       trackTitle,
		Artist:      artistName,
		Album:       albumTitle,
		AlbumArtist: spotifyAlbumArtist,
		Date:        spotifyReleaseDate, // Recorded date (full date YYYY-MM-DD)
		TrackNumber: trackNumberToEmbed,
		TotalTracks: spotifyTotalTracks, // Total tracks in album from Spotify
		DiscNumber:  spotifyDiscNumber,  // Disc number from Spotify
		ISRC:        spotifyISRC,        // ISRC from Spotify
		Description: "https://github.com/afkarxyz/SpotiFLAC",
	}

	if err := EmbedMetadata(outputFilename, metadata, coverPath); err != nil {
		fmt.Printf("Tagging failed: %v\n", err)
	} else {
		fmt.Println("Metadata saved")
	}

	fmt.Println("Done")
	fmt.Println("✓ Downloaded successfully from Tidal")
	return outputFilename, nil
}

func (t *TidalDownloader) Download(spotifyTrackID, outputDir, quality, filenameFormat string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate string, useAlbumTrackNumber bool, spotifyCoverURL string, embedMaxQualityCover bool, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks int, spotifyISRC string) (string, error) {
	// Get Tidal URL from Spotify track ID
	tidalURL, err := t.GetTidalURLFromSpotify(spotifyTrackID)
	if err != nil {
		// Songlink failed to find Tidal URL, try search fallback
		fmt.Printf("Songlink couldn't find Tidal URL: %v\n", err)
		fmt.Println("Trying Tidal search fallback...")
		return t.DownloadBySearch(spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, spotifyISRC, 0, outputDir, quality, filenameFormat, includeTrackNumber, position, useAlbumTrackNumber, spotifyCoverURL, embedMaxQualityCover, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks)
	}

	return t.DownloadByURLWithFallback(tidalURL, outputDir, quality, filenameFormat, includeTrackNumber, position, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, useAlbumTrackNumber, spotifyCoverURL, embedMaxQualityCover, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks, spotifyISRC)
}

// DownloadWithISRC downloads a track with ISRC matching for search fallback
func (t *TidalDownloader) DownloadWithISRC(spotifyTrackID, spotifyISRC, outputDir, quality, filenameFormat string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate string, useAlbumTrackNumber bool, expectedDuration int, spotifyCoverURL string, embedMaxQualityCover bool, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks int) (string, error) {
	// Get Tidal URL from Spotify track ID
	tidalURL, err := t.GetTidalURLFromSpotify(spotifyTrackID)
	if err != nil {
		// Songlink failed to find Tidal URL, try search fallback with ISRC
		fmt.Printf("Songlink couldn't find Tidal URL: %v\n", err)
		fmt.Println("Trying Tidal search fallback with ISRC matching...")
		return t.DownloadBySearchWithISRC(spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, spotifyISRC, expectedDuration, outputDir, quality, filenameFormat, includeTrackNumber, position, useAlbumTrackNumber, spotifyCoverURL, embedMaxQualityCover, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks)
	}

	return t.DownloadByURLWithFallback(tidalURL, outputDir, quality, filenameFormat, includeTrackNumber, position, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, useAlbumTrackNumber, spotifyCoverURL, embedMaxQualityCover, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks, spotifyISRC)
}

// DownloadBySearch downloads a track by searching Tidal directly using metadata
// This is used as a fallback when Songlink API doesn't find a Tidal URL
func (t *TidalDownloader) DownloadBySearch(trackName, artistName, albumName, albumArtist, releaseDate, spotifyISRC string, expectedDuration int, outputDir, quality, filenameFormat string, includeTrackNumber bool, position int, useAlbumTrackNumber bool, spotifyCoverURL string, embedMaxQualityCover bool, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks int) (string, error) {
	return t.DownloadBySearchWithISRC(trackName, artistName, albumName, albumArtist, releaseDate, spotifyISRC, expectedDuration, outputDir, quality, filenameFormat, includeTrackNumber, position, useAlbumTrackNumber, spotifyCoverURL, embedMaxQualityCover, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks)
}

// DownloadBySearchWithISRC downloads a track by searching Tidal with ISRC matching
func (t *TidalDownloader) DownloadBySearchWithISRC(trackName, artistName, albumName, albumArtist, releaseDate, spotifyISRC string, expectedDuration int, outputDir, quality, filenameFormat string, includeTrackNumber bool, position int, useAlbumTrackNumber bool, spotifyCoverURL string, embedMaxQualityCover bool, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks int) (string, error) {
	if outputDir != "." {
		if err := os.MkdirAll(outputDir, 0755); err != nil {
			return "", fmt.Errorf("directory error: %w", err)
		}
	}

	// Search for the track with ISRC matching
	trackInfo, err := t.SearchTrackByMetadataWithISRC(trackName, artistName, spotifyISRC, expectedDuration)
	if err != nil {
		return "", fmt.Errorf("search fallback failed: %w", err)
	}

	if trackInfo.ID == 0 {
		return "", fmt.Errorf("no track ID found from search")
	}

	// All metadata from Spotify - no fallback to Tidal
	finalArtistName := artistName
	finalTrackTitle := trackName
	finalAlbumTitle := albumName

	// Sanitize for filename only (not for metadata)
	finalArtistNameForFile := sanitizeFilename(finalArtistName)
	finalTrackTitleForFile := sanitizeFilename(finalTrackTitle)
	finalAlbumTitleForFile := sanitizeFilename(finalAlbumTitle)
	finalAlbumArtistForFile := sanitizeFilename(albumArtist)

	// Check if file with same ISRC already exists (use Spotify ISRC)
	if existingFile, exists := CheckISRCExists(outputDir, spotifyISRC); exists {
		fmt.Printf("File with ISRC %s already exists: %s\n", spotifyISRC, existingFile)
		return "EXISTS:" + existingFile, nil
	}

	// Build filename
	filename := buildTidalFilename(finalTrackTitleForFile, finalArtistNameForFile, finalAlbumTitleForFile, finalAlbumArtistForFile, releaseDate, spotifyTrackNumber, spotifyDiscNumber, filenameFormat, includeTrackNumber, position, useAlbumTrackNumber)
	outputFilename := filepath.Join(outputDir, filename)

	if fileInfo, err := os.Stat(outputFilename); err == nil && fileInfo.Size() > 0 {
		fmt.Printf("File already exists: %s (%.2f MB)\n", outputFilename, float64(fileInfo.Size())/(1024*1024))
		return "EXISTS:" + outputFilename, nil
	}

	// Get download URL
	downloadURL, err := t.GetDownloadURL(trackInfo.ID, quality)
	if err != nil {
		return "", err
	}

	fmt.Printf("Downloading to: %s\n", outputFilename)
	if err := t.DownloadFile(downloadURL, outputFilename); err != nil {
		return "", err
	}

	fmt.Println("Adding metadata...")

	coverPath := ""
	// Use Spotify cover URL (with max resolution if enabled) - all metadata from Spotify
	if spotifyCoverURL != "" {
		coverPath = outputFilename + ".cover.jpg"
		coverClient := NewCoverClient()
		if err := coverClient.DownloadCoverToPath(spotifyCoverURL, coverPath, embedMaxQualityCover); err != nil {
			fmt.Printf("Warning: Failed to download Spotify cover: %v\n", err)
			coverPath = ""
		} else {
			defer os.Remove(coverPath)
			fmt.Println("Spotify cover downloaded")
		}
	}

	// Determine track number to embed - ALL from Spotify
	trackNumberToEmbed := spotifyTrackNumber
	if position > 0 && !useAlbumTrackNumber {
		trackNumberToEmbed = position // Use playlist position
	}

	// ALL metadata from Spotify
	metadata := Metadata{
		Title:       finalTrackTitle,
		Artist:      finalArtistName,
		Album:       finalAlbumTitle,
		AlbumArtist: albumArtist,
		Date:        releaseDate, // Recorded date (full date YYYY-MM-DD)
		TrackNumber: trackNumberToEmbed,
		TotalTracks: spotifyTotalTracks, // Total tracks in album from Spotify
		DiscNumber:  spotifyDiscNumber,  // Disc number from Spotify
		ISRC:        spotifyISRC,        // ISRC from Spotify
		Description: "https://github.com/afkarxyz/SpotiFLAC",
	}

	if err := EmbedMetadata(outputFilename, metadata, coverPath); err != nil {
		fmt.Printf("Tagging failed: %v\n", err)
	} else {
		fmt.Println("Metadata saved")
	}

	fmt.Println("Done")
	fmt.Println("✓ Downloaded successfully from Tidal (via search)")
	return outputFilename, nil
}

// DASH MPD XML structures for parsing manifest
type MPD struct {
	XMLName xml.Name `xml:"MPD"`
	Period  struct {
		AdaptationSet struct {
			Representation struct {
				SegmentTemplate struct {
					Initialization string `xml:"initialization,attr"`
					Media          string `xml:"media,attr"`
					Timeline       struct {
						Segments []struct {
							Duration int `xml:"d,attr"`
							Repeat   int `xml:"r,attr"`
						} `xml:"S"`
					} `xml:"SegmentTimeline"`
				} `xml:"SegmentTemplate"`
			} `xml:"Representation"`
		} `xml:"AdaptationSet"`
	} `xml:"Period"`
}

// parseManifest extracts download URL from base64 encoded manifest
// Supports both BTS (JSON) and DASH (XML) formats
// Returns: directURL (for BTS), or initURL + mediaURLs (for DASH)
func parseManifest(manifestB64 string) (directURL string, initURL string, mediaURLs []string, err error) {
	// Decode base64 manifest
	manifestBytes, err := base64.StdEncoding.DecodeString(manifestB64)
	if err != nil {
		return "", "", nil, fmt.Errorf("failed to decode manifest: %w", err)
	}

	manifestStr := string(manifestBytes)

	// Check if it's BTS format (JSON) or DASH format (XML)
	if strings.HasPrefix(manifestStr, "{") {
		// BTS format - JSON with direct URLs
		var btsManifest TidalBTSManifest
		if err := json.Unmarshal(manifestBytes, &btsManifest); err != nil {
			return "", "", nil, fmt.Errorf("failed to parse BTS manifest: %w", err)
		}

		if len(btsManifest.URLs) == 0 {
			return "", "", nil, fmt.Errorf("no URLs in BTS manifest")
		}

		fmt.Printf("Manifest: BTS format (%s, %s)\n", btsManifest.MimeType, btsManifest.Codecs)
		return btsManifest.URLs[0], "", nil, nil
	}

	// DASH format - XML with segments
	fmt.Println("Manifest: DASH format")

	// Parse XML
	var mpd MPD
	if err := xml.Unmarshal(manifestBytes, &mpd); err != nil {
		return "", "", nil, fmt.Errorf("failed to parse manifest XML: %w", err)
	}

	segTemplate := mpd.Period.AdaptationSet.Representation.SegmentTemplate
	initURL = segTemplate.Initialization
	mediaTemplate := segTemplate.Media

	if initURL == "" || mediaTemplate == "" {
		// Fallback: try regex extraction
		initRe := regexp.MustCompile(`initialization="([^"]+)"`)
		mediaRe := regexp.MustCompile(`media="([^"]+)"`)

		if match := initRe.FindStringSubmatch(manifestStr); len(match) > 1 {
			initURL = match[1]
		}
		if match := mediaRe.FindStringSubmatch(manifestStr); len(match) > 1 {
			mediaTemplate = match[1]
		}
	}

	if initURL == "" {
		return "", "", nil, fmt.Errorf("no initialization URL found in manifest")
	}

	// Unescape HTML entities in URLs
	initURL = strings.ReplaceAll(initURL, "&amp;", "&")
	mediaTemplate = strings.ReplaceAll(mediaTemplate, "&amp;", "&")

	// Calculate segment count from timeline
	segmentCount := 0
	for _, seg := range segTemplate.Timeline.Segments {
		segmentCount += seg.Repeat + 1
	}

	// If no segments found via XML, try regex
	if segmentCount == 0 {
		segRe := regexp.MustCompile(`<S d="\d+"(?: r="(\d+)")?`)
		matches := segRe.FindAllStringSubmatch(manifestStr, -1)
		for _, match := range matches {
			repeat := 0
			if len(match) > 1 && match[1] != "" {
				fmt.Sscanf(match[1], "%d", &repeat)
			}
			segmentCount += repeat + 1
		}
	}

	// Generate media URLs for each segment
	for i := 1; i <= segmentCount; i++ {
		mediaURL := strings.ReplaceAll(mediaTemplate, "$Number$", fmt.Sprintf("%d", i))
		mediaURLs = append(mediaURLs, mediaURL)
	}

	return "", initURL, mediaURLs, nil
}

// manifestResult holds the result from a parallel API request for v2 API
type manifestResult struct {
	apiURL   string
	manifest string
	err      error
}

// getDownloadURLParallel requests download URL from all APIs in parallel
// Returns the first successful result (supports both v1 and v2 API formats)
func getDownloadURLParallel(apis []string, trackID int64, quality string) (string, string, error) {
	if len(apis) == 0 {
		return "", "", fmt.Errorf("no APIs available")
	}

	resultChan := make(chan manifestResult, len(apis))

	// Start all requests in parallel with longer timeout client
	fmt.Printf("Requesting download URL from %d APIs in parallel...\n", len(apis))
	for _, apiURL := range apis {
		go func(api string) {
			// Create client with longer timeout for parallel requests
			client := &http.Client{
				Timeout: 15 * time.Second, // Longer timeout for parallel
			}

			url := fmt.Sprintf("%s/track/?id=%d&quality=%s", api, trackID, quality)
			resp, err := client.Get(url)
			if err != nil {
				resultChan <- manifestResult{apiURL: api, err: err}
				return
			}
			defer resp.Body.Close()

			if resp.StatusCode != 200 {
				resultChan <- manifestResult{apiURL: api, err: fmt.Errorf("HTTP %d", resp.StatusCode)}
				return
			}

			// Read body to try both formats
			body, err := io.ReadAll(resp.Body)
			if err != nil {
				resultChan <- manifestResult{apiURL: api, err: err}
				return
			}

			// Try v2 format first (object with manifest)
			var v2Response TidalAPIResponseV2
			if err := json.Unmarshal(body, &v2Response); err == nil && v2Response.Data.Manifest != "" {
				resultChan <- manifestResult{apiURL: api, manifest: v2Response.Data.Manifest, err: nil}
				return
			}

			// Fallback to v1 format (array with OriginalTrackUrl)
			var v1Responses []TidalAPIResponse
			if err := json.Unmarshal(body, &v1Responses); err == nil {
				for _, item := range v1Responses {
					if item.OriginalTrackURL != "" {
						// For v1, we store the URL directly with a prefix to distinguish
						resultChan <- manifestResult{apiURL: api, manifest: "DIRECT:" + item.OriginalTrackURL, err: nil}
						return
					}
				}
			}

			resultChan <- manifestResult{apiURL: api, err: fmt.Errorf("no download URL or manifest in response")}
		}(apiURL)
	}

	// Collect results - return first success
	var lastError error
	var errors []string

	for i := 0; i < len(apis); i++ {
		result := <-resultChan
		if result.err == nil && result.manifest != "" {
			// First success - use this one
			fmt.Printf("✓ Got response from: %s\n", result.apiURL)

			// Check if it's a direct URL (v1) or manifest (v2)
			if strings.HasPrefix(result.manifest, "DIRECT:") {
				return result.apiURL, strings.TrimPrefix(result.manifest, "DIRECT:"), nil
			}

			// It's a v2 manifest - return it with MANIFEST: prefix
			return result.apiURL, "MANIFEST:" + result.manifest, nil
		} else {
			errMsg := result.err.Error()
			if len(errMsg) > 50 {
				errMsg = errMsg[:50] + "..."
			}
			errors = append(errors, fmt.Sprintf("%s: %s", result.apiURL, errMsg))
			lastError = result.err
		}
	}

	// Print all errors for debugging
	fmt.Println("All APIs failed:")
	for _, e := range errors {
		fmt.Printf("  ✗ %s\n", e)
	}

	return "", "", fmt.Errorf("all %d APIs failed. Last error: %v", len(apis), lastError)
}

// DownloadBySearchWithFallback tries multiple APIs when downloading via search
// Search is done ONCE, then requests all APIs in PARALLEL for download URL
func (t *TidalDownloader) DownloadBySearchWithFallback(trackName, artistName, albumName, albumArtist, releaseDate, spotifyISRC string, expectedDuration int, outputDir, quality, filenameFormat string, includeTrackNumber bool, position int, useAlbumTrackNumber bool, spotifyCoverURL string, embedMaxQualityCover bool, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks int) (string, error) {
	apis, err := t.GetAvailableAPIs()
	if err != nil {
		return "", fmt.Errorf("no APIs available for fallback: %w", err)
	}

	if outputDir != "." {
		if err := os.MkdirAll(outputDir, 0755); err != nil {
			return "", fmt.Errorf("directory error: %w", err)
		}
	}

	// Search ONCE to find the track
	fmt.Println("Searching for track...")
	trackInfo, err := t.SearchTrackByMetadataWithISRC(trackName, artistName, spotifyISRC, expectedDuration)
	if err != nil {
		return "", fmt.Errorf("search failed: %w", err)
	}

	if trackInfo.ID == 0 {
		return "", fmt.Errorf("no track ID found from search")
	}

	fmt.Printf("Track found: %s - %s (ID: %d)\n", trackInfo.Artist.Name, trackInfo.Title, trackInfo.ID)

	// All metadata from Spotify - no fallback to Tidal
	finalArtistName := artistName
	finalTrackTitle := trackName
	finalAlbumTitle := albumName

	// Sanitize for filename only (not for metadata)
	finalArtistNameForFile := sanitizeFilename(finalArtistName)
	finalTrackTitleForFile := sanitizeFilename(finalTrackTitle)
	finalAlbumTitleForFile := sanitizeFilename(finalAlbumTitle)
	finalAlbumArtistForFile := sanitizeFilename(albumArtist)

	// Check if file already exists (use Spotify ISRC)
	if existingFile, exists := CheckISRCExists(outputDir, spotifyISRC); exists {
		fmt.Printf("File with ISRC %s already exists: %s\n", spotifyISRC, existingFile)
		return "EXISTS:" + existingFile, nil
	}

	filename := buildTidalFilename(finalTrackTitleForFile, finalArtistNameForFile, finalAlbumTitleForFile, finalAlbumArtistForFile, releaseDate, spotifyTrackNumber, spotifyDiscNumber, filenameFormat, includeTrackNumber, position, useAlbumTrackNumber)
	outputFilename := filepath.Join(outputDir, filename)

	if fileInfo, err := os.Stat(outputFilename); err == nil && fileInfo.Size() > 0 {
		fmt.Printf("File already exists: %s (%.2f MB)\n", outputFilename, float64(fileInfo.Size())/(1024*1024))
		return "EXISTS:" + outputFilename, nil
	}

	// Request download URL from ALL APIs in parallel - use first success
	successAPI, downloadURL, err := getDownloadURLParallel(apis, trackInfo.ID, quality)
	if err != nil {
		return "", err
	}

	// Download the file using the successful API
	fmt.Printf("Downloading to: %s\n", outputFilename)
	downloader := NewTidalDownloader(successAPI)
	if err := downloader.DownloadFile(downloadURL, outputFilename); err != nil {
		return "", fmt.Errorf("download failed: %w", err)
	}

	// Success! Add metadata
	fmt.Println("Adding metadata...")

	coverPath := ""
	// Use Spotify cover URL (with max resolution if enabled) - all metadata from Spotify
	if spotifyCoverURL != "" {
		coverPath = outputFilename + ".cover.jpg"
		coverClient := NewCoverClient()
		if err := coverClient.DownloadCoverToPath(spotifyCoverURL, coverPath, embedMaxQualityCover); err != nil {
			fmt.Printf("Warning: Failed to download Spotify cover: %v\n", err)
			coverPath = ""
		} else {
			defer os.Remove(coverPath)
			fmt.Println("Spotify cover downloaded")
		}
	}

	// Determine track number to embed - ALL from Spotify
	trackNumberToEmbed := spotifyTrackNumber
	if position > 0 && !useAlbumTrackNumber {
		trackNumberToEmbed = position // Use playlist position
	}

	// ALL metadata from Spotify
	metadata := Metadata{
		Title:       finalTrackTitle,
		Artist:      finalArtistName,
		Album:       finalAlbumTitle,
		AlbumArtist: albumArtist,
		Date:        releaseDate, // Recorded date (full date YYYY-MM-DD)
		TrackNumber: trackNumberToEmbed,
		TotalTracks: spotifyTotalTracks, // Total tracks in album from Spotify
		DiscNumber:  spotifyDiscNumber,  // Disc number from Spotify
		ISRC:        spotifyISRC,        // ISRC from Spotify
		Description: "https://github.com/afkarxyz/SpotiFLAC",
	}

	if err := EmbedMetadata(outputFilename, metadata, coverPath); err != nil {
		fmt.Printf("Tagging failed: %v\n", err)
	} else {
		fmt.Println("Metadata saved")
	}

	fmt.Println("Done")
	fmt.Println("✓ Downloaded successfully from Tidal (via search)")
	return outputFilename, nil
}

func (t *TidalDownloader) DownloadWithFallback(spotifyTrackID, outputDir, quality, filenameFormat string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate string, useAlbumTrackNumber bool, spotifyCoverURL string, embedMaxQualityCover bool, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks int, spotifyISRC string) (string, error) {
	// Get Tidal URL once
	tidalURL, err := t.GetTidalURLFromSpotify(spotifyTrackID)
	if err != nil {
		// Songlink failed to find Tidal URL, try search fallback with all APIs
		fmt.Printf("Songlink couldn't find Tidal URL: %v\n", err)
		fmt.Println("Trying Tidal search fallback with all APIs...")
		return t.DownloadBySearchWithFallback(spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, spotifyISRC, 0, outputDir, quality, filenameFormat, includeTrackNumber, position, useAlbumTrackNumber, spotifyCoverURL, embedMaxQualityCover, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks)
	}

	// Use parallel API requests via DownloadByURLWithFallback
	return t.DownloadByURLWithFallback(tidalURL, outputDir, quality, filenameFormat, includeTrackNumber, position, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, useAlbumTrackNumber, spotifyCoverURL, embedMaxQualityCover, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks, spotifyISRC)
}

// DownloadWithFallbackAndISRC downloads with ISRC matching for search fallback
// Uses parallel API requests for faster download
func (t *TidalDownloader) DownloadWithFallbackAndISRC(spotifyTrackID, spotifyISRC, outputDir, quality, filenameFormat string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate string, useAlbumTrackNumber bool, expectedDuration int, spotifyCoverURL string, embedMaxQualityCover bool, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks int) (string, error) {
	// Get Tidal URL once
	tidalURL, err := t.GetTidalURLFromSpotify(spotifyTrackID)
	if err != nil {
		// Songlink failed to find Tidal URL, try search fallback with ISRC matching
		fmt.Printf("Songlink couldn't find Tidal URL: %v\n", err)
		fmt.Println("Trying Tidal search fallback with ISRC matching...")
		return t.DownloadBySearchWithFallback(spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, spotifyISRC, expectedDuration, outputDir, quality, filenameFormat, includeTrackNumber, position, useAlbumTrackNumber, spotifyCoverURL, embedMaxQualityCover, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks)
	}

	// Use parallel API requests via DownloadByURLWithFallback
	return t.DownloadByURLWithFallback(tidalURL, outputDir, quality, filenameFormat, includeTrackNumber, position, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, useAlbumTrackNumber, spotifyCoverURL, embedMaxQualityCover, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks, spotifyISRC)
}

func buildTidalFilename(title, artist, album, albumArtist, releaseDate string, trackNumber, discNumber int, format string, includeTrackNumber bool, position int, useAlbumTrackNumber bool) string {
	var filename string

	// Determine track number to use
	numberToUse := position
	if useAlbumTrackNumber && trackNumber > 0 {
		numberToUse = trackNumber
	}

	// Extract year from release date (format: YYYY-MM-DD or YYYY)
	year := ""
	if len(releaseDate) >= 4 {
		year = releaseDate[:4]
	}

	// Check if format is a template (contains {})
	if strings.Contains(format, "{") {
		filename = format
		filename = strings.ReplaceAll(filename, "{title}", title)
		filename = strings.ReplaceAll(filename, "{artist}", artist)
		filename = strings.ReplaceAll(filename, "{album}", album)
		filename = strings.ReplaceAll(filename, "{album_artist}", albumArtist)
		filename = strings.ReplaceAll(filename, "{year}", year)

		// Handle disc number
		if discNumber > 0 {
			filename = strings.ReplaceAll(filename, "{disc}", fmt.Sprintf("%d", discNumber))
		} else {
			filename = strings.ReplaceAll(filename, "{disc}", "")
		}

		// Handle track number - if numberToUse is 0, remove {track} and surrounding separators
		if numberToUse > 0 {
			filename = strings.ReplaceAll(filename, "{track}", fmt.Sprintf("%02d", numberToUse))
		} else {
			// Remove {track} with common separators
			filename = regexp.MustCompile(`\{track\}\.\s*`).ReplaceAllString(filename, "")
			filename = regexp.MustCompile(`\{track\}\s*-\s*`).ReplaceAllString(filename, "")
			filename = regexp.MustCompile(`\{track\}\s*`).ReplaceAllString(filename, "")
		}
	} else {
		// Legacy format support
		switch format {
		case "artist-title":
			filename = fmt.Sprintf("%s - %s", artist, title)
		case "title":
			filename = title
		default: // "title-artist"
			filename = fmt.Sprintf("%s - %s", title, artist)
		}

		// Add track number prefix if enabled (legacy behavior)
		if includeTrackNumber && position > 0 {
			filename = fmt.Sprintf("%02d. %s", numberToUse, filename)
		}
	}

	return filename + ".flac"
}
