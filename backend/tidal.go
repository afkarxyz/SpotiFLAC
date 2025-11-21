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

type TidalAPIInfo struct {
	URL    string `json:"url"`
	Status string `json:"status"`
}

func NewTidalDownloader(apiURL string) *TidalDownloader {
	clientID, _ := base64.StdEncoding.DecodeString("NkJEU1JkcEs5aHFFQlRnVQ==")
	clientSecret, _ := base64.StdEncoding.DecodeString("eGV1UG1ZN25icFo5SUliTEFjUTkzc2hrYTFWTmhlVUFxTjZJY3N6alRHOD0=")

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
	resp, err := http.Get("https://raw.githubusercontent.com/afkarxyz/SpotiFLAC/refs/heads/main/tidal.json")
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

	req, err := http.NewRequest("POST", "https://auth.tidal.com/v1/oauth2/token", strings.NewReader(data))
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

func (t *TidalDownloader) SearchTracks(query string) (*TidalSearchResponse, error) {
	token, err := t.GetAccessToken()
	if err != nil {
		return nil, fmt.Errorf("failed to get access token: %w", err)
	}

	// URL encode the query parameter
	searchURL := fmt.Sprintf("https://api.tidal.com/v1/search/tracks?query=%s&limit=25&offset=0&countryCode=US", url.QueryEscape(query))

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

func (t *TidalDownloader) GetTrackInfo(query, isrc string) (*TidalTrack, error) {
	fmt.Printf("Fetching: %s", query)
	if isrc != "" {
		fmt.Printf(" (ISRC: %s)", isrc)
	}
	fmt.Println()

	result, err := t.SearchTracks(query)
	if err != nil {
		return nil, err
	}

	if len(result.Items) == 0 {
		return nil, fmt.Errorf("no tracks found for query: %s", query)
	}

	var selectedTrack *TidalTrack

	if isrc != "" {
		var isrcMatches []TidalTrack
		for _, item := range result.Items {
			if item.ISRC == isrc {
				isrcMatches = append(isrcMatches, item)
			}
		}

		if len(isrcMatches) > 1 {
			for _, item := range isrcMatches {
				for _, tag := range item.MediaMetadata.Tags {
					if tag == "HIRES_LOSSLESS" {
						selectedTrack = &item
						break
					}
				}
				if selectedTrack != nil {
					break
				}
			}
			if selectedTrack == nil {
				selectedTrack = &isrcMatches[0]
			}
		} else if len(isrcMatches) == 1 {
			selectedTrack = &isrcMatches[0]
		} else {
			selectedTrack = &result.Items[0]
		}
	} else {
		selectedTrack = &result.Items[0]
	}

	if selectedTrack == nil {
		return nil, fmt.Errorf("track not found")
	}

	fmt.Printf("Found: %s (%s)\n", selectedTrack.Title, selectedTrack.AudioQuality)
	return selectedTrack, nil
}

func (t *TidalDownloader) GetDownloadURL(trackID int64, quality string) (string, error) {
	fmt.Println("Fetching URL...")

	url := fmt.Sprintf("%s/track/?id=%d&quality=%s", t.apiURL, trackID, quality)

	resp, err := t.client.Get(url)
	if err != nil {
		return "", fmt.Errorf("failed to get download URL: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("API returned status code: %d", resp.StatusCode)
	}

	var apiResponses []TidalAPIResponse
	if err := json.NewDecoder(resp.Body).Decode(&apiResponses); err != nil {
		return "", fmt.Errorf("failed to decode response: %w", err)
	}

	if len(apiResponses) == 0 {
		return "", fmt.Errorf("no download URL in response")
	}

	for _, item := range apiResponses {
		if item.OriginalTrackURL != "" {
			fmt.Println("URL found")
			return item.OriginalTrackURL, nil
		}
	}

	return "", fmt.Errorf("download URL not found in response")
}

func (t *TidalDownloader) DownloadAlbumArt(albumID string) ([]byte, error) {
	albumID = strings.ReplaceAll(albumID, "-", "/")
	artURL := fmt.Sprintf("https://resources.tidal.com/images/%s/1280x1280.jpg", albumID)

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

	_, err = io.Copy(out, resp.Body)
	if err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}

	fmt.Println("Download complete")
	return nil
}

func (t *TidalDownloader) Download(query, isrc, outputDir, quality, filenameFormat string, includeTrackNumber bool) (string, error) {
	if outputDir != "." {
		if err := os.MkdirAll(outputDir, 0755); err != nil {
			return "", fmt.Errorf("directory error: %w", err)
		}
	}

	trackInfo, err := t.GetTrackInfo(query, isrc)
	if err != nil {
		return "", err
	}

	if trackInfo.ID == 0 {
		return "", fmt.Errorf("no track ID found")
	}

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

	artistName := "Unknown Artist"
	if len(artists) > 0 {
		artistName = strings.Join(artists, ", ")
	}
	artistName = sanitizeFilename(artistName)

	trackTitle := sanitizeFilename(trackInfo.Title)
	if trackTitle == "" {
		trackTitle = fmt.Sprintf("track_%d", trackInfo.ID)
	}

	// Build filename based on format settings
	filename := buildTidalFilename(trackTitle, artistName, trackInfo.TrackNumber, filenameFormat, includeTrackNumber)
	outputFilename := filepath.Join(outputDir, filename)

	if fileInfo, err := os.Stat(outputFilename); err == nil && fileInfo.Size() > 0 {
		fmt.Printf("File already exists: %s (%.2f MB)\n", outputFilename, float64(fileInfo.Size())/(1024*1024))
		return outputFilename, nil
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

	metadata := Metadata{
		Title:       trackInfo.Title,
		Artist:      artistName,
		Album:       trackInfo.Album.Title,
		Date:        releaseYear,
		TrackNumber: trackInfo.TrackNumber,
		DiscNumber:  trackInfo.VolumeNumber,
		ISRC:        trackInfo.ISRC,
	}

	if err := EmbedMetadata(outputFilename, metadata, coverPath); err != nil {
		fmt.Printf("Tagging failed: %v\n", err)
	} else {
		fmt.Println("Metadata saved")
	}

	fmt.Println("Done")
	return outputFilename, nil
}

func (t *TidalDownloader) DownloadWithFallback(query, isrc, outputDir, quality, filenameFormat string, includeTrackNumber bool) (string, error) {
	apis, err := t.GetAvailableAPIs()
	if err != nil {
		return "", fmt.Errorf("no APIs available for fallback: %w", err)
	}

	var lastError error
	for i, apiURL := range apis {
		fmt.Printf("[Auto Fallback %d/%d] Trying: %s\n", i+1, len(apis), apiURL)

		fallbackDownloader := NewTidalDownloader(apiURL)

		result, err := fallbackDownloader.Download(query, isrc, outputDir, quality, filenameFormat, includeTrackNumber)
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

func buildTidalFilename(title, artist string, trackNumber int, format string, includeTrackNumber bool) string {
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
	if includeTrackNumber && trackNumber > 0 {
		filename = fmt.Sprintf("%02d. %s", trackNumber, filename)
	}

	return filename + ".flac"
}
