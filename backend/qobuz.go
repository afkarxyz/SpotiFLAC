package backend

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
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
	// Decode base64 API URL
	apiBase, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly93d3cucW9idXouY29tL2FwaS5qc29uLzAuMi90cmFjay9zZWFyY2g/cXVlcnk9")
	url := fmt.Sprintf("%s%s&limit=1&app_id=%s", string(apiBase), isrc, q.appID)

	resp, err := q.client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("failed to search track: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("API returned status %d", resp.StatusCode)
	}

	var searchResp QobuzSearchResponse
	if err := json.NewDecoder(resp.Body).Decode(&searchResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	if len(searchResp.Tracks.Items) == 0 {
		return nil, fmt.Errorf("track not found for ISRC: %s", isrc)
	}

	return &searchResp.Tracks.Items[0], nil
}

func (q *QobuzDownloader) GetDownloadURL(trackID int64, quality string) (string, error) {
	// Map quality to Qobuz quality code
	// Qobuz uses: 5 (MP3 320), 6 (FLAC 16-bit), 7 (FLAC 24-bit), 27 (Hi-Res)
	qualityCode := "27" // Default to Hi-Res

	fmt.Printf("Getting download URL for track ID: %d\n", trackID)

	// Decode base64 API URLs
	primaryBase, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly9kYWIueWVldC5zdS9hcGkvc3RyZWFtP3RyYWNrSWQ9")

	// Try primary API first
	primaryURL := fmt.Sprintf("%s%d&quality=%s", string(primaryBase), trackID, qualityCode)

	resp, err := q.client.Get(primaryURL)
	if err == nil && resp.StatusCode == 200 {
		defer resp.Body.Close()

		body, _ := io.ReadAll(resp.Body)
		fmt.Printf("Primary API response: %s\n", string(body))

		var streamResp QobuzStreamResponse
		if err := json.Unmarshal(body, &streamResp); err == nil && streamResp.URL != "" {
			fmt.Printf("Got download URL from primary API\n")
			return streamResp.URL, nil
		}
	}
	if resp != nil {
		resp.Body.Close()
	}

	// Fallback to secondary API
	fmt.Println("Primary API failed, trying fallback...")
	fallbackBase, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly9kYWJtdXNpYy54eXovYXBpL3N0cmVhbT90cmFja0lkPQ==")
	fallbackURL := fmt.Sprintf("%s%d&quality=%s", string(fallbackBase), trackID, qualityCode)

	resp, err = q.client.Get(fallbackURL)
	if err != nil {
		return "", fmt.Errorf("failed to get download URL: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		fmt.Printf("Fallback API error response: %s\n", string(body))
		return "", fmt.Errorf("API returned status %d", resp.StatusCode)
	}

	body, _ := io.ReadAll(resp.Body)
	fmt.Printf("Fallback API response: %s\n", string(body))

	var streamResp QobuzStreamResponse
	if err := json.Unmarshal(body, &streamResp); err != nil {
		return "", fmt.Errorf("failed to decode response: %w", err)
	}

	if streamResp.URL == "" {
		return "", fmt.Errorf("no download URL available")
	}

	fmt.Printf("Got download URL from fallback API\n")
	return streamResp.URL, nil
}

func (q *QobuzDownloader) DownloadFile(url, filepath string) error {
	fmt.Println("Starting file download...")
	// Use a separate client with a longer timeout. The default client's 60s limit
	// causes downloads to fail on slow connections or for large Hi-Res files.
	downloadClient := &http.Client{
		Timeout: 5 * time.Minute, // 5 minutes for large files
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
	// Use progress writer to track download
	pw := NewProgressWriter(out)
	_, err = io.Copy(pw, resp.Body)
	if err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}

	// Print final size
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

func buildQobuzFilename(title, artist string, trackNumber int, format string, includeTrackNumber bool, position int, useAlbumTrackNumber bool) string {
	var filename string

	// Determine track number to use
	numberToUse := position
	if useAlbumTrackNumber && trackNumber > 0 {
		numberToUse = trackNumber
	}

	// Check if format is a template (contains {})
	if strings.Contains(format, "{") {
		filename = format
		filename = strings.ReplaceAll(filename, "{title}", title)
		filename = strings.ReplaceAll(filename, "{artist}", artist)

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

func (q *QobuzDownloader) DownloadByISRC(isrc, outputDir, quality, filenameFormat string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName string, useAlbumTrackNumber bool) (string, error) {
	fmt.Printf("Fetching track info for ISRC: %s\n", isrc)

	// Create output directory if it doesn't exist
	if outputDir != "." {
		if err := os.MkdirAll(outputDir, 0755); err != nil {
			return "", fmt.Errorf("failed to create output directory: %w", err)
		}
	}

	track, err := q.SearchByISRC(isrc)
	if err != nil {
		return "", err
	}

	// Use Spotify metadata if provided, otherwise fallback to Qobuz metadata
	artists := spotifyArtistName
	trackTitle := spotifyTrackName
	albumTitle := spotifyAlbumName

	if artists == "" {
		artists = track.Performer.Name
		if track.Album.Artist.Name != "" {
			artists = track.Album.Artist.Name
		}
	}

	if trackTitle == "" {
		trackTitle = track.Title
		if track.Version != "" && track.Version != "null" {
			trackTitle = fmt.Sprintf("%s (%s)", track.Title, track.Version)
		}
	}

	if albumTitle == "" {
		albumTitle = track.Album.Title
	}

	fmt.Printf("Found track: %s - %s\n", artists, trackTitle)
	fmt.Printf("Album: %s\n", albumTitle)

	qualityInfo := "Standard"
	if track.Hires {
		qualityInfo = fmt.Sprintf("Hi-Res (%d-bit / %.1f kHz)", track.MaximumBitDepth, track.MaximumSamplingRate)
	}
	fmt.Printf("Quality: %s\n", qualityInfo)

	fmt.Println("Getting download URL...")
	downloadURL, err := q.GetDownloadURL(track.ID, quality)
	if err != nil {
		return "", fmt.Errorf("failed to get download URL: %w", err)
	}

	if downloadURL == "" {
		return "", fmt.Errorf("received empty download URL")
	}

	// Show partial URL for security
	urlPreview := downloadURL
	if len(downloadURL) > 60 {
		urlPreview = downloadURL[:60] + "..."
	}
	fmt.Printf("Download URL obtained: %s\n", urlPreview)

	safeArtist := sanitizeFilename(artists)
	safeTitle := sanitizeFilename(trackTitle)

	// Check if file with same ISRC already exists
	if existingFile, exists := CheckISRCExists(outputDir, track.ISRC); exists {
		fmt.Printf("File with ISRC %s already exists: %s\n", track.ISRC, existingFile)
		return "EXISTS:" + existingFile, nil
	}

	// Build filename based on format settings
	filename := buildQobuzFilename(safeTitle, safeArtist, track.TrackNumber, filenameFormat, includeTrackNumber, position, useAlbumTrackNumber)
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
	if track.Album.Image.Large != "" {
		coverPath = filepath + ".cover.jpg"
		fmt.Println("Downloading cover art...")
		if err := q.DownloadCoverArt(track.Album.Image.Large, coverPath); err != nil {
			fmt.Printf("Warning: Failed to download cover art: %v\n", err)
		} else {
			defer os.Remove(coverPath)
		}
	}

	fmt.Println("Embedding metadata and cover art...")

	releaseYear := ""
	if len(track.ReleaseDateOriginal) >= 4 {
		releaseYear = track.ReleaseDateOriginal[:4]
	}

	// Use album track number if in album folder structure, otherwise use playlist position
	trackNumberToEmbed := 0
	if position > 0 {
		if useAlbumTrackNumber && track.TrackNumber > 0 {
			trackNumberToEmbed = track.TrackNumber
		} else {
			trackNumberToEmbed = position
		}
	}

	metadata := Metadata{
		Title:       trackTitle,
		Artist:      artists,
		Album:       albumTitle,
		Date:        releaseYear,
		TrackNumber: trackNumberToEmbed,
		DiscNumber:  track.MediaNumber,
		ISRC:        track.ISRC,
	}

	if err := EmbedMetadata(filepath, metadata, coverPath); err != nil {
		return "", fmt.Errorf("failed to embed metadata: %w", err)
	}

	fmt.Println("Metadata embedded successfully!")
	return filepath, nil
}
