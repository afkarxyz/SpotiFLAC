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

type DeezerDownloader struct {
	client *http.Client
}

type DeezerTrack struct {
	ID          int64  `json:"id"`
	Title       string `json:"title"`
	TitleShort  string `json:"title_short"`
	Duration    int    `json:"duration"`
	TrackPos    int    `json:"track_position"`
	DiskNumber  int    `json:"disk_number"`
	ISRC        string `json:"isrc"`
	ReleaseDate string `json:"release_date"`
	Artist      struct {
		Name string `json:"name"`
		ID   int64  `json:"id"`
	} `json:"artist"`
	Album struct {
		Title    string `json:"title"`
		ID       int64  `json:"id"`
		CoverXL  string `json:"cover_xl"`
		CoverBig string `json:"cover_big"`
	} `json:"album"`
	Contributors []struct {
		Name string `json:"name"`
		Role string `json:"role"`
	} `json:"contributors"`
}

type DeezMateResponse struct {
	Success bool `json:"success"`
	Links   struct {
		FLAC string `json:"flac"`
	} `json:"links"`
}

func NewDeezerDownloader() *DeezerDownloader {
	return &DeezerDownloader{
		client: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

func (d *DeezerDownloader) GetDeezerURLFromSpotify(spotifyTrackID string) (string, error) {
	// Decode base64 API URL
	spotifyBase, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly9vcGVuLnNwb3RpZnkuY29tL3RyYWNrLw==")
	spotifyURL := fmt.Sprintf("%s%s", string(spotifyBase), spotifyTrackID)

	apiBase, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly9hcGkuc29uZy5saW5rL3YxLWFscGhhLjEvbGlua3M/dXJsPQ==")
	apiURL := fmt.Sprintf("%s%s", string(apiBase), spotifyURL)

	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	fmt.Println("Getting Deezer URL...")

	resp, err := d.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to get Deezer URL: %w", err)
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

	deezerLink, ok := songLinkResp.LinksByPlatform["deezer"]
	if !ok || deezerLink.URL == "" {
		return "", fmt.Errorf("deezer link not found")
	}

	deezerURL := deezerLink.URL
	fmt.Printf("Found Deezer URL: %s\n", deezerURL)
	return deezerURL, nil
}

func (d *DeezerDownloader) GetTrackIDFromURL(deezerURL string) (int64, error) {
	// Extract track ID from Deezer URL
	// Format: https://www.deezer.com/track/3412534581
	parts := strings.Split(deezerURL, "/track/")
	if len(parts) < 2 {
		return 0, fmt.Errorf("invalid Deezer URL format")
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

func (d *DeezerDownloader) GetTrackByID(trackID int64) (*DeezerTrack, error) {
	// Decode base64 API URL
	apiBase, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly9hcGkuZGVlemVyLmNvbS8yLjAvdHJhY2sv")
	url := fmt.Sprintf("%s%d", string(apiBase), trackID)

	resp, err := d.client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch track: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("API returned status %d", resp.StatusCode)
	}

	var track DeezerTrack
	if err := json.NewDecoder(resp.Body).Decode(&track); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	if track.ID == 0 {
		return nil, fmt.Errorf("track not found")
	}

	return &track, nil
}

func (d *DeezerDownloader) GetDownloadURL(trackID int64) (string, error) {
	// Decode base64 API URL
	apiBase, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly9hcGkuZGVlem1hdGUuY29tL2RsLw==")
	url := fmt.Sprintf("%s%d", string(apiBase), trackID)

	resp, err := d.client.Get(url)
	if err != nil {
		return "", fmt.Errorf("failed to get download URL: %w", err)
	}
	defer resp.Body.Close()

	var apiResp DeezMateResponse
	if err := json.NewDecoder(resp.Body).Decode(&apiResp); err != nil {
		return "", fmt.Errorf("failed to decode API response: %w", err)
	}

	if !apiResp.Success || apiResp.Links.FLAC == "" {
		return "", fmt.Errorf("no FLAC download link available")
	}

	return apiResp.Links.FLAC, nil
}

func (d *DeezerDownloader) DownloadFile(url, filepath string) error {
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

func (d *DeezerDownloader) DownloadCoverArt(coverURL, filepath string) error {
	if coverURL == "" {
		return fmt.Errorf("no cover URL provided")
	}

	resp, err := d.client.Get(coverURL)
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

func buildFilename(title, artist string, trackNumber int, format string, includeTrackNumber bool, position int, useAlbumTrackNumber bool) string {
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

func (d *DeezerDownloader) DownloadByURL(deezerURL, outputDir, filenameFormat string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName string, useAlbumTrackNumber bool) (string, error) {
	fmt.Printf("Using Deezer URL: %s\n", deezerURL)

	// Extract track ID from URL
	trackID, err := d.GetTrackIDFromURL(deezerURL)
	if err != nil {
		return "", err
	}

	// Get track info by ID
	track, err := d.GetTrackByID(trackID)
	if err != nil {
		return "", err
	}

	// Use Spotify metadata if provided, otherwise fallback to Deezer metadata
	artists := spotifyArtistName
	trackTitle := spotifyTrackName
	albumTitle := spotifyAlbumName

	if artists == "" {
		artists = track.Artist.Name
		if len(track.Contributors) > 0 {
			var mainArtists []string
			for _, contrib := range track.Contributors {
				if contrib.Role == "Main" {
					mainArtists = append(mainArtists, contrib.Name)
				}
			}
			if len(mainArtists) > 0 {
				artists = strings.Join(mainArtists, ", ")
			}
		}
	}

	if trackTitle == "" {
		trackTitle = track.Title
	}

	if albumTitle == "" {
		albumTitle = track.Album.Title
	}

	fmt.Printf("Found track: %s - %s\n", artists, trackTitle)
	fmt.Printf("Album: %s\n", albumTitle)

	downloadURL, err := d.GetDownloadURL(track.ID)
	if err != nil {
		return "", err
	}

	safeArtist := sanitizeFilename(artists)
	safeTitle := sanitizeFilename(trackTitle)

	// Check if file with same ISRC already exists
	if existingFile, exists := CheckISRCExists(outputDir, track.ISRC); exists {
		fmt.Printf("File with ISRC %s already exists: %s\n", track.ISRC, existingFile)
		return "EXISTS:" + existingFile, nil
	}

	// Build filename based on format settings
	filename := buildFilename(safeTitle, safeArtist, track.TrackPos, filenameFormat, includeTrackNumber, position, useAlbumTrackNumber)
	filepath := filepath.Join(outputDir, filename)

	if fileInfo, err := os.Stat(filepath); err == nil && fileInfo.Size() > 0 {
		fmt.Printf("File already exists: %s (%.2f MB)\n", filepath, float64(fileInfo.Size())/(1024*1024))
		return "EXISTS:" + filepath, nil
	}

	fmt.Println("Downloading FLAC file...")
	if err := d.DownloadFile(downloadURL, filepath); err != nil {
		return "", err
	}

	fmt.Printf("Downloaded: %s\n", filepath)

	coverPath := ""
	if track.Album.CoverXL != "" {
		coverPath = filepath + ".cover.jpg"
		fmt.Println("Downloading cover art...")
		if err := d.DownloadCoverArt(track.Album.CoverXL, coverPath); err != nil {
			fmt.Printf("Warning: Failed to download cover art: %v\n", err)
		} else {
			defer os.Remove(coverPath)
		}
	}

	fmt.Println("Embedding metadata and cover art...")
	// Use album track number if in album folder structure, otherwise use playlist position
	trackNumberToEmbed := 0
	if position > 0 {
		if useAlbumTrackNumber && track.TrackPos > 0 {
			trackNumberToEmbed = track.TrackPos
		} else {
			trackNumberToEmbed = position
		}
	}

	metadata := Metadata{
		Title:       trackTitle,
		Artist:      artists,
		Album:       albumTitle,
		Date:        track.ReleaseDate,
		TrackNumber: trackNumberToEmbed,
		DiscNumber:  track.DiskNumber,
		ISRC:        track.ISRC,
	}

	if err := EmbedMetadata(filepath, metadata, coverPath); err != nil {
		return "", fmt.Errorf("failed to embed metadata: %w", err)
	}

	fmt.Println("Metadata embedded successfully!")
	fmt.Println("✓ Downloaded successfully from Deezer")
	return filepath, nil
}

func (d *DeezerDownloader) DownloadBySpotifyID(spotifyTrackID, outputDir, filenameFormat string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName string, useAlbumTrackNumber bool) (string, error) {
	// Get Deezer URL from Spotify track ID
	deezerURL, err := d.GetDeezerURLFromSpotify(spotifyTrackID)
	if err != nil {
		return "", err
	}

	return d.DownloadByURL(deezerURL, outputDir, filenameFormat, includeTrackNumber, position, spotifyTrackName, spotifyArtistName, spotifyAlbumName, useAlbumTrackNumber)
}
