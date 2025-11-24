package backend

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
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

type TidalAPIInfo struct {
	URL    string `json:"url"`
	Status string `json:"status"`
}

func NewTidalDownloader(apiURL string) *TidalDownloader {
	clientID, _ := base64.StdEncoding.DecodeString("NkJEU1JkcEs5aHFFQlRnVQ==")
	clientSecret, _ := base64.StdEncoding.DecodeString("eGV1UG1ZN25icFo5SUliTEFjUTkzc2hrYTFWTmhlVUFxTjZJY3N6alRHOD0=")

	// If apiURL is empty, try to get first available API
	if apiURL == "" {
		downloader := &TidalDownloader{
			client: &http.Client{
				Timeout: 60 * time.Second,
			},
			timeout:      30 * time.Second,
			maxRetries:   3,
			clientID:     string(clientID),
			clientSecret: string(clientSecret),
			apiURL:       "",
		}

		// Try to get available APIs
		apis, err := downloader.GetAvailableAPIs()
		if err == nil && len(apis) > 0 {
			apiURL = apis[0] // Use first available API
		}
	}

	return &TidalDownloader{
		client: &http.Client{
			Timeout: 60 * time.Second,
		},
		timeout:      30 * time.Second,
		maxRetries:   3,
		clientID:     string(clientID),
		clientSecret: string(clientSecret),
		apiURL:       apiURL,
	}
}

func (t *TidalDownloader) GetAvailableAPIs() ([]string, error) {
	// Decode base64 API URL
	apiURL, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly9yYXcuZ2l0aHVidXNlcmNvbnRlbnQuY29tL2Fma2FyeHl6L1Nwb3RpRkxBQy9yZWZzL2hlYWRzL21haW4vdGlkYWwuanNvbg==")

	// Add cache-busting parameter with current timestamp
	urlWithCacheBust := fmt.Sprintf("%s?t=%d", string(apiURL), time.Now().Unix())

	// Create request with cache bypass headers
	req, err := http.NewRequest("GET", urlWithCacheBust, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	// Add headers to bypass cache
	req.Header.Set("Cache-Control", "no-cache, no-store, must-revalidate")
	req.Header.Set("Pragma", "no-cache")
	req.Header.Set("Expires", "0")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch API list: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("failed to fetch API list: HTTP %d", resp.StatusCode)
	}

	var apiList []string
	if err := json.NewDecoder(resp.Body).Decode(&apiList); err != nil {
		return nil, fmt.Errorf("failed to decode API list: %w", err)
	}

	var apis []string
	for _, api := range apiList {
		apis = append(apis, "https://"+api)
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

	var apiResponses []TidalAPIResponse
	if err := json.NewDecoder(resp.Body).Decode(&apiResponses); err != nil {
		fmt.Printf("✗ Failed to decode Tidal API response: %v\n", err)
		return "", fmt.Errorf("failed to decode response: %w", err)
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

func (t *TidalDownloader) DownloadByURL(tidalURL, outputDir, quality, filenameFormat string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName string, useAlbumTrackNumber bool) (string, error) {
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

	// Use Spotify metadata if provided, otherwise fallback to Tidal metadata
	artistName := spotifyArtistName
	trackTitle := spotifyTrackName
	albumTitle := spotifyAlbumName

	if artistName == "" {
		var artists []string
		if len(trackInfo.Artists) > 0 {
			for _, artist := range trackInfo.Artists {
				if artist.Name != "" {
					artists = append(artists, artist.Name)
				}
			}
		} else if trackInfo.Artist.Name != "" {
			artists = append(artists, trackInfo.Artist.Name)
		}

		artistName = "Unknown Artist"
		if len(artists) > 0 {
			artistName = strings.Join(artists, ", ")
		}
	}
	artistName = sanitizeFilename(artistName)

	if trackTitle == "" {
		trackTitle = trackInfo.Title
		if trackTitle == "" {
			trackTitle = fmt.Sprintf("track_%d", trackInfo.ID)
		}
	}
	trackTitle = sanitizeFilename(trackTitle)

	if albumTitle == "" {
		albumTitle = trackInfo.Album.Title
	}

	// Check if file with same ISRC already exists
	if existingFile, exists := CheckISRCExists(outputDir, trackInfo.ISRC); exists {
		fmt.Printf("File with ISRC %s already exists: %s\n", trackInfo.ISRC, existingFile)
		return "EXISTS:" + existingFile, nil
	}

	// Build filename based on format settings
	filename := buildTidalFilename(trackTitle, artistName, trackInfo.TrackNumber, filenameFormat, includeTrackNumber, position, useAlbumTrackNumber)
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
	if trackInfo.Album.Cover != "" {
		coverPath = outputFilename + ".cover.jpg"
		albumArt, err := t.DownloadAlbumArt(trackInfo.Album.Cover)
		if err != nil {
			fmt.Printf("Warning: Failed to download album art: %v\n", err)
		} else {
			if err := os.WriteFile(coverPath, albumArt, 0644); err != nil {
				fmt.Printf("Warning: Failed to save album art: %v\n", err)
			} else {
				defer os.Remove(coverPath)
				fmt.Println("Album art downloaded")
			}
		}
	}

	releaseYear := ""
	if len(trackInfo.Album.ReleaseDate) >= 4 {
		releaseYear = trackInfo.Album.ReleaseDate[:4]
	}

	// Use album track number if in album folder structure, otherwise use playlist position
	trackNumberToEmbed := 0
	if position > 0 {
		if useAlbumTrackNumber && trackInfo.TrackNumber > 0 {
			trackNumberToEmbed = trackInfo.TrackNumber
		} else {
			trackNumberToEmbed = position
		}
	}

	metadata := Metadata{
		Title:       trackTitle,
		Artist:      artistName,
		Album:       albumTitle,
		Date:        releaseYear,
		TrackNumber: trackNumberToEmbed,
		DiscNumber:  trackInfo.VolumeNumber,
		ISRC:        trackInfo.ISRC,
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

func (t *TidalDownloader) DownloadByURLWithFallback(tidalURL, outputDir, quality, filenameFormat string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName string, useAlbumTrackNumber bool) (string, error) {
	apis, err := t.GetAvailableAPIs()
	if err != nil {
		return "", fmt.Errorf("no APIs available for fallback: %w", err)
	}

	var lastError error
	for i, apiURL := range apis {
		fmt.Printf("[Tidal API %d/%d] Trying: %s\n", i+1, len(apis), apiURL)

		fallbackDownloader := NewTidalDownloader(apiURL)

		result, err := fallbackDownloader.DownloadByURL(tidalURL, outputDir, quality, filenameFormat, includeTrackNumber, position, spotifyTrackName, spotifyArtistName, spotifyAlbumName, useAlbumTrackNumber)
		if err == nil {
			fmt.Printf("✓ Success with: %s\n", apiURL)
			return result, nil
		}

		lastError = err
		errMsg := err.Error()
		if len(errMsg) > 80 {
			errMsg = errMsg[:80]
		}
		fmt.Printf("✗ Failed with %s: %s\n", apiURL, errMsg)
	}

	return "", fmt.Errorf("all %d Tidal APIs failed. Last error: %v", len(apis), lastError)
}

func (t *TidalDownloader) Download(spotifyTrackID, outputDir, quality, filenameFormat string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName string, useAlbumTrackNumber bool) (string, error) {
	// Get Tidal URL from Spotify track ID
	tidalURL, err := t.GetTidalURLFromSpotify(spotifyTrackID)
	if err != nil {
		return "", err
	}

	return t.DownloadByURLWithFallback(tidalURL, outputDir, quality, filenameFormat, includeTrackNumber, position, spotifyTrackName, spotifyArtistName, spotifyAlbumName, useAlbumTrackNumber)
}

func (t *TidalDownloader) DownloadWithFallback(spotifyTrackID, outputDir, quality, filenameFormat string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName string, useAlbumTrackNumber bool) (string, error) {
	apis, err := t.GetAvailableAPIs()
	if err != nil {
		return "", fmt.Errorf("no APIs available for fallback: %w", err)
	}

	// Get Tidal URL once
	tidalURL, err := t.GetTidalURLFromSpotify(spotifyTrackID)
	if err != nil {
		return "", err
	}

	var lastError error
	for i, apiURL := range apis {
		fmt.Printf("[Auto Fallback %d/%d] Trying: %s\n", i+1, len(apis), apiURL)

		fallbackDownloader := NewTidalDownloader(apiURL)

		result, err := fallbackDownloader.DownloadByURL(tidalURL, outputDir, quality, filenameFormat, includeTrackNumber, position, spotifyTrackName, spotifyArtistName, spotifyAlbumName, useAlbumTrackNumber)
		if err == nil {
			fmt.Printf("✓ Success with: %s\n", apiURL)
			return result, nil
		}

		lastError = err
		errMsg := err.Error()
		if len(errMsg) > 80 {
			errMsg = errMsg[:80]
		}
		fmt.Printf("✗ Failed with %s: %s\n", apiURL, errMsg)
	}

	return "", fmt.Errorf("all %d APIs failed. Last error: %v", len(apis), lastError)
}

func buildTidalFilename(title, artist string, trackNumber int, format string, includeTrackNumber bool, position int, useAlbumTrackNumber bool) string {
	var filename string

	// Build base filename based on format
	switch format {
	case "artist-title":
		filename = fmt.Sprintf("%s - %s", artist, title)
	case "title":
		filename = title
	default: // "title-artist"
		filename = fmt.Sprintf("%s - %s", title, artist)
	}

	// Add track number prefix if enabled
	if includeTrackNumber && position > 0 {
		// Use album track number if in album folder structure, otherwise use playlist position
		numberToUse := position
		if useAlbumTrackNumber && trackNumber > 0 {
			numberToUse = trackNumber
		}
		filename = fmt.Sprintf("%02d. %s", numberToUse, filename)
	}

	return filename + ".flac"
}
