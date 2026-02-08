package backend

import (
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type QobuzDownloader struct {
	client *http.Client
	appID  string
}

type QobuzSearchResponse struct {
	Query  string `json:"query"`
	Tracks struct {
		Limit  int          `json:"limit"`
		Offset int          `json:"offset"`
		Total  int          `json:"total"`
		Items  []QobuzTrack `json:"items"`
	} `json:"tracks"`
}

type QobuzTrack struct {
	ID                  int64   `json:"id"`
	Title               string  `json:"title"`
	Version             string  `json:"version"`
	Duration            int     `json:"duration"`
	TrackNumber         int     `json:"track_number"`
	MediaNumber         int     `json:"media_number"`
	ISRC                string  `json:"isrc"`
	Copyright           string  `json:"copyright"`
	MaximumBitDepth     int     `json:"maximum_bit_depth"`
	MaximumSamplingRate float64 `json:"maximum_sampling_rate"`
	Hires               bool    `json:"hires"`
	HiresStreamable     bool    `json:"hires_streamable"`
	ReleaseDateOriginal string  `json:"release_date_original"`
	Performer           struct {
		Name string `json:"name"`
		ID   int64  `json:"id"`
	} `json:"performer"`
	Album struct {
		Title string `json:"title"`
		ID    string `json:"id"`
		Image struct {
			Small     string `json:"small"`
			Thumbnail string `json:"thumbnail"`
			Large     string `json:"large"`
		} `json:"image"`
		Artist struct {
			Name string `json:"name"`
			ID   int64  `json:"id"`
		} `json:"artist"`
		Label struct {
			Name string `json:"name"`
		} `json:"label"`
	} `json:"album"`
}

type QobuzStreamResponse struct {
	URL string `json:"url"`
}

func NewQobuzDownloader() *QobuzDownloader {
	return &QobuzDownloader{
		client: &http.Client{
			Timeout: 60 * time.Second,
		},
		appID: "798273057",
	}
}

func (q *QobuzDownloader) SearchByISRC(isrc string) (*QobuzTrack, error) {
	apiBase := "https://www.qobuz.com/api.json/0.2/track/search?query="
	url := fmt.Sprintf("%s%s&limit=1&app_id=%s", apiBase, isrc, q.appID)

	resp, err := q.client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("failed to search track: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("API returned status %d", resp.StatusCode)
	}

	var searchResp QobuzSearchResponse

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	if len(body) == 0 {
		return nil, fmt.Errorf("API returned empty response")
	}

	if err := json.Unmarshal(body, &searchResp); err != nil {

		bodyStr := string(body)
		if len(bodyStr) > 200 {
			bodyStr = bodyStr[:200] + "..."
		}
		return nil, fmt.Errorf("failed to decode response: %w (response: %s)", err, bodyStr)
	}

	if len(searchResp.Tracks.Items) == 0 {
		return nil, fmt.Errorf("track not found for ISRC: %s", isrc)
	}

	return &searchResp.Tracks.Items[0], nil
}

func decodeXOR(data []byte) string {
	text := string(data)
	runes := []rune(text)
	result := make([]rune, len(runes))
	for i, char := range runes {
		key := rune((i * 17) % 128)
		result[i] = char ^ 253 ^ key
	}
	return string(result)
}

func (q *QobuzDownloader) mapJumoQuality(quality string) int {
	switch quality {
	case "6":
		return 6
	case "7":
		return 7
	case "27":
		return 27
	default:
		return 6
	}
}

func (q *QobuzDownloader) DownloadFromJumo(trackID int64, quality string) (string, error) {
	formatID := q.mapJumoQuality(quality)
	region := "US"
	url := fmt.Sprintf("https://jumo-dl.pages.dev/file?track_id=%d&format_id=%d&region=%s", trackID, formatID, region)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	var result map[string]interface{}

	if err := json.Unmarshal(body, &result); err != nil {

		decoded := decodeXOR(body)
		if err := json.Unmarshal([]byte(decoded), &result); err != nil {
			return "", fmt.Errorf("failed to parse JSON (plain or XOR): %w", err)
		}
	}

	if urlVal, ok := result["url"].(string); ok && urlVal != "" {
		return urlVal, nil
	}

	if data, ok := result["data"].(map[string]interface{}); ok {
		if urlVal, ok := data["url"].(string); ok && urlVal != "" {
			return urlVal, nil
		}
	}

	if linkVal, ok := result["link"].(string); ok && linkVal != "" {
		return linkVal, nil
	}

	return "", fmt.Errorf("URL not found in Jumo response")
}

func (q *QobuzDownloader) DownloadFromStandard(apiBase string, trackID int64, quality string) (string, error) {
	apiURL := fmt.Sprintf("%s%d&quality=%s", apiBase, trackID, quality)
	resp, err := q.client.Get(apiURL)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	if len(body) == 0 {
		return "", fmt.Errorf("empty body")
	}

	var streamResp QobuzStreamResponse
	if err := json.Unmarshal(body, &streamResp); err == nil && streamResp.URL != "" {
		return streamResp.URL, nil
	}

	return "", fmt.Errorf("invalid response")
}

func (q *QobuzDownloader) GetDownloadURL(trackID int64, quality string, allowFallback bool) (string, error) {
	qualityCode := quality
	if qualityCode == "" || qualityCode == "5" {
		qualityCode = "6"
	}

	fmt.Printf("Getting download URL for track ID: %d with requested quality: %s\n", trackID, qualityCode)

	standardAPIs := []string{
		"https://dab.yeet.su/api/stream?trackId=",
		"https://dabmusic.xyz/api/stream?trackId=",
		"https://qobuz.squid.wtf/api/download-music?track_id=",
	}

	downloadFunc := func(qual string) (string, error) {
		type Provider struct {
			Name string
			Func func() (string, error)
		}

		var providers []Provider

		for _, api := range standardAPIs {
			currentAPI := api
			providers = append(providers, Provider{
				Name: "Standard(" + currentAPI + ")",
				Func: func() (string, error) {
					return q.DownloadFromStandard(currentAPI, trackID, qual)
				},
			})
		}

		providers = append(providers, Provider{
			Name: "Jumo-DL",
			Func: func() (string, error) {
				return q.DownloadFromJumo(trackID, qual)
			},
		})

		rand.Seed(time.Now().UnixNano())
		rand.Shuffle(len(providers), func(i, j int) { providers[i], providers[j] = providers[j], providers[i] })

		var lastErr error
		for _, p := range providers {

			fmt.Printf("Trying Provider: %s (Quality: %s)...\n", p.Name, qual)

			url, err := p.Func()
			if err == nil {
				fmt.Printf("✓ Success\n")
				return url, nil
			}

			fmt.Printf("Provider failed: %v\n", err)
			lastErr = err
		}
		return "", lastErr
	}

	url, err := downloadFunc(qualityCode)
	if err == nil {
		return url, nil
	}

	currentQuality := qualityCode

	if currentQuality == "27" && allowFallback {
		fmt.Printf("⚠ Download with quality 27 failed, trying fallback to 7 (24-bit Standard)...\n")
		url, err := downloadFunc("7")
		if err == nil {
			fmt.Println("✓ Success with fallback quality 7")
			return url, nil
		}

		currentQuality = "7"
	}

	if currentQuality == "7" && allowFallback {
		fmt.Printf("⚠ Download with quality 7 failed, trying fallback to 6 (16-bit Lossless)...\n")
		url, err := downloadFunc("6")
		if err == nil {
			fmt.Println("✓ Success with fallback quality 6")
			return url, nil
		}
	}

	return "", fmt.Errorf("all APIs and fallbacks failed. Last error: %v", err)
}

func (q *QobuzDownloader) DownloadFile(url, filepath string) error {
	fmt.Println("Starting file download...")

	downloadClient := &http.Client{
		Timeout: 5 * time.Minute,
	}

	resp, err := downloadClient.Get(url)
	if err != nil {
		return fmt.Errorf("failed to download file: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("download failed with status %d", resp.StatusCode)
	}

	fmt.Printf("Creating file: %s\n", filepath)
	out, err := os.Create(filepath)
	if err != nil {
		return fmt.Errorf("failed to create file: %w", err)
	}
	defer out.Close()

	fmt.Println("Downloading...")

	pw := NewProgressWriter(out)
	_, err = io.Copy(pw, resp.Body)
	if err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}

	fmt.Printf("\rDownloaded: %.2f MB (Complete)\n", float64(pw.GetTotal())/(1024*1024))
	return nil
}

func (q *QobuzDownloader) DownloadCoverArt(coverURL, filepath string) error {
	if coverURL == "" {
		return fmt.Errorf("no cover URL provided")
	}

	resp, err := q.client.Get(coverURL)
	if err != nil {
		return fmt.Errorf("failed to download cover: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("cover download failed with status %d", resp.StatusCode)
	}

	out, err := os.Create(filepath)
	if err != nil {
		return fmt.Errorf("failed to create cover file: %w", err)
	}
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	return err
}

func buildQobuzFilename(title, artist, album, albumArtist, releaseDate string, trackNumber, discNumber int, format string, includeTrackNumber bool, position int, useAlbumTrackNumber bool) string {
	var filename string

	numberToUse := position
	if useAlbumTrackNumber && trackNumber > 0 {
		numberToUse = trackNumber
	}

	year := ""
	if len(releaseDate) >= 4 {
		year = releaseDate[:4]
	}

	if strings.Contains(format, "{") {
		filename = format
		filename = strings.ReplaceAll(filename, "{title}", title)
		filename = strings.ReplaceAll(filename, "{artist}", artist)
		filename = strings.ReplaceAll(filename, "{album}", album)
		filename = strings.ReplaceAll(filename, "{album_artist}", albumArtist)
		filename = strings.ReplaceAll(filename, "{year}", year)

		if discNumber > 0 {
			filename = strings.ReplaceAll(filename, "{disc}", fmt.Sprintf("%d", discNumber))
		} else {
			filename = strings.ReplaceAll(filename, "{disc}", "")
		}

		if numberToUse > 0 {
			filename = strings.ReplaceAll(filename, "{track}", fmt.Sprintf("%02d", numberToUse))
		} else {

			filename = regexp.MustCompile(`\{track\}\.\s*`).ReplaceAllString(filename, "")
			filename = regexp.MustCompile(`\{track\}\s*-\s*`).ReplaceAllString(filename, "")
			filename = regexp.MustCompile(`\{track\}\s*`).ReplaceAllString(filename, "")
		}
	} else {

		switch format {
		case "artist-title":
			filename = fmt.Sprintf("%s - %s", artist, title)
		case "title":
			filename = title
		default:
			filename = fmt.Sprintf("%s - %s", title, artist)
		}

		if includeTrackNumber && position > 0 {
			filename = fmt.Sprintf("%02d. %s", numberToUse, filename)
		}
	}

	return filename + ".flac"
}

func (q *QobuzDownloader) DownloadByISRC(deezerISRC, outputDir, quality, filenameFormat string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate string, useAlbumTrackNumber bool, spotifyCoverURL string, embedMaxQualityCover bool, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks int, spotifyTotalDiscs int, spotifyCopyright, spotifyPublisher, spotifyURL string, allowFallback bool) (string, error) {
	fmt.Printf("Fetching track info for ISRC: %s\n", deezerISRC)

	if outputDir != "." {
		if err := os.MkdirAll(outputDir, 0755); err != nil {
			return "", fmt.Errorf("failed to create output directory: %w", err)
		}
	}

	track, err := q.SearchByISRC(deezerISRC)
	if err != nil {
		return "", err
	}

	artists := spotifyArtistName
	trackTitle := spotifyTrackName
	albumTitle := spotifyAlbumName

	fmt.Printf("Found track: %s - %s\n", artists, trackTitle)
	fmt.Printf("Album: %s\n", albumTitle)

	qualityInfo := "Standard"
	if track.Hires {
		qualityInfo = fmt.Sprintf("Hi-Res (%d-bit / %.1f kHz)", track.MaximumBitDepth, track.MaximumSamplingRate)
	}
	fmt.Printf("Quality: %s\n", qualityInfo)

	fmt.Println("Getting download URL...")
	downloadURL, err := q.GetDownloadURL(track.ID, quality, allowFallback)
	if err != nil {
		return "", fmt.Errorf("failed to get download URL: %w", err)
	}

	if downloadURL == "" {
		return "", fmt.Errorf("received empty download URL")
	}

	urlPreview := downloadURL
	if len(downloadURL) > 60 {
		urlPreview = downloadURL[:60] + "..."
	}
	fmt.Printf("Download URL obtained: %s\n", urlPreview)

	safeArtist := sanitizeFilename(artists)
	safeTitle := sanitizeFilename(trackTitle)
	safeAlbum := sanitizeFilename(albumTitle)
	safeAlbumArtist := sanitizeFilename(spotifyAlbumArtist)

	filename := buildQobuzFilename(safeTitle, safeArtist, safeAlbum, safeAlbumArtist, spotifyReleaseDate, spotifyTrackNumber, spotifyDiscNumber, filenameFormat, includeTrackNumber, position, useAlbumTrackNumber)
	filepath := filepath.Join(outputDir, filename)

	if fileInfo, err := os.Stat(filepath); err == nil && fileInfo.Size() > 0 {
		fmt.Printf("File already exists: %s (%.2f MB)\n", filepath, float64(fileInfo.Size())/(1024*1024))
		return "EXISTS:" + filepath, nil
	}

	fmt.Printf("Downloading FLAC file to: %s\n", filepath)
	if err := q.DownloadFile(downloadURL, filepath); err != nil {
		return "", fmt.Errorf("failed to download file: %w", err)
	}

	fmt.Printf("Downloaded: %s\n", filepath)

	coverPath := ""

	if spotifyCoverURL != "" {
		coverPath = filepath + ".cover.jpg"
		coverClient := NewCoverClient()
		if err := coverClient.DownloadCoverToPath(spotifyCoverURL, coverPath, embedMaxQualityCover); err != nil {
			fmt.Printf("Warning: Failed to download Spotify cover: %v\n", err)
			coverPath = ""
		} else {
			defer os.Remove(coverPath)
			fmt.Println("Spotify cover downloaded")
		}
	}

	fmt.Println("Embedding metadata and cover art...")

	trackNumberToEmbed := spotifyTrackNumber
	if trackNumberToEmbed == 0 {
		trackNumberToEmbed = 1
	}

	metadata := Metadata{
		Title:       trackTitle,
		Artist:      artists,
		Album:       albumTitle,
		AlbumArtist: spotifyAlbumArtist,
		Date:        spotifyReleaseDate,
		TrackNumber: trackNumberToEmbed,
		TotalTracks: spotifyTotalTracks,
		DiscNumber:  spotifyDiscNumber,
		TotalDiscs:  spotifyTotalDiscs,
		URL:         spotifyURL,
		Copyright:   spotifyCopyright,
		Publisher:   spotifyPublisher,
		Description: "https://github.com/afkarxyz/SpotiFLAC",
	}

	if err := EmbedMetadata(filepath, metadata, coverPath); err != nil {
		return "", fmt.Errorf("failed to embed metadata: %w", err)
	}

	fmt.Println("Metadata embedded successfully!")
	return filepath, nil
}
